import {
	getPreparedAssetDependencies,
	type PreparedAssetRecord,
	type PreparedGfxObjPayload,
	type PreparedRegionDetailRole,
	type PreparedRenderSurfacePayload,
	type PreparedSetupAppearancePayload,
	type PreparedSetupModelPayload,
} from "../assets/types";
import { collectLandblockOutdoorRenderableSourceAssetIdsForDomain } from "../assets/structured-asset-dependencies";
import {
	formatEnvCellAssetId,
	formatHex32,
	formatLandblockOutdoorAssetId,
	formatLandblockTopologyAssetId,
	formatRegionRenderProfileAssetId,
	normalizeOutdoorLandblockId,
} from "../landblocks";
import type { PlacementTransformDto, Vec3Dto } from "../host/contracts";
import { resolveNormalizedPreparedTextureAssetIds } from "../assets/material-texture-preparation-policy";
import {
	formatStaticObjectBundleScopeKey,
	type StaticBundleCompactedBatch,
	type StaticBundleDirectEntry,
	type StaticBundleLayerWorkerJob,
	type StaticBundleMaterialRecord,
	type StaticBundleObjectRecord,
	type StaticBundleRenderChunk,
	type StaticBundleSpatialHint,
	type StaticLandblockBundleLayerDiagnostics,
	type StaticMaterialDetailOverlayDescriptor,
	type StaticObjectBundleArtifact,
	type VirtualTexturePageRef,
} from "./static-bundle-layer";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import {
	createCompactionEligibility,
	type CompactionEligibility,
} from "./compaction/compaction-family-planner";
import {
	buildAcPlacementMatrix,
	multiplyMat4,
	transformPointByMat4,
	type RenderMat4,
} from "./render-math";
import { buildPolygonSetRenderGeometry } from "./indexed-render-geometry";
import {
	applyRenderGeometryMaterialVariants,
	type ResolvedMaterialSlot,
} from "./material-plan";
import { formatMaterialAssetId } from "./material-signatures";
import type { AtlasLayoutPolicy } from "./texture-pages/atlas-layout-planner";
import { buildStaticBundleLayerTexturePages } from "./static-bundle-layer-texture-pages";
import {
	resolveRegionDetailRolePolicy,
	type RegionDetailRoleKind,
} from "./region-detail-overlays";
import {
	collectStaticMaterialTexturePageRefs,
	collectStaticMaterialTextureRoutes,
	collectStaticPreparedTextureRouteAssetIds,
	createStaticMaterialFamilyDescriptor,
	findStaticMaterialTextureRefs,
	formatStaticMaterialFamilyKey,
	resolveStaticMaterialColor,
	resolveStaticIndexedMaterialRecord,
	resolveStaticMaterialReadiness,
	type StaticMaterialFamilyDescriptor,
	type StaticMaterialTextureRoute,
	type StaticMaterialTextureRouteRequest,
} from "./static-material-artifacts";

interface StaticBundleLayerBuildPolicy {
	buildPolicyRevision: string;
	cpuTexturePagePolicyRevision: string;
	atlasLayout: AtlasLayoutPolicy;
}

export interface BuildStaticBundleLayerOptions {
	job: StaticBundleLayerWorkerJob;
	preparedAssets: readonly PreparedAssetRecord[];
	policy: StaticBundleLayerBuildPolicy;
}

interface StaticBundleSourceObject {
	objectKey: string;
	visibilityKey: RenderBvhItemKey;
	sourceAssetId: string;
	owningLandblockId: number;
	owningEnvCellId: number | null;
	regionNumber: number;
	kind: StaticBundleObjectRecord["kind"];
	sourceBounds: StaticBundleSpatialHint["bounds"] | null;
	bounds: StaticBundleSpatialHint["bounds"] | null;
	localPlacement: PlacementTransformDto;
	sourceScale: Vec3Dto;
	parts: readonly StaticBundleSourcePart[];
}

interface StaticBundleSourcePart {
	partIndex: number;
	gfxObjId: number;
	gfxObjAssetId: string;
	materialSlots: readonly ResolvedMaterialSlot[];
	sourceMaterialSlotCount: number;
	sourceRenderTriangleCount: number;
	sourceSkippedPolygonCount: number;
	sourceInvalidPolygonCount: number;
	sourcePhysicsPolygonCount: number;
	partPlacements: readonly PlacementTransformDto[];
	scale: Vec3Dto;
}

const ZERO_VEC3: Vec3Dto = { x: 0, y: 0, z: 0 };
const UNIT_SCALE: Vec3Dto = { x: 1, y: 1, z: 1 };

interface StaticBundleBuildSurface {
	key: string;
	object: StaticBundleSourceObject;
	gfxObjAssetId: string;
	materialAssetId: string;
	materialRecordKey: string;
	materialTextureRecordKey: string;
	materialVariantSignature: string | null;
	textureRefKeys: readonly string[];
	detailOverlay: StaticMaterialDetailOverlayDescriptor | null;
	detailTextureRefKey: string | null;
	detailTiling: number;
	compactable: boolean;
	reason: string | null;
	familyKey: string;
	family: StaticMaterialFamilyDescriptor;
	color: readonly [number, number, number, number];
	isTransparent: boolean;
	compactionEligibility: CompactionEligibility;
	positions: Float32Array;
	normals: Float32Array;
	uvs: Float32Array;
	indices: Uint16Array | Uint32Array;
}

interface StaticBundleGeometrySurface {
	key: string;
	object: StaticBundleSourceObject;
	gfxObjAssetId: string;
	slot: ResolvedMaterialSlot;
	materialAssetId: string;
	materialTextureRecordKey: string;
	materialVariantSignature: string | null;
	positions: Float32Array;
	normals: Float32Array;
	uvs: Float32Array;
	indices: Uint16Array | Uint32Array;
	triangleCount: number;
}

export function buildStaticObjectBundleArtifact({
	job,
	preparedAssets,
	policy,
}: BuildStaticBundleLayerOptions): StaticObjectBundleArtifact {
	if (job.buildPolicyRevision !== policy.buildPolicyRevision) {
		throw new Error(
			`Static bundle job build policy ${job.buildPolicyRevision} does not match builder policy ${policy.buildPolicyRevision}.`,
		);
	}
	if (
		job.cpuTexturePagePolicyRevision !== policy.cpuTexturePagePolicyRevision
	) {
		throw new Error(
			`Static bundle job texture-page policy ${job.cpuTexturePagePolicyRevision} does not match builder policy ${policy.cpuTexturePagePolicyRevision}.`,
		);
	}

	const preparedByAssetId = new Map(
		preparedAssets.map((asset) => [asset.request.assetId, asset] as const),
	);
	const sourceObjects = collectStaticBundleSourceObjects(
		job,
		preparedByAssetId,
	);
	const workerPreparedAssetIds = collectWorkerPreparedDependencyIds(
		job,
		preparedByAssetId,
	);
	const candidateSurfaces = sourceObjects.flatMap((object) =>
		buildObjectGeometrySurfaces(object, preparedByAssetId),
	);
	const renderSurfaces = candidateSurfaces.filter(isRenderUsedGeometrySurface);
	const materialTextureRoutes = collectStaticMaterialTextureRoutes(
		collectStaticBundleMaterialRouteRequests(renderSurfaces),
		preparedByAssetId,
	);
	const materialTexturePageRefs = collectStaticMaterialTexturePageRefs(
		materialTextureRoutes,
		preparedByAssetId,
	);
	const detailTexturePageRefs = collectStaticBundleDetailTexturePageRefs({
		sourceObjects: collectRenderedSourceObjects(renderSurfaces),
		preparedByAssetId,
	});
	const texturePageRefs = uniqueTexturePageRefs([
		...materialTexturePageRefs,
		...detailTexturePageRefs,
	]);
	const texturePages = buildStaticBundleLayerTexturePages({
		scopeKey: formatStaticObjectBundleScopeKey(job.scope),
		texturePageRefs,
		policy: policy.atlasLayout,
	});
	const surfaces = renderSurfaces.map((surface) =>
		finalizeObjectSurface({
			surface,
			preparedByAssetId,
			texturePageRefs,
			materialTextureRoutes,
		}),
	);
	const renderChunk = createRenderChunk(job);
	const materialRecords = buildMaterialRecords({
		surfaces,
		materialTextureRoutes,
		preparedByAssetId,
	});
	const compactedBatches = buildCompactedBatches(renderChunk.key, surfaces);
	const directEntries = buildDirectEntries(renderChunk.key, surfaces);
	const objectRecords = sourceObjects.map(
		(object): StaticBundleObjectRecord => ({
			objectKey: object.objectKey,
			visibilityKeys: [object.visibilityKey],
			sourceAssetId: object.sourceAssetId,
			owningLandblockId: object.owningLandblockId,
			owningEnvCellId: object.owningEnvCellId,
			kind: object.kind,
			sourceBounds: object.sourceBounds,
			instanceBounds: object.bounds,
			localPlacement: object.localPlacement,
			sourceScale: object.sourceScale,
			partHints: object.parts.map((part) => ({
				renderKey: `${object.objectKey}:part:${part.partIndex}`,
				partIndex: part.partIndex,
				gfxObjAssetId: part.gfxObjAssetId,
				materialSlotCount: part.sourceMaterialSlotCount,
				renderMaterialSlotCount: part.materialSlots.length,
				sourceRenderTriangleCount: part.sourceRenderTriangleCount,
				sourceSkippedPolygonCount: part.sourceSkippedPolygonCount,
				sourceInvalidPolygonCount: part.sourceInvalidPolygonCount,
				sourcePhysicsPolygonCount: part.sourcePhysicsPolygonCount,
			})),
		}),
	);
	const spatialHints = buildSpatialHints(sourceObjects);
	const diagnostics = buildDiagnostics({
		sourceObjectCount: sourceObjects.length,
		candidateSurfaceCount: candidateSurfaces.length,
		surfaces,
	});

	return {
		artifactKind: "static-object-bundle",
		key: `static-bundle-layer:${formatStaticObjectBundleScopeKey(job.scope)}:${job.sourceRevision}`,
		scope: job.scope,
		landblockId: job.scope.landblockId,
		bundleKind: job.scope.bundleKind,
		sourceRevision: job.sourceRevision,
		rootAssetIds: [...job.rootAssetIds].sort(),
		preparedAssetIds: workerPreparedAssetIds,
		renderChunks: [renderChunk],
		compactedBatches,
		directEntries,
		materialRecords,
		texturePageRefs,
		texturePages,
		objectRecords,
		spatialHints,
		diagnostics,
	};
}

export function collectWorkerPreparedDependencyIds(
	job: StaticBundleLayerWorkerJob,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): string[] {
	const visitedAssetIds = new Set<string>();
	const queue = [...job.rootAssetIds].sort();
	while (queue.length > 0) {
		const assetId = queue.shift();
		if (!assetId) {
			continue;
		}
		if (visitedAssetIds.has(assetId)) {
			continue;
		}
		visitedAssetIds.add(assetId);
		const asset = preparedByAssetId.get(assetId);
		if (!asset) {
			throw new Error(
				`Static bundle closure is missing required asset ${assetId}.`,
			);
		}
		for (const dependency of getStaticBundlePreparedAssetDependencies(
			job,
			asset,
		)) {
			if (!visitedAssetIds.has(dependency.assetId)) {
				queue.push(dependency.assetId);
			}
		}
		for (const preparedTextureAssetId of collectStaticPreparedTextureRouteAssetIds(
			asset,
			preparedByAssetId,
		)) {
			if (!visitedAssetIds.has(preparedTextureAssetId)) {
				queue.push(preparedTextureAssetId);
			}
		}
		for (const companionAssetId of collectSetupAppearanceCompanionAssetIds(
			asset,
		)) {
			if (!visitedAssetIds.has(companionAssetId)) {
				queue.push(companionAssetId);
			}
		}
		queue.sort();
	}
	return [...visitedAssetIds].sort();
}

function getStaticBundlePreparedAssetDependencies(
	job: StaticBundleLayerWorkerJob,
	asset: PreparedAssetRecord,
): { assetId: string }[] {
	if (
		job.scope.kind === "landblock" &&
		asset.payload.kind === "landblock-outdoor"
	) {
		return uniqueSortedStrings([
			formatRegionRenderProfileAssetId(asset.payload.regionNumber),
			...collectLandblockOutdoorRenderableSourceAssetIdsForDomain(
				asset.payload,
				job.scope.bundleKind,
			),
		]).map((assetId) => ({ assetId }));
	}
	return getPreparedAssetDependencies(asset);
}

function collectStaticBundleSourceObjects(
	job: StaticBundleLayerWorkerJob,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): StaticBundleSourceObject[] {
	if (job.scope.kind === "landblock") {
		const outdoorAssetId = formatLandblockOutdoorAssetId(job.scope.landblockId);
		assertRootIncludes(job, outdoorAssetId);
		const outdoor = getPreparedPayload(
			preparedByAssetId,
			outdoorAssetId,
			"landblock-outdoor",
		);
		return outdoor.statics
			.filter((member) =>
				job.scope.bundleKind === "outdoor-buildings"
					? member.kind === "building"
					: member.kind !== "building",
			)
			.map(
				(member): StaticBundleSourceObject => ({
					objectKey: `outdoor-static:${formatHex32(job.scope.landblockId)}:${member.instanceId}`,
					visibilityKey: `outdoor-static:landblock:${formatHex32(job.scope.landblockId)}:instance:${member.instanceId}`,
					sourceAssetId: member.sourceAssetId,
					owningLandblockId: normalizeOutdoorLandblockId(outdoor.landblockId),
					owningEnvCellId: null,
					regionNumber: outdoor.regionNumber,
					kind:
						member.kind === "building"
							? "building"
							: member.kind === "generated-scenery"
								? "generated-scenery"
								: "scenery",
					sourceBounds: member.sourceBounds,
					bounds: member.instanceBounds,
					localPlacement: member.localPlacement,
					sourceScale: member.sourceScale,
					parts: collectStaticBundleSourceParts(
						member.sourceAssetId,
						preparedByAssetId,
					),
				}),
			);
	}

	const topologyAssetId = formatLandblockTopologyAssetId(job.scope.landblockId);
	const envCellScope = job.scope;
	const envCellAssetId = formatEnvCellAssetId(envCellScope.envCellId);
	assertRootIncludes(job, topologyAssetId);
	assertRootIncludes(job, envCellAssetId);
	const envCell = getPreparedPayload(
		preparedByAssetId,
		envCellAssetId,
		"env-cell",
	);
	return envCell.statics.map(
		(member): StaticBundleSourceObject => ({
			objectKey: `env-static:${formatHex32(envCellScope.envCellId)}:${member.instanceId}`,
			visibilityKey: `env-static:cell:${formatHex32(envCellScope.envCellId)}:instance:${member.instanceId}`,
			sourceAssetId: member.sourceAssetId,
			owningLandblockId: normalizeOutdoorLandblockId(job.scope.landblockId),
			owningEnvCellId: envCellScope.envCellId,
			regionNumber: envCell.regionNumber,
			kind: "indoor-static",
			sourceBounds: member.sourceBounds,
			bounds: member.instanceBounds,
			localPlacement: member.localPlacement,
			sourceScale: member.sourceScale,
			parts: collectStaticBundleSourceParts(
				member.sourceAssetId,
				preparedByAssetId,
			),
		}),
	);
}

function buildSpatialHints(
	sourceObjects: readonly StaticBundleSourceObject[],
): StaticBundleSpatialHint[] {
	return sourceObjects
		.filter(
			(object): object is StaticBundleSourceObject & {
				bounds: NonNullable<StaticBundleSourceObject["bounds"]>;
			} => object.bounds !== null,
		)
		.map((object) => ({
			key: object.objectKey,
			visibilityKeys: [object.visibilityKey],
			bounds: object.bounds,
		}))
		.sort((left, right) => left.key.localeCompare(right.key));
}

function collectStaticBundleSourceParts(
	sourceAssetId: string,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): StaticBundleSourcePart[] {
	const source = getPreparedAsset(preparedByAssetId, sourceAssetId);
	if (source.payload.kind === "gfx-obj") {
		return [
			createStaticBundleSourcePartFromGfxObj({
				gfxObj: source.payload,
				gfxObjAssetId: sourceAssetId,
				partIndex: 0,
				partPlacements: [],
				scale: UNIT_SCALE,
			}),
		];
	}
	if (source.payload.kind !== "setup-model") {
		throw new Error(`Static bundle source ${sourceAssetId} is not renderable.`);
	}
	const setupModel = source.payload;
	const setupAppearance = preparedByAssetId.get(
		formatSetupAppearanceAssetId(setupModel.setupModelId),
	);
	if (setupAppearance?.payload.kind === "setup-appearance") {
		return collectSetupAppearanceBundleSourceParts({
			setupModel,
			setupAppearance: setupAppearance.payload,
			preparedByAssetId,
		});
	}
	return setupModel.parts.flatMap((part) => {
		const gfxObj = preparedByAssetId.get(part.gfxObjAssetId);
		if (gfxObj?.payload.kind !== "gfx-obj") {
			return [];
		}
		return [
			createStaticBundleSourcePartFromGfxObj({
				gfxObj: gfxObj.payload,
				gfxObjAssetId: part.gfxObjAssetId,
				partIndex: part.partIndex,
				partPlacements: deriveSetupPartDefaultPlacements(
					setupModel,
					part.partIndex,
				),
				scale: part.scale ?? UNIT_SCALE,
			}),
		];
	});
}

function collectSetupAppearanceBundleSourceParts({
	setupModel,
	setupAppearance,
	preparedByAssetId,
}: {
	setupModel: PreparedSetupModelPayload;
	setupAppearance: PreparedSetupAppearancePayload;
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): StaticBundleSourcePart[] {
	return setupAppearance.parts.flatMap((part) => {
		const gfxObj = preparedByAssetId.get(part.gfxObjAssetId);
		if (gfxObj?.payload.kind !== "gfx-obj") {
			return [];
		}
		const setupPart = setupModel.parts.find(
			(candidate) => candidate.partIndex === part.partIndex,
		);
		return [
			{
				partIndex: part.partIndex,
				gfxObjId: part.gfxObjId,
				gfxObjAssetId: part.gfxObjAssetId,
				materialSlots: applyRenderGeometryMaterialVariants({
					slots: part.materialSlots,
					renderGeometry: gfxObj.payload.renderGeometry,
				}),
				sourceMaterialSlotCount: part.materialSlots.length,
				sourceRenderTriangleCount: gfxObj.payload.renderGeometry.triangleCount,
				sourceSkippedPolygonCount:
					gfxObj.payload.renderGeometry.skippedPolygonCount ?? 0,
				sourceInvalidPolygonCount:
					gfxObj.payload.renderGeometry.invalidPolygons?.length ?? 0,
				sourcePhysicsPolygonCount:
					gfxObj.payload.physicsWitness.polygonCount,
				partPlacements: deriveSetupPartDefaultPlacements(
					setupModel,
					part.partIndex,
				),
				scale: setupPart?.scale ?? UNIT_SCALE,
			},
		];
	});
}

function createStaticBundleSourcePartFromGfxObj({
	gfxObj,
	gfxObjAssetId,
	partIndex,
	partPlacements,
	scale,
}: {
	gfxObj: PreparedGfxObjPayload;
	gfxObjAssetId: string;
	partIndex: number;
	partPlacements: readonly PlacementTransformDto[];
	scale: Vec3Dto;
}): StaticBundleSourcePart {
	return {
		partIndex,
		gfxObjId: gfxObj.gfxObjId,
		gfxObjAssetId,
		materialSlots: applyRenderGeometryMaterialVariants({
			slots: gfxObj.surfaceIds.map((surfaceId, slotIndex) => ({
				slotIndex,
				surfaceId,
				materialAssetId: formatMaterialAssetId(surfaceId),
			})),
			renderGeometry: gfxObj.renderGeometry,
		}),
		sourceMaterialSlotCount: gfxObj.surfaceIds.length,
		sourceRenderTriangleCount: gfxObj.renderGeometry.triangleCount,
		sourceSkippedPolygonCount: gfxObj.renderGeometry.skippedPolygonCount ?? 0,
		sourceInvalidPolygonCount:
			gfxObj.renderGeometry.invalidPolygons?.length ?? 0,
		sourcePhysicsPolygonCount: gfxObj.physicsWitness.polygonCount,
		partPlacements,
		scale,
	};
}

function collectStaticBundleMaterialRouteRequests(
	surfaces: readonly StaticBundleGeometrySurface[],
): StaticMaterialTextureRouteRequest[] {
	return surfaces.map((surface) => ({
		materialAssetId: surface.materialAssetId,
		materialRecordKey: surface.materialTextureRecordKey,
		materialVariantSignature: surface.materialVariantSignature,
	}));
}

function collectRenderedSourceObjects(
	surfaces: readonly StaticBundleGeometrySurface[],
): StaticBundleSourceObject[] {
	const objectsByKey = new Map<string, StaticBundleSourceObject>();
	for (const surface of surfaces) {
		objectsByKey.set(surface.object.objectKey, surface.object);
	}
	return [...objectsByKey.values()].sort((left, right) =>
		left.objectKey.localeCompare(right.objectKey),
	);
}

function collectStaticBundleDetailTexturePageRefs({
	sourceObjects,
	preparedByAssetId,
}: {
	sourceObjects: readonly StaticBundleSourceObject[];
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): VirtualTexturePageRef[] {
	return uniqueTexturePageRefs(
		sourceObjects
			.map((object) =>
				resolveStaticBundleObjectDetailTextureRef({
					object,
					preparedByAssetId,
				}),
			)
			.filter((ref): ref is VirtualTexturePageRef => ref !== null),
	);
}

function resolveStaticBundleObjectDetailTextureRef({
	object,
	preparedByAssetId,
}: {
	object: StaticBundleSourceObject;
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): VirtualTexturePageRef | null {
	const roleKind = staticBundleDetailRoleKindForObject(object);
	if (!roleKind || !resolveRegionDetailRolePolicy(roleKind)) {
		return null;
	}
	const role = resolveStaticBundleObjectDetailRole({
		object,
		preparedByAssetId,
	});
	if (!role || role.tiling <= 0) {
		return null;
	}
	const renderSurface = resolveStaticBundleDetailRenderSurface({
		role,
		preparedByAssetId,
	});
	if (!renderSurface) {
		return null;
	}
	const preparedTextureAssetId = resolveNormalizedPreparedTextureAssetIds({
		renderSurface,
		usage: "detail",
	})[0];
	if (!preparedTextureAssetId) {
		return null;
	}
	const preparedTexture = getPreparedPayload(
		preparedByAssetId,
		preparedTextureAssetId,
		"prepared-texture",
	);
	const level = preparedTexture.levels[0];
	if (!level) {
		throw new Error(
			`Static bundle detail texture ${preparedTextureAssetId} has no mip level 0.`,
		);
	}
	return {
		key: formatStaticBundleDetailTextureRefKey({
			regionNumber: object.regionNumber,
			roleKind,
			preparedTextureAssetId,
		}),
		sourceAssetId: preparedTextureAssetId,
		role: "detail",
		sampleClass: "rgba-color",
		width: level.width,
		height: level.height,
		wrapS: "repeat",
		wrapT: "repeat",
		samplingDomain: "color",
		lookup: "color-filtered",
		bytes: level.bytes,
	};
}

function resolveStaticBundleObjectDetailRole({
	object,
	preparedByAssetId,
}: {
	object: StaticBundleSourceObject;
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): PreparedRegionDetailRole | null {
	const profile = preparedByAssetId.get(
		formatRegionRenderProfileAssetId(object.regionNumber),
	);
	if (profile?.payload.kind !== "region-render-profile") {
		return null;
	}
	if (profile.payload.regionNumber !== object.regionNumber) {
		return null;
	}
	const roleKind = staticBundleDetailRoleKindForObject(object);
	return roleKind ? profile.payload.detailRoles[roleKind] : null;
}

function resolveStaticBundleDetailRenderSurface({
	role,
	preparedByAssetId,
}: {
	role: PreparedRegionDetailRole;
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): PreparedRenderSurfacePayload | null {
	const surfaceTexture = preparedByAssetId.get(role.textureAssetId);
	if (surfaceTexture?.payload.kind !== "surface-texture") {
		return null;
	}
	const preferredRenderSurfaceIds =
		surfaceTexture.payload.renderSurfaceIds.length <= 1
			? [
					...surfaceTexture.payload.renderSurfaceIds,
					...(surfaceTexture.payload.selectedRenderSurfaceId === null
						? []
						: [surfaceTexture.payload.selectedRenderSurfaceId]),
				]
			: [
					surfaceTexture.payload.renderSurfaceIds[1],
					...surfaceTexture.payload.renderSurfaceIds.slice(2),
					surfaceTexture.payload.renderSurfaceIds[0],
					...(surfaceTexture.payload.selectedRenderSurfaceId === null
						? []
						: [surfaceTexture.payload.selectedRenderSurfaceId]),
				];
	for (const renderSurfaceId of preferredRenderSurfaceIds) {
		if (renderSurfaceId === undefined) {
			continue;
		}
		const renderSurface = preparedByAssetId.get(
			`render-surface/${formatHex32(renderSurfaceId)}`,
		);
		if (renderSurface?.payload.kind === "render-surface") {
			return renderSurface.payload;
		}
	}
	return null;
}

function staticBundleDetailRoleKindForObject(
	object: StaticBundleSourceObject,
): RegionDetailRoleKind | null {
	return object.kind === "building" ? "building" : null;
}

function formatStaticBundleDetailTextureRefKey({
	regionNumber,
	roleKind,
	preparedTextureAssetId,
}: {
	regionNumber: number;
	roleKind: RegionDetailRoleKind;
	preparedTextureAssetId: string;
}): string {
	return [
		"texture",
		"region-detail",
		regionNumber,
		roleKind,
		preparedTextureAssetId,
	].join(":");
}

function resolveStaticBundleObjectDetail({
	object,
	texturePageRefs,
	preparedByAssetId,
}: {
	object: StaticBundleSourceObject;
	texturePageRefs: readonly VirtualTexturePageRef[];
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): StaticMaterialDetailOverlayDescriptor | null {
	const roleKind = staticBundleDetailRoleKindForObject(object);
	if (!roleKind) {
		return null;
	}
	const policy = resolveRegionDetailRolePolicy(roleKind);
	if (!policy) {
		return null;
	}
	const role = resolveStaticBundleObjectDetailRole({
		object,
		preparedByAssetId,
	});
	if (!role || role.tiling <= 0) {
		return null;
	}
	const detailRef = resolveStaticBundleObjectDetailTextureRef({
		object,
		preparedByAssetId,
	});
	if (!detailRef || !texturePageRefs.some((ref) => ref.key === detailRef.key)) {
		return null;
	}
	return {
		textureRefKey: detailRef.key,
		roleKind,
		blendMode: policy.blendMode,
		fadeMode: policy.fadeMode,
		tiling: role.tiling,
		fadeNear: role.fadeNear,
		fadeFar: role.fadeFar,
	};
}

function formatStaticBundleMaterialTextureRecordKey(
	slot: Pick<
		ResolvedMaterialSlot,
		"materialAssetId" | "materialVariantSignature"
	>,
): string {
	return [
		`material:${slot.materialAssetId}`,
		`variant:${slot.materialVariantSignature ?? "base"}`,
	].join(":");
}

function formatStaticBundleMaterialRecordKey(options: {
	slot: Pick<
		ResolvedMaterialSlot,
		"materialAssetId" | "materialVariantSignature"
	>;
	detailTextureRefKey: string | null;
}): string {
	const base = formatStaticBundleMaterialTextureRecordKey(options.slot);
	return options.detailTextureRefKey
		? `${base}:detail=${options.detailTextureRefKey}`
		: base;
}

function buildObjectGeometrySurfaces(
	object: StaticBundleSourceObject,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): StaticBundleGeometrySurface[] {
	return object.parts.flatMap((part) => {
		const gfxObj = getPreparedPayload(
			preparedByAssetId,
			part.gfxObjAssetId,
			"gfx-obj",
		);
		return part.materialSlots.map((slot) =>
			buildObjectGeometrySurface({
				object,
				part,
				gfxObj,
				slot,
			}),
		);
	});
}

function buildObjectGeometrySurface({
	object,
	part,
	gfxObj,
	slot,
}: {
	object: StaticBundleSourceObject;
	part: StaticBundleSourcePart;
	gfxObj: PreparedGfxObjPayload;
	slot: ResolvedMaterialSlot;
}): StaticBundleGeometrySurface {
	const materialTextureRecordKey = formatStaticBundleMaterialTextureRecordKey(slot);
	const geometry = buildPolygonSetRenderGeometry(gfxObj.renderGeometry, {
		surfaceId: slot.slotIndex,
		materialVariantSignature: slot.materialVariantSignature ?? null,
		sourceSignature: `${object.objectKey}:part:${part.partIndex}:${part.gfxObjAssetId}`,
	});
	const modelMatrix = createStaticBundleSourcePartMatrix(object, part);
	const positions = transformStaticBundlePositions(
		geometry.positions,
		modelMatrix,
	);
	const normals = transformStaticBundleNormals(
		geometry.positions,
		geometry.normals ?? new Float32Array(),
		modelMatrix,
	);
	const uvs = geometry.uvs ?? new Float32Array();
	return {
		key: [
			object.objectKey,
			`part:${part.partIndex}`,
			part.gfxObjAssetId,
			`slot:${slot.slotIndex}`,
			`surface:${formatHex32(slot.surfaceId)}`,
			`variant:${slot.materialVariantSignature ?? "base"}`,
		].join(":"),
		object,
		gfxObjAssetId: part.gfxObjAssetId,
		slot,
		materialAssetId: slot.materialAssetId,
		materialTextureRecordKey,
		materialVariantSignature: slot.materialVariantSignature ?? null,
		positions,
		normals,
		uvs,
		indices: geometry.indices,
		triangleCount: geometry.triangleCount,
	};
}

function isRenderUsedGeometrySurface(
	surface: StaticBundleGeometrySurface,
): boolean {
	return (
		surface.triangleCount > 0 &&
		surface.indices.length >= surface.triangleCount * 3 &&
		surface.positions.length >= surface.triangleCount * 9 &&
		surface.uvs.length >= surface.triangleCount * 6
	);
}

function finalizeObjectSurface({
	surface,
	preparedByAssetId,
	texturePageRefs,
	materialTextureRoutes,
}: {
	surface: StaticBundleGeometrySurface;
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
	texturePageRefs: readonly VirtualTexturePageRef[];
	materialTextureRoutes: readonly StaticMaterialTextureRoute[];
}): StaticBundleBuildSurface {
	const detail = resolveStaticBundleObjectDetail({
		object: surface.object,
		texturePageRefs,
		preparedByAssetId,
	});
	const materialRecordKey = formatStaticBundleMaterialRecordKey({
		slot: surface.slot,
		detailTextureRefKey: detail?.textureRefKey ?? null,
	});
	const textureRefKeys = findStaticMaterialTextureRefs(
		surface.materialTextureRecordKey,
		texturePageRefs,
		materialTextureRoutes,
	)
		.map((ref) => ref.key)
		.concat(detail?.textureRefKey ?? []);
	const materialReadiness = resolveStaticMaterialReadiness({
		materialAssetId: surface.materialAssetId,
		materialRecordKey: surface.materialTextureRecordKey,
		materialVariantSignature: surface.materialVariantSignature,
		preparedByAssetId,
		texturePageRefs,
		materialTextureRoutes,
	});
	const material = getPreparedPayload(
		preparedByAssetId,
		surface.materialAssetId,
		"material-recipe",
	);
	const compactionEligibility = createCompactionEligibility({
		geometry: {
			kind: "static",
			owningLandblockId: surface.object.owningLandblockId,
			hasUvBuffer: true,
		},
		material: materialReadiness,
	});
	const compactable = compactionEligibility.decision === "compacted";
	return {
		key: surface.key,
		object: surface.object,
		gfxObjAssetId: surface.gfxObjAssetId,
		materialAssetId: surface.materialAssetId,
		materialRecordKey,
		materialTextureRecordKey: surface.materialTextureRecordKey,
		materialVariantSignature: surface.materialVariantSignature,
		textureRefKeys,
		detailOverlay: detail,
		detailTextureRefKey: detail?.textureRefKey ?? null,
		detailTiling: detail?.tiling ?? 1,
		compactable,
		reason: compactable
			? null
			: describeStaticBundleCompactionBypass(compactionEligibility),
		familyKey: formatStaticMaterialFamilyKey(compactionEligibility),
		family: createStaticMaterialFamilyDescriptor(
			compactionEligibility.material,
		),
		color: resolveStaticMaterialColor({
			material,
			behavior: materialReadiness.behavior,
		}),
		isTransparent:
			compactionEligibility.material.alphaPolicy === "transparent-blend" ||
			compactionEligibility.material.alphaPolicy === "opacity-translucent",
		compactionEligibility,
		positions: surface.positions,
		normals: surface.normals,
		uvs: surface.uvs,
		indices: surface.indices,
	};
}

function createStaticBundleSourcePartMatrix(
	object: StaticBundleSourceObject,
	part: StaticBundleSourcePart,
): RenderMat4 {
	let matrix = buildAcPlacementMatrix(
		object.localPlacement,
		ZERO_VEC3,
		UNIT_SCALE,
	);
	for (const partPlacement of part.partPlacements) {
		matrix = multiplyMat4(
			matrix,
			buildAcPlacementMatrix(partPlacement, ZERO_VEC3, UNIT_SCALE),
		);
	}
	return multiplyMat4(
		matrix,
		createRenderScaleMatrix(multiplyScale(object.sourceScale, part.scale)),
	);
}

function deriveSetupPartDefaultPlacements(
	setupModel: PreparedSetupModelPayload,
	partIndex: number,
): PlacementTransformDto[] {
	const placementSet = selectDefaultSetupPlacementSet(setupModel);
	const placement = placementSet?.localPlacements[partIndex];
	return placement ? [placement] : [];
}

function selectDefaultSetupPlacementSet(
	setupModel: PreparedSetupModelPayload,
): PreparedSetupModelPayload["placementSets"][number] | null {
	return (
		setupModel.placementSets.find(
			(placementSet) => placementSet.key === 0x65,
		) ??
		setupModel.placementSets.find((placementSet) => placementSet.key === 0) ??
		setupModel.placementSets.reduce<
			PreparedSetupModelPayload["placementSets"][number] | null
		>(
			(selectedPlacementSet, placementSet) =>
				selectedPlacementSet === null ||
				placementSet.key < selectedPlacementSet.key
					? placementSet
					: selectedPlacementSet,
			null,
		)
	);
}

function createRenderScaleMatrix(scale: Vec3Dto): RenderMat4 {
	return new Float32Array([
		scale.x,
		0,
		0,
		0,
		0,
		scale.z,
		0,
		0,
		0,
		0,
		scale.y,
		0,
		0,
		0,
		0,
		1,
	]);
}

function multiplyScale(left: Vec3Dto, right: Vec3Dto): Vec3Dto {
	return {
		x: left.x * right.x,
		y: left.y * right.y,
		z: left.z * right.z,
	};
}

function transformStaticBundlePositions(
	positions: Float32Array,
	matrix: RenderMat4,
): Float32Array {
	const transformed = new Float32Array(positions.length);
	for (let offset = 0; offset < positions.length; offset += 3) {
		const point = transformPointByMat4(
			{
				x: positions[offset] ?? 0,
				y: positions[offset + 1] ?? 0,
				z: positions[offset + 2] ?? 0,
			},
			matrix,
		);
		transformed[offset] = point.x;
		transformed[offset + 1] = point.y;
		transformed[offset + 2] = point.z;
	}
	return transformed;
}

function transformStaticBundleNormals(
	positions: Float32Array,
	normals: Float32Array,
	matrix: RenderMat4,
): Float32Array {
	if (normals.length !== positions.length) {
		return normals;
	}
	const transformed = new Float32Array(normals.length);
	for (let offset = 0; offset < normals.length; offset += 3) {
		const point = transformPointByMat4(
			{
				x: normals[offset] ?? 0,
				y: normals[offset + 1] ?? 0,
				z: normals[offset + 2] ?? 0,
			},
			matrix,
		);
		const origin = transformPointByMat4(ZERO_VEC3, matrix);
		transformed[offset] = point.x - origin.x;
		transformed[offset + 1] = point.y - origin.y;
		transformed[offset + 2] = point.z - origin.z;
	}
	return transformed;
}

function buildMaterialRecords({
	surfaces,
	materialTextureRoutes,
	preparedByAssetId,
}: {
	surfaces: readonly StaticBundleBuildSurface[];
	materialTextureRoutes: readonly StaticMaterialTextureRoute[];
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): StaticBundleMaterialRecord[] {
	const recordsByKey = new Map<string, StaticBundleMaterialRecord>();
	for (const surface of surfaces) {
		const key = surface.materialRecordKey;
		if (recordsByKey.has(key)) {
			continue;
		}
		recordsByKey.set(key, {
			key,
			familyKey: surface.familyKey,
			family: surface.family,
			color: surface.color,
			texturePageRefKeys: surface.textureRefKeys,
			detailOverlay: surface.detailOverlay,
			detailTextureRefKey: surface.detailTextureRefKey,
			detailTiling: surface.detailTiling,
			isTransparent: surface.isTransparent,
			indexedMaterial: resolveStaticIndexedMaterialRecord({
				materialAssetId: surface.materialAssetId,
				materialRecordKey: surface.materialTextureRecordKey,
				materialTextureRoutes,
				preparedByAssetId,
			}),
		});
	}
	return [...recordsByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function buildCompactedBatches(
	renderChunkKey: string,
	surfaces: readonly StaticBundleBuildSurface[],
): StaticBundleCompactedBatch[] {
	return groupCompactedSurfacesByMaterial(surfaces)
		.map((group, index): StaticBundleCompactedBatch => {
			const firstSurface = group[0];
			if (!firstSurface) {
				throw new Error("Static compacted surface group was empty.");
			}
			return {
				key: `${renderChunkKey}:compacted:${index}:${firstSurface.familyKey}:${firstSurface.materialAssetId}`,
				renderChunkKey,
				familyKey: firstSurface.familyKey,
				materialRecordKey: firstSurface.materialRecordKey,
				objectKeys: uniqueSortedStrings(
					group.map((surface) => surface.object.objectKey),
				),
				objectTriangleCounts: countSurfaceTrianglesByObject(group),
				positions: concatFloat32Arrays(
					group.map((surface) => surface.positions),
				),
				normals: concatFloat32Arrays(group.map((surface) => surface.normals)),
				uvs: concatFloat32Arrays(group.map((surface) => surface.uvs)),
				indices: concatOffsetIndices(group),
			};
		})
		.sort((left, right) => left.key.localeCompare(right.key));
}

function countSurfaceTrianglesByObject(
	surfaces: readonly StaticBundleBuildSurface[],
): Readonly<Record<string, number>> {
	const countsByObjectKey = new Map<string, number>();
	for (const surface of surfaces) {
		countsByObjectKey.set(
			surface.object.objectKey,
			(countsByObjectKey.get(surface.object.objectKey) ?? 0) +
				surface.indices.length / 3,
		);
	}
	return Object.fromEntries(
		[...countsByObjectKey.entries()].sort(([left], [right]) =>
			left.localeCompare(right),
		),
	);
}

function groupCompactedSurfacesByMaterial(
	surfaces: readonly StaticBundleBuildSurface[],
): StaticBundleBuildSurface[][] {
	const groupsByKey = new Map<string, StaticBundleBuildSurface[]>();
	for (const surface of surfaces) {
		if (!surface.compactable) {
			continue;
		}
		const key = `${surface.familyKey}|${surface.materialRecordKey}`;
		const group = groupsByKey.get(key);
		if (group) {
			group.push(surface);
		} else {
			groupsByKey.set(key, [surface]);
		}
	}
	return [...groupsByKey.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([, group]) =>
			[...group].sort((left, right) => left.key.localeCompare(right.key)),
		);
}

function buildDirectEntries(
	renderChunkKey: string,
	surfaces: readonly StaticBundleBuildSurface[],
): StaticBundleDirectEntry[] {
	return surfaces
		.filter((surface) => !surface.compactable)
		.map((surface) => ({
			key: `${renderChunkKey}:direct:${surface.key}`,
			renderChunkKey,
			materialRecordKey: surface.materialRecordKey,
			objectKey: surface.object.objectKey,
			positions: surface.positions,
			normals: surface.normals,
			uvs: surface.uvs,
			indices: surface.indices,
			bounds: null,
		}))
		.sort((left, right) => left.key.localeCompare(right.key));
}

function describeStaticBundleCompactionBypass(
	eligibility: CompactionEligibility,
): string {
	const geometryBlocker = eligibility.geometry.blockers[0];
	if (geometryBlocker) {
		return `geometry:${geometryBlocker}`;
	}
	const materialBlocker = eligibility.material.blockers[0];
	if (materialBlocker) {
		return `material:${materialBlocker}`;
	}
	return "noncompactable-surface";
}

function createRenderChunk(
	job: StaticBundleLayerWorkerJob,
): StaticBundleRenderChunk {
	return {
		key: `${formatStaticObjectBundleScopeKey(job.scope)}:chunk`,
		landblockId: job.scope.landblockId,
		bounds: null,
	};
}

function buildDiagnostics(options: {
	sourceObjectCount: number;
	candidateSurfaceCount: number;
	surfaces: readonly StaticBundleBuildSurface[];
}): StaticLandblockBundleLayerDiagnostics {
	const skippedSurfaceCount =
		options.candidateSurfaceCount - options.surfaces.length;
	return {
		sourceObjectCount: options.sourceObjectCount,
		compactedSurfaceCount: options.surfaces.filter(
			(surface) => surface.compactable,
		).length,
		directSurfaceCount: options.surfaces.filter(
			(surface) => !surface.compactable,
		).length,
		skippedSurfaceCount,
		missingAssetIds: [],
		skippedReasons: uniqueSortedStrings(
			[
				...(skippedSurfaceCount > 0 ? ["geometry:empty-or-incomplete"] : []),
				...options.surfaces.flatMap((surface) =>
					surface.reason ? [surface.reason] : [],
				),
			],
		),
	};
}

function collectSetupAppearanceCompanionAssetIds(
	asset: PreparedAssetRecord,
): string[] {
	return asset.payload.kind === "setup-model"
		? [formatSetupAppearanceAssetId(asset.payload.setupModelId)]
		: [];
}

function getPreparedAsset(
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
	assetId: string,
): PreparedAssetRecord {
	const asset = preparedByAssetId.get(assetId);
	if (!asset) {
		throw new Error(
			`Static bundle closure is missing required asset ${assetId}.`,
		);
	}
	return asset;
}

function getPreparedPayload<
	TKind extends PreparedAssetRecord["payload"]["kind"],
>(
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
	assetId: string,
	kind: TKind,
): Extract<PreparedAssetRecord["payload"], { kind: TKind }> {
	const asset = getPreparedAsset(preparedByAssetId, assetId);
	if (asset.payload.kind !== kind) {
		throw new Error(
			`Static bundle asset ${assetId} was ${asset.payload.kind}, expected ${kind}.`,
		);
	}
	return asset.payload as Extract<
		PreparedAssetRecord["payload"],
		{ kind: TKind }
	>;
}

function assertRootIncludes(
	job: StaticBundleLayerWorkerJob,
	assetId: string,
): void {
	if (!job.rootAssetIds.includes(assetId)) {
		throw new Error(
			`Static bundle job ${job.jobId} missing required root ${assetId}.`,
		);
	}
}

function concatFloat32Arrays(arrays: readonly Float32Array[]): Float32Array {
	const length = arrays.reduce((total, array) => total + array.length, 0);
	const result = new Float32Array(length);
	let offset = 0;
	for (const array of arrays) {
		result.set(array, offset);
		offset += array.length;
	}
	return result;
}

function concatOffsetIndices(
	surfaces: readonly StaticBundleBuildSurface[],
): Uint16Array | Uint32Array {
	const vertexCount = surfaces.reduce(
		(total, surface) => total + surface.positions.length / 3,
		0,
	);
	const indexCount = surfaces.reduce(
		(total, surface) => total + surface.indices.length,
		0,
	);
	const result =
		vertexCount > 65535
			? new Uint32Array(indexCount)
			: new Uint16Array(indexCount);
	let indexOffset = 0;
	let vertexOffset = 0;
	for (const surface of surfaces) {
		for (let index = 0; index < surface.indices.length; index += 1) {
			result[indexOffset + index] =
				(surface.indices[index] ?? 0) + vertexOffset;
		}
		indexOffset += surface.indices.length;
		vertexOffset += surface.positions.length / 3;
	}
	return result;
}

function formatSetupAppearanceAssetId(setupModelId: number): string {
	return `setup-appearance/${formatHex32(setupModelId)}`;
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}

function uniqueTexturePageRefs(
	refs: readonly VirtualTexturePageRef[],
): VirtualTexturePageRef[] {
	return [
		...new Map(refs.map((ref) => [ref.key, ref] as const)).values(),
	].sort((left, right) => left.key.localeCompare(right.key));
}
