import { z } from "zod";

const lifecyclePhaseValueSchema = z.enum(["booting", "ready", "disconnected"]);
export type LifecyclePhase = z.infer<typeof lifecyclePhaseValueSchema>;

const modeHintValueSchema = z.enum(["client"]);
export type ModeHint = z.infer<typeof modeHintValueSchema>;

const sessionStateValueSchema = z.enum(["unavailable", "disconnected", "connected"]);
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
export type AssetProvenanceSource = z.infer<typeof assetProvenanceSourceValueSchema>;

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
export type IndoorRuntimeFieldId = z.infer<typeof indoorRuntimeFieldIdValueSchema>;

const indoorAssetFamilyIdValueSchema = z.enum([
	"indoor-env-cell",
	"environment",
	"cell-structure",
]);
export type IndoorAssetFamilyId = z.infer<typeof indoorAssetFamilyIdValueSchema>;

export const vec3DtoSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
	z: z.number().finite(),
});
export type Vec3Dto = z.infer<typeof vec3DtoSchema>;

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
export type RuntimeEntitySnapshotDto = z.infer<typeof runtimeEntitySnapshotDtoSchema>;

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
export type AssetLookupResponseDto = z.infer<typeof assetLookupResponseDtoSchema>;

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
export type TerrainLandblockPayloadDto = z.infer<typeof terrainLandblockPayloadDtoSchema>;

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
export type IndoorEnvCellPayloadDto = z.infer<typeof indoorEnvCellPayloadDtoSchema>;

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
export type CellStructurePayloadDto = z.infer<typeof cellStructurePayloadDtoSchema>;

export const appearanceManifestPayloadDtoSchema = z.object({
	kind: z.literal("appearance-manifest"),
	assetId: z.string().min(1),
	priority: assetPriorityValueSchema,
	residencyKind: z.string(),
	debugPrimitive: z.string().min(1),
	paletteKey: z.string().min(1),
	provenance: assetProvenanceDtoSchema,
});
export type AppearanceManifestPayloadDto = z.infer<typeof appearanceManifestPayloadDtoSchema>;

export const genericAssetPayloadDtoSchema = z.object({
	kind: z.string().min(1),
	residencyKind: z.string().optional(),
	debugPrimitive: z.string().optional(),
	paletteKey: z.string().optional(),
	provenance: assetProvenanceDtoSchema.optional(),
}).passthrough();
export type GenericAssetPayloadDto = z.infer<typeof genericAssetPayloadDtoSchema>;

export const runtimeNotificationEnvelopeDtoSchema = z.object({
	channel: z.string().min(1),
	topic: z.string().min(1),
	lifecycleState: lifecycleStateDtoSchema.nullable(),
	runtimeBatch: runtimeBatchDtoSchema.nullable(),
	viewModelFeed: frontendStateFeedDtoSchema.nullable(),
});
export type RuntimeNotificationEnvelopeDto = z.infer<typeof runtimeNotificationEnvelopeDtoSchema>;

export const indoorContractBacklogDtoSchema = z.object({
	runtimeFieldIds: z.array(indoorRuntimeFieldIdValueSchema),
	assetFamilyIds: z.array(indoorAssetFamilyIdValueSchema),
});
export type IndoorContractBacklogDto = z.infer<typeof indoorContractBacklogDtoSchema>;

export const hostBoundaryOverviewDtoSchema = z.object({
	assetChannel: z.string().min(1),
	runtimeChannel: z.string().min(1),
	runtimeNotificationEvent: z.string().min(1),
	runtimeLifecycleTopic: z.string().min(1),
	runtimeBatchCommand: z.string().min(1),
	assetLookupCommand: z.string().min(1),
	indoorContractBacklog: indoorContractBacklogDtoSchema,
});
export type HostBoundaryOverviewDto = z.infer<typeof hostBoundaryOverviewDtoSchema>;

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
