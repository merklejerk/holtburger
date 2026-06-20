import type {
	StaticDrawUnit,
	TransitionApertureBatch,
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

export interface StaticResidencyDelta {
	readonly addedDrawUnits: readonly StaticDrawUnit[];
	readonly addedTransitionApertureBatches: readonly TransitionApertureBatch[];
	readonly removedDrawUnitIds: readonly string[];
	readonly removedTransitionApertureBatchIds: readonly string[];
	readonly revision: number;
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

interface DynamicResidencyDelta {
	readonly addedInstanceIds: readonly string[];
	readonly removedInstanceIds: readonly string[];
	readonly revision: number;
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
	readonly terrainDrawUnits: number;
	readonly envCellResourceMembership: readonly RendererEnvCellResourceMembership[];
	readonly transitionApertureBatches: number;
	readonly transitionApertures: number;
	readonly directEnvCellDrawCalls: number;
	readonly renderedTriangles: number;
	readonly debugOverlayPrimitives: number;
}

export type RendererSnapshotListener = (snapshot: RendererSnapshot) => void;

export interface RendererEnvCellResourceMembership {
	readonly landblockId: number;
	readonly envCellId: number;
	readonly structuredInteriorDrawUnitIds: readonly string[];
	readonly envCellStaticObjectDrawUnitIds: readonly string[];
	readonly sharedEnvCellStaticObjectDrawUnits: number;
}

export type PortalSceneDomain =
	| {
			readonly kind: "exterior";
			readonly landblockId: number;
	  }
	| {
			readonly kind: "interior";
			readonly landblockId: number;
			readonly envCellId: number;
	  };

export interface PortalTransitionDepthPolicy {
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
			readonly mode: "portal-traversal" | "portal-debug";
			readonly baseScene: PortalFrameBaseScenePlan;
			readonly directEnvCellDraws: readonly PortalDirectEnvCellDrawRequest[];
			readonly portalApertureGeometryResources: readonly PortalApertureGeometryResourcePlan[];
			readonly portalApertureDiagnostics: PortalApertureFrameDiagnostics;
			readonly portalApertureMaskPasses: readonly PortalApertureMaskPass[];
			readonly transitionSceneCrossings: readonly PortalTransitionSceneCrossing[];
	  };

export type PortalFrameBaseScenePlan =
	| {
			readonly kind: "outdoor-target";
			readonly landblockId: number;
	  }
	| {
			readonly kind: "env-cell-direct";
			readonly landblockId: number;
			readonly envCellId: number;
	  };

export interface PortalDirectEnvCellDrawRequest {
	readonly landblockId: number;
	readonly envCellId: number;
	readonly traversalDepth: number;
	readonly portalStackId: string;
	readonly structuredInteriorDrawUnitIds: readonly string[];
	readonly envCellStaticObjectDrawUnitIds: readonly string[];
	readonly resourceState: "ready" | "missing-resources";
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

export type PortalApertureVertex = readonly [number, number, number];

export type PortalApertureSourceKind =
	| "env-cell-portal"
	| "building-transition";

export type PortalApertureCullMode = "none" | "front" | "back";

export interface PortalApertureGeometryResourcePlan {
	readonly resourceId: string;
	readonly sourceKinds: readonly PortalApertureSourceKind[];
	readonly vertices: readonly PortalApertureVertex[];
}

export interface PortalApertureFrameDiagnostics {
	readonly buildingTransitionEdges: number;
	readonly dedupedGeometryResources: number;
	readonly duplicateMaskEdges: number;
	readonly envCellPortalEdges: number;
	readonly selectedMaskEdges: number;
	readonly transitionRootCount: number;
}

export interface PortalApertureMaskPass {
	readonly apertureResourceId: string;
	readonly apertureSourceId: string;
	readonly cullMode: PortalApertureCullMode;
	readonly linkId: string;
	readonly parentStencilRef: number | null;
	readonly portalStackId: string;
	readonly source: PortalFrameSceneSource;
	readonly sourceKind: PortalApertureSourceKind;
	readonly sourcePortalStackId: string;
	readonly stencilRef: number;
	readonly target: PortalFrameSceneSource;
	readonly traversalDepth: number;
}

export interface PortalTransitionSceneCrossing {
	readonly apertureBatchId: string;
	readonly aperturePortalId: string;
	readonly landblockId: number;
	readonly from: PortalTransitionSceneEndpoint;
	readonly to: PortalTransitionSceneEndpoint;
	readonly linkedEnvCellIds: readonly number[];
}

export type PortalTransitionSceneEndpoint =
	| {
			readonly kind: "outdoor";
			readonly landblockId: number;
	  }
	| {
			readonly kind: "env-cell";
			readonly landblockId: number;
			readonly envCellId: number;
	  };

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
	readonly exteriorDrawCalls: number;
	readonly interiorDrawCalls: number;
}

export interface Renderer {
	applyStaticDelta(delta: StaticResidencyDelta): void;
	applyDynamicDelta(delta: DynamicResidencyDelta): void;
	applyTexturePlacementUpdate(update: TexturePlacementUpdate): void;
	applySamplerPolicyUpdate(update: SamplerPolicyUpdate): void;
	setStaticRenderAnchorLandblockId(anchorLandblockId: number | null): void;
	setFlatVisionModeEnabled(enabled: boolean): void;
	setRenderPassPlan(plan: RenderPassPlan): void;
	setPortalFrameWorkPlan(plan: PortalFrameWorkPlan): void;
	setDebugOverlayPrimitives(primitives: readonly DebugOverlayPrimitive[]): void;
	updateFrameState(state: FrameState): void;
	subscribe(listener: RendererSnapshotListener): () => void;
	dispose(): void;
}
