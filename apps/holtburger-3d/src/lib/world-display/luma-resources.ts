import {
	Buffer as LumaBuffer,
	type Buffer,
	type BufferLayout,
	type Device,
	type ShaderLayout,
	type VertexArray,
} from "@luma.gl/core";

import {
	buildLumaPolygonSetGeometry,
	buildLumaTerrainGeometry,
	type LumaIndexedGeometry,
} from "./luma-geometry";
import {
	buildAcPlacementMatrix,
	buildDebugColor,
	createTranslationMat4,
	multiplyMat4,
	type LumaMat4,
	type LumaVec4,
} from "./luma-math";
import type { RenderChunkTransform } from "./render-anchor";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";

export const LUMA_WORLD_SHADER_LAYOUT: ShaderLayout = {
	attributes: [{ name: "position", location: 0, type: "vec3<f32>" }],
	bindings: [],
	uniforms: [
		{ name: "uModelViewProjection", type: "mat4x4<f32>" },
		{ name: "uColor", type: "vec4<f32>" },
	],
};

export const LUMA_WORLD_BUFFER_LAYOUT: BufferLayout[] = [
	{ name: "position", format: "float32x3" },
];

interface LumaWorldDrawBatch {
	id: string;
	kind: "terrain" | "structured-interior";
	geometrySignature: string;
	vertexArray: VertexArray;
	vertexBuffer: Buffer;
	indexBuffer: Buffer;
	vertexCount: number;
	triangleCount: number;
	modelMatrix: LumaMat4;
	color: LumaVec4;
}

export interface LumaWorldResourceStore {
	batches: LumaWorldDrawBatch[];
	batchesById: Map<string, LumaWorldDrawBatch>;
	terrainBatchCount: number;
	structuredInteriorBatchCount: number;
	triangleCount: number;
}

export function createLumaWorldResourceStore(): LumaWorldResourceStore {
	return {
		batches: [],
		batchesById: new Map(),
		terrainBatchCount: 0,
		structuredInteriorBatchCount: 0,
		triangleCount: 0,
	};
}

export function syncLumaWorldResources({
	device,
	store,
	terrainScene,
	structuredInteriorScene,
	renderChunkTransforms,
}: {
	device: Device;
	store: LumaWorldResourceStore;
	terrainScene: TerrainSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	renderChunkTransforms: readonly RenderChunkTransform[];
}): void {
	const chunkOffsetByKey = new Map(
		renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform.offset,
		]),
	);
	const nextBatches: LumaWorldDrawBatch[] = [];
	const retainedBatchIds = new Set<string>();

	for (const tile of terrainScene.tiles) {
		const chunkOffset = chunkOffsetByKey.get(tile.renderChunk.chunkKey);
		if (!chunkOffset) {
			continue;
		}
		const geometry = buildLumaTerrainGeometry(tile.mesh);
		if (geometry.triangleCount === 0) {
			continue;
		}
		const modelMatrix = createTranslationMat4({
			x: chunkOffset.x + tile.chunkLocalOffset.x,
			y: chunkOffset.y + tile.chunkLocalOffset.y,
			z: chunkOffset.z + tile.chunkLocalOffset.z,
		});
		nextBatches.push(
			createOrReuseDrawBatch({
				device,
				store,
				id: `terrain/${tile.assetId}`,
				kind: "terrain",
				geometry,
				modelMatrix,
				color: buildDebugColor(`terrain/${tile.landblockId}`),
				retainedBatchIds,
			}),
		);
	}

	for (const cell of structuredInteriorScene.cells) {
		const chunkOffset = chunkOffsetByKey.get(cell.renderChunk.chunkKey);
		if (!chunkOffset) {
			continue;
		}
		const geometry = buildLumaPolygonSetGeometry(cell.renderGeometry);
		if (geometry.triangleCount === 0) {
			continue;
		}
		const chunkMatrix = createTranslationMat4(chunkOffset);
		const placementMatrix = buildAcPlacementMatrix(
			cell.chunkLocalPlacement,
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 1, z: 1 },
		);
		nextBatches.push(
			createOrReuseDrawBatch({
				device,
				store,
				id: `structured-interior/${cell.renderKey}`,
				kind: "structured-interior",
				geometry,
				modelMatrix: multiplyMat4(chunkMatrix, placementMatrix),
				color: buildDebugColor(cell.debugColorKey),
				retainedBatchIds,
			}),
		);
	}

	for (const [batchId, batch] of store.batchesById) {
		if (!retainedBatchIds.has(batchId)) {
			destroyDrawBatch(batch);
			store.batchesById.delete(batchId);
		}
	}

	store.batches = nextBatches;
	store.terrainBatchCount = store.batches.filter(
		(batch) => batch.kind === "terrain",
	).length;
	store.structuredInteriorBatchCount = store.batches.filter(
		(batch) => batch.kind === "structured-interior",
	).length;
	store.triangleCount = store.batches.reduce(
		(total, batch) => total + batch.triangleCount,
		0,
	);
}

export function destroyLumaWorldResources(store: LumaWorldResourceStore): void {
	for (const batch of store.batches) {
		destroyDrawBatch(batch);
	}
	store.batches = [];
	store.batchesById.clear();
	store.terrainBatchCount = 0;
	store.structuredInteriorBatchCount = 0;
	store.triangleCount = 0;
}

function createOrReuseDrawBatch({
	device,
	store,
	id,
	kind,
	geometry,
	modelMatrix,
	color,
	retainedBatchIds,
}: {
	device: Device;
	store: LumaWorldResourceStore;
	id: string;
	kind: LumaWorldDrawBatch["kind"];
	geometry: LumaIndexedGeometry;
	modelMatrix: LumaMat4;
	color: LumaVec4;
	retainedBatchIds: Set<string>;
}): LumaWorldDrawBatch {
	const geometrySignature = createGeometrySignature(kind, geometry);
	const previousBatch = store.batchesById.get(id);
	if (
		previousBatch &&
		previousBatch.kind === kind &&
		previousBatch.geometrySignature === geometrySignature
	) {
		previousBatch.modelMatrix = modelMatrix;
		previousBatch.color = color;
		retainedBatchIds.add(id);
		return previousBatch;
	}

	if (previousBatch) {
		destroyDrawBatch(previousBatch);
	}

	const vertexBuffer = device.createBuffer({
		id: `${id}/positions`,
		usage: LumaBuffer.VERTEX,
		data: geometry.positions,
	});
	const indexBuffer = device.createBuffer({
		id: `${id}/indices`,
		usage: LumaBuffer.INDEX,
		data: geometry.indices,
	});
	const vertexArray = device.createVertexArray({
		id: `${id}/vertex-array`,
		shaderLayout: LUMA_WORLD_SHADER_LAYOUT,
		bufferLayout: LUMA_WORLD_BUFFER_LAYOUT,
	});
	vertexArray.setBuffer(0, vertexBuffer);
	vertexArray.setIndexBuffer(indexBuffer);

	const batch = {
		id,
		kind,
		geometrySignature,
		vertexArray,
		vertexBuffer,
		indexBuffer,
		vertexCount: geometry.indices.length,
		triangleCount: geometry.triangleCount,
		modelMatrix,
		color,
	};
	store.batchesById.set(id, batch);
	retainedBatchIds.add(id);
	return batch;
}

function destroyDrawBatch(batch: LumaWorldDrawBatch): void {
	batch.vertexArray.destroy();
	batch.vertexBuffer.destroy();
	batch.indexBuffer.destroy();
}

function createGeometrySignature(
	kind: "terrain" | "structured-interior",
	geometry: LumaIndexedGeometry,
): string {
	return [
		kind,
		`v${geometry.vertexCount}`,
		`t${geometry.triangleCount}`,
		`p${hashFloat32Array(geometry.positions)}`,
		`i${hashIndexArray(geometry.indices)}`,
	].join(":");
}

function hashFloat32Array(values: Float32Array): string {
	let hash = 0x811c9dc5;
	const view = new DataView(values.buffer, values.byteOffset, values.byteLength);
	for (let byteOffset = 0; byteOffset < view.byteLength; byteOffset += 1) {
		hash ^= view.getUint8(byteOffset);
		hash = Math.imul(hash, 0x01000193);
	}
	return toUnsignedHex(hash);
}

function hashIndexArray(values: Uint16Array | Uint32Array): string {
	let hash = 0x811c9dc5;
	for (const value of values) {
		hash ^= value;
		hash = Math.imul(hash, 0x01000193);
	}
	return toUnsignedHex(hash);
}

function toUnsignedHex(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
