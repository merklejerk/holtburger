import {
	ClampToEdgeWrapping,
	DataTexture,
	LinearFilter,
	LinearMipMapLinearFilter,
	RedFormat,
	RepeatWrapping,
	SRGBColorSpace,
	UnsignedByteType,
} from "three";
import { describe, expect, it } from "vitest";

import type { PreparedRenderSurfacePayload } from "../assets/types";
import {
	applyTextureSamplingPolicy,
	createDefaultMaterialTextureSamplingPolicy,
	describeTextureSamplingPolicy,
	selectRenderSurfaceTextureSamplingPolicy,
} from "./texture-sampling-policy";

describe("texture sampling policy", () => {
	it("preserves current direct, compressed, and indexed defaults", () => {
		const policy = createDefaultMaterialTextureSamplingPolicy({
			supportsS3tc: true,
			supportsS3tcSrgb: true,
			maxAnisotropy: 8,
		});

		expect(policy.directColor).toMatchObject({
			wrapS: "clamp",
			wrapT: "clamp",
			magFilter: "linear",
			minFilter: "linear",
			mipFilter: "linear",
			colorSpace: "srgb",
			anisotropy: 4,
			generateMipmaps: true,
			flipY: false,
		});
		expect(policy.compressed).toMatchObject({
			magFilter: "linear",
			minFilter: "linear",
			mipFilter: "linear",
			colorSpace: "srgb",
			anisotropy: 4,
			generateMipmaps: false,
			flipY: false,
		});
		expect(policy.indexed).toMatchObject({
			magFilter: "nearest",
			minFilter: "nearest",
			mipFilter: "none",
			colorSpace: "none",
			anisotropy: 1,
			generateMipmaps: false,
			flipY: false,
		});
	});

	it("degrades anisotropy to renderer capability", () => {
		expect(
			createDefaultMaterialTextureSamplingPolicy({
				supportsS3tc: false,
				supportsS3tcSrgb: false,
				maxAnisotropy: 2,
			}).directColor.anisotropy,
		).toBe(2);
		expect(
			createDefaultMaterialTextureSamplingPolicy({
				supportsS3tc: false,
				supportsS3tcSrgb: false,
				maxAnisotropy: 0,
			}).directColor.anisotropy,
		).toBe(1);
	});

	it("caps color texture filtering by browser mode", () => {
		const nearest = createDefaultMaterialTextureSamplingPolicy(
			{
				supportsS3tc: true,
				supportsS3tcSrgb: true,
				maxAnisotropy: 8,
			},
			"nearest",
		);
		const linear = createDefaultMaterialTextureSamplingPolicy(
			{
				supportsS3tc: true,
				supportsS3tcSrgb: true,
				maxAnisotropy: 8,
			},
			"linear",
		);

		expect(nearest.directColor).toMatchObject({
			magFilter: "nearest",
			minFilter: "nearest",
			mipFilter: "none",
			anisotropy: 1,
			generateMipmaps: false,
		});
		expect(linear.directColor).toMatchObject({
			magFilter: "linear",
			minFilter: "linear",
			mipFilter: "linear",
			anisotropy: 1,
			generateMipmaps: true,
		});
		expect(linear.compressed).toMatchObject({
			magFilter: "linear",
			minFilter: "linear",
			mipFilter: "linear",
			anisotropy: 1,
		});
		expect(nearest.indexed).toMatchObject({
			magFilter: "nearest",
			minFilter: "nearest",
			mipFilter: "none",
			anisotropy: 1,
		});
	});

	it("uses non-color compressed textures when S3TC sRGB upload is unavailable", () => {
		expect(
			createDefaultMaterialTextureSamplingPolicy({
				supportsS3tc: true,
				supportsS3tcSrgb: false,
				maxAnisotropy: 1,
			}).compressed.colorSpace,
		).toBe("none");
	});

	it("selects the policy bucket from render-surface format", () => {
		const policy = createDefaultMaterialTextureSamplingPolicy();

		expect(
			selectRenderSurfaceTextureSamplingPolicy(
				createRenderSurface({ formatRaw: 0x15 }),
				policy,
			),
		).toBe(policy.directColor);
		expect(
			selectRenderSurfaceTextureSamplingPolicy(
				createRenderSurface({ formatRaw: 0x3154_5844 }),
				policy,
			),
		).toBe(policy.compressed);
		expect(
			selectRenderSurfaceTextureSamplingPolicy(
				createRenderSurface({ formatRaw: 0x29 }),
				policy,
			),
		).toBe(policy.indexed);
	});

	it("applies wrap, filter, color-space, mipmap, and flipY settings", () => {
		const texture = new DataTexture(
			new Uint8Array([1]),
			1,
			1,
			RedFormat,
			UnsignedByteType,
		);

		applyTextureSamplingPolicy(texture, {
			wrapS: "repeat",
			wrapT: "clamp",
			magFilter: "linear",
			minFilter: "linear",
			mipFilter: "linear",
			colorSpace: "srgb",
			anisotropy: 4,
			generateMipmaps: true,
			flipY: true,
		});

		expect(texture.wrapS).toBe(RepeatWrapping);
		expect(texture.wrapT).toBe(ClampToEdgeWrapping);
		expect(texture.magFilter).toBe(LinearFilter);
		expect(texture.minFilter).toBe(LinearMipMapLinearFilter);
		expect(texture.colorSpace).toBe(SRGBColorSpace);
		expect(texture.anisotropy).toBe(4);
		expect(texture.generateMipmaps).toBe(true);
		expect(texture.flipY).toBe(true);
	});

	it("describes stable policy identities for cache keys", () => {
		expect(
			describeTextureSamplingPolicy({
				wrapS: "clamp",
				wrapT: "repeat",
				magFilter: "linear",
				minFilter: "nearest",
				mipFilter: "none",
				colorSpace: "none",
				anisotropy: 1,
				generateMipmaps: false,
				flipY: false,
			}),
		).toBe(
			"wrap=clamp/repeat;filter=linear/nearest/none;color=none;aniso=1;mips=off;flipY=off",
		);
	});
});

function createRenderSurface(options: {
	formatRaw: number;
}): PreparedRenderSurfacePayload {
	return {
		kind: "render-surface" as const,
		sourceAssetKind: "render-surface",
		residencyKind: "unknown" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "render-surface",
			errorCode: null,
			detail: null,
		},
		renderSurfaceId: 0x06000001,
		format: "Synthetic",
		formatRaw: options.formatRaw,
		width: 1,
		height: 1,
		defaultPaletteId: null,
		sourceByteLength: 1,
		sourceBytes: new Uint8Array([0]),
	};
}
