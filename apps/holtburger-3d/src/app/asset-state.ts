import {
	createInitialAssetChannelState,
	type AssetActivityRecord,
	type AssetChannelState,
	type PreparedAssetRecord,
} from "../lib/assets/types";
import type { AssetLookupRequestDto } from "../lib/host/contracts";

const MAX_ASSET_ACTIVITY = 8;

export function createAssetState(): AssetChannelState {
	return createInitialAssetChannelState();
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
): AssetChannelState {
	if (assets.length === 0) {
		return assetState;
	}

	const latestAsset = assets.at(-1);
	if (!latestAsset) {
		return assetState;
	}

	return {
		...assetState,
		status: "ready",
		activeRequest: latestAsset.request,
		preparedAsset: null,
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
