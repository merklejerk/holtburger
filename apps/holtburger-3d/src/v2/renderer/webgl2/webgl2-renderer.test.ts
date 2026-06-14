import { describe, expect, it } from "vitest";
import {
	MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW,
	MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
	MAX_TERRAIN_COLOR_PAGES_PER_DRAW,
	MAX_TERRAIN_MASK_PAGES_PER_DRAW,
} from "../types";
import {
	compareStaticObjectTransparentDrawOrder,
	DEBUG_OVERLAY_FRAGMENT_SHADER,
	DEBUG_OVERLAY_VERTEX_SHADER,
	resolveStaticObjectBlendFactor,
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
			"uniform sampler2D uStaticIndexTexture0;",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).not.toContain("usampler2D");
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"vec4 sampleIndexedPaletteLinear(vec2 uv)",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"fetchStaticIndexPage(uMaterialIndexTexturePages[slot], atlasCoord) * 255.0",
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
			`uniform int uMaterialIndexedTextureFormats[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];`,
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"if (uMaterialIndexedTextureFormats[slot] == 1)",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"floor(packed.r + 0.5) + floor(packed.g + 0.5) * 256.0",
		);
	});
});

describe("V2 WebGL2 static object role-page shader contract", () => {
	it("uses bounded explicit static base-color page samplers and material page selectors", () => {
		for (
			let slot = 0;
			slot < MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW;
			slot += 1
		) {
			expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
				`uniform sampler2D uStaticBaseColorTexture${slot};`,
			);
		}

		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			`uniform vec4 uMaterialBaseColorRects[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];`,
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			`uniform int uMaterialBaseColorPages[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];`,
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"sampleStaticBaseColorPage(int page, vec4 rect, vec2 localUv)",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).not.toContain(
			"uniform sampler2D uTexture;",
		);
	});
});

describe("V2 WebGL2 static object detail shader contract", () => {
	it("composes detail overlays as a second repeat-sampled material role", () => {
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"uniform sampler2D uStaticDetailTexture0;",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"vec4 sampleDetailOverlay(vec2 uv)",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"vec2 localUv = fract(uv * uMaterialDetailTilings[slot]);",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"rgb = clamp(rgb * (detailColor.rgb + (1.0 - detailAlpha)), vec3(0.0), vec3(1.0));",
		);
	});
});

describe("V2 WebGL2 static object transparent pass helpers", () => {
	it("sorts transparent object/part resources back-to-front with a stable id tie-break", () => {
		const cameraPosition = [0, 0, 0] as const;
		const resources = [
			{ drawUnitId: "near", sortCenter: [0, 0, 4] as const },
			{ drawUnitId: "far-b", sortCenter: [0, 0, 12] as const },
			{ drawUnitId: "far-a", sortCenter: [0, 0, -12] as const },
			{ drawUnitId: "middle", sortCenter: [0, 0, 8] as const },
		];

		expect(
			resources
				.toSorted((left, right) =>
					compareStaticObjectTransparentDrawOrder(left, right, cameraPosition),
				)
				.map((resource) => resource.drawUnitId),
		).toEqual(["far-a", "far-b", "middle", "near"]);
	});

	it("maps typed static blend factors to WebGL constants", () => {
		const gl = {
			ONE: 1,
			ONE_MINUS_SRC_ALPHA: 771,
			SRC_ALPHA: 770,
		} as WebGL2RenderingContext;

		expect(resolveStaticObjectBlendFactor(gl, "one")).toBe(gl.ONE);
		expect(resolveStaticObjectBlendFactor(gl, "src-alpha")).toBe(gl.SRC_ALPHA);
		expect(resolveStaticObjectBlendFactor(gl, "one-minus-src-alpha")).toBe(
			gl.ONE_MINUS_SRC_ALPHA,
		);
	});
});

describe("V2 WebGL2 debug overlay shader contract", () => {
	it("draws in-scene line primitives through the scene camera matrix", () => {
		expect(DEBUG_OVERLAY_VERTEX_SHADER).toContain(
			"uniform mat4 uModelViewProjection;",
		);
		expect(DEBUG_OVERLAY_VERTEX_SHADER).toContain("layout(location = 0) in vec3 position;");
		expect(DEBUG_OVERLAY_VERTEX_SHADER).toContain("layout(location = 1) in vec4 color;");
		expect(DEBUG_OVERLAY_FRAGMENT_SHADER).toContain(
			"fragColor = vec4(vec3(1.0), vColor.a);",
		);
	});
});
