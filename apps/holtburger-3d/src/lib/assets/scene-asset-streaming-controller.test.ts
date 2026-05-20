import { describe, expect, it, vi } from "vitest";

import {
	applyAssetCachePrune,
	applyPreparedAssets,
	createAssetState,
} from "../../app/asset-state";
import { createRuntimeBatch } from "../../app/test-fixtures";
import type { AssetChannelState, PreparedAssetRecord } from "./types";
import {
	SceneAssetStreamingController,
	type SceneAssetChannel,
} from "./scene-asset-streaming-controller";

describe("SceneAssetStreamingController cache pruning", () => {
	it("keeps recently retained assets warm so backtracking does not re-request them", async () => {
		let nowMs = 10_000;
		let assetState = applyPreparedAssets(
			createAssetState(),
			[createPreparedLandblockPackAsset("landblock-pack/0102ffff")],
			9_500,
		);
		const requestedAssetIds: string[] = [];
		const controller = createController({
			getNowMs: () => nowMs,
			getAssetState: () => assetState,
			setAssetState: (next) => {
				assetState = next;
			},
			requestedAssetIds,
		});

		controller.syncSceneInterest(createStreamingInput(assetState, 0x01030003));
		await vi.waitFor(() =>
			expect(
				assetState.preparedByAssetId["landblock-pack/0102ffff"],
			).toBeDefined(),
		);

		nowMs = 10_100;
		controller.syncSceneInterest(createStreamingInput(assetState, 0x01020003));
		await vi.waitFor(() =>
			expect(requestedAssetIds).toContain("landblock-pack/0103ffff"),
		);

		expect(
			requestedAssetIds.filter(
				(assetId) => assetId === "landblock-pack/0102ffff",
			),
		).toHaveLength(0);
		controller.dispose();
	});

	it("evicts expired warm assets so older revisits request the missing root again", async () => {
		let nowMs = 10_000;
		let assetState = applyPreparedAssets(
			createAssetState(),
			[createPreparedLandblockPackAsset("landblock-pack/0102ffff")],
			1_000,
		);
		const requestedAssetIds: string[] = [];
		const controller = createController({
			getNowMs: () => nowMs,
			getAssetState: () => assetState,
			setAssetState: (next) => {
				assetState = next;
			},
			requestedAssetIds,
		});

		controller.syncSceneInterest(createStreamingInput(assetState, 0x01030003));
		await vi.waitFor(() =>
			expect(
				assetState.preparedByAssetId["landblock-pack/0102ffff"],
			).toBeUndefined(),
		);

		nowMs = 10_100;
		controller.syncSceneInterest(createStreamingInput(assetState, 0x01020003));
		await vi.waitFor(() =>
			expect(requestedAssetIds).toContain("landblock-pack/0102ffff"),
		);

		controller.dispose();
	});
});

function createController({
	getNowMs,
	getAssetState,
	setAssetState,
	requestedAssetIds,
}: {
	getNowMs(): number;
	getAssetState(): AssetChannelState;
	setAssetState(assetState: AssetChannelState): void;
	requestedAssetIds: string[];
}): SceneAssetStreamingController {
	const assetChannel: SceneAssetChannel = {
		async prepareAsset(request) {
			requestedAssetIds.push(request.assetId);
			return createPreparedAssetForRequest(request.assetId);
		},
		async prepareAssetGraph(rootRequest) {
			requestedAssetIds.push(rootRequest.assetId);
			const preparedAsset = createPreparedAssetForRequest(rootRequest.assetId);
			return {
				rootAsset: preparedAsset,
				preparedAssets: [preparedAsset],
				preparedByAssetId: {
					[rootRequest.assetId]: preparedAsset,
				},
				dependencyStatus: {
					status: "ready",
					dependencyAssetIds: [],
					readyAssetIds: [],
					missingAssetIds: [],
					pendingAssetIds: [],
				},
			};
		},
	};

	return new SceneAssetStreamingController({
		assetChannel,
		getPreparedByAssetId: () => getAssetState().preparedByAssetId,
		getCacheMetadataByAssetId: () => getAssetState().cacheMetadataByAssetId,
		markAssetsPending: () => {},
		applyPreparedAssets: (assets) =>
			setAssetState(applyPreparedAssets(getAssetState(), assets, getNowMs())),
		applyAssetCachePrune: (prunePlan) =>
			setAssetState(applyAssetCachePrune(getAssetState(), prunePlan)),
		applyAssetError: (_request, message) => {
			throw new Error(message);
		},
		debugLog: () => {},
		nowMs: getNowMs,
		warmRetainMs: 1_000,
	});
}

function createStreamingInput(
	assetState: AssetChannelState,
	focusLandblockId: number,
) {
	return {
		runtimeBatch: createRuntimeBatch({
			residency: {
				focusEntityId: null,
				focusLandblockId,
				focusCellId: focusLandblockId & 0xffff,
				focusEnvCellId: null,
				visibleCellIds: [],
				seenOutside: null,
				environmentId: null,
				cellStructureId: null,
				focusLocationLabel: "outdoor",
				indoors: false,
				trackedBodyCount: 0,
			},
		}),
		browserDestination: null,
		terrainLodRadius: 0,
		buildingLodRadius: 0,
		detailLodRadius: 0,
		envCellLodRadius: 0,
		preparedByAssetId: assetState.preparedByAssetId,
	};
}

function createPreparedAssetForRequest(assetId: string): PreparedAssetRecord {
	if (assetId.startsWith("landblock-pack/")) {
		return createPreparedLandblockPackAsset(assetId);
	}

	return {
		request: {
			requestId: `request-${assetId}`,
			assetId,
			priority: "streaming",
		},
		response: {
			requestId: `request-${assetId}`,
			assetId,
			payloadKind: "json",
			payload: { kind: "dependency-manifest" },
		},
		payload: {
			kind: "dependency-manifest",
			sourceAssetKind: "dependency-manifest",
			residencyKind: "unknown",
			provenance: {
				source: "unknown",
				sourceAssetKind: "dependency-manifest",
				errorCode: null,
				detail: null,
			},
			dependencyAssetIds: [],
		},
		preparedAt: "2026-04-26T00:00:00.000Z",
	};
}

function createPreparedLandblockPackAsset(
	assetId: string,
): PreparedAssetRecord {
	return {
		request: {
			requestId: `request-${assetId}`,
			assetId,
			priority: "streaming",
		},
		response: {
			requestId: `request-${assetId}`,
			assetId,
			payloadKind: "json",
			payload: { kind: "dependency-manifest" },
		},
		payload: {
			kind: "dependency-manifest",
			sourceAssetKind: "dependency-manifest",
			residencyKind: "unknown",
			provenance: {
				source: "unknown",
				sourceAssetKind: "dependency-manifest",
				errorCode: null,
				detail: null,
			},
			dependencyAssetIds: [],
		},
		preparedAt: "2026-04-26T00:00:00.000Z",
	};
}
