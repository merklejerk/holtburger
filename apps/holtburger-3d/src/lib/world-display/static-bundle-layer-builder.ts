import {
	getPreparedAssetDependencies,
	type PreparedAssetRecord,
	type PreparedGfxObjPayload,
	type PreparedSetupAppearancePayload,
	type PreparedSetupModelPayload,
} from "../assets/types";
import {
	formatEnvCellAssetId,
	formatHex32,
	formatLandblockOutdoorAssetId,
	formatLandblockTopologyAssetId,
	normalizeOutdoorLandblockId,
} from "../landblocks";
import type { PlacementTransformDto, Vec3Dto } from "../host/contracts";
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
	collectStaticMaterialTexturePageRefs,
	collectStaticMaterialTextureRoutes,
	collectStaticPreparedTextureRouteAssetIds,
	findStaticMaterialTextureRefs,
	formatStaticMaterialFamilyKey,
	resolveStaticMaterialColor,
	resolveStaticIndexedMaterialRecord,
	resolveStaticMaterialReadiness,
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
	kind: StaticBundleObjectRecord["kind"];
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
	materialVariantSignature: string | null;
	textureRefKeys: readonly string[];
	compactable: boolean;
	reason: string | null;
	familyKey: string;
	color: readonly [number, number, number, number];
	isTransparent: boolean;
	compactionEligibility: CompactionEligibility;
	positions: Float32Array;
	normals: Float32Array;
	uvs: Float32Array;
	indices: Uint16Array | Uint32Array;
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
		job.rootAssetIds,
		preparedByAssetId,
	);
	const materialTextureRoutes = collectStaticMaterialTextureRoutes(
		collectStaticBundleMaterialRouteRequests(sourceObjects),
		preparedByAssetId,
	);
	const texturePageRefs = collectStaticMaterialTexturePageRefs(
		materialTextureRoutes,
		preparedByAssetId,
	);
	const texturePages = buildStaticBundleLayerTexturePages({
		scopeKey: formatStaticObjectBundleScopeKey(job.scope),
		texturePageRefs,
		policy: policy.atlasLayout,
	});
	const surfaces = sourceObjects.flatMap((object) =>
		buildObjectSurfaces(
			object,
			preparedByAssetId,
			texturePageRefs,
			materialTextureRoutes,
		),
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
		}),
	);
	const spatialHints = buildSpatialHints(sourceObjects);
	const diagnostics = buildDiagnostics({
		sourceObjectCount: sourceObjects.length,
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
	rootAssetIds: readonly string[],
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): string[] {
	const visitedAssetIds = new Set<string>();
	const queue = [...rootAssetIds].sort();
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
		for (const dependency of getPreparedAssetDependencies(asset)) {
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
					kind:
						member.kind === "building"
							? "building"
							: member.kind === "generated-scenery"
								? "generated-scenery"
								: "scenery",
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
			kind: "indoor-static",
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
		partPlacements,
		scale,
	};
}

function collectStaticBundleMaterialRouteRequests(
	sourceObjects: readonly StaticBundleSourceObject[],
): StaticMaterialTextureRouteRequest[] {
	return sourceObjects.flatMap((object) =>
		object.parts.flatMap((part) =>
			part.materialSlots.map((slot) => ({
				materialAssetId: slot.materialAssetId,
				materialRecordKey: formatStaticBundleMaterialRecordKey(slot),
				materialVariantSignature: slot.materialVariantSignature ?? null,
			})),
		),
	);
}

function formatStaticBundleMaterialRecordKey(
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

function buildObjectSurfaces(
	object: StaticBundleSourceObject,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
	texturePageRefs: readonly VirtualTexturePageRef[],
	materialTextureRoutes: readonly StaticMaterialTextureRoute[],
): StaticBundleBuildSurface[] {
	return object.parts.flatMap((part) => {
		const gfxObj = getPreparedPayload(
			preparedByAssetId,
			part.gfxObjAssetId,
			"gfx-obj",
		);
		return part.materialSlots.map((slot) =>
			buildObjectSurface({
				object,
				part,
				gfxObj,
				slot,
				preparedByAssetId,
				texturePageRefs,
				materialTextureRoutes,
			}),
		);
	});
}

function buildObjectSurface({
	object,
	part,
	gfxObj,
	slot,
	preparedByAssetId,
	texturePageRefs,
	materialTextureRoutes,
}: {
	object: StaticBundleSourceObject;
	part: StaticBundleSourcePart;
	gfxObj: PreparedGfxObjPayload;
	slot: ResolvedMaterialSlot;
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
	texturePageRefs: readonly VirtualTexturePageRef[];
	materialTextureRoutes: readonly StaticMaterialTextureRoute[];
}): StaticBundleBuildSurface {
	const textureRefKeys = findStaticMaterialTextureRefs(
		formatStaticBundleMaterialRecordKey(slot),
		texturePageRefs,
		materialTextureRoutes,
	).map((ref) => ref.key);
	const materialReadiness = resolveStaticMaterialReadiness({
		materialAssetId: slot.materialAssetId,
		materialRecordKey: formatStaticBundleMaterialRecordKey(slot),
		materialVariantSignature: slot.materialVariantSignature ?? null,
		preparedByAssetId,
		texturePageRefs,
		materialTextureRoutes,
	});
	const material = getPreparedPayload(
		preparedByAssetId,
		slot.materialAssetId,
		"material-recipe",
	);
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
	const geometryCompatible =
		geometry.triangleCount > 0 &&
		positions.length >= geometry.triangleCount * 9 &&
		uvs.length >= geometry.triangleCount * 6;
	const compactionEligibility = createCompactionEligibility({
		geometry: {
			kind: "static",
			owningLandblockId: object.owningLandblockId,
			hasUvBuffer: geometryCompatible,
		},
		material: materialReadiness,
	});
	const compactable =
		geometryCompatible && compactionEligibility.decision === "compacted";
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
		materialAssetId: slot.materialAssetId,
		materialRecordKey: formatStaticBundleMaterialRecordKey(slot),
		materialVariantSignature: slot.materialVariantSignature ?? null,
		textureRefKeys,
		compactable,
		reason: compactable
			? null
			: describeStaticBundleCompactionBypass(compactionEligibility),
		familyKey: formatStaticMaterialFamilyKey(compactionEligibility),
		color: resolveStaticMaterialColor({
			material,
			behavior: materialReadiness.behavior,
		}),
		isTransparent:
			compactionEligibility.material.alphaPolicy === "transparent-blend" ||
			compactionEligibility.material.alphaPolicy === "opacity-translucent",
		compactionEligibility,
		positions,
		normals,
		uvs,
		indices: geometry.indices,
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
			color: surface.color,
			texturePageRefKeys: surface.textureRefKeys,
			isTransparent: surface.isTransparent,
			indexedMaterial: resolveStaticIndexedMaterialRecord({
				materialAssetId: surface.materialAssetId,
				materialRecordKey: surface.materialRecordKey,
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
	surfaces: readonly StaticBundleBuildSurface[];
}): StaticLandblockBundleLayerDiagnostics {
	return {
		sourceObjectCount: options.sourceObjectCount,
		compactedSurfaceCount: options.surfaces.filter(
			(surface) => surface.compactable,
		).length,
		directSurfaceCount: options.surfaces.filter(
			(surface) => !surface.compactable,
		).length,
		skippedSurfaceCount: 0,
		missingAssetIds: [],
		skippedReasons: uniqueSortedStrings(
			options.surfaces.flatMap((surface) =>
				surface.reason ? [surface.reason] : [],
			),
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
