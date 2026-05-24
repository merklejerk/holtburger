import type { AssetLookupResponseDto } from "../host/contracts";
import {
	dependencyManifestPayloadDtoSchema,
	envCellPayloadDtoSchema,
	gfxObjPayloadDtoSchema,
	landblockBuildingShellsPayloadDtoSchema,
	landblockOutdoorPayloadDtoSchema,
	landblockPackPayloadDtoSchema,
	landblockScenePayloadDtoSchema,
	landblockSummaryPayloadDtoSchema,
	landblockTerrainPayloadDtoSchema,
	landblockTopologyPayloadDtoSchema,
	materialRecipePayloadDtoSchema,
	renderSurfacePayloadDtoSchema,
	renderTexturePayloadDtoSchema,
	setupModelPayloadDtoSchema,
	setupAppearancePayloadDtoSchema,
	terrainMaterialPayloadDtoSchema,
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

	const landblockTerrain = landblockTerrainPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (landblockTerrain.success) {
		return uniqueSortedAssetIds([
			formatTerrainMaterialDependencyAssetId(
				landblockTerrain.data.regionNumber,
			),
		]);
	}

	const landblockOutdoor = landblockOutdoorPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (landblockOutdoor.success) {
		return uniqueSortedAssetIds([
			formatTerrainMaterialDependencyAssetId(
				landblockOutdoor.data.regionNumber,
			),
			...landblockOutdoor.data.statics.map((member) => member.sourceAssetId),
		]);
	}

	const landblockBuildingShells =
		landblockBuildingShellsPayloadDtoSchema.safeParse(response.payload);
	if (landblockBuildingShells.success) {
		return uniqueSortedAssetIds(
			landblockBuildingShells.data.shells.map((shell) => shell.sourceAssetId),
		);
	}

	const landblockScene = landblockScenePayloadDtoSchema.safeParse(
		response.payload,
	);
	if (landblockScene.success) {
		return uniqueSortedAssetIds([
			...landblockScene.data.statics.map((member) => member.sourceAssetId),
			...landblockScene.data.buildings.map((member) => member.sourceAssetId),
			...landblockScene.data.envCells.map((member) => member.assetId),
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
			...envCell.data.surfaces.map((surface) => surface.materialAssetId),
			...envCell.data.statics.map((member) => member.sourceAssetId),
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
			...materialRecipe.data.dependencies.renderTextureAssetIds,
			...materialRecipe.data.dependencies.renderSurfaceAssetIds,
			...materialRecipe.data.dependencies.paletteAssetIds,
		]);
	}

	const terrainMaterial = terrainMaterialPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (terrainMaterial.success) {
		return uniqueSortedAssetIds([
			...terrainMaterial.data.dependencies.renderTextureAssetIds,
			...terrainMaterial.data.dependencies.renderSurfaceAssetIds,
			...terrainMaterial.data.dependencies.paletteAssetIds,
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

function formatTerrainMaterialDependencyAssetId(regionNumber: number): string {
	return `terrain-material/${Math.trunc(regionNumber)}`;
}
