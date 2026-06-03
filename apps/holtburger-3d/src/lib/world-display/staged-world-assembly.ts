import type {
	AssetChannelState,
	PreparedPolygonSetRenderGeometry,
} from "../assets/types";
import type { ResolvedMaterialSlot } from "./material-plan";
import type { IndexedMaterialDataCache } from "./indexed-material-data";
import { formatMaterialAssetId } from "./material-signatures";
import {
	buildStagedPolygonSetGeometry,
	buildStagedPortalApertureGeometry,
	type StagedWorldIndexedGeometry,
} from "./staged-world-geometry";
import {
	isTransientStagedMaterialPlan,
	resolveStagedWorldSurfaceMaterialPlan,
	resolveStagedWorldMaterialSlotPlan,
	type StagedWorldMaterialPlanCache,
	type StagedWorldMaterialPlan,
} from "./staged-world-materials";
import {
	buildAcPlacementMatrix,
	buildDebugColor,
	createTranslationMat4,
	multiplyMat4,
	type RenderMat4,
} from "./render-math";
import type { StaticRenderableRenderDomain } from "./render-domains";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { RenderChunkTransform } from "./render-anchor";
import type { MaterialTextureCapabilities } from "./render-surface-texture-data";
import {
	resolveRegionDetailOverlayPlan,
	type ResolvedRegionDetailOverlayPlan,
} from "./region-detail-overlays";
import {
	deriveStructuredInteriorCellBatchBvhBinding,
	deriveTransitionPortalMaskBatchBvhBinding,
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
import type { TextureFilteringMode } from "./texture-pages/texture-sampling-policy";
import type {
	TransitionPortalCandidate,
	TransitionPortalCandidateModel,
} from "./transition-portal-work-items";

type StagedWorldDrawUnitGeometry = StagedWorldIndexedGeometry;
interface StagedWorldDrawUnitBvhBinding {
	itemKeys: readonly RenderBvhItemKey[];
	fallbackReason: string | null;
}

export interface StagedStaticDrawUnitAssembly {
	id: string;
	kind: "static";
	renderDomain: StaticRenderableRenderDomain;
	owningLandblockId: number;
	geometry: StagedWorldDrawUnitGeometry;
	modelMatrix: RenderMat4;
	material: StagedWorldMaterialPlan;
	preparedAssetIds: readonly string[];
	bvhBinding: StagedWorldDrawUnitBvhBinding;
	staticPartCount: number;
	staticObjectKeys: readonly string[];
}

export interface StagedStructuredInteriorDrawUnitAssembly {
	id: string;
	kind: "structured-interior";
	owningLandblockId: number;
	geometry: StagedWorldDrawUnitGeometry;
	modelMatrix: RenderMat4;
	material: StagedWorldMaterialPlan;
	preparedAssetIds: readonly string[];
	bvhBinding: StagedWorldDrawUnitBvhBinding;
	staticPartCount: 0;
	staticObjectKeys: readonly [];
}

interface StagedPortalMaskDrawUnitAssembly {
	id: string;
	kind: "portal-mask";
	geometry: StagedWorldDrawUnitGeometry;
	modelMatrix: RenderMat4;
	material: StagedWorldMaterialPlan;
	preparedAssetIds: readonly string[];
	bvhBinding: StagedWorldDrawUnitBvhBinding;
	staticPartCount: 0;
	staticObjectKeys: readonly [];
	portalCandidate: TransitionPortalCandidate;
}

export type StagedWorldDrawUnitAssembly =
	| StagedStaticDrawUnitAssembly
	| StagedStructuredInteriorDrawUnitAssembly
	| StagedPortalMaskDrawUnitAssembly;

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

interface StagedMaterialSurfaceKey {
	slotIndex: number | null;
	surfaceId: number | null;
	geometrySurfaceId: number | null;
	materialVariantSignature: string | null;
	materialSlot: ResolvedMaterialSlot | null;
}

type StagedStaticSurfaceKey = StagedMaterialSurfaceKey;
type StagedStructuredInteriorSurfaceKey = StagedMaterialSurfaceKey;

export function buildStagedWorldSceneAssembly({
	assetState,
	terrainScene,
	staticRenderableScene,
	structuredInteriorScene,
	transitionPortalModel,
	renderChunkTransforms,
	materialTextureCapabilities,
	textureFilteringMode,
	detailTexturesEnabled = true,
	indexedMaterialDataCache,
	materialPlanCache,
}: {
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	transitionPortalModel: TransitionPortalCandidateModel;
	renderChunkTransforms: readonly RenderChunkTransform[];
	materialTextureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	detailTexturesEnabled?: boolean;
	indexedMaterialDataCache?: IndexedMaterialDataCache;
	materialPlanCache?: StagedWorldMaterialPlanCache;
}): StagedWorldSceneAssembly {
	const chunkOffsetByKey = new Map(
		renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform.offset,
		]),
	);
	const fullyResolvedScenes = deriveSceneRenderableReadinessModel({
		assetState,
		commitPolicy: "resolved-only",
		terrainScene,
		structuredInteriorScene,
		staticRenderableScene,
		transitionPortalModel,
	});
	const structuredInteriorDrawUnits =
		buildStagedStructuredInteriorDrawUnitAssemblies({
			assetState,
			chunkOffsetByKey,
			structuredInteriorScene:
				fullyResolvedScenes.committedStructuredInteriorScene,
			materialTextureCapabilities,
			textureFilteringMode,
			detailTexturesEnabled,
			indexedMaterialDataCache,
			materialPlanCache,
		});
	const staticDrawUnits = buildStagedStaticDrawUnitAssemblies({
		assetState,
		chunkOffsetByKey,
		staticRenderableScene: fullyResolvedScenes.committedStaticRenderableScene,
		materialTextureCapabilities,
		textureFilteringMode,
		detailTexturesEnabled,
		indexedMaterialDataCache,
		materialPlanCache,
	});
	const portalMaskDrawUnits = buildStagedPortalMaskDrawUnitAssemblies({
		chunkOffsetByKey,
		transitionPortalModel: fullyResolvedScenes.committedTransitionPortalModel,
	});
	return {
		drawUnits: [
			...structuredInteriorDrawUnits,
			...staticDrawUnits,
			...portalMaskDrawUnits,
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

function buildStagedPortalMaskDrawUnitAssemblies({
	chunkOffsetByKey,
	transitionPortalModel,
}: {
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	transitionPortalModel: TransitionPortalCandidateModel;
}): StagedPortalMaskDrawUnitAssembly[] {
	return transitionPortalModel.candidates.flatMap((candidate) => {
		const chunkOffset = chunkOffsetByKey.get(candidate.renderChunk.chunkKey);
		if (!chunkOffset || candidate.aperture.points.length < 3) {
			return [];
		}
		const bvhBinding = deriveTransitionPortalMaskBatchBvhBinding(candidate);
		return [
			{
				id: `portal-mask/${candidate.id}`,
				kind: "portal-mask",
				geometry: buildPortalMaskGeometry(candidate),
				modelMatrix: multiplyMat4(
					createTranslationMat4(chunkOffset),
					buildAcPlacementMatrix(
						candidate.aperture.chunkLocalPlacement,
						{ x: 0, y: 0, z: 0 },
						{ x: 1, y: 1, z: 1 },
					),
				),
				material: {
					kind: "flat",
					key: `portal-mask/${candidate.id}`,
					color: new Float32Array([0, 0, 0, 0]),
					behavior: null,
					fallbackReason: null,
					fallbackReasonCode: null,
					preparedAssetIds: [],
				},
				preparedAssetIds: [],
				bvhBinding: {
					itemKeys: bvhBinding.itemKeys,
					fallbackReason: bvhBinding.fallbackReason,
				},
				staticPartCount: 0,
				staticObjectKeys: [],
				portalCandidate: candidate,
			},
		];
	});
}

function buildPortalMaskGeometry(
	candidate: TransitionPortalCandidate,
): StagedWorldDrawUnitGeometry {
	return buildStagedPortalApertureGeometry(
		candidate.aperture.points,
		`portal-mask:${candidate.id}:points=${candidate.aperture.points.length}`,
	);
}

export function buildStagedStructuredInteriorDrawUnitAssemblies({
	assetState,
	chunkOffsetByKey,
	structuredInteriorScene,
	materialTextureCapabilities,
	textureFilteringMode,
	detailTexturesEnabled = true,
	indexedMaterialDataCache,
	materialPlanCache,
}: {
	assetState: AssetChannelState;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	structuredInteriorScene: StructuredInteriorSceneModel;
	materialTextureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	detailTexturesEnabled?: boolean;
	indexedMaterialDataCache?: IndexedMaterialDataCache;
	materialPlanCache?: StagedWorldMaterialPlanCache;
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
		const detailOverlay = detailTexturesEnabled
			? resolveRegionDetailOverlayPlan({
					assetState,
					regionNumber: cell.regionNumber,
					roleKind: "environment",
				})
			: null;
		return structuredInteriorSurfaceKeys(cell).flatMap((surfaceKey) => {
			const geometry = buildStagedPolygonSetGeometry(cell.renderGeometry, {
				surfaceId: surfaceKey.geometrySurfaceId,
				materialVariantSignature: surfaceKey.materialVariantSignature,
				sourceSignature: `env-cell:${cell.renderKey}`,
			});
			if (geometry.triangleCount === 0) {
				return [];
			}
			const material = surfaceKey.materialSlot
				? resolveStagedWorldMaterialSlotPlan({
						assetState,
						slot: surfaceKey.materialSlot,
						fallbackColorKey: `${cell.debugColorKey}:${formatStructuredInteriorSurfaceKey(surfaceKey)}`,
						renderableKind: "structured-interior",
						textureCapabilities: materialTextureCapabilities,
						textureFilteringMode,
						detailOverlay,
						indexedMaterialDataCache,
						materialPlanCache,
					})
				: resolveStagedWorldSurfaceMaterialPlan({
						assetState,
						surfaceId: surfaceKey.surfaceId,
						fallbackColorKey: `${cell.debugColorKey}:${formatStructuredInteriorSurfaceKey(surfaceKey)}`,
						textureCapabilities: materialTextureCapabilities,
						textureFilteringMode,
						indexedMaterialDataCache,
						materialPlanCache,
					});
			if (shouldDeferStagedMaterialPlan(material)) {
				return [];
			}
			const drawUnitId = [
				"structured-interior",
				cell.renderKey,
				formatStructuredInteriorSurfaceKey(surfaceKey),
				`variant=${surfaceKey.materialVariantSignature ?? "base"}`,
			].join("/");
			return [
				{
					id: drawUnitId,
					kind: "structured-interior",
					owningLandblockId: cell.renderChunk.chunkLandblockId,
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
	textureFilteringMode,
	detailTexturesEnabled = true,
	indexedMaterialDataCache,
	materialPlanCache,
}: {
	assetState: AssetChannelState;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	staticRenderableScene: StaticRenderableSceneModel;
	materialTextureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	detailTexturesEnabled?: boolean;
	indexedMaterialDataCache?: IndexedMaterialDataCache;
	materialPlanCache?: StagedWorldMaterialPlanCache;
}): StagedStaticDrawUnitAssembly[] {
	const objectsByBatchKey = groupCommittedStaticObjectsByBatchKey({
		chunkOffsetByKey,
		staticRenderableScene,
	});

	return [...objectsByBatchKey.entries()].flatMap(([batchKey, objectGroups]) =>
		objectGroups.flatMap((objectGroup) =>
			buildStagedStaticObjectDrawUnits({
				assetState,
				batchKey,
				chunkOffsetByKey,
				objectGroup,
				materialTextureCapabilities,
				textureFilteringMode,
				detailTexturesEnabled,
				indexedMaterialDataCache,
				materialPlanCache,
			}),
		),
	);
}

function createFlatDebugStagedMaterial(
	colorKey: string,
): StagedWorldMaterialPlan {
	return {
		kind: "flat",
		key: `debug-flat/${colorKey}`,
		color: buildDebugColor(colorKey),
		behavior: null,
		fallbackReason: null,
		fallbackReasonCode: null,
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
	textureFilteringMode,
	detailTexturesEnabled,
	indexedMaterialDataCache,
	materialPlanCache,
}: {
	assetState: AssetChannelState;
	batchKey: string;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	objectGroup: StaticRenderableObjectGroup;
	materialTextureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	detailTexturesEnabled: boolean;
	indexedMaterialDataCache?: IndexedMaterialDataCache;
	materialPlanCache?: StagedWorldMaterialPlanCache;
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
				textureFilteringMode,
				detailTexturesEnabled,
				indexedMaterialDataCache,
				materialPlanCache,
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
	textureFilteringMode,
	detailTexturesEnabled,
	indexedMaterialDataCache,
	materialPlanCache,
}: {
	assetState: AssetChannelState;
	batchKey: string;
	chunkOffsetByKey: ReadonlyMap<string, RenderChunkTransform["offset"]>;
	objectKey: string;
	part: StaticRenderablePart;
	surfaceKey: StagedStaticSurfaceKey;
	materialTextureCapabilities?: MaterialTextureCapabilities;
	textureFilteringMode?: TextureFilteringMode;
	detailTexturesEnabled: boolean;
	indexedMaterialDataCache?: IndexedMaterialDataCache;
	materialPlanCache?: StagedWorldMaterialPlanCache;
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
	const detailOverlay = detailTexturesEnabled
		? resolveStaticPartDetailOverlayPlan({ assetState, part })
		: null;
	const material = surfaceKey.materialSlot
		? resolveStagedWorldMaterialSlotPlan({
				assetState,
				slot: surfaceKey.materialSlot,
				fallbackColorKey: `${part.debugColorKey}:${surfaceBatchKey}`,
				renderableKind: "static",
				textureCapabilities: materialTextureCapabilities,
				textureFilteringMode,
				appearance: part.materialAppearanceContext,
				detailOverlay,
				indexedMaterialDataCache,
				materialPlanCache,
			})
		: createFlatDebugStagedMaterial(
				`static-staged/${batchKey}/${surfaceBatchKey}`,
			);
	if (shouldDeferStagedMaterialPlan(material)) {
		return [];
	}
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
			renderDomain: part.renderDomain,
			owningLandblockId: part.owningLandblockId,
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

function shouldDeferStagedMaterialPlan(
	material: StagedWorldMaterialPlan,
): boolean {
	return isTransientStagedMaterialPlan(material);
}

function resolveStaticPartDetailOverlayPlan({
	assetState,
	part,
}: {
	assetState: AssetChannelState;
	part: StaticRenderablePart;
}): ResolvedRegionDetailOverlayPlan | null {
	return resolveRegionDetailOverlayPlan({
		assetState,
		regionNumber: part.regionNumber,
		roleKind: part.detailRoleKind,
	});
}

function structuredInteriorSurfaceKeys(
	cell: StructuredInteriorSceneModel["cells"][number],
): StagedStructuredInteriorSurfaceKey[] {
	const keys = expandGeometryMaterialSurfaceKeys(
		cell.renderGeometry,
		cell.surfaceIds.map((surfaceId, slotIndex) => ({
			slotIndex,
			surfaceId,
			materialAssetId: formatMaterialAssetId(surfaceId),
			materialVariantSignature: null,
		})),
	);
	return [...keys.values()].sort((left, right) => {
		const leftSlot = left.slotIndex ?? -1;
		const rightSlot = right.slotIndex ?? -1;
		const leftGeometrySurface = left.geometrySurfaceId ?? -1;
		const rightGeometrySurface = right.geometrySurfaceId ?? -1;
		const leftMaterialSurface = left.surfaceId ?? -1;
		const rightMaterialSurface = right.surfaceId ?? -1;
		return (
			leftSlot - rightSlot ||
			leftGeometrySurface - rightGeometrySurface ||
			leftMaterialSurface - rightMaterialSurface ||
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
		const asset = assetState.preparedByAssetId[part.gfxObjAssetId];
		if (asset?.payload.kind === "gfx-obj") {
			return [
				...expandGeometryMaterialSurfaceKeys(
					asset.payload.renderGeometry,
					part.materialSlots,
				).values(),
			].sort(compareStagedStaticSurfaceKeys);
		}
		return part.materialSlots
			.map(materialSlotToSurfaceKey)
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

function expandGeometryMaterialSurfaceKeys(
	renderGeometry: PreparedPolygonSetRenderGeometry,
	materialSlots: readonly ResolvedMaterialSlot[],
): Map<string, StagedMaterialSurfaceKey> {
	const slotsByIndex = new Map(
		materialSlots.map((slot) => [slot.slotIndex, slot] as const),
	);
	const keys = new Map<string, StagedMaterialSurfaceKey>();
	for (const triangle of renderGeometry.triangles) {
		if (triangle.surfaceId === null) {
			continue;
		}
		const slot = slotsByIndex.get(triangle.surfaceId);
		if (!slot) {
			continue;
		}
		const materialVariantSignature =
			triangle.materialVariantSignature ??
			slot.materialVariantSignature ??
			null;
		const key = [
			slot.slotIndex,
			slot.surfaceId,
			triangle.surfaceId,
			materialVariantSignature ?? "base",
		].join("|");
		keys.set(key, {
			slotIndex: slot.slotIndex,
			surfaceId: slot.surfaceId,
			geometrySurfaceId: triangle.surfaceId,
			materialVariantSignature,
			materialSlot: {
				...slot,
				materialVariantSignature,
			},
		});
	}
	return keys;
}

function materialSlotToSurfaceKey(
	slot: ResolvedMaterialSlot,
): StagedStaticSurfaceKey {
	return {
		slotIndex: slot.slotIndex,
		surfaceId: slot.surfaceId,
		geometrySurfaceId: slot.slotIndex,
		materialVariantSignature: slot.materialVariantSignature ?? null,
		materialSlot: slot,
	};
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

function formatStructuredInteriorSurfaceKey(
	surfaceKey: StagedStructuredInteriorSurfaceKey,
): string {
	return [
		`slot=${surfaceKey.slotIndex ?? "none"}`,
		`surface=${surfaceKey.surfaceId ?? "none"}`,
		`geometry-surface=${surfaceKey.geometrySurfaceId ?? "none"}`,
	].join("|");
}

function buildStagedStaticPartGeometry(
	assetState: AssetChannelState,
	part: StaticRenderablePart,
	surfaceKey: StagedStaticSurfaceKey,
): StagedWorldIndexedGeometry {
	const asset = assetState.preparedByAssetId[part.gfxObjAssetId];
	if (
		!asset ||
		asset.payload.kind !== "gfx-obj" ||
		asset.payload.renderGeometry.vertexCount === 0
	) {
		return createEmptyIndexedGeometry();
	}
	const geometry = buildStagedPolygonSetGeometry(asset.payload.renderGeometry, {
		surfaceId: surfaceKey.geometrySurfaceId,
		materialVariantSignature: surfaceKey.materialVariantSignature,
		sourceSignature: `gfx-obj:${part.gfxObjAssetId}`,
	});
	if (geometry.triangleCount === 0) {
		return geometry;
	}

	const matrix = buildStaticRenderablePartMatrix(part);
	const positions = new Float32Array(geometry.positions.length);
	for (
		let vertexIndex = 0;
		vertexIndex < geometry.vertexCount;
		vertexIndex += 1
	) {
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
		signature: [
			geometry.signature,
			`part=${part.renderKey}`,
			`material=${part.materialSignature}`,
			`texture-velocity=${part.textureVelocitySignature}`,
			`detail=${part.detailSignature}`,
			`v=${geometry.vertexCount}`,
			`t=${geometry.triangleCount}`,
		].join("|"),
		positions,
	};
}

function createEmptyIndexedGeometry(): StagedWorldIndexedGeometry {
	return {
		signature: "empty",
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
	matrix: RenderMat4,
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

export function buildStaticRenderablePartMatrix(
	part: StaticRenderablePart,
): RenderMat4 {
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

function createIdentityMat4(): RenderMat4 {
	return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function createScaleMat4(scale: {
	x: number;
	y: number;
	z: number;
}): RenderMat4 {
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
