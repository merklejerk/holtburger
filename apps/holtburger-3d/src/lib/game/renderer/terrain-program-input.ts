import type {
	Texture2DBinding,
	TextureArrayBinding,
} from "../textures/texture-manager";
import type { Texture2DResourceKey } from "./resource-manager";

/** Device-backed regional textures selected for one terrain draw. */
export interface TerrainTextureBindings {
	readonly colors: TextureArrayBinding;
	readonly blendMasks: TextureArrayBinding;
	readonly roadMasks: TextureArrayBinding;
	readonly detail: Texture2DBinding;
}

/** Fully resolved renderer input consumed by the future terrain compositing program. */
export interface TerrainProgramInput {
	/** The selected stride's R32UI generated-cell pcode texture. */
	readonly surfaceField: Texture2DResourceKey;
	/** Stable regional RGBA32UI lookup texture for pcode composition. */
	readonly composition: Texture2DResourceKey;
	/** Device bindings for regional texture arrays and landscape detail. */
	readonly textures: TerrainTextureBindings;
}
