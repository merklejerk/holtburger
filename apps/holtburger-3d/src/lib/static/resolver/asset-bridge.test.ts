import { describe, expect, it } from "vitest";
import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../../assets/contracts";
import { createHostAssetKey } from "../../assets/keys";
import { createStaticResolverMainAssetBridge } from "./asset-bridge";
import type {
	StaticResolverWorkerGlobalPort,
	StaticResolverWorkerMainMessage,
	StaticResolverWorkerPort,
	StaticResolverWorkerThreadMessage,
} from "./protocol";
import {
	RequestScopedPreparedAssetReader,
	StaticResolverWorkerPreparedAssetReader,
} from "./worker-asset-reader";

describe("static resolver asset bridge", () => {
	it("round-trips typed prepared asset requests through the worker boundary", async () => {
		const channel = new FixtureWorkerChannel();
		const key = createHostAssetKey("landblock-outdoor", 0xda55ffff);
		const asset = createPreparedAsset(key);
		const assetReader = new FixturePreparedAssetReader(asset);
		const bridge = createStaticResolverMainAssetBridge(
			channel.mainPort,
			assetReader,
		);
		const workerAssetReader = new StaticResolverWorkerPreparedAssetReader(
			channel.workerPort,
		);

		await expect(workerAssetReader.requestPreparedAsset(key)).resolves.toEqual(
			asset,
		);
		expect(assetReader.requests).toEqual([key]);
		expect(channel.threadMessages).toEqual([
			{
				key,
				kind: "prepared-asset-requested",
				requestId: "resolver-asset-1",
			},
		]);

		workerAssetReader.dispose();
		bridge.dispose();
	});

	it("sends resolver-light landblock env-cell payloads across the worker boundary without mutating the asset service copy", async () => {
		const channel = new FixtureWorkerChannel();
		const key = createHostAssetKey("landblock-env-cells", 0xda55ffff);
		const asset = createPreparedAssetWithPayload(key, {
			envCells: [
				{
					renderGeometry: {
						normals: [0, 0, 1],
						positions: [1, 2, 3],
						triangles: [{ firstVertex: 0 }],
						uvs: [0, 0],
					},
				},
			],
			kind: "landblock-env-cells",
		});
		const assetReader = new FixturePreparedAssetReader(asset);
		const bridge = createStaticResolverMainAssetBridge(
			channel.mainPort,
			assetReader,
		);
		const workerAssetReader = new StaticResolverWorkerPreparedAssetReader(
			channel.workerPort,
		);

		const resolved = await workerAssetReader.requestPreparedAsset(key);

		expect(resolved.payload).toMatchObject({
			envCells: [
				{
					renderGeometry: {
						triangles: [{ firstVertex: 0 }],
					},
				},
			],
			kind: "landblock-env-cells",
		});
		const renderGeometry = (
			resolved.payload as {
				readonly envCells: readonly {
					readonly renderGeometry: Record<string, unknown>;
				}[];
			}
		).envCells[0]?.renderGeometry;
		expect(renderGeometry).not.toHaveProperty("normals");
		expect(renderGeometry).not.toHaveProperty("positions");
		expect(renderGeometry).not.toHaveProperty("uvs");
		expect(
			(
				asset.payload as {
					readonly envCells: readonly {
						readonly renderGeometry: { readonly positions: readonly number[] };
					}[];
				}
			).envCells[0]?.renderGeometry.positions,
		).toEqual([1, 2, 3]);

		workerAssetReader.dispose();
		bridge.dispose();
	});

	it("sends resolver-light gfx-obj payloads across the worker boundary without vertex buffers", async () => {
		const channel = new FixtureWorkerChannel();
		const key = createHostAssetKey("gfx-obj", 0x01000020);
		const asset = createPreparedAssetWithPayload(key, {
			kind: "gfx-obj",
			renderGeometry: {
				normals: [0, 0, 1],
				positions: [1, 2, 3],
				triangles: [{ firstVertex: 0 }],
				uvs: [0, 0],
			},
		});
		const assetReader = new FixturePreparedAssetReader(asset);
		const bridge = createStaticResolverMainAssetBridge(
			channel.mainPort,
			assetReader,
		);
		const workerAssetReader = new StaticResolverWorkerPreparedAssetReader(
			channel.workerPort,
		);

		const resolved = await workerAssetReader.requestPreparedAsset(key);

		expect(resolved.payload).toMatchObject({
			kind: "gfx-obj",
			renderGeometry: {
				triangles: [{ firstVertex: 0 }],
			},
		});
		const renderGeometry = (
			resolved.payload as {
				readonly renderGeometry: Record<string, unknown>;
			}
		).renderGeometry;
		expect(renderGeometry).not.toHaveProperty("normals");
		expect(renderGeometry).not.toHaveProperty("positions");
		expect(renderGeometry).not.toHaveProperty("uvs");

		workerAssetReader.dispose();
		bridge.dispose();
	});

	it("sends resolver-light render-surface payloads across the worker boundary without source bytes", async () => {
		const channel = new FixtureWorkerChannel();
		const key = createHostAssetKey("render-surface", 0x06000010);
		const asset = createPreparedAssetWithPayload(key, {
			defaultPaletteId: 0x04000010,
			dependencies: { paletteAssetIds: ["palette/04000010"] },
			format: "p8",
			formatRaw: 0x29,
			height: 4,
			kind: "render-surface",
			provenance: { sourceDatFile: "client_portal.dat", sourceDid: 0x06000010 },
			renderSurfaceId: 0x06000010,
			residencyKind: "unknown",
			sourceAssetKind: "render-surface",
			sourceByteLength: 16,
			sourceBytes: new Uint8Array([1, 2, 3, 4]),
			unknown: 0,
			width: 4,
		});
		const assetReader = new FixturePreparedAssetReader(asset);
		const bridge = createStaticResolverMainAssetBridge(
			channel.mainPort,
			assetReader,
		);
		const workerAssetReader = new StaticResolverWorkerPreparedAssetReader(
			channel.workerPort,
		);

		const resolved = await workerAssetReader.requestPreparedAsset(key);

		expect(resolved.payload).toMatchObject({
			defaultPaletteId: 0x04000010,
			format: "p8",
			formatRaw: 0x29,
			kind: "render-surface",
			sourceByteLength: 16,
		});
		expect(resolved.payload).not.toHaveProperty("sourceBytes");
		expect(asset.payload).toHaveProperty("sourceBytes");

		workerAssetReader.dispose();
		bridge.dispose();
	});

	it("surfaces prepared asset request failures inside the worker", async () => {
		const channel = new FixtureWorkerChannel();
		const key = createHostAssetKey("landblock-outdoor", 0xda55ffff);
		const bridge = createStaticResolverMainAssetBridge(
			channel.mainPort,
			new FixturePreparedAssetReader(new Error("asset service said no")),
		);
		const workerAssetReader = new StaticResolverWorkerPreparedAssetReader(
			channel.workerPort,
		);

		await expect(workerAssetReader.requestPreparedAsset(key)).rejects.toThrow(
			"asset service said no",
		);

		workerAssetReader.dispose();
		bridge.dispose();
	});

	it("dedupes identical prepared asset requests before crossing the worker bridge", async () => {
		const channel = new FixtureWorkerChannel();
		const key = createHostAssetKey("landblock-outdoor", 0xda55ffff);
		const assetReader = new DeferredPreparedAssetReader(
			createPreparedAsset(key),
		);
		const bridge = createStaticResolverMainAssetBridge(
			channel.mainPort,
			assetReader,
		);
		const workerAssetReader = new StaticResolverWorkerPreparedAssetReader(
			channel.workerPort,
		);
		const requestScopedReader = new RequestScopedPreparedAssetReader(
			workerAssetReader,
		);

		const first = requestScopedReader.requestPreparedAsset(key);
		const second = requestScopedReader.requestPreparedAsset(key);

		expect(channel.threadMessages).toEqual([
			{
				key,
				kind: "prepared-asset-requested",
				requestId: "resolver-asset-1",
			},
		]);
		assetReader.resolveNext();

		await expect(Promise.all([first, second])).resolves.toEqual([
			expect.objectContaining({ key }),
			expect.objectContaining({ key }),
		]);

		workerAssetReader.dispose();
		bridge.dispose();
	});

	it("rejects pending worker requests on disposal", async () => {
		const channel = new FixtureWorkerChannel();
		const key = createHostAssetKey("landblock-outdoor", 0xda55ffff);
		const bridge = createStaticResolverMainAssetBridge(
			channel.mainPort,
			new DeferredPreparedAssetReader(),
		);
		const workerAssetReader = new StaticResolverWorkerPreparedAssetReader(
			channel.workerPort,
		);
		const pending = workerAssetReader.requestPreparedAsset(key);

		workerAssetReader.dispose();

		await expect(pending).rejects.toThrow(
			"Static resolver worker asset reader was disposed.",
		);
		bridge.dispose();
	});
});

class FixtureWorkerChannel {
	readonly threadMessages: StaticResolverWorkerThreadMessage[] = [];
	readonly #mainListeners = new Set<
		(event: MessageEvent<StaticResolverWorkerThreadMessage>) => void
	>();
	readonly #workerListeners = new Set<
		(event: MessageEvent<StaticResolverWorkerMainMessage>) => void
	>();

	readonly mainPort: StaticResolverWorkerPort = {
		addEventListener: (_type, listener) => {
			this.#mainListeners.add(listener);
		},
		postMessage: (message) => {
			this.#emitWorkerMessage(message);
		},
		removeEventListener: (_type, listener) => {
			this.#mainListeners.delete(listener);
		},
	};

	readonly workerPort: StaticResolverWorkerGlobalPort = {
		addEventListener: (_type, listener) => {
			this.#workerListeners.add(listener);
		},
		postMessage: (message) => {
			this.threadMessages.push(message);
			this.#emitThreadMessage(message);
		},
		removeEventListener: (_type, listener) => {
			this.#workerListeners.delete(listener);
		},
	};

	#emitThreadMessage(message: StaticResolverWorkerThreadMessage): void {
		const event = {
			data: message,
		} as MessageEvent<StaticResolverWorkerThreadMessage>;
		for (const listener of this.#mainListeners) {
			listener(event);
		}
	}

	#emitWorkerMessage(message: StaticResolverWorkerMainMessage): void {
		const event = {
			data: message,
		} as MessageEvent<StaticResolverWorkerMainMessage>;
		for (const listener of this.#workerListeners) {
			listener(event);
		}
	}
}

class FixturePreparedAssetReader implements PreparedAssetReader {
	readonly requests: HostAssetKey[] = [];

	constructor(private readonly result: PreparedAsset | Error) {}

	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		this.requests.push(key);
		if (this.result instanceof Error) {
			return Promise.reject(this.result);
		}

		return Promise.resolve(this.result);
	}
}

class DeferredPreparedAssetReader implements PreparedAssetReader {
	#pendingResolve: ((asset: PreparedAsset) => void) | null = null;

	constructor(private readonly asset?: PreparedAsset) {}

	requestPreparedAsset(): Promise<PreparedAsset> {
		return new Promise((resolve) => {
			this.#pendingResolve = resolve;
		});
	}

	resolveNext(): void {
		if (!this.asset) {
			throw new Error("Deferred reader has no asset to resolve.");
		}
		if (!this.#pendingResolve) {
			throw new Error("No pending prepared asset request to resolve.");
		}

		this.#pendingResolve(this.asset);
		this.#pendingResolve = null;
	}
}

function createPreparedAsset(key: HostAssetKey): PreparedAsset {
	return createPreparedAssetWithPayload(key, {
		kind: "landblock-outdoor",
	});
}

function createPreparedAssetWithPayload(
	key: HostAssetKey,
	payload: PreparedAsset["payload"],
): PreparedAsset {
	return {
		key,
		payload,
		preparedAt: "2026-06-10T00:00:00.000Z",
		revision: 7,
		sourceAssetId: "landblock/da55ffff/outdoor",
	};
}
