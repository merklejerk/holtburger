import type {
	StandaloneTextureBinding,
	TextureArrayBinding,
} from "../textures/texture-manager";
import type {
	TerrainCompositionResourceKey,
	TerrainSurfaceResourceKey,
} from "./resource-manager";

/** Device-backed regional textures selected for one terrain draw. */
export interface TerrainTextureBindings {
	readonly colors: TextureArrayBinding;
	readonly blendMasks: TextureArrayBinding;
	readonly roadMasks: TextureArrayBinding;
	readonly detail: StandaloneTextureBinding;
}

/** Fully resolved renderer input consumed by the future terrain compositing program. */
export interface TerrainProgramInput {
	/** The selected stride's R32UI generated-cell pcode texture. */
	readonly surfaceField: TerrainSurfaceResourceKey;
	/** Stable regional RGBA32UI lookup texture for pcode composition. */
	readonly composition: TerrainCompositionResourceKey;
	/** Device bindings for regional texture arrays and landscape detail. */
	readonly textures: TerrainTextureBindings;
}
