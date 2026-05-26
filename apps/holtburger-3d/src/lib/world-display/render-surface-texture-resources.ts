import {
	CompressedTexture,
	DataTexture,
	LinearFilter,
	NoColorSpace,
	RGBA_S3TC_DXT1_Format,
	RGBA_S3TC_DXT3_Format,
	RGBA_S3TC_DXT5_Format,
	RGBAFormat,
	UnsignedByteType,
	type Texture,
} from "three";

import type { PreparedRenderSurfacePayload } from "../assets/types";
import { formatHex32 } from "../landblocks";
import {
	applyTextureSamplingPolicy,
	type TextureSamplingPolicy,
} from "./texture-sampling-policy";

export interface MaterialTextureCapabilities {
	supportsS3tc: boolean;
	supportsS3tcSrgb: boolean;
	maxAnisotropy?: number;
}

const PIXEL_FORMAT_R8G8B8 = 0x14;
const PIXEL_FORMAT_A8R8G8B8 = 0x15;
const PIXEL_FORMAT_X8R8G8B8 = 0x16;
const PIXEL_FORMAT_R5G6B5 = 0x17;
const PIXEL_FORMAT_A4R4G4B4 = 0x1a;
const PIXEL_FORMAT_A8 = 0x1c;
const PIXEL_FORMAT_CUSTOM_LANDSCAPE_R8G8B8 = 0xf3;
const PIXEL_FORMAT_DXT1 = 0x3154_5844;
const PIXEL_FORMAT_DXT3 = 0x3354_5844;
const PIXEL_FORMAT_DXT5 = 0x3554_5844;
const FULL_ALPHA = 255;
const R5G6B5_RED_SHIFT = 11;
const R5G6B5_GREEN_SHIFT = 5;
const R5G6B5_RED_MASK = 0x1f;
const R5G6B5_GREEN_MASK = 0x3f;
const R5G6B5_BLUE_MASK = 0x1f;
const A4R4G4B4_ALPHA_SHIFT = 12;
const A4R4G4B4_RED_SHIFT = 8;
const A4R4G4B4_GREEN_SHIFT = 4;
const A4R4G4B4_CHANNEL_MASK = 0x0f;

export function createRenderSurfaceTexture(
	renderSurface: PreparedRenderSurfacePayload,
	samplingPolicy: TextureSamplingPolicy,
	capabilities: MaterialTextureCapabilities = {
		supportsS3tc: false,
		supportsS3tcSrgb: false,
		maxAnisotropy: 1,
	},
): Texture | null {
	if (isSupportedCompressedFormat(renderSurface.formatRaw)) {
		return createCompressedTexture(renderSurface, capabilities, samplingPolicy);
	}
	if (!isSupportedDirectColorFormat(renderSurface.formatRaw)) {
		return null;
	}
	const rgba = decodeDirectColorRenderSurface(renderSurface);
	const texture = new DataTexture(
		rgba,
		renderSurface.width,
		renderSurface.height,
		RGBAFormat,
		UnsignedByteType,
	);
	applyTextureSamplingPolicy(texture, samplingPolicy);
	texture.needsUpdate = true;
	return texture;
}

export function isSupportedDirectColorFormat(formatRaw: number): boolean {
	return directColorBytesPerPixel(formatRaw) !== null;
}

export function isSupportedCompressedFormat(formatRaw: number): boolean {
	return compressedTextureFormat(formatRaw) !== null;
}

export function hasSourceAlpha(formatRaw: number): boolean {
	return (
		formatRaw === PIXEL_FORMAT_A8R8G8B8 ||
		formatRaw === PIXEL_FORMAT_A4R4G4B4 ||
		formatRaw === PIXEL_FORMAT_DXT3 ||
		formatRaw === PIXEL_FORMAT_DXT5
	);
}

export function describeRenderSurfaceDecodeKey(
	renderSurface: PreparedRenderSurfacePayload,
): string {
	return [
		renderSurface.renderSurfaceId,
		renderSurface.formatRaw,
		renderSurface.width,
		renderSurface.height,
		renderSurface.sourceByteLength,
	].join(":");
}

function createCompressedTexture(
	renderSurface: PreparedRenderSurfacePayload,
	capabilities: MaterialTextureCapabilities,
	samplingPolicy: TextureSamplingPolicy,
): Texture | null {
	if (!capabilities.supportsS3tc) {
		return null;
	}
	const format = compressedTextureFormat(renderSurface.formatRaw);
	if (format === null) {
		return null;
	}
	const expectedByteLength = expectedCompressedSourceByteLength(renderSurface);
	if (renderSurface.sourceBytes.byteLength !== expectedByteLength) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} ${renderSurface.format} expected ${expectedByteLength} compressed source bytes, got ${renderSurface.sourceBytes.byteLength}.`,
		);
	}
	assertDeclaredSourceByteLengthMatchesPayload(renderSurface);

	const texture = new CompressedTexture(
		[
			{
				data: renderSurface.sourceBytes,
				width: renderSurface.width,
				height: renderSurface.height,
			},
		],
		renderSurface.width,
		renderSurface.height,
		format,
		UnsignedByteType,
		undefined,
		undefined,
		undefined,
		LinearFilter,
		LinearFilter,
		undefined,
		NoColorSpace,
	);
	applyTextureSamplingPolicy(texture, samplingPolicy);
	texture.needsUpdate = true;
	return texture;
}

function decodeDirectColorRenderSurface(
	renderSurface: PreparedRenderSurfacePayload,
): Uint8Array {
	const pixelCount = assertValidSurfaceDimensions(renderSurface);
	const expectedByteLength = expectedDirectColorSourceByteLength(renderSurface);
	if (renderSurface.sourceBytes.byteLength !== expectedByteLength) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} ${renderSurface.format} expected ${expectedByteLength} source bytes, got ${renderSurface.sourceBytes.byteLength}.`,
		);
	}
	assertDeclaredSourceByteLengthMatchesPayload(renderSurface);

	const rgba = new Uint8Array(pixelCount * 4);
	const source = renderSurface.sourceBytes;
	switch (renderSurface.formatRaw) {
		case PIXEL_FORMAT_R8G8B8:
		case PIXEL_FORMAT_CUSTOM_LANDSCAPE_R8G8B8:
			for (let pixel = 0; pixel < pixelCount; pixel += 1) {
				const sourceOffset = pixel * 3;
				const targetOffset = pixel * 4;
				rgba[targetOffset] = source[sourceOffset] ?? 0;
				rgba[targetOffset + 1] = source[sourceOffset + 1] ?? 0;
				rgba[targetOffset + 2] = source[sourceOffset + 2] ?? 0;
				rgba[targetOffset + 3] = FULL_ALPHA;
			}
			return rgba;
		case PIXEL_FORMAT_A8R8G8B8:
		case PIXEL_FORMAT_X8R8G8B8:
			for (let pixel = 0; pixel < pixelCount; pixel += 1) {
				const sourceOffset = pixel * 4;
				const targetOffset = pixel * 4;
				rgba[targetOffset] = source[sourceOffset + 2] ?? 0;
				rgba[targetOffset + 1] = source[sourceOffset + 1] ?? 0;
				rgba[targetOffset + 2] = source[sourceOffset] ?? 0;
				rgba[targetOffset + 3] =
					renderSurface.formatRaw === PIXEL_FORMAT_A8R8G8B8
						? (source[sourceOffset + 3] ?? FULL_ALPHA)
						: FULL_ALPHA;
			}
			return rgba;
		case PIXEL_FORMAT_R5G6B5:
			for (let pixel = 0; pixel < pixelCount; pixel += 1) {
				const sourceOffset = pixel * 2;
				const targetOffset = pixel * 4;
				const value =
					(source[sourceOffset] ?? 0) | ((source[sourceOffset + 1] ?? 0) << 8);
				rgba[targetOffset] = scaleBitsToByte(
					(value >> R5G6B5_RED_SHIFT) & R5G6B5_RED_MASK,
					5,
				);
				rgba[targetOffset + 1] = scaleBitsToByte(
					(value >> R5G6B5_GREEN_SHIFT) & R5G6B5_GREEN_MASK,
					6,
				);
				rgba[targetOffset + 2] = scaleBitsToByte(value & R5G6B5_BLUE_MASK, 5);
				rgba[targetOffset + 3] = FULL_ALPHA;
			}
			return rgba;
		case PIXEL_FORMAT_A4R4G4B4:
			for (let pixel = 0; pixel < pixelCount; pixel += 1) {
				const sourceOffset = pixel * 2;
				const targetOffset = pixel * 4;
				const value =
					(source[sourceOffset] ?? 0) | ((source[sourceOffset + 1] ?? 0) << 8);
				rgba[targetOffset] = scaleBitsToByte(
					(value >> A4R4G4B4_RED_SHIFT) & A4R4G4B4_CHANNEL_MASK,
					4,
				);
				rgba[targetOffset + 1] = scaleBitsToByte(
					(value >> A4R4G4B4_GREEN_SHIFT) & A4R4G4B4_CHANNEL_MASK,
					4,
				);
				rgba[targetOffset + 2] = scaleBitsToByte(
					value & A4R4G4B4_CHANNEL_MASK,
					4,
				);
				rgba[targetOffset + 3] = scaleBitsToByte(
					(value >> A4R4G4B4_ALPHA_SHIFT) & A4R4G4B4_CHANNEL_MASK,
					4,
				);
			}
			return rgba;
		case PIXEL_FORMAT_A8:
			for (let pixel = 0; pixel < pixelCount; pixel += 1) {
				const targetOffset = pixel * 4;
				const value = source[pixel] ?? 0;
				rgba[targetOffset] = value;
				rgba[targetOffset + 1] = value;
				rgba[targetOffset + 2] = value;
				rgba[targetOffset + 3] = FULL_ALPHA;
			}
			return rgba;
		default:
			throw new Error(
				`Unsupported direct-color RenderSurface format ${renderSurface.formatRaw}.`,
			);
	}
}

function expectedDirectColorSourceByteLength(
	renderSurface: PreparedRenderSurfacePayload,
): number {
	const bytesPerPixel = directColorBytesPerPixel(renderSurface.formatRaw);
	if (bytesPerPixel === null) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} format ${renderSurface.format} is not a direct-color upload format.`,
		);
	}
	return renderSurface.width * renderSurface.height * bytesPerPixel;
}

function directColorBytesPerPixel(formatRaw: number): number | null {
	switch (formatRaw) {
		case PIXEL_FORMAT_R8G8B8:
		case PIXEL_FORMAT_CUSTOM_LANDSCAPE_R8G8B8:
			return 3;
		case PIXEL_FORMAT_A8R8G8B8:
		case PIXEL_FORMAT_X8R8G8B8:
			return 4;
		case PIXEL_FORMAT_R5G6B5:
		case PIXEL_FORMAT_A4R4G4B4:
			return 2;
		case PIXEL_FORMAT_A8:
			return 1;
		default:
			return null;
	}
}

function compressedTextureFormat(
	formatRaw: number,
):
	| typeof RGBA_S3TC_DXT1_Format
	| typeof RGBA_S3TC_DXT3_Format
	| typeof RGBA_S3TC_DXT5_Format
	| null {
	switch (formatRaw) {
		case PIXEL_FORMAT_DXT1:
			return RGBA_S3TC_DXT1_Format;
		case PIXEL_FORMAT_DXT3:
			return RGBA_S3TC_DXT3_Format;
		case PIXEL_FORMAT_DXT5:
			return RGBA_S3TC_DXT5_Format;
		default:
			return null;
	}
}

function expectedCompressedSourceByteLength(
	renderSurface: PreparedRenderSurfacePayload,
): number {
	assertValidSurfaceDimensions(renderSurface);
	const bytesPerBlock = compressedBytesPerBlock(renderSurface.formatRaw);
	if (bytesPerBlock === null) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} format ${renderSurface.format} is not a compressed upload format.`,
		);
	}
	return (
		Math.floor((renderSurface.width + 3) / 4) *
		Math.floor((renderSurface.height + 3) / 4) *
		bytesPerBlock
	);
}

function compressedBytesPerBlock(formatRaw: number): number | null {
	switch (formatRaw) {
		case PIXEL_FORMAT_DXT1:
			return 8;
		case PIXEL_FORMAT_DXT3:
		case PIXEL_FORMAT_DXT5:
			return 16;
		default:
			return null;
	}
}

function assertValidSurfaceDimensions(
	renderSurface: PreparedRenderSurfacePayload,
): number {
	if (renderSurface.width <= 0 || renderSurface.height <= 0) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} has invalid dimensions ${renderSurface.width}x${renderSurface.height}.`,
		);
	}
	const pixelCount = renderSurface.width * renderSurface.height;
	if (!Number.isSafeInteger(pixelCount)) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} dimensions are too large.`,
		);
	}
	return pixelCount;
}

function assertDeclaredSourceByteLengthMatchesPayload(
	renderSurface: PreparedRenderSurfacePayload,
): void {
	if (renderSurface.sourceByteLength !== renderSurface.sourceBytes.byteLength) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} declared ${renderSurface.sourceByteLength} source bytes but binary payload carried ${renderSurface.sourceBytes.byteLength}.`,
		);
	}
}

function scaleBitsToByte(value: number, bitCount: number): number {
	const maxValue = (1 << bitCount) - 1;
	return Math.round((value / maxValue) * 255);
}
