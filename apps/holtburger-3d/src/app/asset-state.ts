import {
	createInitialAssetChannelState,
	type AssetActivityRecord,
	type AssetChannelState,
	type PreparedAssetRecord,
} from "../lib/assets/types";
import type { PreparedAssetCachePrunePlan } from "../lib/assets/asset-cache-policy";
import type { AssetLookupRequestDto } from "../lib/host/contracts";

const MAX_ASSET_ACTIVITY = 8;

export function createAssetState(): AssetChannelState {
	return createInitialAssetChannelState();
}

export function updateAssetChannel(
	assetState: AssetChannelState,
	channel: string,
): AssetChannelState {
	return {
		...assetState,
		channel,
	};
}

export function markAssetsPending(
	assetState: AssetChannelState,
	requests: readonly AssetLookupRequestDto[],
	timestamp = new Date().toISOString(),
): AssetChannelState {
	if (requests.length === 0) {
		return assetState;
	}

	return {
		...assetState,
		status: "pending",
		activeRequest: requests.at(-1) ?? null,
		errorMessage: null,
		history: appendAssetActivities(
			assetState.history,
			requests.map((request) => ({
				requestId: request.requestId,
				assetId: request.assetId,
				priority: request.priority,
				status: "requested",
				channel: assetState.channel,
				timestamp,
			})),
		),
	};
}

export function applyPreparedAssets(
	assetState: AssetChannelState,
	assets: readonly PreparedAssetRecord[],
	nowMs = Date.now(),
): AssetChannelState {
	if (assets.length === 0) {
		return assetState;
	}

	const preparedByPriority = { ...assetState.preparedByPriority };
	const preparedByAssetId = { ...assetState.preparedByAssetId };
	const cacheMetadataByAssetId = { ...assetState.cacheMetadataByAssetId };
	for (const asset of assets) {
		preparedByPriority[asset.request.priority] = asset;
		preparedByAssetId[asset.request.assetId] = asset;
		cacheMetadataByAssetId[asset.request.assetId] = {
			lastPreparedAtMs: nowMs,
			lastRetainedAtMs: nowMs,
		};
	}

	const latestAsset = assets.at(-1);
	if (!latestAsset) {
		return assetState;
	}

	return {
		...assetState,
		status: "ready",
		activeRequest: latestAsset.request,
		preparedAsset: latestAsset,
		preparedByPriority,
		preparedByAssetId,
		cacheMetadataByAssetId,
		lastResponse: latestAsset.response,
		errorMessage: null,
		history: appendAssetActivities(
			assetState.history,
			assets.map((asset) => ({
				requestId: asset.request.requestId,
				assetId: asset.request.assetId,
				priority: asset.request.priority,
				status: "prepared",
				channel: assetState.channel,
				timestamp: asset.preparedAt,
			})),
		),
	};
}

export function applyAssetCachePrune(
	assetState: AssetChannelState,
	prunePlan: PreparedAssetCachePrunePlan,
): AssetChannelState {
	const retainedAssetIdSet = new Set(prunePlan.retainedAssetIds);
	const evictedAssetIdSet = new Set(prunePlan.evictedAssetIds);
	const preparedByAssetId = filterPreparedAssets(
		assetState.preparedByAssetId,
		retainedAssetIdSet,
	);
	const preparedByPriority = Object.fromEntries(
		Object.entries(assetState.preparedByPriority).map(([priority, asset]) => [
			priority,
			asset && retainedAssetIdSet.has(asset.request.assetId) ? asset : null,
		]),
	) as AssetChannelState["preparedByPriority"];
	const preparedAsset =
		assetState.preparedAsset &&
		retainedAssetIdSet.has(assetState.preparedAsset.request.assetId)
			? assetState.preparedAsset
			: null;
	const lastResponse =
		assetState.lastResponse &&
		!evictedAssetIdSet.has(assetState.lastResponse.assetId)
			? assetState.lastResponse
			: null;

	return {
		...assetState,
		preparedAsset,
		preparedByPriority,
		preparedByAssetId,
		cacheMetadataByAssetId: prunePlan.cacheMetadataByAssetId,
		cacheDiagnostics: prunePlan.diagnostics,
		lastResponse,
	};
}

export function applyAssetError(
	assetState: AssetChannelState,
	request: AssetLookupRequestDto,
	errorMessage: string,
	timestamp = new Date().toISOString(),
): AssetChannelState {
	return {
		...assetState,
		status: "error",
		activeRequest: request,
		errorMessage,
		history: appendAssetActivity(assetState.history, {
			requestId: request.requestId,
			assetId: request.assetId,
			priority: request.priority,
			status: "failed",
			channel: assetState.channel,
			timestamp,
		}),
	};
}

function appendAssetActivity(
	history: readonly AssetActivityRecord[],
	entry: AssetActivityRecord,
): AssetActivityRecord[] {
	return appendAssetActivities(history, [entry]);
}

function appendAssetActivities(
	history: readonly AssetActivityRecord[],
	entries: readonly AssetActivityRecord[],
): AssetActivityRecord[] {
	return [...history, ...entries].slice(-MAX_ASSET_ACTIVITY);
}

function filterPreparedAssets(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	retainedAssetIdSet: ReadonlySet<string>,
): Record<string, PreparedAssetRecord> {
	const retained: Record<string, PreparedAssetRecord> = {};

	for (const assetId of retainedAssetIdSet) {
		const asset = preparedByAssetId[assetId];
		if (asset) {
			retained[assetId] = asset;
		}
	}

	return retained;
}
