import { getAssetResponseDependencies } from "../../lib/assets/dependencies";
import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
} from "../../lib/host/contracts";

interface WorkerAssetClosureLookup {
	lookupBinaryAssets(requests: readonly AssetLookupRequestDto[]): Promise<{
		responses: readonly AssetLookupResponseDto[];
	}>;
}

export interface WorkerAssetClosureLoadOptions {
	rootAssetIds: readonly string[];
	createRequest: (assetId: string) => AssetLookupRequestDto;
	lookup: WorkerAssetClosureLookup;
	shouldExpandResponse?: (response: AssetLookupResponseDto) => boolean;
}

export interface WorkerAssetClosureLoadResult {
	responses: readonly AssetLookupResponseDto[];
	responseByAssetId: ReadonlyMap<string, AssetLookupResponseDto>;
	loadedAssetIds: readonly string[];
}

export async function loadWorkerAssetClosure({
	rootAssetIds,
	createRequest,
	lookup,
	shouldExpandResponse = () => true,
}: WorkerAssetClosureLoadOptions): Promise<WorkerAssetClosureLoadResult> {
	const responseByAssetId = new Map<string, AssetLookupResponseDto>();
	const queuedAssetIds = new Set<string>();
	const pendingAssetIds = uniqueSortedAssetIds(rootAssetIds);

	for (const assetId of pendingAssetIds) {
		queuedAssetIds.add(assetId);
	}

	while (pendingAssetIds.length > 0) {
		const batchAssetIds = pendingAssetIds.splice(0, pendingAssetIds.length);
		const lookupResult = await lookup.lookupBinaryAssets(
			batchAssetIds.map(createRequest),
		);

		for (const response of lookupResult.responses) {
			responseByAssetId.set(response.assetId, response);
		}

		for (const response of lookupResult.responses) {
			if (!shouldExpandResponse(response)) {
				continue;
			}
			for (const dependency of getAssetResponseDependencies(response)) {
				if (
					queuedAssetIds.has(dependency.assetId) ||
					responseByAssetId.has(dependency.assetId)
				) {
					continue;
				}
				queuedAssetIds.add(dependency.assetId);
				pendingAssetIds.push(dependency.assetId);
			}
		}
		pendingAssetIds.sort();
	}

	const loadedAssetIds = [...responseByAssetId.keys()].sort();
	return {
		responses: loadedAssetIds.map((assetId) => {
			const response = responseByAssetId.get(assetId);
			if (!response) {
				throw new Error(`Missing loaded asset response ${assetId}.`);
			}
			return response;
		}),
		responseByAssetId,
		loadedAssetIds,
	};
}

function uniqueSortedAssetIds(assetIds: readonly string[]): string[] {
	return [...new Set(assetIds)].sort();
}
