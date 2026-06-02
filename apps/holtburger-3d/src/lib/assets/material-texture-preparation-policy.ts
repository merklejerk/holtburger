import type {
	PreparedRenderSurfacePayload,
	PreparedTexturePayload,
} from "./types";
import { formatPreparedTextureAssetId, preparedDxtOutputFormat } from "./types";

export type MaterialTextureUsage = PreparedTexturePayload["usage"];

interface MaterialTexturePreparationPolicyInput {
	renderSurface: PreparedRenderSurfacePayload;
	usage: MaterialTextureUsage;
}

export type MaterialTexturePreparationPolicy = (
	input: MaterialTexturePreparationPolicyInput,
) => readonly string[];

const PIXEL_FORMAT_R8G8B8 = 0x14;
const PIXEL_FORMAT_A8R8G8B8 = 0x15;
const PIXEL_FORMAT_X8R8G8B8 = 0x16;
const PIXEL_FORMAT_R5G6B5 = 0x17;
const PIXEL_FORMAT_A4R4G4B4 = 0x1a;
const PIXEL_FORMAT_A8 = 0x1c;
const PIXEL_FORMAT_CUSTOM_LANDSCAPE_R8G8B8 = 0xf3;
const PIXEL_FORMAT_CUSTOM_LANDSCAPE_ALPHA = 0xf4;

export const DEFAULT_MATERIAL_TEXTURE_PREPARATION_POLICY: MaterialTexturePreparationPolicy =
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

export const NORMALIZED_MATERIAL_TEXTURE_PREPARATION_POLICY: MaterialTexturePreparationPolicy =
	({ renderSurface, usage }) => {
		if (isMaskTextureUsage(usage)) {
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

export function resolveNormalizedPreparedTextureAssetIds(input: {
	renderSurface: PreparedRenderSurfacePayload;
	usage?: MaterialTextureUsage;
}): readonly string[] {
	return NORMALIZED_MATERIAL_TEXTURE_PREPARATION_POLICY({
		renderSurface: input.renderSurface,
		usage: input.usage ?? "raw",
	});
}

function isBaseColorTextureUsage(usage: MaterialTextureUsage): boolean {
	return usage === "raw" || usage === "color" || usage === "detail";
}

function isMaskTextureUsage(usage: MaterialTextureUsage): boolean {
	return usage === "mask";
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
