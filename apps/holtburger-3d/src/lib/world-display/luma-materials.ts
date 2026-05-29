import {
	Texture as LumaTexture,
	type Device,
	type SamplerProps,
	type Texture,
} from "@luma.gl/core";
import type { TextureFormat } from "@luma.gl/core";

import type { AssetChannelState } from "../assets/types";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import type { LumaVec4 } from "./luma-math";
import { formatMaterialAssetId } from "./material-signatures";
import {
	type CompressedRenderSurfaceUploadFormat,
	type DirectRenderSurfaceUploadFormat,
	type MaterialTextureCapabilities,
	type RenderSurfaceTextureUploadPreparation,
} from "./render-surface-texture-data";
import {
	defaultLumaMaterialTextureCapabilities,
	resolveLumaMaterialStrategy,
} from "./luma-material-strategy";
import { type TextureSamplingPolicy } from "./texture-sampling-policy";

export type LumaMaterialPlan =
	| LumaFlatMaterialPlan
	| LumaDirectTextureMaterialPlan;

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

type LumaReadyTextureUpload = Extract<
	RenderSurfaceTextureUploadPreparation,
	{ status: "ready" }
>["upload"];

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

export function destroyLumaTextureResources(
	store: LumaTextureResourceStore,
): void {
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
	const strategy = resolveLumaMaterialStrategy({
		assetState: options.assetState,
		input: {
			slot: {
				slotIndex: 0,
				surfaceId: options.surfaceId,
				materialAssetId,
				materialVariantSignature: null,
			},
			renderableKind: "unknown",
		},
		textureCapabilities:
			options.textureCapabilities ?? defaultLumaMaterialTextureCapabilities(),
	});
	if (strategy.kind !== "direct-texture") {
		return createFallbackMaterialPlan({
			key: `${strategy.kind}/${materialAssetId}/${options.fallbackColorKey}`,
			colorKey: options.fallbackColorKey,
			behavior: strategy.behavior,
			reason:
				strategy.kind === "atlas"
					? `material ${materialAssetId} resolved atlas strategy before atlas rendering is wired`
					: strategy.detail,
		});
	}
	return {
		kind: "direct-texture",
		key: strategy.key,
		color: new Float32Array([
			strategy.behavior.color[0],
			strategy.behavior.color[1],
			strategy.behavior.color[2],
			strategy.behavior.opacity,
		]),
		textureKey: strategy.textureKey,
		textureUpload: strategy.textureUpload,
		behavior: strategy.behavior,
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
	const texture = options.device.createTexture({
		id: options.plan.textureKey,
		format: toLumaTextureFormat(upload),
		width: upload.width,
		height: upload.height,
		usage: LumaTexture.SAMPLE | LumaTexture.COPY_DST,
		mipLevels:
			upload.kind === "compressed"
				? upload.levels.length
				: upload.samplingPolicy.generateMipmaps
					? calculateMipLevelCount(upload.width, upload.height)
					: 1,
		sampler: toLumaSamplerProps(upload.samplingPolicy),
	});
	writeLumaTextureUploadData(texture, upload);
	if (upload.kind === "direct" && upload.samplingPolicy.generateMipmaps) {
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

function toLumaTextureFormat(upload: LumaReadyTextureUpload): TextureFormat {
	if (upload.kind === "compressed") {
		return toLumaCompressedTextureFormat(upload.format);
	}
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

function toLumaCompressedTextureFormat(
	format: CompressedRenderSurfaceUploadFormat | DirectRenderSurfaceUploadFormat,
): TextureFormat {
	switch (format) {
		case "s3tc-dxt1-rgba":
			return "bc1-rgba-unorm";
		case "s3tc-dxt3-rgba":
			return "bc2-rgba-unorm";
		case "s3tc-dxt5-rgba":
			return "bc3-rgba-unorm";
		case "red":
		case "rgb":
		case "rgba":
			throw new Error(`Direct texture format ${format} is not compressed.`);
	}
}

function writeLumaTextureUploadData(
	texture: Texture,
	upload: Extract<
		RenderSurfaceTextureUploadPreparation,
		{ status: "ready" }
	>["upload"],
): void {
	if (upload.kind === "compressed") {
		for (const [mipLevel, level] of upload.levels.entries()) {
			texture.writeData(level.data, {
				mipLevel,
				width: level.width,
				height: level.height,
			});
		}
		return;
	}
	texture.writeData(upload.data, {
		width: upload.width,
		height: upload.height,
	});
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
