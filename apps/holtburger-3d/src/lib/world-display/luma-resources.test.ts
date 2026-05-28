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

	it("uploads instanced static geometry with chunk-relative instance matrices", () => {
		const device = new FakeDevice();
		const store = createLumaWorldResourceStore();
		const part = createStaticPart({
			groupKey: "static/group-a",
			instanceId: "instance-a",
			chunkLocalPosition: { x: 1, y: 2, z: 3 },
		});

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
			renderChunkTransforms: [createChunkTransform({ x: 10, y: 20, z: 30 })],
		});

		const batch = store.batches[0];
		expect(batch?.drawMode).toBe("instanced");
		if (batch?.drawMode !== "instanced") {
			throw new Error("expected an instanced static batch");
		}
		const instanceBuffer = toFakeBuffer(batch.instanceBuffer);
		expect(batch.kind).toBe("static");
		expect(batch.instanceCount).toBe(1);
		expect(batch.vertexCount).toBe(3);
		expect(store.staticBatchCount).toBe(1);
		expect(store.staticInstanceCount).toBe(1);
		expect(instanceBuffer?.data).toHaveLength(16);
		expect(batch.vertexArray.buffers.get(1)).toBe(batch.instanceBuffer);
		expect(batch.vertexArray.buffers.get(4)).toBe(batch.instanceBuffer);
		expect(instanceBuffer?.data[12]).toBe(11);
		expect(instanceBuffer?.data[13]).toBe(23);
		expect(instanceBuffer?.data[14]).toBe(28);
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

function createAssetState(): AssetChannelState {
	const state = createInitialAssetChannelState();
	state.preparedByAssetId["gfx-obj/01000001"] = {
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
	return state;
}

function createStaticPart({
	groupKey,
	instanceId,
	chunkLocalPosition,
}: {
	groupKey: string;
	instanceId: string;
	chunkLocalPosition: { x: number; y: number; z: number };
}): StaticRenderablePart {
	return {
		renderKey: groupKey,
		renderDomain: WORLD_RENDER_DOMAIN.exteriorStatic,
		instanceId,
		sourceAssetId: "gfx-obj/01000001",
		sourceDid: 0x01000001,
		owningLandblockId: 0x12340000,
		regionNumber: 1,
		owningEnvCellId: null,
		renderChunk: {
			chunkKey: "landblock/12340000",
			chunkLandblockId: 0x12340000,
		},
		kind: "scenery",
		partIndex: 0,
		gfxObjId: 0x01000001,
		gfxObjAssetId: "gfx-obj/01000001",
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
): RenderChunkTransform {
	return {
		chunkKey: "landblock/12340000",
		chunkLandblockId: 0x12340000,
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
