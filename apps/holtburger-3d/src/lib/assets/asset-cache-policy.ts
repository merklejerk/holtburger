import type {
	PreparedAssetResolver,
	PreparedAssetScanEntry,
} from "./prepared-asset-store";
import {
	getPreparedAssetDependencies,
	type PreparedAssetCacheMetadata,
	type PreparedAssetRecord,
} from "./types";

export const DEFAULT_PREPARED_ASSET_WARM_RETAIN_MS = 120_000;
export const DEFAULT_PREPARED_ASSET_PRUNE_INTERVAL_MS = 1_000;
export const DEFAULT_PREPARED_ASSET_PRUNE_EVALUATION_BATCH_SIZE = 128;
export const DEFAULT_PREPARED_ASSET_PRUNE_EVICTION_BATCH_SIZE = 16;

export interface PreparedAssetCachePruneBatchInput {
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	cacheMetadataByAssetId: Record<string, PreparedAssetCacheMetadata>;
	activeCoverageAssetIds: readonly string[];
	inFlightAssetIds: readonly string[];
	nowMs: number;
	warmRetainMs: number;
	cursorAssetId: string | null;
	maxEvaluatedAssetCount: number;
	maxEvictedAssetCount: number;
}

export interface PreparedAssetCachePruneResolverBatchInput {
	preparedAssets: PreparedAssetResolver;
	candidateEntries: readonly PreparedAssetScanEntry[];
	nextCandidateCursorAssetId: string | null;
	activeCoverageAssetIds: readonly string[];
	inFlightAssetIds: readonly string[];
	nowMs: number;
	warmRetainMs: number;
	maxEvaluatedAssetCount: number;
	maxEvictedAssetCount: number;
}

export interface PreparedAssetCachePruneBatchPlan {
	retainedAssetIds: string[];
	evictedAssetIds: string[];
	retainedMetadataByAssetId: Record<string, PreparedAssetCacheMetadata>;
	nextCursorAssetId: string | null;
	evaluatedAssetCount: number;
	nextWarmPruneAtMs: number | null;
}

interface HardRetainedAssetLookupInput {
	activeCoverageAssetIds: readonly string[];
	inFlightAssetIds: readonly string[];
	getPreparedAsset(assetId: string): PreparedAssetRecord | null;
}

export function planPreparedAssetCachePruneBatchFromResolver(
	input: PreparedAssetCachePruneResolverBatchInput,
): PreparedAssetCachePruneBatchPlan {
	const hardRetainedAssetIds = deriveHardRetainedAssetIdsFromLookup({
		activeCoverageAssetIds: input.activeCoverageAssetIds,
		inFlightAssetIds: input.inFlightAssetIds,
		getPreparedAsset: (assetId) => input.preparedAssets.get(assetId),
	});
	const hardRetainedAssetIdSet = new Set(hardRetainedAssetIds);
	const retainedAssetIds: string[] = [];
	const evictedAssetIds: string[] = [];
	const retainedMetadataByAssetId: Record<string, PreparedAssetCacheMetadata> =
		{};
	let evaluatedAssetCount = 0;
	let nextWarmPruneAtMs: number | null = null;
	let nextCursorAssetId = input.nextCandidateCursorAssetId;
	const maxEvaluatedAssetCount = Math.max(
		1,
		Math.trunc(input.maxEvaluatedAssetCount),
	);
	const maxEvictedAssetCount = Math.max(
		1,
		Math.trunc(input.maxEvictedAssetCount),
	);

	for (const [index, candidate] of input.candidateEntries.entries()) {
		if (evaluatedAssetCount >= maxEvaluatedAssetCount) {
			nextCursorAssetId = candidate.assetId;
			break;
		}

		evaluatedAssetCount += 1;
		const { assetId, cacheMetadata } = candidate;
		if (hardRetainedAssetIdSet.has(assetId)) {
			retainedAssetIds.push(assetId);
			retainedMetadataByAssetId[assetId] = {
				lastPreparedAtMs: cacheMetadata?.lastPreparedAtMs ?? input.nowMs,
				lastRetainedAtMs: input.nowMs,
			};
			continue;
		}

		if (
			cacheMetadata &&
			input.nowMs - cacheMetadata.lastRetainedAtMs <= input.warmRetainMs
		) {
			retainedAssetIds.push(assetId);
			retainedMetadataByAssetId[assetId] = cacheMetadata;
			const expiresAtMs = cacheMetadata.lastRetainedAtMs + input.warmRetainMs;
			nextWarmPruneAtMs =
				nextWarmPruneAtMs === null
					? expiresAtMs
					: Math.min(nextWarmPruneAtMs, expiresAtMs);
			continue;
		}

		evictedAssetIds.push(assetId);
		if (evictedAssetIds.length >= maxEvictedAssetCount) {
			nextCursorAssetId =
				input.candidateEntries[index + 1]?.assetId ??
				input.nextCandidateCursorAssetId;
			break;
		}
	}

	return {
		retainedAssetIds,
		evictedAssetIds,
		retainedMetadataByAssetId,
		nextCursorAssetId,
		evaluatedAssetCount,
		nextWarmPruneAtMs,
	};
}

export function planPreparedAssetCachePruneBatch(
	input: PreparedAssetCachePruneBatchInput,
): PreparedAssetCachePruneBatchPlan {
	const hardRetainedAssetIds = deriveHardRetainedAssetIds(input);
	const hardRetainedAssetIdSet = new Set(hardRetainedAssetIds);
	const retainedAssetIds: string[] = [];
	const evictedAssetIds: string[] = [];
	const retainedMetadataByAssetId: Record<string, PreparedAssetCacheMetadata> =
		{};
	let evaluatedAssetCount = 0;
	let nextWarmPruneAtMs: number | null = null;
	let nextCursorAssetId: string | null = null;
	const assetIds = Object.keys(input.preparedByAssetId);
	const cursorIndex =
		input.cursorAssetId === null ? -1 : assetIds.indexOf(input.cursorAssetId);
	const startIndex = cursorIndex < 0 ? 0 : cursorIndex + 1;

	const maxEvaluatedAssetCount = Math.max(
		1,
		Math.trunc(input.maxEvaluatedAssetCount),
	);
	const maxEvictedAssetCount = Math.max(
		1,
		Math.trunc(input.maxEvictedAssetCount),
	);

	for (let index = startIndex; index < assetIds.length; index += 1) {
		const assetId = assetIds[index];
		if (assetId === undefined) {
			continue;
		}
		if (evaluatedAssetCount >= maxEvaluatedAssetCount) {
			break;
		}

		evaluatedAssetCount += 1;
		nextCursorAssetId = assetId;
		if (hardRetainedAssetIdSet.has(assetId)) {
			retainedAssetIds.push(assetId);
			const existingMetadata = input.cacheMetadataByAssetId[assetId];
			retainedMetadataByAssetId[assetId] = {
				lastPreparedAtMs: existingMetadata?.lastPreparedAtMs ?? input.nowMs,
				lastRetainedAtMs: input.nowMs,
			};
			continue;
		}

		const metadata = input.cacheMetadataByAssetId[assetId];
		if (
			metadata &&
			input.nowMs - metadata.lastRetainedAtMs <= input.warmRetainMs
		) {
			retainedAssetIds.push(assetId);
			retainedMetadataByAssetId[assetId] = metadata;
			const expiresAtMs = metadata.lastRetainedAtMs + input.warmRetainMs;
			nextWarmPruneAtMs =
				nextWarmPruneAtMs === null
					? expiresAtMs
					: Math.min(nextWarmPruneAtMs, expiresAtMs);
			continue;
		}

		evictedAssetIds.push(assetId);
		if (evictedAssetIds.length >= maxEvictedAssetCount) {
			break;
		}
	}

	if (startIndex + evaluatedAssetCount >= assetIds.length) {
		nextCursorAssetId = null;
	}

	return {
		retainedAssetIds,
		evictedAssetIds,
		retainedMetadataByAssetId,
		nextCursorAssetId,
		evaluatedAssetCount,
		nextWarmPruneAtMs,
	};
}

function deriveHardRetainedAssetIds(
	input: PreparedAssetCachePruneBatchInput,
): string[] {
	return deriveHardRetainedAssetIdsFromLookup({
		activeCoverageAssetIds: input.activeCoverageAssetIds,
		inFlightAssetIds: input.inFlightAssetIds,
		getPreparedAsset: (assetId) => input.preparedByAssetId[assetId] ?? null,
	});
}

function deriveHardRetainedAssetIdsFromLookup(
	input: HardRetainedAssetLookupInput,
): string[] {
	const retainedAssetIds = new Set<string>([
		...input.activeCoverageAssetIds,
		...input.inFlightAssetIds,
	]);
	const pendingAssetIds = [...retainedAssetIds].sort();

	while (pendingAssetIds.length > 0) {
		const assetId = pendingAssetIds.shift();
		if (!assetId) {
			continue;
		}

		const asset = input.getPreparedAsset(assetId);
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
