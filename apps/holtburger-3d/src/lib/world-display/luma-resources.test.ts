import { Buffer as LumaBuffer, type Device } from "@luma.gl/core";
import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedMaterialRecipePayload,
	type PreparedPolygonSetRenderGeometry,
	type PreparedRenderSurfacePayload,
	type PreparedTerrainMesh,
} from "../assets/types";
import { createBaseMaterialAppearanceContext } from "./material-appearance";
import { WORLD_RENDER_DOMAIN } from "./render-domains";
import {
	createLumaWorldResourceStore,
	syncLumaWorldResources,
} from "./luma-resources";
import { RendererResourceGraph } from "./renderer-resource-graph";
import type { RenderChunkTransform } from "./render-anchor";
import type {
	StructuredInteriorCell,
	StructuredInteriorSceneModel,
} from "./structured-interior-scene";
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

	it("stages first-seen static geometry with chunk-local transforms and uv buffers", () => {
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
		expect(batch.id.startsWith("static-staged/")).toBe(true);
		expect(batch.uvBuffer).toBeInstanceOf(FakeBuffer);
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

	it("splits staged static geometry by material slot while preserving uv buffers", () => {
		const device = new FakeDevice();
		const store = createLumaWorldResourceStore();
		const surfaceA = 0x08000001;
		const surfaceB = 0x08000002;
		const part = createStaticPart({
			groupKey: "static/textured",
			instanceId: "instance-a",
			chunkLocalPosition: { x: 1, y: 2, z: 3 },
			materialSlots: [
				createMaterialSlot(0, surfaceA),
				createMaterialSlot(1, surfaceB),
			],
		});

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState({
				materialPairs: [
					{ materialSurfaceId: surfaceA, renderSurfaceId: 0x06000001 },
					{ materialSurfaceId: surfaceB, renderSurfaceId: 0x06000002 },
				],
				renderGeometryByAssetId: {
					"gfx-obj/01000001": createTwoSlotGfxGeometry(),
				},
			}),
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene({ parts: [part] }),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform({ x: 10, y: 20, z: 30 })],
		});

		const stagedBatches = store.batches
			.filter((batch) => batch.id.startsWith("static-staged/"))
			.sort((left, right) => left.id.localeCompare(right.id));
		expect(stagedBatches).toHaveLength(2);
		expect(stagedBatches.map((batch) => batch.triangleCount)).toEqual([1, 1]);
		expect(stagedBatches.map((batch) => batch.uvBuffer)).toEqual([
			expect.any(FakeBuffer),
			expect.any(FakeBuffer),
		]);
		expect(
			Array.from(
				(toFakeBuffer(stagedBatches[0]?.uvBuffer)?.data as Float32Array).slice(
					0,
					6,
				),
			),
		).toEqual([0, 0, 1, 0, 0, 1]);
		expect(
			Array.from(
				(toFakeBuffer(stagedBatches[1]?.uvBuffer)?.data as Float32Array).slice(
					0,
					6,
				),
			),
		).toEqual([1, 1, 2, 1, 1, 2]);
	});

	it("normalizes staged static BVH keys during assembly", () => {
		const device = new FakeDevice();
		const store = createLumaWorldResourceStore();
		const firstPart = createStaticPart({
			groupKey: "static/shared-key",
			instanceId: "instance-a",
			chunkLocalPosition: { x: 1, y: 2, z: 3 },
		});
		const duplicatePart = createStaticPart({
			gfxObjAssetId: "gfx-obj/01000002",
			gfxObjId: 0x01000002,
			groupKey: "static/shared-key",
			instanceId: "instance-a",
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
				groupKey: "static/shared-key",
				parts: [firstPart, duplicatePart],
			}),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform({ x: 10, y: 20, z: 30 })],
		});

		expect(store.batches).toHaveLength(2);
		for (const batch of store.batches) {
			expect(batch.bvhItemKeys).toEqual([...new Set(batch.bvhItemKeys)]);
		}
	});

	it("assembles staged static direct material batches and publishes graph leases", () => {
		const device = new FakeDevice();
		const store = createLumaWorldResourceStore();
		const graph = new RendererResourceGraph();
		const materialSurfaceId = 0x08000002;
		const renderSurfaceId = 0x06000002;
		const part = createStaticPart({
			groupKey: "static/textured",
			instanceId: "instance-a",
			chunkLocalPosition: { x: 1, y: 2, z: 3 },
			materialSlots: [createMaterialSlot(0, materialSurfaceId)],
		});

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState({
				materialSurfaceId,
				renderSurfaceId,
				renderGeometryByAssetId: {
					"gfx-obj/01000001": createMaterialSlotGfxGeometry(),
				},
			}),
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene({ parts: [part] }),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform({ x: 10, y: 20, z: 30 })],
			rendererResourceGraph: graph,
		});

		const batch = store.batches[0];
		expect(batch?.kind).toBe("static");
		expect(batch?.material.kind).toBe("direct-texture");
		expect(batch?.uvBuffer).toBeInstanceOf(FakeBuffer);
		expect(batch?.bindings.uTexture).toBeInstanceOf(FakeTexture);
		expect(graph.retainedPreparedAssetIds()).toEqual([
			"gfx-obj/01000001",
			"material/08000002",
			"render-surface/06000002",
		]);

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState({
				materialSurfaceId,
				renderSurfaceId,
				renderGeometryByAssetId: {
					"gfx-obj/01000001": createMaterialSlotGfxGeometry(),
				},
			}),
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene({ parts: [] }),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform({ x: 10, y: 20, z: 30 })],
			rendererResourceGraph: graph,
		});

		expect(graph.retainedPreparedAssetIds()).toEqual([]);
	});

	it("waits to stage material-slot statics until material dependencies resolve", () => {
		const device = new FakeDevice();
		const store = createLumaWorldResourceStore();
		const materialSurfaceId = 0x08000002;
		const part = createStaticPart({
			groupKey: "static/pending-material",
			instanceId: "instance-a",
			chunkLocalPosition: { x: 1, y: 2, z: 3 },
			materialSlots: [createMaterialSlot(0, materialSurfaceId)],
		});

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState({
				renderGeometryByAssetId: {
					"gfx-obj/01000001": createMaterialSlotGfxGeometry(),
				},
			}),
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene({ parts: [part] }),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform({ x: 10, y: 20, z: 30 })],
		});

		expect(store.batches).toEqual([]);

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState: createAssetState({
				materialSurfaceId,
				renderSurfaceId: 0x06000002,
				renderGeometryByAssetId: {
					"gfx-obj/01000001": createMaterialSlotGfxGeometry(),
				},
			}),
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene({ parts: [part] }),
			structuredInteriorScene: createStructuredInteriorScene(),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform({ x: 10, y: 20, z: 30 })],
		});

		expect(store.batches).toHaveLength(1);
		expect(store.batches[0]?.material.kind).toBe("direct-texture");
	});

	it("reuses staged static vertex buffers when only chunk offsets change", () => {
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
		const assetState = createAssetState({
			extraGfxObjAssetIds: ["gfx-obj/01000002"],
		});
		const sceneWithBothParts = createStaticRenderableScene({
			parts: [firstPart, secondPart],
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

		const stagedBatches = store.batches.filter((batch) =>
			batch.id.startsWith("static-staged/"),
		);
		const stagedVertexBuffers = stagedBatches.map((batch) =>
			toFakeBuffer(batch.vertexBuffer),
		);

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

		const reusedStagedBatches = store.batches.filter((batch) =>
			batch.id.startsWith("static-staged/"),
		);
		expect(reusedStagedBatches.map((batch) => batch.vertexBuffer)).toEqual(
			stagedVertexBuffers,
		);
		for (const batch of reusedStagedBatches) {
			expect(batch.modelMatrix[12]).toBe(50);
			expect(batch.modelMatrix[13]).toBe(60);
			expect(batch.modelMatrix[14]).toBe(70);
		}
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

	it("creates direct textured structured interior batches with uv buffers", () => {
		const device = new FakeDevice();
		const store = createLumaWorldResourceStore();
		const assetState = createAssetState({
			materialSurfaceId: 0x08000002,
			renderSurfaceId: 0x06000002,
		});

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			assetState,
			terrainScene: createTerrainScene({ tiles: [] }),
			staticRenderableScene: createStaticRenderableScene(),
			structuredInteriorScene: createStructuredInteriorScene({
				cells: [createStructuredInteriorCell({ surfaceId: 0x08000002 })],
			}),
			transitionPortalModel: createTransitionPortalModel(),
			renderChunkTransforms: [createChunkTransform({ x: 10, y: 20, z: 30 })],
		});

		expect(store.structuredInteriorBatchCount).toBe(1);
		const batch = store.batches[0];
		expect(batch?.kind).toBe("structured-interior");
		expect(batch?.material.kind).toBe("direct-texture");
		expect(batch?.uvBuffer).toBeInstanceOf(FakeBuffer);
		expect(batch?.bindings.uTexture).toBeInstanceOf(FakeTexture);
		expect(toFakeBuffer(batch?.uvBuffer)?.data).toBeInstanceOf(Float32Array);
		expect(
			Array.from((toFakeBuffer(batch?.uvBuffer)?.data as Float32Array).slice(0, 6)),
		).toEqual([0, 0, 1, 0, 0, 1]);
		expect(device.createdTextures).toHaveLength(1);
	});
});

class FakeDevice {
	readonly createdBuffers: FakeBuffer[] = [];
	readonly createdVertexArrays: FakeVertexArray[] = [];
	readonly createdTextures: FakeTexture[] = [];

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

	createTexture({
		id,
		format,
		width,
		height,
	}: {
		id: string;
		format: string;
		width: number;
		height: number;
	}): FakeTexture {
		const texture = new FakeTexture(id, format, width, height);
		this.createdTextures.push(texture);
		return texture;
	}

	asDevice(): Device {
		return this as unknown as Device;
	}
}

class FakeTexture {
	destroyed = false;
	data: ArrayBuffer | ArrayBufferView | null = null;

	constructor(
		readonly id: string,
		readonly format: string,
		readonly width: number,
		readonly height: number,
	) {}

	writeData(data: ArrayBuffer | ArrayBufferView): void {
		this.data = data;
	}

	generateMipmapsWebGL(): void {
		return;
	}

	destroy(): void {
		this.destroyed = true;
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

function createStructuredInteriorScene({
	cells = [],
}: {
	cells?: StructuredInteriorCell[];
} = {}): StructuredInteriorSceneModel {
	return {
		focusEnvCellId: null,
		activeEnvCellIds: cells.map((cell) => cell.envCellId),
		cells,
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
	materialSurfaceId,
	renderSurfaceId,
	materialPairs = [],
	renderGeometryByAssetId = {},
}: {
	extraGfxObjAssetIds?: string[];
	materialSurfaceId?: number;
	renderSurfaceId?: number;
	materialPairs?: readonly {
		materialSurfaceId: number;
		renderSurfaceId: number;
	}[];
	renderGeometryByAssetId?: Record<string, PreparedPolygonSetRenderGeometry>;
} = {}): AssetChannelState {
	const state = createInitialAssetChannelState();
	for (const assetId of ["gfx-obj/01000001", ...extraGfxObjAssetIds]) {
		const renderGeometry =
			renderGeometryByAssetId[assetId] ?? createStaticGfxGeometry();
		state.preparedByAssetId[assetId] = {
			payload: {
				kind: "gfx-obj",
				renderGeometry,
			},
		} as AssetChannelState["preparedAsset"];
	}
	if (materialSurfaceId !== undefined && renderSurfaceId !== undefined) {
		materialPairs = [
			...materialPairs,
			{ materialSurfaceId, renderSurfaceId },
		];
	}
	for (const pair of materialPairs) {
		const materialAssetId = `material/${pair.materialSurfaceId.toString(16).padStart(8, "0")}`;
		const renderSurfaceAssetId = `render-surface/${pair.renderSurfaceId.toString(16).padStart(8, "0")}`;
		state.preparedByAssetId[materialAssetId] = {
			payload: createTextureMaterialRecipe(
				pair.materialSurfaceId,
				pair.renderSurfaceId,
			),
		} as AssetChannelState["preparedAsset"];
		state.preparedByAssetId[renderSurfaceAssetId] = {
			payload: createRenderSurfacePayload(pair.renderSurfaceId),
		} as AssetChannelState["preparedAsset"];
	}
	return state;
}

function createStaticGfxGeometry(): PreparedPolygonSetRenderGeometry {
	return {
		sourceId: 1,
		vertexCount: 3,
		triangleCount: 1,
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		normals: [],
		uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
		triangles: [{ polygonId: 0, surfaceId: null, firstVertex: 0 }],
		surfaceIds: [],
		bounds: null,
	};
}

function createTwoSlotGfxGeometry(): PreparedPolygonSetRenderGeometry {
	return {
		sourceId: 1,
		vertexCount: 6,
		triangleCount: 2,
		positions: new Float32Array([
			0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0,
		]),
		normals: [],
		uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1, 2, 1, 1, 2]),
		triangles: [
			{ polygonId: 0, surfaceId: 0, firstVertex: 0 },
			{ polygonId: 1, surfaceId: 1, firstVertex: 3 },
		],
		surfaceIds: [0, 1],
		bounds: null,
	};
}

function createMaterialSlotGfxGeometry(): PreparedPolygonSetRenderGeometry {
	return {
		...createStaticGfxGeometry(),
		triangles: [{ polygonId: 0, surfaceId: 0, firstVertex: 0 }],
		surfaceIds: [0],
	};
}

function createStructuredInteriorCell({
	surfaceId,
}: {
	surfaceId: number;
}): StructuredInteriorCell {
	return {
		renderKey: "interior-cell/test",
		envCellId: 0x12340001,
		regionNumber: 1,
		renderChunk: {
			chunkKey: "landblock/12340000",
			chunkLandblockId: 0x12340000,
		},
		environmentId: 1,
		cellStructureId: 1,
		isFocus: true,
		chunkLocalPlacement: createPlacement({ x: 0, y: 0, z: 0 }),
		surfaceIds: [surfaceId],
		portalCount: 0,
		portals: [],
		portalApertures: [],
		staticObjectCount: 0,
		cellStructure: null,
		cellBsp: null,
		renderGeometry: createPolygonSetGeometry(surfaceId),
		debugColorKey: "interior-cell/test",
		detailSignature: "detail:none",
	};
}

function createPolygonSetGeometry(
	surfaceId: number,
): PreparedPolygonSetRenderGeometry {
	return {
		sourceId: 1,
		vertexCount: 3,
		triangleCount: 1,
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		normals: [],
		uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
		triangles: [{ polygonId: 0, surfaceId, firstVertex: 0 }],
		surfaceIds: [surfaceId],
		bounds: null,
	};
}

function createTextureMaterialRecipe(
	surfaceId: number,
	renderSurfaceId: number,
): PreparedMaterialRecipePayload {
	return {
		kind: "material-recipe",
		sourceAssetKind: "material-recipe",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "material-recipe",
			errorCode: null,
			detail: null,
		},
		surfaceId,
		surfaceType: 1,
		source: {
			kind: "texture",
			surfaceTextureId: renderSurfaceId,
			selectedRenderSurfaceId: renderSurfaceId,
			paletteId: null,
			renderSurfaceDefaultPaletteIds: [],
		},
		translucency: 0,
		luminosity: 0,
		diffuse: 1,
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [
				`render-surface/${renderSurfaceId.toString(16).padStart(8, "0")}`,
			],
			paletteAssetIds: [],
		},
	};
}

function createRenderSurfacePayload(
	renderSurfaceId: number,
): PreparedRenderSurfacePayload {
	const sourceBytes = new Uint8Array([0x10, 0x20, 0x30, 0xff]);
	return {
		kind: "render-surface",
		sourceAssetKind: "render-surface",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "render-surface",
			errorCode: null,
			detail: null,
		},
		renderSurfaceId,
		unknown: 0,
		width: 1,
		height: 1,
		formatRaw: 0x15,
		format: "A8R8G8B8",
		sourceByteLength: sourceBytes.byteLength,
		sourceBytes,
		defaultPaletteId: null,
		dependencies: { paletteAssetIds: [] },
	};
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
	materialSlots = [],
}: {
	gfxObjAssetId?: string;
	gfxObjId?: number;
	groupKey: string;
	instanceId: string;
	chunkKey?: string;
	chunkLandblockId?: number;
	renderDomain?: StaticRenderablePart["renderDomain"];
	chunkLocalPosition: { x: number; y: number; z: number };
	materialSlots?: StaticRenderablePart["materialSlots"];
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
		materialSlots,
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

function createMaterialSlot(
	slotIndex: number,
	surfaceId: number,
): StaticRenderablePart["materialSlots"][number] {
	return {
		slotIndex,
		surfaceId,
		materialAssetId: `material/${surfaceId.toString(16).padStart(8, "0")}`,
		materialVariantSignature: null,
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
