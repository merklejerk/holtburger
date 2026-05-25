import type { PreparedSetupAppearancePayload } from "../assets/types";
import { formatHex32 } from "../landblocks";

export interface MaterialAppearanceSubPalette {
	subId: number;
	offset: number;
	numColors: number;
}

export interface MaterialAppearancePaletteView {
	paletteId: number | null;
	subPalettes: readonly MaterialAppearanceSubPalette[];
}

export interface MaterialAppearanceContext {
	appearanceKey: string;
	selectedPartsSignature: string | null;
	textureSwapSignature: string | null;
	paletteViewSignature: string | null;
	paletteView: MaterialAppearancePaletteView | null;
}

export function createBaseMaterialAppearanceContext(
	appearanceKey: string,
): MaterialAppearanceContext {
	return {
		appearanceKey,
		selectedPartsSignature: null,
		textureSwapSignature: null,
		paletteViewSignature: null,
		paletteView: null,
	};
}

export function createSetupAppearanceMaterialAppearanceContext(
	setupAppearance: PreparedSetupAppearancePayload,
): MaterialAppearanceContext {
	return {
		appearanceKey: setupAppearance.appearanceKey,
		selectedPartsSignature:
			describeSetupAppearanceSelectedPartsSignature(setupAppearance),
		textureSwapSignature:
			describeSetupAppearanceTextureSwapSignature(setupAppearance),
		paletteViewSignature:
			describeSetupAppearancePaletteViewSignature(setupAppearance),
		paletteView: createSetupAppearancePaletteView(setupAppearance),
	};
}

export function describeMaterialAppearanceSignature(
	appearance: MaterialAppearanceContext,
): string {
	return [
		appearance.appearanceKey,
		`parts=${appearance.selectedPartsSignature ?? "base"}`,
		`textures=${appearance.textureSwapSignature ?? "base"}`,
		`palette=${appearance.paletteViewSignature ?? "base"}`,
	].join("|");
}

function describeSetupAppearanceSelectedPartsSignature(
	setupAppearance: PreparedSetupAppearancePayload,
): string {
	return setupAppearance.parts
		.map((part) =>
			[
				part.partIndex,
				part.gfxObjId,
				part.gfxObjAssetId,
				part.materialSlots
					.map(
						(slot) =>
							`${slot.slotIndex}:${slot.surfaceId}:${slot.materialAssetId}`,
					)
					.sort()
					.join("+"),
			].join(":"),
		)
		.sort()
		.join(",");
}

function describeSetupAppearanceTextureSwapSignature(
	setupAppearance: PreparedSetupAppearancePayload,
): string | null {
	if (setupAppearance.textureChanges.length === 0) {
		return null;
	}
	return setupAppearance.textureChanges
		.map(
			(change) =>
				`${change.partIndex}:${formatHex32(change.oldTexture)}>${formatHex32(change.newTexture)}`,
		)
		.sort()
		.join(",");
}

function createSetupAppearancePaletteView(
	setupAppearance: PreparedSetupAppearancePayload,
): MaterialAppearancePaletteView | null {
	if (
		setupAppearance.paletteId === null &&
		setupAppearance.subPalettes.length === 0
	) {
		return null;
	}
	return {
		paletteId: setupAppearance.paletteId,
		subPalettes: setupAppearance.subPalettes
			.map((subPalette) => ({ ...subPalette }))
			.sort(compareSubPalettes),
	};
}

function describeSetupAppearancePaletteViewSignature(
	setupAppearance: PreparedSetupAppearancePayload,
): string | null {
	const paletteView = createSetupAppearancePaletteView(setupAppearance);
	if (!paletteView) {
		return null;
	}
	return [
		`base=${paletteView.paletteId === null ? "material" : formatHex32(paletteView.paletteId)}`,
		`sub=${paletteView.subPalettes
			.map(
				(subPalette) =>
					`${formatHex32(subPalette.subId)}@${subPalette.offset}+${subPalette.numColors}`,
			)
			.join(",")}`,
	].join("|");
}

function compareSubPalettes(
	left: MaterialAppearanceSubPalette,
	right: MaterialAppearanceSubPalette,
): number {
	return (
		left.offset - right.offset ||
		left.numColors - right.numColors ||
		left.subId - right.subId
	);
}
