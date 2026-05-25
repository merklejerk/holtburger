import {
	ClampToEdgeWrapping,
	LinearFilter,
	NearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	type ColorSpace,
	type MagnificationTextureFilter,
	type MinificationTextureFilter,
	type Texture,
	type Wrapping,
} from "three";

import type { PreparedRenderSurfacePayload } from "../assets/types";
import { isIndexedTextureFormat } from "./indexed-texture-resources";
import {
	isSupportedCompressedFormat,
	type MaterialTextureCapabilities,
} from "./render-surface-texture-resources";

type TextureWrapMode = "clamp" | "repeat";
type TextureFilterMode = "nearest" | "linear";
type TextureColorSpaceMode = "none" | "srgb";

export interface TextureSamplingPolicy {
	wrapS: TextureWrapMode;
	wrapT: TextureWrapMode;
	magFilter: TextureFilterMode;
	minFilter: TextureFilterMode;
	colorSpace: TextureColorSpaceMode;
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
	},
): MaterialTextureSamplingPolicy {
	return {
		directColor: {
			wrapS: "clamp",
			wrapT: "clamp",
			magFilter: "nearest",
			minFilter: "nearest",
			colorSpace: "srgb",
			generateMipmaps: false,
			flipY: false,
		},
		compressed: {
			wrapS: "clamp",
			wrapT: "clamp",
			magFilter: "linear",
			minFilter: "linear",
			colorSpace: capabilities.supportsS3tcSrgb ? "srgb" : "none",
			generateMipmaps: false,
			flipY: false,
		},
		indexed: {
			wrapS: "clamp",
			wrapT: "clamp",
			magFilter: "nearest",
			minFilter: "nearest",
			colorSpace: "none",
			generateMipmaps: false,
			flipY: false,
		},
	};
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

export function applyTextureSamplingPolicy(
	texture: Texture,
	policy: TextureSamplingPolicy,
): void {
	texture.wrapS = toThreeWrapping(policy.wrapS);
	texture.wrapT = toThreeWrapping(policy.wrapT);
	texture.magFilter = toThreeMagnificationFilter(policy.magFilter);
	texture.minFilter = toThreeMinificationFilter(policy.minFilter);
	texture.colorSpace = toThreeColorSpace(policy.colorSpace);
	texture.generateMipmaps = policy.generateMipmaps;
	texture.flipY = policy.flipY;
}

export function describeTextureSamplingPolicy(
	policy: TextureSamplingPolicy,
): string {
	return [
		`wrap=${policy.wrapS}/${policy.wrapT}`,
		`filter=${policy.magFilter}/${policy.minFilter}`,
		`color=${policy.colorSpace}`,
		`mips=${policy.generateMipmaps ? "on" : "off"}`,
		`flipY=${policy.flipY ? "on" : "off"}`,
	].join(";");
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
	mode: TextureFilterMode,
): MinificationTextureFilter {
	return mode === "nearest" ? NearestFilter : LinearFilter;
}

function toThreeColorSpace(mode: TextureColorSpaceMode): ColorSpace {
	return mode === "srgb" ? SRGBColorSpace : NoColorSpace;
}
