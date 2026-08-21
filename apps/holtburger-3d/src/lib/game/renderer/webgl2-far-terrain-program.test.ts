import { describe, expect, it } from "vitest";
import { TERRAIN_TYPE_COUNT } from "../terrain/pcode";
import {
	WEBGL2_FAR_TERRAIN_FRAGMENT_SHADER,
	WEBGL2_FAR_TERRAIN_VERTEX_SHADER,
} from "./webgl2-far-terrain-program";

describe("far-terrain shader contract", () => {
	it("uses integer terrain codes and a vertex palette with no sampler or UV dependency", () => {
		const source = `${WEBGL2_FAR_TERRAIN_VERTEX_SHADER}\n${WEBGL2_FAR_TERRAIN_FRAGMENT_SHADER}`;

		expect(WEBGL2_FAR_TERRAIN_VERTEX_SHADER).toContain(
			"layout(location = 3) in uint aTerrainColorCode",
		);
		expect(WEBGL2_FAR_TERRAIN_VERTEX_SHADER).toContain(
			"uTerrainPalette[int(aTerrainColorCode)]",
		);
		expect(WEBGL2_FAR_TERRAIN_VERTEX_SHADER).toContain(
			`uTerrainPalette[${TERRAIN_TYPE_COUNT}]`,
		);
		expect(source).not.toMatch(/\bsampler(?:2D|2DArray|Cube)\b/);
		expect(source).not.toContain("aTextureCoordinate");
		expect(source).not.toMatch(/\btexture(?:Lod)?\s*\(/);
	});
});
