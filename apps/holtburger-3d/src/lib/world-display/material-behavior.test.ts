import { Color } from "three";
import { describe, expect, it } from "vitest";

import type { PreparedMaterialRecipePayload } from "../assets/types";
import {
	DIRECT_CLIP_MAP_ALPHA_TEST,
	INDEXED_CLIP_MAP_ALPHA_TEST,
	deriveLegacyMaterialBehavior,
} from "./material-behavior";

describe("legacy material behavior", () => {
	it("maps client translucency, diffuse, and luminosity scalars", () => {
		const behavior = deriveLegacyMaterialBehavior({
			recipe: createMaterialRecipe({
				surfaceType: 0x20 | 0x40,
				translucency: 0.25,
				diffuse: 0.5,
				luminosity: 0.75,
			}),
		});

		expect(behavior.opacity).toBe(0.75);
		expect(behavior.transparent).toBe(true);
		expect(behavior.color).toEqual(new Color(0.5, 0.5, 0.5));
		expect(behavior.emissiveIntensity).toBe(0.75);
	});

	it("uses retail DDS alpha test rather than transparent sorting for direct clipmaps", () => {
		const behavior = deriveLegacyMaterialBehavior({
			recipe: createMaterialRecipe({ surfaceType: 0x4 }),
			hasSourceAlpha: true,
		});

		expect(behavior.transparent).toBe(false);
		expect(behavior.alphaTest).toBe(DIRECT_CLIP_MAP_ALPHA_TEST);
	});

	it("keeps indexed clipmap index discard and adds retail 256-color alpha test", () => {
		const behavior = deriveLegacyMaterialBehavior({
			recipe: createMaterialRecipe({ surfaceType: 0x4 }),
			usesIndexedClipDiscard: true,
		});

		expect(behavior.transparent).toBe(false);
		expect(behavior.alphaTest).toBe(INDEXED_CLIP_MAP_ALPHA_TEST);
	});

	it("reports unsupported legacy surface flags without changing scalar mapping", () => {
		const behavior = deriveLegacyMaterialBehavior({
			recipe: createMaterialRecipe({ surfaceType: 0x200 | 0x10000 | 0x20000 }),
		});

		expect(behavior.unsupportedSurfaceFlags).toEqual([
			"InvAlpha",
			"Additive",
			"Detail",
		]);
	});
});

function createMaterialRecipe(
	options: Partial<PreparedMaterialRecipePayload> & { surfaceType: number },
): PreparedMaterialRecipePayload {
	return {
		kind: "material-recipe",
		sourceAssetKind: "material-recipe",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "material-recipe",
			errorCode: null,
			detail: null,
		},
		surfaceId: 0x08000001,
		surfaceType: options.surfaceType,
		source: { kind: "solid-color", argb: 0xffffffff },
		translucency: options.translucency ?? 0,
		luminosity: options.luminosity ?? 0,
		diffuse: options.diffuse ?? 1,
		dependencies: {
			renderTextureAssetIds: [],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	};
}
