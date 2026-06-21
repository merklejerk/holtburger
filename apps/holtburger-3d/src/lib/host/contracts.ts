import { z } from "zod";

export type AssetPriority = "bootstrap" | "streaming" | "prefetch";

const assetPayloadKindValueSchema = z.literal("json");

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

export interface AssetLookupRequestDto {
	requestId: string;
	assetId: string;
	priority: AssetPriority;
}

export const assetLookupResponseDtoSchema = z.object({
	requestId: z.string().min(1),
	assetId: z.string().min(1),
	payloadKind: assetPayloadKindValueSchema,
	payload: z.unknown().refine((payload) => payload !== undefined, {
		message: "payload is required",
	}),
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

const landblockClassificationValueSchema = z.enum(["outdoor", "dungeon"]);

const preparedPolygonSetRenderTriangleDtoSchema = z.object({
	polygonId: z.number().int().nonnegative(),
	surfaceId: z.number().int().nullable(),
	materialVariantSignature: z.string().min(1).nullable().optional(),
	firstVertex: z.number().int().nonnegative(),
});

const preparedPolygonSetInvalidPolygonDtoSchema = z.object({
	polygonId: z.number().int().nonnegative(),
	reason: z.string(),
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

const preparedAabbDtoSchema = z
	.object({ min: vec3DtoSchema, max: vec3DtoSchema })
	.nullable();

const preparedBvhKindMaskDtoSchema = z.discriminatedUnion("domain", [
	z
		.object({
			domain: z.literal("outdoor-terrain"),
			terrainQuad: z.boolean(),
		})
		.strict(),
	z
		.object({
			domain: z.literal("outdoor-static"),
			static: z.boolean(),
			building: z.boolean(),
		})
		.strict(),
	z
		.object({
			domain: z.literal("landblock-env-cells"),
			envCellRoot: z.boolean(),
		})
		.strict(),
	z
		.object({
			domain: z.literal("env-cell-local"),
			cellStructureGeometry: z.boolean(),
			static: z.boolean(),
			portal: z.boolean(),
		})
		.strict(),
]);

const preparedLegacyBvhKindMaskDtoSchema = z.number().int().nonnegative();

const preparedLandblockBvhNodeDtoSchema = z.object({
	bounds: z.object({ min: vec3DtoSchema, max: vec3DtoSchema }),
	left: z.number().int().nonnegative().nullable(),
	right: z.number().int().nonnegative().nullable(),
	itemIndices: z.array(z.number().int().nonnegative()),
	kindMask: preparedBvhKindMaskDtoSchema,
});

const preparedLegacyLandblockBvhNodeDtoSchema =
	preparedLandblockBvhNodeDtoSchema.extend({
		kindMask: preparedLegacyBvhKindMaskDtoSchema,
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

const sourceOmissionDiagnosticDtoSchema = z.object({
	namespace: z.string().min(1),
	fileId: z.number().int().nonnegative(),
	role: z.string().min(1),
	reason: z.string().min(1),
	detail: z.string(),
});

const landblockPackDiagnosticsDtoSchema = z.object({
	sourceRecords: z.array(sourceRecordDiagnosticDtoSchema),
	omissions: z.array(sourceOmissionDiagnosticDtoSchema),
	errors: z.array(sourceLoadErrorDtoSchema),
});

const preparedTerrainBvhItemDtoSchema = z.object({
	row: z.number().int().nonnegative(),
	col: z.number().int().nonnegative(),
	quadIndex: z.number().int().nonnegative(),
	triangleIndices: z.tuple([
		z.number().int().nonnegative(),
		z.number().int().nonnegative(),
	]),
});

const preparedTerrainBvhDtoSchema = z.object({
	coordinateSpace: z.literal("landblock-outdoor-terrain-local"),
	nodes: z.array(preparedLandblockBvhNodeDtoSchema),
	items: z.array(preparedTerrainBvhItemDtoSchema),
});

const landblockTerrainTriangleDtoSchema = z.object({
	terrainTriangleId: z.string().min(1),
	quadIndex: z.number().int().nonnegative(),
	triangleInQuad: z.union([z.literal(0), z.literal(1)]),
	vertexIndices: z.tuple([
		z.number().int().nonnegative(),
		z.number().int().nonnegative(),
		z.number().int().nonnegative(),
	]),
	averageHeight: z.number().finite(),
	bounds: z.object({ min: vec3DtoSchema, max: vec3DtoSchema }),
});

const landblockTerrainQuadDtoSchema = z.object({
	terrainQuadId: z.string().min(1),
	row: z.number().int().nonnegative(),
	col: z.number().int().nonnegative(),
	quadIndex: z.number().int().nonnegative(),
	sourceTerrainIndices: z.tuple([
		z.number().int().nonnegative(),
		z.number().int().nonnegative(),
		z.number().int().nonnegative(),
		z.number().int().nonnegative(),
	]),
	vertexIndices: z.tuple([
		z.number().int().nonnegative(),
		z.number().int().nonnegative(),
		z.number().int().nonnegative(),
		z.number().int().nonnegative(),
	]),
	triangleIndices: z.tuple([
		z.number().int().nonnegative(),
		z.number().int().nonnegative(),
	]),
	diagonal: z.enum(["southwest-northeast", "southeast-northwest"]),
	cornerTerrainCodes: z.tuple([
		z.number().int().nonnegative(),
		z.number().int().nonnegative(),
		z.number().int().nonnegative(),
		z.number().int().nonnegative(),
	]),
	pcode: z.number().int().nonnegative(),
	averageHeight: z.number().finite(),
	bounds: z.object({ min: vec3DtoSchema, max: vec3DtoSchema }),
});

const landblockTerrainDtoSchema = z.object({
	gridSize: z.number().int().positive(),
	tileSize: z.number().finite().positive(),
	vertices: z.array(vec3DtoSchema),
	triangles: z.array(landblockTerrainTriangleDtoSchema),
	quads: z.array(landblockTerrainQuadDtoSchema),
	terrainBvh: preparedTerrainBvhDtoSchema,
	minHeight: z.number().finite(),
	maxHeight: z.number().finite(),
	bounds: z.object({ min: vec3DtoSchema, max: vec3DtoSchema }).nullable(),
});

const landblockSceneBuildingPortalDtoSchema = z.object({
	portalId: z.string().min(1),
	sourceIndex: z.number().int().nonnegative(),
	flags: z.number().int().nonnegative(),
	otherCellId: z.number().int().nonnegative(),
	otherPortalId: z.number().int().nonnegative(),
	stabLocalCellIds: z.array(z.number().int().nonnegative()),
	linkedEnvCellIds: z.array(z.number().int().nonnegative()),
});

const landblockBuildingTransitionApertureDtoSchema = z.object({
	apertureId: z.string().min(1),
	buildingInstanceId: z.string().min(1),
	sourceDid: z.number().int().nonnegative(),
	sourceAssetId: z.string().min(1),
	portalIndex: z.number().int(),
	polyId: z.number().int().nonnegative(),
	buildingPortalId: z.string().min(1),
	buildingPortalSourceIndex: z.number().int().nonnegative(),
	flags: z.number().int().nonnegative(),
	otherCellId: z.number().int().nonnegative(),
	otherPortalId: z.number().int().nonnegative(),
	linkedEnvCellIds: z.array(z.number().int().nonnegative()),
	points: z.array(vec3DtoSchema).min(3),
});

const landblockSceneEnvCellMemberDtoSchema = z.object({
	memberId: z.string().min(1),
	envCellId: z.number().int().nonnegative(),
	assetId: z.string().min(1),
	localPlacement: placementTransformDtoSchema,
	visibleEnvCellIds: z.array(z.number().int().nonnegative()),
	restrictionObjectId: z.number().int().nonnegative().nullable(),
	seenOutside: z.boolean().nullable(),
});

const preparedEnvCellResidencyBvhItemDtoSchema = z.object({
	envCellId: z.number().int().nonnegative(),
	memberId: z.string().min(1),
	assetId: z.string().min(1),
	source: z.enum(["building-portal-link", "env-cell-placement", "derived"]),
});

const preparedEnvCellResidencyBvhDtoSchema = z.object({
	coordinateSpace: z.literal("landblock-topology-residency"),
	nodes: z.array(preparedLegacyLandblockBvhNodeDtoSchema),
	items: z.array(preparedEnvCellResidencyBvhItemDtoSchema),
});

const preparedOutdoorBvhItemDtoSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("static"), instanceId: z.string().min(1) }),
	z.object({ kind: z.literal("building"), instanceId: z.string().min(1) }),
]);

const preparedOutdoorBvhDtoSchema = z.object({
	coordinateSpace: z.literal("landblock-render-local"),
	nodes: z.array(preparedLandblockBvhNodeDtoSchema),
	items: z.array(preparedOutdoorBvhItemDtoSchema),
});

const landblockScenePortalLinkEndpointDtoSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("landblock-building"),
		instanceId: z.string().min(1),
		portalId: z.string().min(1),
	}),
	z.object({
		kind: z.literal("env-cell"),
		envCellId: z.number().int().nonnegative(),
		portalId: z.string().min(1),
	}),
	z.object({
		kind: z.literal("outside"),
		landblockId: z.number().int().nonnegative(),
	}),
]);

const landblockScenePortalLinkDtoSchema = z.object({
	linkId: z.string().min(1),
	source: landblockScenePortalLinkEndpointDtoSchema,
	target: landblockScenePortalLinkEndpointDtoSchema,
	flags: z.number().int().nonnegative(),
	otherCellId: z.number().int().nonnegative(),
	otherPortalId: z.number().int().nonnegative(),
	polygonId: z.number().int().nonnegative().nullable(),
	sourceIndex: z.number().int().nonnegative(),
});

const landblockOutdoorBuildingFactsDtoSchema = z.object({
	numLeaves: z.number().int().nonnegative(),
	portals: z.array(landblockSceneBuildingPortalDtoSchema),
});

const landblockGeneratedSceneryFactsDtoSchema = z.object({
	terrainIndex: z.number().int().nonnegative(),
	sceneId: z.number().int().nonnegative(),
	sceneTemplateIndex: z.number().int().nonnegative(),
});

const landblockOutdoorStaticMemberDtoSchema = z.object({
	kind: z.enum(["explicit-object", "building", "generated-scenery"]),
	instanceId: z.string().min(1),
	sourceDid: z.number().int().nonnegative(),
	sourceAssetId: z.string().min(1),
	sourceIndex: z.number().int().nonnegative(),
	localPlacement: placementTransformDtoSchema,
	sourceScale: vec3DtoSchema,
	sourceBounds: preparedAabbDtoSchema.nullable(),
	instanceBounds: preparedAabbDtoSchema.nullable(),
	building: landblockOutdoorBuildingFactsDtoSchema.nullable(),
	generated: landblockGeneratedSceneryFactsDtoSchema.nullable(),
});

export const landblockOutdoorPayloadDtoSchema = z.object({
	kind: z.literal("landblock-outdoor"),
	residencyKind: z.literal("outdoor-landblock"),
	sourceAssetKind: z.literal("landblock-outdoor"),
	landblockId: z.number().int().nonnegative(),
	regionId: z.number().int().nonnegative(),
	regionNumber: z.number().int().nonnegative(),
	classification: z.literal("outdoor"),
	terrain: landblockTerrainDtoSchema,
	statics: z.array(landblockOutdoorStaticMemberDtoSchema),
	buildingTransitionApertures: z.array(
		landblockBuildingTransitionApertureDtoSchema,
	),
	outdoorBvh: preparedOutdoorBvhDtoSchema.nullable(),
	diagnostics: landblockPackDiagnosticsDtoSchema,
	provenance: assetProvenanceDtoSchema,
});
export type LandblockOutdoorPayloadDto = z.infer<
	typeof landblockOutdoorPayloadDtoSchema
>;

export const landblockTopologyPayloadDtoSchema = z.object({
	kind: z.literal("landblock-topology"),
	residencyKind: z.literal("landblock"),
	sourceAssetKind: z.literal("landblock-topology"),
	landblockId: z.number().int().nonnegative(),
	landblockInfoId: z.number().int().nonnegative(),
	classification: landblockClassificationValueSchema,
	envCells: z.array(landblockSceneEnvCellMemberDtoSchema),
	portalLinks: z.array(landblockScenePortalLinkDtoSchema),
	envCellResidencyBvh: preparedEnvCellResidencyBvhDtoSchema,
	diagnostics: landblockPackDiagnosticsDtoSchema,
	provenance: assetProvenanceDtoSchema,
});
export type LandblockTopologyPayloadDto = z.infer<
	typeof landblockTopologyPayloadDtoSchema
>;

const envCellSurfaceSlotDtoSchema = z.object({
	slotId: z.number().int().nonnegative(),
	surfaceId: z.number().int().nonnegative(),
	materialAssetId: z.string().min(1),
});

const envCellPortalDtoSchema = z.object({
	portalId: z.string().min(1),
	sourceIndex: z.number().int().nonnegative(),
	flags: z.number().int().nonnegative(),
	polygonId: z.number().int().nonnegative(),
	otherCellId: z.number().int().nonnegative(),
	otherPortalId: z.number().int().nonnegative(),
	targetEnvCellId: z.number().int().nonnegative().nullable(),
	isOutsideTransition: z.boolean(),
});

const envCellStaticMemberDtoSchema = z.object({
	instanceId: z.string().min(1),
	sourceDid: z.number().int().nonnegative(),
	sourceAssetId: z.string().min(1),
	sourceIndex: z.number().int().nonnegative(),
	localPlacement: placementTransformDtoSchema,
	sourceScale: vec3DtoSchema,
	sourceBounds: preparedAabbDtoSchema,
	instanceBounds: preparedAabbDtoSchema,
});

const landblockEnvCellStaticMemberDtoSchema = envCellStaticMemberDtoSchema.omit(
	{
		instanceBounds: true,
		sourceBounds: true,
	},
);

const preparedEnvCellBvhItemDtoSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("render-geometry"),
		polygonId: z.number().int().nonnegative().nullable(),
		triangleRange: z.tuple([
			z.number().int().nonnegative(),
			z.number().int().nonnegative(),
		]),
	}),
	z.object({ kind: z.literal("static"), instanceId: z.string().min(1) }),
	z.object({ kind: z.literal("portal"), portalId: z.string().min(1) }),
]);

const preparedEnvCellBvhDtoSchema = z.object({
	coordinateSpace: z.literal("env-cell-local"),
	nodes: z.array(preparedLegacyLandblockBvhNodeDtoSchema),
	items: z.array(preparedEnvCellBvhItemDtoSchema),
});

const preparedLandblockEnvCellBvhItemDtoSchema = z
	.object({
		envCellId: z.number().int().nonnegative(),
		memberId: z.string().min(1),
		bounds: z.object({ min: vec3DtoSchema, max: vec3DtoSchema }),
		source: z.enum(["env-cell-root", "derived"]),
	})
	.strict();

const preparedLandblockEnvCellBvhDtoSchema = z
	.object({
		nodes: z.array(preparedLandblockBvhNodeDtoSchema),
		items: z.array(preparedLandblockEnvCellBvhItemDtoSchema),
	})
	.strict();

export const envCellPayloadDtoSchema = z.object({
	kind: z.literal("env-cell"),
	residencyKind: z.literal("interior-cell"),
	sourceAssetKind: z.literal("env-cell"),
	envCellId: z.number().int().nonnegative(),
	regionId: z.number().int().nonnegative(),
	regionNumber: z.number().int().nonnegative(),
	environmentId: z.number().int().nonnegative(),
	cellStructureId: z.number().int().nonnegative(),
	localPlacement: placementTransformDtoSchema,
	surfaces: z.array(envCellSurfaceSlotDtoSchema),
	portals: z.array(envCellPortalDtoSchema),
	visibleEnvCellIds: z.array(z.number().int().nonnegative()),
	portalApertures: z.array(preparedPortalApertureDtoSchema),
	statics: z.array(envCellStaticMemberDtoSchema),
	renderGeometry: preparedPolygonSetRenderGeometryDtoSchema,
	cellBsp: z.lazy(() => polygonSetBspNodeDtoSchema),
	localBvh: preparedEnvCellBvhDtoSchema,
	provenance: assetProvenanceDtoSchema,
});
export type EnvCellPayloadDto = z.infer<typeof envCellPayloadDtoSchema>;

const landblockEnvCellDtoSchema = z
	.object({
		envCellId: z.number().int().nonnegative(),
		memberId: z.string().min(1),
		localPlacement: placementTransformDtoSchema,
		environmentId: z.number().int().nonnegative(),
		cellStructureId: z.number().int().nonnegative(),
		visibleEnvCellIds: z.array(z.number().int().nonnegative()),
		restrictionObjectId: z.number().int().nonnegative().nullable(),
		seenOutside: z.boolean().nullable(),
		surfaces: z.array(envCellSurfaceSlotDtoSchema),
		portals: z.array(envCellPortalDtoSchema),
		portalApertures: z.array(preparedPortalApertureDtoSchema),
		statics: z.array(landblockEnvCellStaticMemberDtoSchema),
		renderGeometry: preparedPolygonSetRenderGeometryDtoSchema,
		cellBsp: z.lazy(() => polygonSetBspNodeDtoSchema),
		diagnostics: landblockPackDiagnosticsDtoSchema,
	})
	.strict();

export const landblockEnvCellsPayloadDtoSchema = z
	.object({
		kind: z.literal("landblock-env-cells"),
		residencyKind: z.literal("landblock"),
		sourceAssetKind: z.literal("landblock-env-cells"),
		landblockId: z.number().int().nonnegative(),
		landblockInfoId: z.number().int().nonnegative(),
		regionId: z.number().int().nonnegative(),
		regionNumber: z.number().int().nonnegative(),
		envCells: z.array(landblockEnvCellDtoSchema),
		portalLinks: z.array(landblockScenePortalLinkDtoSchema),
		landblockEnvCellBvh: preparedLandblockEnvCellBvhDtoSchema,
		diagnostics: landblockPackDiagnosticsDtoSchema,
		provenance: assetProvenanceDtoSchema,
	})
	.strict();
export type LandblockEnvCellsPayloadDto = z.infer<
	typeof landblockEnvCellsPayloadDtoSchema
>;

const regionRenderProfileDetailRoleDtoSchema = z.object({
	role: z.enum(["landscape", "building", "environment", "object"]),
	sourceTerrainDescIndex: z.number().int().nonnegative(),
	textureAssetId: z.string().min(1),
	textureDid: z.number().int().nonnegative(),
	tiling: z.number().finite(),
	fadeNear: z.number().finite(),
	fadeFar: z.number().finite(),
});

const terrainColorVariationDtoSchema = z.object({
	minVertBright: z.number().finite(),
	maxVertBright: z.number().finite(),
	minVertSaturate: z.number().finite(),
	maxVertSaturate: z.number().finite(),
	minVertHue: z.number().finite(),
	maxVertHue: z.number().finite(),
	activeRenderPath: z.literal(false),
});

const terrainMaterialTypeEntryDtoSchema = z.object({
	terrainType: z.number().int().nonnegative(),
	textureAssetId: z.string().min(1),
	textureDid: z.number().int().nonnegative(),
	tiling: z.number().finite(),
	colorVariation: terrainColorVariationDtoSchema.nullable(),
});

const terrainAlphaMapEntryDtoSchema = z.object({
	alphaIndex: z.number().int().nonnegative(),
	alphaTextureAssetId: z.string().min(1),
	alphaTextureDid: z.number().int().nonnegative(),
	selector: z.number().int().nonnegative(),
});

const terrainRoadAlphaMapEntryDtoSchema = z.object({
	roadIndex: z.number().int().nonnegative(),
	roadTextureAssetId: z.string().min(1),
	roadTextureDid: z.number().int().nonnegative(),
	alphaTextureAssetId: z.string().min(1),
	alphaTextureDid: z.number().int().nonnegative(),
	selector: z.number().int().nonnegative(),
});

const terrainPcodeEncodingDtoSchema = z.object({
	terrainCodeBits: z.literal(5),
	roadCodeBits: z.literal(2),
	sizeBitMask: z.number().int().nonnegative(),
});

const renderResourceDependenciesDtoSchema = z.object({
	surfaceTextureAssetIds: z.array(z.string().min(1)),
	renderSurfaceAssetIds: z.array(z.string().min(1)),
	paletteAssetIds: z.array(z.string().min(1)),
});

export const terrainMaterialPayloadDtoSchema = z.object({
	kind: z.literal("terrain-material"),
	residencyKind: z.literal("unknown"),
	sourceAssetKind: z.literal("terrain-material"),
	regionNumber: z.number().int().nonnegative(),
	materialKind: z.literal("tex-merge-table"),
	terrainTypes: z.array(terrainMaterialTypeEntryDtoSchema),
	terrainAlphaMaps: z.array(terrainAlphaMapEntryDtoSchema),
	roadAlphaMaps: z.array(terrainRoadAlphaMapEntryDtoSchema),
	pcodeEncoding: terrainPcodeEncodingDtoSchema,
	dependencies: renderResourceDependenciesDtoSchema,
	provenance: assetProvenanceDtoSchema,
});
export type TerrainMaterialPayloadDto = z.infer<
	typeof terrainMaterialPayloadDtoSchema
>;

const regionDetailRolesDtoSchema = z.object({
	landscape: regionRenderProfileDetailRoleDtoSchema.nullable(),
	building: regionRenderProfileDetailRoleDtoSchema.nullable(),
	environment: regionRenderProfileDetailRoleDtoSchema.nullable(),
	object: regionRenderProfileDetailRoleDtoSchema.nullable(),
});

export const regionRenderProfilePayloadDtoSchema = z.object({
	kind: z.literal("region-render-profile"),
	residencyKind: z.literal("unknown"),
	sourceAssetKind: z.literal("region-render-profile"),
	regionId: z.number().int().nonnegative().optional(),
	regionNumber: z.number().int().nonnegative(),
	detailRoles: regionDetailRolesDtoSchema,
	dependencies: renderResourceDependenciesDtoSchema,
	provenance: assetProvenanceDtoSchema,
});
export type RegionRenderProfilePayloadDto = z.infer<
	typeof regionRenderProfilePayloadDtoSchema
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

const materialAssetDependenciesDtoSchema = z.object({
	materialAssetIds: z.array(z.string().min(1)),
});

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
	dependencies: materialAssetDependenciesDtoSchema,
	physicsWitness: gfxObjPhysicsWitnessDtoSchema,
	renderGeometry: preparedPolygonSetRenderGeometryDtoSchema,
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
	textureVelocities: z.array(
		z.discriminatedUnion("kind", [
			z.object({
				kind: z.literal("all-parts"),
				uSpeed: z.number().finite(),
				vSpeed: z.number().finite(),
			}),
			z.object({
				kind: z.literal("part"),
				partIndex: z.number().int().nonnegative(),
				uSpeed: z.number().finite(),
				vSpeed: z.number().finite(),
			}),
		]),
	),
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

const setupModelDependenciesDtoSchema = z.object({
	gfxObjAssetIds: z.array(z.string().min(1)),
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
	dependencies: setupModelDependenciesDtoSchema,
	provenance: assetProvenanceDtoSchema,
});
export type SetupModelPayloadDto = z.infer<typeof setupModelPayloadDtoSchema>;

const materialRecipeDependenciesDtoSchema = z.object({
	surfaceTextureAssetIds: z.array(z.string().min(1)),
	renderSurfaceAssetIds: z.array(z.string().min(1)),
	paletteAssetIds: z.array(z.string().min(1)),
});

const materialRecipeSourceDtoSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("solid-color"),
		argb: z.number().int().nonnegative(),
	}),
	z.object({
		kind: z.literal("texture"),
		surfaceTextureId: z.number().int().nonnegative(),
		selectedRenderSurfaceId: z.number().int().nonnegative().nullable(),
		paletteId: z.number().int().nonnegative().nullable(),
		renderSurfaceDefaultPaletteIds: z.array(z.number().int().nonnegative()),
	}),
]);

export const materialRecipePayloadDtoSchema = z.object({
	kind: z.literal("material-recipe"),
	residencyKind: z.literal("unknown"),
	sourceAssetKind: z.literal("material-recipe"),
	surfaceId: z.number().int().nonnegative(),
	surfaceType: z.number().int().nonnegative(),
	source: materialRecipeSourceDtoSchema,
	translucency: z.number().finite(),
	luminosity: z.number().finite(),
	diffuse: z.number().finite(),
	dependencies: materialRecipeDependenciesDtoSchema,
	provenance: assetProvenanceDtoSchema,
});
export type MaterialRecipePayloadDto = z.infer<
	typeof materialRecipePayloadDtoSchema
>;

const setupAppearanceMaterialSlotDtoSchema = z.object({
	slotIndex: z.number().int().nonnegative(),
	surfaceId: z.number().int().nonnegative(),
	materialAssetId: z.string().min(1),
});

const setupAppearancePartDtoSchema = z.object({
	partIndex: z.number().int().nonnegative(),
	gfxObjId: z.number().int().nonnegative(),
	gfxObjAssetId: z.string().min(1),
	materialSlots: z.array(setupAppearanceMaterialSlotDtoSchema),
});

export const setupAppearancePayloadDtoSchema = z.object({
	kind: z.literal("setup-appearance"),
	residencyKind: z.literal("unknown"),
	sourceAssetKind: z.literal("setup-appearance"),
	setupModelId: z.number().int().nonnegative(),
	appearanceKey: z.string().min(1),
	parts: z.array(setupAppearancePartDtoSchema),
	textureChanges: z.array(
		z.object({
			partIndex: z.number().int().nonnegative(),
			oldTexture: z.number().int().nonnegative(),
			newTexture: z.number().int().nonnegative(),
		}),
	),
	animPartChanges: z.array(
		z.object({
			partIndex: z.number().int().nonnegative(),
			partId: z.number().int().nonnegative(),
		}),
	),
	paletteId: z.number().int().nonnegative().nullable(),
	subPalettes: z.array(
		z.object({
			subId: z.number().int().nonnegative(),
			offset: z.number().int().nonnegative(),
			numColors: z.number().int().nonnegative(),
		}),
	),
	dependencies: z.object({
		materialAssetIds: z.array(z.string().min(1)),
		paletteAssetIds: z.array(z.string().min(1)),
	}),
	provenance: assetProvenanceDtoSchema,
});
export type SetupAppearancePayloadDto = z.infer<
	typeof setupAppearancePayloadDtoSchema
>;

export const surfaceTexturePayloadDtoSchema = z.object({
	kind: z.literal("surface-texture"),
	residencyKind: z.literal("unknown"),
	sourceAssetKind: z.literal("surface-texture"),
	surfaceTextureId: z.number().int().nonnegative(),
	textureType: z.number().int().nonnegative(),
	unknown: z.number().int(),
	selectedRenderSurfaceId: z.number().int().nonnegative().nullable(),
	renderSurfaceIds: z.array(z.number().int().nonnegative()),
	dependencies: z.object({
		renderSurfaceAssetIds: z.array(z.string().min(1)),
	}),
	provenance: assetProvenanceDtoSchema,
});
export type SurfaceTexturePayloadDto = z.infer<
	typeof surfaceTexturePayloadDtoSchema
>;

export const renderSurfacePayloadDtoSchema = z.object({
	kind: z.literal("render-surface"),
	residencyKind: z.literal("unknown"),
	sourceAssetKind: z.literal("render-surface"),
	renderSurfaceId: z.number().int().nonnegative(),
	unknown: z.number().int(),
	width: z.number().int().nonnegative(),
	height: z.number().int().nonnegative(),
	formatRaw: z.number().int().nonnegative(),
	format: z.string().min(1),
	sourceByteLength: z.number().int().nonnegative(),
	sourceBytes: z.instanceof(Uint8Array),
	defaultPaletteId: z.number().int().nonnegative().nullable(),
	dependencies: z.object({
		paletteAssetIds: z.array(z.string().min(1)),
	}),
	provenance: assetProvenanceDtoSchema,
});
export type RenderSurfacePayloadDto = z.infer<
	typeof renderSurfacePayloadDtoSchema
>;

const preparedTextureMipLevelDtoSchema = z.object({
	level: z.number().int().nonnegative(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	formatRaw: z.number().int().nonnegative(),
	format: z.string().min(1),
	byteLength: z.number().int().nonnegative(),
	bytes: z.instanceof(Uint8Array),
});

export const preparedTexturePayloadDtoSchema = z.object({
	kind: z.literal("prepared-texture"),
	residencyKind: z.literal("unknown"),
	sourceAssetKind: z.literal("prepared-texture"),
	renderSurfaceId: z.number().int().nonnegative(),
	usage: z.enum(["color", "detail", "mask", "raw"]),
	outputFormat: z.enum(["dxt1", "dxt3", "dxt5", "index16", "r8", "rgba8"]),
	mipPolicy: z.enum(["none", "retail4"]),
	colorSpace: z.enum(["srgb", "data", "linear", "source"]),
	sourceFormatRaw: z.number().int().nonnegative(),
	sourceFormat: z.string().min(1),
	sourceWidth: z.number().int().positive(),
	sourceHeight: z.number().int().positive(),
	sourceByteLength: z.number().int().nonnegative(),
	sourceHash: z.string().min(1),
	levels: z.array(preparedTextureMipLevelDtoSchema).min(1),
	dependencies: z.object({
		renderSurfaceAssetIds: z.array(z.string().min(1)),
	}),
	diagnostics: z.object({
		generatedLevelCount: z.number().int().positive(),
		generatedByteLength: z.number().int().nonnegative(),
		decodeMs: z.number().nonnegative(),
		downsampleMs: z.number().nonnegative(),
		encodeMs: z.number().nonnegative(),
		totalMs: z.number().nonnegative(),
	}),
	provenance: assetProvenanceDtoSchema,
});
export type PreparedTexturePayloadDto = z.infer<
	typeof preparedTexturePayloadDtoSchema
>;

const uint32ArrayDtoSchema = z
	.union([
		z.instanceof(Uint32Array),
		z
			.array(z.number().int().nonnegative().max(0xffffffff))
			.transform((values) => Uint32Array.from(values)),
	])
	.refine(
		(values) => values.every((value) => Number.isInteger(value)),
		"uint32 array values must be integers",
	);

export const palettePayloadDtoSchema = z
	.object({
		kind: z.literal("palette"),
		residencyKind: z.literal("unknown"),
		sourceAssetKind: z.literal("palette"),
		paletteId: z.number().int().nonnegative(),
		colorCount: z.number().int().nonnegative(),
		colorsArgb: uint32ArrayDtoSchema,
		provenance: assetProvenanceDtoSchema,
	})
	.refine((payload) => payload.colorsArgb.length === payload.colorCount, {
		message: "palette color count must match colorsArgb length",
		path: ["colorsArgb"],
	});
export type PalettePayloadDto = z.infer<typeof palettePayloadDtoSchema>;

export const genericAssetPayloadDtoSchema = z
	.object({
		kind: z.string().min(1),
		residencyKind: z.string().optional(),
		debugPrimitive: z.string().optional(),
		paletteKey: z.string().optional(),
		provenance: assetProvenanceDtoSchema.optional(),
	})
	.passthrough();

export const debugConfigDtoSchema = z.object({
	verbose: z.boolean(),
});
export type DebugConfigDto = z.infer<typeof debugConfigDtoSchema>;
