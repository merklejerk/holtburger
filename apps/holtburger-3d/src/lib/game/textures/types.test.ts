import { describe, expect, it } from "vitest";
import {
	completeTextureMipLevelCount,
	gutterIsolatedMaximumMipLevel,
	packedObjectTexturePreparation,
	textureMipChainByteLength,
	texturePurposeMipLevelCount,
	texturePurposePolicy,
	TexturePixelFormat,
	TexturePurpose,
} from "./types";

describe("texture mip facts", () => {
	it("counts a complete non-square mip chain", () => {
		expect(completeTextureMipLevelCount(16, 8)).toBe(5);
		expect(
			textureMipChainByteLength({
				format: TexturePixelFormat.RGBA8,
				height: 8,
				mipLevels: 5,
				width: 16,
			}),
		).toBe((16 * 8 + 8 * 4 + 4 * 2 + 2 + 1) * 4);
	});

	it("limits packed direct color to the mip range isolated by its gutter", () => {
		expect(
			texturePurposePolicy(TexturePurpose.ObjectDirectColor).mipPolicy,
		).toEqual({
			kind: "maximum-level",
			maximumLevel: 3,
		});
		expect(
			texturePurposeMipLevelCount(TexturePurpose.ObjectDirectColor, 2048, 2048),
		).toBe(4);
		for (const purpose of [
			TexturePurpose.ObjectIndex8,
			TexturePurpose.ObjectIndex16,
			TexturePurpose.ObjectPalette,
		]) {
			expect(texturePurposeMipLevelCount(purpose, 2048, 2048)).toBe(1);
		}
	});

	it("derives the maximum isolated mip level from gutter width", () => {
		expect(gutterIsolatedMaximumMipLevel(0)).toBe(0);
		expect(gutterIsolatedMaximumMipLevel(4)).toBe(2);
		expect(gutterIsolatedMaximumMipLevel(8)).toBe(3);
		expect(gutterIsolatedMaximumMipLevel(16)).toBe(4);
	});

	it("reserves an eight-pixel gutter only for filterable packed direct color", () => {
		expect(
			packedObjectTexturePreparation(TexturePurpose.ObjectDirectColor)
				.gutterPixels,
		).toBe(8);
		for (const purpose of [
			TexturePurpose.ObjectIndex8,
			TexturePurpose.ObjectIndex16,
			TexturePurpose.ObjectPalette,
		]) {
			expect(packedObjectTexturePreparation(purpose).gutterPixels).toBe(0);
		}
	});

	it("rejects incomplete dimension and mip facts", () => {
		expect(() => completeTextureMipLevelCount(0, 8)).toThrow(
			"Texture dimensions must be positive integers",
		);
		expect(() =>
			textureMipChainByteLength({
				format: TexturePixelFormat.RGBA8,
				height: 8,
				mipLevels: 5,
				width: 8,
			}),
		).toThrow("Texture mip level count must be between 1 and 4");
	});
});
