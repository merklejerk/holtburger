import type { StaticDrawUnit } from "../static/contracts";
import type {
	TextureFilteringMode,
	TexturePageSampleClass,
	TextureWrapMode,
} from "../textures/sampling-policy";

export const MAX_TERRAIN_COLOR_PAGES_PER_DRAW = 4;
export const MAX_TERRAIN_MASK_PAGES_PER_DRAW = 4;

export interface FrameState {
	readonly camera: {
		readonly position: readonly [number, number, number];
		readonly yawRadians: number;
		readonly pitchRadians: number;
	};
	readonly timeSeconds: number;
}

export interface StaticResidencyDelta {
	readonly addedDrawUnitPlacements: readonly StaticDrawUnitPlacement[];
	readonly removedDrawUnitIds: readonly string[];
	readonly revision: number;
}

interface StaticDrawUnitPlacement {
	readonly drawUnit: StaticDrawUnit;
	readonly translation: readonly [number, number, number];
}

interface DynamicResidencyDelta {
	readonly addedInstanceIds: readonly string[];
	readonly removedInstanceIds: readonly string[];
	readonly revision: number;
}

export interface TexturePlacementUpdate {
	readonly placements: readonly TexturePlacement[];
	readonly removedTextureRefIds: readonly string[];
	readonly drawUnitBindings: readonly TextureDrawUnitBinding[];
	readonly revision: number;
}

export interface TexturePlacement {
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
	readonly format: "rgba8";
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

export type TerrainTextureRolePageKind = "color" | "detail" | "mask";

interface TextureRolePageSlot {
	readonly kind: TerrainTextureRolePageKind;
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
	readonly staticDrawUnits: number;
	readonly terrainDrawUnits: number;
	readonly renderedTriangles: number;
}

export type RendererSnapshotListener = (snapshot: RendererSnapshot) => void;

export interface Renderer {
	applyStaticDelta(delta: StaticResidencyDelta): void;
	applyDynamicDelta(delta: DynamicResidencyDelta): void;
	applyTexturePlacementUpdate(update: TexturePlacementUpdate): void;
	applySamplerPolicyUpdate(update: SamplerPolicyUpdate): void;
	updateFrameState(state: FrameState): void;
	subscribe(listener: RendererSnapshotListener): () => void;
	dispose(): void;
}
