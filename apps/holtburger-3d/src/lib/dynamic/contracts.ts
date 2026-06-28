import type {
	EnvCellStaticObjectDynamicSeedFacts,
	MaterialTextureDataUseIdentity,
	OutdoorStaticObjectDynamicSeedFacts,
	StaticBakeTextureSamplingPolicy,
	StaticAuthoredDynamicSeedRecord,
	StaticBounds,
	StaticObjectMaterialSourceFacts,
	StaticObjectPaletteSourceFacts,
	StaticObjectPartMaterialSlotFacts,
	StaticObjectSourceIdentity,
	StaticObjectSourceAssetFacts,
	StaticObjectTextureRefFacts,
	StaticResourceIdentity,
	StaticScopeOwnerKey,
	StaticWorkPeerRecordOwner,
	VisualTextureDomain,
} from "../static/contracts";
import type { VisualGeometryPayload } from "../visual/visual-geometry";
import type {
	AnimationPayloadDto,
	PlacementTransformDto,
	Vec3Dto,
} from "../host/contracts";

export type DynamicEntityId = string;

export function createDynamicVisualResourceId(
	entityId: DynamicEntityId,
): string {
	return `dynamic-visual-resource:${entityId}`;
}

/** Static-authored seed fact shapes that can become dynamic runtime records. */
export type StaticAuthoredDynamicSeedFacts =
	| EnvCellStaticObjectDynamicSeedFacts
	| OutdoorStaticObjectDynamicSeedFacts;

export interface DynamicEntityRecord {
	readonly animation: DynamicEntityAnimationState;
	readonly baseTransform: DynamicEntityTransformState;
	readonly bounds: DynamicEntityBoundsState;
	readonly effectiveResidence: DynamicEntityResidence;
	readonly id: DynamicEntityId;
	readonly presentation: DynamicEntityPresentation;
	readonly provenance: DynamicEntityProvenance;
	readonly renderability: DynamicEntityRenderability;
	readonly resources: DynamicEntityResourceState;
	readonly source: DynamicEntitySourceFacts;
	readonly sourceResidence: DynamicEntityResidence;
}

/** Projected presentation facts consumed by renderer/resource policy code. */
export interface DynamicEntityPresentation {
	readonly diagnostics: DynamicDiagnosticContext;
	readonly policy: DynamicPresentationPolicy;
	readonly visualSource: DynamicVisualSource;
}

/** Operational presentation policies derived once from source-specific facts. */
interface DynamicPresentationPolicy {
	readonly materialPlanningIdentity: DynamicMaterialPlanningIdentity;
	readonly ownershipPolicy: DynamicVisualOwnershipPolicy;
	readonly retentionPolicy: DynamicRetentionPolicy;
	readonly textureBatchId: string;
	readonly textureDomain: VisualTextureDomain;
}

type DynamicRetentionPolicy =
	| {
			readonly kind: "static-source-scope";
			readonly sourceScopeKey: string;
	  }
	| {
			readonly kind: "explicit-runtime-lifetime";
	  };

type DynamicVisualOwnershipPolicy = {
	readonly kind: "dynamic-visual-resource";
	readonly resourceId: string;
};

type DynamicMaterialPlanningIdentity =
	| {
			readonly kind: "setup-backed-visual";
			readonly visualObject: DynamicVisualObjectIdentity;
	  }
	| {
			readonly kind: "pending";
			readonly reason: "runtime-material-planning-identity-unsupported";
	  };

export type DynamicPendingMaterialPlanningReason =
	"runtime-material-planning-identity-unsupported";

/** Source-neutral visual inputs consumed by dynamic resource and renderer pipelines. */
export interface DynamicVisualSource {
	readonly animationSelection: DynamicEntityAnimationSelection;
	readonly effectiveResidence: DynamicEntityResidence;
	readonly modelData: null;
	readonly setupModelId: number;
	readonly sourceAssetIds: readonly string[];
}

/** Runtime-local visual object identity for dynamic setup-backed material planning. */
export interface DynamicVisualObjectIdentity {
	readonly entityId: DynamicEntityId;
	readonly kind: "dynamic-visual-object";
	readonly resourceId: string;
}

/** Runtime-local visual part identity independent from static object instances. */
export interface DynamicVisualPartIdentity {
	readonly gfxObj: StaticObjectSourceIdentity;
	readonly kind: "dynamic-visual-part";
	readonly object: DynamicVisualObjectIdentity;
	readonly partIndex: number;
	readonly source: StaticObjectSourceIdentity;
}

/** Runtime-local material slot identity used by dynamic visual material planning. */
export interface DynamicVisualMaterialSlotIdentity {
	readonly geometrySurfaceId: number;
	readonly kind: "dynamic-visual-material-slot";
	readonly materialSurfaceId: number;
	readonly part: DynamicVisualPartIdentity;
	readonly slotIndex: number;
}

/** Diagnostic/correlation facts retained outside renderer/resource identity. */
type DynamicDiagnosticContext =
	| {
			readonly kind: "static-authored";
			readonly owner: StaticWorkPeerRecordOwner;
			readonly sourceScopeKey: string;
	  }
	| {
			readonly kind: "runtime-spawn";
			readonly serverInstanceIdMetadata: DynamicEntityServerInstanceMetadata | null;
			readonly sourceKind: "browser-authored-server-shaped";
	  };

type DynamicEntityProvenance =
	| {
			readonly kind: "static-authored-env-cell" | "static-authored-outdoor";
			readonly owner: StaticWorkPeerRecordOwner;
			readonly sourceScopeKey: string;
	  }
	| {
			/** Browser/runtime-authored entity shaped like future server-authored spawns. */
			readonly kind: "runtime-spawn";
			readonly sourceKind: "browser-authored-server-shaped";
	  };

export type DynamicEntityResidence =
	| {
			readonly kind: "env-cell";
			readonly envCellId: number;
			readonly landblockId: number;
	  }
	| {
			readonly kind: "outdoor-landblock";
			readonly landblockId: number;
	  };

export type DynamicEntityAnimationSelection =
	| {
			readonly kind: "setup-default";
	  }
	| {
			readonly animationId: number;
			readonly kind: "explicit";
	  };

export interface DynamicEntityServerInstanceMetadata {
	/** Server-authored object/instance id retained for correlation only, never local identity. */
	readonly id: string;
}

interface RuntimeSpawnDynamicEntitySourceFacts {
	readonly animationSelection: DynamicEntityAnimationSelection;
	readonly kind: "runtime-spawn";
	readonly modelData: null;
	readonly runtimeEntityId: DynamicEntityId;
	readonly serverInstanceIdMetadata: DynamicEntityServerInstanceMetadata | null;
	readonly setupModelId: number;
	readonly sourceKind: "browser-authored-server-shaped";
}

interface StaticAuthoredDynamicEntitySourceFacts {
	readonly kind: "static-authored";
	readonly seed: StaticAuthoredDynamicSeedFacts;
}

export type DynamicEntitySourceFacts =
	| RuntimeSpawnDynamicEntitySourceFacts
	| StaticAuthoredDynamicEntitySourceFacts;

export interface DynamicEntityAnimationState {
	readonly defaultAnimationId: number;
	readonly playback: DynamicEntityAnimationPlaybackState;
	readonly status: DynamicEntityAnimationStatus;
}

type DynamicEntityAnimationStatus = "failed" | "pending-resource" | "ready";

export type DynamicEntityAnimationPlaybackState =
	| {
			readonly status: "pending-resource";
	  }
	| {
			readonly animationAssetId: string;
			readonly animationId: number;
			readonly currentFrameIndex: number;
			readonly elapsedSeconds: number;
			readonly frameCount: number;
			readonly frameNumber: number;
			readonly frameRateFps: number;
			readonly lastDispatchedHookFrame: DynamicAnimationHookFrameKey | null;
			readonly loopIteration: number;
			readonly objectRootPose: PlacementTransformDto;
			readonly partCount: number;
			readonly partPoses: readonly DynamicEntityPartPose[];
			readonly startedAtSeconds: number;
			readonly status: "playing";
			readonly transformEffects: DynamicEntityTransformEffectState;
	  }
	| {
			readonly animationAssetId: string;
			readonly animationId: number | null;
			readonly reason: "zero-frame";
			readonly status: "failed";
	  };

interface DynamicEntityPartPose {
	readonly localPlacement: PlacementTransformDto;
	readonly partIndex: number;
}

interface DynamicEntityTransformEffectState {
	/** Active object/root angular velocity set by animation hooks, if any. */
	readonly activeOmega: DynamicEntityActiveOmegaState | null;
}

export interface DynamicEntityActiveOmegaState {
	readonly animationAssetId: string;
	readonly animationId: number;
	readonly entityId: DynamicEntityId;
	readonly hookName: string;
	readonly hookType: number;
	readonly lastAppliedFrameIndex: number;
	readonly lastAppliedLoopIteration: number;
	readonly lastIntegratedAtSeconds: number;
	readonly objectRootRotation: PlacementTransformDto["orientation"];
	readonly omega: Vec3Dto;
	/** Original hook payload bytes retained for diagnostics and retail parity checks. */
	readonly rawPayloadBytes: readonly number[];
}

export interface DynamicAnimationHookFrameKey {
	readonly frameIndex: number;
	readonly loopIteration: number;
}

export interface DynamicEntityTransformState {
	readonly baseLocalPlacement: StaticAuthoredDynamicSeedFacts["localPlacement"];
	readonly sourceScale: StaticAuthoredDynamicSeedFacts["sourceScale"];
}

export type DynamicEntityBoundsPrecision =
	| "none"
	| "current-frame-source-part-bounds-aabb";

export interface DynamicEntityBoundsState {
	readonly currentBounds: DynamicEntityCurrentBounds | null;
	readonly indexMembership: DynamicEntityIndexMembership;
	readonly indexed: boolean;
	readonly precision: DynamicEntityBoundsPrecision;
}

export type DynamicEntityIndexMembership =
	| {
			readonly kind: "none";
	  }
	| {
			readonly kind: "outdoor-landblocks";
			readonly landblockIds: readonly number[];
	  }
	| {
			readonly envCellIds: readonly number[];
			readonly kind: "env-cells";
			readonly landblockId: number;
	  };

export type DynamicEntityCurrentBounds =
	| {
			readonly bounds: StaticBounds;
			readonly coordinateSpace: "source-landblock-local";
			readonly effectiveOutdoorLandblockIds: readonly number[];
			readonly kind: "outdoor-landblock";
			readonly partBounds: readonly DynamicEntityPartBounds[];
			readonly precision: Extract<
				DynamicEntityBoundsPrecision,
				"current-frame-source-part-bounds-aabb"
			>;
			readonly sourceLandblockId: number;
	  }
	| {
			readonly bounds: StaticBounds;
			readonly coordinateSpace: "env-cell-landblock-render-local";
			readonly envCellId: number;
			readonly kind: "env-cell";
			readonly landblockId: number;
			readonly partBounds: readonly DynamicEntityPartBounds[];
			readonly precision: Extract<
				DynamicEntityBoundsPrecision,
				"current-frame-source-part-bounds-aabb"
			>;
	  };

export interface DynamicEntityPartBounds {
	readonly bounds: StaticBounds;
	readonly partIndex: number;
	readonly sourceBounds: StaticBounds;
}

export interface DynamicEntityResourceState {
	readonly required: readonly DynamicEntityRequiredResource[];
	readonly setupAnimation: DynamicEntitySetupAnimationResourceState;
	readonly status: DynamicEntityResourceStatus;
	readonly visual: DynamicEntityVisualResourceState;
}

type DynamicEntityResourceStatus =
	| "failed"
	| "pending"
	| "ready"
	| "setup-animation-ready";

export type DynamicEntitySetupAnimationResourceState =
	| {
			readonly animationKey: DynamicEntityResourceKey;
			readonly failures: readonly DynamicEntityResourceFailure[];
			readonly setupModelKey: DynamicEntityResourceKey;
			readonly status: "failed";
	  }
	| {
			readonly animationKey: DynamicEntityResourceKey;
			readonly setupModelKey: DynamicEntityResourceKey;
			readonly status: "pending";
	  }
	| {
			/** Setup-default animation has not been resolved to a real animation asset id. */
			readonly pendingReason: "setup-default-animation-unresolved";
			readonly setupModelKey: DynamicEntityResourceKey;
			readonly status: "pending";
	  }
	| {
			readonly animation: DynamicEntityAnimationResource;
			readonly animationKey: DynamicEntityResourceKey;
			readonly setupModelKey: DynamicEntityResourceKey;
			readonly status: "ready";
	  };

export interface DynamicEntityAnimationResource {
	readonly assetId: string;
	readonly payload: AnimationPayloadDto;
}

type DynamicEntityVisualResourceState =
	| {
			readonly status: "blocked" | "pending";
	  }
	| DynamicEntityVisualResourcesReadyState
	| DynamicEntityVisualResourcesFailedState;

interface DynamicEntityVisualResourcesReadyState {
	readonly materialSources: readonly StaticObjectMaterialSourceFacts[];
	readonly materialSlots: readonly DynamicEntityMaterialSlotRequirement[];
	readonly paletteSources: readonly StaticObjectPaletteSourceFacts[];
	readonly renderParts: readonly DynamicEntityRenderPart[];
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	readonly status: "ready";
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}

export interface DynamicEntityRenderPart extends VisualGeometryPayload {
	readonly partIndex: number;
	readonly sourceAssetId: string;
}

interface DynamicEntityVisualResourcesFailedState {
	readonly failures: readonly DynamicEntityResourceFailure[];
	readonly missingRefs: readonly StaticResourceIdentity[];
	readonly status: "failed";
	readonly unsupportedReasons: readonly DynamicEntityUnsupportedMaterialReason[];
}

interface DynamicEntityMaterialSlotRequirement {
	readonly identity: DynamicVisualMaterialSlotIdentity;
	readonly material: StaticObjectMaterialSourceFacts["identity"];
	readonly partIndex: number;
	readonly slot: StaticObjectPartMaterialSlotFacts;
}

export interface DynamicEntityTextureRequirement {
	readonly dataUse: MaterialTextureDataUseIdentity;
	readonly key: DynamicEntityResourceKey;
	readonly material: StaticObjectMaterialSourceFacts["identity"];
	readonly role:
		| "base-color"
		| "base-index"
		| "detail-overlay"
		| "palette-rgba";
	readonly samplingPolicy: StaticBakeTextureSamplingPolicy;
	readonly textureUseId: string;
}

export interface DynamicEntityUnsupportedMaterialReason {
	readonly code: string;
	readonly message: string;
	readonly material: StaticObjectMaterialSourceFacts["identity"] | null;
}

export type DynamicEntityRequiredResource =
	| "animation"
	| "setup-model"
	| "setup-appearance"
	| "gfx"
	| "material"
	| "palette"
	| "render-surface"
	| "prepared-texture"
	| "motion-table"
	| "sound-table"
	| "physics-script"
	| "physics-script-table";

export type DynamicEntityResourceKey =
	| {
			readonly kind: "animation";
			readonly id: number;
	  }
	| {
			readonly kind: "setup-model";
			readonly id: number;
	  }
	| {
			readonly kind: Exclude<
				DynamicEntityRequiredResource,
				"animation" | "setup-model"
			>;
			readonly id: number | string;
	  };

export interface DynamicEntityRenderability {
	readonly reasons: readonly DynamicEntityRenderabilityReason[];
	readonly status: "non-renderable" | "renderable";
}

export type DynamicEntityRenderabilityReason =
	| "resource-load-failed"
	| "resources-pending"
	| "visual-resources-failed"
	| "visual-resources-pending";

export interface DynamicEntityResourceFailure {
	readonly message: string;
	readonly resource: DynamicEntityRequiredResource;
	readonly resourceKey: DynamicEntityResourceKey;
}

export interface DynamicRuntimeSnapshot {
	readonly activeEntityCount: number;
	readonly nonRenderableEntityCount: number;
	readonly records: readonly DynamicEntitySummaryDto[];
	readonly runtimeSpawnCount: number;
	readonly staticAuthoredCount: number;
	readonly staticSeedCount: number;
}

export interface DynamicEntitySummaryDto {
	readonly animation: DynamicEntityAnimationSummaryDto;
	readonly baseTransform: DynamicEntityTransformState;
	readonly bounds: DynamicEntityBoundsState;
	readonly effectiveResidence: DynamicEntityResidence;
	readonly id: DynamicEntityId;
	readonly presentation: DynamicEntityPresentation;
	readonly provenance: DynamicEntityProvenance;
	readonly renderability: DynamicEntityRenderability;
	readonly resources: DynamicEntityResourceSummaryDto;
	readonly source: DynamicEntitySourceSummaryDto;
	readonly sourceResidence: DynamicEntityResidence;
}

interface DynamicEntityAnimationSummaryDto {
	readonly defaultAnimationId: number;
	readonly playback: DynamicEntityAnimationPlaybackSummaryDto;
	readonly status: DynamicEntityAnimationStatus;
}

export type DynamicEntityAnimationPlaybackSummaryDto =
	| {
			readonly status: "pending-resource";
	  }
	| {
			readonly animationAssetId: string;
			readonly animationId: number;
			readonly currentFrameIndex: number;
			readonly elapsedSeconds: number;
			readonly frameCount: number;
			readonly frameNumber: number;
			readonly frameRateFps: number;
			readonly loopIteration: number;
			readonly objectRootPose: PlacementTransformDto;
			readonly partCount: number;
			readonly partPoses: readonly DynamicEntityPartPose[];
			readonly status: "playing";
			readonly transformEffects: DynamicEntityTransformEffectSummaryDto;
	  }
	| {
			readonly animationAssetId: string;
			readonly animationId: number | null;
			readonly reason: "zero-frame";
			readonly status: "failed";
	  };

interface DynamicEntityTransformEffectSummaryDto {
	readonly activeOmega: DynamicEntityActiveOmegaSummaryDto | null;
}

type DynamicEntityActiveOmegaSummaryDto = Omit<
	DynamicEntityActiveOmegaState,
	"lastIntegratedAtSeconds"
>;

interface DynamicEntityResourceSummaryDto {
	readonly required: readonly DynamicEntityRequiredResource[];
	readonly setupAnimation: DynamicEntitySetupAnimationResourceSummaryDto;
	readonly status: DynamicEntityResourceStatus;
	readonly visual: DynamicEntityVisualResourceState;
}

export type DynamicEntitySetupAnimationResourceSummaryDto =
	| {
			readonly animationKey: DynamicEntityResourceKey;
			readonly failures: readonly DynamicEntityResourceFailure[];
			readonly setupModelKey: DynamicEntityResourceKey;
			readonly status: "failed";
	  }
	| {
			readonly animationKey: DynamicEntityResourceKey;
			readonly setupModelKey: DynamicEntityResourceKey;
			readonly status: "pending";
	  }
	| {
			readonly pendingReason: "setup-default-animation-unresolved";
			readonly setupModelKey: DynamicEntityResourceKey;
			readonly status: "pending";
	  }
	| {
			readonly animationAssetId: string;
			readonly animationId: number;
			readonly animationKey: DynamicEntityResourceKey;
			readonly frameCount: number;
			readonly partCount: number;
			readonly setupModelKey: DynamicEntityResourceKey;
			readonly status: "ready";
	  };

export type DynamicEntitySourceSummaryDto =
	| {
			readonly defaultAnimationId: number;
			readonly kind: "static-authored";
			readonly object: StaticAuthoredDynamicSeedFacts["object"];
			readonly setupModelId: number;
			readonly sourceAssetId: string;
	  }
	| {
			readonly animationSelection: DynamicEntityAnimationSelection;
			readonly kind: "runtime-spawn";
			readonly modelData: null;
			readonly runtimeEntityId: DynamicEntityId;
			readonly serverInstanceIdMetadata: DynamicEntityServerInstanceMetadata | null;
			readonly setupModelId: number;
			readonly sourceKind: "browser-authored-server-shaped";
	  };

export function isOutdoorDynamicSeedRecord(
	record: StaticAuthoredDynamicSeedRecord,
): record is Extract<
	StaticAuthoredDynamicSeedRecord,
	{ readonly kind: "outdoor-static-object-dynamic-seed" }
> {
	return record.kind === "outdoor-static-object-dynamic-seed";
}

export function isEnvCellDynamicSeedRecord(
	record: StaticAuthoredDynamicSeedRecord,
): record is Extract<
	StaticAuthoredDynamicSeedRecord,
	{ readonly kind: "env-cell-static-object-dynamic-seed" }
> {
	return record.kind === "env-cell-static-object-dynamic-seed";
}

export function createStaticScopeOwnerKey(
	owner: Pick<StaticScopeOwnerKey, "domain" | "scopeKey">,
): string {
	return `${owner.domain}:${owner.scopeKey}`;
}
