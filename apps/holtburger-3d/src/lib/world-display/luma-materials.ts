import {
	Texture as LumaTexture,
	type Device,
	type SamplerProps,
	type Texture,
} from "@luma.gl/core";
import type { TextureFormat } from "@luma.gl/core";

import type {
	AssetChannelState,
	PreparedRenderSurfacePayload,
	PreparedTexturePayload,
} from "../assets/types";
import {
	formatPreparedTextureAssetId,
	preparedDxtOutputFormat,
} from "../assets/types";
import { formatHex32 } from "../landblocks";
import {
	deriveLegacyMaterialBehaviorDto,
	type LegacyMaterialBehaviorDto,
} from "./material-behavior";
import type { LumaVec4 } from "./luma-math";
import { formatMaterialAssetId } from "./material-signatures";
import { resolveFirstMaterialRenderSurface } from "./material-texture-resolution";
import {
	prepareRenderSurfaceTextureUploadData,
	type DirectRenderSurfaceUploadDataType,
	type DirectRenderSurfaceUploadFormat,
	type DirectRenderSurfaceUploadInternalFormat,
	type MaterialTextureCapabilities,
	type RenderSurfaceTextureUploadPreparation,
} from "./render-surface-texture-data";
import {
	createDefaultMaterialTextureSamplingPolicy,
	selectRenderSurfaceTextureSamplingPolicy,
	type TextureSamplingPolicy,
} from "./texture-sampling-policy";

export type LumaMaterialPlan = LumaFlatMaterialPlan | LumaDirectTextureMaterialPlan;

interface LumaFlatMaterialPlan {
	kind: "flat";
	key: string;
	color: LumaVec4;
	behavior: LegacyMaterialBehaviorDto | null;
	fallbackReason: string | null;
}

export interface LumaDirectTextureMaterialPlan {
	kind: "direct-texture";
	key: string;
	color: LumaVec4;
	textureKey: string;
	textureUpload: RenderSurfaceTextureUploadPreparation & { status: "ready" };
	behavior: LegacyMaterialBehaviorDto;
	fallbackReason: string | null;
}

interface LumaTextureResourceRecord {
	texture: Texture;
	key: string;
}

export interface LumaTextureResourceStore {
	texturesByKey: Map<string, LumaTextureResourceRecord>;
}

export function createLumaTextureResourceStore(): LumaTextureResourceStore {
	return {
		texturesByKey: new Map(),
	};
}

export function destroyLumaTextureResources(store: LumaTextureResourceStore): void {
	for (const record of store.texturesByKey.values()) {
		record.texture.destroy();
	}
	store.texturesByKey.clear();
}

export function resolveLumaSurfaceMaterialPlan(options: {
	assetState: AssetChannelState;
	surfaceId: number | null;
	fallbackColorKey: string;
	textureCapabilities?: MaterialTextureCapabilities;
}): LumaMaterialPlan {
	if (options.surfaceId === null) {
		return createFallbackMaterialPlan({
			key: `missing-surface/${options.fallbackColorKey}`,
			colorKey: options.fallbackColorKey,
			reason: "missing surface id",
		});
	}
	const materialAssetId = formatMaterialAssetId(options.surfaceId);
	const recipeAsset = options.assetState.preparedByAssetId[materialAssetId];
	if (recipeAsset?.payload.kind !== "material-recipe") {
		return createFallbackMaterialPlan({
			key: `missing-recipe/${materialAssetId}/${options.fallbackColorKey}`,
			colorKey: options.fallbackColorKey,
			reason: `missing material recipe ${materialAssetId}`,
		});
	}
	const recipe = recipeAsset.payload;
	const directRenderSurface = resolveFirstMaterialRenderSurface({
		recipe,
		assetState: options.assetState,
	})?.renderSurface;
	if (!directRenderSurface) {
		return createFallbackMaterialPlan({
			key: `missing-direct-texture/${materialAssetId}/${options.fallbackColorKey}`,
			colorKey: options.fallbackColorKey,
			behavior: deriveLegacyMaterialBehaviorDto({ recipe }),
			reason: `material ${materialAssetId} has no direct render surface`,
		});
	}
	const textureCapabilities =
		options.textureCapabilities ?? defaultLumaMaterialTextureCapabilities();
	const samplingPolicy = selectRenderSurfaceTextureSamplingPolicy(
		directRenderSurface,
		createDefaultMaterialTextureSamplingPolicy(textureCapabilities),
	);
	const textureUpload = prepareRenderSurfaceTextureUploadData(
		directRenderSurface,
		samplingPolicy,
		textureCapabilities,
		resolvePreparedTexture({
			assetState: options.assetState,
			renderSurface: directRenderSurface,
		}),
	);
	if (textureUpload.status !== "ready" || textureUpload.upload.kind !== "direct") {
		return createFallbackMaterialPlan({
			key: `unsupported-direct-texture/${materialAssetId}/${directRenderSurface.renderSurfaceId}`,
			colorKey: options.fallbackColorKey,
			behavior: deriveLegacyMaterialBehaviorDto({ recipe }),
			reason:
				textureUpload.status === "ready"
					? `material ${materialAssetId} resolved non-direct texture ${formatHex32(directRenderSurface.renderSurfaceId)}`
					: `material ${materialAssetId} texture ${formatHex32(directRenderSurface.renderSurfaceId)} is ${textureUpload.reason}`,
		});
	}
	const behavior = deriveLegacyMaterialBehaviorDto({
		recipe,
		hasSourceAlpha: textureUpload.upload.hasSourceAlpha,
	});
	const textureKey = describeLumaTextureKey(textureUpload.upload);
	return {
		kind: "direct-texture",
		key: [
			"direct-texture",
			materialAssetId,
			textureKey,
			behavior.blend.mode,
			behavior.alphaTest,
			behavior.blend.depthWrite ? "depth-write" : "depth-read",
		].join("|"),
		color: new Float32Array([
			behavior.color[0],
			behavior.color[1],
			behavior.color[2],
			behavior.opacity,
		]),
		textureKey,
		textureUpload,
		behavior,
		fallbackReason: null,
	};
}

export function getOrCreateLumaTextureResource(options: {
	device: Device;
	store: LumaTextureResourceStore;
	plan: LumaDirectTextureMaterialPlan;
}): Texture {
	const cached = options.store.texturesByKey.get(options.plan.textureKey);
	if (cached) {
		return cached.texture;
	}
	const upload = options.plan.textureUpload.upload;
	if (upload.kind !== "direct") {
		throw new Error(`Luma direct material ${options.plan.key} did not carry direct texture data.`);
	}
	const texture = options.device.createTexture({
		id: options.plan.textureKey,
		format: toLumaTextureFormat(upload),
		width: upload.width,
		height: upload.height,
		usage: LumaTexture.SAMPLE | LumaTexture.COPY_DST,
		mipLevels: upload.samplingPolicy.generateMipmaps
			? calculateMipLevelCount(upload.width, upload.height)
			: 1,
		sampler: toLumaSamplerProps(upload.samplingPolicy),
	});
	texture.writeData(upload.data, {
		width: upload.width,
		height: upload.height,
	});
	if (upload.samplingPolicy.generateMipmaps) {
		texture.generateMipmapsWebGL();
	}
	options.store.texturesByKey.set(options.plan.textureKey, {
		texture,
		key: options.plan.textureKey,
	});
	return texture;
}

function createFallbackMaterialPlan(options: {
	key: string;
	colorKey: string;
	behavior?: LegacyMaterialBehaviorDto | null;
	reason: string;
}): LumaFlatMaterialPlan {
	return {
		kind: "flat",
		key: `flat/${options.key}`,
		color: buildFallbackColor(options.colorKey),
		behavior: options.behavior ?? null,
		fallbackReason: options.reason,
	};
}

function resolvePreparedTexture(options: {
	assetState: AssetChannelState;
	renderSurface: PreparedRenderSurfacePayload;
}): PreparedTexturePayload | null {
	const outputFormat = preparedDxtOutputFormat(options.renderSurface.formatRaw);
	if (!outputFormat) {
		return null;
	}
	const assetId = formatPreparedTextureAssetId({
		renderSurfaceId: options.renderSurface.renderSurfaceId,
		usage: "raw",
		outputFormat,
		mipPolicy: "retail4",
		colorSpace: "source",
	});
	const asset = options.assetState.preparedByAssetId[assetId];
	return asset?.payload.kind === "prepared-texture" ? asset.payload : null;
}

function describeLumaTextureKey(
	upload: Extract<
		RenderSurfaceTextureUploadPreparation,
		{ status: "ready" }
	>["upload"],
): string {
	return [
		"texture",
		formatHex32(upload.renderSurfaceId),
		upload.sourceFormatRaw,
		upload.width,
		upload.height,
		upload.samplingPolicy.colorSpace,
		upload.samplingPolicy.wrapS,
		upload.samplingPolicy.wrapT,
		upload.samplingPolicy.minFilter,
		upload.samplingPolicy.magFilter,
		upload.samplingPolicy.mipFilter,
	].join("/");
}

function defaultLumaMaterialTextureCapabilities(): MaterialTextureCapabilities {
	return {
		supportsS3tc: false,
		supportsS3tcSrgb: false,
		supportsPackedRgb565: false,
		supportsPackedRgba4444: false,
		maxAnisotropy: 1,
	};
}

function toLumaTextureFormat(upload: {
	format: DirectRenderSurfaceUploadFormat;
	dataType: DirectRenderSurfaceUploadDataType;
	internalFormat: DirectRenderSurfaceUploadInternalFormat | null;
	samplingPolicy: TextureSamplingPolicy;
}): TextureFormat {
	if (upload.format === "red") {
		return "r8unorm";
	}
	if (upload.format === "rgb") {
		return "rgb8unorm-webgl";
	}
	if (
		upload.format === "rgba" &&
		upload.dataType === "uint8" &&
		upload.samplingPolicy.colorSpace === "srgb"
	) {
		return "rgba8unorm-srgb";
	}
	return "rgba8unorm";
}

function toLumaSamplerProps(policy: TextureSamplingPolicy): SamplerProps {
	return {
		addressModeU: policy.wrapS === "repeat" ? "repeat" : "clamp-to-edge",
		addressModeV: policy.wrapT === "repeat" ? "repeat" : "clamp-to-edge",
		magFilter: policy.magFilter,
		minFilter: policy.minFilter,
		mipmapFilter: policy.mipFilter,
		maxAnisotropy: policy.anisotropy,
	};
}

function calculateMipLevelCount(width: number, height: number): number {
	return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

function buildFallbackColor(colorKey: string): LumaVec4 {
	let hash = 0x811c9dc5;
	for (let index = 0; index < colorKey.length; index += 1) {
		hash ^= colorKey.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return new Float32Array([
		((hash >>> 16) & 0xff) / 255,
		((hash >>> 8) & 0xff) / 255,
		(hash & 0xff) / 255,
		1,
	]);
}
