import { describe, expect, it } from "vitest";
import type { MaterialTextureDataUseIdentity } from "../contracts";
import {
	createStaticMaterialTextureSamplingPolicy,
	createStaticMaterialTextureUseId,
} from "./static-material-texture-policy";

describe("V2 static material texture policy", () => {
	it("uses primary wrap mode for base and index texture data", () => {
		expect(
			createStaticMaterialTextureSamplingPolicy({
				dataUse: createPreparedTextureUse("rgba-color"),
				wrapMode: "repeat",
			}),
		).toEqual({ wrapS: "repeat", wrapT: "repeat" });
		expect(
			createStaticMaterialTextureSamplingPolicy({
				dataUse: createPreparedTextureUse("index16"),
				wrapMode: "clamp",
			}),
		).toEqual({ wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" });
	});

	it("keeps detail repeat while palette, mask, and raw data stay clamped", () => {
		expect(
			createStaticMaterialTextureSamplingPolicy({
				dataUse: createPreparedTextureUse("rgba-detail"),
				wrapMode: "clamp",
			}),
		).toEqual({ wrapS: "repeat", wrapT: "repeat" });
		expect(
			createStaticMaterialTextureSamplingPolicy({
				dataUse: createPaletteTextureUse(),
				wrapMode: "repeat",
			}),
		).toEqual({ wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" });
		expect(
			createStaticMaterialTextureSamplingPolicy({
				dataUse: createPreparedTextureUse("rgba-mask"),
				wrapMode: "repeat",
			}),
		).toEqual({ wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" });
		expect(
			createStaticMaterialTextureSamplingPolicy({
				dataUse: createPreparedTextureUse("rgba-raw"),
				wrapMode: "repeat",
			}),
		).toEqual({ wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" });
	});

	it("includes sampling policy in static material texture-use identity", () => {
		const dataUse = createPreparedTextureUse("rgba-color");

		expect(
			createStaticMaterialTextureUseId({
				dataUse,
				textureUseNamespace: "static-object-texture",
				workId: "work-a",
				wrapMode: "clamp",
			}),
		).toBe(
			"work-a:static-object-texture:prepared-render-surface-texture-use:06000010:rgba-color:sampling:wrap=clamp-to-edge,clamp-to-edge",
		);
		expect(
			createStaticMaterialTextureUseId({
				dataUse,
				textureUseNamespace: "static-object-texture",
				workId: "work-a",
				wrapMode: "repeat",
			}),
		).toBe(
			"work-a:static-object-texture:prepared-render-surface-texture-use:06000010:rgba-color:sampling:wrap=repeat,repeat",
		);
	});
});

function createPreparedTextureUse(
	usage: Extract<
		MaterialTextureDataUseIdentity,
		{ readonly kind: "prepared-render-surface-texture-use" }
	>["usage"],
): MaterialTextureDataUseIdentity {
	return {
		kind: "prepared-render-surface-texture-use",
		renderSurface: {
			kind: "render-surface",
			renderSurfaceId: 0x06000010,
		},
		usage,
	};
}

function createPaletteTextureUse(): MaterialTextureDataUseIdentity {
	return {
		firstIndex: 0,
		indexCount: 256,
		kind: "palette-texture-use",
		palette: {
			kind: "palette",
			paletteId: 0x0400007e,
		},
		subPalettes: [],
		usage: "palette-rgba",
	};
}
