export type AssetHydrationMode = "direct" | "graph";

export function classifyAssetHydration(assetId: string): AssetHydrationMode {
	return isDirectSceneRootAssetId(assetId) || isStaticRenderableAssetId(assetId)
		? "direct"
		: "graph";
}

export function isDirectSceneRootAssetId(assetId: string): boolean {
	return (
		/^landblock\/[0-9a-fA-F]{8}\/(?:outdoor|topology)$/.test(assetId) ||
		/^env-cell\/[0-9a-fA-F]{8}$/.test(assetId)
	);
}

export function isStaticRenderableAssetId(assetId: string): boolean {
	return (
		/^gfx-obj\/[0-9a-fA-F]{8}$/.test(assetId) ||
		/^setup-model\/[0-9a-fA-F]{8}$/.test(assetId) ||
		isSetupAppearanceAssetId(assetId)
	);
}

export function isSetupAppearanceAssetId(assetId: string): boolean {
	return /^setup-appearance\/[0-9a-fA-F]{8}$/.test(assetId);
}
