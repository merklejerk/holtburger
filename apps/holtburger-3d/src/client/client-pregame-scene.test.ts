import { transformPoint3 } from "../lib/game/math/matrices";
import { createLandblockWorldOrigin } from "../lib/game/landblocks";
import type { PregameCharacterStatus } from "./client-pregame-character";
import { Vec3 } from "../lib/game/math/types";
import {
	PREGAME_TEST_SOURCE,
	PREGAME_TEST_VIEW,
	pregameModelFixture,
} from "./client-pregame-model.test-support";
import { ClientPregameCharacterService } from "./client-pregame-character";
import {
	CLIENT_PREGAME_CAMERA_TUNING,
	CLIENT_PREGAME_SCENE_TUNING,
	type ClientPregameLocation,
} from "./client-pregame-tuning";
import { describe, expect, it, vi } from "vitest";
import { ClientPregameScene } from "./client-pregame-scene";
import { clientEnvironmentFixture } from "./client-environment.test-support";
import type {
	SceneActivationReceipt,
	SceneActivationStatus,
} from "../lib/game/runtime/scene-availability";

type PregameRuntime = ConstructorParameters<
	typeof ClientPregameScene
>[0]["runtime"];

function fixture(
	location: ClientPregameLocation = CLIENT_PREGAME_SCENE_TUNING.locations[0],
) {
	const receipt: SceneActivationReceipt = {
		generation: 0,
		revision: 1 as SceneActivationReceipt["revision"],
		requiredLayers: new Map(),
	};
	const model = pregameModelFixture();
	const characters = new ClientPregameCharacterService();
	const runtime = {
		createLocalSceneModel: model.create,
		setPresentationLights: vi.fn(),
		activateScene: vi.fn(async () => receipt),
		sceneActivationStatus: vi.fn((): SceneActivationStatus => ({
			kind: "pending",
			receipt,
		})),
		pollPortalTransitionLoading: vi.fn(),
		setAudioListener: vi.fn(),
		setSceneEnvironment: vi.fn<PregameRuntime["setSceneEnvironment"]>(),
		setPrimaryView: vi.fn<PregameRuntime["setPrimaryView"]>(),
		queryWorldPointResidencyCandidates: vi.fn<
			PregameRuntime["queryWorldPointResidencyCandidates"]
		>(() => null),
		resolveViewportExtent: vi.fn((width: number, height: number) => ({
			width,
			height,
		})),
		frame: vi.fn(),
		clearSceneInterest: vi.fn(() => ({ revision: receipt.revision })),
	};
	const profileSource = {
		loadLandblockProfile: vi.fn(async (landblockId: string) => ({
			landblockId,
			sceneClass: "dungeon-only" as const,
		})),
	};
	const reducedMotion = vi.fn(() => false);
	const scene = new ClientPregameScene(
		{
			runtime,
			profileSource,
			activeRegion: clientEnvironmentFixture(),
		},
		characters,
		location,
		reducedMotion,
	);
	return {
		scene,
		runtime,
		receipt,
		profileSource,
		characters,
		model,
		reducedMotion,
	};
}

describe("ClientPregameScene", () => {
	it.each(CLIENT_PREGAME_SCENE_TUNING.locations)(
		"keeps authored character and camera placements separate in $landblockId",
		async (location) => {
			const { scene, runtime, receipt, model, characters } = fixture(location);
			const placement = model.create.mock.calls[0]?.[0];
			if (placement === undefined)
				throw new Error("Expected a staged local model");
			expect(placement.envCellId).toBe(location.character.envCellId);
			expect(placement.spatialMembership.scopes).toEqual([
				{
					kind: "env-cell",
					landblockId: location.landblockId,
					envCellId: location.character.envCellId,
				},
			]);
			const [x, y, z] = location.character.position;
			expect(placement.localTransform.m41).toBeCloseTo(x);
			expect(placement.localTransform.m42).toBeCloseTo(z);
			expect(placement.localTransform.m43).toBeCloseTo(-y);
			await scene.start();
			runtime.sceneActivationStatus.mockReturnValue({ kind: "ready", receipt });
			scene.frame(0, 1440, 900);
			const initial =
				runtime.setPrimaryView.mock.calls.at(-1)?.[0].camera.placement;
			expect(initial?.position).toEqual(location.camera.position);
			expect(initial?.envCellId).toBe(location.camera.envCellId);
			if (initial === undefined) throw new Error("Expected a pregame camera");
			const surface = characters.open(
				() => {},
				() => {},
			);
			runtime.queryWorldPointResidencyCandidates.mockReturnValue({
				outdoor: { landblockId: location.landblockId, envCellId: null },
				envCells: [
					{
						landblockId: location.landblockId,
						envCellId: location.character.envCellId,
						containsPoint: true,
					},
				],
			});
			surface.setSource(PREGAME_TEST_SOURCE);
			surface.setView({ ...PREGAME_TEST_VIEW, headingRadians: 0 });
			await vi.waitFor(() =>
				expect(model.create.mock.results[0]?.value.status().kind).toBe("ready"),
			);
			scene.frame(16, 1440, 900);
			const framed =
				runtime.setPrimaryView.mock.calls.at(-1)?.[0].camera.placement;
			expect(framed?.rotation).toEqual(initial?.rotation);
			expect(framed?.envCellId).toBe(location.character.envCellId);
			expect(framed?.position).not.toEqual(initial?.position);
			const placed = model.port.setPlacement.mock.calls.at(-1)?.[0];
			if (placed === undefined)
				throw new Error("Expected a framed model placement");
			const focus = transformPoint3(placed.localTransform, model.fit.center);
			const origin = createLandblockWorldOrigin(location.landblockId);
			if (framed === undefined) throw new Error("Expected the fitted camera");
			const dx = framed.position.x - origin.x - focus.x;
			const dz = framed.position.z - origin.z - focus.z;
			const length = Math.hypot(dx, dz);
			expect(-placed.localTransform.m31).toBeCloseTo(dx / length, 8);
			expect(-placed.localTransform.m33).toBeCloseTo(dz / length, 8);
			const neutral = Math.atan2(
				placed.localTransform.m31,
				placed.localTransform.m33,
			);
			surface.setView(PREGAME_TEST_VIEW);
			scene.frame(32, 1440, 900);
			const turned = model.port.setPlacement.mock.calls.at(-1)?.[0];
			if (turned === undefined)
				throw new Error("Expected a rotated model placement");
			expect(turned.localTransform.m31).toBeCloseTo(
				Math.sin(neutral + PREGAME_TEST_VIEW.headingRadians),
				8,
			);
			expect(turned.localTransform.m33).toBeCloseTo(
				Math.cos(neutral + PREGAME_TEST_VIEW.headingRadians),
				8,
			);
			await scene.destroy();
		},
	);

	it("withdraws the world audio listener immediately and keeps it withdrawn across pregame frames", async () => {
		const { scene, runtime, receipt } = fixture();
		expect(runtime.setAudioListener.mock.calls).toEqual([[null]]);
		await scene.start();
		runtime.sceneActivationStatus.mockReturnValue({ kind: "ready", receipt });
		scene.frame(0, 1440, 900);
		scene.frame(16, 1440, 900);
		expect(runtime.frame).toHaveBeenCalled();
		expect(
			runtime.setAudioListener.mock.calls.every(
				([listener]) => listener === null,
			),
		).toBe(true);
		await scene.destroy();
	});

	it("frames the installed character, preserves source scale/clipping, and limits/recoveries without stopping the world", async () => {
		const { scene, runtime, receipt, characters, model } = fixture();
		const statuses: PregameCharacterStatus[] = [];
		const surface = characters.open(
			(status) => statuses.push(status),
			() => {},
		);
		surface.setView(PREGAME_TEST_VIEW);
		surface.setSource(PREGAME_TEST_SOURCE);
		await scene.start();
		runtime.sceneActivationStatus.mockReturnValue({ kind: "ready", receipt });
		await vi.waitFor(() =>
			expect(model.create.mock.results[0]?.value.status().kind).toBe("ready"),
		);
		expect(scene.frame(1000, 1440, 900)).toBe(true);
		expect(runtime.setPrimaryView.mock.calls.at(-1)?.[0].camera.fov).toBe(
			CLIENT_PREGAME_CAMERA_TUNING.fovDegrees,
		);
		expect(statuses.at(-1)?.kind).toBe("ready");
		expect(model.port.prepare.mock.calls[0]?.[0].body.scale).toBe(
			PREGAME_TEST_SOURCE.visual.body.scale,
		);
		const bodyCamera = runtime.setPrimaryView.mock.lastCall?.[0].camera;
		if (bodyCamera === undefined) throw new Error("No camera was installed.");
		expect(runtime.setPresentationLights).toHaveBeenLastCalledWith([
			expect.objectContaining({
				intensity: CLIENT_PREGAME_SCENE_TUNING.fillLight.intensity,
			}),
		]);
		const count = statuses.length;
		scene.frame(1016, 1440, 900);
		expect(statuses).toHaveLength(count);
		surface.setView({
			...PREGAME_TEST_VIEW,
			rectangle: { ...PREGAME_TEST_VIEW.rectangle, width: 1 },
		});
		expect(scene.frame(1032, 1440, 900)).toBe(true);
		expect(statuses.at(-1)?.kind).toBe("limited");
		expect(model.port.setVisible).toHaveBeenLastCalledWith(false);
		expect(runtime.setPresentationLights).toHaveBeenLastCalledWith([]);
		expect(runtime.setPrimaryView.mock.lastCall?.[0].camera).toBe(bodyCamera);
		surface.setView(PREGAME_TEST_VIEW);
		scene.frame(1048, 1440, 900);
		expect(statuses.at(-1)?.kind).toBe("ready");
		surface.setView({
			...PREGAME_TEST_VIEW,
			headingRadians: 1,
			framing: { kind: "face", center: new Vec3(0, 1.65, 0), height: 0.5 },
		});
		scene.frame(1064, 1440, 900);
		expect(
			runtime.setPrimaryView.mock.lastCall?.[0].camera.placement.position,
		).toEqual(bodyCamera.placement.position);
		scene.frame(1070, 1440, 900);
		const faceCamera = runtime.setPrimaryView.mock.lastCall?.[0].camera;
		expect(faceCamera?.near).toBe(bodyCamera.near);
		expect(faceCamera?.far).toBe(bodyCamera.far);
		expect(faceCamera?.placement.position).not.toEqual(
			bodyCamera.placement.position,
		);
		expect(model.port.prepare).toHaveBeenCalledTimes(1);
		runtime.resolveViewportExtent.mockReturnValueOnce({
			width: 913,
			height: 582,
		});
		scene.frame(1072, 1440, 900);
		expect(runtime.setPrimaryView.mock.lastCall?.[0].extent).toEqual({
			width: 913,
			height: 582,
		});
		expect(
			runtime.setPrimaryView.mock.lastCall?.[0].camera.placement.position,
		).not.toEqual(faceCamera?.placement.position);
		expect(model.port.prepare).toHaveBeenCalledTimes(1);
		surface.setView(null);
		scene.frame(1080, 1440, 900);
		expect(statuses.at(-1)?.kind).toBe("suspended");
		await scene.destroy();
		expect(runtime.setPresentationLights).toHaveBeenLastCalledWith([]);
		expect(model.port.withdraw).toHaveBeenCalled();
	});

	it("clears the character and light immediately when world drawing fails", async () => {
		const { scene, runtime, receipt, characters, model } = fixture();
		const surface = characters.open(
			() => {},
			() => {},
		);
		surface.setView(PREGAME_TEST_VIEW);
		surface.setSource(PREGAME_TEST_SOURCE);
		await scene.start();
		runtime.sceneActivationStatus.mockReturnValue({ kind: "ready", receipt });
		await vi.waitFor(() =>
			expect(model.create.mock.results[0]?.value.status().kind).toBe("ready"),
		);
		scene.frame(1000, 1440, 900);
		runtime.frame.mockImplementationOnce(() => {
			throw new Error("Render failure");
		});
		expect(() => scene.frame(1016, 1440, 900)).toThrow("Render failure");
		expect(runtime.setPresentationLights).toHaveBeenLastCalledWith([]);
		expect(model.port.setVisible).toHaveBeenLastCalledWith(false);
		await scene.destroy();
	});

	it("keeps world readiness independent from missing, loading, or failed character assets", async () => {
		const { scene, runtime, receipt, characters, model } = fixture();
		const status = vi.fn();
		const surface = characters.open(status, () => {});
		await scene.start();
		runtime.sceneActivationStatus.mockReturnValue({ kind: "ready", receipt });
		expect(scene.frame(1000, 1440, 900)).toBe(true);
		expect(status).toHaveBeenLastCalledWith({ kind: "empty" });
		let reject: (cause: Error) => void = () => {
			throw new Error("Preparation not started.");
		};
		model.port.prepare.mockImplementationOnce(
			() =>
				new Promise((_resolve, failure) => {
					reject = failure;
				}),
		);
		surface.setSource(PREGAME_TEST_SOURCE);
		expect(status).toHaveBeenLastCalledWith({ kind: "loading" });
		expect(scene.frame(1016, 1440, 900)).toBe(true);
		reject(new Error("Missing model assets"));
		await vi.waitFor(() =>
			expect(status).toHaveBeenLastCalledWith({
				kind: "failed",
				message: "Missing model assets",
			}),
		);
		expect(scene.status()).toEqual({ kind: "ready" });
		expect(scene.frame(1032, 1440, 900)).toBe(true);
		await scene.destroy();
	});

	it("pumps installation without drawing until exact static products are ready", async () => {
		const { scene, runtime, receipt } = fixture();
		await scene.start();
		await scene.start();
		expect(runtime.activateScene).toHaveBeenCalledTimes(1);
		expect(scene.frame(1000, 800, 600)).toBe(false);
		expect(runtime.pollPortalTransitionLoading).toHaveBeenCalledOnce();
		expect(runtime.frame).not.toHaveBeenCalled();
		runtime.sceneActivationStatus.mockReturnValue({ kind: "ready", receipt });
		expect(scene.frame(1016, 800, 600)).toBe(true);
		const view = runtime.setPrimaryView.mock.calls[0][0];
		expect(view.camera.placement.position).toMatchObject(
			CLIENT_PREGAME_SCENE_TUNING.locations[0].camera.position,
		);
		expect(
			Math.hypot(
				...[
					view.camera.placement.rotation.w,
					view.camera.placement.rotation.x,
					view.camera.placement.rotation.y,
					view.camera.placement.rotation.z,
				],
			),
		).toBeCloseTo(1);
		expect(view.extent).toEqual({ width: 800, height: 600 });
		await scene.destroy();
	});

	it("reports failed layer installation without drawing and retires once", async () => {
		const { scene, runtime, receipt } = fixture();
		await scene.start();
		runtime.sceneActivationStatus.mockReturnValue({
			kind: "failed",
			receipt,
			diagnostic: "missing cell shell",
		});
		expect(scene.frame(1000, 800, 600)).toBe(false);
		expect(scene.status()).toEqual({
			kind: "failed",
			message: "missing cell shell",
		});
		const retirement = scene.destroy();
		expect(scene.destroy()).toBe(retirement);
		await retirement;
		expect(runtime.clearSceneInterest).toHaveBeenCalledOnce();
		expect(scene.frame(1016, 800, 600)).toBe(false);
	});

	it("withdraws a profile lookup before it can install obsolete scene demand", async () => {
		const { scene, runtime, profileSource } = fixture();
		let finish: (() => void) | undefined;
		profileSource.loadLandblockProfile.mockImplementation(
			(landblockId) =>
				new Promise((resolve) => {
					finish = () => resolve({ landblockId, sceneClass: "dungeon-only" });
				}),
		);
		const start = scene.start();
		const retirement = scene.destroy();
		if (finish === undefined) throw new Error("profile request did not start");
		finish();
		await Promise.all([start, retirement]);
		expect(runtime.activateScene).not.toHaveBeenCalled();
		expect(scene.status()).toEqual({ kind: "stopped" });
	});
});

describe("pregame focus animation", () => {
	it("uses elapsed frame time, retargets continuously, follows displayed residency, and stops when hidden", async () => {
		const { scene, runtime, receipt, characters, model, reducedMotion } =
			fixture();
		const surface = characters.open(
			() => {},
			() => {},
		);
		surface.setView(PREGAME_TEST_VIEW);
		surface.setSource(PREGAME_TEST_SOURCE);
		await scene.start();
		runtime.sceneActivationStatus.mockReturnValue({ kind: "ready", receipt });
		await vi.waitFor(() =>
			expect(model.create.mock.results[0]?.value.status().kind).toBe("ready"),
		);
		const duration = CLIENT_PREGAME_CAMERA_TUNING.transitionMs;
		const position = () => {
			const camera = runtime.setPrimaryView.mock.lastCall?.[0].camera;
			if (camera === undefined) throw new Error("Missing camera frame");
			return camera.placement.position;
		};
		scene.frame(0, 1440, 900);
		const body = position();
		const faceView = {
			...PREGAME_TEST_VIEW,
			framing: {
				kind: "face" as const,
				center: new Vec3(0, 1.65, 0),
				height: 0.5,
			},
		};
		surface.setView(faceView);
		scene.frame(duration, 1440, 900);
		expect(position()).toEqual(body);
		scene.frame(duration * 1.5, 1440, 900);
		const midpoint = position();
		expect(midpoint).not.toEqual(body);
		expect(
			runtime.queryWorldPointResidencyCandidates.mock.lastCall?.[0],
		).toEqual(midpoint);
		scene.frame(duration * 2, 1440, 900);
		const face = position();
		for (const axis of ["x", "y", "z"] as const)
			expect(midpoint[axis]).toBeCloseTo((body[axis] + face[axis]) / 2);
		const queries =
			runtime.queryWorldPointResidencyCandidates.mock.calls.length;
		scene.frame(duration * 3, 1440, 900);
		expect(runtime.queryWorldPointResidencyCandidates.mock.calls.length).toBe(
			queries,
		);
		surface.setView(PREGAME_TEST_VIEW);
		scene.frame(duration * 4, 1440, 900);
		scene.frame(duration * 4.5, 1440, 900);
		const reverseAt = position();
		surface.setView(faceView);
		scene.frame(duration * 4.5, 1440, 900);
		expect(position()).toEqual(reverseAt);
		scene.frame(duration * 5.5, 1440, 900);
		expect(position()).toEqual(face);
		reducedMotion.mockReturnValue(true);
		surface.setView(PREGAME_TEST_VIEW);
		scene.frame(duration * 6, 1440, 900);
		expect(position()).toEqual(body);
		reducedMotion.mockReturnValue(false);
		surface.setView(faceView);
		scene.frame(duration * 7, 1440, 900);
		surface.setView(null);
		scene.frame(duration * 8, 1440, 900);
		const hidden = position();
		scene.frame(duration * 9, 1440, 900);
		expect(position()).toEqual(hidden);
		await scene.destroy();
		expect(scene.frame(duration * 10, 1440, 900)).toBe(false);
	});
});
