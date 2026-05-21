import type { AssetLookupResponseDto } from "../host/contracts";
import {
	dependencyManifestPayloadDtoSchema,
	indoorEnvCellPayloadDtoSchema,
	landblockPackPayloadDtoSchema,
	landblockSummaryPayloadDtoSchema,
	outdoorStaticScenePayloadDtoSchema,
	setupModelPayloadDtoSchema,
} from "../host/contracts";

export interface AssetDependencyRef {
	assetId: string;
}

export function getAssetResponseDependencies(
	response: AssetLookupResponseDto,
): AssetDependencyRef[] {
	const outdoorStaticScene = outdoorStaticScenePayloadDtoSchema.safeParse(
		response.payload,
	);
	if (outdoorStaticScene.success) {
		return uniqueSortedAssetIds([
			...outdoorStaticScene.data.sceneryInstances.map(
				(instance) => instance.sourceAssetId,
			),
			...outdoorStaticScene.data.buildingInstances.map(
				(instance) => instance.sourceAssetId,
			),
			...outdoorStaticScene.data.generatedSceneryInstances.map(
				(instance) => instance.sourceAssetId,
			),
		]);
	}

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

	const indoorEnvCell = indoorEnvCellPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (indoorEnvCell.success) {
		return uniqueSortedAssetIds(
			indoorEnvCell.data.staticObjects.map(
				(staticObject) => staticObject.sourceAssetId,
			),
		);
	}

	const setupModel = setupModelPayloadDtoSchema.safeParse(response.payload);
	if (setupModel.success) {
		return uniqueSortedAssetIds(
			setupModel.data.parts.map((part) => part.gfxObjAssetId),
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
