export type AssetHydrationMode = "direct" | "graph";

export type AssetRequestProfileKind =
	| "env-cell"
	| "gfx-obj"
	| "landblock-outdoor"
	| "landblock-topology"
	| "material-recipe"
	| "palette"
	| "prepared-texture"
	| "region-render-profile"
	| "render-surface"
	| "setup-appearance"
	| "setup-model"
	| "surface-texture"
	| "terrain-material"
	| "unknown";

export function classifyAssetHydration(assetId: string): AssetHydrationMode {
	return isDirectHydrationAssetId(assetId) ? "direct" : "graph";
}

export function classifyAssetRequestProfileKind(
	assetId: string,
): AssetRequestProfileKind {
	if (/^env-cell\/[0-9a-fA-F]{8}$/.test(assetId)) {
		return "env-cell";
	}
	if (/^gfx-obj\/[0-9a-fA-F]{8}$/.test(assetId)) {
		return "gfx-obj";
	}
	if (/^landblock\/[0-9a-fA-F]{8}\/outdoor$/.test(assetId)) {
		return "landblock-outdoor";
	}
	if (/^landblock\/[0-9a-fA-F]{8}\/topology$/.test(assetId)) {
		return "landblock-topology";
	}
	if (/^material\/[0-9a-fA-F]{8}$/.test(assetId)) {
		return "material-recipe";
	}
	if (/^palette\/[0-9a-fA-F]{8}$/.test(assetId)) {
		return "palette";
	}
	if (/^prepared-texture\/[0-9a-fA-F]{8}\?/.test(assetId)) {
		return "prepared-texture";
	}
	if (/^region-render-profile\/[0-9a-fA-F]{8}$/.test(assetId)) {
		return "region-render-profile";
	}
	if (/^render-surface\/[0-9a-fA-F]{8}$/.test(assetId)) {
		return "render-surface";
	}
	if (isSetupAppearanceAssetId(assetId)) {
		return "setup-appearance";
	}
	if (/^setup-model\/[0-9a-fA-F]{8}$/.test(assetId)) {
		return "setup-model";
	}
	if (/^surface-texture\/[0-9a-fA-F]{8}$/.test(assetId)) {
		return "surface-texture";
	}
	if (/^terrain-material\/[0-9a-fA-F]{8}$/.test(assetId)) {
		return "terrain-material";
	}
	return "unknown";
}

export function isDirectSceneRootAssetId(assetId: string): boolean {
	return (
		/^landblock\/[0-9a-fA-F]{8}\/(?:outdoor|topology)$/.test(assetId) ||
		/^env-cell\/[0-9a-fA-F]{8}$/.test(assetId)
	);
}

export function isDirectHydrationAssetId(assetId: string): boolean {
	return (
		isDirectSceneRootAssetId(assetId) ||
		isStaticRenderableAssetId(assetId) ||
		isPreparedTextureAssetId(assetId)
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

export function isPreparedTextureAssetId(assetId: string): boolean {
	return /^prepared-texture\/[0-9a-fA-F]{8}\?/.test(assetId);
}
