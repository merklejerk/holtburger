import type {
	EnvCellStaticObjectDynamicPlacementFacts,
	MaterialTextureDataUseIdentity,
	OutdoorStaticObjectDynamicPlacementFacts,
	StaticBakeTextureSamplingPolicy,
	StaticAuthoredDynamicPlacementRecord,
	StaticBounds,
	StaticObjectSourceGeometryAttachment,
	StaticObjectMaterialSourceFacts,
	StaticObjectPaletteSourceFacts,
	StaticObjectPartMaterialSlotFacts,
	StaticObjectSourceIdentity,
	StaticObjectSourceAssetFacts,
	StaticObjectTextureRefFacts,
	StaticResourceIdentity,
	StaticLayerPeerRecordOwner,
	VisualTextureDomain,
} from "../static/contracts";
import type { StaticMaterialPlanningDomain } from "../static/objects/bake/static-object-material-planner";
import type { VisualGeometryPayload } from "../visual/visual-geometry";
import type {
	AnimationPayloadDto,
	PlacementTransformDto,
	Vec3Dto,
} from "../host/contracts";
import type {
	TexturePlacementIntent,
	TexturePlacementSnapshot,
	TextureResourceDependencies,
} from "../textures/placement";

export type DynamicEntityId = string;
export const RUNTIME_AUTHORED_DYNAMIC_RESOURCE_FAMILY =
	"runtime-authored-dynamic-object-material" as const;
export const RUNTIME_AUTHORED_DYNAMIC_DETAIL_ROLE_POLICY =
	"runtime-authored-none" as const;
export const RUNTIME_AUTHORED_DYNAMIC_DIAGNOSTICS_BUCKET =
	"runtime-authored-dynamic" as const;

export function createDynamicVisualResourceId(
	entityId: DynamicEntityId,
): string {
	return `dynamic-visual-resource:${entityId}`;
}

export function createStaticAuthoredDynamicTextureBatchId(options: {
	readonly entityId: DynamicEntityId;
	readonly ownerId: string;
}): string {
	return `dynamic-static-authored:${options.ownerId}:${options.entityId}`;
}

export function createRuntimeDynamicTextureBatchId(
	entityId: DynamicEntityId,
): string {
	return `runtime-dynamic:${entityId}`;
}

/** Static-authored placement fact shapes that can become dynamic runtime records. */
export type StaticAuthoredDynamicPlacementFacts =
	| EnvCellStaticObjectDynamicPlacementFacts
	| OutdoorStaticObjectDynamicPlacementFacts;

export interface DynamicEntityRecord {
	readonly animation: DynamicEntityAnimationState;
	readonly baseTransform: DynamicEntityTransformState;
	readonly bounds: DynamicEntityBoundsState;
	/** Current render residence. Runtime-authored records may temporarily have none. */
	readonly effectiveResidence: DynamicEntityRenderResidence;
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
	readonly diagnosticsBucket: DynamicDiagnosticsBucket;
	readonly materialPlanningIdentity: DynamicMaterialPlanningIdentity;
	readonly materialPlanningDomain: DynamicMaterialPlanningDomain;
	readonly materialDetailRolePolicy: DynamicMaterialDetailRolePolicy;
	readonly ownershipPolicy: DynamicVisualOwnershipPolicy;
	readonly resourceFamily: DynamicResourceFamily;
	readonly retentionPolicy: DynamicRetentionPolicy;
	readonly textureBatchId: string;
	readonly textureDomain: VisualTextureDomain;
}

type DynamicResourceFamily =
	| "static-authored-dynamic-object-material"
	| typeof RUNTIME_AUTHORED_DYNAMIC_RESOURCE_FAMILY;

type DynamicMaterialPlanningDomain = StaticMaterialPlanningDomain;

type DynamicMaterialDetailRolePolicy =
	| {
			readonly kind: "static-domain";
			readonly domain: Exclude<
				StaticMaterialPlanningDomain,
				typeof RUNTIME_AUTHORED_DYNAMIC_RESOURCE_FAMILY
			>;
	  }
	| {
			readonly kind: typeof RUNTIME_AUTHORED_DYNAMIC_DETAIL_ROLE_POLICY;
	  };

type DynamicDiagnosticsBucket =
	| "static-authored-dynamic"
	| typeof RUNTIME_AUTHORED_DYNAMIC_DIAGNOSTICS_BUCKET;

type DynamicRetentionPolicy =
	| {
			readonly kind: "static-layer-owner";
			readonly layerOwnerId: string;
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

interface DynamicEntityAppearanceSubPalette {
	readonly subId: number;
	readonly offset: number;
	readonly numColors: number;
}

interface DynamicEntityAppearanceTextureChange {
	readonly partIndex: number;
	readonly oldTexture: number;
	readonly newTexture: number;
}

interface DynamicEntityAppearanceAnimPartChange {
	readonly partIndex: number;
	readonly partId: number;
}

/** ObjDesc-shaped per-entity appearance facts projected from server/ACE source data. */
export interface DynamicEntityAppearanceOverride {
	readonly paletteId: number | null;
	readonly subPalettes: readonly DynamicEntityAppearanceSubPalette[];
	readonly textureChanges: readonly DynamicEntityAppearanceTextureChange[];
	readonly animPartChanges: readonly DynamicEntityAppearanceAnimPartChange[];
}

/** Source-neutral visual inputs consumed by dynamic resource and renderer pipelines. */
export interface DynamicVisualSource {
	readonly animationSelection: DynamicEntityAnimationSelection;
	readonly modelData: DynamicEntityAppearanceOverride | null;
	readonly setupModelId: number;
	readonly sourceAssetIds: readonly string[];
	/** Concrete authoring/source residence used for resource lookup and planning. */
	readonly sourceResidence: DynamicEntityResidence;
}

export type DynamicEntityRecipeSource =
	| {
			/** Static source fanout discovered this dynamic placement. */
			readonly kind: "static-authored";
			readonly owner: StaticLayerPeerRecordOwner;
			/** Stable placement id before runtime owns the live entity record. */
			readonly placementId: string;
			readonly sourceResidence: DynamicEntityResidence;
	  }
	| {
			/** Browser/runtime-authored request shaped like a future server-authored spawn. */
			readonly kind: "runtime-authored";
			readonly runtimeEntityId: DynamicEntityId;
			readonly sourceResidence: DynamicEntityResidence;
	  };

export interface DynamicEntityRecipe {
	/** Stable entity identity before visual baking; runtime owns final lifetime. */
	readonly entityId: DynamicEntityId;
	/** Source-specific provenance and activation policy. */
	readonly source: DynamicEntityRecipeSource;
	/** Placement at source residence before animation sampling. */
	readonly baseTransform: DynamicEntityTransformState;
	/** Animation selection requested by source facts or runtime input. */
	readonly animationSelection: DynamicEntityAnimationSelection;
	/** Data-only visual recipe consumed by the worker-backed visual baker. */
	readonly visual: DynamicVisualRecipe;
}

export interface DynamicVisualRecipe {
	/** Setup model driving part layout, default animation, and source closure. */
	readonly setupModel: StaticObjectSourceAssetFacts;
	/** Optional explicit/default animation payload facts, or null when animation is not required. */
	readonly animation: DynamicEntityAnimationResource | null;
	/** Resolved source closure; the visual baker must not do lazy host asset lookup. */
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	readonly materialSources: readonly StaticObjectMaterialSourceFacts[];
	readonly paletteSources: readonly StaticObjectPaletteSourceFacts[];
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
	readonly missingRefs: readonly StaticResourceIdentity[];
	/** Material planning policy and dynamic ownership identities, not renderer state. */
	readonly materialPolicy: DynamicVisualMaterialPolicy;
}

export interface DynamicVisualMaterialPolicy {
	readonly detailRolePolicy: DynamicVisualMaterialDetailRolePolicy;
	readonly materialPlanningDomain: StaticMaterialPlanningDomain;
	readonly visualObject: DynamicVisualObjectIdentity;
}

export type DynamicVisualMaterialDetailRolePolicy =
	| {
			readonly kind: "static-domain";
			readonly domain: Exclude<
				StaticMaterialPlanningDomain,
				typeof RUNTIME_AUTHORED_DYNAMIC_RESOURCE_FAMILY
			>;
	  }
	| {
			readonly kind: typeof RUNTIME_AUTHORED_DYNAMIC_DETAIL_ROLE_POLICY;
	  };

export interface DynamicVisualBakeInput {
	readonly batchId: string;
	readonly recipes: readonly DynamicEntityRecipe[];
	readonly revision: number;
	/** Geometry buffers required by the baker; prepared before crossing the bake boundary. */
	readonly sourceGeometry: readonly StaticObjectSourceGeometryAttachment[];
	/** Texture placements assigned before baking so baked resources can declare legal dependencies. */
	readonly texturePlacementSnapshot: TexturePlacementSnapshot;
}

/** Pre-bake dynamic visual texture work discovered from source facts. */
export interface DynamicVisualTexturePlanning {
	/** Stable entity whose visual recipe produced these placement intents. */
	readonly entityId: DynamicEntityId;
	/** Texture placement intents that must be assigned before this visual is baked. */
	readonly placementIntents: readonly TexturePlacementIntent[];
	/** Texture requirements later reused by the baker and renderer binding path. */
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}

export interface DynamicVisualBakeResult {
	readonly batchId: string;
	readonly failures: readonly DynamicVisualBakeFailure[];
	readonly products: readonly DynamicVisualBakeProduct[];
	readonly revision: number;
}

export type DynamicVisualBakeProduct =
	| {
			readonly kind: "baked";
			readonly resource: BakedDynamicVisualResource;
	  }
	| {
			readonly entityId: DynamicEntityId;
			readonly kind: "skipped";
			readonly reason: DynamicVisualSkipReason;
	  };

export interface BakedDynamicVisualResource {
	readonly entityId: DynamicEntityId;
	readonly materialSlots: readonly DynamicEntityMaterialSlotRequirement[];
	readonly materialSources: readonly StaticObjectMaterialSourceFacts[];
	readonly paletteSources: readonly StaticObjectPaletteSourceFacts[];
	readonly renderParts: readonly DynamicEntityRenderPart[];
	readonly resourceId: string;
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	/** Active atlas placements pinned while this immutable visual resource is resident. */
	readonly textureDependencies: readonly TextureResourceDependencies[];
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}

export type DynamicVisualSkipReason =
	| {
			readonly kind: "missing-dependencies";
			readonly missingRefs: readonly StaticResourceIdentity[];
	  }
	| {
			readonly kind: "unsupported-materials";
			readonly unsupportedReasons: readonly DynamicEntityUnsupportedMaterialReason[];
	  }
	| {
			readonly kind: "invalid-recipe";
			readonly message: string;
	  };

export interface DynamicVisualBakeFailure {
	readonly entityId: DynamicEntityId | null;
	readonly message: string;
	readonly stage: "material-planning" | "render-part-extraction" | "validation";
}

export type DynamicVisualApplicationResult =
	| {
			readonly kind: "recipe-resolved";
			readonly recipe: DynamicEntityRecipe;
	  }
	| {
			readonly kind: "visual-baked";
			readonly resource: BakedDynamicVisualResource;
	  }
	| {
			readonly entityId: DynamicEntityId;
			readonly kind: "visual-skipped";
			readonly reason: DynamicVisualSkipReason;
	  };

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
			readonly layerOwnerId: string;
			readonly owner: StaticLayerPeerRecordOwner;
	  }
	| {
			readonly kind: "runtime-spawn";
			readonly serverInstanceIdMetadata: DynamicEntityServerInstanceMetadata | null;
			readonly sourceKind: "browser-authored-server-shaped";
	  };

type DynamicEntityProvenance =
	| {
			readonly kind: "static-authored-env-cell" | "static-authored-outdoor";
			readonly layerOwnerId: string;
			readonly owner: StaticLayerPeerRecordOwner;
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

export type DynamicEntityRenderResidence =
	| DynamicEntityResidence
	| {
			readonly kind: "no-residence";
			readonly reason: DynamicEntityNoResidenceReason;
	  };

type DynamicEntityNoResidenceReason =
	| "render-residence-evicted"
	| "render-residence-unassigned";

export type DynamicEntityAnimationSelection =
	| {
			/** Render from setup/default part placements without animation playback. */
			readonly kind: "none";
	  }
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
	readonly modelData: DynamicEntityAppearanceOverride | null;
	readonly runtimeEntityId: DynamicEntityId;
	readonly serverInstanceIdMetadata: DynamicEntityServerInstanceMetadata | null;
	readonly setupModelId: number;
	readonly sourceKind: "browser-authored-server-shaped";
}

interface StaticAuthoredDynamicEntitySourceFacts {
	readonly kind: "static-authored";
	readonly placement: StaticAuthoredDynamicPlacementFacts;
}

export type DynamicEntitySourceFacts =
	| RuntimeSpawnDynamicEntitySourceFacts
	| StaticAuthoredDynamicEntitySourceFacts;

export interface DynamicEntityAnimationState {
	readonly defaultAnimationId: number | null;
	readonly playback: DynamicEntityAnimationPlaybackState;
	readonly status: DynamicEntityAnimationStatus;
}

type DynamicEntityAnimationStatus =
	| "failed"
	| "not-required"
	| "pending-resource"
	| "ready";

type DynamicEntityAnimationNotRequiredReason =
	| "animation-not-selected"
	| "setup-default-animation-missing";

export type DynamicEntityAnimationPlaybackState =
	| {
			readonly status: "pending-resource";
	  }
	| {
			/** No animation was selected; renderers should use the setup/default pose. */
			readonly reason: DynamicEntityAnimationNotRequiredReason;
			readonly status: "not-required";
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
	readonly baseLocalPlacement: StaticAuthoredDynamicPlacementFacts["localPlacement"];
	readonly sourceScale: StaticAuthoredDynamicPlacementFacts["sourceScale"];
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

export type DynamicEntityResourceStatus =
	| "failed"
	| "pending"
	| "ready"
	| "setup-animation-ready";

export type DynamicEntitySetupAnimationResourceState =
	| {
			readonly animationKey?: DynamicEntityResourceKey;
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
			/** Setup-default animation is being resolved from the prepared setup model. */
			readonly pendingReason: "setup-default-animation-resolving";
			readonly setupModelKey: DynamicEntityResourceKey;
			readonly status: "pending";
	  }
	| {
			/** No animation was selected; visual resources may still render in setup/default pose. */
			readonly reason: DynamicEntityAnimationNotRequiredReason;
			readonly setupModelKey: DynamicEntityResourceKey;
			readonly status: "not-required";
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

export type DynamicEntityVisualResourceState =
	| {
			readonly status: "blocked" | "pending";
	  }
	| DynamicEntityVisualResourcesReadyState
	| DynamicEntityVisualResourcesFailedState;

export interface DynamicEntityVisualResourcesReadyState {
	readonly materialSources: readonly StaticObjectMaterialSourceFacts[];
	readonly materialSlots: readonly DynamicEntityMaterialSlotRequirement[];
	readonly paletteSources: readonly StaticObjectPaletteSourceFacts[];
	readonly renderParts: readonly DynamicEntityRenderPart[];
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	readonly status: "ready";
	/** Active atlas placements pinned while this immutable visual resource is resident. */
	readonly textureDependencies: readonly TextureResourceDependencies[];
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
	readonly textureRequirements: readonly DynamicEntityTextureRequirement[];
}

export interface DynamicEntityRenderPart extends VisualGeometryPayload {
	readonly partIndex: number;
	readonly sourceAssetId: string;
}

export interface DynamicEntityVisualResourcesFailedState {
	readonly failures: readonly DynamicEntityResourceFailure[];
	readonly missingRefs: readonly StaticResourceIdentity[];
	readonly status: "failed";
	readonly unsupportedReasons: readonly DynamicEntityUnsupportedMaterialReason[];
}

export interface DynamicEntityMaterialSlotRequirement {
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
	| "no-render-residence"
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
}

export interface DynamicEntitySummaryDto {
	readonly animation: DynamicEntityAnimationSummaryDto;
	readonly baseTransform: DynamicEntityTransformState;
	readonly bounds: DynamicEntityBoundsState;
	readonly effectiveResidence: DynamicEntityRenderResidence;
	readonly id: DynamicEntityId;
	readonly presentation: DynamicEntityPresentation;
	readonly provenance: DynamicEntityProvenance;
	readonly renderability: DynamicEntityRenderability;
	readonly resources: DynamicEntityResourceSummaryDto;
	readonly source: DynamicEntitySourceSummaryDto;
	readonly sourceResidence: DynamicEntityResidence;
}

interface DynamicEntityAnimationSummaryDto {
	readonly defaultAnimationId: number | null;
	readonly playback: DynamicEntityAnimationPlaybackSummaryDto;
	readonly status: DynamicEntityAnimationStatus;
}

export type DynamicEntityAnimationPlaybackSummaryDto =
	| {
			readonly status: "pending-resource";
	  }
	| {
			/** No animation was selected; renderers should use the setup/default pose. */
			readonly reason: DynamicEntityAnimationNotRequiredReason;
			readonly status: "not-required";
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
			readonly animationKey?: DynamicEntityResourceKey;
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
			readonly pendingReason: "setup-default-animation-resolving";
			readonly setupModelKey: DynamicEntityResourceKey;
			readonly status: "pending";
	  }
	| {
			readonly reason: DynamicEntityAnimationNotRequiredReason;
			readonly setupModelKey: DynamicEntityResourceKey;
			readonly status: "not-required";
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
			readonly object: StaticAuthoredDynamicPlacementFacts["object"];
			readonly setupModelId: number;
			readonly sourceAssetId: string;
	  }
	| {
			readonly animationSelection: DynamicEntityAnimationSelection;
			readonly kind: "runtime-spawn";
			readonly modelData: DynamicEntityAppearanceOverride | null;
			readonly runtimeEntityId: DynamicEntityId;
			readonly serverInstanceIdMetadata: DynamicEntityServerInstanceMetadata | null;
			readonly setupModelId: number;
			readonly sourceKind: "browser-authored-server-shaped";
	  };

export function isOutdoorDynamicPlacementRecord(
	record: StaticAuthoredDynamicPlacementRecord,
): record is Extract<
	StaticAuthoredDynamicPlacementRecord,
	{ readonly kind: "outdoor-static-object-dynamic-placement" }
> {
	return record.kind === "outdoor-static-object-dynamic-placement";
}

export function isEnvCellDynamicPlacementRecord(
	record: StaticAuthoredDynamicPlacementRecord,
): record is Extract<
	StaticAuthoredDynamicPlacementRecord,
	{ readonly kind: "env-cell-static-object-dynamic-placement" }
> {
	return record.kind === "env-cell-static-object-dynamic-placement";
}
