import type {
	PreparedRenderSurfacePayload,
	PreparedTexturePayload,
} from "./types";
import { formatPreparedTextureAssetId, preparedDxtOutputFormat } from "./types";

export type LumaMaterialTextureUsage = PreparedTexturePayload["usage"];

export interface LumaMaterialTexturePreparationPolicyInput {
	renderSurface: PreparedRenderSurfacePayload;
	usage: LumaMaterialTextureUsage;
}

export type LumaMaterialTexturePreparationPolicy = (
	input: LumaMaterialTexturePreparationPolicyInput,
) => readonly string[];

const PIXEL_FORMAT_R8G8B8 = 0x14;
const PIXEL_FORMAT_A8R8G8B8 = 0x15;
const PIXEL_FORMAT_X8R8G8B8 = 0x16;
const PIXEL_FORMAT_R5G6B5 = 0x17;
const PIXEL_FORMAT_A4R4G4B4 = 0x1a;
const PIXEL_FORMAT_A8 = 0x1c;
const PIXEL_FORMAT_CUSTOM_LANDSCAPE_R8G8B8 = 0xf3;
const PIXEL_FORMAT_CUSTOM_LANDSCAPE_ALPHA = 0xf4;

export const DEFAULT_MATERIAL_TEXTURE_PREPARATION_POLICY: LumaMaterialTexturePreparationPolicy =
	({ renderSurface, usage }) => {
		const outputFormat = preparedDxtOutputFormat(renderSurface.formatRaw);
		if (!outputFormat) {
			return [];
		}
		return [
			formatPreparedTextureAssetId({
				renderSurfaceId: renderSurface.renderSurfaceId,
				usage,
				outputFormat,
				mipPolicy: "retail4",
				colorSpace: "source",
			}),
		];
	};

export const LUMA_MATERIAL_TEXTURE_PREPARATION_POLICY: LumaMaterialTexturePreparationPolicy =
	({ renderSurface, usage }) => {
		if (isSingleChannelTextureUsage(usage)) {
			if (!isSingleChannelRenderSurfaceFormat(renderSurface.formatRaw)) {
				return [];
			}
			return [
				formatPreparedTextureAssetId({
					renderSurfaceId: renderSurface.renderSurfaceId,
					usage,
					outputFormat: "r8",
					mipPolicy: "none",
					colorSpace: "data",
				}),
			];
		}

		if (!isBaseColorTextureUsage(usage)) {
			return [];
		}
		if (!isNonIndexedColorRenderSurfaceFormat(renderSurface.formatRaw)) {
			return [];
		}
		return [
			formatPreparedTextureAssetId({
				renderSurfaceId: renderSurface.renderSurfaceId,
				usage,
				outputFormat: "rgba8",
				mipPolicy: "none",
				colorSpace: "linear",
			}),
		];
	};

export function resolveLumaPreparedTextureAssetIds(input: {
	renderSurface: PreparedRenderSurfacePayload;
	usage?: LumaMaterialTextureUsage;
}): readonly string[] {
	return LUMA_MATERIAL_TEXTURE_PREPARATION_POLICY({
		renderSurface: input.renderSurface,
		usage: input.usage ?? "raw",
	});
}

export function resolveDefaultPreparedTextureAssetIds(input: {
	renderSurface: PreparedRenderSurfacePayload;
	usage?: LumaMaterialTextureUsage;
}): readonly string[] {
	return DEFAULT_MATERIAL_TEXTURE_PREPARATION_POLICY({
		renderSurface: input.renderSurface,
		usage: input.usage ?? "raw",
	});
}

function isBaseColorTextureUsage(usage: LumaMaterialTextureUsage): boolean {
	return usage === "raw" || usage === "color";
}

function isSingleChannelTextureUsage(usage: LumaMaterialTextureUsage): boolean {
	return usage === "detail" || usage === "mask";
}

function isNonIndexedColorRenderSurfaceFormat(formatRaw: number): boolean {
	switch (formatRaw) {
		case PIXEL_FORMAT_R8G8B8:
		case PIXEL_FORMAT_A8R8G8B8:
		case PIXEL_FORMAT_X8R8G8B8:
		case PIXEL_FORMAT_R5G6B5:
		case PIXEL_FORMAT_A4R4G4B4:
		case PIXEL_FORMAT_A8:
		case PIXEL_FORMAT_CUSTOM_LANDSCAPE_R8G8B8:
		case PIXEL_FORMAT_CUSTOM_LANDSCAPE_ALPHA:
			return true;
		default:
			return preparedDxtOutputFormat(formatRaw) !== null;
	}
}

function isSingleChannelRenderSurfaceFormat(formatRaw: number): boolean {
	return (
		formatRaw === PIXEL_FORMAT_A8 ||
		formatRaw === PIXEL_FORMAT_CUSTOM_LANDSCAPE_ALPHA
	);
}
