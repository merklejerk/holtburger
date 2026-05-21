import { z } from "zod";

const lifecyclePhaseValueSchema = z.enum(["booting", "ready", "disconnected"]);

const modeHintValueSchema = z.enum(["client"]);

const sessionStateValueSchema = z.enum([
	"unavailable",
	"disconnected",
	"connected",
]);

const interactionModeValueSchema = z.enum(["none", "inspect"]);

const busyStateValueSchema = z.enum(["idle", "loading"]);

const assetPriorityValueSchema = z.enum(["bootstrap", "streaming", "prefetch"]);
export type AssetPriority = z.infer<typeof assetPriorityValueSchema>;

const assetPayloadKindValueSchema = z.enum(["bytes", "json"]);

const assetProvenanceSourceValueSchema = z.enum([
	"repo-local-hba",
	"generated-fallback",
	"app-local-stub",
	"unknown",
]);
export type AssetProvenanceSource = z.infer<
	typeof assetProvenanceSourceValueSchema
>;

const assetErrorCodeValueSchema = z.enum([
	"asset-id-unknown",
	"asset-archive-open-failed",
	"asset-read-failed",
	"asset-decode-failed",
	"cell-landblock-unavailable",
]);
export type AssetErrorCode = z.infer<typeof assetErrorCodeValueSchema>;

const indoorRuntimeFieldIdValueSchema = z.enum([
	"focus-env-cell-id",
	"visible-cell-ids",
	"seen-outside",
	"environment-id",
	"cell-structure-id",
]);

const indoorAssetFamilyIdValueSchema = z.enum([
	"indoor-env-cell",
	"environment",
]);

const vec3DtoSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
	z: z.number().finite(),
});
export type Vec3Dto = z.infer<typeof vec3DtoSchema>;

const quaternionDtoSchema = z.object({
	w: z.number().finite(),
	x: z.number().finite(),
	y: z.number().finite(),
	z: z.number().finite(),
});

const placementTransformDtoSchema = z.object({
	origin: vec3DtoSchema,
	orientation: quaternionDtoSchema,
});
export type PlacementTransformDto = z.infer<typeof placementTransformDtoSchema>;

const sphereDtoSchema = z.object({
	center: vec3DtoSchema,
	radius: z.number().finite(),
});
export type SphereDto = z.infer<typeof sphereDtoSchema>;

export const lifecycleStateDtoSchema = z.object({
	phase: lifecyclePhaseValueSchema,
	activeModeHint: modeHintValueSchema.nullable(),
	sessionState: sessionStateValueSchema,
});
export type LifecycleStateDto = z.infer<typeof lifecycleStateDtoSchema>;

const runtimeEntitySnapshotDtoSchema = z.object({
	entityId: z.number().int().nonnegative(),
	label: z.string(),
	position: vec3DtoSchema,
	headingRadians: z.number().finite(),
	appearanceId: z.string(),
	landblockId: z.number().int().nonnegative(),
	cellId: z.number().int().nonnegative().nullable(),
	locationLabel: z.string(),
	isLocalPlayer: z.boolean(),
});
const runtimeResidencyDtoSchema = z.object({
	focusEntityId: z.number().int().nonnegative().nullable(),
	focusLandblockId: z.number().int().nonnegative(),
	focusCellId: z.number().int().nonnegative().nullable(),
	focusEnvCellId: z.number().int().nonnegative().nullable(),
	visibleCellIds: z.array(z.number().int().nonnegative()),
	seenOutside: z.boolean().nullable(),
	environmentId: z.number().int().nonnegative().nullable(),
	cellStructureId: z.number().int().nonnegative().nullable(),
	focusLocationLabel: z.string(),
	indoors: z.boolean(),
	trackedBodyCount: z.number().int().nonnegative(),
});
export type RuntimeResidencyDto = z.infer<typeof runtimeResidencyDtoSchema>;

const outdoorStaticSceneInstanceDtoSchema = z.object({
	instanceId: z.string().min(1),
	owningLandblockId: z.number().int().nonnegative(),
	sourceDid: z.number().int().nonnegative(),
	sourceAssetId: z.string().min(1),
	sourceIndex: z.number().int().nonnegative(),
	localPlacement: placementTransformDtoSchema,
});

const outdoorStaticSceneBuildingPortalDtoSchema = z.object({
	portalId: z.string().min(1),
	sourceIndex: z.number().int().nonnegative(),
	flags: z.number().int().nonnegative(),
	otherCellId: z.number().int().nonnegative(),
	otherPortalId: z.number().int().nonnegative(),
	stabList: z.array(z.number().int().nonnegative()),
	linkedEnvCellIds: z.array(z.number().int().nonnegative()),
});

const outdoorStaticSceneBuildingDtoSchema =
	outdoorStaticSceneInstanceDtoSchema.extend({
		numLeaves: z.number().int().nonnegative(),
		portals: z.array(outdoorStaticSceneBuildingPortalDtoSchema),
	});

const outdoorStaticSceneGeneratedSceneryInstanceDtoSchema =
	outdoorStaticSceneInstanceDtoSchema.extend({
		terrainIndex: z.number().int().nonnegative(),
		sceneId: z.number().int().nonnegative(),
		sceneTemplateIndex: z.number().int().nonnegative(),
		scale: z.number().finite().positive(),
	});

const outdoorStaticLayerDiagnosticsDtoSchema = z.object({
	attempted: z.number().int().nonnegative(),
	accepted: z.number().int().nonnegative(),
	rejectedUnsupportedSource: z.number().int().nonnegative(),
});

const generatedOutdoorSceneryDiagnosticsDtoSchema =
	outdoorStaticLayerDiagnosticsDtoSchema.extend({
		skippedWeenieObj: z.number().int().nonnegative(),
		rejectedFrequency: z.number().int().nonnegative(),
		rejectedBounds: z.number().int().nonnegative(),
		rejectedBuildingOccupancy: z.number().int().nonnegative(),
		rejectedObjectBounds: z.number().int().nonnegative(),
		objectBoundsUnavailable: z.number().int().nonnegative(),
		rejectedRoad: z.number().int().nonnegative(),
		rejectedSlope: z.number().int().nonnegative(),
		rejectedOverlap: z.number().int().nonnegative(),
	});

const outdoorStaticSceneDiagnosticsDtoSchema = z.object({
	landblockInfoAvailable: z.boolean(),
	landblockInfoError: z.string().nullable(),
	explicit: outdoorStaticLayerDiagnosticsDtoSchema,
	buildings: outdoorStaticLayerDiagnosticsDtoSchema,
	generated: generatedOutdoorSceneryDiagnosticsDtoSchema,
});

export const runtimeBatchDtoSchema = z.object({
	tick: z.number().int().nonnegative(),
	entities: z.array(runtimeEntitySnapshotDtoSchema),
	residency: runtimeResidencyDtoSchema,
});
export type RuntimeBatchDto = z.infer<typeof runtimeBatchDtoSchema>;

export const frontendStateFeedDtoSchema = z.object({
	selectedEntityId: z.number().int().nonnegative().nullable(),
	interactionMode: interactionModeValueSchema,
	busyState: busyStateValueSchema,
});
export type FrontendStateFeedDto = z.infer<typeof frontendStateFeedDtoSchema>;

export interface AssetLookupRequestDto {
	requestId: string;
	assetId: string;
	priority: AssetPriority;
}

export const assetLookupResponseDtoSchema = z.object({
	requestId: z.string().min(1),
	assetId: z.string().min(1),
	payloadKind: assetPayloadKindValueSchema,
	payload: z.unknown(),
});
export type AssetLookupResponseDto = z.infer<
	typeof assetLookupResponseDtoSchema
>;

export const assetProvenanceDtoSchema = z.object({
	source: assetProvenanceSourceValueSchema,
	sourceAssetKind: z.string().nullable(),
	errorCode: assetErrorCodeValueSchema.nullable(),
	detail: z.string().nullable(),
});

export const terrainLandblockPayloadDtoSchema = z.object({
	kind: z.literal("terrain-landblock"),
	residencyKind: z.string(),
	sourceAssetKind: z.literal("cell-landblock"),
	landblockId: z.number().int().nonnegative(),
	gridSize: z.number().int().positive(),
	tileSize: z.number().finite().positive(),
	heights: z.array(z.number().finite()),
	terrainTypes: z.array(z.number().finite()),
	provenance: assetProvenanceDtoSchema,
});
export type TerrainLandblockPayloadDto = z.infer<
	typeof terrainLandblockPayloadDtoSchema
>;

const landblockClassificationValueSchema = z.enum(["outdoor", "dungeon"]);
export type LandblockClassificationDto = z.infer<
	typeof landblockClassificationValueSchema
>;

const cellLandblockFactDtoSchema = z.object({
	id: z.number().int().nonnegative(),
	hasObjects: z.boolean(),
	gridSize: z.literal(9),
	tileSize: z.number().finite().positive(),
	terrainTypes: z.array(z.number().int().nonnegative()),
	heights: z.array(z.number().finite()),
	minHeight: z.number().finite(),
	maxHeight: z.number().finite(),
	allHeightsZero: z.boolean(),
});

const landblockRestrictionDtoSchema = z.object({
	cellId: z.number().int().nonnegative(),
	restrictionObjectId: z.number().int().nonnegative(),
});

const landblockInfoFactDtoSchema = z.object({
	id: z.number().int().nonnegative(),
	firstEnvCellId: z.number().int().nonnegative().nullable(),
	numEnvCells: z.number().int().nonnegative(),
	objectCount: z.number().int().nonnegative(),
	buildingCount: z.number().int().nonnegative(),
	packMask: z.number().int().nonnegative(),
	restrictions: z.array(landblockRestrictionDtoSchema),
});

const landblockPackOutdoorFactsDtoSchema = z.object({
	explicitObjects: z.array(outdoorStaticSceneInstanceDtoSchema),
	buildings: z.array(outdoorStaticSceneBuildingDtoSchema),
	generatedScenery: z.array(
		outdoorStaticSceneGeneratedSceneryInstanceDtoSchema,
	),
});

const landblockPackIndoorStaticObjectDtoSchema = z.object({
	instanceId: z.string().min(1),
	owningEnvCellId: z.number().int().nonnegative(),
	sourceDid: z.number().int().nonnegative(),
	sourceAssetId: z.string().min(1),
	sourceIndex: z.number().int().nonnegative(),
	localPlacement: placementTransformDtoSchema,
});

const landblockPackEnvCellPortalDtoSchema = z.object({
	portalId: z.string().min(1),
	sourceIndex: z.number().int().nonnegative(),
	flags: z.number().int().nonnegative(),
	polygonId: z.number().int().nonnegative(),
	otherCellId: z.number().int().nonnegative(),
	otherPortalId: z.number().int().nonnegative(),
	targetEnvCellId: z.number().int().nonnegative().nullable(),
	isOutsideTransition: z.boolean(),
});

const landblockPackEnvCellFactDtoSchema = z.object({
	envCellId: z.number().int().nonnegative(),
	environmentId: z.number().int().nonnegative().nullable(),
	cellStructureId: z.number().int().nonnegative().nullable(),
	localPlacement: placementTransformDtoSchema,
	surfaceIds: z.array(z.number().int().nonnegative()),
	visibleCellIds: z.array(z.number().int().nonnegative()),
	portals: z.array(landblockPackEnvCellPortalDtoSchema),
	staticObjects: z.array(landblockPackIndoorStaticObjectDtoSchema),
	seenOutside: z.boolean().nullable(),
	restrictionObjectId: z.number().int().nonnegative().nullable(),
});

const landblockPackEnvironmentFactDtoSchema = z.object({
	id: z.number().int().nonnegative(),
	cellStructureIds: z.array(z.number().int().nonnegative()),
	cellStructures: z.array(z.unknown()),
});

const preparedTerrainTriangleDtoSchema = z.object({
	a: z.number().int().nonnegative(),
	b: z.number().int().nonnegative(),
	c: z.number().int().nonnegative(),
	terrainType: z.number().int().nonnegative(),
	averageHeight: z.number().finite(),
});

const preparedTerrainMeshDtoSchema = z.object({
	landblockId: z.number().int().nonnegative(),
	gridSize: z.number().int().positive(),
	tileSize: z.number().finite().positive(),
	vertices: z.array(vec3DtoSchema),
	triangles: z.array(preparedTerrainTriangleDtoSchema),
	minHeight: z.number().finite(),
	maxHeight: z.number().finite(),
});

const preparedPolygonSetRenderTriangleDtoSchema = z.object({
	polygonId: z.number().int().nonnegative(),
	surfaceId: z.number().int().nullable(),
	firstVertex: z.number().int().nonnegative(),
});

const preparedPolygonSetInvalidPolygonDtoSchema = z.object({
	polygonId: z.number().int().nonnegative(),
	vertexIds: z.array(z.number().int()),
	missingVertexIds: z.array(z.number().int()),
});

const preparedFloat32ArrayDtoSchema = z.union([
	z.array(z.number().finite()),
	z.instanceof(Float32Array),
]);

const preparedPolygonSetRenderGeometryDtoSchema = z.object({
	sourceId: z.number().int().nonnegative(),
	vertexCount: z.number().int().nonnegative(),
	triangleCount: z.number().int().nonnegative(),
	positions: preparedFloat32ArrayDtoSchema,
	normals: preparedFloat32ArrayDtoSchema,
	uvs: preparedFloat32ArrayDtoSchema,
	triangles: z.array(preparedPolygonSetRenderTriangleDtoSchema),
	surfaceIds: z.array(z.number().int()),
	invalidPolygons: z.array(preparedPolygonSetInvalidPolygonDtoSchema),
	skippedPolygonCount: z.number().int().nonnegative(),
	bounds: z.object({ min: vec3DtoSchema, max: vec3DtoSchema }).nullable(),
});

const preparedPortalAperturePlaneDtoSchema = z.object({
	normal: vec3DtoSchema,
	constant: z.number().finite(),
	source: z.enum(["drawing-bsp-portal", "derived-from-render-points"]),
});

const preparedPortalApertureDtoSchema = z.object({
	portalId: z.string().min(1),
	sourceIndex: z.number().int().nonnegative(),
	polygonId: z.number().int().nonnegative(),
	points: z.array(vec3DtoSchema),
	plane: preparedPortalAperturePlaneDtoSchema.nullable(),
});

const preparedLandblockInteriorCellDtoSchema = z.object({
	envCellId: z.number().int().nonnegative(),
	environmentId: z.number().int().nonnegative(),
	cellStructureId: z.number().int().nonnegative(),
	localPlacement: placementTransformDtoSchema,
	surfaceIds: z.array(z.number().int().nonnegative()),
	portals: z.array(landblockPackEnvCellPortalDtoSchema),
	portalApertures: z.array(preparedPortalApertureDtoSchema),
	staticObjectCount: z.number().int().nonnegative(),
	renderGeometry: preparedPolygonSetRenderGeometryDtoSchema,
});

const preparedLandblockStaticInstanceKindDtoSchema = z.enum([
	"scenery",
	"building",
	"generated-scenery",
	"indoor-static",
]);

const preparedAabbDtoSchema = z
	.object({ min: vec3DtoSchema, max: vec3DtoSchema })
	.nullable();

const preparedLandblockStaticInstanceDtoSchema = z.object({
	instanceId: z.string().min(1),
	kind: preparedLandblockStaticInstanceKindDtoSchema,
	owningLandblockId: z.number().int().nonnegative(),
	owningEnvCellId: z.number().int().nonnegative().nullable(),
	sourceDid: z.number().int().nonnegative(),
	sourceAssetId: z.string().min(1),
	sourceIndex: z.number().int().nonnegative(),
	localPlacement: placementTransformDtoSchema,
	sourceScale: vec3DtoSchema,
});

const preparedLandblockStaticMeshDtoSchema = z.object({
	instanceId: z.string().min(1),
	kind: preparedLandblockStaticInstanceKindDtoSchema,
	owningLandblockId: z.number().int().nonnegative(),
	owningEnvCellId: z.number().int().nonnegative().nullable(),
	sourceDid: z.number().int().nonnegative(),
	sourceAssetId: z.string().min(1),
	sourceIndex: z.number().int().nonnegative(),
	localPlacement: placementTransformDtoSchema,
	sourceScale: vec3DtoSchema,
	partIndex: z.number().int().nonnegative(),
	gfxObjId: z.number().int().nonnegative(),
	gfxObjAssetId: z.string().min(1),
	partPlacements: z.array(placementTransformDtoSchema),
	partScale: vec3DtoSchema,
	sourceBounds: preparedAabbDtoSchema,
	instanceBounds: preparedAabbDtoSchema,
});

const preparedLandblockSpatialItemKindDtoSchema = z.enum([
	"terrain",
	"outdoor-static",
	"building",
	"env-cell",
	"indoor-static",
	"portal",
]);

const preparedLandblockSpatialItemMetadataDtoSchema = z.discriminatedUnion(
	"kind",
	[
		z.object({ kind: z.literal("none") }),
		z.object({
			kind: z.literal("terrain-quad"),
			row: z.number().int().nonnegative(),
			col: z.number().int().nonnegative(),
			quadIndex: z.number().int().nonnegative(),
			triangleIndices: z.tuple([
				z.number().int().nonnegative(),
				z.number().int().nonnegative(),
			]),
		}),
	],
);

const preparedLandblockSpatialItemDtoSchema = z.object({
	id: z.string().min(1),
	kind: preparedLandblockSpatialItemKindDtoSchema,
	ownerId: z.number().int().nonnegative().nullable(),
	sourceAssetId: z.string().min(1).nullable(),
	bounds: z.object({ min: vec3DtoSchema, max: vec3DtoSchema }),
	metadata: preparedLandblockSpatialItemMetadataDtoSchema,
});

const preparedLandblockBvhNodeDtoSchema = z.object({
	bounds: z.object({ min: vec3DtoSchema, max: vec3DtoSchema }),
	left: z.number().int().nonnegative().nullable(),
	right: z.number().int().nonnegative().nullable(),
	itemIndices: z.array(z.number().int().nonnegative()),
	kindMask: z.number().int().nonnegative(),
});

const preparedLandblockBvhDtoSchema = z.object({
	coordinateSpace: z.literal("landblock-render-local"),
	landblockId: z.number().int().nonnegative(),
	scope: z.literal("static-landblock"),
	nodes: z.array(preparedLandblockBvhNodeDtoSchema),
});

const landblockPackSourceFactsDtoSchema = z.object({
	cellLandblock: cellLandblockFactDtoSchema.nullable(),
	landblockInfo: landblockInfoFactDtoSchema.nullable(),
	outdoor: landblockPackOutdoorFactsDtoSchema,
	interiors: z.object({
		envCells: z.array(landblockPackEnvCellFactDtoSchema),
		environments: z.array(landblockPackEnvironmentFactDtoSchema),
	}),
	renderables: z.object({
		gfxObjs: z.array(z.unknown()),
		setupModels: z.array(z.unknown()),
		unsupportedDids: z.array(z.unknown()),
	}),
});

const landblockPackDependenciesDtoSchema = z.object({
	cellDatIds: z.array(z.number().int().nonnegative()),
	portalDatIds: z.array(z.number().int().nonnegative()),
	renderableAssetIds: z.array(z.string().min(1)),
	missing: z.array(z.unknown()),
	unsupported: z.array(z.unknown()),
});

const landblockSummaryObjectDtoSchema = z.object({
	instanceId: z.string().min(1),
	owningLandblockId: z.number().int().nonnegative(),
	sourceDid: z.number().int().nonnegative(),
	sourceAssetId: z.string().min(1).nullable(),
	sourceIndex: z.number().int().nonnegative(),
	localPlacement: placementTransformDtoSchema,
});

const landblockSummaryBuildingPortalDtoSchema = z.object({
	portalId: z.string().min(1),
	sourceIndex: z.number().int().nonnegative(),
	flags: z.number().int().nonnegative(),
	otherCellId: z.number().int().nonnegative(),
	otherPortalId: z.number().int().nonnegative(),
	stabList: z.array(z.number().int().nonnegative()),
	linkedEnvCellIds: z.array(z.number().int().nonnegative()),
});

const landblockSummaryBuildingDtoSchema =
	landblockSummaryObjectDtoSchema.extend({
		numLeaves: z.number().int().nonnegative(),
		portals: z.array(landblockSummaryBuildingPortalDtoSchema),
	});

const landblockSummaryDependenciesDtoSchema = z.object({
	cellDatIds: z.array(z.number().int().nonnegative()),
	renderableAssetIds: z.array(z.string().min(1)),
});

const sourceRecordDiagnosticDtoSchema = z.object({
	namespace: z.string().min(1),
	fileId: z.number().int().nonnegative(),
	role: z.string().min(1),
	status: z.enum(["loaded", "missing", "decode-failed"]),
});

const sourceLoadErrorDtoSchema = z.object({
	namespace: z.string().min(1),
	fileId: z.number().int().nonnegative(),
	role: z.string().min(1),
	errorCode: assetErrorCodeValueSchema,
	detail: z.string(),
});

const landblockPackDiagnosticsDtoSchema = z.object({
	sourceRecords: z.array(sourceRecordDiagnosticDtoSchema),
	omissions: z.array(z.unknown()),
	errors: z.array(sourceLoadErrorDtoSchema),
});

export const landblockPackPayloadDtoSchema = z.object({
	kind: z.literal("landblock-pack"),
	residencyKind: z.literal("landblock"),
	sourceAssetKind: z.literal("landblock-pack"),
	landblockId: z.number().int().nonnegative(),
	landblockInfoId: z.number().int().nonnegative(),
	classification: landblockClassificationValueSchema,
	sourceFacts: landblockPackSourceFactsDtoSchema,
	prepared: z.object({
		terrainMesh: preparedTerrainMeshDtoSchema.nullable(),
		outdoorStaticInstances: z.array(preparedLandblockStaticInstanceDtoSchema),
		interiorCells: z.array(preparedLandblockInteriorCellDtoSchema),
		staticMeshes: z.array(preparedLandblockStaticMeshDtoSchema),
		spatialItems: z.array(preparedLandblockSpatialItemDtoSchema),
		staticLandblockBvh: preparedLandblockBvhDtoSchema.nullable(),
	}),
	dependencies: landblockPackDependenciesDtoSchema,
	diagnostics: landblockPackDiagnosticsDtoSchema,
	provenance: assetProvenanceDtoSchema,
});
export type LandblockPackPayloadDto = z.infer<
	typeof landblockPackPayloadDtoSchema
>;

export const landblockSummaryPayloadDtoSchema = z.object({
	kind: z.literal("landblock-summary"),
	residencyKind: z.literal("landblock"),
	sourceAssetKind: z.literal("landblock-summary"),
	landblockId: z.number().int().nonnegative(),
	landblockInfoId: z.number().int().nonnegative(),
	classification: landblockClassificationValueSchema,
	sourceFacts: z.object({
		cellLandblock: cellLandblockFactDtoSchema.nullable(),
		landblockInfo: landblockInfoFactDtoSchema.nullable(),
		objects: z.array(landblockSummaryObjectDtoSchema),
		buildings: z.array(landblockSummaryBuildingDtoSchema),
	}),
	prepared: z.object({
		terrainMesh: preparedTerrainMeshDtoSchema.nullable(),
	}),
	dependencies: landblockSummaryDependenciesDtoSchema,
	diagnostics: landblockPackDiagnosticsDtoSchema,
	provenance: assetProvenanceDtoSchema,
});
export type LandblockSummaryPayloadDto = z.infer<
	typeof landblockSummaryPayloadDtoSchema
>;

export const outdoorStaticScenePayloadDtoSchema = z.object({
	kind: z.literal("outdoor-static-scene"),
	residencyKind: z.literal("outdoor-landblock"),
	sourceAssetKind: z.literal("outdoor-static-scene"),
	landblockId: z.number().int().nonnegative(),
	sceneryInstances: z.array(outdoorStaticSceneInstanceDtoSchema),
	buildingInstances: z.array(outdoorStaticSceneBuildingDtoSchema),
	generatedSceneryInstances: z.array(
		outdoorStaticSceneGeneratedSceneryInstanceDtoSchema,
	),
	diagnostics: outdoorStaticSceneDiagnosticsDtoSchema,
	provenance: assetProvenanceDtoSchema,
});
export type OutdoorStaticScenePayloadDto = z.infer<
	typeof outdoorStaticScenePayloadDtoSchema
>;

export const indoorEnvCellPayloadDtoSchema = z.object({
	kind: z.literal("indoor-env-cell"),
	residencyKind: z.literal("indoor-env-cell"),
	sourceAssetKind: z.literal("env-cell"),
	envCellId: z.number().int().nonnegative(),
	environmentId: z.number().int().nonnegative().nullable(),
	cellStructureId: z.number().int().nonnegative().nullable(),
	localPlacement: placementTransformDtoSchema,
	visibleCellIds: z.array(z.number().int().nonnegative()),
	landblockEnvCellIds: z.array(z.number().int().nonnegative()),
	seenOutside: z.boolean().nullable(),
	surfaceIds: z.array(z.number().int().nonnegative()),
	portalCount: z.number().int().nonnegative(),
	portals: z.array(
		z.object({
			portalId: z.string().min(1),
			sourceIndex: z.number().int().nonnegative(),
			flags: z.number().int().nonnegative(),
			polygonId: z.number().int().nonnegative(),
			otherCellId: z.number().int().nonnegative(),
			otherPortalId: z.number().int().nonnegative(),
			targetEnvCellId: z.number().int().nonnegative(),
		}),
	),
	staticObjectCount: z.number().int().nonnegative(),
	staticObjects: z.array(
		z.object({
			instanceId: z.string(),
			owningEnvCellId: z.number().int().nonnegative(),
			sourceDid: z.number().int().nonnegative(),
			sourceAssetId: z.string(),
			sourceIndex: z.number().int().nonnegative(),
			localPlacement: placementTransformDtoSchema,
		}),
	),
	provenance: assetProvenanceDtoSchema,
});
export type IndoorEnvCellPayloadDto = z.infer<
	typeof indoorEnvCellPayloadDtoSchema
>;

const gfxObjVertexDtoSchema = z.object({
	id: z.number().int().nonnegative(),
	origin: vec3DtoSchema,
	normal: vec3DtoSchema,
	uvs: z.array(z.object({ u: z.number().finite(), v: z.number().finite() })),
});

const gfxObjVertexArrayDtoSchema = z.object({
	vertexType: z.number().int().nullable(),
	vertexCount: z.number().int().nonnegative(),
	vertices: z.array(gfxObjVertexDtoSchema),
});

const gfxObjPolygonDtoSchema = z.object({
	id: z.number().int().nonnegative(),
	numPts: z.number().int().nonnegative(),
	stippling: z.number().int().nonnegative(),
	sidesType: z.number().int(),
	posSurface: z.number().int(),
	negSurface: z.number().int(),
	vertexIds: z.array(z.number().int()),
	posUvIndices: z.array(z.number().int().nonnegative()),
	negUvIndices: z.array(z.number().int().nonnegative()),
});

type PolygonSetBspNodeDto =
	| {
			kind: "port";
			plane: { normal: Vec3Dto; d: number };
			pos: PolygonSetBspNodeDto;
			neg: PolygonSetBspNodeDto;
			sphere: SphereDto | null;
			polyIds: number[];
			portalPolys: { portalIndex: number; polyId: number }[];
	  }
	| {
			kind: "leaf";
			index: number;
			solid: number;
			sphere: SphereDto | null;
			polyIds: number[];
	  }
	| {
			kind: "internal";
			tag: string;
			plane: { normal: Vec3Dto; d: number };
			pos: PolygonSetBspNodeDto | null;
			neg: PolygonSetBspNodeDto | null;
			sphere: SphereDto | null;
			polyIds: number[];
	  };

const polygonSetBspNodeDtoSchema: z.ZodType<PolygonSetBspNodeDto> = z.lazy(() =>
	z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("port"),
			plane: z.object({ normal: vec3DtoSchema, d: z.number().finite() }),
			pos: polygonSetBspNodeDtoSchema,
			neg: polygonSetBspNodeDtoSchema,
			sphere: z
				.object({ center: vec3DtoSchema, radius: z.number().finite() })
				.nullable(),
			polyIds: z.array(z.number().int().nonnegative()),
			portalPolys: z.array(
				z.object({
					portalIndex: z.number().int(),
					polyId: z.number().int(),
				}),
			),
		}),
		z.object({
			kind: z.literal("leaf"),
			index: z.number().int(),
			solid: z.number().int(),
			sphere: z
				.object({ center: vec3DtoSchema, radius: z.number().finite() })
				.nullable(),
			polyIds: z.array(z.number().int().nonnegative()),
		}),
		z.object({
			kind: z.literal("internal"),
			tag: z.string(),
			plane: z.object({ normal: vec3DtoSchema, d: z.number().finite() }),
			pos: polygonSetBspNodeDtoSchema.nullable(),
			neg: polygonSetBspNodeDtoSchema.nullable(),
			sphere: z
				.object({ center: vec3DtoSchema, radius: z.number().finite() })
				.nullable(),
			polyIds: z.array(z.number().int().nonnegative()),
		}),
	]),
);

const gfxObjPhysicsWitnessDtoSchema = z.object({
	polygonCount: z.number().int().nonnegative(),
	hasBsp: z.boolean(),
	rootKind: z.enum(["port", "leaf", "internal"]).nullable().optional(),
});

const cellStructBspWitnessDtoSchema = z.object({
	hasBsp: z.boolean(),
	rootKind: z.enum(["port", "leaf", "internal"]).nullable(),
});

const environmentCellStructDtoSchema = z.object({
	id: z.number().int().nonnegative(),
	vertexArray: gfxObjVertexArrayDtoSchema,
	drawingPolygons: z.array(gfxObjPolygonDtoSchema),
	portalPolygonIds: z.array(z.number().int().nonnegative()),
	cellBspWitness: cellStructBspWitnessDtoSchema,
	cellBsp: polygonSetBspNodeDtoSchema,
	physicsWitness: gfxObjPhysicsWitnessDtoSchema,
	drawingBsp: polygonSetBspNodeDtoSchema.nullable(),
});

export const environmentPayloadDtoSchema = z.object({
	kind: z.literal("environment"),
	residencyKind: z.literal("indoor-env-cell"),
	sourceAssetKind: z.literal("environment"),
	environmentId: z.number().int().nonnegative(),
	cellStructureIds: z.array(z.number().int().nonnegative()),
	cellStructures: z.array(environmentCellStructDtoSchema),
	provenance: assetProvenanceDtoSchema,
});
export type EnvironmentPayloadDto = z.infer<typeof environmentPayloadDtoSchema>;

export const gfxObjPayloadDtoSchema = z.object({
	kind: z.literal("gfx-obj"),
	residencyKind: z.literal("unknown"),
	sourceAssetKind: z.literal("gfx-obj"),
	gfxObjId: z.number().int().nonnegative(),
	flags: z.number().int().nonnegative().nullable(),
	surfaceIds: z.array(z.number().int().nonnegative()),
	vertexArray: gfxObjVertexArrayDtoSchema,
	drawingPolygons: z.array(gfxObjPolygonDtoSchema),
	drawingBsp: polygonSetBspNodeDtoSchema.nullable(),
	physicsWitness: gfxObjPhysicsWitnessDtoSchema,
	renderGeometry: preparedPolygonSetRenderGeometryDtoSchema.optional(),
	sortCenter: vec3DtoSchema.nullable(),
	didDegrade: z.number().int().nonnegative().nullable(),
	provenance: assetProvenanceDtoSchema,
});
export type GfxObjPayloadDto = z.infer<typeof gfxObjPayloadDtoSchema>;

const setupModelPartDtoSchema = z.object({
	partIndex: z.number().int().nonnegative(),
	gfxObjId: z.number().int().nonnegative(),
	gfxObjAssetId: z.string().min(1),
	parentIndex: z.number().int().nonnegative().nullable(),
	scale: vec3DtoSchema.nullable(),
});

const setupModelLocationDtoSchema = z.object({
	key: z.number().int(),
	partId: z.number().int(),
	localPlacement: placementTransformDtoSchema,
});

const setupModelPlacementSetDtoSchema = z.object({
	key: z.number().int(),
	localPlacements: z.array(placementTransformDtoSchema),
	hookCount: z.number().int().nonnegative(),
});

const setupModelCollisionWitnessDtoSchema = z.object({
	cylSphereCount: z.number().int().nonnegative(),
	sphereCount: z.number().int().nonnegative(),
});

const setupModelLightDtoSchema = z.object({
	key: z.number().int(),
	viewerSpaceLocation: placementTransformDtoSchema,
	color: z.number().int().nonnegative(),
	intensity: z.number().finite(),
	falloff: z.number().finite(),
	coneAngle: z.number().finite(),
});

export const setupModelPayloadDtoSchema = z.object({
	kind: z.literal("setup-model"),
	residencyKind: z.literal("unknown"),
	sourceAssetKind: z.literal("setup-model"),
	setupModelId: z.number().int().nonnegative(),
	flags: z.number().int().nonnegative().nullable(),
	parts: z.array(setupModelPartDtoSchema),
	holdingLocations: z.array(setupModelLocationDtoSchema),
	connectionPoints: z.array(setupModelLocationDtoSchema),
	placementSets: z.array(setupModelPlacementSetDtoSchema),
	collisionWitness: setupModelCollisionWitnessDtoSchema,
	height: z.number().finite().nullable(),
	radius: z.number().finite().nullable(),
	stepUp: z.number().finite().nullable(),
	stepDown: z.number().finite().nullable(),
	sortingSphere: sphereDtoSchema.nullable(),
	selectionSphere: sphereDtoSchema.nullable(),
	lights: z.array(setupModelLightDtoSchema),
	defaultAnimation: z.number().int().nonnegative().nullable(),
	defaultScript: z.number().int().nonnegative().nullable(),
	defaultMotionTable: z.number().int().nonnegative().nullable(),
	defaultSoundTable: z.number().int().nonnegative().nullable(),
	defaultScriptTable: z.number().int().nonnegative().nullable(),
	provenance: assetProvenanceDtoSchema,
});
export type SetupModelPayloadDto = z.infer<typeof setupModelPayloadDtoSchema>;

export const appearanceManifestPayloadDtoSchema = z.object({
	kind: z.literal("appearance-manifest"),
	assetId: z.string().min(1),
	priority: assetPriorityValueSchema,
	residencyKind: z.string(),
	debugPrimitive: z.string().min(1),
	paletteKey: z.string().min(1),
	provenance: assetProvenanceDtoSchema,
});
export type AppearanceManifestPayloadDto = z.infer<
	typeof appearanceManifestPayloadDtoSchema
>;

export const dependencyManifestPayloadDtoSchema = z.object({
	kind: z.literal("dependency-manifest"),
	residencyKind: z.string().optional(),
	dependencyAssetIds: z.array(z.string().min(1)),
	provenance: assetProvenanceDtoSchema.optional(),
});
export type DependencyManifestPayloadDto = z.infer<
	typeof dependencyManifestPayloadDtoSchema
>;

export const genericAssetPayloadDtoSchema = z
	.object({
		kind: z.string().min(1),
		residencyKind: z.string().optional(),
		debugPrimitive: z.string().optional(),
		paletteKey: z.string().optional(),
		provenance: assetProvenanceDtoSchema.optional(),
	})
	.passthrough();

export const runtimeNotificationEnvelopeDtoSchema = z.object({
	channel: z.string().min(1),
	topic: z.string().min(1),
	lifecycleState: lifecycleStateDtoSchema.nullable(),
	runtimeBatch: runtimeBatchDtoSchema.nullable(),
	viewModelFeed: frontendStateFeedDtoSchema.nullable(),
});
export type RuntimeNotificationEnvelopeDto = z.infer<
	typeof runtimeNotificationEnvelopeDtoSchema
>;

const indoorContractBacklogDtoSchema = z.object({
	runtimeFieldIds: z.array(indoorRuntimeFieldIdValueSchema),
	assetFamilyIds: z.array(indoorAssetFamilyIdValueSchema),
});

export const hostBoundaryOverviewDtoSchema = z.object({
	assetChannel: z.string().min(1),
	runtimeChannel: z.string().min(1),
	runtimeNotificationEvent: z.string().min(1),
	runtimeLifecycleTopic: z.string().min(1),
	runtimeBatchCommand: z.string().min(1),
	assetLookupCommand: z.string().min(1),
	indoorContractBacklog: indoorContractBacklogDtoSchema,
});
export type HostBoundaryOverviewDto = z.infer<
	typeof hostBoundaryOverviewDtoSchema
>;

export const debugConfigDtoSchema = z.object({
	verbose: z.boolean(),
});
export type DebugConfigDto = z.infer<typeof debugConfigDtoSchema>;

export interface CameraHintDto {
	mode: "client";
	source: string;
	position: Vec3Dto;
	forward: Vec3Dto;
	viewportNormalizedX: number;
	viewportNormalizedY: number;
	destinationLabel: string | null;
}

export const cameraHintAckDtoSchema = z.object({
	accepted: z.boolean(),
	sequence: z.number().int().nonnegative(),
});
export type CameraHintAckDto = z.infer<typeof cameraHintAckDtoSchema>;

export interface RayPickRequestDto {
	requestId: string;
	origin: Vec3Dto;
	direction: Vec3Dto;
	screenXNormalized: number;
	screenYNormalized: number;
	destinationLabel: string | null;
}

const rayPickHitDtoSchema = z.object({
	entityId: z.number().int().nonnegative(),
	label: z.string(),
	locationLabel: z.string(),
	distance: z.number().finite(),
});

export const rayPickResponseDtoSchema = z.object({
	requestId: z.string().min(1),
	resolved: z.boolean(),
	cameraHintSequence: z.number().int().nonnegative().nullable(),
	hit: rayPickHitDtoSchema.nullable(),
});
export type RayPickResponseDto = z.infer<typeof rayPickResponseDtoSchema>;

export interface HostBoundarySnapshot {
	source: "tauri";
	lifecycleState: LifecycleStateDto;
	runtimeBatch: RuntimeBatchDto;
	viewModelFeed: FrontendStateFeedDto;
	overview: HostBoundaryOverviewDto;
}
