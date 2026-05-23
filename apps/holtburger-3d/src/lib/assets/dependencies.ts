import type { AssetLookupResponseDto } from "../host/contracts";
import {
	dependencyManifestPayloadDtoSchema,
	gfxObjPayloadDtoSchema,
	landblockPackPayloadDtoSchema,
	landblockSummaryPayloadDtoSchema,
	materialRecipePayloadDtoSchema,
	renderSurfacePayloadDtoSchema,
	renderTexturePayloadDtoSchema,
	setupModelPayloadDtoSchema,
	setupAppearancePayloadDtoSchema,
} from "../host/contracts";

export interface AssetDependencyRef {
	assetId: string;
}

export function getAssetResponseDependencies(
	response: AssetLookupResponseDto,
): AssetDependencyRef[] {
	const landblockPack = landblockPackPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (landblockPack.success) {
		return uniqueSortedAssetIds(
			landblockPack.data.dependencies.renderableAssetIds,
		);
	}

	const landblockSummary = landblockSummaryPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (landblockSummary.success) {
		return [];
	}

	const setupModel = setupModelPayloadDtoSchema.safeParse(response.payload);
	if (setupModel.success) {
		return uniqueSortedAssetIds([
			...setupModel.data.dependencies.gfxObjAssetIds,
			setupModel.data.dependencies.setupAppearanceAssetId,
		]);
	}

	const gfxObj = gfxObjPayloadDtoSchema.safeParse(response.payload);
	if (gfxObj.success) {
		return uniqueSortedAssetIds(gfxObj.data.dependencies.materialAssetIds);
	}

	const setupAppearance = setupAppearancePayloadDtoSchema.safeParse(
		response.payload,
	);
	if (setupAppearance.success) {
		return uniqueSortedAssetIds([
			...setupAppearance.data.dependencies.materialAssetIds,
			...setupAppearance.data.dependencies.paletteAssetIds,
		]);
	}

	const materialRecipe = materialRecipePayloadDtoSchema.safeParse(
		response.payload,
	);
	if (materialRecipe.success) {
		return uniqueSortedAssetIds([
			...materialRecipe.data.dependencies.renderTextureAssetIds,
			...materialRecipe.data.dependencies.renderSurfaceAssetIds,
			...materialRecipe.data.dependencies.paletteAssetIds,
		]);
	}

	const renderTexture = renderTexturePayloadDtoSchema.safeParse(
		response.payload,
	);
	if (renderTexture.success) {
		return uniqueSortedAssetIds(
			renderTexture.data.dependencies.renderSurfaceAssetIds,
		);
	}

	const renderSurface = renderSurfacePayloadDtoSchema.safeParse(
		response.payload,
	);
	if (renderSurface.success) {
		return uniqueSortedAssetIds(
			renderSurface.data.dependencies.paletteAssetIds,
		);
	}

	const dependencyManifest = dependencyManifestPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (dependencyManifest.success) {
		return uniqueSortedAssetIds(dependencyManifest.data.dependencyAssetIds);
	}

	return [];
}

function uniqueSortedAssetIds(assetIds: string[]): AssetDependencyRef[] {
	return [...new Set(assetIds)].sort().map((assetId) => ({ assetId }));
}
