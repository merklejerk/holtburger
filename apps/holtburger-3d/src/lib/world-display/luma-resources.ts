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
	vertexArray: VertexArray;
	vertexBuffer: Buffer;
	vertexCount: number;
	triangleCount: number;
	modelMatrix: LumaMat4;
	color: LumaVec4;
}

export interface LumaWorldResourceStore {
	batches: LumaWorldDrawBatch[];
	terrainBatchCount: number;
	structuredInteriorBatchCount: number;
	triangleCount: number;
}

export function createLumaWorldResourceStore(): LumaWorldResourceStore {
	return {
		batches: [],
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
	destroyLumaWorldResources(store);
	const chunkOffsetByKey = new Map(
		renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform.offset,
		]),
	);

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
		store.batches.push(
			createDrawBatch({
				device,
				id: `terrain/${tile.assetId}`,
				kind: "terrain",
				geometry,
				modelMatrix,
				color: buildDebugColor(`terrain/${tile.landblockId}`),
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
		store.batches.push(
			createDrawBatch({
				device,
				id: `structured-interior/${cell.renderKey}`,
				kind: "structured-interior",
				geometry,
				modelMatrix: multiplyMat4(chunkMatrix, placementMatrix),
				color: buildDebugColor(cell.debugColorKey),
			}),
		);
	}

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
		batch.vertexArray.destroy();
		batch.vertexBuffer.destroy();
	}
	store.batches = [];
	store.terrainBatchCount = 0;
	store.structuredInteriorBatchCount = 0;
	store.triangleCount = 0;
}

function createDrawBatch({
	device,
	id,
	kind,
	geometry,
	modelMatrix,
	color,
}: {
	device: Device;
	id: string;
	kind: LumaWorldDrawBatch["kind"];
	geometry: LumaIndexedGeometry;
	modelMatrix: LumaMat4;
	color: LumaVec4;
}): LumaWorldDrawBatch {
	const expandedPositions = expandIndexedPositions(geometry);
	const vertexBuffer = device.createBuffer({
		id: `${id}/positions`,
		usage: LumaBuffer.VERTEX,
		data: expandedPositions,
	});
	const vertexArray = device.createVertexArray({
		id: `${id}/vertex-array`,
		shaderLayout: LUMA_WORLD_SHADER_LAYOUT,
		bufferLayout: LUMA_WORLD_BUFFER_LAYOUT,
	});
	vertexArray.setBuffer(0, vertexBuffer);

	return {
		id,
		kind,
		vertexArray,
		vertexBuffer,
		vertexCount: geometry.indices.length,
		triangleCount: geometry.triangleCount,
		modelMatrix,
		color,
	};
}

function expandIndexedPositions(geometry: LumaIndexedGeometry): Float32Array {
	const positions = new Float32Array(geometry.indices.length * 3);
	for (const [outputVertex, sourceVertex] of geometry.indices.entries()) {
		const sourceOffset = sourceVertex * 3;
		const outputOffset = outputVertex * 3;
		positions[outputOffset] = geometry.positions[sourceOffset];
		positions[outputOffset + 1] = geometry.positions[sourceOffset + 1];
		positions[outputOffset + 2] = geometry.positions[sourceOffset + 2];
	}
	return positions;
}
