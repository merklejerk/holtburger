import {
	CompressedTexture,
	DataTexture,
	LinearFilter,
	NoColorSpace,
	RGBA_S3TC_DXT1_Format,
	RGBA_S3TC_DXT3_Format,
	RGBA_S3TC_DXT5_Format,
	RGBAFormat,
	RGBFormat,
	RedFormat,
	UnsignedByteType,
	UnsignedShort4444Type,
	type PixelFormat,
	type PixelFormatGPU,
	type Texture,
	type TextureDataType,
} from "three";

import type {
	PreparedRenderSurfacePayload,
	PreparedTexturePayload,
} from "../assets/types";
import {
	applyTextureSamplingPolicy,
	type TextureSamplingPolicy,
} from "./texture-pages/texture-sampling-policy";
import {
	prepareRenderSurfaceTextureUploadData,
	type CompressedRenderSurfaceUploadFormat,
	type DirectRenderSurfaceUploadDataType,
	type DirectRenderSurfaceUploadFormat,
	type DirectRenderSurfaceUploadInternalFormat,
	type MaterialTextureCapabilities,
} from "./render-surface-texture-data";

export {
	describeRenderSurfaceDecodeKey,
	hasSourceAlpha,
	isSupportedCompressedFormat,
	isSupportedDirectColorFormat,
	type MaterialTextureCapabilities,
} from "./render-surface-texture-data";

export function createRenderSurfaceTexture(
	renderSurface: PreparedRenderSurfacePayload,
	samplingPolicy: TextureSamplingPolicy,
	capabilities: MaterialTextureCapabilities = {
		supportsS3tc: false,
		supportsS3tcSrgb: false,
		supportsPackedRgb565: false,
		supportsPackedRgba4444: true,
		maxAnisotropy: 1,
	},
	preparedTexture: PreparedTexturePayload | null = null,
): Texture | null {
	const prepared = prepareRenderSurfaceTextureUploadData(
		renderSurface,
		samplingPolicy,
		capabilities,
		preparedTexture,
	);
	if (prepared.status !== "ready") {
		return null;
	}
	const upload = prepared.upload;
	if (upload.kind === "compressed") {
		const texture = new CompressedTexture(
			upload.levels.map((level) => ({
				data: level.data,
				width: level.width,
				height: level.height,
			})),
			upload.width,
			upload.height,
			toThreeCompressedFormat(upload.format),
			UnsignedByteType,
			undefined,
			undefined,
			undefined,
			LinearFilter,
			LinearFilter,
			undefined,
			NoColorSpace,
		);
		applyTextureSamplingPolicy(texture, upload.samplingPolicy);
		texture.needsUpdate = true;
		return texture;
	}

	const texture = new DataTexture(
		upload.data,
		upload.width,
		upload.height,
		toThreePixelFormat(upload.format),
		toThreeTextureDataType(upload.dataType),
	);
	texture.internalFormat = toThreeInternalFormat(upload.internalFormat);
	applyTextureSamplingPolicy(texture, upload.samplingPolicy);
	texture.needsUpdate = true;
	return texture;
}

function toThreePixelFormat(format: DirectRenderSurfaceUploadFormat): PixelFormat {
	switch (format) {
		case "rgb":
			return RGBFormat;
		case "rgba":
			return RGBAFormat;
		case "red":
			return RedFormat;
	}
}

function toThreeTextureDataType(
	dataType: DirectRenderSurfaceUploadDataType,
): TextureDataType {
	switch (dataType) {
		case "uint8":
			return UnsignedByteType;
		case "uint16-rgba4444":
			return UnsignedShort4444Type;
	}
}

function toThreeInternalFormat(
	internalFormat: DirectRenderSurfaceUploadInternalFormat | null,
): PixelFormatGPU | null {
	switch (internalFormat) {
		case null:
			return null;
		case "rgb8":
			return "RGB8";
		case "r8":
			return "R8";
	}
}

function toThreeCompressedFormat(
	format: CompressedRenderSurfaceUploadFormat,
):
	| typeof RGBA_S3TC_DXT1_Format
	| typeof RGBA_S3TC_DXT3_Format
	| typeof RGBA_S3TC_DXT5_Format {
	switch (format) {
		case "s3tc-dxt1-rgba":
			return RGBA_S3TC_DXT1_Format;
		case "s3tc-dxt3-rgba":
			return RGBA_S3TC_DXT3_Format;
		case "s3tc-dxt5-rgba":
			return RGBA_S3TC_DXT5_Format;
	}
}
