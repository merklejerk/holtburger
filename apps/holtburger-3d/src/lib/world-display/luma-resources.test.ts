import { Buffer as LumaBuffer, type Device } from "@luma.gl/core";
import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedTerrainMesh,
} from "../assets/types";
import { createBaseMaterialAppearanceContext } from "./material-appearance";
import { WORLD_RENDER_DOMAIN } from "./render-domains";
import {
	createLumaWorldResourceStore,
	syncLumaWorldResources,
} from "./luma-resources";
import type { RenderChunkTransform } from "./render-anchor";
import type {
	StaticRenderablePart,
	StaticRenderableSceneModel,
} from "./static-renderables";
import type { TerrainSceneModel, TerrainSceneTile } from "./terrain-scene";
import type { TransitionPortalCandidateModel } from "./transition-portal-work-items";

describe("syncLumaWorldResources", () => {
	it("uploads indexed geometry and reuses unchanged batch resources", () => {
		const device = new FakeDevice();
		const store = createLumaWorldResourceStore();
		const firstTerrainScene = createTerrainScene({
			assetId: "terrain-a",
			mesh: createQuadTerrainMesh(),
		});
		const transforms = [createChunkTransform({ x: 10, y: 0, z: 20 })];

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState(),
			terrainScene: firstTerrainScene,
			staticRenderableScene: createStaticRenderableScene(),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: transforms,
		});

		const firstBatch = store.batches[0];
		const firstBatchVertexBuffer = toFakeBuffer(firstBatch?.vertexBuffer);
		const firstBatchIndexBuffer = toFakeBuffer(firstBatch?.indexBuffer);
		expect(firstBatch?.vertexCount).toBe(6);
		expect(firstBatch?.triangleCount).toBe(2);
		expect(firstBatchVertexBuffer?.data).toHaveLength(12);
		expect(firstBatchIndexBuffer?.usage).toBe(LumaBuffer.INDEX);
		expect(firstBatch?.vertexArray.indexBuffer).toBe(firstBatch?.indexBuffer);
		expect(device.createdBuffers).toHaveLength(2);

		const firstVertexBuffer = firstBatchVertexBuffer;
		const firstIndexBuffer = firstBatchIndexBuffer;
		const firstVertexArray = firstBatch?.vertexArray;

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState(),
			terrainScene: firstTerrainScene,
			staticRenderableScene: createStaticRenderableScene(),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform({ x: 30, y: 0, z: 40 })],
		});

		const reusedBatch = store.batches[0];
		expect(reusedBatch?.vertexBuffer).toBe(firstVertexBuffer);
		expect(reusedBatch?.indexBuffer).toBe(firstIndexBuffer);
		expect(reusedBatch?.vertexArray).toBe(firstVertexArray);
		expect(reusedBatch?.drawMode).toBe("indexed");
		if (reusedBatch?.drawMode === "indexed") {
			expect(reusedBatch.modelMatrix[12]).toBe(30);
			expect(reusedBatch.modelMatrix[14]).toBe(40);
		}
		expect(device.createdBuffers).toHaveLength(2);

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene({
				assetId: "terrain-a",
				mesh: createQuadTerrainMesh({ height: 5 }),
			}),
			staticRenderableScene: createStaticRenderableScene(),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: transforms,
		});

		expect(store.batches[0]?.vertexBuffer).not.toBe(firstVertexBuffer);
		expect(firstVertexBuffer?.destroyed).toBe(true);
		expect(firstIndexBuffer?.destroyed).toBe(true);

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene(),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: transforms,
		});

		expect(store.batches).toEqual([]);
		expect(store.batchesById.size).toBe(0);
	});

	it("uploads baked chunk-local static geometry without instance buffers", () => {
		const device = new FakeDevice();
		const store = createLumaWorldResourceStore();
		const part = createStaticPart({
			groupKey: "static/group-a",
			instanceId: "instance-a",
			chunkLocalPosition: { x: 1, y: 2, z: 3 },
		});
		const firstTransform = createChunkTransform({ x: 10, y: 20, z: 30 });

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene({
				groupKey: "static/group-a",
				parts: [part],
			}),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [firstTransform],
		});

		const batch = store.batches[0];
		expect(batch?.drawMode).toBe("indexed");
		if (!batch) {
			throw new Error("expected a baked static batch");
		}
		expect(batch.kind).toBe("static");
		expect(batch.vertexCount).toBe(3);
		expect(store.staticBatchCount).toBe(1);
		expect(store.staticInstanceCount).toBe(1);
		expect(batch.vertexArray.buffers.get(1)).toBeUndefined();
		expect(batch.modelMatrix[12]).toBe(10);
		expect(batch.modelMatrix[13]).toBe(20);
		expect(batch.modelMatrix[14]).toBe(30);
		const vertexBuffer = toFakeBuffer(batch.vertexBuffer);
		expect(vertexBuffer?.data).toBeInstanceOf(Float32Array);
		const positions = vertexBuffer?.data as Float32Array | undefined;
		expect(Array.from(positions?.slice(0, 3) ?? [])).toEqual([1, 3, -2]);

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene({
				groupKey: "static/group-a",
				parts: [part],
			}),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform({ x: 50, y: 60, z: 70 })],
		});

		const reusedBatch = store.batches[0];
		expect(reusedBatch?.vertexBuffer).toBe(vertexBuffer);
		expect(reusedBatch?.modelMatrix[12]).toBe(50);
		expect(Array.from(positions?.slice(0, 3) ?? [])).toEqual([1, 3, -2]);
	});

	it("groups baked static geometry across gfx objects by chunk domain and render state", () => {
		const device = new FakeDevice();
		const store = createLumaWorldResourceStore();
		const firstPart = createStaticPart({
			groupKey: "static/first",
			instanceId: "instance-a",
			chunkLocalPosition: { x: 1, y: 2, z: 3 },
		});
		const secondPart = createStaticPart({
			gfxObjAssetId: "gfx-obj/01000002",
			gfxObjId: 0x01000002,
			groupKey: "static/second",
			instanceId: "instance-b",
			chunkLocalPosition: { x: 4, y: 5, z: 6 },
		});

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState({
				extraGfxObjAssetIds: ["gfx-obj/01000002"],
			}),
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene({
				parts: [firstPart, secondPart],
			}),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform({ x: 10, y: 20, z: 30 })],
		});

		expect(store.staticBatchCount).toBe(1);
		expect(store.staticInstanceCount).toBe(2);
		const batch = store.batches[0];
		expect(batch?.kind).toBe("static");
		expect(batch?.vertexCount).toBe(6);
		expect(batch?.triangleCount).toBe(2);
	});

	it("stages newly committed static objects without rebuilding an existing promoted batch", () => {
		const device = new FakeDevice();
		const store = createLumaWorldResourceStore();
		const promotedPart = createStaticPart({
			groupKey: "static/promoted",
			instanceId: "instance-a",
			chunkLocalPosition: { x: 1, y: 2, z: 3 },
		});
		const stagedPart = createStaticPart({
			gfxObjAssetId: "gfx-obj/01000002",
			gfxObjId: 0x01000002,
			groupKey: "static/staged",
			instanceId: "instance-b",
			chunkLocalPosition: { x: 4, y: 5, z: 6 },
		});
		const firstTransform = createChunkTransform({ x: 10, y: 20, z: 30 });

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState({
				extraGfxObjAssetIds: ["gfx-obj/01000002"],
			}),
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene({
				parts: [promotedPart],
			}),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [firstTransform],
		});

		const promotedBatch = store.batches.find((batch) =>
			batch.id.startsWith("static-promoted/"),
		);
		const promotedVertexBuffer = toFakeBuffer(promotedBatch?.vertexBuffer);
		expect(promotedBatch?.vertexCount).toBe(3);
		expect(store.promotedStaticBatchCount).toBe(1);
		expect(store.stagedStaticObjectCount).toBe(0);

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState({
				extraGfxObjAssetIds: ["gfx-obj/01000002"],
			}),
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene({
				parts: [promotedPart, stagedPart],
			}),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [firstTransform],
		});

		const reusedPromotedBatch = store.batches.find((batch) =>
			batch.id.startsWith("static-promoted/"),
		);
		const stagedBatch = store.batches.find((batch) =>
			batch.id.startsWith("static-staged/"),
		);
		expect(reusedPromotedBatch?.vertexBuffer).toBe(promotedVertexBuffer);
		expect(reusedPromotedBatch?.staticPartCount).toBe(1);
		expect(stagedBatch?.drawMode).toBe("indexed");
		expect(stagedBatch?.kind).toBe("static");
		expect(stagedBatch?.staticPartCount).toBe(1);
		expect(store.promotedStaticBatchCount).toBe(1);
		expect(store.stagedStaticObjectCount).toBe(1);
		expect(store.stagedStaticPartCount).toBe(1);
		expect(store.staticPromotionCount).toBe(0);
	});

	it("promotes staged static objects when the promotion threshold is reached", () => {
		const device = new FakeDevice();
		const store = createLumaWorldResourceStore();
		const firstPart = createStaticPart({
			groupKey: "static/first",
			instanceId: "instance-a",
			chunkLocalPosition: { x: 1, y: 2, z: 3 },
		});
		const secondPart = createStaticPart({
			gfxObjAssetId: "gfx-obj/01000002",
			gfxObjId: 0x01000002,
			groupKey: "static/second",
			instanceId: "instance-b",
			chunkLocalPosition: { x: 4, y: 5, z: 6 },
		});
		const transform = createChunkTransform({ x: 10, y: 20, z: 30 });

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState({
				extraGfxObjAssetIds: ["gfx-obj/01000002"],
			}),
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene({ parts: [firstPart] }),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [transform],
		});

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState({
				extraGfxObjAssetIds: ["gfx-obj/01000002"],
			}),
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene({
				parts: [firstPart, secondPart],
			}),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [transform],
			staticPromotionPolicy: { stagedObjectPromotionThreshold: 1 },
		});

		const promotedBatch = store.batches.find((batch) =>
			batch.id.startsWith("static-promoted/"),
		);
		expect(promotedBatch?.staticPartCount).toBe(2);
		expect(promotedBatch?.vertexCount).toBe(6);
		expect(store.promotedStaticBatchCount).toBe(1);
		expect(store.stagedStaticObjectCount).toBe(0);
		expect(store.stagedStaticPartCount).toBe(0);
		expect(store.staticPromotionCount).toBe(1);
		expect(
			store.batches.some((batch) => batch.id.startsWith("static-staged/")),
		).toBe(false);
	});

	it("reuses promoted and staged static vertex buffers when only chunk offsets change", () => {
		const device = new FakeDevice();
		const store = createLumaWorldResourceStore();
		const promotedPart = createStaticPart({
			groupKey: "static/promoted",
			instanceId: "instance-a",
			chunkLocalPosition: { x: 1, y: 2, z: 3 },
		});
		const stagedPart = createStaticPart({
			gfxObjAssetId: "gfx-obj/01000002",
			gfxObjId: 0x01000002,
			groupKey: "static/staged",
			instanceId: "instance-b",
			chunkLocalPosition: { x: 4, y: 5, z: 6 },
		});
		const assetState = createAssetState({
			extraGfxObjAssetIds: ["gfx-obj/01000002"],
		});
		const sceneWithBothParts = createStaticRenderableScene({
			parts: [promotedPart, stagedPart],
		});

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState,
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene({ parts: [promotedPart] }),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform({ x: 10, y: 20, z: 30 })],
		});
		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState,
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: sceneWithBothParts,
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform({ x: 10, y: 20, z: 30 })],
		});

		const promotedBatch = store.batches.find((batch) =>
			batch.id.startsWith("static-promoted/"),
		);
		const stagedBatch = store.batches.find((batch) =>
			batch.id.startsWith("static-staged/"),
		);
		const promotedVertexBuffer = toFakeBuffer(promotedBatch?.vertexBuffer);
		const stagedVertexBuffer = toFakeBuffer(stagedBatch?.vertexBuffer);

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState,
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: sceneWithBothParts,
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform({ x: 50, y: 60, z: 70 })],
		});

		const reusedPromotedBatch = store.batches.find((batch) =>
			batch.id.startsWith("static-promoted/"),
		);
		const reusedStagedBatch = store.batches.find((batch) =>
			batch.id.startsWith("static-staged/"),
		);
		expect(reusedPromotedBatch?.vertexBuffer).toBe(promotedVertexBuffer);
		expect(reusedStagedBatch?.vertexBuffer).toBe(stagedVertexBuffer);
		expect(reusedPromotedBatch?.modelMatrix[12]).toBe(50);
		expect(reusedPromotedBatch?.modelMatrix[13]).toBe(60);
		expect(reusedPromotedBatch?.modelMatrix[14]).toBe(70);
		expect(reusedStagedBatch?.modelMatrix[12]).toBe(50);
		expect(reusedStagedBatch?.modelMatrix[13]).toBe(60);
		expect(reusedStagedBatch?.modelMatrix[14]).toBe(70);
	});

	it("splits baked static batches by chunk and render domain", () => {
		const device = new FakeDevice();
		const store = createLumaWorldResourceStore();
		const exteriorPart = createStaticPart({
			groupKey: "static/exterior",
			instanceId: "instance-a",
			chunkLocalPosition: { x: 1, y: 2, z: 3 },
		});
		const indoorPart = createStaticPart({
			groupKey: "static/interior",
			instanceId: "instance-b",
			chunkKey: "landblock/12350000",
			chunkLandblockId: 0x12350000,
			renderDomain: WORLD_RENDER_DOMAIN.interiorStatic,
			chunkLocalPosition: { x: 4, y: 5, z: 6 },
		});

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState(),
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene({
				parts: [exteriorPart, indoorPart],
			}),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [
				createChunkTransform({ x: 10, y: 20, z: 30 }),
				createChunkTransform(
					{ x: 40, y: 50, z: 60 },
					{ chunkKey: "landblock/12350000", chunkLandblockId: 0x12350000 },
				),
			],
		});

		expect(store.staticBatchCount).toBe(2);
		expect(store.batches.filter((batch) => batch.kind === "static")).toHaveLength(
			2,
		);
	});
});

class FakeDevice {
	readonly createdBuffers: FakeBuffer[] = [];
	readonly createdVertexArrays: FakeVertexArray[] = [];

	createBuffer({
		id,
		usage,
		data,
	}: {
		id: string;
		usage: number;
		data: ArrayBufferView;
	}): FakeBuffer {
		const buffer = new FakeBuffer(id, usage, data);
		this.createdBuffers.push(buffer);
		return buffer;
	}

	createVertexArray({ id }: { id: string }): FakeVertexArray {
		const vertexArray = new FakeVertexArray(id);
		this.createdVertexArrays.push(vertexArray);
		return vertexArray;
	}

	asDevice(): Device {
		return this as unknown as Device;
	}
}

class FakeBuffer {
	destroyed = false;

	constructor(
		readonly id: string,
		readonly usage: number,
		readonly data: ArrayBufferView,
	) {}

	destroy(): void {
		this.destroyed = true;
	}
}

class FakeVertexArray {
	readonly buffers = new Map<number, FakeBuffer | null>();
	indexBuffer: FakeBuffer | null = null;
	destroyed = false;

	constructor(readonly id: string) {}

	setBuffer(bufferSlot: number, buffer: FakeBuffer | null): void {
		this.buffers.set(bufferSlot, buffer);
	}

	setIndexBuffer(indexBuffer: FakeBuffer | null): void {
		this.indexBuffer = indexBuffer;
	}

	destroy(): void {
		this.destroyed = true;
	}
}

function createTerrainScene({
	assetId = "terrain-a",
	mesh = createQuadTerrainMesh(),
	tiles,
}: {
	assetId?: string;
	mesh?: PreparedTerrainMesh;
	tiles?: TerrainSceneTile[];
} = {}): TerrainSceneModel {
	return {
		focusLandblockId: 0x12340000,
		statusText: "test terrain",
		cacheText: "test cache",
		dataSourceText: "test source",
		tiles:
			tiles ??
			[
				{
					assetId,
					landblockId: 0x12340000,
					renderChunk: {
						chunkKey: "landblock/12340000",
						chunkLandblockId: 0x12340000,
					},
					label: "test",
					isFocus: true,
					chunkLocalOffset: { x: 0, y: 0, z: 0 },
					mesh,
					materialResources:
						null as unknown as TerrainSceneTile["materialResources"],
					dataSource: "unknown",
				},
			],
	};
}

function createStructuredInteriorScene() {
	return {
		focusEnvCellId: null,
		activeEnvCellIds: [],
		cells: [],
		missingEnvCellAssetIds: [],
		missingInteriorGeometryAssetIds: [],
		missingCellStructureKeys: [],
		statusText: "test interiors",
		cacheText: "test cache",
	};
}

function createTransitionPortalModel(): TransitionPortalCandidateModel {
	return {
		candidates: [],
		diagnostics: {
			loadedEnvCellPortalFactCount: 0,
			topologyPortalCount: 0,
			linkedTopologyPortalCount: 0,
			apertureCandidateCount: 0,
			workItemCandidateCount: 0,
			skippedMissingApertureCount: 0,
			skippedMissingPolygonCount: 0,
			truncatedInteriorGroupCount: 0,
		},
	};
}

function createStaticRenderableScene({
	groupKey,
	parts = [],
}: {
	groupKey?: string;
	parts?: StaticRenderablePart[];
} = {}): StaticRenderableSceneModel {
	return {
		focusLandblockId: null,
		activeLandblockIds: [],
		sourceInstances: [],
		parts,
		partsByRenderGroupKey: groupKey
			? new Map([[groupKey, parts]])
			: new Map(),
		missingSourceAssetIds: [],
		missingGfxAssetIds: [],
		missingSetupAppearanceAssetIds: [],
	};
}

function createAssetState({
	extraGfxObjAssetIds = [],
}: {
	extraGfxObjAssetIds?: string[];
} = {}): AssetChannelState {
	const state = createInitialAssetChannelState();
	for (const assetId of ["gfx-obj/01000001", ...extraGfxObjAssetIds]) {
		state.preparedByAssetId[assetId] = {
			payload: {
				kind: "gfx-obj",
				renderGeometry: {
					sourceId: 1,
					vertexCount: 3,
					triangleCount: 1,
					positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
					normals: [],
					uvs: [],
					triangles: [{ polygonId: 0, surfaceId: null, firstVertex: 0 }],
					surfaceIds: [],
					bounds: null,
				},
			},
		} as AssetChannelState["preparedAsset"];
	}
	return state;
}

function createStaticPart({
	gfxObjAssetId = "gfx-obj/01000001",
	gfxObjId = 0x01000001,
	groupKey,
	instanceId,
	chunkKey = "landblock/12340000",
	chunkLandblockId = 0x12340000,
	renderDomain = WORLD_RENDER_DOMAIN.exteriorStatic,
	chunkLocalPosition,
}: {
	gfxObjAssetId?: string;
	gfxObjId?: number;
	groupKey: string;
	instanceId: string;
	chunkKey?: string;
	chunkLandblockId?: number;
	renderDomain?: StaticRenderablePart["renderDomain"];
	chunkLocalPosition: { x: number; y: number; z: number };
}): StaticRenderablePart {
	return {
		renderKey: groupKey,
		renderDomain,
		instanceId,
		sourceAssetId: gfxObjAssetId,
		sourceDid: gfxObjId,
		owningLandblockId: chunkLandblockId,
		regionNumber: 1,
		owningEnvCellId: null,
		renderChunk: {
			chunkKey,
			chunkLandblockId,
		},
		kind: "scenery",
		partIndex: 0,
		gfxObjId,
		gfxObjAssetId,
		materialAppearanceContext: createBaseMaterialAppearanceContext("base"),
		materialSlots: [],
		materialSignature: "base",
		parentPlacements: [],
		chunkLocalInstancePlacement: createPlacement(chunkLocalPosition),
		partPlacements: [],
		scale: { x: 1, y: 1, z: 1 },
		debugColorKey: instanceId,
		textureVelocity: null,
		textureVelocitySignature: "uv:none",
		detailRoleKind: "scenery",
		detailSignature: "detail:none",
	};
}

function createPlacement(origin: { x: number; y: number; z: number }) {
	return {
		origin,
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}

function toFakeBuffer(buffer: unknown): FakeBuffer | undefined {
	return buffer instanceof FakeBuffer ? buffer : undefined;
}

function createChunkTransform(
	offset: RenderChunkTransform["offset"],
	{
		chunkKey = "landblock/12340000",
		chunkLandblockId = 0x12340000,
	}: { chunkKey?: string; chunkLandblockId?: number } = {},
): RenderChunkTransform {
	return {
		chunkKey,
		chunkLandblockId,
		offset,
	};
}

function createQuadTerrainMesh({
	height = 0,
}: { height?: number } = {}): PreparedTerrainMesh {
	return {
		landblockId: 0x12340000,
		gridSize: 2,
		tileSize: 24,
		vertices: [
			{ x: 0, y: 0, z: height },
			{ x: 1, y: 0, z: height },
			{ x: 1, y: 1, z: height },
			{ x: 0, y: 1, z: height },
		],
		triangles: [
			createTerrainTriangle(0, 0, 1, 2),
			createTerrainTriangle(1, 0, 2, 3),
		],
		quads: [],
		minHeight: height,
		maxHeight: height,
	};
}

function createTerrainTriangle(
	quadIndex: number,
	a: number,
	b: number,
	c: number,
) {
	return {
		a,
		b,
		c,
		quadIndex,
		triangleInQuad: 0,
		debugTerrainPcode: 0,
		averageHeight: 0,
	};
}
