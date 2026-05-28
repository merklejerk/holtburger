import { Buffer as LumaBuffer, type Device } from "@luma.gl/core";
import { describe, expect, it } from "vitest";

import type { PreparedTerrainMesh } from "../assets/types";
import {
	createLumaWorldResourceStore,
	syncLumaWorldResources,
} from "./luma-resources";
import type { RenderChunkTransform } from "./render-anchor";
import type { TerrainSceneModel, TerrainSceneTile } from "./terrain-scene";

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
			terrainScene: firstTerrainScene,
			structuredInteriorScene: createStructuredInteriorScene(),
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
			terrainScene: firstTerrainScene,
			structuredInteriorScene: createStructuredInteriorScene(),
			renderChunkTransforms: [createChunkTransform({ x: 30, y: 0, z: 40 })],
		});

		const reusedBatch = store.batches[0];
		expect(reusedBatch?.vertexBuffer).toBe(firstVertexBuffer);
		expect(reusedBatch?.indexBuffer).toBe(firstIndexBuffer);
		expect(reusedBatch?.vertexArray).toBe(firstVertexArray);
		expect(reusedBatch?.modelMatrix[12]).toBe(30);
		expect(reusedBatch?.modelMatrix[14]).toBe(40);
		expect(device.createdBuffers).toHaveLength(2);

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			terrainScene: createTerrainScene({
				assetId: "terrain-a",
				mesh: createQuadTerrainMesh({ height: 5 }),
			}),
			structuredInteriorScene: createStructuredInteriorScene(),
			renderChunkTransforms: transforms,
		});

		expect(store.batches[0]?.vertexBuffer).not.toBe(firstVertexBuffer);
		expect(firstVertexBuffer?.destroyed).toBe(true);
		expect(firstIndexBuffer?.destroyed).toBe(true);

		syncLumaWorldResources({
			device: device.asDevice(),
			store,
			terrainScene: createTerrainScene({ tiles: [] }),
			structuredInteriorScene: createStructuredInteriorScene(),
			renderChunkTransforms: transforms,
		});

		expect(store.batches).toEqual([]);
		expect(store.batchesById.size).toBe(0);
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
