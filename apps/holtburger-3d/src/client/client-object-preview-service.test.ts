import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ObjectPreviewResources,
	ObjectPreviewViewport,
} from "../lib/game/preview/object-preview-controller";
import type { ObjectPreviewSource } from "../lib/game/runtime/object-preview-source";
import { acquireObjectPreviewAssets } from "../lib/game/preview/object-preview-assets";
import { WebGL2PreviewRenderer } from "../lib/game/renderer/webgl2-preview-renderer";
import { StandardClientObjectPreviewService } from "./client-object-preview-service";

vi.mock("../lib/game/preview/object-preview-assets", () => ({
	acquireObjectPreviewAssets: vi.fn(),
}));
vi.mock("../lib/game/renderer/webgl2-preview-renderer", () => ({
	WebGL2PreviewRenderer: { build: vi.fn() },
}));
vi.mock("../lib/game/preview/object-preview-presentation", () => ({
	ObjectPreviewPresentation: class {
		advance = vi.fn(() => ({}));
		dispose = vi.fn();
	},
}));

const SOURCE: ObjectPreviewSource = {
	appearance: {
		paletteDid: null,
		partChanges: [],
		subPalettes: [],
		textureChanges: [],
	},
	guid: 0x60000002,
	pose: { kind: "setup-pose" },
	scale: 1,
	setupDid: 0x02000001,
	translucency: 0,
};
const VIEWPORT: ObjectPreviewViewport = {
	extent: { height: 180, width: 240 },
	minimumFrameIntervalSeconds: 1 / 30,
	yawRadians: 0.5,
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

function lease() {
	return { assets: {}, release: vi.fn() } as unknown as Awaited<
		ReturnType<typeof acquireObjectPreviewAssets>
	>;
}
function device() {
	const draw = vi.fn();
	const destroy = vi.fn(async () => {});
	return {
		draw,
		destroy,
		renderer: {
			draw,
			destroy,
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
}
function service(resolveResources = async () => RESOURCES) {
	return new StandardClientObjectPreviewService({ resolveResources });
}

beforeEach(() => {
	vi.resetAllMocks();
	callbacks = new Map();
	nextFrame = 0;
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		callbacks.set(++nextFrame, callback);
		return nextFrame;
	});
	vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
	acquire.mockResolvedValue(lease());
	build.mockResolvedValue(device().renderer);
});
afterEach(() => vi.unstubAllGlobals());

describe("preview mount lifecycle through the client service", () => {
	it("uses the latest pending viewport, suspends, and resumes before settling ready", async () => {
		const resources = deferred<ObjectPreviewResources>();
		const renderer = device();
		build.mockResolvedValue(renderer.renderer);
		const owner = service(() => resources.promise);
		const handle = owner.open(REQUEST);
		handle.setViewport(VIEWPORT);
		handle.setViewport({ ...VIEWPORT, yawRadians: 1 });
		resources.resolve(RESOURCES);
		await flush();
		handle.setViewport(null);
		frame(100);
		expect(renderer.draw).not.toHaveBeenCalled();
		handle.setViewport({ ...VIEWPORT, yawRadians: 2 });
		frame(200);
		await handle.ready;
		expect(renderer.draw).toHaveBeenCalledExactlyOnceWith(
			{},
			{
				extent: VIEWPORT.extent,
				yawRadians: 2,
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
