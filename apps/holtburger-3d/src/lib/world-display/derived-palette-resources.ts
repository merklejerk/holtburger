import type {
	PreparedAssetRecord,
	PreparedPalettePayload,
} from "../assets/types";
import type {
	MaterialAppearancePaletteView,
} from "./material-appearance";
import {
	createDerivedPaletteData,
	describeDerivedPaletteDataKey,
	formatPaletteAssetId,
	type PaletteDataDiagnosticHandler,
} from "./palette-data";
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
	const data = createDerivedPaletteData({
		basePaletteAssetId: options.basePaletteAssetId,
		basePalette: options.basePalette,
		paletteView: options.paletteView,
		preparedByAssetId: options.preparedByAssetId,
		reportDiagnostic:
			options.reportDiagnostic as PaletteDataDiagnosticHandler,
	});
	if (!data) {
		return null;
	}
	return createPaletteTextureResource(
		{
			...options.basePalette,
			colorsArgb: data.colorsArgb,
		},
		data.paletteAssetId,
	);
}

export function describeDerivedPaletteResourceKey(options: {
	basePaletteAssetId: string;
	basePaletteAsset: PreparedAssetRecord;
	paletteView: MaterialAppearancePaletteView;
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
}): string {
	return describeDerivedPaletteDataKey(options);
}

export { formatPaletteAssetId };
