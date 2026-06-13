import type { AssetLookupResponseDto } from "../host/contracts";
import {
	envCellPayloadDtoSchema,
	gfxObjPayloadDtoSchema,
	landblockOutdoorPayloadDtoSchema,
	landblockTopologyPayloadDtoSchema,
	materialRecipePayloadDtoSchema,
	preparedTexturePayloadDtoSchema,
	renderSurfacePayloadDtoSchema,
	regionRenderProfilePayloadDtoSchema,
	surfaceTexturePayloadDtoSchema,
	setupModelPayloadDtoSchema,
	setupAppearancePayloadDtoSchema,
	terrainMaterialPayloadDtoSchema,
} from "../host/contracts";
import {
	formatRegionRenderProfileAssetId,
	formatTerrainMaterialAssetId,
} from "../landblocks";
import {
	collectEnvCellMaterialAssetIds,
	collectEnvCellRenderableSourceAssetIds,
	collectLandblockOutdoorRenderableSourceAssetIds,
} from "./structured-asset-dependencies";

export interface AssetDependencyRef {
	assetId: string;
}

export function getAssetResponseDependencies(
	response: AssetLookupResponseDto,
): AssetDependencyRef[] {
	const landblockOutdoor = landblockOutdoorPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (landblockOutdoor.success) {
		return uniqueSortedAssetIds([
			formatTerrainMaterialAssetId(landblockOutdoor.data.regionNumber),
			formatRegionRenderProfileAssetId(landblockOutdoor.data.regionNumber),
			...collectLandblockOutdoorRenderableSourceAssetIds(landblockOutdoor.data),
		]);
	}

	const landblockTopology = landblockTopologyPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (landblockTopology.success) {
		return uniqueSortedAssetIds(
			landblockTopology.data.envCells.map((member) => member.assetId),
		);
	}

	const envCell = envCellPayloadDtoSchema.safeParse(response.payload);
	if (envCell.success) {
		return uniqueSortedAssetIds([
			formatRegionRenderProfileAssetId(envCell.data.regionNumber),
			...collectEnvCellMaterialAssetIds(envCell.data),
			...collectEnvCellRenderableSourceAssetIds(envCell.data),
		]);
	}

	const setupModel = setupModelPayloadDtoSchema.safeParse(response.payload);
	if (setupModel.success) {
		return uniqueSortedAssetIds(setupModel.data.dependencies.gfxObjAssetIds);
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
			...materialRecipe.data.dependencies.surfaceTextureAssetIds,
			...materialRecipe.data.dependencies.renderSurfaceAssetIds,
			...materialRecipe.data.dependencies.paletteAssetIds,
		]);
	}

	const terrainMaterial = terrainMaterialPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (terrainMaterial.success) {
		return uniqueSortedAssetIds([
			...terrainMaterial.data.dependencies.surfaceTextureAssetIds,
			...terrainMaterial.data.dependencies.renderSurfaceAssetIds,
			...terrainMaterial.data.dependencies.paletteAssetIds,
		]);
	}

	const regionRenderProfile = regionRenderProfilePayloadDtoSchema.safeParse(
		response.payload,
	);
	if (regionRenderProfile.success) {
		return uniqueSortedAssetIds([
			...regionRenderProfile.data.dependencies.surfaceTextureAssetIds,
			...regionRenderProfile.data.dependencies.renderSurfaceAssetIds,
			...regionRenderProfile.data.dependencies.paletteAssetIds,
		]);
	}

	const surfaceTexture = surfaceTexturePayloadDtoSchema.safeParse(
		response.payload,
	);
	if (surfaceTexture.success) {
		return uniqueSortedAssetIds(
			surfaceTexture.data.dependencies.renderSurfaceAssetIds,
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

	const preparedTexture = preparedTexturePayloadDtoSchema.safeParse(
		response.payload,
	);
	if (preparedTexture.success) {
		return [];
	}

	return [];
}

function uniqueSortedAssetIds(assetIds: string[]): AssetDependencyRef[] {
	return [...new Set(assetIds)].sort().map((assetId) => ({ assetId }));
}
