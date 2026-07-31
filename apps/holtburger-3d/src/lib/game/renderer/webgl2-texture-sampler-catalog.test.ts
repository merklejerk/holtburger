import { describe, expect, it } from "vitest";
import { TextureWrapMode } from "../textures/types";
import { createTextureFilteringCapabilities } from "./texture-filtering-policy";
import { resolveTextureSamplerDescription } from "./webgl2-texture-sampler-catalog";

describe("resolveTextureSamplerDescription", () => {
	it("keeps exact data nearest under anisotropic policy", () => {
		expect(
			resolveTextureSamplerDescription(
				{
					mipLevels: 12,
					policy: "anisotropic-8x",
					samplingClass: "exact",
					wrap: TextureWrapMode.Clamp,
				},
				createTextureFilteringCapabilities(16),
			),
		).toEqual({
			anisotropy: 1,
			magnification: "nearest",
			minification: "nearest",
			wrap: TextureWrapMode.Clamp,
		});
	});

	it("selects level-zero anisotropy and clamps it to device capability", () => {
		expect(
			resolveTextureSamplerDescription(
				{
					mipLevels: 1,
					policy: "anisotropic-8x",
					samplingClass: "filterable",
					wrap: TextureWrapMode.Clamp,
				},
				createTextureFilteringCapabilities(4),
			),
		).toEqual({
			anisotropy: 4,
			magnification: "linear",
			minification: "linear",
			wrap: TextureWrapMode.Clamp,
		});
	});

	it("selects trilinear minification only for mip-complete resources", () => {
		expect(
			resolveTextureSamplerDescription(
				{
					mipLevels: 12,
					policy: "anisotropic-8x",
					samplingClass: "filterable",
					wrap: TextureWrapMode.Repeat,
				},
				createTextureFilteringCapabilities(8),
			),
		).toEqual({
			anisotropy: 8,
			magnification: "linear",
			minification: "linear-mipmap-linear",
			wrap: TextureWrapMode.Repeat,
		});
	});

	it("keeps nearest independent from mip availability", () => {
		expect(
			resolveTextureSamplerDescription(
				{
					mipLevels: 12,
					policy: "nearest",
					samplingClass: "filterable",
					wrap: TextureWrapMode.Repeat,
				},
				createTextureFilteringCapabilities(8),
			),
		).toEqual({
			anisotropy: 1,
			magnification: "nearest",
			minification: "nearest",
			wrap: TextureWrapMode.Repeat,
		});
	});

	it("rejects invalid resource completeness facts", () => {
		expect(() =>
			resolveTextureSamplerDescription(
				{
					mipLevels: 0,
					policy: "linear",
					samplingClass: "filterable",
					wrap: TextureWrapMode.Clamp,
				},
				createTextureFilteringCapabilities(8),
			),
		).toThrow("Texture sampler mip level count must be a positive integer");
	});
});
