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
