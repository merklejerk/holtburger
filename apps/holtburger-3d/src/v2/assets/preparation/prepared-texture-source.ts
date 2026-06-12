import { createHostAssetKey } from "../keys";
import type { HostAssetKey, PreparedAsset } from "../contracts";
import type { PreparedTexturePayloadDto } from "../../../lib/host/contracts";
import { palettePayloadDtoSchema } from "../../../lib/host/contracts";
import type {
	MaterialTextureDataUseIdentity,
	PaletteIdentity,
	PreparedIndexRenderSurfaceTextureUseIdentity,
	PreparedRgbaRenderSurfaceTextureUseIdentity,
	PreparedRgbaRenderSurfaceTextureUsage,
	PreparedRenderSurfaceTextureUseIdentity,
} from "../../static/contracts";

const PIXEL_FORMAT_P8 = 0x29;
const PIXEL_FORMAT_INDEX16 = 0x65;

export interface DirectRgbaTextureSource {
	readonly kind: "direct-rgba-texture-source";
	readonly renderSurfaceId: number;
	readonly usage: PreparedRgbaRenderSurfaceTextureUsage;
	readonly outputFormat: "rgba8";
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array;
}

export interface DirectIndexTextureSource {
	readonly kind: "direct-index-texture-source";
	readonly renderSurfaceId: number;
	readonly usage: "index8" | "index16";
	readonly outputFormat: "r8" | "index16";
	readonly width: number;
	readonly height: number;
	readonly bytesPerIndex: 1 | 2;
	readonly indices: Uint8Array;
}

export interface DirectPaletteTextureSource {
	readonly kind: "direct-palette-texture-source";
	readonly paletteId: number;
	readonly usage: "palette-rgba";
	readonly outputFormat: "rgba8";
	readonly width: number;
	readonly height: 1;
	readonly firstIndex: number;
	readonly indexCount: number;
	readonly pixels: Uint8Array;
}

export type DirectMaterialTextureSource =
	| DirectIndexTextureSource
	| DirectPaletteTextureSource
	| DirectRgbaTextureSource;

export function createPreparedTextureHostKey(
	source: PreparedRenderSurfaceTextureUseIdentity,
): HostAssetKey {
	const policy = getPreparedTextureHostPolicy(source.usage);
	const query = new URLSearchParams({
		cs: policy.colorSpace,
		mips: "none",
		out: policy.outputFormat,
		usage: policy.hostUsage,
	});

	return createHostAssetKey(
		"prepared-texture",
		`${source.renderSurface.renderSurfaceId.toString(16).padStart(8, "0")}?${query.toString()}`,
	);
}

export function prepareDirectRgbaTextureSource(
	prepared: PreparedAsset,
	expectedUse: PreparedRgbaRenderSurfaceTextureUseIdentity,
): DirectRgbaTextureSource {
	const payload = parsePreparedTexturePayload(prepared.payload, expectedUse);
	if (
		payload.outputFormat !== "rgba8" ||
		payload.mipPolicy !== "none" ||
		payload.colorSpace !== "linear"
	) {
		throw new Error(
			`Prepared texture ${formatRenderSurfaceId(expectedUse.renderSurface.renderSurfaceId)} uses unsupported direct texture policy ${payload.outputFormat}/${payload.mipPolicy}/${payload.colorSpace}. Only rgba8/none/linear is supported for direct texture sources.`,
		);
	}

	const levelZero = payload.levels.find((level) => level.level === 0);
	if (!levelZero) {
		throw new Error(
			`Prepared texture ${formatRenderSurfaceId(expectedUse.renderSurface.renderSurfaceId)} has no mip level 0.`,
		);
	}

	const expectedByteLength = levelZero.width * levelZero.height * 4;
	if (levelZero.bytes.byteLength !== expectedByteLength) {
		throw new Error(
			`Prepared texture ${formatRenderSurfaceId(expectedUse.renderSurface.renderSurfaceId)} expected ${expectedByteLength} rgba8 bytes, got ${levelZero.bytes.byteLength}.`,
		);
	}

	return {
		height: levelZero.height,
		kind: "direct-rgba-texture-source",
		outputFormat: "rgba8",
		pixels: levelZero.bytes,
		renderSurfaceId: payload.renderSurfaceId,
		usage: expectedUse.usage,
		width: levelZero.width,
	};
}

export function prepareDirectIndexTextureSource(
	prepared: PreparedAsset,
	expectedUse: PreparedIndexRenderSurfaceTextureUseIdentity,
): DirectIndexTextureSource {
	const payload = parsePreparedTexturePayload(prepared.payload, expectedUse);
	const policy = getPreparedIndexHostPolicy(expectedUse.usage);
	if (
		payload.outputFormat !== policy.outputFormat ||
		payload.mipPolicy !== "none" ||
		payload.colorSpace !== "data"
	) {
		throw new Error(
			`Prepared texture ${formatRenderSurfaceId(expectedUse.renderSurface.renderSurfaceId)} uses unsupported index texture policy ${payload.outputFormat}/${payload.mipPolicy}/${payload.colorSpace}. Only ${policy.outputFormat}/none/data is supported for ${expectedUse.usage} sources.`,
		);
	}

	if (!isExpectedIndexSourceFormat(payload, expectedUse.usage)) {
		throw new Error(
			`Prepared texture ${formatRenderSurfaceId(expectedUse.renderSurface.renderSurfaceId)} source format ${payload.sourceFormat}/${payload.sourceFormatRaw} does not match ${expectedUse.usage}.`,
		);
	}

	const levelZero = payload.levels.find((level) => level.level === 0);
	if (!levelZero) {
		throw new Error(
			`Prepared texture ${formatRenderSurfaceId(expectedUse.renderSurface.renderSurfaceId)} has no mip level 0.`,
		);
	}

	const bytesPerIndex = expectedUse.usage === "index16" ? 2 : 1;
	const expectedByteLength = levelZero.width * levelZero.height * bytesPerIndex;
	if (levelZero.bytes.byteLength !== expectedByteLength) {
		throw new Error(
			`Prepared texture ${formatRenderSurfaceId(expectedUse.renderSurface.renderSurfaceId)} expected ${expectedByteLength} ${expectedUse.usage} bytes, got ${levelZero.bytes.byteLength}.`,
		);
	}

	return {
		bytesPerIndex,
		height: levelZero.height,
		indices: levelZero.bytes,
		kind: "direct-index-texture-source",
		outputFormat: policy.outputFormat,
		renderSurfaceId: payload.renderSurfaceId,
		usage: expectedUse.usage,
		width: levelZero.width,
	};
}

export function prepareDirectMaterialTextureSource(
	prepared: PreparedAsset,
	expectedUse: MaterialTextureDataUseIdentity,
): DirectMaterialTextureSource {
	if (expectedUse.kind === "palette-texture-use") {
		return prepareDirectPaletteTextureSource(prepared, expectedUse);
	}

	if (isPreparedIndexTextureUse(expectedUse)) {
		return prepareDirectIndexTextureSource(prepared, expectedUse);
	}

	if (isPreparedRgbaTextureUse(expectedUse)) {
		return prepareDirectRgbaTextureSource(prepared, expectedUse);
	}

	throw new Error(
		`Prepared texture use ${expectedUse.kind}:${expectedUse.usage} is not stageable.`,
	);
}

export function prepareDirectPaletteTextureSource(
	prepared: PreparedAsset,
	expectedUse: Extract<
		MaterialTextureDataUseIdentity,
		{ readonly kind: "palette-texture-use" }
	>,
): DirectPaletteTextureSource {
	const payload = palettePayloadDtoSchema.parse(prepared.payload);
	const expectedPalette = expectedUse.palette.paletteId;
	if (payload.paletteId !== expectedPalette) {
		throw new Error(
			`Palette payload ${formatPaletteId(payload.paletteId)} does not match requested palette ${formatPaletteId(expectedPalette)}.`,
		);
	}

	const firstIndex = expectedUse.firstIndex;
	const indexCount = expectedUse.indexCount;
	const lastIndexExclusive = firstIndex + indexCount;
	if (
		firstIndex < 0 ||
		indexCount <= 0 ||
		lastIndexExclusive > payload.colorsArgb.length
	) {
		throw new Error(
			`Palette ${formatPaletteId(expectedPalette)} range ${firstIndex}+${indexCount} exceeds ${payload.colorsArgb.length} colors.`,
		);
	}

	return {
		firstIndex,
		height: 1,
		indexCount,
		kind: "direct-palette-texture-source",
		outputFormat: "rgba8",
		paletteId: expectedPalette,
		pixels: paletteArgbToRgbaBytes(
			payload.colorsArgb.subarray(firstIndex, lastIndexExclusive),
		),
		usage: "palette-rgba",
		width: indexCount,
	};
}

function getPreparedIndexHostPolicy(
	usage: PreparedIndexRenderSurfaceTextureUseIdentity["usage"],
): {
	readonly hostUsage: PreparedTexturePayloadDto["usage"];
	readonly outputFormat: DirectIndexTextureSource["outputFormat"];
	readonly colorSpace: "data";
} {
	const policy = getPreparedTextureHostPolicy(usage);
	if (policy.outputFormat !== "r8" && policy.outputFormat !== "index16") {
		throw new Error(`Prepared index usage ${usage} resolved to ${policy.outputFormat}.`);
	}

	return {
		colorSpace: "data",
		hostUsage: policy.hostUsage,
		outputFormat: policy.outputFormat,
	};
}

function parsePreparedTexturePayload(
	payload: unknown,
	expectedUse: PreparedRenderSurfaceTextureUseIdentity,
): PreparedTexturePayloadDto {
	const policy = getPreparedTextureHostPolicy(expectedUse.usage);
	if (
		typeof payload !== "object" ||
		payload === null ||
		(payload as { kind?: unknown }).kind !== "prepared-texture"
	) {
		throw new Error(
			`Prepared texture payload for render surface ${formatRenderSurfaceId(expectedUse.renderSurface.renderSurfaceId)} is not a prepared-texture payload.`,
		);
	}

	const candidate = payload as PreparedTexturePayloadDto;
	if (
		candidate.renderSurfaceId !== expectedUse.renderSurface.renderSurfaceId ||
		candidate.usage !== policy.hostUsage ||
		candidate.outputFormat !== policy.outputFormat
	) {
		throw new Error(
			`Prepared texture payload for render surface ${formatRenderSurfaceId(expectedUse.renderSurface.renderSurfaceId)} does not match the requested texture-use policy.`,
		);
	}

	return candidate;
}

function getPreparedTextureHostPolicy(
	usage: PreparedRenderSurfaceTextureUseIdentity["usage"],
): {
	readonly hostUsage: PreparedTexturePayloadDto["usage"];
	readonly outputFormat: PreparedTexturePayloadDto["outputFormat"];
	readonly colorSpace: PreparedTexturePayloadDto["colorSpace"];
} {
	switch (usage) {
		case "rgba-color":
			return { colorSpace: "linear", hostUsage: "color", outputFormat: "rgba8" };
		case "rgba-detail":
			return { colorSpace: "linear", hostUsage: "detail", outputFormat: "rgba8" };
		case "rgba-mask":
			return { colorSpace: "linear", hostUsage: "mask", outputFormat: "rgba8" };
		case "rgba-raw":
			return { colorSpace: "linear", hostUsage: "raw", outputFormat: "rgba8" };
		case "index8":
			return { colorSpace: "data", hostUsage: "raw", outputFormat: "r8" };
		case "index16":
			return { colorSpace: "data", hostUsage: "raw", outputFormat: "index16" };
	}
}

function isExpectedIndexSourceFormat(
	payload: PreparedTexturePayloadDto,
	usage: PreparedIndexRenderSurfaceTextureUseIdentity["usage"],
): boolean {
	if (usage === "index8") {
		return payload.sourceFormatRaw === PIXEL_FORMAT_P8;
	}

	return payload.sourceFormatRaw === PIXEL_FORMAT_INDEX16;
}

function formatRenderSurfaceId(renderSurfaceId: number): string {
	return renderSurfaceId.toString(16).padStart(8, "0");
}

function isPreparedIndexTextureUse(
	use: PreparedRenderSurfaceTextureUseIdentity,
): use is PreparedIndexRenderSurfaceTextureUseIdentity {
	return use.usage === "index8" || use.usage === "index16";
}

function isPreparedRgbaTextureUse(
	use: PreparedRenderSurfaceTextureUseIdentity,
): use is PreparedRgbaRenderSurfaceTextureUseIdentity {
	return (
		use.usage === "rgba-color" ||
		use.usage === "rgba-detail" ||
		use.usage === "rgba-mask" ||
		use.usage === "rgba-raw"
	);
}

function formatPaletteId(paletteId: PaletteIdentity["paletteId"]): string {
	return paletteId.toString(16).padStart(8, "0");
}

function paletteArgbToRgbaBytes(colorsArgb: Uint32Array): Uint8Array {
	const pixels = new Uint8Array(colorsArgb.length * 4);
	for (let index = 0; index < colorsArgb.length; index += 1) {
		const argb = colorsArgb[index] ?? 0;
		const offset = index * 4;
		pixels[offset] = (argb >>> 16) & 0xff;
		pixels[offset + 1] = (argb >>> 8) & 0xff;
		pixels[offset + 2] = argb & 0xff;
		pixels[offset + 3] = (argb >>> 24) & 0xff;
	}
	return pixels;
}
