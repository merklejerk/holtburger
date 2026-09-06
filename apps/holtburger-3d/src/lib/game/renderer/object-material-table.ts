import type { PreparedObjectSurface } from "./object-rendering-policy";

/** One RGBA32F row: color, base rectangle, palette rectangle, policy, alpha threshold. */
export const OBJECT_MATERIAL_TEXELS = 5;

/** Shader encoding shared by the table producer and consumers of its material kind. */
const MATERIAL_KIND = {
	"solid-color": 0,
	"direct-color": 1,
	index8: 2,
	index16: 3,
} as const;

/** Pack renderer-resolved surface data; physical texture bindings remain batch-owned. */
export function createObjectMaterialTable<TTexture, TSampler>(
	surfaces: readonly PreparedObjectSurface<TTexture, TSampler>[],
): Float32Array {
	const data = new Float32Array(surfaces.length * OBJECT_MATERIAL_TEXELS * 4);
	for (const [selector, surface] of surfaces.entries()) {
		const offset = selector * OBJECT_MATERIAL_TEXELS * 4;
		const material = surface.material;
		data.set(material.color, offset);
		if (material.kind !== "solid-color")
			data.set(material.base.rect, offset + 4);
		if (material.kind === "index8" || material.kind === "index16")
			data.set(material.palette.rect, offset + 8);
		data[offset + 12] = MATERIAL_KIND[material.kind];
		data[offset + 13] = Number(surface.wrapRepeat);
		data[offset + 14] = Number(surface.palettedClipMap);
		data[offset + 15] = surface.luminosity;
		data[offset + 16] = surface.alphaTest;
	}
	return data;
}
