import type { LandblockOwnerId } from "../game-types";
import type {
	TerrainColorTextureArrayBinding,
	TextureArrayBinding,
} from "../textures/texture-manager";
import type {
	GeometryResourceKey,
	Texture2DResourceKey,
} from "./resource-manager";

/** Device-backed regional textures selected for one terrain draw. */
export interface TerrainTextureBindings {
	readonly colors: TerrainColorTextureArrayBinding;
	readonly blendMasks: TextureArrayBinding;
	readonly roadMasks: TextureArrayBinding;
	readonly detail: Texture2DResourceKey;
}

/** Fully resolved renderer input consumed by the future terrain compositing program. */
export interface TerrainProgramInput {
	/** Device binding for every selected terrain stride/direction index range. */
	readonly geometry: GeometryResourceKey;
	/** The selected stride's R32UI generated-cell pcode texture. */
	readonly surfaceField: Texture2DResourceKey;
	/** Stable regional RGBA32UI lookup texture for pcode composition. */
	readonly composition: Texture2DResourceKey;
	/** Device bindings for regional texture arrays and landscape detail. */
	readonly textures: TerrainTextureBindings;
}

/**
 * Fail loudly if two terrain draws in one pass resolve against different active regions.
 *
 * Everything here except `geometry` and `surfaceField` is keyed on `activeRegionKey`, so the
 * terrain pass binds those once and reuses them for every landblock. That is correct only while
 * one region is live, which holds today by construction: `activeRegionKey` takes no landblock
 * input, and exactly one `ActiveRegionSource` exists per content source. Nothing in the type
 * system says so, and a future multi-region source would otherwise draw one region's landblocks
 * with another's palette — a wrong picture with no error, which reads as a content bug.
 */
export function assertSharedTerrainRegion(
	expected: TerrainProgramInput,
	actual: TerrainProgramInput,
	landblockId: LandblockOwnerId,
): void {
	if (
		expected.composition !== actual.composition ||
		expected.textures.colors.resource !== actual.textures.colors.resource ||
		expected.textures.colors.palette !== actual.textures.colors.palette ||
		expected.textures.blendMasks.resource !==
			actual.textures.blendMasks.resource ||
		expected.textures.roadMasks.resource !==
			actual.textures.roadMasks.resource ||
		expected.textures.detail !== actual.textures.detail
	) {
		throw new Error(
			`Terrain landblock ${landblockId} resolves a different active region than its pass bound (${actual.composition} vs ${expected.composition}).`,
		);
	}
}
