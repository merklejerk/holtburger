import type { DecodedStaticPresentation } from "../../lib/assets/decode-static-source-record";
import type { TexturePixelSource } from "../../lib/assets/texture-pixel-source";
import type {
	TexturePreparationServiceRequest,
	TexturePreparationServiceResponse,
} from "../../lib/game/textures/texture-preparer";
import {
	TexturePixelFormat,
	TexturePurpose,
} from "../../lib/game/textures/types";
import type { ResolvedMaterial } from "../../lib/game/resolution/presentation";

/** Reserved synthetic appearance selectors; real setup appearance requests never use these. */
export const CUTOUT_PALETTE = 3;
export const CUTOUT_REFERENCE_PALETTE = 4;
const CUTOUT_TEXTURE = "0x05fffffe";
/** Texture preparation qualifies DAT identifiers with their archive resource family. */
const CUTOUT_SOURCE = `surface-texture/${CUTOUT_TEXTURE}`;

/** Identical geometry and color, with either a solid reference or a direct-color clip map. */
export function createCutoutVisual(
	base: DecodedStaticPresentation,
	reference: boolean,
): DecodedStaticPresentation {
	const common = { diffuseScale: 0, luminosity: 1, translucency: 0 };
	const material: ResolvedMaterial = reference
		? {
				...common,
				id: "material:synthetic-cutout-reference",
				kind: "solid-color",
				color: [0.2, 0.4, 0.6, 1],
				rawSurfaceFlags: 0,
			}
		: {
				...common,
				id: "material:synthetic-cutout",
				kind: "texture",
				colorTextureId: CUTOUT_TEXTURE,
				renderSurfaceId: CUTOUT_TEXTURE,
				paletteTextureId: null,
				paletteComposite: null,
				textureEncoding: "direct-color",
				rawSurfaceFlags: 4,
			};
	return {
		...base,
		presentation: {
			...base.presentation,
			appearanceKey: `appearance:synthetic-cutout:${reference}`,
			parts: base.presentation.parts.map((part) => ({
				...part,
				materials: [material],
			})),
		},
	};
}

/** Supply one synthetic atlas source through the same worker preparation as real textures. */
export class SyntheticCutoutTextureSource implements TexturePixelSource {
	constructor(private readonly delegate: TexturePixelSource) {}
	loadTexturePixels(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
		if (request.sourceAssetId !== CUTOUT_SOURCE)
			return this.delegate.loadTexturePixels(request);
		if (
			request.kind !== "prepared-object-texture" ||
			request.purpose !== TexturePurpose.ObjectDirectColor
		)
			throw new Error(
				"Synthetic cutout requires a direct-color object texture request.",
			);
		return Promise.resolve({
			kind: request.kind,
			purpose: request.purpose,
			surface: {
				sourceAssetId: CUTOUT_SOURCE,
				width: 2,
				height: 2,
				format: TexturePixelFormat.RGBA8,
				pixels: new Uint8Array([
					51, 102, 153, 255, 51, 102, 153, 0, 51, 102, 153, 0, 51, 102, 153,
					255,
				]),
			},
		});
	}
}
