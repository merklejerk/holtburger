import type {
	PreparedRenderSurfacePayload,
	PreparedTexturePayload,
} from "../assets/types";
import { formatHex32 } from "../landblocks";
import type { TextureSamplingPolicy } from "./texture-pages/texture-sampling-policy";

export interface MaterialTextureCapabilities {
	supportsS3tc: boolean;
	supportsS3tcSrgb: boolean;
	supportsPackedRgb565?: boolean;
	supportsPackedRgba4444?: boolean;
	maxAnisotropy?: number;
}

type RenderSurfaceTextureUploadData =
	| DirectRenderSurfaceTextureUploadData
	| CompressedRenderSurfaceTextureUploadData;

interface DirectRenderSurfaceTextureUploadData {
	kind: "direct";
	renderSurfaceId: number;
	width: number;
	height: number;
	sourceFormatRaw: number;
	hasSourceAlpha: boolean;
	samplingPolicy: TextureSamplingPolicy;
	data: Uint8Array | Uint16Array;
	format: DirectRenderSurfaceUploadFormat;
	dataType: DirectRenderSurfaceUploadDataType;
	internalFormat: DirectRenderSurfaceUploadInternalFormat | null;
}

export type DirectRenderSurfaceUploadFormat = "rgb" | "rgba" | "red";
export type DirectRenderSurfaceUploadDataType = "uint8" | "uint16-rgba4444";
export type DirectRenderSurfaceUploadInternalFormat = "rgb8" | "r8";

interface CompressedRenderSurfaceTextureUploadData {
	kind: "compressed";
	renderSurfaceId: number;
	width: number;
	height: number;
	sourceFormatRaw: number;
	hasSourceAlpha: boolean;
	samplingPolicy: TextureSamplingPolicy;
	format: CompressedRenderSurfaceUploadFormat;
	levels: readonly CompressedRenderSurfaceTextureLevel[];
}

export type CompressedRenderSurfaceUploadFormat =
	| "s3tc-dxt1-rgba"
	| "s3tc-dxt3-rgba"
	| "s3tc-dxt5-rgba";

interface CompressedRenderSurfaceTextureLevel {
	data: Uint8Array;
	width: number;
	height: number;
}

export type RenderSurfaceTextureUploadPreparation =
	| {
			status: "ready";
			upload: RenderSurfaceTextureUploadData;
	  }
	| {
			status: "unsupported";
			reason: RenderSurfaceTextureUnsupportedReason;
			detail: Record<string, unknown>;
	  };

type RenderSurfaceTextureUnsupportedReason =
	| "unsupported-format"
	| "compressed-texture-unsupported"
	| "missing-compressed-mip";

const PIXEL_FORMAT_R8G8B8 = 0x14;
const PIXEL_FORMAT_A8R8G8B8 = 0x15;
const PIXEL_FORMAT_X8R8G8B8 = 0x16;
const PIXEL_FORMAT_R5G6B5 = 0x17;
const PIXEL_FORMAT_A4R4G4B4 = 0x1a;
const PIXEL_FORMAT_A8 = 0x1c;
const PIXEL_FORMAT_CUSTOM_LANDSCAPE_R8G8B8 = 0xf3;
const PIXEL_FORMAT_CUSTOM_LANDSCAPE_ALPHA = 0xf4;
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

export function prepareRenderSurfaceTextureUploadData(
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
): RenderSurfaceTextureUploadPreparation {
	const normalizedPreparedUpload = prepareNormalizedPreparedTextureUploadData(
		renderSurface,
		samplingPolicy,
		preparedTexture,
	);
	if (normalizedPreparedUpload) {
		return normalizedPreparedUpload;
	}
	if (isSupportedCompressedFormat(renderSurface.formatRaw)) {
		return prepareCompressedTextureUploadData(
			renderSurface,
			capabilities,
			samplingPolicy,
			preparedTexture,
		);
	}
	if (!isSupportedDirectColorFormat(renderSurface.formatRaw)) {
		return {
			status: "unsupported",
			reason: "unsupported-format",
			detail: {
				renderSurfaceId: formatHex32(renderSurface.renderSurfaceId),
				format: renderSurface.format,
				formatRaw: renderSurface.formatRaw,
			},
		};
	}
	return {
		status: "ready",
		upload: decodeDirectColorRenderSurface(
			renderSurface,
			capabilities,
			samplingPolicy,
		),
	};
}

function prepareNormalizedPreparedTextureUploadData(
	renderSurface: PreparedRenderSurfacePayload,
	samplingPolicy: TextureSamplingPolicy,
	preparedTexture: PreparedTexturePayload | null,
): RenderSurfaceTextureUploadPreparation | null {
	if (
		preparedTexture?.kind !== "prepared-texture" ||
		preparedTexture.renderSurfaceId !== renderSurface.renderSurfaceId ||
		preparedTexture.sourceFormatRaw !== renderSurface.formatRaw ||
		preparedTexture.mipPolicy !== "none" ||
		preparedTexture.levels.length !== 1
	) {
		return null;
	}
	const level = preparedTexture.levels[0];
	if (!level) {
		return null;
	}
	if (
		preparedTexture.outputFormat === "rgba8" &&
		preparedTexture.colorSpace === "linear"
	) {
		const expectedByteLength = level.width * level.height * 4;
		if (level.bytes.byteLength !== expectedByteLength) {
			throw new Error(
				`Prepared texture ${formatHex32(renderSurface.renderSurfaceId)} expected ${expectedByteLength} rgba8 bytes, got ${level.bytes.byteLength}.`,
			);
		}
		return {
			status: "ready",
			upload: {
				kind: "direct",
				renderSurfaceId: renderSurface.renderSurfaceId,
				width: level.width,
				height: level.height,
				sourceFormatRaw: renderSurface.formatRaw,
				hasSourceAlpha: hasSourceAlpha(renderSurface.formatRaw),
				samplingPolicy: {
					...samplingPolicy,
					colorSpace: "none",
					generateMipmaps: samplingPolicy.mipFilter !== "none",
				},
				data: level.bytes,
				format: "rgba",
				dataType: "uint8",
				internalFormat: null,
			},
		};
	}
	if (
		preparedTexture.outputFormat === "r8" &&
		preparedTexture.colorSpace === "data"
	) {
		const expectedByteLength = level.width * level.height;
		if (level.bytes.byteLength !== expectedByteLength) {
			throw new Error(
				`Prepared texture ${formatHex32(renderSurface.renderSurfaceId)} expected ${expectedByteLength} r8 bytes, got ${level.bytes.byteLength}.`,
			);
		}
		return {
			status: "ready",
			upload: {
				kind: "direct",
				renderSurfaceId: renderSurface.renderSurfaceId,
				width: level.width,
				height: level.height,
				sourceFormatRaw: renderSurface.formatRaw,
				hasSourceAlpha: hasSourceAlpha(renderSurface.formatRaw),
				samplingPolicy: {
					...samplingPolicy,
					colorSpace: "none",
					mipFilter: "none",
					generateMipmaps: false,
				},
				data: level.bytes,
				format: "red",
				dataType: "uint8",
				internalFormat: "r8",
			},
		};
	}
	return null;
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

function prepareCompressedTextureUploadData(
	renderSurface: PreparedRenderSurfacePayload,
	capabilities: MaterialTextureCapabilities,
	samplingPolicy: TextureSamplingPolicy,
	preparedTexture: PreparedTexturePayload | null,
): RenderSurfaceTextureUploadPreparation {
	if (!capabilities.supportsS3tc) {
		return {
			status: "unsupported",
			reason: "compressed-texture-unsupported",
			detail: {
				renderSurfaceId: formatHex32(renderSurface.renderSurfaceId),
				format: renderSurface.format,
				formatRaw: renderSurface.formatRaw,
			},
		};
	}
	const format = compressedTextureFormat(renderSurface.formatRaw);
	if (format === null) {
		return {
			status: "unsupported",
			reason: "unsupported-format",
			detail: {
				renderSurfaceId: formatHex32(renderSurface.renderSurfaceId),
				format: renderSurface.format,
				formatRaw: renderSurface.formatRaw,
			},
		};
	}
	const levels = preparedCompressedMips(renderSurface, preparedTexture);
	const baseMip = levels[0];
	if (!baseMip) {
		return {
			status: "unsupported",
			reason: "missing-compressed-mip",
			detail: {
				renderSurfaceId: formatHex32(renderSurface.renderSurfaceId),
				format: renderSurface.format,
				formatRaw: renderSurface.formatRaw,
			},
		};
	}
	const expectedByteLength = expectedCompressedLevelByteLength({
		width: baseMip.width,
		height: baseMip.height,
		formatRaw: renderSurface.formatRaw,
	});
	if (baseMip.data.byteLength !== expectedByteLength) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} ${renderSurface.format} expected ${expectedByteLength} compressed level-0 bytes, got ${baseMip.data.byteLength}.`,
		);
	}
	assertDeclaredSourceByteLengthMatchesPayload(renderSurface);

	return {
		status: "ready",
		upload: {
			kind: "compressed",
			renderSurfaceId: renderSurface.renderSurfaceId,
			width: renderSurface.width,
			height: renderSurface.height,
			sourceFormatRaw: renderSurface.formatRaw,
			hasSourceAlpha: hasSourceAlpha(renderSurface.formatRaw),
			samplingPolicy:
				levels.length > 1
					? samplingPolicy
					: { ...samplingPolicy, mipFilter: "none" },
			format,
			levels,
		},
	};
}

function preparedCompressedMips(
	renderSurface: PreparedRenderSurfacePayload,
	preparedTexture: PreparedTexturePayload | null,
): CompressedRenderSurfaceTextureLevel[] {
	if (
		preparedTexture?.kind === "prepared-texture" &&
		preparedTexture.renderSurfaceId === renderSurface.renderSurfaceId &&
		preparedTexture.sourceFormatRaw === renderSurface.formatRaw &&
		preparedTexture.levels.length > 0
	) {
		return preparedTexture.levels.map((level) => {
			const expectedByteLength = expectedCompressedLevelByteLength({
				width: level.width,
				height: level.height,
				formatRaw: level.formatRaw,
			});
			if (level.bytes.byteLength !== expectedByteLength) {
				throw new Error(
					`Prepared texture ${formatHex32(renderSurface.renderSurfaceId)} level ${level.level} expected ${expectedByteLength} bytes, got ${level.bytes.byteLength}.`,
				);
			}
			return {
				data: level.bytes,
				width: level.width,
				height: level.height,
			};
		});
	}

	return [
		{
			data: renderSurface.sourceBytes,
			width: renderSurface.width,
			height: renderSurface.height,
		},
	];
}

function decodeDirectColorRenderSurface(
	renderSurface: PreparedRenderSurfacePayload,
	capabilities: MaterialTextureCapabilities,
	samplingPolicy: TextureSamplingPolicy,
): DirectRenderSurfaceTextureUploadData {
	const pixelCount = assertValidSurfaceDimensions(renderSurface);
	const expectedByteLength = expectedDirectColorSourceByteLength(renderSurface);
	if (renderSurface.sourceBytes.byteLength !== expectedByteLength) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} ${renderSurface.format} expected ${expectedByteLength} source bytes, got ${renderSurface.sourceBytes.byteLength}.`,
		);
	}
	assertDeclaredSourceByteLengthMatchesPayload(renderSurface);

	const source = renderSurface.sourceBytes;
	const base = {
		kind: "direct" as const,
		renderSurfaceId: renderSurface.renderSurfaceId,
		width: renderSurface.width,
		height: renderSurface.height,
		sourceFormatRaw: renderSurface.formatRaw,
		hasSourceAlpha: hasSourceAlpha(renderSurface.formatRaw),
		samplingPolicy,
	};
	switch (renderSurface.formatRaw) {
		case PIXEL_FORMAT_R8G8B8:
		case PIXEL_FORMAT_CUSTOM_LANDSCAPE_R8G8B8:
			if (samplingPolicy.colorSpace === "srgb") {
				return {
					...base,
					data: decodeRgbToRgba(source, pixelCount),
					format: "rgba",
					dataType: "uint8",
					internalFormat: null,
				};
			}
			return {
				...base,
				data: copyRgbBytes(source, pixelCount),
				format: "rgb",
				dataType: "uint8",
				internalFormat: "rgb8",
			};
		case PIXEL_FORMAT_X8R8G8B8:
			if (samplingPolicy.colorSpace === "srgb") {
				return {
					...base,
					data: decodeX8R8G8B8ToRgba(source, pixelCount),
					format: "rgba",
					dataType: "uint8",
					internalFormat: null,
				};
			}
			return {
				...base,
				data: decodeX8R8G8B8ToRgb(source, pixelCount),
				format: "rgb",
				dataType: "uint8",
				internalFormat: "rgb8",
			};
		case PIXEL_FORMAT_A8R8G8B8:
			return {
				...base,
				data: decodeA8R8G8B8ToRgba(source, pixelCount),
				format: "rgba",
				dataType: "uint8",
				internalFormat: null,
			};
		case PIXEL_FORMAT_R5G6B5:
			return {
				...base,
				data: decodeR5G6B5ToRgb(source, pixelCount),
				format: "rgb",
				dataType: "uint8",
				internalFormat: "rgb8",
			};
		case PIXEL_FORMAT_A4R4G4B4:
			if (capabilities.supportsPackedRgba4444 !== false) {
				return {
					...base,
					data: decodeA4R4G4B4ToRgba4444(source, pixelCount),
					format: "rgba",
					dataType: "uint16-rgba4444",
					internalFormat: null,
				};
			}
			return {
				...base,
				data: decodeA4R4G4B4ToRgba8888(source, pixelCount),
				format: "rgba",
				dataType: "uint8",
				internalFormat: null,
			};
		case PIXEL_FORMAT_A8:
		case PIXEL_FORMAT_CUSTOM_LANDSCAPE_ALPHA:
			if (samplingPolicy.colorSpace === "srgb") {
				return {
					...base,
					data: decodeA8ToRgba(source, pixelCount),
					format: "rgba",
					dataType: "uint8",
					internalFormat: null,
				};
			}
			return {
				...base,
				data: copyAlphaBytes(source, pixelCount),
				format: "red",
				dataType: "uint8",
				internalFormat: "r8",
			};
		default:
			throw new Error(
				`Unsupported direct-color RenderSurface format ${renderSurface.formatRaw}.`,
			);
	}
}

function copyRgbBytes(source: Uint8Array, pixelCount: number): Uint8Array {
	const rgb = new Uint8Array(pixelCount * 3);
	rgb.set(source);
	return rgb;
}

function decodeRgbToRgba(source: Uint8Array, pixelCount: number): Uint8Array {
	const rgba = new Uint8Array(pixelCount * 4);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const sourceOffset = pixel * 3;
		const targetOffset = pixel * 4;
		rgba[targetOffset] = source[sourceOffset] ?? 0;
		rgba[targetOffset + 1] = source[sourceOffset + 1] ?? 0;
		rgba[targetOffset + 2] = source[sourceOffset + 2] ?? 0;
		rgba[targetOffset + 3] = FULL_ALPHA;
	}
	return rgba;
}

function decodeX8R8G8B8ToRgb(
	source: Uint8Array,
	pixelCount: number,
): Uint8Array {
	const rgb = new Uint8Array(pixelCount * 3);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const sourceOffset = pixel * 4;
		const targetOffset = pixel * 3;
		rgb[targetOffset] = source[sourceOffset + 2] ?? 0;
		rgb[targetOffset + 1] = source[sourceOffset + 1] ?? 0;
		rgb[targetOffset + 2] = source[sourceOffset] ?? 0;
	}
	return rgb;
}

function decodeX8R8G8B8ToRgba(
	source: Uint8Array,
	pixelCount: number,
): Uint8Array {
	const rgba = new Uint8Array(pixelCount * 4);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const sourceOffset = pixel * 4;
		const targetOffset = pixel * 4;
		rgba[targetOffset] = source[sourceOffset + 2] ?? 0;
		rgba[targetOffset + 1] = source[sourceOffset + 1] ?? 0;
		rgba[targetOffset + 2] = source[sourceOffset] ?? 0;
		rgba[targetOffset + 3] = FULL_ALPHA;
	}
	return rgba;
}

function decodeA8R8G8B8ToRgba(
	source: Uint8Array,
	pixelCount: number,
): Uint8Array {
	const rgba = new Uint8Array(pixelCount * 4);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const sourceOffset = pixel * 4;
		const targetOffset = pixel * 4;
		rgba[targetOffset] = source[sourceOffset + 2] ?? 0;
		rgba[targetOffset + 1] = source[sourceOffset + 1] ?? 0;
		rgba[targetOffset + 2] = source[sourceOffset] ?? 0;
		rgba[targetOffset + 3] = source[sourceOffset + 3] ?? FULL_ALPHA;
	}
	return rgba;
}

function decodeR5G6B5ToRgb(source: Uint8Array, pixelCount: number): Uint8Array {
	const rgb = new Uint8Array(pixelCount * 3);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const sourceOffset = pixel * 2;
		const targetOffset = pixel * 3;
		const value =
			(source[sourceOffset] ?? 0) | ((source[sourceOffset + 1] ?? 0) << 8);
		rgb[targetOffset] = scaleBitsToByte(
			(value >> R5G6B5_RED_SHIFT) & R5G6B5_RED_MASK,
			5,
		);
		rgb[targetOffset + 1] = scaleBitsToByte(
			(value >> R5G6B5_GREEN_SHIFT) & R5G6B5_GREEN_MASK,
			6,
		);
		rgb[targetOffset + 2] = scaleBitsToByte(value & R5G6B5_BLUE_MASK, 5);
	}
	return rgb;
}

function decodeA4R4G4B4ToRgba4444(
	source: Uint8Array,
	pixelCount: number,
): Uint16Array {
	const rgba4444 = new Uint16Array(pixelCount);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const sourceOffset = pixel * 2;
		const value =
			(source[sourceOffset] ?? 0) | ((source[sourceOffset + 1] ?? 0) << 8);
		const alpha = (value >> A4R4G4B4_ALPHA_SHIFT) & A4R4G4B4_CHANNEL_MASK;
		const red = (value >> A4R4G4B4_RED_SHIFT) & A4R4G4B4_CHANNEL_MASK;
		const green = (value >> A4R4G4B4_GREEN_SHIFT) & A4R4G4B4_CHANNEL_MASK;
		const blue = value & A4R4G4B4_CHANNEL_MASK;
		rgba4444[pixel] =
			(red << A4R4G4B4_ALPHA_SHIFT) |
			(green << A4R4G4B4_RED_SHIFT) |
			(blue << A4R4G4B4_GREEN_SHIFT) |
			alpha;
	}
	return rgba4444;
}

function decodeA4R4G4B4ToRgba8888(
	source: Uint8Array,
	pixelCount: number,
): Uint8Array {
	const rgba = new Uint8Array(pixelCount * 4);
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
		rgba[targetOffset + 2] = scaleBitsToByte(value & A4R4G4B4_CHANNEL_MASK, 4);
		rgba[targetOffset + 3] = scaleBitsToByte(
			(value >> A4R4G4B4_ALPHA_SHIFT) & A4R4G4B4_CHANNEL_MASK,
			4,
		);
	}
	return rgba;
}

function copyAlphaBytes(source: Uint8Array, pixelCount: number): Uint8Array {
	const alpha = new Uint8Array(pixelCount);
	alpha.set(source);
	return alpha;
}

function decodeA8ToRgba(source: Uint8Array, pixelCount: number): Uint8Array {
	const rgba = new Uint8Array(pixelCount * 4);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const targetOffset = pixel * 4;
		const value = source[pixel] ?? 0;
		rgba[targetOffset] = value;
		rgba[targetOffset + 1] = value;
		rgba[targetOffset + 2] = value;
		rgba[targetOffset + 3] = FULL_ALPHA;
	}
	return rgba;
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
		case PIXEL_FORMAT_CUSTOM_LANDSCAPE_ALPHA:
			return 1;
		default:
			return null;
	}
}

function compressedTextureFormat(
	formatRaw: number,
): CompressedRenderSurfaceUploadFormat | null {
	switch (formatRaw) {
		case PIXEL_FORMAT_DXT1:
			return "s3tc-dxt1-rgba";
		case PIXEL_FORMAT_DXT3:
			return "s3tc-dxt3-rgba";
		case PIXEL_FORMAT_DXT5:
			return "s3tc-dxt5-rgba";
		default:
			return null;
	}
}

function expectedCompressedLevelByteLength(options: {
	width: number;
	height: number;
	formatRaw: number;
}): number {
	const bytesPerBlock = compressedBytesPerBlock(options.formatRaw);
	if (bytesPerBlock === null) {
		throw new Error(
			`Format ${options.formatRaw} is not a compressed upload format.`,
		);
	}
	return (
		Math.floor((options.width + 3) / 4) *
		Math.floor((options.height + 3) / 4) *
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
