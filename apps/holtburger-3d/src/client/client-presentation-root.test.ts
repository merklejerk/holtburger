import { CLIENT_PREGAME_SCENE_TUNING } from "./client-pregame-tuning";
import {
	PREGAME_TEST_SOURCE,
	PREGAME_TEST_VIEW,
	pregameModelFixture,
} from "./client-pregame-model.test-support";
import { CLIENT_AUDIO_DEFAULTS } from "./client-settings-defaults";
import { CLIENT_TUNING } from "./client-tuning";
import { describe, expect, it, vi } from "vitest";
import {
	ClientPresentationRoot,
	type ClientPresentationRootOwner,
} from "./client-presentation-root";
import { clientEnvironmentFixture } from "./client-environment.test-support";
import type { SceneActivationReceipt } from "../lib/game/runtime/scene-availability";

function deferred<T>() {
	let resolve: (value: T) => void = () => {
		throw new Error("Deferred not initialized");
	};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function fixture() {
	const receipt: SceneActivationReceipt = {
		generation: 0,
		revision: 1 as SceneActivationReceipt["revision"],
		requiredLayers: new Map(),
	};
	const model = pregameModelFixture();
	const runtime = {
		createLocalSceneModel: model.create,
		setPresentationLights: vi.fn(),
		activateScene: vi.fn<
			ClientPresentationRootOwner["runtime"]["activateScene"]
		>(async () => receipt),
		sceneActivationStatus: vi.fn(() => ({ kind: "ready" as const, receipt })),
		pollPortalTransitionLoading: vi.fn(),
		setAudioListener: vi.fn(),
		setSceneEnvironment: vi.fn(),
		setPrimaryView: vi.fn(),
		queryWorldPointResidencyCandidates: vi.fn(() => null),
		resolveViewportExtent: vi.fn((width: number, height: number) => ({
			width,
			height,
		})),
		frame: vi.fn(),
		clearSceneInterest: vi.fn(() => ({ revision: receipt.revision })),
		setFrameSettings: vi.fn(),
		setAudioSettings: vi.fn(),
	} satisfies ClientPresentationRootOwner["runtime"];
	const owner = {
		runtime,
		activeRegion: clientEnvironmentFixture(),
		profileSource: {
			loadLandblockProfile: async (landblockId: string) => ({
				landblockId,
				sceneClass: "dungeon-only" as const,
			}),
		},
		setOutputVolume: vi.fn(),
		destroy: vi.fn(async () => {}),
	};
	const gameplay = {
		start: vi.fn(async () => {}),
		frame: vi.fn(() => ({
			rendered: true,
			status: { kind: "ready" as const, diagnostic: null },
		})),
		destroy: vi.fn(async () => {}),
	};
	const dependencies = {
		pregameLocation: CLIENT_PREGAME_SCENE_TUNING.locations[0],
		canvas: { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement,
		build: vi.fn(async (signal: AbortSignal) => {
			signal.throwIfAborted();
			return owner;
		}),
		createGameplay: vi.fn(() => gameplay),
		onGameplayRetired: vi.fn(),
		onReady: vi.fn(),
		onError: vi.fn(),
	};
	return { owner, runtime, gameplay, dependencies, model };
}

describe("ClientPresentationRoot", () => {
	it("retires shared resources after a surface reports a model withdrawal failure", async () => {
		const { dependencies, owner, model } = fixture();
		const root = new ClientPresentationRoot(dependencies);
		await root.setMode("pregame");
		const revoke = vi.fn();
		root.pregameCharacters.open(vi.fn(), revoke);
		const failure = new Error("Synthetic model withdrawal failure");
		model.port.withdraw.mockImplementationOnce(() => {
			throw failure;
		});
		const retirement = root.destroy();
		expect(root.destroy()).toBe(retirement);
		await expect(retirement).rejects.toThrow(
			expect.objectContaining({ errors: [failure] }),
		);
		expect(revoke).toHaveBeenCalledOnce();
		expect(owner.destroy).toHaveBeenCalledOnce();
	});

	it.each(CLIENT_PREGAME_SCENE_TUNING.locations)(
		"retains the selected location across handoff and retry in $landblockId",
		async (location) => {
			const { dependencies, runtime } = fixture();
			const root = new ClientPresentationRoot({
				...dependencies,
				pregameLocation: location,
			});
			await root.setMode("pregame");
			await root.setMode("gameplay");
			await root.setMode("pregame");
			await root.retry();
			expect(runtime.activateScene).toHaveBeenCalledTimes(3);
			for (const [request] of runtime.activateScene.mock.calls)
				expect(request.target.target.requested).toEqual({
					kind: "env-cell",
					landblockId: location.landblockId,
					envCellId: location.camera.envCellId,
				});
			await root.destroy();
		},
	);

	it("retains a page's initial character during construction and joins pending model work before gameplay", async () => {
		const { dependencies, owner, runtime, gameplay, model } = fixture();
		dependencies.canvas = {
			clientWidth: 1440,
			clientHeight: 900,
		} as HTMLCanvasElement;
		const building = deferred<typeof owner>();
		dependencies.build.mockReturnValueOnce(building.promise);
		const root = new ClientPresentationRoot(dependencies);
		const status = vi.fn();
		const surface = root.pregameCharacters.open(status, () => {});
		surface.setSource(PREGAME_TEST_SOURCE);
		surface.setView(PREGAME_TEST_VIEW);
		const admission = root.setMode("pregame");
		expect(status).toHaveBeenLastCalledWith({ kind: "loading" });
		expect(model.create).not.toHaveBeenCalled();
		building.resolve(owner);
		await admission;
		await vi.waitFor(() =>
			expect(model.create.mock.results[0]?.value.status().kind).toBe("ready"),
		);
		root.frame(1000);
		expect(status).toHaveBeenLastCalledWith({
			kind: "ready",
			replacement: { kind: "settled" },
		});
		expect(runtime.setPresentationLights.mock.lastCall?.[0]).toHaveLength(1);
		const preparing =
			deferred<Awaited<ReturnType<typeof model.port.prepare>>>();
		model.port.prepare.mockImplementationOnce(() => preparing.promise);
		surface.setSource({
			...PREGAME_TEST_SOURCE,
			visual: {
				...PREGAME_TEST_SOURCE.visual,
				body: { ...PREGAME_TEST_SOURCE.visual.body, scale: 1.1 },
			},
		});
		const changing = root.setMode("gameplay");
		await vi.waitFor(() => expect(model.port.withdraw).toHaveBeenCalled());
		expect(runtime.setPresentationLights).toHaveBeenLastCalledWith([]);
		expect(gameplay.start).not.toHaveBeenCalled();
		const lateRelease = vi.fn();
		const lateCommit = vi.fn();
		preparing.resolve({
			fit: model.fit,
			commit: lateCommit,
			release: lateRelease,
		});
		await changing;
		expect(lateCommit).not.toHaveBeenCalled();
		expect(lateRelease).toHaveBeenCalledOnce();
		expect(gameplay.start).toHaveBeenCalledOnce();
		await root.destroy();
	});

	it("retains one owner across pregame/gameplay/pregame and destroys it only on root retirement", async () => {
		const { dependencies, owner, gameplay, runtime } = fixture();
		const root = new ClientPresentationRoot(dependencies);
		await root.setMode("pregame");
		expect(root.frame(1000).kind).toBe("pregame");
		await root.setMode("pregame");
		expect(runtime.activateScene).toHaveBeenCalledOnce();
		await root.setMode("gameplay");
		expect(root.frame(1016).kind).toBe("gameplay");
		await root.setMode("pregame");
		expect(gameplay.destroy).toHaveBeenCalledOnce();
		expect(owner.destroy).not.toHaveBeenCalled();
		expect(dependencies.build).toHaveBeenCalledOnce();
		expect(runtime.activateScene).toHaveBeenCalledTimes(2);
		const retirement = root.destroy();
		expect(root.destroy()).toBe(retirement);
		await retirement;
		expect(owner.destroy).toHaveBeenCalledOnce();
	});

	it("owns graphics and audio settings across both drivers", async () => {
		const { dependencies, owner, runtime } = fixture();
		const root = new ClientPresentationRoot(dependencies);
		await root.setMode("pregame");
		root.setFrameSettings(CLIENT_TUNING.frameSettings);
		const mix = {
			...CLIENT_AUDIO_DEFAULTS,
			masterVolume: 0.4,
			effectVolume: 0.7,
			ambientVolume: 0.2,
		};
		root.setAudioSettings({ ...mix, muted: true });
		expect(owner.setOutputVolume).toHaveBeenLastCalledWith(0);
		await root.setMode("gameplay");
		root.setAudioSettings({ ...mix, muted: false });
		await root.setMode("pregame");
		expect(owner.setOutputVolume).toHaveBeenLastCalledWith(mix.masterVolume);
		expect(runtime.setAudioSettings).toHaveBeenLastCalledWith({
			effectVolume: mix.effectVolume,
			ambientVolume: mix.ambientVolume,
		});
		expect(runtime.setFrameSettings).toHaveBeenCalledExactlyOnceWith(
			CLIENT_TUNING.frameSettings,
		);
		await root.destroy();
	});

	it("waits for gameplay retirement before admitting the next pregame scene", async () => {
		const { dependencies, gameplay, runtime } = fixture();
		const root = new ClientPresentationRoot(dependencies);
		await root.setMode("gameplay");
		const gate = deferred<void>();
		gameplay.destroy.mockImplementation(() => gate.promise);
		const changing = root.setMode("pregame");
		await Promise.resolve();
		expect(root.frame(1000).kind).toBe("loading");
		expect(runtime.activateScene).not.toHaveBeenCalled();
		gate.resolve();
		await changing;
		expect(runtime.activateScene).toHaveBeenCalledOnce();
		await root.destroy();
	});

	it("coalesces mode changes while construction is pending and aborts construction on shutdown", async () => {
		const { dependencies, owner } = fixture();
		const gate = deferred<typeof owner>();
		dependencies.build.mockImplementation(() => gate.promise);
		const root = new ClientPresentationRoot(dependencies);
		const first = root.setMode("gameplay");
		const last = root.setMode("pregame");
		gate.resolve(owner);
		await Promise.all([first, last]);
		expect(dependencies.createGameplay).not.toHaveBeenCalled();
		await root.destroy();
		expect(dependencies.build.mock.calls[0][0].aborted).toBe(true);
		expect(owner.destroy).toHaveBeenCalledOnce();
	});

	it("retains the pregame scene and owner across foreground changes", async () => {
		const { dependencies, owner, runtime } = fixture();
		const root = new ClientPresentationRoot(dependencies);
		await root.setMode("pregame");
		root.frame(1000);
		await root.setMode("pregame");
		root.frame(2000);
		expect(runtime.frame).toHaveBeenCalledTimes(2);
		expect(runtime.activateScene).toHaveBeenCalledOnce();
		expect(runtime.clearSceneInterest).not.toHaveBeenCalled();
		expect(owner.destroy).not.toHaveBeenCalled();
		await root.destroy();
	});

	it("retries a failed pregame installation with fresh demand", async () => {
		const { dependencies, runtime } = fixture();
		runtime.activateScene.mockRejectedValueOnce(
			new Error("content temporarily unavailable"),
		);
		const root = new ClientPresentationRoot(dependencies);
		await root.setMode("pregame");
		expect(root.frame(1000).kind).toBe("failed");
		await root.retry();
		expect(root.frame(1016).kind).toBe("pregame");
		expect(runtime.clearSceneInterest).toHaveBeenCalledOnce();
		expect(runtime.activateScene).toHaveBeenCalledTimes(2);
		await root.destroy();
	});

	it("blocks further admission when gameplay withdrawal fails", async () => {
		const { dependencies, gameplay, runtime, owner } = fixture();
		const root = new ClientPresentationRoot(dependencies);
		await root.setMode("gameplay");
		gameplay.destroy.mockRejectedValueOnce(new Error("camera stop failed"));
		await root.setMode("pregame");
		expect(root.frame(1000)).toEqual({
			kind: "failed",
			message: "camera stop failed",
			canRetry: false,
		});
		await root.retry();
		await root.setMode("gameplay");
		expect(runtime.activateScene).not.toHaveBeenCalled();
		expect(dependencies.createGameplay).toHaveBeenCalledOnce();
		await expect(root.destroy()).rejects.toThrow(
			"Presentation retirement failed",
		);
		expect(owner.destroy).toHaveBeenCalledOnce();
	});

	it("blocks a queued replacement when an earlier withdrawal fails", async () => {
		const { dependencies, gameplay, runtime } = fixture();
		const root = new ClientPresentationRoot(dependencies);
		await root.setMode("gameplay");
		const gate = deferred<void>();
		gameplay.destroy.mockImplementationOnce(async () => {
			await gate.promise;
			throw new Error("camera stop failed");
		});
		const changing = root.setMode("pregame");
		await Promise.resolve();
		const replacing = root.setMode("gameplay");
		gate.resolve();
		await Promise.all([changing, replacing]);
		expect(root.frame(1000)).toEqual({
			kind: "failed",
			message: "camera stop failed",
			canRetry: false,
		});
		expect(runtime.activateScene).not.toHaveBeenCalled();
		expect(dependencies.createGameplay).toHaveBeenCalledOnce();
		await expect(root.destroy()).rejects.toThrow(
			"Presentation retirement failed",
		);
	});

	it("withdraws scene inputs on exit without starting another pregame scene", async () => {
		const { dependencies, runtime, gameplay } = fixture();
		const root = new ClientPresentationRoot(dependencies);
		await root.setMode("gameplay");
		await root.setMode("idle");
		expect(gameplay.destroy).toHaveBeenCalledOnce();
		expect(runtime.activateScene).not.toHaveBeenCalled();
		await root.destroy();
	});

	it("joins gameplay already retiring during Return without waiting for pregame startup", async () => {
		const { dependencies, gameplay, runtime } = fixture();
		const root = new ClientPresentationRoot(dependencies);
		await root.setMode("gameplay");
		const gate = deferred<void>();
		gameplay.destroy.mockReturnValue(gate.promise);
		const returning = root.setMode("pregame");
		await vi.waitFor(() => expect(gameplay.destroy).toHaveBeenCalledOnce());
		let stopped = false;
		const disconnecting = root.retireGameplay().then(() => {
			stopped = true;
		});
		await Promise.resolve();
		expect(stopped).toBe(false);
		gate.resolve();
		await Promise.all([returning, disconnecting]);
		expect(gameplay.destroy).toHaveBeenCalledOnce();
		expect(runtime.activateScene).not.toHaveBeenCalled();
		await root.destroy();
	});
	it("cancels a pending gameplay start before joining its normal success wait", async () => {
		const { dependencies, gameplay } = fixture();
		const root = new ClientPresentationRoot(dependencies);
		const gate = deferred<void>();
		gameplay.start.mockReturnValue(gate.promise);
		const starting = root.setMode("gameplay");
		await vi.waitFor(() => expect(gameplay.start).toHaveBeenCalledOnce());
		await root.retireGameplay();
		await starting;
		expect(gameplay.destroy).toHaveBeenCalledOnce();
		gate.resolve();
		await root.destroy();
	});
	it("does not wait for unrelated static owner construction to retire gameplay", async () => {
		const { dependencies, owner } = fixture();
		const gate = deferred<typeof owner>();
		dependencies.build.mockReturnValue(gate.promise);
		const root = new ClientPresentationRoot(dependencies);
		const starting = root.setMode("gameplay");
		await root.retireGameplay();
		await starting;
		expect(dependencies.createGameplay).not.toHaveBeenCalled();
		gate.resolve(owner);
		await root.destroy();
	});
	it("retains a failed retirement for every barrier and final root destruction", async () => {
		const { dependencies, gameplay } = fixture();
		const root = new ClientPresentationRoot(dependencies);
		await root.setMode("gameplay");
		gameplay.destroy.mockRejectedValue(new Error("camera stop failed"));
		await expect(root.retireGameplay()).rejects.toThrow("camera stop failed");
		await expect(root.retireGameplay()).rejects.toThrow("camera stop failed");
		await expect(root.destroy()).rejects.toThrow(
			"Presentation retirement failed",
		);
		expect(gameplay.destroy).toHaveBeenCalledOnce();
	});

	it("aborts pending resource construction and does not admit a driver afterward", async () => {
		const { dependencies, owner } = fixture();
		dependencies.build.mockImplementation(
			(signal) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener(
						"abort",
						() => reject(new DOMException("cancelled", "AbortError")),
						{ once: true },
					);
				}),
		);
		const root = new ClientPresentationRoot(dependencies);
		const starting = root.setMode("gameplay");
		await root.destroy();
		await starting;
		expect(dependencies.createGameplay).not.toHaveBeenCalled();
		expect(owner.destroy).not.toHaveBeenCalled();
	});
});
