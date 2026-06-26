import type {
	EnvCellStaticObjectDynamicSeedFacts,
	MaterialTextureDataUseIdentity,
	OutdoorStaticObjectDynamicSeedFacts,
	StaticBakeTextureSamplingPolicy,
	StaticAuthoredDynamicSeedRecord,
	StaticObjectMaterialSourceFacts,
	StaticObjectPaletteSourceFacts,
	StaticObjectPartMaterialSlotFacts,
	StaticObjectSourceAssetFacts,
	StaticObjectTextureRefFacts,
	StaticResourceIdentity,
	StaticScopeOwnerKey,
	StaticWorkPeerRecordOwner,
} from "../static/contracts";
import type {
	AnimationPayloadDto,
	PlacementTransformDto,
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
	readonly diagnostics: readonly DynamicEntityIssue[];
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

export interface DynamicEntityAnimationState {
	readonly defaultAnimationId: number;
	readonly playback: DynamicEntityAnimationPlaybackState;
	readonly status: "failed" | "pending-resource" | "ready";
}

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
	  }
	| {
			readonly animationAssetId: string;
			readonly animationId: number | null;
			readonly reason: "zero-frame";
			readonly status: "failed";
	  };

export interface DynamicEntityPartPose {
	readonly localPlacement: PlacementTransformDto;
	readonly partIndex: number;
}

export interface DynamicAnimationHookFrameKey {
	readonly frameIndex: number;
	readonly loopIteration: number;
}

interface DynamicEntityTransformState {
	readonly baseLocalPlacement: StaticAuthoredDynamicSeedFacts["localPlacement"];
	readonly sourceScale: StaticAuthoredDynamicSeedFacts["sourceScale"];
}

interface DynamicEntityBoundsState {
	readonly currentBounds: null;
	readonly indexed: false;
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
			readonly setupModelKey: DynamicEntityResourceKey;
			readonly status: "failed" | "pending";
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
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	readonly status: "ready";
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}

interface DynamicEntityVisualResourcesFailedState {
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
	readonly status: "non-renderable";
}

type DynamicEntityRenderabilityReason =
	| "residence-render-path-pending"
	| "resources-pending"
	| "visual-resources-pending";

export type DynamicEntityIssue =
	| {
			readonly kind: "dynamic-resource-load-failed";
			readonly message: string;
			readonly resource: DynamicEntityRequiredResource;
			readonly resourceKey: DynamicEntityResourceKey;
	  }
	| {
			readonly animationAssetId: string;
			readonly animationId: number | null;
			readonly kind: "dynamic-animation-invalid";
			readonly message: string;
			readonly objectPositionFrameCount: number | null;
			readonly reason: "malformed-object-position-frames" | "zero-frame";
			readonly expectedFrameCount: number;
	  }
	| {
			readonly animationAssetId: string;
			readonly animationId: number;
			readonly entityId: DynamicEntityId;
			readonly frameIndex: number;
			readonly hookName: string;
			readonly hookType: number;
			readonly kind: "dynamic-animation-hook-unsupported";
			readonly loopIteration: number;
			readonly payloadKind: AnimationPayloadDto["partFrames"][number]["hooks"][number]["payloadKind"];
			readonly skippedEffect: string;
	  }
	| {
			readonly kind: "residence-render-path-pending";
			readonly residence: DynamicEntityResidence;
	  }
	| {
			readonly kind: "resources-pending";
			readonly required: readonly DynamicEntityRequiredResource[];
	  }
	| {
			readonly kind: "visual-resources-pending";
			readonly required: readonly DynamicEntityRequiredResource[];
	  }
	| {
			readonly kind: "visual-resources-unsupported";
			readonly reasons: readonly DynamicEntityUnsupportedMaterialReason[];
	  };

export interface DynamicRuntimeSnapshot {
	readonly activeEntityCount: number;
	readonly issueCount: number;
	readonly nonRenderableEntityCount: number;
	readonly records: readonly DynamicEntitySummaryDto[];
	readonly staticSeedCount: number;
}

export interface DynamicEntitySummaryDto {
	readonly animation: DynamicEntityAnimationSummaryDto;
	readonly diagnostics: readonly DynamicEntityIssue[];
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
	  }
	| {
			readonly animationAssetId: string;
			readonly animationId: number | null;
			readonly reason: "zero-frame";
			readonly status: "failed";
	  };

interface DynamicEntityResourceSummaryDto {
	readonly required: readonly DynamicEntityRequiredResource[];
	readonly setupAnimation: DynamicEntitySetupAnimationResourceSummaryDto;
	readonly status: DynamicEntityResourceState["status"];
	readonly visual: DynamicEntityVisualResourceState;
}

type DynamicEntitySetupAnimationResourceSummaryDto =
	| {
			readonly animationKey: DynamicEntityResourceKey;
			readonly setupModelKey: DynamicEntityResourceKey;
			readonly status: "failed" | "pending";
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
