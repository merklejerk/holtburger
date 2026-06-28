import type {
	EnvCellStaticObjectDynamicSeedFacts,
	MaterialTextureDataUseIdentity,
	OutdoorStaticObjectDynamicSeedFacts,
	StaticBakeTextureSamplingPolicy,
	StaticAuthoredDynamicSeedRecord,
	StaticBounds,
	StaticMaterialTableEntry,
	StaticObjectMaterialSourceFacts,
	StaticObjectPaletteSourceFacts,
	StaticObjectPartMaterialSlotFacts,
	StaticObjectRenderState,
	StaticObjectSourceAssetFacts,
	StaticObjectTextureRefFacts,
	StaticResourceIdentity,
	StaticScopeOwnerKey,
	StaticWorkPeerRecordOwner,
} from "../static/contracts";
import type {
	AnimationPayloadDto,
	PlacementTransformDto,
	Vec3Dto,
} from "../host/contracts";

export type DynamicEntityId = string;

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
	readonly provenance: DynamicEntityProvenance;
	readonly renderability: DynamicEntityRenderability;
	readonly resources: DynamicEntityResourceState;
	readonly sourceResidence: DynamicEntityResidence;
	readonly sourceSeed: StaticAuthoredDynamicSeedFacts;
}

interface DynamicEntityProvenance {
	readonly kind: "static-authored-env-cell" | "static-authored-outdoor";
	readonly owner: StaticWorkPeerRecordOwner;
	readonly sourceScopeKey: string;
}

type DynamicEntityResidence =
	| {
			readonly kind: "env-cell";
			readonly envCellId: number;
			readonly landblockId: number;
	  }
	| {
			readonly kind: "outdoor-landblock";
			readonly landblockId: number;
	  };

interface DynamicEntityAnimationState {
	readonly defaultAnimationId: number;
	readonly playback: DynamicEntityAnimationPlaybackState;
	readonly status: "failed" | "pending-resource" | "ready";
}

type DynamicEntityAnimationPlaybackState =
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

interface DynamicEntityTransformState {
	readonly baseLocalPlacement: StaticAuthoredDynamicSeedFacts["localPlacement"];
	readonly sourceScale: StaticAuthoredDynamicSeedFacts["sourceScale"];
}

export type DynamicEntityBoundsPrecision =
	| "none"
	| "current-frame-source-part-bounds-aabb";

interface DynamicEntityBoundsState {
	readonly currentBounds: DynamicEntityCurrentBounds | null;
	readonly indexMembership: DynamicEntityIndexMembership;
	readonly indexed: boolean;
	readonly precision: DynamicEntityBoundsPrecision;
}

type DynamicEntityIndexMembership =
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
	readonly status: "failed" | "pending" | "ready" | "setup-animation-ready";
	readonly visual: DynamicEntityVisualResourceState;
}

type DynamicEntitySetupAnimationResourceState =
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

export interface DynamicEntityRenderPart {
	readonly bounds: StaticBounds | null;
	readonly indices: Uint16Array | Uint32Array;
	readonly indexType: "uint16" | "uint32";
	readonly materialEntries: readonly StaticMaterialTableEntry[];
	readonly materialFamily: "flat-color" | "indexed-paletted" | "texture-rgba";
	readonly materialPass: "opaque" | "alpha-test" | "transparent" | "additive";
	readonly materialSlotIndices: Float32Array;
	readonly partIndex: number;
	readonly positions: Float32Array;
	readonly renderState: StaticObjectRenderState;
	readonly sourceAssetId: string;
	readonly texCoords: Float32Array;
	readonly textureUseIds: readonly string[];
	readonly triangleCount: number;
	readonly vertexCount: number;
}

interface DynamicEntityVisualResourcesFailedState {
	readonly failures: readonly DynamicEntityResourceFailure[];
	readonly missingRefs: readonly StaticResourceIdentity[];
	readonly status: "failed";
	readonly unsupportedReasons: readonly DynamicEntityUnsupportedMaterialReason[];
}

interface DynamicEntityMaterialSlotRequirement {
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

interface DynamicEntityRenderability {
	readonly reasons: readonly DynamicEntityRenderabilityReason[];
	readonly status: "non-renderable" | "renderable";
}

type DynamicEntityRenderabilityReason =
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
	readonly staticSeedCount: number;
}

export interface DynamicEntitySummaryDto {
	readonly animation: DynamicEntityAnimationSummaryDto;
	readonly baseTransform: DynamicEntityTransformState;
	readonly bounds: DynamicEntityBoundsState;
	readonly effectiveResidence: DynamicEntityResidence;
	readonly id: DynamicEntityId;
	readonly provenance: DynamicEntityProvenance;
	readonly renderability: DynamicEntityRenderability;
	readonly resources: DynamicEntityResourceSummaryDto;
	readonly source: DynamicEntitySourceSummaryDto;
	readonly sourceResidence: DynamicEntityResidence;
}

interface DynamicEntityAnimationSummaryDto {
	readonly defaultAnimationId: number;
	readonly playback: DynamicEntityAnimationPlaybackSummaryDto;
	readonly status: DynamicEntityAnimationState["status"];
}

type DynamicEntityAnimationPlaybackSummaryDto =
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
	readonly status: DynamicEntityResourceState["status"];
	readonly visual: DynamicEntityVisualResourceState;
}

type DynamicEntitySetupAnimationResourceSummaryDto =
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
			readonly animationAssetId: string;
			readonly animationId: number;
			readonly animationKey: DynamicEntityResourceKey;
			readonly frameCount: number;
			readonly partCount: number;
			readonly setupModelKey: DynamicEntityResourceKey;
			readonly status: "ready";
	  };

interface DynamicEntitySourceSummaryDto {
	readonly defaultAnimationId: number;
	readonly object: StaticAuthoredDynamicSeedFacts["object"];
	readonly setupModelId: number;
	readonly sourceAssetId: string;
}

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
