import type {
	PreparedAssetRecord,
	PreparedPalettePayload,
} from "../assets/types";
import { formatHex32 } from "../landblocks";
import type {
	MaterialAppearancePaletteView,
	MaterialAppearanceSubPalette,
} from "./material-appearance";

const RGBA_COMPONENT_COUNT = 4;

export interface PaletteData {
	paletteAssetId: string;
	paletteId: number;
	colorCount: number;
	colorsArgb: Uint32Array;
	colorsRgba: Uint8Array;
}

export interface DerivedPaletteData extends PaletteData {
	basePaletteAssetId: string;
	basePaletteId: number;
	paletteView: MaterialAppearancePaletteView;
	subPaletteAssetIds: readonly string[];
	key: string;
}

interface PaletteDataDiagnostic {
	key: string;
	message: string;
	detail: Record<string, unknown>;
}

export type PaletteDataDiagnosticHandler = (
	diagnostic: PaletteDataDiagnostic,
) => void;

export interface PaletteAssetLookup {
	get(assetId: string): PreparedAssetRecord | null;
}

export function createPaletteData(options: {
	paletteAssetId: string;
	palette: PreparedPalettePayload;
}): PaletteData {
	if (options.palette.colorCount !== options.palette.colorsArgb.length) {
		throw new Error(
			`Palette ${options.paletteAssetId} declares ${options.palette.colorCount} colors but carries ${options.palette.colorsArgb.length}.`,
		);
	}
	const colorsArgb = new Uint32Array(options.palette.colorsArgb);
	return {
		paletteAssetId: options.paletteAssetId,
		paletteId: options.palette.paletteId,
		colorCount: options.palette.colorCount,
		colorsArgb,
		colorsRgba: argbToRgbaBytes(colorsArgb),
	};
}

export function createDerivedPaletteData(options: {
	basePaletteAssetId: string;
	basePalette: PreparedPalettePayload;
	paletteView: MaterialAppearancePaletteView;
	preparedByAssetId?: Readonly<Record<string, PreparedAssetRecord>>;
	assetLookup?: PaletteAssetLookup;
	reportDiagnostic: PaletteDataDiagnosticHandler;
}): DerivedPaletteData | null {
	const assetLookup =
		options.assetLookup ??
		createPaletteAssetLookupFromRecord(options.preparedByAssetId ?? {});
	const colorsArgb = new Uint32Array(options.basePalette.colorsArgb);
	for (const subPalette of options.paletteView.subPalettes) {
		const subPaletteAssetId = formatPaletteAssetId(subPalette.subId);
		const subPaletteAsset = assetLookup.get(subPaletteAssetId);
		if (subPaletteAsset?.payload.kind !== "palette") {
			options.reportDiagnostic({
				key: `derived-palette-subpalette-unprepared:${options.basePaletteAssetId}:${subPaletteAssetId}`,
				message: `Cannot create derived palette because subpalette ${subPaletteAssetId} is not prepared.`,
				detail: {
					basePaletteAssetId: options.basePaletteAssetId,
					subPaletteAssetId,
					preparedKind: subPaletteAsset?.payload.kind ?? null,
				},
			});
			return null;
		}
		if (
			!isValidSubPaletteRange({
				baseColorCount: colorsArgb.length,
				subPaletteColorCount: subPaletteAsset.payload.colorCount,
				subPalette,
			})
		) {
			options.reportDiagnostic({
				key: `derived-palette-invalid-range:${options.basePaletteAssetId}:${subPaletteAssetId}:${subPalette.offset}:${subPalette.numColors}`,
				message: `Cannot create derived palette because subpalette ${subPaletteAssetId} range ${subPalette.offset}+${subPalette.numColors} is invalid for ${options.basePaletteAssetId}.`,
				detail: {
					basePaletteAssetId: options.basePaletteAssetId,
					baseColorCount: colorsArgb.length,
					subPaletteAssetId,
					subPaletteColorCount: subPaletteAsset.payload.colorCount,
					offset: subPalette.offset,
					numColors: subPalette.numColors,
				},
			});
			return null;
		}
		colorsArgb.set(
			subPaletteAsset.payload.colorsArgb.subarray(
				subPalette.offset,
				subPalette.offset + subPalette.numColors,
			),
			subPalette.offset,
		);
	}

	return {
		...createPaletteData({
			paletteAssetId: options.basePaletteAssetId,
			palette: {
				...options.basePalette,
				colorsArgb,
			},
		}),
		basePaletteAssetId: options.basePaletteAssetId,
		basePaletteId: options.basePalette.paletteId,
		paletteView: {
			paletteId: options.paletteView.paletteId,
			subPalettes: options.paletteView.subPalettes.map((subPalette) => ({
				...subPalette,
			})),
		},
		subPaletteAssetIds: options.paletteView.subPalettes.map((subPalette) =>
			formatPaletteAssetId(subPalette.subId),
		),
		key: describeDerivedPaletteDataKey({
			basePaletteAssetId: options.basePaletteAssetId,
			basePaletteAsset: findRequiredPreparedAsset(
				assetLookup,
				options.basePaletteAssetId,
			),
			paletteView: options.paletteView,
			assetLookup,
		}),
	};
}

export function describeDerivedPaletteDataKey(options: {
	basePaletteAssetId: string;
	basePaletteAsset: PreparedAssetRecord | undefined;
	paletteView: MaterialAppearancePaletteView;
	preparedByAssetId?: Readonly<Record<string, PreparedAssetRecord>>;
	assetLookup?: PaletteAssetLookup;
}): string {
	const assetLookup =
		options.assetLookup ??
		createPaletteAssetLookupFromRecord(options.preparedByAssetId ?? {});
	return [
		describePaletteAssetPreparedState(
			options.basePaletteAssetId,
			options.basePaletteAsset,
		),
		`override=${options.paletteView.paletteId === null ? "material" : formatHex32(options.paletteView.paletteId)}`,
		...options.paletteView.subPalettes.map((subPalette) =>
			[
				formatPaletteAssetId(subPalette.subId),
				subPalette.offset,
				subPalette.numColors,
				describePaletteAssetPreparedState(
					formatPaletteAssetId(subPalette.subId),
					assetLookup.get(formatPaletteAssetId(subPalette.subId)) ??
						undefined,
				),
			].join(":"),
		),
	].join("|");
}

function argbToRgbaBytes(colorsArgb: Uint32Array): Uint8Array {
	if (colorsArgb.length === 0) {
		throw new Error("Palette textures require at least one color.");
	}

	const colorsRgba = new Uint8Array(colorsArgb.length * RGBA_COMPONENT_COUNT);
	for (let index = 0; index < colorsArgb.length; index += 1) {
		const argb = colorsArgb[index] as number;
		const offset = index * RGBA_COMPONENT_COUNT;
		colorsRgba[offset] = (argb >>> 16) & 0xff;
		colorsRgba[offset + 1] = (argb >>> 8) & 0xff;
		colorsRgba[offset + 2] = argb & 0xff;
		colorsRgba[offset + 3] = (argb >>> 24) & 0xff;
	}
	return colorsRgba;
}

export function formatPaletteAssetId(paletteId: number): string {
	return `palette/${formatHex32(paletteId)}`;
}

function isValidSubPaletteRange(options: {
	baseColorCount: number;
	subPaletteColorCount: number;
	subPalette: MaterialAppearanceSubPalette;
}): boolean {
	return (
		options.subPalette.offset >= 0 &&
		options.subPalette.numColors > 0 &&
		options.subPalette.offset + options.subPalette.numColors <=
			options.baseColorCount &&
		options.subPalette.offset + options.subPalette.numColors <=
			options.subPaletteColorCount
	);
}

function describePaletteAssetPreparedState(
	assetId: string,
	asset: PreparedAssetRecord | undefined,
): string {
	if (!asset) {
		return `${assetId}:missing`;
	}
	if (asset.payload.kind !== "palette") {
		return `${assetId}:${asset.payload.kind}:${asset.preparedAt}`;
	}
	return [
		assetId,
		asset.payload.kind,
		asset.preparedAt,
		asset.payload.provenance.errorCode ?? "ok",
		asset.payload.paletteId,
		asset.payload.colorCount,
	].join(":");
}

function findRequiredPreparedAsset(
	assetLookup: PaletteAssetLookup,
	assetId: string,
): PreparedAssetRecord | undefined {
	return assetLookup.get(assetId) ?? undefined;
}

function createPaletteAssetLookupFromRecord(
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>,
): PaletteAssetLookup {
	return {
		get: (assetId) => preparedByAssetId[assetId] ?? null,
	};
}
