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
	type LumaMaterialPlan,
	type LumaTextureResourceStore,
} from "./luma-materials";
import {
	buildAcPlacementMatrix,
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
import {
	materialDecisionGraphNodeKey,
	preparedAssetGraphNodeKey,
	sceneObjectGraphNodeKey,
	type RendererResourceGraph,
	type RendererResourceGraphDependencyReplacement,
	type RendererResourceGraphLease,
	type RendererResourceGraphNode,
} from "./renderer-resource-graph";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { StaticRenderableSceneModel } from "./static-renderables";
import { deriveSceneRenderableReadinessModel } from "./scene-renderable-readiness";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import {
	buildStagedStaticDrawUnitAssemblies,
	createFlatDebugStagedMaterial,
	describeStagedWorldAssemblyGraphRecordSignature,
	uniqueSortedStrings,
	type StagedWorldAssemblyGraphRecord,
	type StagedWorldDrawUnitBvhBinding,
} from "./staged-world-assembly";
import { resolveStagedWorldSurfaceMaterialPlan } from "./staged-world-materials";
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
	graphLeasesByBatchId: Map<string, RendererResourceGraphLease>;
	graphSignaturesByBatchId: Map<string, string>;
	boundGraph: RendererResourceGraph | null;
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
		graphLeasesByBatchId: new Map(),
		graphSignaturesByBatchId: new Map(),
		boundGraph: null,
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
	rendererResourceGraph,
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
	rendererResourceGraph?: RendererResourceGraph;
}): void {
	const chunkOffsetByKey = new Map(
		renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform.offset,
		]),
	);
	const nextBatches: LumaWorldDrawBatch[] = [];
	const retainedBatchIds = new Set<string>();
	const graphAssemblyRecords: StagedWorldAssemblyGraphRecord[] = [];
	const fallbackCommittedScenes = deriveSceneRenderableReadinessModel({
		assetState,
		commitPolicy: "allow-fallback",
		terrainScene,
		structuredInteriorScene,
		staticRenderableScene,
		transitionPortalModel,
	});
	const fullyResolvedScenes = deriveSceneRenderableReadinessModel({
		assetState,
		commitPolicy: "resolved-only",
		terrainScene,
		structuredInteriorScene,
		staticRenderableScene,
		transitionPortalModel,
	});

	for (const tile of fallbackCommittedScenes.committedTerrainScene.tiles) {
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
				material: createFlatDebugStagedMaterial(`terrain/${tile.landblockId}`),
				bvhBinding: deriveTerrainTileBatchBvhBinding(tile),
				shaderLayout: LUMA_WORLD_SHADER_LAYOUT,
				bufferLayout: LUMA_WORLD_BUFFER_LAYOUT,
				retainedBatchIds,
			}),
		);
	}

	for (const cell of fullyResolvedScenes.committedStructuredInteriorScene.cells) {
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
			const material = resolveStagedWorldSurfaceMaterialPlan({
				assetState,
				surfaceId: surfaceKey.surfaceId,
				fallbackColorKey: `${cell.debugColorKey}:${surfaceKey.surfaceId ?? "none"}`,
				textureCapabilities: materialTextureCapabilities,
			});
			const batchId = [
				"structured-interior",
				cell.renderKey,
				`surface=${surfaceKey.surfaceId ?? "none"}`,
				`variant=${surfaceKey.materialVariantSignature ?? "base"}`,
			].join("/");
			nextBatches.push(
				createOrReuseDrawBatch({
					device,
					store,
					id: batchId,
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
			graphAssemblyRecords.push({
				drawUnitId: batchId,
				label: `structured interior ${cell.renderKey}`,
				material,
				preparedAssetIds: material.preparedAssetIds,
			});
		}
	}

	const bakedStaticBatches = buildStagedStaticDrawUnitAssemblies({
		assetState,
		chunkOffsetByKey,
		staticRenderableScene: fullyResolvedScenes.committedStaticRenderableScene,
		materialTextureCapabilities,
	});

	for (const bakedStaticBatch of bakedStaticBatches) {
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
				shaderLayout:
					bakedStaticBatch.material.kind === "direct-texture"
						? LUMA_TEXTURED_WORLD_SHADER_LAYOUT
						: LUMA_WORLD_SHADER_LAYOUT,
				bufferLayout:
					bakedStaticBatch.material.kind === "direct-texture"
						? LUMA_TEXTURED_WORLD_BUFFER_LAYOUT
						: LUMA_WORLD_BUFFER_LAYOUT,
				staticPartCount: bakedStaticBatch.staticPartCount,
				staticObjectKeys: bakedStaticBatch.staticObjectKeys,
				preserveUvBuffer: bakedStaticBatch.id.startsWith("static-staged/"),
				retainedBatchIds,
			}),
		);
		graphAssemblyRecords.push({
			drawUnitId: bakedStaticBatch.id,
		label: `staged static ${bakedStaticBatch.staticObjectKeys.join(", ")}`,
		material: bakedStaticBatch.material,
		preparedAssetIds: bakedStaticBatch.preparedAssetIds,
	});
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
	syncLumaAssemblyGraph({
		graph: rendererResourceGraph,
		store,
		records: graphAssemblyRecords,
		retainedBatchIds,
	});
}

export function destroyLumaWorldResources(store: LumaWorldResourceStore): void {
	if (store.boundGraph) {
		for (const lease of store.graphLeasesByBatchId.values()) {
			store.boundGraph.releaseLease(lease);
		}
	}
	for (const batch of store.batches) {
		destroyDrawBatch(batch);
	}
	store.batches = [];
	store.batchesById.clear();
	store.graphLeasesByBatchId.clear();
	store.graphSignaturesByBatchId.clear();
	store.boundGraph = null;
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
	const bindUvBuffer = material.kind === "direct-texture";
	const uvBuffer =
		(bindUvBuffer || preserveUvBuffer) && geometry.uvs
			? device.createBuffer({
					id: `${id}/uvs`,
					usage: LumaBuffer.VERTEX,
					data: geometry.uvs,
				})
			: null;
	if (uvBuffer && bindUvBuffer) {
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

type LumaBatchBvhBinding = StagedWorldDrawUnitBvhBinding;

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

function syncLumaAssemblyGraph({
	graph,
	store,
	records,
	retainedBatchIds,
}: {
	graph: RendererResourceGraph | undefined;
	store: LumaWorldResourceStore;
	records: readonly StagedWorldAssemblyGraphRecord[];
	retainedBatchIds: ReadonlySet<string>;
}): void {
	if (!graph) {
		if (store.boundGraph) {
			for (const lease of store.graphLeasesByBatchId.values()) {
				store.boundGraph.releaseLease(lease);
			}
		}
		store.graphLeasesByBatchId.clear();
		store.graphSignaturesByBatchId.clear();
		store.boundGraph = null;
		return;
	}
	if (store.boundGraph && store.boundGraph !== graph) {
		for (const lease of store.graphLeasesByBatchId.values()) {
			store.boundGraph.releaseLease(lease);
		}
		store.graphLeasesByBatchId.clear();
		store.graphSignaturesByBatchId.clear();
	}
	store.boundGraph = graph;

	const changedRecords = records.filter((record) => {
		const signature = describeStagedWorldAssemblyGraphRecordSignature(record);
		return store.graphSignaturesByBatchId.get(record.drawUnitId) !== signature;
	});
	if (changedRecords.length > 0) {
		const nodes: RendererResourceGraphNode[] = [];
		const dependencyReplacements: RendererResourceGraphDependencyReplacement[] =
			[];
		for (const record of changedRecords) {
			const sceneNodeKey = sceneObjectGraphNodeKey(record.drawUnitId);
			const materialNodeKey = materialDecisionGraphNodeKey(
				`${record.drawUnitId}/${record.material.key}`,
			);
			const assetIds = uniqueSortedStrings(record.preparedAssetIds);
			const preparedNodeKeys = assetIds.map(preparedAssetGraphNodeKey);
			nodes.push(
				{
					key: sceneNodeKey,
					kind: "scene-object",
					label: record.label,
					metadata: {
						drawUnitId: record.drawUnitId,
						materialKind: record.material.kind,
					},
				},
				{
					key: materialNodeKey,
					kind: "material-decision",
					label: record.material.key,
					metadata: {
						materialKind: record.material.kind,
						fallback: record.material.fallbackReason ?? null,
					},
				},
				...assetIds.map((assetId, index) => ({
					key: preparedNodeKeys[index],
					kind: "prepared-asset" as const,
					label: assetId,
				})),
			);
			dependencyReplacements.push(
				{
					nodeKey: sceneNodeKey,
					dependencyKeys: [materialNodeKey, ...preparedNodeKeys],
				},
				{
					nodeKey: materialNodeKey,
					dependencyKeys: preparedNodeKeys,
				},
			);
		}
		graph.applyBatchUpdate({ nodes, dependencyReplacements });
		for (const record of changedRecords) {
			const sceneNodeKey = sceneObjectGraphNodeKey(record.drawUnitId);
			if (!store.graphLeasesByBatchId.has(record.drawUnitId)) {
				store.graphLeasesByBatchId.set(
					record.drawUnitId,
					graph.leaseNode(sceneNodeKey, "luma scene assembly"),
				);
			}
			store.graphSignaturesByBatchId.set(
				record.drawUnitId,
				describeStagedWorldAssemblyGraphRecordSignature(record),
			);
		}
	}

	for (const [batchId, lease] of store.graphLeasesByBatchId) {
		if (retainedBatchIds.has(batchId)) {
			continue;
		}
		graph.releaseLease(lease);
		store.graphLeasesByBatchId.delete(batchId);
		store.graphSignaturesByBatchId.delete(batchId);
	}
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
