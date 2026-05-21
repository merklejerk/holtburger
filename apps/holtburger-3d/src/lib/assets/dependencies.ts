import type { AssetLookupResponseDto } from "../host/contracts";
import {
	dependencyManifestPayloadDtoSchema,
	landblockPackPayloadDtoSchema,
	landblockSummaryPayloadDtoSchema,
	setupModelPayloadDtoSchema,
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
