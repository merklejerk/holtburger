import type {
	AssetChannelState,
	PreparedMaterialRecipePayload,
	PreparedRenderSurfacePayload,
} from "../assets/types";
import { formatHex32 } from "../landblocks";

export interface ResolvedMaterialRenderSurface {
	assetId: string;
	renderSurface: PreparedRenderSurfacePayload;
}

export function resolveFirstMaterialRenderSurface(options: {
	recipe: PreparedMaterialRecipePayload;
	assetState: AssetChannelState;
}): ResolvedMaterialRenderSurface | null {
	const assetIds =
		options.recipe.source.kind === "texture"
			? selectedRenderSurfaceAssetIds(
					options.recipe.source.selectedRenderSurfaceId,
				)
			: options.recipe.dependencies.renderSurfaceAssetIds;
	const assetId = assetIds[0];
	const asset =
		assetId === undefined
			? null
			: options.assetState.preparedByAssetId[assetId];
	return asset?.payload.kind === "render-surface"
		? { assetId, renderSurface: asset.payload }
		: null;
}

function selectedRenderSurfaceAssetIds(renderSurfaceId: number | null): string[] {
	return renderSurfaceId === null
		? []
		: [`render-surface/${formatHex32(renderSurfaceId)}`];
}
