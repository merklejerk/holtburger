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
import { deriveSceneRenderableReadinessModel } from "./scene-renderable-readiness";
import { staticRenderableObjectKey } from "./static-renderable-readiness";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";
import type { TransitionPortalCandidateModel } from "./transition-portal-work-items";

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

type LumaWorldDrawBatch = LumaIndexedDrawBatch;

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
	kind: "terrain" | "structured-interior" | "static";
	modelMatrix: LumaMat4;
	staticPartCount: number;
}

export interface LumaWorldResourceStore {
	batches: LumaWorldDrawBatch[];
	batchesById: Map<string, LumaWorldDrawBatch>;
	staticPromotionGroups: Map<string, LumaStaticPromotionGroup>;
	terrainBatchCount: number;
	structuredInteriorBatchCount: number;
	staticBatchCount: number;
	promotedStaticBatchCount: number;
	stagedStaticObjectCount: number;
	stagedStaticPartCount: number;
	staticPromotionCount: number;
	staticInstanceCount: number;
	triangleCount: number;
}

export interface LumaStaticPromotionPolicy {
	stagedObjectPromotionThreshold?: number;
	forcePromote?: boolean;
}

interface LumaStaticPromotionGroup {
	promotedObjectKeys: Set<string>;
}

const DEFAULT_STATIC_STAGED_OBJECT_PROMOTION_THRESHOLD = 16;

export function createLumaWorldResourceStore(): LumaWorldResourceStore {
	return {
		batches: [],
		batchesById: new Map(),
		staticPromotionGroups: new Map(),
		terrainBatchCount: 0,
		structuredInteriorBatchCount: 0,
		staticBatchCount: 0,
		promotedStaticBatchCount: 0,
		stagedStaticObjectCount: 0,
		stagedStaticPartCount: 0,
		staticPromotionCount: 0,
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
	transitionPortalModel,
	renderChunkTransforms,
	staticPromotionPolicy,
}: {
	device: Device;
	store: LumaWorldResourceStore;
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	transitionPortalModel: TransitionPortalCandidateModel;
	renderChunkTransforms: readonly RenderChunkTransform[];
	staticPromotionPolicy?: LumaStaticPromotionPolicy;
}): void {
	const chunkOffsetByKey = new Map(
		renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform.offset,
		]),
	);
	const nextBatches: LumaWorldDrawBatch[] = [];
	const retainedBatchIds = new Set<string>();
	const committedScenes = deriveSceneRenderableReadinessModel({
		assetState,
		commitPolicy: "allow-fallback",
		terrainScene,
		structuredInteriorScene,
		staticRenderableScene,
		transitionPortalModel,
	});

	for (const tile of committedScenes.committedTerrainScene.tiles) {
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

	for (const cell of committedScenes.committedStructuredInteriorScene.cells) {
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

	for (const bakedStaticBatch of buildBakedStaticBatches({
		assetState,
		chunkOffsetByKey,
		promotionPolicy: staticPromotionPolicy,
		store,
		staticRenderableScene: committedScenes.committedStaticRenderableScene,
	})) {
		nextBatches.push(
			createOrReuseDrawBatch({
				device,
				store,
				id: bakedStaticBatch.id,
				kind: "static",
				geometry: bakedStaticBatch.geometry,
				modelMatrix: bakedStaticBatch.modelMatrix,
				color: bakedStaticBatch.color,
				shaderLayout: LUMA_WORLD_SHADER_LAYOUT,
				bufferLayout: LUMA_WORLD_BUFFER_LAYOUT,
				staticPartCount: bakedStaticBatch.staticPartCount,
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
	store.promotedStaticBatchCount = store.batches.filter((batch) =>
		batch.id.startsWith("static-promoted/"),
	).length;
	store.stagedStaticObjectCount = store.batches.filter((batch) =>
		batch.id.startsWith("static-staged/"),
	).length;
	store.stagedStaticPartCount = store.batches.reduce(
		(total, batch) =>
			batch.id.startsWith("static-staged/")
				? total + batch.staticPartCount
				: total,
		0,
	);
	store.staticInstanceCount = store.batches.reduce(
		(total, batch) =>
			batch.kind === "static" ? total + batch.staticPartCount : total,
		0,
	);
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
	store.staticPromotionGroups.clear();
	store.terrainBatchCount = 0;
	store.structuredInteriorBatchCount = 0;
	store.staticBatchCount = 0;
	store.promotedStaticBatchCount = 0;
	store.stagedStaticObjectCount = 0;
	store.stagedStaticPartCount = 0;
	store.staticPromotionCount = 0;
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
	staticPartCount = 0,
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
	staticPartCount?: number;
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
		previousBatch.staticPartCount = staticPartCount;
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
		staticPartCount,
	} satisfies LumaIndexedDrawBatch;
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

interface BakedStaticBatchInput {
	id: string;
	geometry: LumaIndexedGeometry;
	modelMatrix: LumaMat4;
	color: LumaVec4;
	staticPartCount: number;
}

function buildBakedStaticBatches({
	assetState,
	chunkOffsetByKey,
	promotionPolicy,
	store,
	staticRenderableScene,
}: {
	assetState: AssetChannelState;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	promotionPolicy: LumaStaticPromotionPolicy | undefined;
	store: LumaWorldResourceStore;
	staticRenderableScene: StaticRenderableSceneModel;
}): BakedStaticBatchInput[] {
	const objectsByBatchKey = groupCommittedStaticObjectsByBatchKey({
		chunkOffsetByKey,
		staticRenderableScene,
	});
	const activeBatchKeys = new Set(objectsByBatchKey.keys());
	for (const batchKey of store.staticPromotionGroups.keys()) {
		if (!activeBatchKeys.has(batchKey)) {
			store.staticPromotionGroups.delete(batchKey);
		}
	}

	return [...objectsByBatchKey.entries()].flatMap(([batchKey, objectGroups]) => {
		const group = resolveStaticPromotionGroup({
			batchKey,
			objectGroups,
			promotionPolicy,
			store,
		});
		const promotedParts = objectGroups.flatMap((objectGroup) =>
			group.promotedObjectKeys.has(objectGroup.objectKey)
				? objectGroup.parts
				: [],
		);
		const stagedObjectGroups = objectGroups.filter(
			(objectGroup) => !group.promotedObjectKeys.has(objectGroup.objectKey),
		);
		return [
			...buildPromotedStaticBatch({
				assetState,
				batchKey,
				chunkOffsetByKey,
				parts: promotedParts,
			}),
			...stagedObjectGroups.flatMap((objectGroup) =>
				buildStagedStaticBatch({
					assetState,
					batchKey,
					chunkOffsetByKey,
					objectGroup,
				}),
			),
		];
	});
}

interface StaticRenderableObjectGroup {
	objectKey: string;
	parts: StaticRenderablePart[];
}

function groupCommittedStaticObjectsByBatchKey({
	chunkOffsetByKey,
	staticRenderableScene,
}: {
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	staticRenderableScene: StaticRenderableSceneModel;
}): Map<string, StaticRenderableObjectGroup[]> {
	const objectGroupsByBatchKey = new Map<
		string,
		Map<string, StaticRenderablePart[]>
	>();
	for (const part of staticRenderableScene.parts) {
		const chunkOffset = chunkOffsetByKey.get(part.renderChunk.chunkKey);
		if (!chunkOffset) {
			continue;
		}
		const batchKey = formatBakedStaticBatchKey(part);
		const objectKey = staticRenderableObjectKey(part);
		let partsByObjectKey = objectGroupsByBatchKey.get(batchKey);
		if (!partsByObjectKey) {
			partsByObjectKey = new Map();
			objectGroupsByBatchKey.set(batchKey, partsByObjectKey);
		}
		const objectParts = partsByObjectKey.get(objectKey);
		if (objectParts) {
			objectParts.push(part);
		} else {
			partsByObjectKey.set(objectKey, [part]);
		}
	}

	return new Map(
		[...objectGroupsByBatchKey.entries()].map(([batchKey, objectGroups]) => [
			batchKey,
			[...objectGroups.entries()]
				.map(([objectKey, parts]) => ({ objectKey, parts }))
				.sort((left, right) => left.objectKey.localeCompare(right.objectKey)),
		]),
	);
}

function resolveStaticPromotionGroup({
	batchKey,
	objectGroups,
	promotionPolicy,
	store,
}: {
	batchKey: string;
	objectGroups: readonly StaticRenderableObjectGroup[];
	promotionPolicy: LumaStaticPromotionPolicy | undefined;
	store: LumaWorldResourceStore;
}): LumaStaticPromotionGroup {
	let group = store.staticPromotionGroups.get(batchKey);
	if (!group) {
		group = {
			promotedObjectKeys: new Set(objectGroups.map((object) => object.objectKey)),
		};
		store.staticPromotionGroups.set(batchKey, group);
		return group;
	}

	const committedObjectKeys = new Set(
		objectGroups.map((objectGroup) => objectGroup.objectKey),
	);
	for (const objectKey of group.promotedObjectKeys) {
		if (!committedObjectKeys.has(objectKey)) {
			group.promotedObjectKeys.delete(objectKey);
		}
	}

	const stagedObjectKeys = objectGroups
		.map((objectGroup) => objectGroup.objectKey)
		.filter((objectKey) => !group.promotedObjectKeys.has(objectKey));
	if (shouldPromoteStagedStaticObjects(stagedObjectKeys.length, promotionPolicy)) {
		for (const objectKey of stagedObjectKeys) {
			group.promotedObjectKeys.add(objectKey);
		}
		if (stagedObjectKeys.length > 0) {
			store.staticPromotionCount += 1;
		}
	}

	return group;
}

function shouldPromoteStagedStaticObjects(
	stagedObjectCount: number,
	promotionPolicy: LumaStaticPromotionPolicy | undefined,
): boolean {
	if (stagedObjectCount === 0) {
		return false;
	}
	if (promotionPolicy?.forcePromote === true) {
		return true;
	}
	return (
		stagedObjectCount >=
		(promotionPolicy?.stagedObjectPromotionThreshold ??
			DEFAULT_STATIC_STAGED_OBJECT_PROMOTION_THRESHOLD)
	);
}

function buildPromotedStaticBatch({
	assetState,
	batchKey,
	chunkOffsetByKey,
	parts,
}: {
	assetState: AssetChannelState;
	batchKey: string;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	parts: readonly StaticRenderablePart[];
}): BakedStaticBatchInput[] {
	return buildStaticBatch({
		assetState,
		batchId: `static-promoted/${batchKey}`,
		colorKey: `static-promoted/${batchKey}`,
		chunkOffsetByKey,
		parts,
	});
}

function buildStagedStaticBatch({
	assetState,
	batchKey,
	chunkOffsetByKey,
	objectGroup,
}: {
	assetState: AssetChannelState;
	batchKey: string;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	objectGroup: StaticRenderableObjectGroup;
}): BakedStaticBatchInput[] {
	return buildStaticBatch({
		assetState,
		batchId: `static-staged/${batchKey}/${objectGroup.objectKey}`,
		colorKey: `static-staged/${batchKey}`,
		chunkOffsetByKey,
		parts: objectGroup.parts,
	});
}

function buildStaticBatch({
	assetState,
	batchId,
	colorKey,
	chunkOffsetByKey,
	parts,
}: {
	assetState: AssetChannelState;
	batchId: string;
	colorKey: string;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	parts: readonly StaticRenderablePart[];
}): BakedStaticBatchInput[] {
	const firstPart = parts[0];
	if (!firstPart) {
		return [];
	}
	const chunkOffset = chunkOffsetByKey.get(firstPart.renderChunk.chunkKey);
	if (!chunkOffset) {
		return [];
	}
	const geometry = buildBakedStaticGeometry(assetState, parts);
	if (geometry.triangleCount === 0) {
		return [];
	}
	return [
		{
			id: batchId,
			geometry,
			modelMatrix: createTranslationMat4(chunkOffset),
			color: buildDebugColor(colorKey),
			staticPartCount: parts.length,
		},
	];
}

function formatBakedStaticBatchKey(part: StaticRenderablePart): string {
	return [
		part.renderDomain,
		part.renderChunk.chunkKey,
		"debug-flat",
	].join("|");
}

function buildBakedStaticGeometry(
	assetState: AssetChannelState,
	parts: readonly StaticRenderablePart[],
): LumaIndexedGeometry {
	const bakedParts = parts.flatMap((part) => {
		const asset = assetState.preparedByAssetId[part.gfxObjAssetId];
		if (
			!asset ||
			asset.payload.kind !== "gfx-obj" ||
			asset.payload.renderGeometry.vertexCount === 0
		) {
			return [];
		}
		const geometry = buildLumaPolygonSetGeometry(asset.payload.renderGeometry);
		if (geometry.triangleCount === 0) {
			return [];
		}
		return [{ geometry, part }];
	});
	const vertexCount = bakedParts.reduce(
		(total, bakedPart) => total + bakedPart.geometry.vertexCount,
		0,
	);
	const indexCount = bakedParts.reduce(
		(total, bakedPart) => total + bakedPart.geometry.indices.length,
		0,
	);
	const positions = new Float32Array(vertexCount * 3);
	const indices = createIndexArray(vertexCount, indexCount);
	let vertexOffset = 0;
	let indexOffset = 0;

	for (const { geometry, part } of bakedParts) {
		const matrix = buildLumaStaticRenderablePartMatrix(part);
		for (let vertexIndex = 0; vertexIndex < geometry.vertexCount; vertexIndex += 1) {
			transformPosition(
				positions,
				vertexOffset + vertexIndex,
				geometry.positions,
				vertexIndex,
				matrix,
			);
		}
		for (const index of geometry.indices) {
			indices[indexOffset] = vertexOffset + index;
			indexOffset += 1;
		}
		vertexOffset += geometry.vertexCount;
	}

	return {
		positions,
		indices,
		vertexCount,
		triangleCount: indexCount / 3,
	};
}

function transformPosition(
	target: Float32Array,
	targetVertexIndex: number,
	source: Float32Array,
	sourceVertexIndex: number,
	matrix: LumaMat4,
): void {
	const sourceOffset = sourceVertexIndex * 3;
	const targetOffset = targetVertexIndex * 3;
	const x = source[sourceOffset];
	const y = source[sourceOffset + 1];
	const z = source[sourceOffset + 2];
	target[targetOffset] =
		matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
	target[targetOffset + 1] =
		matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
	target[targetOffset + 2] =
		matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
}

function createIndexArray(
	vertexCount: number,
	indexCount: number,
): Uint16Array | Uint32Array {
	return vertexCount > 65535
		? new Uint32Array(indexCount)
		: new Uint16Array(indexCount);
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
