import {
	BACKGROUND_FRAME_INTERVAL_MS,
	startPresentationFrameLoop,
} from "../app/presentation-frame-loop";
import { Mat4 } from "../lib/game/math/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ObjectPreviewResources,
	ObjectPreviewViewport,
} from "../lib/game/preview/object-preview-controller";
import type { ObjectPreviewSource } from "../lib/game/runtime/object-preview-source";
import { acquireObjectPreviewAssets } from "../lib/game/preview/object-preview-composition";
import { WebGL2PreviewRenderer } from "../lib/game/renderer/webgl2-preview-renderer";
import { StandardClientObjectPreviewService } from "./client-object-preview-service";

vi.mock("../lib/game/preview/object-preview-composition", () => ({
	acquireObjectPreviewAssets: vi.fn(),
}));
vi.mock("../lib/game/renderer/webgl2-preview-renderer", () => ({
	WebGL2PreviewRenderer: { build: vi.fn() },
}));
vi.mock("../lib/game/preview/object-preview-presentation", () => ({
	ObjectPreviewPresentation: class {
		advance = vi.fn((timeSeconds: number) => ({ timeSeconds }));
		dispose = vi.fn();
	},
}));

const SOURCE: ObjectPreviewSource = {
	attachments: [],
	background: null,
	body: {
		appearance: {
			paletteDid: null,
			partChanges: [],
			subPalettes: [],
			textureChanges: [],
		},
		pose: { kind: "setup-pose" },
		scale: 1,
		setupDid: 0x02000001,
		translucency: 0,
	},
};
const VIEWPORT: ObjectPreviewViewport = {
	extent: { height: 180, width: 240 },
	minimumFrameIntervalSeconds: 1 / 30,
	rotation: { kind: "orbit", yawRadians: 0.5 },
	framing: { kind: "body" },
};
// Only the external preparation/device boundaries are faked; the production mount owns lifecycle.
const RESOURCES = {
	assets: { texturePreparer: {} },
	particleMeshSource: () => ({}),
} as unknown as ObjectPreviewResources;
const REQUEST = { canvas: {} as HTMLCanvasElement, source: SOURCE };

function deferred<T>() {
	const holder: { resolve(value: T): void } = {
		resolve: () => {
			throw new Error("Deferred promise is not initialized.");
		},
	};
	const promise = new Promise<T>((resolve) => {
		holder.resolve = resolve;
	});
	return { promise, resolve: (value: T) => holder.resolve(value) };
}

const acquire = vi.mocked(acquireObjectPreviewAssets);
const build = vi.mocked(WebGL2PreviewRenderer.build);
let callbacks: Map<number, FrameRequestCallback>;
let nextFrame: number;
let focused: boolean;
let tasks: (() => void)[];

function lease() {
	return { assets: {}, release: vi.fn() } as unknown as Awaited<
		ReturnType<typeof acquireObjectPreviewAssets>
	>;
}
function device() {
	const draw = vi.fn();
	const destroy = vi.fn(async () => {});
	const clear = vi.fn(async () => undefined);
	const commit = vi.fn(async (): Promise<void> => {});
	const dispose = vi.fn(async () => undefined);
	const prepareReplacement = vi.fn(async () => ({ commit, dispose }));
	return {
		draw,
		destroy,
		clear,
		commit,
		dispose,
		prepareReplacement,
		renderer: {
			draw,
			destroy,
			clear,
			prepareReplacement,
			getDiagnostics: () => null,
		} as unknown as WebGL2PreviewRenderer,
	};
}
async function flush() {
	for (let index = 0; index < 20; index++) await Promise.resolve();
}
function frame(timestamp: number) {
	const pending = [...callbacks.values()];
	callbacks.clear();
	for (const callback of pending) callback(timestamp);
	for (const task of tasks.splice(0)) task();
}
function service(resolveResources = async () => RESOURCES) {
	return new StandardClientObjectPreviewService({
		startFrameLoop: startPresentationFrameLoop,
		resolveResources,
	});
}

beforeEach(() => {
	vi.resetAllMocks();
	callbacks = new Map();
	nextFrame = 0;
	focused = true;
	tasks = [];
	vi.stubGlobal("document", { hasFocus: () => focused });
	vi.stubGlobal("window", {
		requestAnimationFrame: (callback: FrameRequestCallback) => {
			callbacks.set(++nextFrame, callback);
			return nextFrame;
		},
		cancelAnimationFrame: (id: number) => callbacks.delete(id),
		reportError: (error: unknown) => {
			throw error;
		},
		scheduler: {
			postTask: (task: () => void) => {
				tasks.push(task);
				return Promise.resolve();
			},
		},
	});
	acquire.mockResolvedValue(lease());
	build.mockResolvedValue(device().renderer);
});
afterEach(() => vi.unstubAllGlobals());

describe("preview mount lifecycle through the client service", () => {
	it("limits background work, updates cadence, and stops hidden previews", async () => {
		const renderer = device();
		build.mockResolvedValue(renderer.renderer);
		const owner = service();
		const handle = owner.open(REQUEST);
		handle.setViewport(VIEWPORT);
		await flush();
		frame(0);
		await handle.ready;
		focused = false;
		frame(BACKGROUND_FRAME_INTERVAL_MS / 2);
		expect(renderer.draw).toHaveBeenCalledTimes(1);
		frame(BACKGROUND_FRAME_INTERVAL_MS);
		expect(renderer.draw).toHaveBeenCalledTimes(2);
		focused = true;
		frame(BACKGROUND_FRAME_INTERVAL_MS * 1.5);
		expect(renderer.draw).toHaveBeenCalledTimes(3);
		handle.setViewport({
			...VIEWPORT,
			minimumFrameIntervalSeconds: (BACKGROUND_FRAME_INTERVAL_MS * 2) / 1_000,
		});
		frame(BACKGROUND_FRAME_INTERVAL_MS * 2);
		expect(renderer.draw).toHaveBeenCalledTimes(3);
		handle.setViewport(null);
		expect(callbacks.size).toBe(0);
		frame(BACKGROUND_FRAME_INTERVAL_MS * 20);
		handle.setViewport(VIEWPORT);
		frame(BACKGROUND_FRAME_INTERVAL_MS * 21);
		expect(renderer.draw).toHaveBeenCalledTimes(4);
		expect(renderer.draw).toHaveBeenLastCalledWith(
			{
				timeSeconds: expect.closeTo(
					(BACKGROUND_FRAME_INTERVAL_MS * 1.5) / 1_000,
				),
			},
			expect.anything(),
		);
		await owner.destroy();
		expect(callbacks.size).toBe(0);
	});

	it("stops scheduling and retires the device after a draw failure", async () => {
		const renderer = device();
		const cause = new Error("Preview draw failed.");
		renderer.draw.mockImplementation(() => {
			throw cause;
		});
		build.mockResolvedValue(renderer.renderer);
		const onError = vi.fn();
		const owner = new StandardClientObjectPreviewService({
			startFrameLoop: startPresentationFrameLoop,
			resolveResources: async () => RESOURCES,
			onError,
		});
		const handle = owner.open(REQUEST);
		const ready = expect(handle.ready).rejects.toBe(cause);
		handle.setViewport(VIEWPORT);
		await flush();
		frame(0);
		await ready;
		await owner.destroy();
		expect(onError).toHaveBeenCalledExactlyOnceWith(cause);
		expect(callbacks.size).toBe(0);
		expect(tasks).toHaveLength(0);
		expect(renderer.destroy).toHaveBeenCalledOnce();
	});

	it("admits an empty surface without preparing resources and later draws its first source", async () => {
		const resources = vi.fn(async () => RESOURCES);
		const owner = new StandardClientObjectPreviewService({
			startFrameLoop: startPresentationFrameLoop,
			resolveResources: resources,
		});
		const handle = owner.open({ ...REQUEST, source: null });
		handle.setViewport(VIEWPORT);
		await flush();
		expect(resources).not.toHaveBeenCalled();
		expect(build).not.toHaveBeenCalled();
		expect(callbacks.size).toBe(0);
		await expect(handle.replaceSource(SOURCE)).resolves.toEqual({
			kind: "installed",
		});
		frame(100);
		await handle.ready;
		expect(build).toHaveBeenCalledOnce();
		await handle.withdrawSource();
		await handle.replaceSource(SOURCE);
		expect(build).toHaveBeenCalledOnce();
		await owner.destroy();
	});
	it("coalesces edits and releases stale preparation while retaining the device", async () => {
		const renderer = device();
		build.mockResolvedValue(renderer.renderer);
		const first = lease();
		const stale = lease();
		const latest = lease();
		const pending = deferred<ReturnType<typeof lease>>();
		acquire
			.mockResolvedValueOnce(first)
			.mockReturnValueOnce(pending.promise)
			.mockResolvedValueOnce(latest);
		const owner = service();
		const handle = owner.open(REQUEST);
		handle.setViewport(VIEWPORT);
		await flush();
		frame(100);
		await handle.ready;
		const b = handle.replaceSource({
			...SOURCE,
			body: { ...SOURCE.body, scale: 2 },
		});
		await flush();
		const c = handle.replaceSource({
			...SOURCE,
			body: { ...SOURCE.body, scale: 3 },
		});
		const d = handle.replaceSource({
			...SOURCE,
			body: { ...SOURCE.body, scale: 4 },
		});
		await expect(c).resolves.toEqual({ kind: "superseded" });
		pending.resolve(stale);
		await expect(b).resolves.toEqual({ kind: "superseded" });
		await expect(d).resolves.toEqual({ kind: "installed" });
		expect(acquire).toHaveBeenCalledTimes(3);
		expect(build).toHaveBeenCalledOnce();
		expect(renderer.prepareReplacement).toHaveBeenCalledExactlyOnceWith(
			latest.assets,
		);
		expect(renderer.commit).toHaveBeenCalledOnce();
		expect(first.release).toHaveBeenCalledOnce();
		expect(stale.release).toHaveBeenCalledOnce();
		expect(latest.release).not.toHaveBeenCalled();
		await owner.destroy();
		expect(latest.release).toHaveBeenCalledOnce();
	});

	it("preserves the installed visual when GPU replacement preparation fails", async () => {
		const renderer = device();
		build.mockResolvedValue(renderer.renderer);
		const first = lease();
		const rejected = lease();
		acquire.mockResolvedValueOnce(first).mockResolvedValueOnce(rejected);
		const owner = service();
		const handle = owner.open(REQUEST);
		handle.setViewport(VIEWPORT);
		await flush();
		frame(100);
		await handle.ready;
		renderer.prepareReplacement.mockRejectedValueOnce(
			new Error("texture upload failed"),
		);
		await expect(
			handle.replaceSource({ ...SOURCE, body: { ...SOURCE.body, scale: 2 } }),
		).rejects.toThrow("texture upload failed");
		expect(first.release).not.toHaveBeenCalled();
		expect(rejected.release).toHaveBeenCalledOnce();
		frame(200);
		expect(renderer.draw).toHaveBeenCalledTimes(2);
		expect(renderer.commit).not.toHaveBeenCalled();
		await owner.destroy();
		expect(first.release).toHaveBeenCalledOnce();
	});

	it("retains an obsolete source's cleanup failure until shutdown", async () => {
		const renderer = device();
		build.mockResolvedValue(renderer.renderer);
		const pending = deferred<ReturnType<typeof lease>>();
		const first = lease();
		const stale = lease();
		const latest = lease();
		const cause = new Error("lease cleanup failed");
		vi.mocked(stale.release).mockImplementationOnce(() => {
			throw cause;
		});
		acquire
			.mockResolvedValueOnce(first)
			.mockReturnValueOnce(pending.promise)
			.mockResolvedValueOnce(latest);
		const owner = service();
		const handle = owner.open(REQUEST);
		handle.setViewport(VIEWPORT);
		await flush();
		frame(100);
		await handle.ready;
		const b = handle.replaceSource({
			...SOURCE,
			body: { ...SOURCE.body, scale: 2 },
		});
		await flush();
		const c = handle.replaceSource({
			...SOURCE,
			body: { ...SOURCE.body, scale: 3 },
		});
		pending.resolve(stale);
		await expect(b).resolves.toEqual({ kind: "superseded" });
		await expect(c).resolves.toEqual({ kind: "installed" });
		await expect(owner.destroy()).rejects.toMatchObject({ errors: [cause] });
		expect(latest.release).toHaveBeenCalledOnce();
		expect(renderer.destroy).toHaveBeenCalledOnce();
	});

	it("withdraws the subject during commit retirement without double-releasing its transferred lease", async () => {
		const renderer = device();
		build.mockResolvedValue(renderer.renderer);
		const first = lease();
		const next = lease();
		acquire.mockResolvedValueOnce(first).mockResolvedValueOnce(next);
		const owner = service();
		const handle = owner.open(REQUEST);
		handle.setViewport(VIEWPORT);
		await flush();
		frame(100);
		await handle.ready;
		const retirement = deferred<void>();
		renderer.commit.mockReturnValueOnce(retirement.promise);
		const replacement = handle.replaceSource({
			...SOURCE,
			body: { ...SOURCE.body, scale: 2 },
		});
		await flush();
		expect(renderer.commit).toHaveBeenCalledOnce();
		await handle.withdrawSource();
		expect(renderer.clear).toHaveBeenCalledOnce();
		expect(next.release).toHaveBeenCalledOnce();
		retirement.resolve();
		await expect(replacement).resolves.toEqual({ kind: "superseded" });
		await owner.destroy();
		expect(first.release).toHaveBeenCalledOnce();
		expect(next.release).toHaveBeenCalledOnce();
	});

	it("disposes a late staged replacement before closing its device", async () => {
		const renderer = device();
		build.mockResolvedValue(renderer.renderer);
		const first = lease();
		const next = lease();
		acquire.mockResolvedValueOnce(first).mockResolvedValueOnce(next);
		const owner = service();
		const handle = owner.open(REQUEST);
		handle.setViewport(VIEWPORT);
		await flush();
		frame(100);
		await handle.ready;
		const staging =
			deferred<Awaited<ReturnType<typeof renderer.prepareReplacement>>>();
		renderer.prepareReplacement.mockReturnValueOnce(staging.promise);
		const replacement = handle.replaceSource({
			...SOURCE,
			body: { ...SOURCE.body, scale: 2 },
		});
		await flush();
		const closing = handle.dispose();
		expect(renderer.destroy).not.toHaveBeenCalled();
		staging.resolve({ commit: renderer.commit, dispose: renderer.dispose });
		await closing;
		await expect(replacement).resolves.toEqual({ kind: "superseded" });
		expect(renderer.dispose).toHaveBeenCalledOnce();
		expect(renderer.commit).not.toHaveBeenCalled();
		expect(first.release).toHaveBeenCalledOnce();
		expect(next.release).toHaveBeenCalledOnce();
		expect(renderer.destroy).toHaveBeenCalledOnce();
		await owner.destroy();
	});
	it("uses the latest pending viewport, suspends, and resumes before settling ready", async () => {
		const resources = deferred<ObjectPreviewResources>();
		const renderer = device();
		build.mockResolvedValue(renderer.renderer);
		const owner = service(() => resources.promise);
		const handle = owner.open(REQUEST);
		handle.setViewport(VIEWPORT);
		handle.setViewport({
			...VIEWPORT,
			rotation: { kind: "orbit", yawRadians: 1 },
		});
		resources.resolve(RESOURCES);
		await flush();
		handle.setViewport(null);
		frame(100);
		expect(renderer.draw).not.toHaveBeenCalled();
		handle.setViewport({
			...VIEWPORT,
			rotation: { kind: "orbit", yawRadians: 2 },
		});
		frame(200);
		await handle.ready;
		expect(renderer.draw).toHaveBeenCalledExactlyOnceWith(
			{ timeSeconds: 0 },
			{
				extent: VIEWPORT.extent,
				cameraYawRadians: 2,
				subjectTransform: Mat4.identity(),
				framing: { kind: "body" },
			},
		);
		await owner.destroy();
		expect(renderer.destroy).toHaveBeenCalledOnce();
	});

	it("shares disposal completion and never acquires after closing before resources arrive", async () => {
		const resources = deferred<ObjectPreviewResources>();
		const owner = service(() => resources.promise);
		const handle = owner.open(REQUEST);
		const failure = handle.ready.catch((cause: unknown) => cause);
		const disposal = handle.dispose();
		expect(handle.dispose()).toBe(disposal);
		let completed = false;
		void disposal.then(() => {
			completed = true;
		});
		await flush();
		expect(completed).toBe(false);
		resources.resolve(RESOURCES);
		await disposal;
		expect(acquire).not.toHaveBeenCalled();
		await expect(failure).resolves.toMatchObject({ name: "AbortError" });
		await owner.destroy();
	});

	it("releases a late asset acquisition without activating a canceled mount", async () => {
		const pending =
			deferred<Awaited<ReturnType<typeof acquireObjectPreviewAssets>>>();
		acquire.mockReturnValueOnce(pending.promise);
		const owner = service();
		const handle = owner.open(REQUEST);
		const failure = handle.ready.catch((cause: unknown) => cause);
		await flush();
		const disposal = handle.dispose();
		const assets = lease();
		pending.resolve(assets);
		await disposal;
		expect(assets.release).toHaveBeenCalledOnce();
		expect(build).not.toHaveBeenCalled();
		await expect(failure).resolves.toMatchObject({ name: "AbortError" });
		await owner.destroy();
	});

	it("rapid replacement waits for pending device retirement before activating the last mount", async () => {
		const pendingBuild = deferred<WebGL2PreviewRenderer>();
		const retiring = deferred<void>();
		const first = device();
		first.destroy.mockReturnValue(retiring.promise);
		const last = device();
		build
			.mockReturnValueOnce(pendingBuild.promise)
			.mockResolvedValue(last.renderer);
		const owner = service();
		const a = owner.open(REQUEST);
		const failureA = a.ready.catch((cause: unknown) => cause);
		await flush();
		const b = owner.open(REQUEST);
		const failureB = b.ready.catch((cause: unknown) => cause);
		const c = owner.open(REQUEST);
		c.setViewport(VIEWPORT);
		await flush();
		expect(build).toHaveBeenCalledTimes(1);
		pendingBuild.resolve(first.renderer);
		await flush();
		expect(first.destroy).toHaveBeenCalledOnce();
		expect(build).toHaveBeenCalledTimes(1);
		retiring.resolve();
		await flush();
		expect(build).toHaveBeenCalledTimes(2);
		frame(100);
		await c.ready;
		await expect(failureA).resolves.toMatchObject({ name: "AbortError" });
		await expect(failureB).resolves.toMatchObject({ name: "AbortError" });
		await owner.destroy();
		expect(last.destroy).toHaveBeenCalledOnce();
	});

	it("reports preparation failure and permits a later successful mount", async () => {
		const cause = new Error("preparation failed");
		acquire.mockRejectedValueOnce(cause);
		const owner = service();
		const failed = owner.open(REQUEST);
		await expect(failed.ready).rejects.toBe(cause);
		const next = owner.open(REQUEST);
		next.setViewport(VIEWPORT);
		await flush();
		frame(100);
		await next.ready;
		await owner.destroy();
	});

	it("releases leases after device construction fails", async () => {
		const assets = lease();
		acquire.mockResolvedValueOnce(assets);
		build.mockRejectedValueOnce(new Error("device failed"));
		const owner = service();
		const handle = owner.open(REQUEST);
		await expect(handle.ready).rejects.toThrow("device failed");
		await owner.destroy();
		expect(assets.release).toHaveBeenCalledOnce();
	});

	it("failed retirement blocks replacement and remains observable at shutdown", async () => {
		const first = device();
		first.destroy.mockRejectedValue(new Error("retirement failed"));
		build.mockResolvedValueOnce(first.renderer);
		const owner = service();
		const a = owner.open(REQUEST);
		a.setViewport(VIEWPORT);
		await flush();
		frame(100);
		await a.ready;
		const b = owner.open(REQUEST);
		await expect(b.ready).rejects.toThrow("teardown failed");
		expect(build).toHaveBeenCalledOnce();
		await expect(owner.destroy()).rejects.toThrow("teardown failed");
	});

	it("drains a pending replacement after the previous device retirement fails", async () => {
		const first = device();
		first.destroy.mockRejectedValue(new Error("retirement failed"));
		build.mockResolvedValueOnce(first.renderer);
		const resources = deferred<ObjectPreviewResources>();
		let resolutions = 0;
		const owner = service(() =>
			++resolutions === 1 ? Promise.resolve(RESOURCES) : resources.promise,
		);
		const a = owner.open(REQUEST);
		a.setViewport(VIEWPORT);
		await flush();
		frame(100);
		await a.ready;
		const b = owner.open(REQUEST);
		const cancelled = b.ready.catch((error: unknown) => error);
		await flush();
		let settled = false;
		const shutdown = owner.destroy();
		void shutdown.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			},
		);
		await flush();
		expect(settled).toBe(false);
		resources.resolve(RESOURCES);
		await expect(shutdown).rejects.toThrow("teardown failed");
		await expect(cancelled).resolves.toMatchObject({ name: "AbortError" });
		expect(build).toHaveBeenCalledOnce();
	});

	it("shutdown drains pending resource resolution and closes admission", async () => {
		const resources = deferred<ObjectPreviewResources>();
		const owner = service(() => resources.promise);
		const handle = owner.open(REQUEST);
		const failure = handle.ready.catch((cause: unknown) => cause);
		const shutdown = owner.destroy();
		expect(owner.destroy()).toBe(shutdown);
		expect(() => owner.open(REQUEST)).toThrow("destroyed preview service");
		resources.resolve(RESOURCES);
		await shutdown;
		await expect(failure).resolves.toMatchObject({ name: "AbortError" });
		expect(acquire).not.toHaveBeenCalled();
	});
});
