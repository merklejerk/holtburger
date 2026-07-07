import { createHostAssetKey } from "../keys";
import type { HostAssetKey, PreparedAsset } from "../contracts";
import type {
	PreparedPaletteTexturePayloadDto,
	PreparedTexturePayloadDto,
} from "../../../lib/host/contracts";
import { preparedPaletteTexturePayloadDtoSchema } from "../../../lib/host/contracts";
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
	readonly height: number;
	readonly contentHash: string;
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

export function createPreparedPaletteTextureHostKey(
	source: Extract<
		MaterialTextureDataUseIdentity,
		{ readonly kind: "prepared-palette-texture-use" }
	>,
): HostAssetKey {
	const replacements =
		source.replacements.length === 0
			? ""
			: `&repl=${source.replacements
					.map(
						(replacement) =>
							`${formatPaletteId(replacement.palette.paletteId)}:${replacement.offset}:${replacement.count}`,
					)
					.join(",")}`;
	return createHostAssetKey(
		"prepared-palette-texture",
		`${formatPaletteId(source.palette.paletteId)}?domain=${source.domain}${replacements}`,
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
	if (expectedUse.kind === "prepared-palette-texture-use") {
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
		{ readonly kind: "prepared-palette-texture-use" }
	>,
): DirectPaletteTextureSource {
	const payload = preparedPaletteTexturePayloadDtoSchema.parse(
		prepared.payload,
	);
	const expectedPalette = expectedUse.palette.paletteId;
	if (payload.basePaletteId !== expectedPalette) {
		throw new Error(
			`Prepared palette texture ${formatPaletteId(payload.basePaletteId)} does not match requested palette ${formatPaletteId(expectedPalette)}.`,
		);
	}
	if (payload.domain !== expectedUse.domain) {
		throw new Error(
			`Prepared palette texture ${formatPaletteId(expectedPalette)} domain ${payload.domain} does not match requested ${expectedUse.domain}.`,
		);
	}
	if (payload.width !== payload.height) {
		throw new Error(
			`Prepared palette texture ${formatPaletteId(expectedPalette)} expected a square payload, got ${payload.width}x${payload.height}.`,
		);
	}
	const expectedByteLength = payload.width * payload.height * 4;
	if (payload.pixels.byteLength !== expectedByteLength) {
		throw new Error(
			`Prepared palette texture ${formatPaletteId(expectedPalette)} expected ${expectedByteLength} rgba8 bytes, got ${payload.pixels.byteLength}.`,
		);
	}
	assertSamePreparedPaletteReplacements(expectedUse, payload);

	return {
		contentHash: payload.contentHash,
		height: payload.height,
		kind: "direct-palette-texture-source",
		outputFormat: "rgba8",
		paletteId: expectedPalette,
		pixels: payload.pixels,
		usage: "palette-rgba",
		width: payload.width,
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
		throw new Error(
			`Prepared index usage ${usage} resolved to ${policy.outputFormat}.`,
		);
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
			return {
				colorSpace: "linear",
				hostUsage: "color",
				outputFormat: "rgba8",
			};
		case "rgba-detail":
			return {
				colorSpace: "linear",
				hostUsage: "detail",
				outputFormat: "rgba8",
			};
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

function assertSamePreparedPaletteReplacements(
	expectedUse: Extract<
		MaterialTextureDataUseIdentity,
		{ readonly kind: "prepared-palette-texture-use" }
	>,
	payload: PreparedPaletteTexturePayloadDto,
): void {
	if (expectedUse.replacements.length !== payload.replacements.length) {
		throw new Error(
			`Prepared palette texture ${formatPaletteId(expectedUse.palette.paletteId)} replacement count ${payload.replacements.length} does not match requested ${expectedUse.replacements.length}.`,
		);
	}
	for (const [index, expected] of expectedUse.replacements.entries()) {
		const actual = payload.replacements[index];
		if (
			!actual ||
			actual.paletteId !== expected.palette.paletteId ||
			actual.offset !== expected.offset ||
			actual.count !== expected.count
		) {
			throw new Error(
				`Prepared palette texture ${formatPaletteId(expectedUse.palette.paletteId)} replacement ${index} does not match requested recipe.`,
			);
		}
	}
}

function formatPaletteId(paletteId: PaletteIdentity["paletteId"]): string {
	return paletteId.toString(16).padStart(8, "0");
}
