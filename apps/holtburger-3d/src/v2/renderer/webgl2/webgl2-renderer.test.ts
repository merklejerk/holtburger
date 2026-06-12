import { describe, expect, it } from "vitest";
import {
	MAX_TERRAIN_COLOR_PAGES_PER_DRAW,
	MAX_TERRAIN_MASK_PAGES_PER_DRAW,
} from "../types";
import {
	STATIC_OBJECT_FRAGMENT_SHADER,
	TERRAIN_FRAGMENT_SHADER,
} from "./webgl2-renderer";

describe("V2 WebGL2 terrain renderer shader contract", () => {
	it("uses bounded explicit terrain color and mask page samplers", () => {
		for (let slot = 0; slot < MAX_TERRAIN_COLOR_PAGES_PER_DRAW; slot += 1) {
			expect(TERRAIN_FRAGMENT_SHADER).toContain(
				`uniform sampler2D uColorAtlasTexture${slot};`,
			);
		}
		for (let slot = 0; slot < MAX_TERRAIN_MASK_PAGES_PER_DRAW; slot += 1) {
			expect(TERRAIN_FRAGMENT_SHADER).toContain(
				`uniform sampler2D uMaskAtlasTexture${slot};`,
			);
		}

		expect(TERRAIN_FRAGMENT_SHADER).toContain("sampleColorPage(int page");
		expect(TERRAIN_FRAGMENT_SHADER).toContain("sampleMaskPage(int page");
		expect(TERRAIN_FRAGMENT_SHADER).toContain("uLayerBaseColorPages");
		expect(TERRAIN_FRAGMENT_SHADER).toContain("uLayerOverlayColorPages");
		expect(TERRAIN_FRAGMENT_SHADER).toContain("uLayerOverlayMaskPages");
		expect(TERRAIN_FRAGMENT_SHADER).toContain("uLayerRoadColorPages");
		expect(TERRAIN_FRAGMENT_SHADER).toContain("uLayerRoadMaskPages");
		expect(TERRAIN_FRAGMENT_SHADER).not.toContain(
			"uniform sampler2D uColorAtlasTexture;",
		);
		expect(TERRAIN_FRAGMENT_SHADER).not.toContain(
			"uniform sampler2D uMaskAtlasTexture;",
		);
	});
});

describe("V2 WebGL2 static object indexed shader contract", () => {
	it("keeps index textures exact and filters after palette lookup", () => {
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"uniform sampler2D uIndexTexture;",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).not.toContain("usampler2D");
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"vec4 sampleIndexedPaletteLinear(vec2 uv)",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"texelFetch(uIndexTexture, atlasCoord, 0) * 255.0",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"paletteColor(paletteIndexAt(resolveIndexSampleCoord(baseCoord, ivec2(1, 1))))",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"return mix(top, bottom, blend.y);",
		);
	});

	it("reconstructs index16 pages from normalized RG8 low and high bytes", () => {
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"uniform int uIndexedTextureFormat;",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"floor(packed.r + 0.5) + floor(packed.g + 0.5) * 256.0",
		);
	});
});

describe("V2 WebGL2 static object detail shader contract", () => {
	it("composes detail overlays as a second repeat-sampled material role", () => {
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"uniform sampler2D uDetailTexture;",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"vec4 sampleDetailOverlay(vec2 uv)",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"vec2 localUv = fract(uv * uDetailTiling);",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"rgb *= sampleDetailOverlay(vTexCoord).rgb;",
		);
	});
});
