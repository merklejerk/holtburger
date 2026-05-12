import { z } from "zod";

const lifecyclePhaseValueSchema = z.enum(["booting", "ready", "disconnected"]);
export type LifecyclePhase = z.infer<typeof lifecyclePhaseValueSchema>;

const modeHintValueSchema = z.enum(["client"]);
export type ModeHint = z.infer<typeof modeHintValueSchema>;

const sessionStateValueSchema = z.enum([
	"unavailable",
	"disconnected",
	"connected",
]);
export type SessionState = z.infer<typeof sessionStateValueSchema>;

const interactionModeValueSchema = z.enum(["none", "inspect"]);
export type InteractionMode = z.infer<typeof interactionModeValueSchema>;

const busyStateValueSchema = z.enum(["idle", "loading"]);
export type BusyState = z.infer<typeof busyStateValueSchema>;

const assetPriorityValueSchema = z.enum(["bootstrap", "streaming", "prefetch"]);
export type AssetPriority = z.infer<typeof assetPriorityValueSchema>;

const assetPayloadKindValueSchema = z.enum(["bytes", "json"]);
export type AssetPayloadKind = z.infer<typeof assetPayloadKindValueSchema>;

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
export type IndoorRuntimeFieldId = z.infer<
	typeof indoorRuntimeFieldIdValueSchema
>;

const indoorAssetFamilyIdValueSchema = z.enum([
	"indoor-env-cell",
	"environment",
	"cell-structure",
]);
export type IndoorAssetFamilyId = z.infer<
	typeof indoorAssetFamilyIdValueSchema
>;

export const vec3DtoSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
	z: z.number().finite(),
});
export type Vec3Dto = z.infer<typeof vec3DtoSchema>;

export const quaternionDtoSchema = z.object({
	w: z.number().finite(),
	x: z.number().finite(),
	y: z.number().finite(),
	z: z.number().finite(),
});
export type QuaternionDto = z.infer<typeof quaternionDtoSchema>;

export const frameDtoSchema = z.object({
	origin: vec3DtoSchema,
	orientation: quaternionDtoSchema,
});
export type FrameDto = z.infer<typeof frameDtoSchema>;

export const sphereDtoSchema = z.object({
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

export const runtimeEntitySnapshotDtoSchema = z.object({
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
export type RuntimeEntitySnapshotDto = z.infer<
	typeof runtimeEntitySnapshotDtoSchema
>;

export const runtimeResidencyDtoSchema = z.object({
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

export const landblockStaticInstanceDtoSchema = z.object({
	instanceId: z.string().min(1),
	owningLandblockId: z.number().int().nonnegative(),
	sourceDid: z.number().int().nonnegative(),
	sourceAssetId: z.string().min(1),
	sourceIndex: z.number().int().nonnegative(),
	frame: frameDtoSchema,
});
export type LandblockStaticInstanceDto = z.infer<
	typeof landblockStaticInstanceDtoSchema
>;

export const landblockStaticBuildingDtoSchema =
	landblockStaticInstanceDtoSchema.extend({
		numLeaves: z.number().int().nonnegative(),
	});
export type LandblockStaticBuildingDto = z.infer<
	typeof landblockStaticBuildingDtoSchema
>;

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

export const assetLookupRequestDtoSchema = z.object({
	requestId: z.string().min(1),
	assetId: z.string().min(1),
	priority: assetPriorityValueSchema,
});
export type AssetLookupRequestDto = z.infer<typeof assetLookupRequestDtoSchema>;

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
export type AssetProvenanceDto = z.infer<typeof assetProvenanceDtoSchema>;

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

export const landblockStaticsPayloadDtoSchema = z.object({
	kind: z.literal("landblock-statics"),
	residencyKind: z.literal("outdoor-landblock"),
	sourceAssetKind: z.literal("landblock-info"),
	landblockId: z.number().int().nonnegative(),
	sceneryInstances: z.array(landblockStaticInstanceDtoSchema),
	buildingInstances: z.array(landblockStaticBuildingDtoSchema),
	provenance: assetProvenanceDtoSchema,
});
export type LandblockStaticsPayloadDto = z.infer<
	typeof landblockStaticsPayloadDtoSchema
>;

export const indoorEnvCellPayloadDtoSchema = z.object({
	kind: z.literal("indoor-env-cell"),
	residencyKind: z.literal("indoor-env-cell"),
	sourceAssetKind: z.literal("env-cell"),
	envCellId: z.number().int().nonnegative(),
	environmentId: z.number().int().nonnegative().nullable(),
	cellStructureId: z.number().int().nonnegative().nullable(),
	visibleCellIds: z.array(z.number().int().nonnegative()),
	seenOutside: z.boolean().nullable(),
	surfaceIds: z.array(z.number().int().nonnegative()),
	portalCount: z.number().int().nonnegative(),
	staticObjectCount: z.number().int().nonnegative(),
	provenance: assetProvenanceDtoSchema,
});
export type IndoorEnvCellPayloadDto = z.infer<
	typeof indoorEnvCellPayloadDtoSchema
>;

export const environmentPayloadDtoSchema = z.object({
	kind: z.literal("environment"),
	residencyKind: z.literal("indoor-env-cell"),
	sourceAssetKind: z.literal("environment"),
	environmentId: z.number().int().nonnegative(),
	cellStructureIds: z.array(z.number().int().nonnegative()),
	provenance: assetProvenanceDtoSchema,
});
export type EnvironmentPayloadDto = z.infer<typeof environmentPayloadDtoSchema>;

export const cellStructurePayloadDtoSchema = z.object({
	kind: z.literal("cell-structure"),
	residencyKind: z.literal("indoor-env-cell"),
	sourceAssetKind: z.literal("cell-structure"),
	environmentId: z.number().int().nonnegative().nullable(),
	cellStructureId: z.number().int().nonnegative(),
	polygonCount: z.number().int().nonnegative().nullable(),
	portalCount: z.number().int().nonnegative().nullable(),
	hasCellBsp: z.boolean(),
	hasPhysicsBsp: z.boolean(),
	hasDrawingBsp: z.boolean(),
	provenance: assetProvenanceDtoSchema,
});
export type CellStructurePayloadDto = z.infer<
	typeof cellStructurePayloadDtoSchema
>;

const gfxObjVertexDtoSchema = z.object({
	id: z.number().int().nonnegative(),
	origin: vec3DtoSchema,
	normal: vec3DtoSchema,
	uvs: z.array(z.object({ u: z.number().finite(), v: z.number().finite() })),
});
export type GfxObjVertexDto = z.infer<typeof gfxObjVertexDtoSchema>;

const gfxObjVertexArrayDtoSchema = z.object({
	vertexType: z.number().int().nullable(),
	vertexCount: z.number().int().nonnegative(),
	vertices: z.array(gfxObjVertexDtoSchema),
});
export type GfxObjVertexArrayDto = z.infer<typeof gfxObjVertexArrayDtoSchema>;

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
export type GfxObjPolygonDto = z.infer<typeof gfxObjPolygonDtoSchema>;

const gfxObjBspNodeDtoSchema: z.ZodType<{
	kind: string;
	[key: string]: unknown;
}> = z.lazy(() =>
	z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("port"),
			plane: z.object({ normal: vec3DtoSchema, d: z.number().finite() }),
			pos: gfxObjBspNodeDtoSchema,
			neg: gfxObjBspNodeDtoSchema,
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
			pos: gfxObjBspNodeDtoSchema.nullable(),
			neg: gfxObjBspNodeDtoSchema.nullable(),
			sphere: z
				.object({ center: vec3DtoSchema, radius: z.number().finite() })
				.nullable(),
			polyIds: z.array(z.number().int().nonnegative()),
		}),
	]),
);
export type GfxObjBspNodeDto = z.infer<typeof gfxObjBspNodeDtoSchema>;

const gfxObjPhysicsWitnessDtoSchema = z.object({
	polygonCount: z.number().int().nonnegative(),
	hasBsp: z.boolean(),
});
export type GfxObjPhysicsWitnessDto = z.infer<
	typeof gfxObjPhysicsWitnessDtoSchema
>;

export const gfxObjPayloadDtoSchema = z.object({
	kind: z.literal("gfx-obj"),
	residencyKind: z.literal("unknown"),
	sourceAssetKind: z.literal("gfx-obj"),
	gfxObjId: z.number().int().nonnegative(),
	flags: z.number().int().nonnegative().nullable(),
	surfaceIds: z.array(z.number().int().nonnegative()),
	vertexArray: gfxObjVertexArrayDtoSchema,
	drawingPolygons: z.array(gfxObjPolygonDtoSchema),
	drawingBsp: gfxObjBspNodeDtoSchema.nullable(),
	physicsWitness: gfxObjPhysicsWitnessDtoSchema,
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
export type SetupModelPartDto = z.infer<typeof setupModelPartDtoSchema>;

const setupModelLocationDtoSchema = z.object({
	key: z.number().int(),
	partId: z.number().int(),
	frame: frameDtoSchema,
});
export type SetupModelLocationDto = z.infer<typeof setupModelLocationDtoSchema>;

const setupModelPlacementFrameDtoSchema = z.object({
	key: z.number().int(),
	frames: z.array(frameDtoSchema),
	hookCount: z.number().int().nonnegative(),
});
export type SetupModelPlacementFrameDto = z.infer<
	typeof setupModelPlacementFrameDtoSchema
>;

const setupModelCollisionWitnessDtoSchema = z.object({
	cylSphereCount: z.number().int().nonnegative(),
	sphereCount: z.number().int().nonnegative(),
});
export type SetupModelCollisionWitnessDto = z.infer<
	typeof setupModelCollisionWitnessDtoSchema
>;

const setupModelLightDtoSchema = z.object({
	key: z.number().int(),
	viewerSpaceLocation: frameDtoSchema,
	color: z.number().int().nonnegative(),
	intensity: z.number().finite(),
	falloff: z.number().finite(),
	coneAngle: z.number().finite(),
});
export type SetupModelLightDto = z.infer<typeof setupModelLightDtoSchema>;

export const setupModelPayloadDtoSchema = z.object({
	kind: z.literal("setup-model"),
	residencyKind: z.literal("unknown"),
	sourceAssetKind: z.literal("setup-model"),
	setupModelId: z.number().int().nonnegative(),
	flags: z.number().int().nonnegative().nullable(),
	parts: z.array(setupModelPartDtoSchema),
	holdingLocations: z.array(setupModelLocationDtoSchema),
	connectionPoints: z.array(setupModelLocationDtoSchema),
	placementFrames: z.array(setupModelPlacementFrameDtoSchema),
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
export type GenericAssetPayloadDto = z.infer<
	typeof genericAssetPayloadDtoSchema
>;

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

export const indoorContractBacklogDtoSchema = z.object({
	runtimeFieldIds: z.array(indoorRuntimeFieldIdValueSchema),
	assetFamilyIds: z.array(indoorAssetFamilyIdValueSchema),
});
export type IndoorContractBacklogDto = z.infer<
	typeof indoorContractBacklogDtoSchema
>;

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

export const cameraHintDtoSchema = z.object({
	mode: modeHintValueSchema,
	source: z.string().min(1),
	position: vec3DtoSchema,
	forward: vec3DtoSchema,
	viewportNormalizedX: z.number().finite(),
	viewportNormalizedY: z.number().finite(),
	destinationLabel: z.string().nullable(),
});
export type CameraHintDto = z.infer<typeof cameraHintDtoSchema>;

export const cameraHintAckDtoSchema = z.object({
	accepted: z.boolean(),
	sequence: z.number().int().nonnegative(),
});
export type CameraHintAckDto = z.infer<typeof cameraHintAckDtoSchema>;

export const rayPickRequestDtoSchema = z.object({
	requestId: z.string().min(1),
	origin: vec3DtoSchema,
	direction: vec3DtoSchema,
	screenXNormalized: z.number().finite(),
	screenYNormalized: z.number().finite(),
	destinationLabel: z.string().nullable(),
});
export type RayPickRequestDto = z.infer<typeof rayPickRequestDtoSchema>;

export const rayPickHitDtoSchema = z.object({
	entityId: z.number().int().nonnegative(),
	label: z.string(),
	locationLabel: z.string(),
	distance: z.number().finite(),
});
export type RayPickHitDto = z.infer<typeof rayPickHitDtoSchema>;

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
