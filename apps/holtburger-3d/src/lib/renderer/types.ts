import type {
	StaticAuthoredDynamicSeedRecord,
	StaticBakeTextureUse,
	StaticDomain,
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
import type {
	TextureFilteringMode,
	TexturePageSampleClass,
	TextureWrapMode,
} from "../textures/sampling-policy";

export const MAX_TERRAIN_COLOR_PAGES_PER_DRAW = 4;
export const MAX_TERRAIN_MASK_PAGES_PER_DRAW = 4;
export const MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW = 4;
export const MAX_STATIC_OBJECT_DETAIL_PAGES_PER_DRAW = 4;
export const MAX_STATIC_OBJECT_INDEX_PAGES_PER_DRAW = 4;
export const MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW = 8;
export const MAX_STATIC_OBJECT_PALETTE_PAGES_PER_DRAW = 4;

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
	| "outdoor-detail"
	| "env-cell-system";

export interface StaticLandblockLayerOwnershipKey {
	readonly kind: StaticLandblockLayerKind;
	readonly landblockId: number;
}

export type StaticLandblockLayerGenerationId = string;

export type StaticLandblockLayerPayload =
	| TerrainLayerPayload
	| OutdoorBuildingsLayerPayload
	| OutdoorDetailsLayerPayload
	| EnvCellSystemLayerPayload;

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

export interface OutdoorDetailsLayerPayload extends StaticLandblockLayerPayloadBase {
	readonly kind: "outdoor-detail";
	readonly drawUnits: readonly OutdoorStaticObjectLayerDrawUnit<"outdoor-detail">[];
	readonly instancedObjectInstances: readonly StaticObjectRenderInstance[];
	readonly instancedObjectResources: readonly StaticObjectVisualResource[];
	readonly sourceMappingRecords: readonly StaticSourceMappingRecord[];
	readonly spatialRecords: readonly StaticSpatialRecord[];
}

export interface EnvCellSystemLayerPayload extends StaticLandblockLayerPayloadBase {
	readonly kind: "env-cell-system";
	readonly authoredDynamicSeedRecords: readonly StaticAuthoredDynamicSeedRecord[];
	readonly envCellStaticObjectDrawUnits: readonly OutdoorStaticObjectLayerDrawUnit<"landblock-env-cells">[];
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
	readonly outdoorDetail: boolean;
	readonly terrain: boolean;
}

export const DEFAULT_RENDERER_STATIC_LAYER_VISIBILITY: RendererStaticLayerVisibility =
	Object.freeze({
		envCellInteriors: true,
		outdoorBuildings: true,
		outdoorDetail: true,
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
		case "outdoor-detail":
			return "outdoor-detail";
		case "landblock-env-cells":
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
	readonly placements: readonly TexturePlacement[];
	readonly removedTextureRefIds: readonly string[];
	readonly textureUsePlacements: readonly TextureUsePlacement[];
	readonly drawUnitBindings: readonly TextureDrawUnitBinding[];
	readonly revision: number;
}

interface TexturePlacement {
	readonly textureRefId: string;
	readonly textureUseId: string;
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

export interface TextureDrawUnitBinding {
	readonly drawUnitId: string;
	readonly textureUseId: string;
	readonly textureRefId: string;
	readonly rolePage: TextureRolePageSlot;
	readonly textureWidth: number;
	readonly textureHeight: number;
	readonly rect: readonly [number, number, number, number];
}

export interface TextureUsePlacement {
	readonly textureUseId: string;
	readonly textureRefId: string;
	readonly textureWidth: number;
	readonly textureHeight: number;
	readonly rect: readonly [number, number, number, number];
}

type TextureRolePageKind =
	| "color"
	| "detail"
	| "mask"
	| "static-base-color"
	| "static-detail"
	| "static-index"
	| "static-palette";

export type TerrainTextureRolePageKind = Extract<
	TextureRolePageKind,
	"color" | "detail" | "mask"
>;

export type StaticObjectTextureRolePageKind = Extract<
	TextureRolePageKind,
	"static-base-color" | "static-detail" | "static-index" | "static-palette"
>;

interface TextureRolePageSlot {
	readonly kind: TextureRolePageKind;
	readonly slot: number;
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
	readonly outdoorDetailStaticObjectResources: number;
	readonly outdoorDetailStaticObjectBakedDirectDrawCalls: number;
	readonly outdoorDetailStaticObjectBakedDirectDrawCallsByPass: StaticObjectMaterialPassDrawCallCounts;
	readonly outdoorDetailStaticObjectVisualResources: number;
	readonly outdoorDetailStaticObjectRenderInstances: number;
	readonly staticObjectUploadedBufferBytes: number;
	readonly outdoorDetailStaticObjectUploadedBufferBytes: number;
	readonly recentStaticObjectUploads: readonly StaticObjectUploadDiagnostics[];
	readonly terrainDrawUnits: number;
	readonly directEnvCellDrawCalls: number;
	readonly renderedTriangles: number;
	readonly debugOverlayPrimitives: number;
}

export interface StaticObjectMaterialPassDrawCallCounts {
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
			readonly kind: "legacy-render-pass";
			readonly mode:
				| "single-surface-resident"
				| "flat-resident-diagnostic"
				| "legacy-scene-domain-composite";
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

export interface PortalProjectionFrameDiagnostics {
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
	setOutdoorDetailsLayer(
		landblockId: number,
		payload: OutdoorDetailsLayerPayload | null,
	): void;
	setEnvCellSystemLayer(
		landblockId: number,
		payload: EnvCellSystemLayerPayload | null,
	): void;
	setStaticLayerVisibility(visibility: RendererStaticLayerVisibility): void;
	setStaticRenderAnchorLandblockId(anchorLandblockId: number | null): void;
	setFlatVisionModeEnabled(enabled: boolean): void;
	setRenderPassPlan(plan: RenderPassPlan): void;
	setPortalFrameWorkPlan(plan: PortalFrameWorkPlan): void;
	setDebugOverlayPrimitives(primitives: readonly DebugOverlayPrimitive[]): void;
	updateFrameState(state: FrameState): void;
	subscribeTelemetry(listener: RendererFrameTelemetryListener): () => void;
	createDiagnosticsSnapshot(): RendererSnapshot;
	dispose(): void;
}
