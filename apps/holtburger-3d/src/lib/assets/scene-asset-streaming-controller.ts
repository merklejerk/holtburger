import type { BrowserLocationSelection } from "../../app/browser-mode";
import type {
	AssetLookupRequestDto,
	AssetPriority,
	RuntimeBatchDto,
} from "../host/contracts";
import {
	classifyAssetHydration,
	isSceneCoverageAssetId,
} from "./asset-hydration-policy";
import type { AssetChannelController } from "./asset-channel";
import { createSceneCoverageRequests } from "./scene-asset-request-planner";
import type { PreparedAssetRecord } from "./types";

export interface SceneAssetStreamingInput {
	runtimeBatch: RuntimeBatchDto | null;
	browserDestination: BrowserLocationSelection | null;
	terrainLodRadius: number;
	buildingLodRadius: number;
	detailLodRadius: number;
	structuredInteriorMaxEnvCells: number;
	structuredInteriorMaxVisibleCellDepth: number;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
}

export interface SceneAssetStreamingControllerDeps {
	assetChannel: AssetChannelController;
	getPreparedByAssetId(): Record<string, PreparedAssetRecord>;
	markAssetsPending(requests: AssetLookupRequestDto[]): void;
	applyPreparedAssets(assets: PreparedAssetRecord[]): void;
	applyAssetError(request: AssetLookupRequestDto, message: string): void;
	debugLog(label: string, detail: unknown): void;
}

export class SceneAssetStreamingController {
	private readonly inFlightAssetIds = new Set<string>();
	private latestInput: SceneAssetStreamingInput | null = null;
	private lastSyncedKey: string | null = null;
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
				if (!input.runtimeBatch || syncKey === this.lastSyncedKey) {
					break;
				}

				this.lastSyncedKey = syncKey;
				this.deps.debugLog("coverage-key", {
					coverageKey: syncKey,
					destination: input.browserDestination?.label ?? null,
					terrainLodRadius: input.terrainLodRadius,
					buildingLodRadius: input.buildingLodRadius,
					detailLodRadius: input.detailLodRadius,
					structuredInteriorMaxEnvCells: input.structuredInteriorMaxEnvCells,
					structuredInteriorMaxVisibleCellDepth:
						input.structuredInteriorMaxVisibleCellDepth,
					runtimeTick: input.runtimeBatch.tick,
				});

				await this.syncPriority(input, "bootstrap");
				await this.syncPriority(input, "streaming");

				if (this.latestInput === input) {
					break;
				}
			}
		} finally {
			this.running = false;
			if (!this.disposed && this.latestInput) {
				const syncKey = createSceneInterestSyncKey(this.latestInput);
				if (this.latestInput.runtimeBatch && syncKey !== this.lastSyncedKey) {
					this.syncSceneInterest(this.latestInput);
				}
			}
		}
	}

	private async syncPriority(
		input: SceneAssetStreamingInput,
		priority: AssetPriority,
	): Promise<void> {
		const runtimeBatch = input.runtimeBatch;
		if (!runtimeBatch || this.disposed) {
			return;
		}

		const preparedByAssetId = this.deps.getPreparedByAssetId();
		const requests = createSceneCoverageRequests(
			runtimeBatch,
			input.browserDestination,
			priority,
			preparedByAssetId,
			[...this.inFlightAssetIds],
			{
				terrainRadius: input.terrainLodRadius,
				buildingRadius: input.buildingLodRadius,
				detailRadius: input.detailLodRadius,
				structuredInterior: {
					maxEnvCells: input.structuredInteriorMaxEnvCells,
					maxVisibleCellDepth: input.structuredInteriorMaxVisibleCellDepth,
				},
			},
		);

		this.deps.debugLog("scene-coverage", {
			priority,
			tick: runtimeBatch.tick,
			destination: input.browserDestination?.label ?? null,
			terrainLodRadius: input.terrainLodRadius,
			buildingLodRadius: input.buildingLodRadius,
			detailLodRadius: input.detailLodRadius,
			structuredInteriorMaxEnvCells: input.structuredInteriorMaxEnvCells,
			structuredInteriorMaxVisibleCellDepth:
				input.structuredInteriorMaxVisibleCellDepth,
			preparedCount: Object.keys(preparedByAssetId).length,
			inFlightAssetIds: [...this.inFlightAssetIds],
			requestAssetIds: requests.map((request) => request.assetId),
		});

		if (requests.length === 0) {
			return;
		}

		for (const request of requests) {
			this.inFlightAssetIds.add(request.assetId);
		}
		this.deps.markAssetsPending(requests);

		await Promise.allSettled(
			requests.map((request) => this.prepareAndApplyRequest(request)),
		);
	}

	private async prepareAndApplyRequest(
		request: AssetLookupRequestDto,
	): Promise<void> {
		try {
			this.deps.debugLog("asset-request", request);
			const preparedAssets =
				classifyAssetHydration(request.assetId) === "direct"
					? [await this.deps.assetChannel.prepareAsset(request)]
					: (
							await this.deps.assetChannel.prepareAssetGraph(request, {
								...this.deps.getPreparedByAssetId(),
							})
						).preparedAssets;
			this.deps.debugLog("asset-prepared", {
				rootAssetId: request.assetId,
				preparedAssetIds: preparedAssets.map((asset) => asset.request.assetId),
			});

			if (this.disposed) {
				return;
			}

			for (const preparedAsset of preparedAssets) {
				const invalidPolygons =
					preparedAsset.payload.kind === "gfx-obj"
						? preparedAsset.payload.renderGeometry.invalidPolygons
						: undefined;
				this.deps.debugLog("asset-apply", {
					assetId: preparedAsset.request.assetId,
					kind: preparedAsset.payload.kind,
					invalidPolygons,
				});
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
		`interior-cells-${input.structuredInteriorMaxEnvCells}`,
		`interior-depth-${input.structuredInteriorMaxVisibleCellDepth}`,
		`prepared-${preparedSceneAssetKey}`,
	].join(":");

	return destination
		? `${destination.source}:${destination.label}:${interestKey}`
		: `runtime:${interestKey}`;
}
