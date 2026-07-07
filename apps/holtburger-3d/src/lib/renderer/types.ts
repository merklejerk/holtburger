import type {
	EnvCellStaticObjectPlacementRecord,
	StaticBakeTextureUse,
	StaticDomain,
	OutdoorStaticObjectLayerDomain,
	StaticPortalApertureResource,
	StaticMaterialCoverageReport,
	StaticObjectGeometryStaticDrawUnit,
	StaticObjectRenderInstance,
	StaticObjectVisualResource,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
	StaticPortalProjectionRecord,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	StaticVisibilityRecord,
	StructuredInteriorGeometryStaticDrawUnit,
	TerrainGeometryStaticDrawUnit,
} from "../static/contracts";
import type { VisualGeometryPayload } from "../visual/visual-geometry";
import type {
	TextureFilteringMode,
	TexturePageSampleClass,
	TextureWrapMode,
} from "../textures/sampling-policy";
import type { TextureResourceDependencies } from "../textures/placement";
import type {
	TextureBindingId,
	TextureKey,
	TextureOwnerId,
	TexturePageClass,
} from "../textures/identity";

export const MAX_TERRAIN_COLOR_PAGES_PER_DRAW = 4;
export const MAX_TERRAIN_MASK_PAGES_PER_DRAW = 4;
export const MAX_OBJECT_MATERIAL_ENTRIES_PER_DRAW = 8;

export interface FrameState {
	readonly camera: {
		readonly position: readonly [number, number, number];
		readonly yawRadians: number;
		readonly pitchRadians: number;
	};
	readonly timeSeconds: number;
}

export type StaticLandblockLayerKind =
	| "terrain"
	| "outdoor-buildings"
	| OutdoorStaticObjectLayerDomain
	| "env-cell-system";

export interface StaticLandblockLayerOwnershipKey {
	readonly kind: StaticLandblockLayerKind;
	readonly landblockId: number;
}

export type StaticLandblockLayerGenerationId = string;

interface StaticLandblockLayerPayloadBase {
	readonly generationId: StaticLandblockLayerGenerationId;
	readonly landblockId: number;
	readonly materialCoverage: readonly StaticMaterialCoverageReport[];
	readonly textureUses: readonly StaticBakeTextureUse[];
}

export interface TerrainLayerPayload extends StaticLandblockLayerPayloadBase {
	readonly kind: "terrain";
	readonly drawUnits: readonly TerrainGeometryStaticDrawUnit[];
	readonly sourceMappingRecords: readonly StaticSourceMappingRecord[];
	readonly spatialRecords: readonly StaticSpatialRecord[];
}

export interface OutdoorBuildingsLayerPayload extends StaticLandblockLayerPayloadBase {
	readonly kind: "outdoor-buildings";
	readonly drawUnits: readonly OutdoorStaticObjectLayerDrawUnit<"outdoor-buildings">[];
	readonly sourceMappingRecords: readonly StaticSourceMappingRecord[];
	readonly spatialRecords: readonly StaticSpatialRecord[];
}

export interface OutdoorExplicitObjectsLayerPayload extends StaticLandblockLayerPayloadBase {
	readonly kind: "outdoor-explicit-objects";
	readonly drawUnits: readonly OutdoorStaticObjectLayerDrawUnit<"outdoor-explicit-objects">[];
	readonly sourceMappingRecords: readonly StaticSourceMappingRecord[];
	readonly spatialRecords: readonly StaticSpatialRecord[];
}

export interface OutdoorGeneratedSceneryLayerPayload extends StaticLandblockLayerPayloadBase {
	readonly kind: "outdoor-generated-scenery";
	readonly drawUnits: readonly OutdoorStaticObjectLayerDrawUnit<"outdoor-generated-scenery">[];
	readonly instancedObjectInstances: readonly StaticObjectRenderInstance[];
	readonly instancedObjectResources: readonly StaticObjectVisualResource[];
	readonly sourceMappingRecords: readonly StaticSourceMappingRecord[];
	readonly spatialRecords: readonly StaticSpatialRecord[];
}

export interface EnvCellSystemLayerPayload extends StaticLandblockLayerPayloadBase {
	readonly kind: "env-cell-system";
	readonly envCellStaticObjectPlacementRecords: readonly EnvCellStaticObjectPlacementRecord[];
	readonly envCellStaticObjectDrawUnits: readonly OutdoorStaticObjectLayerDrawUnit<"env-cell-system">[];
	readonly portalApertureResources: readonly StaticPortalApertureResource[];
	readonly portalGraphRecords: readonly StaticPortalGraphRecord[];
	readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly portalProjectionRecords: readonly StaticPortalProjectionRecord[];
	readonly resourceMembership: readonly EnvCellSystemLayerResourceMembership[];
	readonly sourceMappingRecords: readonly StaticSourceMappingRecord[];
	readonly spatialRecords: readonly StaticSpatialRecord[];
	readonly structuredInteriorDrawUnits: readonly StructuredInteriorGeometryStaticDrawUnit[];
	readonly visibilityRecords: readonly StaticVisibilityRecord[];
}

type OutdoorStaticObjectLayerDrawUnit<
	Domain extends StaticObjectGeometryStaticDrawUnit["domain"],
> = StaticObjectGeometryStaticDrawUnit & {
	readonly domain: Domain;
};

interface EnvCellSystemLayerResourceMembership {
	readonly envCellId: number;
	readonly envCellStaticObjectDrawUnitIds: readonly string[];
	readonly structuredInteriorDrawUnitIds: readonly string[];
}

export interface RendererStaticLayerVisibility {
	readonly envCellInteriors: boolean;
	readonly outdoorBuildings: boolean;
	readonly outdoorExplicitObjects: boolean;
	readonly outdoorGeneratedScenery: boolean;
	readonly terrain: boolean;
}

export const DEFAULT_RENDERER_STATIC_LAYER_VISIBILITY: RendererStaticLayerVisibility =
	Object.freeze({
		envCellInteriors: true,
		outdoorBuildings: true,
		outdoorExplicitObjects: true,
		outdoorGeneratedScenery: true,
		terrain: true,
	});

export function staticLayerKindForStaticDomain(
	domain: StaticDomain,
): StaticLandblockLayerKind {
	switch (domain) {
		case "outdoor-terrain":
			return "terrain";
		case "outdoor-buildings":
			return "outdoor-buildings";
		case "outdoor-explicit-objects":
			return "outdoor-explicit-objects";
		case "outdoor-generated-scenery":
			return "outdoor-generated-scenery";
		case "env-cell-system":
			return "env-cell-system";
	}
}

export function createStaticLandblockLayerKey(
	key: StaticLandblockLayerOwnershipKey,
): string {
	return `${key.kind}:${formatLayerLandblockId(key.landblockId)}`;
}

export function createStaticLandblockLayerGenerationId(input: {
	readonly kind: StaticLandblockLayerKind;
	readonly landblockId: number;
	readonly sourceKey: number | string;
}): StaticLandblockLayerGenerationId {
	return [
		input.kind,
		formatLayerLandblockId(input.landblockId),
		String(input.sourceKey),
	].join(":");
}

function formatLayerLandblockId(landblockId: number): string {
	return `0x${(landblockId >>> 0).toString(16).padStart(8, "0")}`;
}

export type DebugOverlayPrimitive =
	| DebugOverlayAabbPrimitive
	| DebugOverlayTrianglePrimitive;

interface DebugOverlayAabbPrimitive {
	readonly kind: "aabb";
	readonly id: string;
	readonly min: readonly [number, number, number];
	readonly max: readonly [number, number, number];
	readonly color: readonly [number, number, number, number];
}

interface DebugOverlayTrianglePrimitive {
	readonly kind: "triangles";
	readonly id: string;
	readonly vertices: readonly (readonly [number, number, number])[];
	readonly color: readonly [number, number, number, number];
}

export interface TexturePlacementUpdate {
	readonly bindingReadinessUpdates: readonly TextureBindingReadinessUpdate[];
	readonly placements: readonly TexturePlacement[];
	readonly removedTextureRefIds: readonly string[];
	readonly resolvedTexturePlacements: readonly ResolvedTexturePlacement[];
	readonly revision: number;
}

type TextureBindingReadinessUpdate =
	| {
			readonly bindingId: TextureBindingId;
			readonly kind: "pending";
			readonly reason: string;
	  }
	| {
			readonly bindingId: TextureBindingId;
			readonly kind: "failed";
			readonly reason: string;
	  }
	| {
			readonly bindingId: TextureBindingId;
			readonly kind: "missing-not-in-flight";
			readonly reason: string;
	  };

export interface TexturePageVersion {
	/** Renderer texture object identity for this atlas page. */
	readonly textureRefId: string;
	/** Monotonic page content revision within the placement bucket. */
	readonly placementRevision: number;
}

interface TexturePlacement {
	/** Page identity for the uploaded pixels. */
	readonly pageVersion: TexturePageVersion;
	readonly textureRefId: string;
	readonly bindingId: TextureBindingId;
	readonly placementRevision: number;
	readonly filteringMode: TextureFilteringMode;
	readonly sampleClass: TexturePageSampleClass;
	readonly samplerPolicyKey: string;
	readonly mipmapsGenerated: boolean;
	readonly anisotropy: number;
	readonly wrapS: TextureWrapMode;
	readonly wrapT: TextureWrapMode;
	readonly width: number;
	readonly height: number;
	readonly format: "rgba8" | "r8" | "rg8";
	readonly pixels: Uint8Array;
	readonly rect: readonly [number, number, number, number];
}

type DynamicRendererResourceId = string;
type DynamicRendererEntityId = string;
type DynamicRendererInstanceId = string;

export interface DynamicRendererResourceCommit {
	/** Dynamic visual resources to install or refresh in renderer-owned residency. */
	readonly addedVisualResources: readonly DynamicRendererVisualResource[];
	/** Dynamic visual resource ids whose renderer residency should be released. */
	readonly removedVisualResourceIds: readonly DynamicRendererResourceId[];
	readonly revision: number;
}

export interface DynamicRendererInstanceCommit {
	/** Frame time used to derive the submitted dynamic poses. */
	readonly frameTimeSeconds: number;
	readonly instances: readonly DynamicRendererInstance[];
	readonly revision: number;
}

export interface DynamicRendererVisualResource {
	/** Renderer resource id; distinct from semantic dynamic entity id. */
	readonly resourceId: DynamicRendererResourceId;
	/** Semantic dynamic entity that caused this visual resource to be resident. */
	readonly entityId: DynamicRendererEntityId;
	readonly materialPlan: DynamicRendererMaterialPlan;
	readonly parts: readonly DynamicRendererVisualPart[];
	/** Active atlas placements pinned while this immutable visual resource is resident. */
	readonly textureDependencies: readonly TextureResourceDependencies[];
}

export interface DynamicRendererVisualPart extends VisualGeometryPayload {
	readonly partIndex: number;
	/** Stable renderer partition identity; source animation transforms still use `partIndex`. */
	readonly renderPartId: string;
	readonly sourceAssetId: string;
}

interface DynamicRendererMaterialPlan {
	readonly skipped: readonly DynamicRendererSkippedMaterial[];
	readonly textureUses: readonly DynamicRendererTextureUse[];
}

interface DynamicRendererTextureUse {
	readonly bindingId: TextureBindingId;
	readonly ownerIds: readonly TextureOwnerId[];
	readonly pageClass: TexturePageClass;
	readonly role: string;
	readonly samplingPolicy?: StaticBakeTextureUse["samplingPolicy"];
	readonly source: StaticBakeTextureUse["source"];
	readonly textureKey: TextureKey;
}

interface DynamicRendererSkippedMaterial {
	readonly code: string;
	readonly message: string;
}

export interface DynamicRendererInstance {
	/** Renderer instance id; distinct from semantic dynamic entity id. */
	readonly instanceId: DynamicRendererInstanceId;
	readonly entityId: DynamicRendererEntityId;
	readonly resourceId: DynamicRendererResourceId;
	readonly objectToRenderMatrix: readonly number[];
	readonly partToObjectMatrices: readonly DynamicRendererPartTransform[];
	/** Render-space residence used by the renderer to select scene domain and anchor transform. */
	readonly renderResidence: DynamicRendererInstanceResidence;
}

interface DynamicRendererPartTransform {
	readonly matrix: readonly number[];
	readonly partIndex: number;
}

type DynamicRendererInstanceResidence =
	| {
			readonly kind: "outdoor-landblock";
			readonly landblockId: number;
	  }
	| {
			readonly envCellId: number;
			readonly kind: "env-cell";
			readonly landblockId: number;
	  };

export interface ResolvedTexturePlacement {
	/** Material consumer binding whose atlas placement was resolved. */
	readonly bindingId: TextureBindingId;
	/** Page identity that owns this rect. */
	readonly pageVersion: TexturePageVersion;
	readonly textureRefId: string;
	readonly textureWidth: number;
	readonly textureHeight: number;
	readonly rect: readonly [number, number, number, number];
}

export interface SamplerPolicyUpdate {
	readonly policies: readonly TextureSamplerPolicy[];
	readonly revision: number;
}

interface TextureSamplerPolicy {
	readonly textureRefId: string;
	readonly filteringMode: TextureFilteringMode;
	readonly samplerPolicyKey: string;
	readonly mipmapsGenerated: boolean;
	readonly anisotropy: number;
}

export interface RendererSnapshot {
	readonly canvasWidth: number;
	readonly canvasHeight: number;
	readonly frameCount: number;
	readonly frameHandlerMs: number;
	readonly isRunning: boolean;
	readonly backend: "webgl2";
	readonly error: string | null;
	readonly renderPassPlan: RenderPassPlan;
	readonly portalFrameWorkPlan: PortalFrameWorkPlan;
	readonly sceneDomainTargets: SceneDomainTargetSnapshot;
	readonly staticDrawUnits: number;
	readonly staticObjectResources: number;
	readonly staticObjectBakedDirectDrawCalls: number;
	readonly staticObjectVisualResources: number;
	readonly staticObjectRenderInstances: number;
	readonly staticObjectDirectRenderInstanceDrawCalls: number;
	readonly staticObjectInstancedRenderInstanceDrawCalls: number;
	readonly staticObjectInstancedRenderInstances: number;
	readonly staticObjectNearTransparentDirectRenderInstanceDrawCalls: number;
	readonly staticObjectFarTransparentDirectRenderInstanceDrawCalls: number;
	readonly staticObjectFarTransparentInstancedRenderInstanceDrawCalls: number;
	readonly staticObjectFarTransparentInstancedRenderInstances: number;
	readonly outdoorGeneratedSceneryStaticObjectResources: number;
	readonly outdoorGeneratedSceneryStaticObjectBakedDirectDrawCalls: number;
	readonly outdoorGeneratedSceneryStaticObjectBakedDirectDrawCallsByPass: StaticObjectMaterialPassDrawCallCounts;
	readonly outdoorGeneratedSceneryStaticObjectVisualResources: number;
	readonly outdoorGeneratedSceneryStaticObjectRenderInstances: number;
	readonly staticObjectUploadedBufferBytes: number;
	readonly outdoorGeneratedSceneryStaticObjectUploadedBufferBytes: number;
	readonly recentStaticObjectUploads: readonly StaticObjectUploadDiagnostics[];
	readonly terrainDrawUnits: number;
	/** Material mode each resident terrain draw unit will use in the renderer. */
	readonly terrainMaterialDiagnostics: readonly RendererTerrainMaterialDiagnostics[];
	readonly directEnvCellDrawCalls: number;
	readonly dynamicVisualResources: number;
	readonly dynamicVisualResourceTextureUses: number;
	readonly dynamicInstances: number;
	readonly dynamicDrawCalls: number;
	readonly skippedDynamicSubmissions: number;
	readonly recentDynamicResourceCommits: readonly DynamicRendererResourceCommitDiagnostics[];
	readonly renderedTriangles: number;
	readonly debugOverlayPrimitives: number;
}

export interface RendererTerrainMaterialDiagnostics {
	readonly drawUnitId: string;
	readonly fallbackReasons: readonly string[];
	readonly landblockId: number;
	readonly materialFamily:
		| "terrain-debug-flat"
		| "terrain-single-base-color"
		| "terrain-layered";
	readonly mode:
		| "debug-flat"
		| "flat-fallback"
		| "layered"
		| "single-base-color";
	readonly nonResidentTextureBindings: readonly RendererTerrainTextureBindingDiagnostics[];
	readonly textureBindingCount: number;
}

export interface RendererTerrainTextureBindingDiagnostics {
	readonly bindingId: TextureBindingId;
	readonly state:
		| "failed"
		| "missing-not-in-flight"
		| "pending"
		| "resident-without-texture";
}

export interface RendererResourceSnapshot {
	/** Direct draw calls emitted for direct env-cell rendering in the last rendered frame. */
	readonly directEnvCellDrawCalls: number;
	/** Dynamic draw calls emitted in the last rendered frame. */
	readonly dynamicDrawCalls: number;
	/** Dynamic render instances currently resident in the renderer. */
	readonly dynamicInstances: number;
	/** Dynamic visual resources currently resident in the renderer. */
	readonly dynamicVisualResources: number;
	/** Static draw units currently resident in the renderer. */
	readonly staticDrawUnits: number;
	/** Terrain draw units currently resident in the renderer. */
	readonly terrainDrawUnits: number;
}

export type RendererObjectMaterialTextureRole =
	| "base-color"
	| "detail"
	| "index"
	| "palette";

export type RendererObjectMaterialTextureDiagnostics =
	| {
			readonly drawUnitId: string;
			readonly status: "missing-resource";
	  }
	| {
			readonly drawUnitId: string;
			readonly materialEntries: readonly RendererObjectMaterialEntryDiagnostics[];
			readonly status: "resolved";
			readonly textureBindings: readonly RendererObjectMaterialTextureBindingDiagnostics[];
	  };

export interface RendererObjectMaterialEntryDiagnostics {
	readonly baseColorRect: readonly [number, number, number, number];
	readonly detailRect: readonly [number, number, number, number];
	readonly detailTextureEnabled: boolean;
	readonly indexRect: readonly [number, number, number, number];
	readonly materialIds: readonly number[];
	readonly paletteRect: readonly [number, number, number, number];
	readonly slot: number;
	readonly wrapMode: "clamp" | "repeat";
}

export interface RendererObjectMaterialTextureBindingDiagnostics {
	readonly height: number;
	readonly pageVersion: TexturePageVersion;
	readonly role: RendererObjectMaterialTextureRole;
	readonly textureRefId: string;
	readonly width: number;
}

interface StaticObjectMaterialPassDrawCallCounts {
	readonly opaque: number;
	readonly alphaTest: number;
	readonly transparent: number;
	readonly additive: number;
}

export interface StaticObjectUploadDiagnostics {
	readonly kind: "static-object-upload-diagnostics";
	readonly domain: StaticObjectGeometryStaticDrawUnit["domain"];
	readonly landblockId: number;
	readonly drawUnitCount: number;
	readonly uploadedBufferBytes: number;
	readonly uploadMs: number;
}

export interface DynamicRendererResourceCommitDiagnostics {
	readonly addedVisualResources: number;
	readonly removedVisualResources: number;
	readonly revision: number;
	readonly skippedMaterials: number;
	readonly textureUses: number;
}

export interface RendererFrameTelemetry {
	readonly frameCount: number;
	readonly frameHandlerMs: number;
	readonly directEnvCellDrawCalls: number;
}

export type RendererFrameTelemetryListener = (
	telemetry: RendererFrameTelemetry,
) => void;

type PortalSceneDomain =
	| {
			readonly kind: "exterior";
			readonly landblockId: number;
	  }
	| {
			readonly kind: "interior";
			readonly landblockId: number;
			readonly envCellId: number;
	  };

interface PortalTransitionDepthPolicy {
	readonly maxDepth: number;
}

export type SceneDomainTargetKind = "exterior" | "interior";

export type RenderPassPlan =
	| {
			readonly kind: "single-surface-resident";
	  }
	| {
			readonly kind: "portal-scene-domains";
			readonly baseScene: PortalSceneDomain;
			readonly transitionDepthPolicy: PortalTransitionDepthPolicy;
	  };

export type PortalFrameWorkPlan =
	| {
			readonly kind: "render-pass";
			readonly mode:
				| "single-surface-resident"
				| "flat-resident-diagnostic"
				| "scene-domain-composite";
			readonly renderPassPlan: RenderPassPlan;
	  }
	| {
			readonly kind: "direct-env-cell";
			readonly baseOverlap: PortalBaseOverlapPlan;
			readonly mode: "portal-projection";
			readonly exteriorComposite?: PortalFrameExteriorCompositePlan;
			readonly layeredGraph: PortalProjectionFrameGraphPlan;
	  };

export interface PortalFrameExteriorCompositePlan {
	readonly graphs: readonly PortalProjectionFrameGraphPlan[];
	readonly maxDepth: number;
}

type PortalFrameEdgeId = number;

export interface PortalProjectionFrameGraphPlan {
	readonly baseEntry: PortalProjectionFrameBaseEntryPlan;
	readonly renderEntries: readonly PortalProjectionFrameRenderEntryPlan[];
	readonly renderLayers: readonly PortalProjectionFrameLayerPlan[];
	readonly maskEdges: readonly PortalProjectionFrameMaskEdgePlan[];
	readonly outdoorCrossings: readonly PortalProjectionFrameOutdoorCrossingPlan[];
	readonly apertureResources: readonly PortalApertureGeometryResourcePlan[];
	readonly diagnostics: PortalApertureFrameDiagnostics;
	readonly projectionDiagnostics: PortalProjectionFrameDiagnostics;
}

export type PortalProjectionFrameBaseEntryPlan =
	| {
			readonly debugStackLabel: string;
			readonly scene: Extract<
				PortalFrameSceneSource,
				{ readonly kind: "outdoor-target" }
			>;
	  }
	| {
			readonly debugStackLabel: string;
			readonly resources: PortalFrameNodeResources;
			readonly scene: Extract<
				PortalFrameSceneSource,
				{ readonly kind: "env-cell-direct" }
			>;
	  };

export interface PortalProjectionFrameRenderEntryPlan {
	readonly renderEntryId: number;
	readonly envCellId: number;
	readonly landblockId: number;
	readonly renderLayer: number;
	readonly incomingMaskEdgeIds: readonly PortalFrameEdgeId[];
	readonly resources: PortalFrameNodeResources;
	readonly debugStackLabel: string;
}

export interface PortalProjectionFrameLayerPlan {
	readonly renderLayer: number;
	readonly renderEntryIds: readonly number[];
}

export interface PortalProjectionFrameMaskEdgePlan {
	readonly edgeId: PortalFrameEdgeId;
	readonly renderEntryId: number;
	readonly renderLayer: number;
	readonly apertureRangeId: string;
	readonly apertureSourceId: string;
	readonly linkId: string;
	readonly sourceKind: PortalApertureSourceKind;
	readonly sourceEnvCellId: number | null;
	readonly targetEnvCellId: number;
}

export interface PortalProjectionFrameOutdoorCrossingPlan {
	readonly crossingId: number;
	readonly targetEnvCellId: number;
	readonly outdoorLandblockId: number;
	readonly apertureRangeId: string;
	readonly apertureSourceId: string;
	readonly linkId: string;
}

interface PortalProjectionFrameDiagnostics {
	readonly componentCount: number;
	readonly cyclicComponentCount: number;
	readonly componentInternalEdgeCount: number;
	readonly maxProjectionRenderLayer: number;
	readonly maxSelectedRenderLayer: number;
	readonly projectedEnvCellCount: number;
	readonly renderEntryCount: number;
	readonly renderEntriesSkippedByLayerCap: number;
	readonly renderEntriesSkippedByMaxRenderEntries: number;
	readonly maskEdgesSkippedByLayerCap: number;
	readonly maskEdgesSkippedByMaxMaskEdges: number;
	readonly missingResourceMembershipCount: number;
	readonly outdoorCrossingCount: number;
	readonly outdoorCrossingsSkippedByLayerCap: number;
	readonly outdoorCrossingsSkippedByUnselectedTarget: number;
}

export interface PortalBaseOverlapPlan {
	readonly diagnostics: PortalBaseOverlapDiagnostics;
	readonly envCells: readonly PortalBaseOverlapEnvCellPlan[];
	readonly overlapSignature: string;
	readonly requiresExteriorSeed: boolean;
}

export interface PortalBaseOverlapEnvCellPlan {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly reasons: readonly PortalBaseOverlapReason[];
	readonly resources: PortalFrameNodeResources;
}

export type PortalBaseOverlapReason =
	| {
			readonly apertureRangeId: string;
			readonly kind: "env-cell-portal";
	  }
	| {
			readonly apertureRangeId: string;
			readonly kind: "building-transition";
	  };

interface PortalBaseOverlapDiagnostics {
	readonly envCellCount: number;
	readonly missingResourceEnvCellCount: number;
}

export interface PortalFrameNodeResources {
	readonly structuredInteriorDrawUnitIds: readonly string[];
	readonly envCellStaticObjectDrawUnitIds: readonly string[];
	readonly resourceState: "ready" | "missing-resources" | "not-applicable";
}

export type PortalFrameSceneSource =
	| {
			readonly kind: "env-cell-direct";
			readonly landblockId: number;
			readonly envCellId: number;
	  }
	| {
			readonly kind: "outdoor-target";
			readonly landblockId: number;
	  };

export type PortalApertureSourceKind =
	| "env-cell-portal"
	| "building-transition";

export interface PortalApertureGeometryResourcePlan {
	readonly resourceId: string;
	readonly sourceKinds: readonly PortalApertureSourceKind[];
}

export interface PortalApertureFrameDiagnostics {
	readonly buildingTransitionEdges: number;
	readonly dedupedGeometryResources: number;
	readonly duplicateMaskEdges: number;
	readonly envCellPortalEdges: number;
	readonly selectedMaskEdges: number;
	readonly transitionRootCandidateCount: number;
	readonly transitionRootCount: number;
	readonly transitionRootsRejectedNotSeenOutside: number;
	readonly transitionRootsRejectedUnknownSeenOutside: number;
}

export interface SceneDomainTargetSnapshot {
	readonly active: boolean;
	readonly width: number;
	readonly height: number;
	readonly colorFormat: "rgb8";
	readonly depthFormat: "depth24-stencil8";
	readonly compositingMode: "none" | "stencil-mask";
	readonly executedCompositeDepth: number;
	readonly compositePasses: number;
	readonly apertureBatchDrawCalls: number;
	readonly exteriorSuffixCompositeDepth: number;
	readonly exteriorSuffixCompositePasses: number;
	readonly envCellOutdoorCrossingColorBase: boolean;
	readonly exteriorDrawCalls: number;
	readonly interiorDrawCalls: number;
	readonly outdoorCrossingSource: "none" | "raw-exterior" | "exterior-suffix";
}

export interface Renderer {
	applyTexturePlacementUpdate(update: TexturePlacementUpdate): void;
	applySamplerPolicyUpdate(update: SamplerPolicyUpdate): void;
	setTerrainLayer(
		landblockId: number,
		payload: TerrainLayerPayload | null,
	): void;
	setOutdoorBuildingsLayer(
		landblockId: number,
		payload: OutdoorBuildingsLayerPayload | null,
	): void;
	setOutdoorExplicitObjectsLayer(
		landblockId: number,
		payload: OutdoorExplicitObjectsLayerPayload | null,
	): void;
	setOutdoorGeneratedSceneryLayer(
		landblockId: number,
		payload: OutdoorGeneratedSceneryLayerPayload | null,
	): void;
	setEnvCellSystemLayer(
		landblockId: number,
		payload: EnvCellSystemLayerPayload | null,
	): void;
	commitDynamicResources(commit: DynamicRendererResourceCommit): void;
	commitDynamicInstances(commit: DynamicRendererInstanceCommit): void;
	setStaticLayerVisibility(visibility: RendererStaticLayerVisibility): void;
	setStaticRenderAnchorLandblockId(anchorLandblockId: number | null): void;
	setFlatVisionModeEnabled(enabled: boolean): void;
	setRenderPassPlan(plan: RenderPassPlan): void;
	setPortalFrameWorkPlan(plan: PortalFrameWorkPlan): void;
	setDebugOverlayPrimitives(primitives: readonly DebugOverlayPrimitive[]): void;
	updateFrameState(state: FrameState): void;
	subscribeTelemetry(listener: RendererFrameTelemetryListener): () => void;
	createResourceSnapshot(): RendererResourceSnapshot;
	createObjectMaterialTextureDiagnostics(
		drawUnitIds: readonly string[],
	): readonly RendererObjectMaterialTextureDiagnostics[];
	createDiagnosticsSnapshot(): RendererSnapshot;
	dispose(): void;
}
