export type AssetHydrationMode = "direct" | "graph";

export function classifyAssetHydration(assetId: string): AssetHydrationMode {
	return isSceneCoverageAssetId(assetId) ? "direct" : "graph";
}

export function isSceneCoverageAssetId(assetId: string): boolean {
	return (
		assetId.startsWith("landblock-pack/") ||
		assetId.startsWith("landblock-summary/")
	);
}
