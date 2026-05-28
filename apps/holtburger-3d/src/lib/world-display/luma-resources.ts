import {
	Buffer as LumaBuffer,
	type Buffer,
	type BufferLayout,
	type Device,
	type ShaderLayout,
	type VertexArray,
} from "@luma.gl/core";

import type { AssetChannelState } from "../assets/types";
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
import type {
	StaticRenderablePart,
	StaticRenderableSceneModel,
} from "./static-renderables";
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

export const LUMA_STATIC_SHADER_LAYOUT: ShaderLayout = {
	attributes: [
		{ name: "position", location: 0, type: "vec3<f32>" },
		{ name: "instanceModel0", location: 1, type: "vec4<f32>" },
		{ name: "instanceModel1", location: 2, type: "vec4<f32>" },
		{ name: "instanceModel2", location: 3, type: "vec4<f32>" },
		{ name: "instanceModel3", location: 4, type: "vec4<f32>" },
	],
	bindings: [],
	uniforms: [
		{ name: "uViewProjection", type: "mat4x4<f32>" },
		{ name: "uColor", type: "vec4<f32>" },
	],
};

export const LUMA_STATIC_BUFFER_LAYOUT: BufferLayout[] = [
	{ name: "position", format: "float32x3" },
	{
		name: "instanceModel",
		stepMode: "instance",
		byteStride: 64,
		attributes: [
			{ attribute: "instanceModel0", format: "float32x4", byteOffset: 0 },
			{ attribute: "instanceModel1", format: "float32x4", byteOffset: 16 },
			{ attribute: "instanceModel2", format: "float32x4", byteOffset: 32 },
			{ attribute: "instanceModel3", format: "float32x4", byteOffset: 48 },
		],
	},
];

type LumaWorldDrawBatch = LumaIndexedDrawBatch | LumaInstancedDrawBatch;

interface LumaBaseDrawBatch {
	id: string;
	kind: "terrain" | "structured-interior" | "static";
	geometrySignature: string;
	vertexArray: VertexArray;
	vertexBuffer: Buffer;
	indexBuffer: Buffer;
	vertexCount: number;
	triangleCount: number;
	color: LumaVec4;
}

interface LumaIndexedDrawBatch extends LumaBaseDrawBatch {
	drawMode: "indexed";
	kind: "terrain" | "structured-interior";
	modelMatrix: LumaMat4;
}

interface LumaInstancedDrawBatch extends LumaBaseDrawBatch {
	drawMode: "instanced";
	kind: "static";
	instanceBuffer: Buffer;
	instanceCount: number;
	instanceSignature: string;
}

export interface LumaWorldResourceStore {
	batches: LumaWorldDrawBatch[];
	batchesById: Map<string, LumaWorldDrawBatch>;
	terrainBatchCount: number;
	structuredInteriorBatchCount: number;
	staticBatchCount: number;
	staticInstanceCount: number;
	triangleCount: number;
}

export function createLumaWorldResourceStore(): LumaWorldResourceStore {
	return {
		batches: [],
		batchesById: new Map(),
		terrainBatchCount: 0,
		structuredInteriorBatchCount: 0,
		staticBatchCount: 0,
		staticInstanceCount: 0,
		triangleCount: 0,
	};
}

export function syncLumaWorldResources({
	device,
	store,
	assetState,
	terrainScene,
	staticRenderableScene,
	structuredInteriorScene,
	renderChunkTransforms,
}: {
	device: Device;
	store: LumaWorldResourceStore;
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
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
				shaderLayout: LUMA_WORLD_SHADER_LAYOUT,
				bufferLayout: LUMA_WORLD_BUFFER_LAYOUT,
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
				shaderLayout: LUMA_WORLD_SHADER_LAYOUT,
				bufferLayout: LUMA_WORLD_BUFFER_LAYOUT,
				retainedBatchIds,
			}),
		);
	}

	for (const [groupKey, parts] of staticRenderableScene.partsByRenderGroupKey) {
		const firstPart = parts[0];
		if (!firstPart) {
			continue;
		}
		const chunkOffset = chunkOffsetByKey.get(firstPart.renderChunk.chunkKey);
		if (!chunkOffset) {
			continue;
		}
		const asset = assetState.preparedByAssetId[firstPart.gfxObjAssetId];
		if (
			!asset ||
			asset.payload.kind !== "gfx-obj" ||
			asset.payload.renderGeometry.vertexCount === 0
		) {
			continue;
		}
		const geometry = buildLumaPolygonSetGeometry(asset.payload.renderGeometry);
		if (geometry.triangleCount === 0) {
			continue;
		}

		nextBatches.push(
			createOrReuseInstancedDrawBatch({
				device,
				store,
				id: `static/${groupKey}`,
				geometry,
				instanceMatrices: buildStaticInstanceMatrices(parts, chunkOffset),
				instanceCount: parts.length,
				color: buildDebugColor(`static/${groupKey}`),
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
	store.staticBatchCount = store.batches.filter(
		(batch) => batch.kind === "static",
	).length;
	store.staticInstanceCount = store.batches.reduce(
		(total, batch) =>
			batch.drawMode === "instanced" ? total + batch.instanceCount : total,
		0,
	);
	store.triangleCount = store.batches.reduce(
		(total, batch) =>
			total +
			batch.triangleCount *
				(batch.drawMode === "instanced" ? batch.instanceCount : 1),
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
	store.staticBatchCount = 0;
	store.staticInstanceCount = 0;
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
	shaderLayout,
	bufferLayout,
	retainedBatchIds,
}: {
	device: Device;
	store: LumaWorldResourceStore;
	id: string;
	kind: LumaIndexedDrawBatch["kind"];
	geometry: LumaIndexedGeometry;
	modelMatrix: LumaMat4;
	color: LumaVec4;
	shaderLayout: ShaderLayout;
	bufferLayout: BufferLayout[];
	retainedBatchIds: Set<string>;
}): LumaIndexedDrawBatch {
	const geometrySignature = createGeometrySignature(kind, geometry);
	const previousBatch = store.batchesById.get(id);
	if (
		previousBatch &&
		previousBatch.drawMode === "indexed" &&
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
		shaderLayout,
		bufferLayout,
	});
	vertexArray.setBuffer(0, vertexBuffer);
	vertexArray.setIndexBuffer(indexBuffer);

	const batch = {
		id,
		drawMode: "indexed",
		kind,
		geometrySignature,
		vertexArray,
		vertexBuffer,
		indexBuffer,
		vertexCount: geometry.indices.length,
		triangleCount: geometry.triangleCount,
		modelMatrix,
		color,
	} satisfies LumaIndexedDrawBatch;
	store.batchesById.set(id, batch);
	retainedBatchIds.add(id);
	return batch;
}

function createOrReuseInstancedDrawBatch({
	device,
	store,
	id,
	geometry,
	instanceMatrices,
	instanceCount,
	color,
	retainedBatchIds,
}: {
	device: Device;
	store: LumaWorldResourceStore;
	id: string;
	geometry: LumaIndexedGeometry;
	instanceMatrices: Float32Array;
	instanceCount: number;
	color: LumaVec4;
	retainedBatchIds: Set<string>;
}): LumaInstancedDrawBatch {
	const geometrySignature = createGeometrySignature("static", geometry);
	const instanceSignature = hashFloat32Array(instanceMatrices);
	const previousBatch = store.batchesById.get(id);
	if (
		previousBatch &&
		previousBatch.drawMode === "instanced" &&
		previousBatch.geometrySignature === geometrySignature &&
		previousBatch.instanceSignature === instanceSignature
	) {
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
	const instanceBuffer = device.createBuffer({
		id: `${id}/instances`,
		usage: LumaBuffer.VERTEX,
		data: instanceMatrices,
	});
	const vertexArray = device.createVertexArray({
		id: `${id}/vertex-array`,
		shaderLayout: LUMA_STATIC_SHADER_LAYOUT,
		bufferLayout: LUMA_STATIC_BUFFER_LAYOUT,
	});
	vertexArray.setBuffer(0, vertexBuffer);
	vertexArray.setBuffer(1, instanceBuffer);
	vertexArray.setBuffer(2, instanceBuffer);
	vertexArray.setBuffer(3, instanceBuffer);
	vertexArray.setBuffer(4, instanceBuffer);
	vertexArray.setIndexBuffer(indexBuffer);

	const batch = {
		id,
		drawMode: "instanced",
		kind: "static",
		geometrySignature,
		instanceSignature,
		vertexArray,
		vertexBuffer,
		indexBuffer,
		instanceBuffer,
		vertexCount: geometry.indices.length,
		triangleCount: geometry.triangleCount,
		instanceCount,
		color,
	} satisfies LumaInstancedDrawBatch;
	store.batchesById.set(id, batch);
	retainedBatchIds.add(id);
	return batch;
}

function destroyDrawBatch(batch: LumaWorldDrawBatch): void {
	batch.vertexArray.destroy();
	batch.vertexBuffer.destroy();
	batch.indexBuffer.destroy();
	if (batch.drawMode === "instanced") {
		batch.instanceBuffer.destroy();
	}
}

function createGeometrySignature(
	kind: "terrain" | "structured-interior" | "static",
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

function buildStaticInstanceMatrices(
	parts: readonly StaticRenderablePart[],
	chunkOffset: RenderChunkTransform["offset"],
): Float32Array {
	const matrices = new Float32Array(parts.length * 16);
	for (const [partIndex, part] of parts.entries()) {
		matrices.set(
			multiplyMat4(
				createTranslationMat4(chunkOffset),
				buildLumaStaticRenderablePartMatrix(part),
			),
			partIndex * 16,
		);
	}
	return matrices;
}

function buildLumaStaticRenderablePartMatrix(
	part: StaticRenderablePart,
): LumaMat4 {
	let matrix = createIdentityMat4();
	for (const parentPlacement of part.parentPlacements) {
		matrix = multiplyMat4(
			matrix,
			buildAcPlacementMatrix(
				parentPlacement,
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 1, z: 1 },
			),
		);
	}
	matrix = multiplyMat4(
		matrix,
		buildAcPlacementMatrix(
			part.chunkLocalInstancePlacement,
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 1, z: 1 },
		),
	);
	for (const partPlacement of part.partPlacements) {
		matrix = multiplyMat4(
			matrix,
			buildAcPlacementMatrix(
				partPlacement,
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 1, z: 1 },
			),
		);
	}
	return multiplyMat4(
		matrix,
		createScaleMat4({ x: part.scale.x, y: part.scale.z, z: part.scale.y }),
	);
}

function createIdentityMat4(): LumaMat4 {
	return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function createScaleMat4(scale: { x: number; y: number; z: number }): LumaMat4 {
	return new Float32Array([
		scale.x,
		0,
		0,
		0,
		0,
		scale.y,
		0,
		0,
		0,
		0,
		scale.z,
		0,
		0,
		0,
		0,
		1,
	]);
}
