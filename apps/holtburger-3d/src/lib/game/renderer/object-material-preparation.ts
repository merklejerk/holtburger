import type { ObjectMaterialBinding } from "../commit/artifacts";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import { TextureWrapMode } from "../textures/types";
import type { TextureSamplingClass } from "./webgl2-texture-sampler-catalog";
import {
	sourceOpacity,
	type PreparedObjectAtlasBinding,
	type PreparedObjectMaterial,
	type PreparedObjectSurface,
} from "./object-rendering-policy";

/** Resolve source policy once; the injected atlas resolver owns placement and filtering. */
export function prepareObjectSurface<TTexture, TSampler>(
	material: Omit<ObjectMaterialBinding, "polygon">,
	ordering: ObjectMaterialOrdering,
	resolveAtlas: (
		key: NonNullable<ObjectMaterialBinding["textures"]["base"]>,
		samplingClass: TextureSamplingClass,
	) => PreparedObjectAtlasBinding<TTexture, TSampler>,
): PreparedObjectSurface<TTexture, TSampler> {
	const opacity = sourceOpacity(material.source.translucency);
	// RETAIL DIVERGENCE: Authored CSurface.diffuse (e.g. 0.2734 on 0x080006E4, the celtic knot
	// entrance plaque on building 0x01000F69) is a legacy of the 1999 software rasterizer.
	// Retail's Direct3D pipeline (acclient.c:437169 SetCurrentMaterial) renders static objects with
	// default white material diffuse (1.0, 1.0, 1.0, 1.0) and never modulates textured or solid
	// surfaces by CSurface.diffuse. Multiplying by it artificially darkens authored surfaces.
	let prepared: PreparedObjectMaterial<TTexture, TSampler>;
	if (material.source.kind === "solid-color") {
		const [red, green, blue, alpha] = material.source.color;
		prepared = {
			color: [red, green, blue, alpha * opacity],
			kind: "solid-color",
		};
	} else {
		const base = material.textures.base;
		if (base === null)
			throw new Error(
				`Textured material ${material.source.id} has no base texture.`,
			);
		const baseBinding = resolveAtlas(
			base,
			material.source.textureEncoding === "direct-color"
				? "filterable"
				: "exact",
		);
		const color = [1, 1, 1, opacity] as const;
		if (material.source.textureEncoding === "direct-color") {
			prepared = { base: baseBinding, color, kind: "direct-color" };
		} else {
			const palette = material.textures.palette;
			if (palette === null)
				throw new Error(
					`Indexed material ${material.source.id} has no palette texture.`,
				);
			prepared = {
				base: baseBinding,
				color,
				kind: material.source.textureEncoding,
				palette: resolveAtlas(palette, "exact"),
			};
		}
	}
	return {
		material: prepared,
		alphaTest:
			ordering === "alpha-test" && material.source.kind === "texture"
				? 200 / 255
				: 0,
		luminosity: material.source.luminosity,
		palettedClipMap: material.palettedClipMap,
		wrapRepeat: material.sampler.wrap === TextureWrapMode.Repeat,
	};
}
