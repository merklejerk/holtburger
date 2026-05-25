import {
	ClampToEdgeWrapping,
	DataTexture,
	NearestFilter,
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
		});

		expect(policy.directColor).toMatchObject({
			wrapS: "clamp",
			wrapT: "clamp",
			magFilter: "nearest",
			minFilter: "nearest",
			colorSpace: "srgb",
			generateMipmaps: false,
			flipY: false,
		});
		expect(policy.compressed).toMatchObject({
			magFilter: "linear",
			minFilter: "linear",
			colorSpace: "srgb",
			generateMipmaps: false,
			flipY: false,
		});
		expect(policy.indexed).toMatchObject({
			magFilter: "nearest",
			minFilter: "nearest",
			colorSpace: "none",
			generateMipmaps: false,
			flipY: false,
		});
	});

	it("uses non-color compressed textures when S3TC sRGB upload is unavailable", () => {
		expect(
			createDefaultMaterialTextureSamplingPolicy({
				supportsS3tc: true,
				supportsS3tcSrgb: false,
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
			magFilter: "nearest",
			minFilter: "nearest",
			colorSpace: "srgb",
			generateMipmaps: true,
			flipY: true,
		});

		expect(texture.wrapS).toBe(RepeatWrapping);
		expect(texture.wrapT).toBe(ClampToEdgeWrapping);
		expect(texture.magFilter).toBe(NearestFilter);
		expect(texture.minFilter).toBe(NearestFilter);
		expect(texture.colorSpace).toBe(SRGBColorSpace);
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
				colorSpace: "none",
				generateMipmaps: false,
				flipY: false,
			}),
		).toBe(
			"wrap=clamp/repeat;filter=linear/nearest;color=none;mips=off;flipY=off",
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
