import { countPreparedAssetsByKind } from "./asset-cache-diagnostics";
import {
	getPreparedAssetDependencies,
	type PreparedAssetCacheMetadata,
	type PreparedAssetCacheDiagnostics,
	type PreparedAssetRecord,
} from "./types";

export const DEFAULT_PREPARED_ASSET_WARM_RETAIN_MS = 120_000;

export interface PreparedAssetCachePolicyInput {
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	cacheMetadataByAssetId: Record<string, PreparedAssetCacheMetadata>;
	activeCoverageAssetIds: readonly string[];
	inFlightAssetIds: readonly string[];
	nowMs: number;
	warmRetainMs: number;
}

export interface PreparedAssetCachePrunePlan {
	retainedAssetIds: string[];
	evictedAssetIds: string[];
	cacheMetadataByAssetId: Record<string, PreparedAssetCacheMetadata>;
	diagnostics: PreparedAssetCacheDiagnostics;
}

export function planPreparedAssetCachePrune(
	input: PreparedAssetCachePolicyInput,
): PreparedAssetCachePrunePlan {
	const hardRetainedAssetIds = deriveHardRetainedAssetIds(input);
	const retainedAssetIdSet = new Set(hardRetainedAssetIds);
	const cacheMetadataByAssetId: Record<string, PreparedAssetCacheMetadata> = {};

	for (const assetId of hardRetainedAssetIds) {
		if (!input.preparedByAssetId[assetId]) {
			continue;
		}

		const existingMetadata = input.cacheMetadataByAssetId[assetId];
		cacheMetadataByAssetId[assetId] = {
			lastPreparedAtMs: existingMetadata?.lastPreparedAtMs ?? input.nowMs,
			lastRetainedAtMs: input.nowMs,
		};
	}

	for (const assetId of Object.keys(input.preparedByAssetId)) {
		if (retainedAssetIdSet.has(assetId)) {
			continue;
		}

		const metadata = input.cacheMetadataByAssetId[assetId];
		if (
			metadata &&
			input.nowMs - metadata.lastRetainedAtMs <= input.warmRetainMs
		) {
			retainedAssetIdSet.add(assetId);
			cacheMetadataByAssetId[assetId] = metadata;
			continue;
		}
	}

	const retainedAssetIds = [...retainedAssetIdSet].sort();
	const evictedAssetIds = Object.keys(input.preparedByAssetId)
		.filter((assetId) => !retainedAssetIdSet.has(assetId))
		.sort();

	return {
		retainedAssetIds,
		evictedAssetIds,
		cacheMetadataByAssetId,
		diagnostics: {
			prepared: countPreparedAssetsByKind(input.preparedByAssetId),
			retained: countPreparedAssetsByKind(
				filterPreparedAssets(input.preparedByAssetId, retainedAssetIdSet),
			),
			evicted: countPreparedAssetsByKind(
				filterPreparedAssets(input.preparedByAssetId, new Set(evictedAssetIds)),
			),
		},
	};
}

function deriveHardRetainedAssetIds(
	input: PreparedAssetCachePolicyInput,
): string[] {
	const retainedAssetIds = new Set<string>([
		...input.activeCoverageAssetIds,
		...input.inFlightAssetIds,
	]);
	const pendingAssetIds = [...input.activeCoverageAssetIds].sort();

	while (pendingAssetIds.length > 0) {
		const assetId = pendingAssetIds.shift();
		if (!assetId) {
			continue;
		}

		const asset = input.preparedByAssetId[assetId];
		if (!asset) {
			continue;
		}

		for (const dependency of getPreparedAssetDependencies(asset)) {
			if (retainedAssetIds.has(dependency.assetId)) {
				continue;
			}

			retainedAssetIds.add(dependency.assetId);
			pendingAssetIds.push(dependency.assetId);
		}
	}

	return [...retainedAssetIds].sort();
}

function filterPreparedAssets(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	assetIds: ReadonlySet<string>,
): Record<string, PreparedAssetRecord> {
	const filtered: Record<string, PreparedAssetRecord> = {};

	for (const assetId of assetIds) {
		const asset = preparedByAssetId[assetId];
		if (asset) {
			filtered[assetId] = asset;
		}
	}

	return filtered;
}
