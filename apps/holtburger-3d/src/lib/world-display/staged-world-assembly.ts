import type { AssetChannelState } from "../assets/types";
import type { ResolvedMaterialSlot } from "./material-plan";
import {
	buildLumaPolygonSetGeometry,
	buildLumaTerrainGeometry,
	type LumaIndexedGeometry,
} from "./luma-geometry";
import {
	resolveStagedWorldSurfaceMaterialPlan,
	resolveStagedWorldMaterialSlotPlan,
	type StagedWorldMaterialPlan,
} from "./staged-world-materials";
import {
	buildAcPlacementMatrix,
	buildDebugColor,
	createTranslationMat4,
	multiplyMat4,
	type LumaMat4,
} from "./luma-math";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { RenderChunkTransform } from "./render-anchor";
import type { MaterialTextureCapabilities } from "./render-surface-texture-data";
import {
	deriveStructuredInteriorCellBatchBvhBinding,
	deriveTerrainTileBatchBvhBinding,
} from "./non-instanced-bvh-bindings";
import { deriveSceneRenderableReadinessModel } from "./scene-renderable-readiness";
import {
	type StaticRenderablePart,
	type StaticRenderableSceneModel,
} from "./static-renderables";
import { deriveStaticRenderablePartBvhItemKey } from "./static-renderable-bvh-bindings";
import { staticRenderableObjectKey } from "./static-renderable-readiness";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";
import type { TransitionPortalCandidateModel } from "./transition-portal-work-items";

export type StagedWorldDrawUnitGeometry = LumaIndexedGeometry;
export interface StagedWorldDrawUnitBvhBinding {
	itemKeys: readonly RenderBvhItemKey[];
	fallbackReason: string | null;
}

export interface StagedStaticDrawUnitAssembly {
	id: string;
	kind: "static";
	geometry: StagedWorldDrawUnitGeometry;
	modelMatrix: LumaMat4;
	material: StagedWorldMaterialPlan;
	preparedAssetIds: readonly string[];
	bvhBinding: StagedWorldDrawUnitBvhBinding;
	staticPartCount: number;
	staticObjectKeys: readonly string[];
}

export interface StagedTerrainDrawUnitAssembly {
	id: string;
	kind: "terrain";
	geometry: StagedWorldDrawUnitGeometry;
	modelMatrix: LumaMat4;
	material: StagedWorldMaterialPlan;
	preparedAssetIds: readonly string[];
	bvhBinding: StagedWorldDrawUnitBvhBinding;
	staticPartCount: 0;
	staticObjectKeys: readonly [];
}

export interface StagedStructuredInteriorDrawUnitAssembly {
	id: string;
	kind: "structured-interior";
	geometry: StagedWorldDrawUnitGeometry;
	modelMatrix: LumaMat4;
	material: StagedWorldMaterialPlan;
	preparedAssetIds: readonly string[];
	bvhBinding: StagedWorldDrawUnitBvhBinding;
	staticPartCount: 0;
	staticObjectKeys: readonly [];
}

export type StagedWorldDrawUnitAssembly =
	| StagedTerrainDrawUnitAssembly
	| StagedStaticDrawUnitAssembly
	| StagedStructuredInteriorDrawUnitAssembly;

export interface StagedWorldSceneAssembly {
	drawUnits: StagedWorldDrawUnitAssembly[];
	graphRecords: StagedWorldAssemblyGraphRecord[];
}

export interface StagedWorldAssemblyGraphRecord {
	drawUnitId: string;
	label: string;
	material: StagedWorldMaterialPlan;
	preparedAssetIds: readonly string[];
}

interface StaticRenderableObjectGroup {
	objectKey: string;
	parts: StaticRenderablePart[];
}

interface StagedStaticSurfaceKey {
	slotIndex: number | null;
	surfaceId: number | null;
	geometrySurfaceId: number | null;
	materialVariantSignature: string | null;
	materialSlot: ResolvedMaterialSlot | null;
}

export function buildStagedWorldSceneAssembly({
	assetState,
	terrainScene,
	staticRenderableScene,
	structuredInteriorScene,
	transitionPortalModel,
	renderChunkTransforms,
	materialTextureCapabilities,
}: {
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	transitionPortalModel: TransitionPortalCandidateModel;
	renderChunkTransforms: readonly RenderChunkTransform[];
	materialTextureCapabilities?: MaterialTextureCapabilities;
}): StagedWorldSceneAssembly {
	const chunkOffsetByKey = new Map(
		renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform.offset,
		]),
	);
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
	const terrainDrawUnits = buildStagedTerrainDrawUnitAssemblies({
		chunkOffsetByKey,
		terrainScene: fallbackCommittedScenes.committedTerrainScene,
	});
	const structuredInteriorDrawUnits =
		buildStagedStructuredInteriorDrawUnitAssemblies({
			assetState,
			chunkOffsetByKey,
			structuredInteriorScene:
				fullyResolvedScenes.committedStructuredInteriorScene,
			materialTextureCapabilities,
		});
	const staticDrawUnits = buildStagedStaticDrawUnitAssemblies({
		assetState,
		chunkOffsetByKey,
		staticRenderableScene: fullyResolvedScenes.committedStaticRenderableScene,
		materialTextureCapabilities,
	});
	return {
		drawUnits: [
			...terrainDrawUnits,
			...structuredInteriorDrawUnits,
			...staticDrawUnits,
		],
		graphRecords: [
			...structuredInteriorDrawUnits.map((drawUnit) => ({
				drawUnitId: drawUnit.id,
				label: `structured interior ${drawUnit.id}`,
				material: drawUnit.material,
				preparedAssetIds: drawUnit.preparedAssetIds,
			})),
			...staticDrawUnits.map((drawUnit) => ({
				drawUnitId: drawUnit.id,
				label: `staged static ${drawUnit.staticObjectKeys.join(", ")}`,
				material: drawUnit.material,
				preparedAssetIds: drawUnit.preparedAssetIds,
			})),
		],
	};
}

export function buildStagedTerrainDrawUnitAssemblies({
	chunkOffsetByKey,
	terrainScene,
}: {
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	terrainScene: TerrainSceneModel;
}): StagedTerrainDrawUnitAssembly[] {
	return terrainScene.tiles.flatMap((tile) => {
		const chunkOffset = chunkOffsetByKey.get(tile.renderChunk.chunkKey);
		if (!chunkOffset) {
			return [];
		}
		const geometry = buildLumaTerrainGeometry(tile.mesh);
		if (geometry.triangleCount === 0) {
			return [];
		}
		return [
			{
				id: `terrain/${tile.assetId}`,
				kind: "terrain",
				geometry,
				modelMatrix: createTranslationMat4({
					x: chunkOffset.x + tile.chunkLocalOffset.x,
					y: chunkOffset.y + tile.chunkLocalOffset.y,
					z: chunkOffset.z + tile.chunkLocalOffset.z,
				}),
				material: createFlatDebugStagedMaterial(`terrain/${tile.landblockId}`),
				preparedAssetIds: [],
				bvhBinding: deriveTerrainTileBatchBvhBinding(tile),
				staticPartCount: 0,
				staticObjectKeys: [],
			},
		];
	});
}

export function buildStagedStructuredInteriorDrawUnitAssemblies({
	assetState,
	chunkOffsetByKey,
	structuredInteriorScene,
	materialTextureCapabilities,
}: {
	assetState: AssetChannelState;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	structuredInteriorScene: StructuredInteriorSceneModel;
	materialTextureCapabilities?: MaterialTextureCapabilities;
}): StagedStructuredInteriorDrawUnitAssembly[] {
	return structuredInteriorScene.cells.flatMap((cell) => {
		const chunkOffset = chunkOffsetByKey.get(cell.renderChunk.chunkKey);
		if (!chunkOffset) {
			return [];
		}
		const chunkMatrix = createTranslationMat4(chunkOffset);
		const placementMatrix = buildAcPlacementMatrix(
			cell.chunkLocalPlacement,
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 1, z: 1 },
		);
		const modelMatrix = multiplyMat4(chunkMatrix, placementMatrix);
		return structuredInteriorSurfaceKeys(cell).flatMap((surfaceKey) => {
			const geometry = buildLumaPolygonSetGeometry(cell.renderGeometry, {
				surfaceId: surfaceKey.surfaceId,
				materialVariantSignature: surfaceKey.materialVariantSignature,
			});
			if (geometry.triangleCount === 0) {
				return [];
			}
			const material = resolveStagedWorldSurfaceMaterialPlan({
				assetState,
				surfaceId: surfaceKey.surfaceId,
				fallbackColorKey: `${cell.debugColorKey}:${surfaceKey.surfaceId ?? "none"}`,
				textureCapabilities: materialTextureCapabilities,
			});
			const drawUnitId = [
				"structured-interior",
				cell.renderKey,
				`surface=${surfaceKey.surfaceId ?? "none"}`,
				`variant=${surfaceKey.materialVariantSignature ?? "base"}`,
			].join("/");
			return [
				{
					id: drawUnitId,
					kind: "structured-interior",
					geometry,
					modelMatrix,
					material,
					preparedAssetIds: material.preparedAssetIds,
					bvhBinding: deriveStructuredInteriorCellBatchBvhBinding(cell),
					staticPartCount: 0,
					staticObjectKeys: [],
				},
			];
		});
	});
}

export function buildStagedStaticDrawUnitAssemblies({
	assetState,
	chunkOffsetByKey,
	staticRenderableScene,
	materialTextureCapabilities,
}: {
	assetState: AssetChannelState;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	staticRenderableScene: StaticRenderableSceneModel;
	materialTextureCapabilities?: MaterialTextureCapabilities;
}): StagedStaticDrawUnitAssembly[] {
	const objectsByBatchKey = groupCommittedStaticObjectsByBatchKey({
		chunkOffsetByKey,
		staticRenderableScene,
	});

	return [...objectsByBatchKey.entries()].flatMap(
		([batchKey, objectGroups]) =>
			objectGroups.flatMap((objectGroup) =>
				buildStagedStaticObjectDrawUnits({
					assetState,
					batchKey,
					chunkOffsetByKey,
					objectGroup,
					materialTextureCapabilities,
				}),
			),
	);
}

export function createFlatDebugStagedMaterial(
	colorKey: string,
): StagedWorldMaterialPlan {
	return {
		kind: "flat",
		key: `debug-flat/${colorKey}`,
		color: buildDebugColor(colorKey),
		behavior: null,
		fallbackReason: null,
		preparedAssetIds: [],
	};
}

export function describeStagedWorldAssemblyGraphRecordSignature(
	record: StagedWorldAssemblyGraphRecord,
): string {
	return [
		record.label,
		record.material.kind,
		record.material.key,
		record.material.fallbackReason ?? "none",
		...uniqueSortedStrings(record.preparedAssetIds),
	].join("|");
}

export function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))].sort();
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
		const batchKey = formatStagedStaticBatchKey(part);
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

function buildStagedStaticObjectDrawUnits({
	assetState,
	batchKey,
	chunkOffsetByKey,
	objectGroup,
	materialTextureCapabilities,
}: {
	assetState: AssetChannelState;
	batchKey: string;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	objectGroup: StaticRenderableObjectGroup;
	materialTextureCapabilities?: MaterialTextureCapabilities;
}): StagedStaticDrawUnitAssembly[] {
	return objectGroup.parts.flatMap((part) =>
		deriveStagedStaticSurfaceKeys(assetState, part).flatMap((surfaceKey) =>
			buildStagedStaticSurfaceDrawUnit({
				assetState,
				batchKey,
				chunkOffsetByKey,
				objectKey: objectGroup.objectKey,
				part,
				surfaceKey,
				materialTextureCapabilities,
			}),
		),
	);
}

function buildStagedStaticSurfaceDrawUnit({
	assetState,
	batchKey,
	chunkOffsetByKey,
	objectKey,
	part,
	surfaceKey,
	materialTextureCapabilities,
}: {
	assetState: AssetChannelState;
	batchKey: string;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	objectKey: string;
	part: StaticRenderablePart;
	surfaceKey: StagedStaticSurfaceKey;
	materialTextureCapabilities?: MaterialTextureCapabilities;
}): StagedStaticDrawUnitAssembly[] {
	const chunkOffset = chunkOffsetByKey.get(part.renderChunk.chunkKey);
	if (!chunkOffset) {
		return [];
	}
	const geometry = buildStagedStaticPartGeometry(assetState, part, surfaceKey);
	if (geometry.triangleCount === 0) {
		return [];
	}
	const surfaceBatchKey = formatStagedStaticSurfaceBatchKey(surfaceKey);
	const material = surfaceKey.materialSlot
		? resolveStagedWorldMaterialSlotPlan({
				assetState,
				slot: surfaceKey.materialSlot,
				fallbackColorKey: `${part.debugColorKey}:${surfaceBatchKey}`,
				renderableKind: "static",
				textureCapabilities: materialTextureCapabilities,
			})
		: createFlatDebugStagedMaterial(
				`static-staged/${batchKey}/${surfaceBatchKey}`,
			);
	const materialKey =
		material.kind === "direct-texture" ? material.textureKey : material.key;
	const drawUnitId = [
		"static-staged",
		batchKey,
		objectKey,
		part.renderKey,
		`part-${part.partIndex}`,
		surfaceBatchKey,
		materialKey,
	].join("/");
	return [
		{
			id: drawUnitId,
			kind: "static",
			geometry,
			modelMatrix: createTranslationMat4(chunkOffset),
			material,
			preparedAssetIds: [part.gfxObjAssetId, ...material.preparedAssetIds],
			bvhBinding: deriveStaticDrawUnitBvhBinding(drawUnitId, [part]),
			staticPartCount: 1,
			staticObjectKeys: [objectKey],
		},
	];
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

function deriveStagedStaticSurfaceKeys(
	assetState: AssetChannelState,
	part: StaticRenderablePart,
): StagedStaticSurfaceKey[] {
	if (part.materialSlots.length > 0) {
		return part.materialSlots
			.map((slot) => ({
				slotIndex: slot.slotIndex,
				surfaceId: slot.surfaceId,
				geometrySurfaceId: slot.slotIndex,
				materialVariantSignature: slot.materialVariantSignature ?? null,
				materialSlot: slot,
			}))
			.sort(compareStagedStaticSurfaceKeys);
	}

	const asset = assetState.preparedByAssetId[part.gfxObjAssetId];
	if (asset?.payload.kind !== "gfx-obj") {
		return [
			{
				slotIndex: null,
				surfaceId: null,
				geometrySurfaceId: null,
				materialVariantSignature: null,
				materialSlot: null,
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
			geometrySurfaceId: triangle.surfaceId,
			materialVariantSignature: triangle.materialVariantSignature ?? null,
			materialSlot: null,
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
		(left.geometrySurfaceId ?? -1) - (right.geometrySurfaceId ?? -1) ||
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
		`geometry-surface-${surfaceKey.geometrySurfaceId ?? "none"}`,
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
		return createEmptyIndexedGeometry();
	}
	const geometry = buildLumaPolygonSetGeometry(asset.payload.renderGeometry, {
		surfaceId: surfaceKey.geometrySurfaceId,
		materialVariantSignature: surfaceKey.materialVariantSignature,
	});
	if (geometry.triangleCount === 0) {
		return geometry;
	}

	const matrix = buildStaticRenderablePartMatrix(part);
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

function createEmptyIndexedGeometry(): LumaIndexedGeometry {
	return {
		positions: new Float32Array(),
		uvs: new Float32Array(),
		indices: new Uint16Array(),
		vertexCount: 0,
		triangleCount: 0,
	};
}

function deriveStaticDrawUnitBvhBinding(
	drawUnitId: string,
	parts: readonly StaticRenderablePart[],
): StagedWorldDrawUnitBvhBinding {
	const itemKeys = new Set<RenderBvhItemKey>();
	for (const part of parts) {
		const itemKey = deriveStaticRenderablePartBvhItemKey(part);
		if (!itemKey) {
			return {
				itemKeys: [],
				fallbackReason: `staged static draw unit ${drawUnitId} contains an unkeyed ${part.kind} part`,
			};
		}
		itemKeys.add(itemKey);
	}
	return {
		itemKeys: [...itemKeys],
		fallbackReason:
			itemKeys.size === 0
				? `staged static draw unit ${drawUnitId} contains no BVH item keys`
				: null,
	};
}

function formatStagedStaticBatchKey(part: StaticRenderablePart): string {
	return [part.renderDomain, part.renderChunk.chunkKey, "debug-flat"].join("|");
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

function buildStaticRenderablePartMatrix(part: StaticRenderablePart): LumaMat4 {
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
