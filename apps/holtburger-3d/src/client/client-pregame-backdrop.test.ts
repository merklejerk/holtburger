import { describe, expect, it, vi } from "vitest";
import {
	ClientPregameBackdrop,
	CLIENT_PREGAME_BACKDROP_TUNING,
} from "./client-pregame-backdrop";
import { clientEnvironmentFixture } from "./client-environment.test-support";
import type {
	SceneActivationReceipt,
	SceneActivationStatus,
} from "../lib/game/runtime/scene-availability";

type BackdropRuntime = ConstructorParameters<
	typeof ClientPregameBackdrop
>[0]["runtime"];

function fixture() {
	const receipt: SceneActivationReceipt = {
		generation: 0,
		revision: 1 as SceneActivationReceipt["revision"],
		requiredLayers: new Map(),
	};
	const runtime = {
		activateScene: vi.fn(async () => receipt),
		sceneActivationStatus: vi.fn((): SceneActivationStatus => ({
			kind: "pending",
			receipt,
		})),
		pollPortalTransitionLoading: vi.fn(),
		setAudioListener: vi.fn(),
		setSceneEnvironment: vi.fn<BackdropRuntime["setSceneEnvironment"]>(),
		setPrimaryView: vi.fn<BackdropRuntime["setPrimaryView"]>(),
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
	const backdrop = new ClientPregameBackdrop({
		runtime,
		profileSource,
		activeRegion: clientEnvironmentFixture(),
	});
	return { backdrop, runtime, receipt, profileSource };
}

describe("ClientPregameBackdrop", () => {
	it("pumps installation without drawing until exact static products are ready", async () => {
		const { backdrop, runtime, receipt } = fixture();
		await backdrop.start();
		await backdrop.start();
		expect(runtime.activateScene).toHaveBeenCalledTimes(1);
		expect(backdrop.frame(1000, 800, 600)).toBe(false);
		expect(runtime.pollPortalTransitionLoading).toHaveBeenCalledOnce();
		expect(runtime.frame).not.toHaveBeenCalled();
		runtime.sceneActivationStatus.mockReturnValue({ kind: "ready", receipt });
		expect(backdrop.frame(1016, 800, 600)).toBe(true);
		const view = runtime.setPrimaryView.mock.calls[0][0];
		expect(view.camera.placement.position).toMatchObject(
			CLIENT_PREGAME_BACKDROP_TUNING.position,
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
		await backdrop.destroy();
	});

	it("pauses drawing and local calendar while creator is foreground, then resumes", async () => {
		const { backdrop, runtime, receipt } = fixture();
		await backdrop.start();
		runtime.sceneActivationStatus.mockReturnValue({ kind: "ready", receipt });
		backdrop.frame(1000, 800, 600);
		const environment = runtime.setSceneEnvironment.mock.calls[0][0];
		backdrop.setVisible(false);
		expect(runtime.setAudioListener).toHaveBeenLastCalledWith(null);
		expect(backdrop.frame(100000, 800, 600)).toBe(false);
		backdrop.setVisible(true);
		expect(backdrop.frame(200000, 800, 600)).toBe(true);
		expect(runtime.setSceneEnvironment).toHaveBeenCalledTimes(1);
		expect(runtime.setSceneEnvironment.mock.calls[0][0]).toBe(environment);
		await backdrop.destroy();
	});

	it("reports failed layer installation without drawing and retires once", async () => {
		const { backdrop, runtime, receipt } = fixture();
		await backdrop.start();
		runtime.sceneActivationStatus.mockReturnValue({
			kind: "failed",
			receipt,
			diagnostic: "missing cell shell",
		});
		expect(backdrop.frame(1000, 800, 600)).toBe(false);
		expect(backdrop.status()).toEqual({
			kind: "failed",
			message: "missing cell shell",
		});
		const retirement = backdrop.destroy();
		expect(backdrop.destroy()).toBe(retirement);
		await retirement;
		expect(runtime.clearSceneInterest).toHaveBeenCalledOnce();
		expect(backdrop.frame(1016, 800, 600)).toBe(false);
	});

	it("withdraws a profile lookup before it can install obsolete scene demand", async () => {
		const { backdrop, runtime, profileSource } = fixture();
		let finish: (() => void) | undefined;
		profileSource.loadLandblockProfile.mockImplementation(
			(landblockId) =>
				new Promise((resolve) => {
					finish = () => resolve({ landblockId, sceneClass: "dungeon-only" });
				}),
		);
		const start = backdrop.start();
		const retirement = backdrop.destroy();
		if (finish === undefined) throw new Error("profile request did not start");
		finish();
		await Promise.all([start, retirement]);
		expect(runtime.activateScene).not.toHaveBeenCalled();
		expect(backdrop.status()).toEqual({ kind: "stopped" });
	});
});
