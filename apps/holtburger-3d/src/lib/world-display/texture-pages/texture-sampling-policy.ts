import {
	ClampToEdgeWrapping,
	LinearFilter,
	LinearMipMapLinearFilter,
	LinearMipMapNearestFilter,
	NearestFilter,
	NearestMipMapLinearFilter,
	NearestMipMapNearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	type ColorSpace,
	type MagnificationTextureFilter,
	type MinificationTextureFilter,
	type Texture,
	type Wrapping,
} from "three";

import type { PreparedRenderSurfacePayload } from "../../assets/types";
import { isIndexedTextureFormat } from "../indexed-texture-resources";
import { parseLegacySamplerMaterialVariantSignature } from "../material-variants";
import {
	isSupportedCompressedFormat,
	type MaterialTextureCapabilities,
} from "../render-surface-texture-resources";

export type TextureWrapMode = "clamp" | "repeat";
type TextureFilterMode = "nearest" | "linear";
type TextureMipFilterMode = "none" | "nearest" | "linear";
type TextureColorSpaceMode = "none" | "srgb";
export type TextureFilteringMode = "nearest" | "linear" | "anisotropic-4x";

export interface TextureSamplingPolicy {
	wrapS: TextureWrapMode;
	wrapT: TextureWrapMode;
	magFilter: TextureFilterMode;
	minFilter: TextureFilterMode;
	mipFilter: TextureMipFilterMode;
	colorSpace: TextureColorSpaceMode;
	anisotropy: number;
	generateMipmaps: boolean;
	flipY: boolean;
}

export interface MaterialTextureSamplingPolicy {
	directColor: TextureSamplingPolicy;
	compressed: TextureSamplingPolicy;
	indexed: TextureSamplingPolicy;
}

export function createDefaultMaterialTextureSamplingPolicy(
	capabilities: MaterialTextureCapabilities = {
		supportsS3tc: false,
		supportsS3tcSrgb: false,
		maxAnisotropy: 1,
	},
	filteringMode: TextureFilteringMode = "anisotropic-4x",
): MaterialTextureSamplingPolicy {
	const colorTextureAnisotropy = selectAnisotropy(
		capabilities.maxAnisotropy,
		filteringMode,
	);
	const colorTextureFilter = selectColorTextureFilter(filteringMode);
	return {
		directColor: {
			wrapS: "clamp",
			wrapT: "clamp",
			magFilter: colorTextureFilter.magFilter,
			minFilter: colorTextureFilter.minFilter,
			mipFilter: colorTextureFilter.mipFilter,
			colorSpace: "srgb",
			anisotropy: colorTextureAnisotropy,
			generateMipmaps: colorTextureFilter.mipFilter !== "none",
			flipY: false,
		},
		compressed: {
			wrapS: "clamp",
			wrapT: "clamp",
			magFilter: colorTextureFilter.magFilter,
			minFilter: colorTextureFilter.minFilter,
			mipFilter: colorTextureFilter.mipFilter,
			colorSpace: compressedTextureColorSpace(capabilities),
			anisotropy: colorTextureAnisotropy,
			generateMipmaps: false,
			flipY: false,
		},
		indexed: {
			wrapS: "clamp",
			wrapT: "clamp",
			magFilter: "nearest",
			minFilter: "nearest",
			mipFilter: "none",
			colorSpace: "none",
			anisotropy: 1,
			generateMipmaps: false,
			flipY: false,
		},
	};
}

function compressedTextureColorSpace(
	capabilities: MaterialTextureCapabilities,
): TextureColorSpaceMode {
	return capabilities.supportsS3tcSrgb ? "srgb" : "none";
}

export function selectRenderSurfaceTextureSamplingPolicy(
	renderSurface: PreparedRenderSurfacePayload,
	policy: MaterialTextureSamplingPolicy,
): TextureSamplingPolicy {
	if (isIndexedTextureFormat(renderSurface.formatRaw)) {
		return policy.indexed;
	}
	if (isSupportedCompressedFormat(renderSurface.formatRaw)) {
		return policy.compressed;
	}
	return policy.directColor;
}

export function selectVariantTextureSamplingPolicy(
	renderSurface: PreparedRenderSurfacePayload,
	policy: MaterialTextureSamplingPolicy,
	materialVariantSignature: string | null | undefined,
): TextureSamplingPolicy {
	const basePolicy = selectRenderSurfaceTextureSamplingPolicy(
		renderSurface,
		policy,
	);
	const legacySamplerVariant = parseLegacySamplerMaterialVariantSignature(
		materialVariantSignature,
	);
	if (legacySamplerVariant === null) {
		return basePolicy;
	}
	return {
		...basePolicy,
		wrapS: legacySamplerVariant,
		wrapT: legacySamplerVariant,
	};
}

export function applyTextureSamplingPolicy(
	texture: Texture,
	policy: TextureSamplingPolicy,
): void {
	texture.wrapS = toThreeWrapping(policy.wrapS);
	texture.wrapT = toThreeWrapping(policy.wrapT);
	texture.magFilter = toThreeMagnificationFilter(policy.magFilter);
	texture.minFilter = toThreeMinificationFilter(
		policy.minFilter,
		policy.mipFilter,
	);
	texture.colorSpace = toThreeColorSpace(policy.colorSpace);
	texture.anisotropy = policy.anisotropy;
	texture.generateMipmaps = policy.generateMipmaps;
	texture.flipY = policy.flipY;
}

export function describeTextureSamplingPolicy(
	policy: TextureSamplingPolicy,
): string {
	return [
		`wrap=${policy.wrapS}/${policy.wrapT}`,
		`filter=${policy.magFilter}/${policy.minFilter}/${policy.mipFilter}`,
		`color=${policy.colorSpace}`,
		`aniso=${policy.anisotropy}`,
		`mips=${policy.generateMipmaps ? "on" : "off"}`,
		`flipY=${policy.flipY ? "on" : "off"}`,
	].join(";");
}

function selectColorTextureFilter(filteringMode: TextureFilteringMode): {
	magFilter: TextureFilterMode;
	minFilter: TextureFilterMode;
	mipFilter: TextureMipFilterMode;
} {
	if (filteringMode === "nearest") {
		return {
			magFilter: "nearest",
			minFilter: "nearest",
			mipFilter: "none",
		};
	}
	return {
		magFilter: "linear",
		minFilter: "linear",
		mipFilter: "linear",
	};
}

function selectAnisotropy(
	maxAnisotropy: number | undefined,
	filteringMode: TextureFilteringMode,
): number {
	if (filteringMode !== "anisotropic-4x") {
		return 1;
	}
	const supported = Math.max(1, Math.floor(maxAnisotropy ?? 1));
	return Math.min(4, supported);
}

function toThreeWrapping(mode: TextureWrapMode): Wrapping {
	return mode === "repeat" ? RepeatWrapping : ClampToEdgeWrapping;
}

function toThreeMagnificationFilter(
	mode: TextureFilterMode,
): MagnificationTextureFilter {
	return mode === "nearest" ? NearestFilter : LinearFilter;
}

function toThreeMinificationFilter(
	minFilter: TextureFilterMode,
	mipFilter: TextureMipFilterMode,
): MinificationTextureFilter {
	if (mipFilter === "none") {
		return minFilter === "nearest" ? NearestFilter : LinearFilter;
	}
	if (minFilter === "nearest") {
		return mipFilter === "nearest"
			? NearestMipMapNearestFilter
			: NearestMipMapLinearFilter;
	}
	return mipFilter === "nearest"
		? LinearMipMapNearestFilter
		: LinearMipMapLinearFilter;
}

function toThreeColorSpace(mode: TextureColorSpaceMode): ColorSpace {
	return mode === "srgb" ? SRGBColorSpace : NoColorSpace;
}
