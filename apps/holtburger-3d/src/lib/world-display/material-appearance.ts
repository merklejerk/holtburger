import type { PreparedSetupAppearancePayload } from "../assets/types";

export interface MaterialAppearanceContext {
	appearanceKey: string;
	selectedPartsSignature: string | null;
	textureSwapSignature: string | null;
	paletteViewSignature: string | null;
}

export function createBaseMaterialAppearanceContext(
	appearanceKey: string,
): MaterialAppearanceContext {
	return {
		appearanceKey,
		selectedPartsSignature: null,
		textureSwapSignature: null,
		paletteViewSignature: null,
	};
}

export function createSetupAppearanceMaterialAppearanceContext(
	setupAppearance: PreparedSetupAppearancePayload,
): MaterialAppearanceContext {
	return {
		appearanceKey: setupAppearance.appearanceKey,
		selectedPartsSignature:
			describeSetupAppearanceSelectedPartsSignature(setupAppearance),
		textureSwapSignature: null,
		paletteViewSignature: null,
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
