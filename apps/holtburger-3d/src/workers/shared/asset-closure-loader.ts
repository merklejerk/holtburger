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
		const returnedAssetIds = new Set(
			lookupResult.responses.map((response) => response.assetId),
		);
		const missingAssetIds = batchAssetIds.filter(
			(assetId) => !returnedAssetIds.has(assetId),
		);
		if (missingAssetIds.length > 0) {
			throw new Error(
				`Worker asset closure lookup returned no response for ${missingAssetIds.length} requested asset(s): ${formatAssetIdSample(
					missingAssetIds,
				)}.`,
			);
		}

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

function formatAssetIdSample(assetIds: readonly string[]): string {
	const sample = assetIds.slice(0, 8).join(", ");
	return assetIds.length > 8
		? `${sample}, ... +${assetIds.length - 8} more`
		: sample;
}
