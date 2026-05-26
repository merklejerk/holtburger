import {
	Color,
	OneFactor,
	OneMinusSrcAlphaFactor,
	SrcAlphaFactor,
} from "three";
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
		expect(behavior.blend.mode).toBe("translucent");
		expect(behavior.blend.depthWrite).toBe(false);
	});

	it("uses retail DDS alpha test and clipmap blending for direct clipmaps", () => {
		const behavior = deriveLegacyMaterialBehavior({
			recipe: createMaterialRecipe({ surfaceType: 0x4 }),
			hasSourceAlpha: true,
		});

		expect(behavior.transparent).toBe(true);
		expect(behavior.alphaTest).toBe(DIRECT_CLIP_MAP_ALPHA_TEST);
		expect(behavior.blend).toMatchObject({
			mode: "clipmap",
			enabled: true,
			srcFactor: OneFactor,
			dstFactor: OneMinusSrcAlphaFactor,
			depthWrite: true,
		});
	});

	it("keeps indexed clipmap index discard and adds retail 256-color alpha test", () => {
		const behavior = deriveLegacyMaterialBehavior({
			recipe: createMaterialRecipe({ surfaceType: 0x4 }),
			usesIndexedClipDiscard: true,
		});

		expect(behavior.transparent).toBe(true);
		expect(behavior.alphaTest).toBe(INDEXED_CLIP_MAP_ALPHA_TEST);
	});

	it("lets translucent clipmaps use alpha blending without clipmap alpha test", () => {
		const behavior = deriveLegacyMaterialBehavior({
			recipe: createMaterialRecipe({ surfaceType: 0x4 | 0x10 }),
			hasSourceAlpha: true,
		});

		expect(behavior.alphaTest).toBe(0);
		expect(behavior.blend).toMatchObject({
			mode: "translucent",
			srcFactor: SrcAlphaFactor,
			dstFactor: OneMinusSrcAlphaFactor,
			depthWrite: false,
		});
	});


	it("maps retail alpha blend factors for legacy surface flags", () => {
		expect(
			deriveLegacyMaterialBehavior({
				recipe: createMaterialRecipe({ surfaceType: 0x100 }),
			}).blend,
		).toMatchObject({
			mode: "alpha",
			srcFactor: SrcAlphaFactor,
			dstFactor: OneMinusSrcAlphaFactor,
			depthWrite: false,
		});
		expect(
			deriveLegacyMaterialBehavior({
				recipe: createMaterialRecipe({ surfaceType: 0x100 | 0x10000 }),
			}).blend,
		).toMatchObject({
			mode: "alpha-additive",
			srcFactor: SrcAlphaFactor,
			dstFactor: OneFactor,
			depthWrite: false,
		});
		expect(
			deriveLegacyMaterialBehavior({
				recipe: createMaterialRecipe({ surfaceType: 0x200 }),
			}).blend,
		).toMatchObject({
			mode: "inverse-alpha",
			srcFactor: OneMinusSrcAlphaFactor,
			dstFactor: SrcAlphaFactor,
			depthWrite: false,
		});
		expect(
			deriveLegacyMaterialBehavior({
				recipe: createMaterialRecipe({ surfaceType: 0x200 | 0x10000 }),
			}).blend,
		).toMatchObject({
			mode: "inverse-alpha-additive",
			srcFactor: OneMinusSrcAlphaFactor,
			dstFactor: OneFactor,
			depthWrite: false,
		});
		expect(
			deriveLegacyMaterialBehavior({
				recipe: createMaterialRecipe({ surfaceType: 0x10000 }),
			}).blend,
		).toMatchObject({
			mode: "additive",
			srcFactor: OneFactor,
			dstFactor: OneFactor,
			depthWrite: false,
		});
	});

	it("reports only legacy surface flags that still lack renderer support", () => {
		const behavior = deriveLegacyMaterialBehavior({
			recipe: createMaterialRecipe({ surfaceType: 0x200 | 0x10000 | 0x20000 }),
		});

		expect(behavior.unsupportedSurfaceFlags).toEqual(["Detail"]);
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
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
		},
	};
}
