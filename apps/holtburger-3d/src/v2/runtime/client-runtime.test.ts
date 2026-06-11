import { describe, expect, it } from "vitest";
import type {
	AssetService,
	AssetServiceSnapshot,
	HostAssetKey,
	PreparedAsset,
	PreparedAssetLease,
} from "../assets/contracts";
import type { RuntimeHost, RuntimeHostSnapshot } from "../host/contracts";
import type {
	Renderer,
	RendererSnapshot,
	RendererSnapshotListener,
	StaticResidencyDelta,
	TexturePlacementUpdate,
} from "../renderer/types";
import { StaticCoordinator } from "../static/coordinator/static-coordinator";
import type {
	PreparedTextureUseIdentity,
	StaticBakeTextureUse,
	TerrainGeometryStaticDrawUnit,
} from "../static/contracts";
import {
	DeferredStaticBakerClient,
	DeferredStaticResolverClient,
} from "../static/fake-workers";
import { createClientRuntime, type RuntimeSnapshot } from "./client-runtime";
import type { RuntimeDiagnostics } from "./diagnostics";

const silentDiagnostics: RuntimeDiagnostics = {
	warn() {},
};

describe("V2 client runtime", () => {
	it("passes manual domain coverage radii into static demand planning", () => {
		const resolver = new DeferredStaticResolverClient();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer: new FakeRenderer(),
			staticCoordinator: createImmediateStaticCoordinator({
				baker: new DeferredStaticBakerClient(),
				resolver,
			}),
		});

		runtime.requestStaticWork({
			domains: ["buildings", "terrain", "topology"],
			landblockId: "0xda55ffff",
			locationKind: "outdoor-landblock",
			lod: {
				buildings: 0,
				terrain: 1,
				topology: 0,
			},
		});

		expect(
			resolver.pendingRequests.filter(
				(request) => request.job.domain === "outdoor-terrain",
			),
		).toHaveLength(9);
		expect(
			resolver.pendingRequests.filter(
				(request) => request.job.domain === "outdoor-buildings",
			),
		).toHaveLength(1);
		expect(
			resolver.pendingRequests.filter(
				(request) => request.job.domain === "landblock-topology",
			),
		).toHaveLength(1);
		runtime.dispose();
	});

	it("forwards committed static draw units and eviction deltas to the renderer", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolverClient();
		const baker = new DeferredStaticBakerClient();
		const staticCoordinator = createImmediateStaticCoordinator({
			baker,
			resolver,
		});
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator,
		});

		runtime.requestStaticWork({
			domains: ["terrain"],
			landblockId: "0xda55ffff",
			locationKind: "outdoor-landblock",
		});
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete("1:landblock:da55ffff:outdoor-terrain", {
			drawUnits: [createTerrainDrawUnit("terrain-a", 0xdb55ffff)],
		});
		await flushPromises();

		expect(renderer.staticDeltas).toEqual([
			{
				addedDrawUnitPlacements: [
					{
						drawUnit: createTerrainDrawUnit("terrain-a", 0xdb55ffff),
						translation: [192, 0, 0],
					},
				],
				removedDrawUnitIds: [],
				revision: 1,
			},
		]);

		runtime.evictStaticWork();
		await flushPromises();

		expect(renderer.staticDeltas.at(-1)).toEqual({
			addedDrawUnitPlacements: [],
			removedDrawUnitIds: ["terrain-a"],
			revision: 2,
		});
		runtime.dispose();
	});

	it("does not add textured static draw units before texture materialization is ready", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolverClient();
		const baker = new DeferredStaticBakerClient();
		const assetService = new DeferredAssetService();
		const staticCoordinator = createImmediateStaticCoordinator({
			baker,
			resolver,
		});
		const runtime = createClientRuntime({
			assetService,
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator,
		});
		const snapshots: ReturnType<typeof runtimeSnapshotSummary>[] = [];
		const unsubscribe = runtime.subscribe((snapshot) => {
			snapshots.push(runtimeSnapshotSummary(snapshot));
		});
		const textureUse = createPreparedTextureUse();
		const drawUnit = createTerrainDrawUnit("terrain-textured", 0xda55ffff, {
			primaryTextureUseId: "terrain-textured:prepared-texture:06000010",
			textureUseIds: ["terrain-textured:prepared-texture:06000010"],
		});

		runtime.requestStaticWork({
			domains: ["terrain"],
			landblockId: "0xda55ffff",
			locationKind: "outdoor-landblock",
		});
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete("1:landblock:da55ffff:outdoor-terrain", {
			drawUnits: [drawUnit],
			textureUses: [createBakeTextureUse(drawUnit.drawUnitId, textureUse)],
		});
		await flushPromises();

		expect(renderer.staticDeltas).toEqual([]);
		expect(renderer.textureUpdates).toEqual([]);
		expect(snapshots.at(-1)?.staticMaterialization.pendingRevisions).toEqual([
			1,
		]);

		assetService.resolveNext(
			createPreparedTextureAsset(assetService.pendingKeys[0] ?? failKey()),
		);
		await flushPromises();

		expect(renderer.events).toEqual([
			"texture:1:terrain-textured",
			"static:1:terrain-textured",
		]);
		expect(snapshots.at(-1)?.staticMaterialization).toEqual({
			committedRevisions: [1],
			failed: [],
			pendingRevisions: [],
		});
		unsubscribe();
		runtime.dispose();
	});

	it("keeps failed texture materialization out of renderer residency", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolverClient();
		const baker = new DeferredStaticBakerClient();
		const assetService = new DeferredAssetService();
		const staticCoordinator = createImmediateStaticCoordinator({
			baker,
			resolver,
		});
		const runtime = createClientRuntime({
			assetService,
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator,
		});
		const snapshots: ReturnType<typeof runtimeSnapshotSummary>[] = [];
		const unsubscribe = runtime.subscribe((snapshot) => {
			snapshots.push(runtimeSnapshotSummary(snapshot));
		});
		const textureUse = createPreparedTextureUse();
		const drawUnit = createTerrainDrawUnit("terrain-textured", 0xda55ffff, {
			primaryTextureUseId: "terrain-textured:prepared-texture:06000010",
			textureUseIds: ["terrain-textured:prepared-texture:06000010"],
		});

		runtime.requestStaticWork({
			domains: ["terrain"],
			landblockId: "0xda55ffff",
			locationKind: "outdoor-landblock",
		});
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete("1:landblock:da55ffff:outdoor-terrain", {
			drawUnits: [drawUnit],
			textureUses: [createBakeTextureUse(drawUnit.drawUnitId, textureUse)],
		});
		await flushPromises();

		assetService.rejectNext(new Error("prepared texture unavailable"));
		await flushPromises();

		expect(renderer.staticDeltas).toEqual([]);
		expect(renderer.textureUpdates).toEqual([]);
		expect(snapshots.at(-1)?.staticMaterialization).toEqual({
			committedRevisions: [],
			failed: [{ message: "prepared texture unavailable", revision: 1 }],
			pendingRevisions: [],
		});
		unsubscribe();
		runtime.dispose();
	});
});

class FakeRenderer implements Renderer {
	readonly staticDeltas: StaticResidencyDelta[] = [];
	readonly textureUpdates: TexturePlacementUpdate[] = [];
	readonly events: string[] = [];
	#snapshot: RendererSnapshot = {
		backend: "webgl2",
		canvasHeight: 1,
		canvasWidth: 1,
		error: null,
		frameCount: 0,
		isRunning: true,
		renderedTriangles: 0,
		staticDrawUnits: 0,
		terrainDrawUnits: 0,
	};

	applyStaticDelta(delta: StaticResidencyDelta): void {
		this.staticDeltas.push(delta);
		this.events.push(
			`static:${delta.revision}:${delta.addedDrawUnitPlacements
				.map((placement) => placement.drawUnit.drawUnitId)
				.join(",")}`,
		);
		this.#snapshot = {
			...this.#snapshot,
			renderedTriangles: delta.addedDrawUnitPlacements.length,
			staticDrawUnits: delta.addedDrawUnitPlacements.length,
			terrainDrawUnits: delta.addedDrawUnitPlacements.length,
		};
	}

	applyDynamicDelta(): void {}
	applyTexturePlacementUpdate(update: TexturePlacementUpdate): void {
		this.textureUpdates.push(update);
		this.events.push(
			`texture:${update.revision}:${update.drawUnitBindings
				.map((binding) => binding.drawUnitId)
				.join(",")}`,
		);
	}
	applySamplerPolicyUpdate(): void {}
	updateFrameState(): void {}

	subscribe(listener: RendererSnapshotListener): () => void {
		listener(this.#snapshot);
		return () => {};
	}

	dispose(): void {
		this.#snapshot = {
			...this.#snapshot,
			isRunning: false,
		};
	}
}

class FakeRuntimeHost implements RuntimeHost {
	lookupAsset(): Promise<PreparedAsset> {
		return Promise.reject(new Error("host lookup should not run in this test"));
	}

	createSnapshot(): RuntimeHostSnapshot {
		return {
			failure: null,
			isAvailable: false,
		};
	}
}

class DeferredAssetService implements AssetService {
	readonly pendingKeys: HostAssetKey[] = [];
	readonly #pending: DeferredAssetRequest[] = [];

	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		this.pendingKeys.push(key);
		return new Promise<PreparedAsset>((resolve, reject) => {
			this.#pending.push({ reject, resolve });
		});
	}

	resolveNext(asset: PreparedAsset): void {
		const pending = this.#pending.shift();
		if (!pending) {
			throw new Error("No pending prepared asset request to resolve.");
		}
		pending.resolve(asset);
	}

	rejectNext(error: Error): void {
		const pending = this.#pending.shift();
		if (!pending) {
			throw new Error("No pending prepared asset request to reject.");
		}
		pending.reject(error);
	}

	acquirePreparedAssetLease(key: HostAssetKey): PreparedAssetLease {
		return {
			key,
			release() {},
		};
	}

	pruneExpiredWarmAssets(): void {}

	createSnapshot(): AssetServiceSnapshot {
		return {
			committed: [],
			failures: [],
			pending: this.pendingKeys.map((key, index) => ({
				key,
				revision: index + 1,
				waiterCount: 1,
			})),
		};
	}
}

interface DeferredAssetRequest {
	readonly resolve: (asset: PreparedAsset) => void;
	readonly reject: (error: Error) => void;
}

function createTerrainDrawUnit(
	drawUnitId: string,
	landblockId: number,
	options: {
		readonly primaryTextureUseId?: string | null;
		readonly textureUseIds?: readonly string[];
	} = {},
): TerrainGeometryStaticDrawUnit {
	return {
		coordinateSpace: "landblock-render-local",
		domain: "outdoor-terrain",
		drawUnitId,
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		kind: "terrain-geometry",
		landblockId,
		materialBucketKey: options.primaryTextureUseId
			? `shader:terrain-single-base-color|domain:outdoor-terrain|sampler:color-repeat-filterable|placement:0|texture:${options.primaryTextureUseId}`
			: "shader:terrain-debug-flat|domain:outdoor-terrain|sampler:none|placement:none",
		materialFamily: options.primaryTextureUseId
			? "terrain-single-base-color"
			: "terrain-debug-flat",
		primaryTextureUseId: options.primaryTextureUseId ?? null,
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
		sourceTriangleIds: ["triangle-a"],
		terrainFallbackReasons: [],
		terrainMaterialPlan: null,
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureUseIds: options.textureUseIds ?? [],
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createPreparedTextureUse(): PreparedTextureUseIdentity {
	return {
		kind: "prepared-texture-use",
		outputFormat: "rgba8",
		renderSurfaceId: 0x06000010,
		usage: "color",
	};
}

function createImmediateStaticCoordinator(options: {
	readonly baker: DeferredStaticBakerClient;
	readonly resolver: DeferredStaticResolverClient;
}): StaticCoordinator {
	return new StaticCoordinator({
		baker: options.baker,
		batching: {
			maxPayloadsPerBatch: 8,
			maxWaitMs: 0,
		},
		resolver: options.resolver,
	});
}

function createBakeTextureUse(
	drawUnitId: string,
	source: PreparedTextureUseIdentity,
): StaticBakeTextureUse {
	return {
		domain: "outdoor-terrain",
		ownerDrawUnitIds: [drawUnitId],
		source,
		staticBatchId: "batch-a",
		textureUseId: `${drawUnitId}:prepared-texture:${source.renderSurfaceId
			.toString(16)
			.padStart(8, "0")}`,
	};
}

function createPreparedTextureAsset(key: HostAssetKey): PreparedAsset {
	const bytes = new Uint8Array([
		255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
	]);

	return {
		key,
		payload: {
			colorSpace: "linear",
			dependencies: {
				renderSurfaceAssetIds: ["render-surface/06000010"],
			},
			diagnostics: {
				decodeMs: 0,
				downsampleMs: 0,
				encodeMs: 0,
				generatedByteLength: bytes.byteLength,
				generatedLevelCount: 1,
				totalMs: 0,
			},
			kind: "prepared-texture",
			levels: [
				{
					byteLength: bytes.byteLength,
					bytes,
					format: "A8R8G8B8",
					formatRaw: 0,
					height: 2,
					level: 0,
					width: 2,
				},
			],
			mipPolicy: "none",
			outputFormat: "rgba8",
			provenance: {
				detail: null,
				errorCode: null,
				source: "generated-fallback",
				sourceAssetKind: "prepared-texture",
			},
			renderSurfaceId: 0x06000010,
			residencyKind: "unknown",
			sourceAssetKind: "prepared-texture",
			sourceByteLength: bytes.byteLength,
			sourceFormat: "A8R8G8B8",
			sourceFormatRaw: 0,
			sourceHash: "hash",
			sourceHeight: 2,
			sourceWidth: 2,
			usage: "color",
		},
		preparedAt: "2026-06-11T00:00:00.000Z",
		revision: 1,
		sourceAssetId: "prepared-texture/06000010",
	};
}

function runtimeSnapshotSummary(
	snapshot: RuntimeSnapshot,
): Pick<RuntimeSnapshot, "staticMaterialization" | "status"> {
	return {
		staticMaterialization: snapshot.staticMaterialization,
		status: snapshot.status,
	};
}

function failKey(): never {
	throw new Error("Expected a pending prepared asset key.");
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}
