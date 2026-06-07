import { describe, expect, it } from "vitest";

import { DIRECT_CLIP_MAP_ALPHA_TEST } from "./material-behavior";
import {
	parseStaticMaterialFamilyKey,
	resolveStaticMaterialFamilyAlphaTest,
} from "./static-material-artifacts";

describe("static material artifacts", () => {
	it("derives texture-page alpha-test from serialized static material family policy", () => {
		const cutoutFamily = parseStaticMaterialFamilyKey(
			"static:textured-opaque:alpha=cutout",
		);
		const opaqueFamily = parseStaticMaterialFamilyKey(
			"static:textured-opaque:alpha=opaque",
		);
		const indexedFamily = parseStaticMaterialFamilyKey(
			"static:indexed-paletted:alpha=opaque",
		);
		const indexedCutoutFamily = parseStaticMaterialFamilyKey(
			"static:indexed-paletted:alpha=cutout",
		);

		expect(cutoutFamily).not.toBeNull();
		expect(opaqueFamily).not.toBeNull();
		expect(indexedFamily).not.toBeNull();
		expect(indexedCutoutFamily).toMatchObject({
			kind: "indexed-paletted",
			alphaPolicy: "cutout",
		});
		expect(resolveStaticMaterialFamilyAlphaTest(cutoutFamily!)).toBe(
			DIRECT_CLIP_MAP_ALPHA_TEST,
		);
		expect(resolveStaticMaterialFamilyAlphaTest(opaqueFamily!)).toBe(0);
		expect(resolveStaticMaterialFamilyAlphaTest(indexedFamily!)).toBe(0);
	});
});
