import { OUTDOOR_TERRAIN_GRID_CELLS } from "../landblocks";
import { TERRAIN_LIGHT_MASK_LENGTH } from "../environment/terrain-light-mask";

/**
 * Renderer-owned texture carrying one landblock's per-cell static light masks.
 *
 * One texture is reused across every landblock in a frame rather than one per landblock: the
 * table is 512 bytes and is re-uploaded at each of the frame's 13 to 22 terrain binds, which is
 * cheaper than the residency-scoped lifecycle a per-landblock texture would need.
 *
 * `RG32UI` because the mask is two 32-bit words per cell. Integer textures are not filterable, so
 * the caller must bind an `exact` sampler; anything else is undefined sampling.
 */
export interface WebGL2TerrainLightMaskTexture {
	readonly texture: WebGLTexture;
}

/** Allocate the immutable 8x8 RG32UI mask texture. */
export function createWebGL2TerrainLightMaskTexture(
	gl: WebGL2RenderingContext,
): WebGL2TerrainLightMaskTexture {
	const texture = gl.createTexture();
	if (texture === null) {
		throw new Error("Failed to create the terrain light mask texture.");
	}
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texStorage2D(
		gl.TEXTURE_2D,
		1,
		gl.RG32UI,
		OUTDOOR_TERRAIN_GRID_CELLS,
		OUTDOOR_TERRAIN_GRID_CELLS,
	);
	gl.bindTexture(gl.TEXTURE_2D, null);
	return { texture };
}

/**
 * Upload one landblock's mask table into the shared texture.
 *
 * The caller must have made the target texture unit active and bound this texture to it.
 * Row pitch is 8 texels of 8 bytes, so the default 4-byte unpack alignment already holds and no
 * pixel-store state is disturbed.
 */
export function uploadWebGL2TerrainLightMask(
	gl: WebGL2RenderingContext,
	masks: Uint32Array,
): void {
	if (masks.length !== TERRAIN_LIGHT_MASK_LENGTH) {
		throw new Error(
			`Terrain light mask table must hold ${TERRAIN_LIGHT_MASK_LENGTH} words; got ${masks.length}.`,
		);
	}
	gl.texSubImage2D(
		gl.TEXTURE_2D,
		0,
		0,
		0,
		OUTDOOR_TERRAIN_GRID_CELLS,
		OUTDOOR_TERRAIN_GRID_CELLS,
		gl.RG_INTEGER,
		gl.UNSIGNED_INT,
		masks,
	);
}

/** Release the mask texture with the rest of the renderer's context-owned resources. */
export function destroyWebGL2TerrainLightMaskTexture(
	gl: WebGL2RenderingContext,
	mask: WebGL2TerrainLightMaskTexture,
): void {
	gl.deleteTexture(mask.texture);
}
