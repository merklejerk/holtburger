import {
	Texture as LumaTexture,
	type Device,
	type SamplerProps,
	type Texture,
} from "@luma.gl/core";
import type { TextureFormat } from "@luma.gl/core";

import {
	type CompressedRenderSurfaceUploadFormat,
	type DirectRenderSurfaceUploadFormat,
	type RenderSurfaceTextureUploadPreparation,
} from "./render-surface-texture-data";
import type {
	StagedWorldDirectTextureMaterialPlan,
	StagedWorldMaterialPlan,
} from "./staged-world-materials";
import { type TextureSamplingPolicy } from "./texture-sampling-policy";

export type LumaMaterialPlan = StagedWorldMaterialPlan;
export type LumaDirectTextureMaterialPlan =
	StagedWorldDirectTextureMaterialPlan;

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
