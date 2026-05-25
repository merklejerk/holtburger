import type {
	PreparedAssetRecord,
	PreparedPalettePayload,
} from "../assets/types";
import { formatHex32 } from "../landblocks";
import type {
	MaterialAppearancePaletteView,
	MaterialAppearanceSubPalette,
} from "./material-appearance";
import {
	createPaletteTextureResource,
	type PaletteTextureResource,
} from "./palette-resources";

interface DerivedPaletteDiagnostic {
	key: string;
	message: string;
	detail: Record<string, unknown>;
}

export type DerivedPaletteDiagnosticHandler = (
	diagnostic: DerivedPaletteDiagnostic,
) => void;

export function createDerivedPaletteTextureResource(options: {
	basePaletteAssetId: string;
	basePalette: PreparedPalettePayload;
	paletteView: MaterialAppearancePaletteView;
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
	reportDiagnostic: DerivedPaletteDiagnosticHandler;
}): PaletteTextureResource | null {
	const colorsArgb = new Uint32Array(options.basePalette.colorsArgb);
	for (const subPalette of options.paletteView.subPalettes) {
		const subPaletteAssetId = formatPaletteAssetId(subPalette.subId);
		const subPaletteAsset = options.preparedByAssetId[subPaletteAssetId];
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

	return createPaletteTextureResource({
		...options.basePalette,
		colorsArgb,
	});
}

export function describeDerivedPaletteResourceKey(options: {
	basePaletteAssetId: string;
	basePaletteAsset: PreparedAssetRecord;
	paletteView: MaterialAppearancePaletteView;
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
}): string {
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
					options.preparedByAssetId[formatPaletteAssetId(subPalette.subId)],
				),
			].join(":"),
		),
	].join("|");
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
