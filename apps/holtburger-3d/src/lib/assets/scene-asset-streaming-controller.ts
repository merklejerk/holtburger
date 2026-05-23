import {
	describeBrowserDestinationIdentity,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import type { AssetLookupRequestDto, AssetPriority } from "../host/contracts";
import {
	classifyAssetHydration,
	isSceneCoverageAssetId,
} from "./asset-hydration-policy";
import type { AssetGraphPreparationResult } from "./asset-graph-scheduler";
import {
	DEFAULT_PREPARED_ASSET_WARM_RETAIN_MS,
	planPreparedAssetCachePrune,
	type PreparedAssetCachePrunePlan,
} from "./asset-cache-policy";
import {
	createSceneCoverageRequests,
	deriveSceneCoverageAssetIds,
} from "./scene-asset-request-planner";
import type { PreparedAssetCacheMetadata, PreparedAssetRecord } from "./types";

const DEFAULT_SCENE_ASSET_REQUEST_CONCURRENCY_LIMIT = 4;

interface SceneAssetChannel {
	prepareAsset(request: AssetLookupRequestDto): Promise<PreparedAssetRecord>;
	prepareAssetGraph(
		rootRequest: AssetLookupRequestDto,
		preparedByAssetId?: Record<string, PreparedAssetRecord>,
	): Promise<AssetGraphPreparationResult>;
}

export interface SceneAssetStreamingInput {
	browserDestination: BrowserLocationSelection | null;
	terrainLodRadius: number;
	buildingLodRadius: number;
	detailLodRadius: number;
	envCellLodRadius: number;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
}

export interface SceneAssetStreamingControllerDeps {
	assetChannel: SceneAssetChannel;
	getPreparedByAssetId(): Record<string, PreparedAssetRecord>;
	getCacheMetadataByAssetId(): Record<string, PreparedAssetCacheMetadata>;
	markAssetsPending(requests: AssetLookupRequestDto[]): void;
	applyPreparedAssets(assets: PreparedAssetRecord[]): void;
	applyAssetCachePrune(prunePlan: PreparedAssetCachePrunePlan): void;
	applyAssetError(request: AssetLookupRequestDto, message: string): void;
	debugLog(label: string, detail: unknown): void;
	requestConcurrencyLimit?: number;
	nowMs?(): number;
	warmRetainMs?: number;
}

export class SceneAssetStreamingController {
	private readonly inFlightAssetIds = new Set<string>();
	private latestInput: SceneAssetStreamingInput | null = null;
	private lastSyncedKey: string | null = null;
	private requestRevision = 0;
	private running = false;
	private disposed = false;

	constructor(private readonly deps: SceneAssetStreamingControllerDeps) {}

	syncSceneInterest(input: SceneAssetStreamingInput): void {
		if (this.disposed) {
			return;
		}

		this.latestInput = input;
		if (this.running) {
			return;
		}

		this.running = true;
		void this.runSyncLoop();
	}

	dispose(): void {
		this.disposed = true;
		this.latestInput = null;
		this.inFlightAssetIds.clear();
	}

	private async runSyncLoop(): Promise<void> {
		try {
			while (!this.disposed && this.latestInput) {
				const input = this.latestInput;
				const syncKey = createSceneInterestSyncKey(input);
				if (syncKey === this.lastSyncedKey) {
					break;
				}

				this.lastSyncedKey = syncKey;
				this.requestRevision += 1;
				this.deps.debugLog("coverage-key", {
					coverageKey: syncKey,
					destination: describeBrowserDestinationIdentity(
						input.browserDestination,
					),
					terrainLodRadius: input.terrainLodRadius,
					buildingLodRadius: input.buildingLodRadius,
					detailLodRadius: input.detailLodRadius,
					envCellLodRadius: input.envCellLodRadius,
					requestRevision: this.requestRevision,
				});

				await this.syncPriority(input, "bootstrap");
				await this.syncPriority(input, "streaming");
				this.prunePreparedCache(input);

				if (this.latestInput === input) {
					break;
				}
			}
		} finally {
			this.running = false;
			if (!this.disposed && this.latestInput) {
				const syncKey = createSceneInterestSyncKey(this.latestInput);
				if (syncKey !== this.lastSyncedKey) {
					this.syncSceneInterest(this.latestInput);
				}
			}
		}
	}

	private async syncPriority(
		input: SceneAssetStreamingInput,
		priority: AssetPriority,
	): Promise<void> {
		if (this.disposed) {
			return;
		}

		const preparedByAssetId = this.deps.getPreparedByAssetId();
		const requests = createSceneCoverageRequests(
			{
				requestRevision: this.requestRevision,
				browserDestination: input.browserDestination,
				preparedByAssetId,
				pendingAssetIds: [...this.inFlightAssetIds],
				options: {
					terrainRadius: input.terrainLodRadius,
					buildingRadius: input.buildingLodRadius,
					detailRadius: input.detailLodRadius,
					envCellRadius: input.envCellLodRadius,
				},
			},
			priority,
		);

		this.deps.debugLog("scene-coverage", {
			priority,
			requestRevision: this.requestRevision,
			destination: describeBrowserDestinationIdentity(input.browserDestination),
			terrainLodRadius: input.terrainLodRadius,
			buildingLodRadius: input.buildingLodRadius,
			detailLodRadius: input.detailLodRadius,
			envCellLodRadius: input.envCellLodRadius,
			preparedCount: Object.keys(preparedByAssetId).length,
			inFlightAssetIds: [...this.inFlightAssetIds],
			requestAssetIds: requests.map((request) => request.assetId),
		});

		if (requests.length === 0) {
			this.prunePreparedCache(input);
			return;
		}

		for (const request of requests) {
			this.inFlightAssetIds.add(request.assetId);
		}
		this.deps.markAssetsPending(requests);

		const requestConcurrencyLimit =
			this.deps.requestConcurrencyLimit ??
			DEFAULT_SCENE_ASSET_REQUEST_CONCURRENCY_LIMIT;
		await settleWithConcurrency(requests, requestConcurrencyLimit, async (request) =>
			this.prepareAndApplyRequest(request),
		);
		this.prunePreparedCache(input);
	}

	private prunePreparedCache(input: SceneAssetStreamingInput): void {
		if (this.disposed) {
			return;
		}

		const preparedByAssetId = this.deps.getPreparedByAssetId();
		const prunePlan = this.planPreparedCachePrune(input, preparedByAssetId);

		this.deps.debugLog("asset-cache-prune", {
			retainedAssetIds: prunePlan.retainedAssetIds,
			evictedAssetIds: prunePlan.evictedAssetIds,
			diagnostics: prunePlan.diagnostics,
		});
		this.deps.applyAssetCachePrune(prunePlan);
	}

	private planPreparedCachePrune(
		input: SceneAssetStreamingInput,
		preparedByAssetId: Record<string, PreparedAssetRecord>,
	): PreparedAssetCachePrunePlan {
		return planPreparedAssetCachePrune({
			preparedByAssetId,
			cacheMetadataByAssetId: this.deps.getCacheMetadataByAssetId(),
			activeCoverageAssetIds: deriveSceneCoverageAssetIds(
				input.browserDestination,
				preparedByAssetId,
				{
					terrainRadius: input.terrainLodRadius,
					buildingRadius: input.buildingLodRadius,
					detailRadius: input.detailLodRadius,
					envCellRadius: input.envCellLodRadius,
				},
			),
			inFlightAssetIds: [...this.inFlightAssetIds],
			nowMs: this.deps.nowMs?.() ?? Date.now(),
			warmRetainMs:
				this.deps.warmRetainMs ?? DEFAULT_PREPARED_ASSET_WARM_RETAIN_MS,
		});
	}

	private async prepareAndApplyRequest(
		request: AssetLookupRequestDto,
	): Promise<void> {
		try {
			const hydrationKind = classifyAssetHydration(request.assetId);
			const preparedAssets =
				hydrationKind === "direct"
					? [await this.deps.assetChannel.prepareAsset(request)]
					: (
							await this.deps.assetChannel.prepareAssetGraph(
								request,
								this.deps.getPreparedByAssetId(),
							)
						).preparedAssets;

			if (this.disposed) {
				return;
			}

			this.deps.applyPreparedAssets(preparedAssets);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.deps.debugLog("asset-error", { request, message });
			if (!this.disposed) {
				this.deps.applyAssetError(request, message);
			}
		} finally {
			this.inFlightAssetIds.delete(request.assetId);
		}
	}
}

function createSceneInterestSyncKey(input: SceneAssetStreamingInput): string {
	const preparedSceneAssetKey = Object.keys(input.preparedByAssetId)
		.filter(isSceneCoverageAssetId)
		.sort()
		.join(",");
	const destination = input.browserDestination;
	const interestKey = [
		`terrain-${input.terrainLodRadius}`,
		`buildings-${input.buildingLodRadius}`,
		`detail-${input.detailLodRadius}`,
		`env-cells-${input.envCellLodRadius}`,
		`prepared-${preparedSceneAssetKey}`,
	].join(":");

	const destinationIdentity = describeBrowserDestinationIdentity(destination);
	return destinationIdentity
		? `${destinationIdentity}:${interestKey}`
		: `none:${interestKey}`;
}

export async function settleWithConcurrency<T>(
	items: readonly T[],
	concurrencyLimit: number,
	work: (item: T) => Promise<void>,
): Promise<PromiseSettledResult<void>[]> {
	if (items.length === 0) {
		return [];
	}
	if (!Number.isInteger(concurrencyLimit) || concurrencyLimit <= 0) {
		throw new Error("Scene asset request concurrency limit must be positive.");
	}

	const results: PromiseSettledResult<void>[] = new Array(items.length);
	let nextIndex = 0;
	const workerCount = Math.min(concurrencyLimit, items.length);
	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (nextIndex < items.length) {
				const itemIndex = nextIndex;
				nextIndex += 1;
				try {
					await work(items[itemIndex] as T);
					results[itemIndex] = { status: "fulfilled", value: undefined };
				} catch (reason) {
					results[itemIndex] = { status: "rejected", reason };
				}
			}
		}),
	);
	return results;
}
