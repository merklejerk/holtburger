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
	const runtime = {
		activateScene: vi.fn(async () => receipt),
		sceneActivationStatus: vi.fn(() => ({ kind: "ready" as const, receipt })),
		pollPortalTransitionLoading: vi.fn(),
		setAudioListener: vi.fn(),
		setSceneEnvironment: vi.fn(),
		setPrimaryView: vi.fn(),
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
	return { owner, runtime, gameplay, dependencies };
}

describe("ClientPresentationRoot", () => {
	it("retains one owner across backdrop/gameplay/backdrop and destroys it only on root retirement", async () => {
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

	it("waits for gameplay retirement before admitting the next backdrop", async () => {
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

	it("pauses the backdrop for creator while retaining scene demand and owner", async () => {
		const { dependencies, owner, runtime } = fixture();
		const root = new ClientPresentationRoot(dependencies);
		await root.setMode("pregame");
		root.frame(1000);
		root.setBackdropVisible(false);
		root.frame(2000);
		expect(runtime.frame).toHaveBeenCalledOnce();
		expect(runtime.setAudioListener).toHaveBeenLastCalledWith(null);
		expect(runtime.clearSceneInterest).not.toHaveBeenCalled();
		root.setBackdropVisible(true);
		root.frame(3000);
		expect(runtime.frame).toHaveBeenCalledTimes(2);
		expect(owner.destroy).not.toHaveBeenCalled();
		await root.destroy();
	});
	it("retries a failed backdrop installation with fresh demand", async () => {
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
		await root.destroy();
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
		await root.destroy();
	});

	it("withdraws scene inputs on exit without starting another backdrop", async () => {
		const { dependencies, runtime, gameplay } = fixture();
		const root = new ClientPresentationRoot(dependencies);
		await root.setMode("gameplay");
		await root.setMode("idle");
		expect(gameplay.destroy).toHaveBeenCalledOnce();
		expect(runtime.activateScene).not.toHaveBeenCalled();
		await root.destroy();
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
