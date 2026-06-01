import { describe, expect, it } from "vitest";

import {
	collectDirectDrawTexturePageBindings,
	type TexturePageBinding,
} from "./texture-page-binding";
import type { Webgl2Texture2DResource } from "./webgl2-gl";

describe("collectDirectDrawTexturePageBindings", () => {
	it("records detail overlays as RGBA color texture pages", () => {
		const texture = createTexture(8, 8);

		const bindings = collectDirectDrawTexturePageBindings({
			texture: null,
			textureSamplingPolicy: null,
			atlasEligibility: null,
			detailOverlay: {
				key: "detail",
				texture,
				tiling: 2,
				blendMode: "dst-color",
				atlasEntry: null,
			},
			indexedMaterial: null,
			terrainBlend: null,
		});

		expect(bindings).toMatchObject([
			{
				pageKind: "single-entry",
				usageBucket: "detail",
				sampleClass: "rgba-color",
				width: 8,
				height: 8,
				wrapS: "repeat",
				wrapT: "repeat",
				sampling: {
					colorSpace: "linear",
					lookup: "color-filtered",
				},
			},
		] satisfies Partial<TexturePageBinding>[]);
	});

	it("records indexed texels and palettes as exact data pages", () => {
		const bindings = collectDirectDrawTexturePageBindings({
			texture: null,
			textureSamplingPolicy: null,
			atlasEligibility: null,
			detailOverlay: null,
			indexedMaterial: {
				key: "indexed",
				indexFormat: "p8",
				indexTextureKey: "index",
				paletteTextureKey: "palette",
				indexTexture: createTexture(16, 16),
				paletteTexture: createTexture(256, 1),
				width: 16,
				height: 16,
				paletteColorCount: 256,
				wrapS: "repeat",
				wrapT: "clamp",
				clipThreshold: 8,
			},
			terrainBlend: null,
		});

		expect(bindings.map((binding) => binding.usageBucket)).toEqual([
			"indexed-texels",
			"palette-lookup",
		]);
		expect(bindings[0]).toMatchObject({
			sampleClass: "indexed-data",
			wrapS: "repeat",
			wrapT: "clamp",
			sampling: {
				minFilter: "nearest",
				magFilter: "nearest",
				mip: "none",
				colorSpace: "data",
				lookup: "exact",
			},
		} satisfies Partial<TexturePageBinding>);
		expect(bindings[1]).toMatchObject({
			sampleClass: "palette-data",
			wrapS: "clamp",
			wrapT: "clamp",
			sampling: {
				minFilter: "nearest",
				magFilter: "nearest",
				mip: "none",
				colorSpace: "data",
				lookup: "exact",
			},
		} satisfies Partial<TexturePageBinding>);
	});

	it("records terrain color and mask inputs as separate page buckets", () => {
		const bindings = collectDirectDrawTexturePageBindings({
			texture: null,
			textureSamplingPolicy: null,
			atlasEligibility: null,
			detailOverlay: null,
			indexedMaterial: null,
			terrainBlend: {
				plan: {} as never,
				base: createTerrainBinding("base", "repeat"),
				overlays: [
					{
						terrain: createTerrainBinding("overlay", "repeat"),
						alpha: createTerrainBinding("overlay-alpha", "clamp"),
						rotation: 0,
					},
				],
				roads: [
					{
						road: createTerrainBinding("road", "repeat"),
						alpha: createTerrainBinding("road-alpha", "clamp"),
						rotation: 0,
					},
				],
			},
		});

		expect(bindings.map((binding) => binding.usageBucket)).toEqual([
			"terrain",
			"terrain",
			"alpha-control",
			"road",
			"alpha-control",
		]);
		expect(
			bindings.filter((binding) => binding.usageBucket === "alpha-control"),
		).toEqual([
			expect.objectContaining({
				sampleClass: "control-data",
				sampling: expect.objectContaining({
					colorSpace: "none",
					lookup: "control-filtered",
				}),
			}),
			expect.objectContaining({
				sampleClass: "control-data",
				sampling: expect.objectContaining({
					colorSpace: "none",
					lookup: "control-filtered",
				}),
			}),
		]);
	});
});

function createTexture(width: number, height: number): Webgl2Texture2DResource {
	return {
		texture: {} as WebGLTexture,
		width,
		height,
		dispose() {
			return;
		},
	};
}

function createTerrainBinding(key: string, wrap: "clamp" | "repeat") {
	return {
		key,
		texture: createTexture(4, 4),
		tiling: 1,
		wrapS: wrap,
		wrapT: wrap,
	};
}
