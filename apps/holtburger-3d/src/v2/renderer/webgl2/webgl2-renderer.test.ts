import { describe, expect, it } from "vitest";
import {
	MAX_TERRAIN_COLOR_PAGES_PER_DRAW,
	MAX_TERRAIN_MASK_PAGES_PER_DRAW,
} from "../types";
import { TERRAIN_FRAGMENT_SHADER } from "./webgl2-renderer";

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
