import type { AssetLookupRequestDto } from "../host/contracts";
import type { AssetPreparationGateway } from "./asset-channel";
import type { PreparedAssetResolver } from "./prepared-asset-store";
import {
	getPreparedAssetDependencies,
	type PreparedAssetDependencyStatus,
	type PreparedAssetRecord,
} from "./types";

export interface AssetGraphPreparationResult {
	rootAsset: PreparedAssetRecord;
	preparedAssets: PreparedAssetRecord[];
	dependencyStatus: PreparedAssetDependencyStatus;
}

export class AssetGraphScheduler {
	constructor(private readonly gateway: AssetPreparationGateway) {}

	async prepareAssetGraph(
		rootRequest: AssetLookupRequestDto,
		preparedAssetResolver?: PreparedAssetResolver,
	): Promise<AssetGraphPreparationResult> {
		const graph = new GraphTraversalState(rootRequest, preparedAssetResolver);
		const activeLookupTasks = new Set<Promise<void>>();

		const scheduleLookupBatch = (
			requests: readonly AssetLookupRequestDto[],
		): void => {
			const lookupTask = this.runLookupBatch(graph, requests).finally(() => {
				activeLookupTasks.delete(lookupTask);
			});
			activeLookupTasks.add(lookupTask);
		};

		while (graph.hasReadyRequests() || activeLookupTasks.size > 0) {
			if (!graph.hasFailed() && graph.hasReadyRequests()) {
				const requests = graph.shiftReadyRequests();
				if (requests.length > 0) {
					scheduleLookupBatch(requests);
				}
			}

			if (activeLookupTasks.size === 0) {
				break;
			}

			await Promise.race(activeLookupTasks);
		}

		return graph.toResult();
	}

	private async runLookupBatch(
		graph: GraphTraversalState,
		requests: readonly AssetLookupRequestDto[],
	): Promise<void> {
		try {
			const assets = await this.gateway.prepareAssets(requests);
			for (const asset of assets) {
				graph.addPreparedAsset(asset);
				graph.enqueueDependencies(
					getPreparedAssetDependencies(asset).map(
						(dependency) => dependency.assetId,
					),
				);
			}
		} catch (error) {
			const normalized = toError(error);
			for (const request of requests) {
				graph.addFailure(request.assetId, normalized);
			}
		}
	}
}

class GraphTraversalState {
	private readonly readyQueue: AssetLookupRequestDto[];
	private readonly scheduledAssetIds: Set<string>;
	private readonly failedAssetIds = new Map<string, Error>();
	private readonly preparedByAssetId = new Map<string, PreparedAssetRecord>();
	private readonly returnOrderByAssetId = new Map<string, number>();
	private rootAsset: PreparedAssetRecord | null;

	constructor(
		private readonly rootRequest: AssetLookupRequestDto,
		private readonly preparedAssetResolver?: PreparedAssetResolver,
	) {
		this.rootAsset = this.getPreparedAsset(rootRequest.assetId);
		this.readyQueue = this.rootAsset ? [] : [rootRequest];
		this.scheduledAssetIds = new Set<string>([rootRequest.assetId]);

		if (this.rootAsset) {
			this.enqueueDependencies(
				getPreparedAssetDependencies(this.rootAsset).map(
					(dependency) => dependency.assetId,
				),
			);
		} else {
			this.returnOrderByAssetId.set(rootRequest.assetId, 0);
		}
	}

	hasReadyRequests(): boolean {
		return this.readyQueue.length > 0;
	}

	shiftReadyRequests(): AssetLookupRequestDto[] {
		return this.readyQueue.splice(0);
	}

	hasFailed(): boolean {
		return this.failedAssetIds.size > 0;
	}

	enqueueDependencies(dependencyAssetIds: string[]): void {
		for (const dependencyAssetId of dependencyAssetIds) {
				if (
					this.scheduledAssetIds.has(dependencyAssetId) ||
					this.hasPreparedAsset(dependencyAssetId)
				) {
					continue;
				}

			this.scheduledAssetIds.add(dependencyAssetId);
			this.returnOrderByAssetId.set(
				dependencyAssetId,
				this.returnOrderByAssetId.size,
			);
			this.readyQueue.push(
				createDependencyRequest(this.rootRequest, dependencyAssetId),
			);
		}
	}

	addPreparedAsset(asset: PreparedAssetRecord): void {
		this.preparedByAssetId.set(asset.request.assetId, asset);
		if (asset.request.assetId === this.rootRequest.assetId) {
			this.rootAsset = asset;
		}
	}

	addFailure(assetId: string, error: Error): void {
		this.failedAssetIds.set(assetId, error);
	}

	toResult(): AssetGraphPreparationResult {
		const firstFailure = this.failedAssetIds.values().next().value as
			| Error
			| undefined;
		if (firstFailure) {
			throw firstFailure;
		}

		if (!this.rootAsset) {
			throw new Error(
				`Root asset ${this.rootRequest.assetId} was not prepared.`,
			);
		}

		const preparedAssets = [...this.returnOrderByAssetId.entries()]
			.sort(([, leftOrder], [, rightOrder]) => leftOrder - rightOrder)
			.map(([assetId]) => this.preparedByAssetId.get(assetId))
			.filter((asset): asset is PreparedAssetRecord => asset !== undefined);

		return {
			rootAsset: this.rootAsset,
			preparedAssets,
			dependencyStatus: this.deriveDependencyStatus(this.rootAsset),
		};
	}

	private getPreparedAsset(assetId: string): PreparedAssetRecord | null {
		return (
			this.preparedByAssetId.get(assetId) ??
			this.preparedAssetResolver?.get(assetId) ??
			null
		);
	}

	private hasPreparedAsset(assetId: string): boolean {
		return (
			this.preparedByAssetId.has(assetId) ||
			this.preparedAssetResolver?.has(assetId) === true
		);
	}

	private deriveDependencyStatus(
		asset: PreparedAssetRecord,
	): PreparedAssetDependencyStatus {
		const dependencyAssetIds = getPreparedAssetDependencies(asset).map(
			(dependency) => dependency.assetId,
		);
		const readyAssetIds = dependencyAssetIds.filter((assetId) =>
			this.hasPreparedAsset(assetId),
		);
		const missingAssetIds = dependencyAssetIds.filter(
			(assetId) => !this.hasPreparedAsset(assetId),
		);
		if (missingAssetIds.length === 0) {
			return {
				status: "ready",
				dependencyAssetIds,
				readyAssetIds,
				missingAssetIds: [],
				pendingAssetIds: [],
			};
		}
		return {
			status: readyAssetIds.length > 0 ? "partial-ready" : "awaiting-dependency",
			dependencyAssetIds,
			readyAssetIds,
			missingAssetIds,
			pendingAssetIds: [],
		};
	}
}

export function createDependencyRequest(
	rootRequest: AssetLookupRequestDto,
	dependencyAssetId: string,
): AssetLookupRequestDto {
	return {
		requestId: `${rootRequest.requestId}-dependency-${dependencyAssetId}`,
		assetId: dependencyAssetId,
		priority: rootRequest.priority,
	};
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
