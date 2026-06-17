import type { StaticDrawUnit, TransitionApertureBatch } from "../static/contracts";
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
	readonly sceneDomainTargets: SceneDomainTargetSnapshot;
	readonly staticDrawUnits: number;
	readonly terrainDrawUnits: number;
	readonly transitionApertureBatches: number;
	readonly transitionApertures: number;
	readonly renderedTriangles: number;
	readonly debugOverlayPrimitives: number;
}

export type RendererSnapshotListener = (snapshot: RendererSnapshot) => void;

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

export type RenderPassPlan =
	| {
			readonly kind: "single-surface-resident";
	  }
	| {
			readonly kind: "portal-scene-domains";
			readonly baseScene: PortalSceneDomain;
			readonly transitionDepthPolicy: PortalTransitionDepthPolicy;
	  };

export interface SceneDomainTargetSnapshot {
	readonly active: boolean;
	readonly width: number;
	readonly height: number;
	readonly colorFormat: "rgb8";
	readonly depthFormat: "depth-component24";
	readonly exteriorDrawCalls: number;
	readonly interiorDrawCalls: number;
}

export interface Renderer {
	applyStaticDelta(delta: StaticResidencyDelta): void;
	applyDynamicDelta(delta: DynamicResidencyDelta): void;
	applyTexturePlacementUpdate(update: TexturePlacementUpdate): void;
	applySamplerPolicyUpdate(update: SamplerPolicyUpdate): void;
	setStaticRenderAnchorLandblockId(anchorLandblockId: number | null): void;
	setRenderPassPlan(plan: RenderPassPlan): void;
	setDebugOverlayPrimitives(primitives: readonly DebugOverlayPrimitive[]): void;
	updateFrameState(state: FrameState): void;
	subscribe(listener: RendererSnapshotListener): () => void;
	dispose(): void;
}
