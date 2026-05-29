import {
	Buffer as LumaBuffer,
	type Buffer,
	type BufferLayout,
	type Binding,
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
	createLumaTextureResourceStore,
	destroyLumaTextureResources,
	getOrCreateLumaTextureResource,
	resolveLumaSurfaceMaterialPlan,
	type LumaMaterialPlan,
	type LumaTextureResourceStore,
} from "./luma-materials";
import {
	buildAcPlacementMatrix,
	buildDebugColor,
	createTranslationMat4,
	multiplyMat4,
	type LumaMat4,
	type LumaVec4,
} from "./luma-math";
import type { RenderChunkTransform } from "./render-anchor";
import type { MaterialTextureCapabilities } from "./render-surface-texture-data";
import {
	deriveStructuredInteriorCellBatchBvhBinding,
	deriveTerrainTileBatchBvhBinding,
} from "./non-instanced-bvh-bindings";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type {
	StaticRenderablePart,
	StaticRenderableSceneModel,
} from "./static-renderables";
import { deriveStaticRenderablePartBvhItemKey } from "./static-renderable-bvh-bindings";
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

export const LUMA_TEXTURED_WORLD_SHADER_LAYOUT: ShaderLayout = {
	attributes: [
		{ name: "position", location: 0, type: "vec3<f32>" },
		{ name: "texCoord", location: 1, type: "vec2<f32>" },
	],
	bindings: [{ type: "texture", name: "uTexture", group: 0, location: 0 }],
	uniforms: [
		{ name: "uModelViewProjection", type: "mat4x4<f32>" },
		{ name: "uColor", type: "vec4<f32>" },
		{ name: "uAlphaTest", type: "f32" },
	],
};

export const LUMA_WORLD_BUFFER_LAYOUT: BufferLayout[] = [
	{ name: "position", format: "float32x3" },
];

export const LUMA_TEXTURED_WORLD_BUFFER_LAYOUT: BufferLayout[] = [
	{ name: "position", format: "float32x3" },
	{ name: "texCoord", format: "float32x2" },
];

export type LumaWorldDrawBatch = LumaIndexedDrawBatch;

export type LumaWorldDrawBatchKind =
	| "terrain"
	| "structured-interior"
	| "static";

interface LumaBaseDrawBatch {
	id: string;
	kind: LumaWorldDrawBatchKind;
	geometrySignature: string;
	vertexArray: VertexArray;
	vertexBuffer: Buffer;
	uvBuffer: Buffer | null;
	indexBuffer: Buffer;
	vertexCount: number;
	triangleCount: number;
	color: LumaVec4;
	material: LumaMaterialPlan;
	bindings: Record<string, Binding>;
	bvhItemKeys: readonly RenderBvhItemKey[];
	bvhFallbackReason: string | null;
	staticObjectKeys: readonly string[];
}

interface LumaIndexedDrawBatch extends LumaBaseDrawBatch {
	drawMode: "indexed";
	kind: LumaWorldDrawBatchKind;
	modelMatrix: LumaMat4;
	staticPartCount: number;
}

export interface LumaWorldResourceStore {
	batches: LumaWorldDrawBatch[];
	batchesById: Map<string, LumaWorldDrawBatch>;
	textureStore: LumaTextureResourceStore;
	terrainBatchCount: number;
	structuredInteriorBatchCount: number;
	staticBatchCount: number;
	stagedStaticObjectCount: number;
	stagedStaticPartCount: number;
	staticInstanceCount: number;
	materialCount: number;
	directTextureBatchCount: number;
	materialFallbackReasonCount: number;
	materialFallbackReasonSamples: readonly string[];
	triangleCount: number;
}

export function createLumaWorldResourceStore(): LumaWorldResourceStore {
	return {
		batches: [],
		batchesById: new Map(),
		textureStore: createLumaTextureResourceStore(),
		terrainBatchCount: 0,
		structuredInteriorBatchCount: 0,
		staticBatchCount: 0,
		stagedStaticObjectCount: 0,
		stagedStaticPartCount: 0,
		staticInstanceCount: 0,
		materialCount: 0,
		directTextureBatchCount: 0,
		materialFallbackReasonCount: 0,
		materialFallbackReasonSamples: [],
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
	materialTextureCapabilities,
}: {
	device: Device;
	store: LumaWorldResourceStore;
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	transitionPortalModel: TransitionPortalCandidateModel;
	renderChunkTransforms: readonly RenderChunkTransform[];
	materialTextureCapabilities?: MaterialTextureCapabilities;
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
				material: createFlatDebugLumaMaterial(`terrain/${tile.landblockId}`),
				bvhBinding: deriveTerrainTileBatchBvhBinding(tile),
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
		const chunkMatrix = createTranslationMat4(chunkOffset);
		const placementMatrix = buildAcPlacementMatrix(
			cell.chunkLocalPlacement,
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 1, z: 1 },
		);
		const modelMatrix = multiplyMat4(chunkMatrix, placementMatrix);
		for (const surfaceKey of structuredInteriorSurfaceKeys(cell)) {
			const geometry = buildLumaPolygonSetGeometry(cell.renderGeometry, {
				surfaceId: surfaceKey.surfaceId,
				materialVariantSignature: surfaceKey.materialVariantSignature,
			});
			if (geometry.triangleCount === 0) {
				continue;
			}
			const material = resolveLumaSurfaceMaterialPlan({
				assetState,
				surfaceId: surfaceKey.surfaceId,
				fallbackColorKey: `${cell.debugColorKey}:${surfaceKey.surfaceId ?? "none"}`,
				textureCapabilities: materialTextureCapabilities,
			});
			nextBatches.push(
				createOrReuseDrawBatch({
					device,
					store,
					id: [
						"structured-interior",
						cell.renderKey,
						`surface=${surfaceKey.surfaceId ?? "none"}`,
						`variant=${surfaceKey.materialVariantSignature ?? "base"}`,
					].join("/"),
					kind: "structured-interior",
					geometry,
					modelMatrix,
					material,
					bvhBinding: deriveStructuredInteriorCellBatchBvhBinding(cell),
					shaderLayout:
						material.kind === "direct-texture"
							? LUMA_TEXTURED_WORLD_SHADER_LAYOUT
							: LUMA_WORLD_SHADER_LAYOUT,
					bufferLayout:
						material.kind === "direct-texture"
							? LUMA_TEXTURED_WORLD_BUFFER_LAYOUT
							: LUMA_WORLD_BUFFER_LAYOUT,
					retainedBatchIds,
				}),
			);
		}
	}

	for (const bakedStaticBatch of buildBakedStaticBatches({
		assetState,
		chunkOffsetByKey,
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
				material: bakedStaticBatch.material,
				bvhBinding: bakedStaticBatch.bvhBinding,
				shaderLayout: LUMA_WORLD_SHADER_LAYOUT,
				bufferLayout: LUMA_WORLD_BUFFER_LAYOUT,
				staticPartCount: bakedStaticBatch.staticPartCount,
				staticObjectKeys: bakedStaticBatch.staticObjectKeys,
				preserveUvBuffer: bakedStaticBatch.id.startsWith("static-staged/"),
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
	store.stagedStaticObjectCount = countUniqueStaticObjectKeys(
		store.batches.filter((batch) => batch.id.startsWith("static-staged/")),
	);
	store.stagedStaticPartCount = countUniqueBvhItemKeys(
		store.batches.filter((batch) => batch.id.startsWith("static-staged/")),
	);
	store.staticInstanceCount = countUniqueBvhItemKeys(
		store.batches.filter((batch) => batch.kind === "static"),
	);
	store.materialCount = new Set(
		store.batches.map((batch) => batch.material.key),
	).size;
	store.directTextureBatchCount = store.batches.filter(
		(batch) => batch.material.kind === "direct-texture",
	).length;
	const materialFallbackReasons = store.batches.flatMap((batch) =>
		batch.material.fallbackReason ? [batch.material.fallbackReason] : [],
	);
	store.materialFallbackReasonCount = materialFallbackReasons.length;
	store.materialFallbackReasonSamples = [
		...new Set(materialFallbackReasons),
	].slice(0, 8);
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
	destroyLumaTextureResources(store.textureStore);
	store.terrainBatchCount = 0;
	store.structuredInteriorBatchCount = 0;
	store.staticBatchCount = 0;
	store.stagedStaticObjectCount = 0;
	store.stagedStaticPartCount = 0;
	store.staticInstanceCount = 0;
	store.materialCount = 0;
	store.directTextureBatchCount = 0;
	store.materialFallbackReasonCount = 0;
	store.materialFallbackReasonSamples = [];
	store.triangleCount = 0;
}

function countUniqueStaticObjectKeys(
	batches: readonly LumaWorldDrawBatch[],
): number {
	return new Set(batches.flatMap((batch) => batch.staticObjectKeys)).size;
}

function countUniqueBvhItemKeys(batches: readonly LumaWorldDrawBatch[]): number {
	return new Set(batches.flatMap((batch) => batch.bvhItemKeys)).size;
}

function createOrReuseDrawBatch({
	device,
	store,
	id,
	kind,
	geometry,
	modelMatrix,
	material,
	bvhBinding,
	shaderLayout,
	bufferLayout,
	staticPartCount = 0,
	staticObjectKeys = [],
	preserveUvBuffer = false,
	retainedBatchIds,
}: {
	device: Device;
	store: LumaWorldResourceStore;
	id: string;
	kind: LumaIndexedDrawBatch["kind"];
	geometry: LumaIndexedGeometry;
	modelMatrix: LumaMat4;
	material: LumaMaterialPlan;
	bvhBinding: LumaBatchBvhBinding;
	shaderLayout: ShaderLayout;
	bufferLayout: BufferLayout[];
	staticPartCount?: number;
	staticObjectKeys?: readonly string[];
	preserveUvBuffer?: boolean;
	retainedBatchIds: Set<string>;
}): LumaIndexedDrawBatch {
	const geometrySignature = createGeometrySignature(kind, geometry, material);
	const previousBatch = store.batchesById.get(id);
	if (
		previousBatch &&
		previousBatch.drawMode === "indexed" &&
		previousBatch.kind === kind &&
		previousBatch.geometrySignature === geometrySignature
	) {
		previousBatch.modelMatrix = modelMatrix;
		previousBatch.color = material.color;
		previousBatch.material = material;
		previousBatch.bindings = createLumaBatchBindings({
			device,
			store,
			material,
		});
		previousBatch.bvhItemKeys = bvhBinding.itemKeys;
		previousBatch.bvhFallbackReason = bvhBinding.fallbackReason;
		previousBatch.staticPartCount = staticPartCount;
		previousBatch.staticObjectKeys = [...staticObjectKeys];
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
	const uvBuffer =
		(material.kind === "direct-texture" || preserveUvBuffer) && geometry.uvs
			? device.createBuffer({
					id: `${id}/uvs`,
					usage: LumaBuffer.VERTEX,
					data: geometry.uvs,
				})
			: null;
	if (uvBuffer) {
		vertexArray.setBuffer(1, uvBuffer);
	}
	vertexArray.setIndexBuffer(indexBuffer);

	const batch = {
		id,
		drawMode: "indexed",
		kind,
		geometrySignature,
		vertexArray,
		vertexBuffer,
		uvBuffer,
		indexBuffer,
		vertexCount: geometry.indices.length,
		triangleCount: geometry.triangleCount,
		modelMatrix,
		color: material.color,
		material,
		bindings: createLumaBatchBindings({ device, store, material }),
		bvhItemKeys: bvhBinding.itemKeys,
		bvhFallbackReason: bvhBinding.fallbackReason,
		staticObjectKeys: [...staticObjectKeys],
		staticPartCount,
	} satisfies LumaIndexedDrawBatch;
	store.batchesById.set(id, batch);
	retainedBatchIds.add(id);
	return batch;
}

function destroyDrawBatch(batch: LumaWorldDrawBatch): void {
	batch.vertexArray.destroy();
	batch.vertexBuffer.destroy();
	batch.uvBuffer?.destroy();
	batch.indexBuffer.destroy();
}

function createGeometrySignature(
	kind: "terrain" | "structured-interior" | "static",
	geometry: LumaIndexedGeometry,
	material: LumaMaterialPlan,
): string {
	return [
		kind,
		material.kind,
		material.key,
		`v${geometry.vertexCount}`,
		`t${geometry.triangleCount}`,
		`p${hashFloat32Array(geometry.positions)}`,
		geometry.uvs ? `u${hashFloat32Array(geometry.uvs)}` : "u:none",
		`i${hashIndexArray(geometry.indices)}`,
	].join(":");
}

function hashFloat32Array(values: Float32Array): string {
	let hash = 0x811c9dc5;
	const view = new DataView(
		values.buffer,
		values.byteOffset,
		values.byteLength,
	);
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
	material: LumaMaterialPlan;
	bvhBinding: LumaBatchBvhBinding;
	staticPartCount: number;
	staticObjectKeys: readonly string[];
}

interface LumaBatchBvhBinding {
	itemKeys: readonly RenderBvhItemKey[];
	fallbackReason: string | null;
}

function buildBakedStaticBatches({
	assetState,
	chunkOffsetByKey,
	staticRenderableScene,
}: {
	assetState: AssetChannelState;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	staticRenderableScene: StaticRenderableSceneModel;
}): BakedStaticBatchInput[] {
	const objectsByBatchKey = groupCommittedStaticObjectsByBatchKey({
		chunkOffsetByKey,
		staticRenderableScene,
	});

	return [...objectsByBatchKey.entries()].flatMap(
		([batchKey, objectGroups]) =>
			objectGroups.flatMap((objectGroup) =>
				buildStagedStaticBatch({
					assetState,
					batchKey,
					chunkOffsetByKey,
					objectGroup,
				}),
			),
	);
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
	return objectGroup.parts.flatMap((part) =>
		deriveStagedStaticSurfaceKeys(assetState, part).flatMap((surfaceKey) =>
			buildStagedStaticSurfaceBatch({
				assetState,
				batchKey,
				chunkOffsetByKey,
				objectKey: objectGroup.objectKey,
				part,
				surfaceKey,
			}),
		),
	);
}

interface StagedStaticSurfaceKey {
	slotIndex: number | null;
	surfaceId: number | null;
	materialVariantSignature: string | null;
}

function buildStagedStaticSurfaceBatch({
	assetState,
	batchKey,
	chunkOffsetByKey,
	objectKey,
	part,
	surfaceKey,
}: {
	assetState: AssetChannelState;
	batchKey: string;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	objectKey: string;
	part: StaticRenderablePart;
	surfaceKey: StagedStaticSurfaceKey;
}): BakedStaticBatchInput[] {
	const chunkOffset = chunkOffsetByKey.get(part.renderChunk.chunkKey);
	if (!chunkOffset) {
		return [];
	}
	const geometry = buildStagedStaticPartGeometry(assetState, part, surfaceKey);
	if (geometry.triangleCount === 0) {
		return [];
	}
	const surfaceBatchKey = formatStagedStaticSurfaceBatchKey(surfaceKey);
	const batchId = [
		"static-staged",
		batchKey,
		objectKey,
		part.renderKey,
		`part-${part.partIndex}`,
		surfaceBatchKey,
		"debug-flat",
	].join("/");
	return [
		{
			id: batchId,
			geometry,
			modelMatrix: createTranslationMat4(chunkOffset),
			material: createFlatDebugLumaMaterial(
				`static-staged/${batchKey}/${surfaceBatchKey}`,
			),
			bvhBinding: deriveStaticBatchBvhBinding(batchId, [part]),
			staticPartCount: 1,
			staticObjectKeys: [objectKey],
		},
	];
}

function deriveStagedStaticSurfaceKeys(
	assetState: AssetChannelState,
	part: StaticRenderablePart,
): StagedStaticSurfaceKey[] {
	if (part.materialSlots.length > 0) {
		return part.materialSlots
			.map((slot) => ({
				slotIndex: slot.slotIndex,
				surfaceId: slot.surfaceId,
				materialVariantSignature: slot.materialVariantSignature ?? null,
			}))
			.sort(compareStagedStaticSurfaceKeys);
	}

	const asset = assetState.preparedByAssetId[part.gfxObjAssetId];
	if (asset?.payload.kind !== "gfx-obj") {
		return [
			{
				slotIndex: null,
				surfaceId: null,
				materialVariantSignature: null,
			},
		];
	}

	const keys = new Map<string, StagedStaticSurfaceKey>();
	for (const triangle of asset.payload.renderGeometry.triangles) {
		const key = [
			triangle.surfaceId ?? "none",
			triangle.materialVariantSignature ?? "base",
		].join("|");
		keys.set(key, {
			slotIndex: null,
			surfaceId: triangle.surfaceId,
			materialVariantSignature: triangle.materialVariantSignature ?? null,
		});
	}
	return [...keys.values()].sort(compareStagedStaticSurfaceKeys);
}

function compareStagedStaticSurfaceKeys(
	left: StagedStaticSurfaceKey,
	right: StagedStaticSurfaceKey,
): number {
	return (
		(left.slotIndex ?? -1) - (right.slotIndex ?? -1) ||
		(left.surfaceId ?? -1) - (right.surfaceId ?? -1) ||
		(left.materialVariantSignature ?? "").localeCompare(
			right.materialVariantSignature ?? "",
		)
	);
}

function formatStagedStaticSurfaceBatchKey(
	surfaceKey: StagedStaticSurfaceKey,
): string {
	return [
		`slot-${surfaceKey.slotIndex ?? "none"}`,
		`surface-${surfaceKey.surfaceId ?? "none"}`,
		`variant-${surfaceKey.materialVariantSignature ?? "base"}`,
	].join("|");
}

function buildStagedStaticPartGeometry(
	assetState: AssetChannelState,
	part: StaticRenderablePart,
	surfaceKey: StagedStaticSurfaceKey,
): LumaIndexedGeometry {
	const asset = assetState.preparedByAssetId[part.gfxObjAssetId];
	if (
		!asset ||
		asset.payload.kind !== "gfx-obj" ||
		asset.payload.renderGeometry.vertexCount === 0
	) {
		return createEmptyLumaIndexedGeometry();
	}
	const geometry = buildLumaPolygonSetGeometry(asset.payload.renderGeometry, {
		surfaceId: surfaceKey.surfaceId,
		materialVariantSignature: surfaceKey.materialVariantSignature,
	});
	if (geometry.triangleCount === 0) {
		return geometry;
	}

	const matrix = buildLumaStaticRenderablePartMatrix(part);
	const positions = new Float32Array(geometry.positions.length);
	for (let vertexIndex = 0; vertexIndex < geometry.vertexCount; vertexIndex += 1) {
		transformPosition(
			positions,
			vertexIndex,
			geometry.positions,
			vertexIndex,
			matrix,
		);
	}
	return {
		...geometry,
		positions,
	};
}

function createEmptyLumaIndexedGeometry(): LumaIndexedGeometry {
	return {
		positions: new Float32Array(),
		uvs: new Float32Array(),
		indices: new Uint16Array(),
		vertexCount: 0,
		triangleCount: 0,
	};
}

function deriveStaticBatchBvhBinding(
	batchId: string,
	parts: readonly StaticRenderablePart[],
): LumaBatchBvhBinding {
	const itemKeys = new Set<RenderBvhItemKey>();
	for (const part of parts) {
		const itemKey = deriveStaticRenderablePartBvhItemKey(part);
		if (!itemKey) {
			return {
				itemKeys: [],
				fallbackReason: `luma static batch ${batchId} contains an unkeyed ${part.kind} part`,
			};
		}
		itemKeys.add(itemKey);
	}
	return {
		itemKeys: [...itemKeys],
		fallbackReason:
			itemKeys.size === 0
				? `luma static batch ${batchId} contains no BVH item keys`
				: null,
	};
}

function formatBakedStaticBatchKey(part: StaticRenderablePart): string {
	return [part.renderDomain, part.renderChunk.chunkKey, "debug-flat"].join("|");
}

function createLumaBatchBindings({
	device,
	store,
	material,
}: {
	device: Device;
	store: LumaWorldResourceStore;
	material: LumaMaterialPlan;
}): Record<string, Binding> {
	if (material.kind !== "direct-texture") {
		return {};
	}
	return {
		uTexture: getOrCreateLumaTextureResource({
			device,
			store: store.textureStore,
			plan: material,
		}),
	};
}

function createFlatDebugLumaMaterial(colorKey: string): LumaMaterialPlan {
	return {
		kind: "flat",
		key: `debug-flat/${colorKey}`,
		color: buildDebugColor(colorKey),
		behavior: null,
		fallbackReason: null,
	};
}

function structuredInteriorSurfaceKeys(
	cell: StructuredInteriorSceneModel["cells"][number],
): { surfaceId: number | null; materialVariantSignature: string | null }[] {
	const keys = new Map<
		string,
		{ surfaceId: number | null; materialVariantSignature: string | null }
	>();
	for (const triangle of cell.renderGeometry.triangles) {
		const surfaceId = triangle.surfaceId;
		const materialVariantSignature = triangle.materialVariantSignature ?? null;
		const key = `${surfaceId ?? "none"}|${materialVariantSignature ?? "base"}`;
		keys.set(key, { surfaceId, materialVariantSignature });
	}
	return [...keys.values()].sort((left, right) => {
		const leftSurface = left.surfaceId ?? -1;
		const rightSurface = right.surfaceId ?? -1;
		return (
			leftSurface - rightSurface ||
			(left.materialVariantSignature ?? "").localeCompare(
				right.materialVariantSignature ?? "",
			)
		);
	});
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
