import type { AssetLookupRequestDto } from "../host/contracts";
import type { AssetPreparationGateway } from "./asset-channel";
import {
	derivePreparedAssetDependencyStatus,
	getPreparedAssetDependencies,
	type PreparedAssetDependencyStatus,
	type PreparedAssetRecord,
} from "./types";

export interface AssetGraphPreparationResult {
	rootAsset: PreparedAssetRecord;
	preparedAssets: PreparedAssetRecord[];
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	dependencyStatus: PreparedAssetDependencyStatus;
}

interface AssetGraphSchedulerOptions {
	lookupConcurrencyLimit?: number;
}

const DEFAULT_LOOKUP_CONCURRENCY_LIMIT = 4;

export class AssetGraphScheduler {
	private readonly lookupConcurrencyLimit: number;

	constructor(
		private readonly gateway: AssetPreparationGateway,
		options: AssetGraphSchedulerOptions = {},
	) {
		this.lookupConcurrencyLimit =
			options.lookupConcurrencyLimit ?? DEFAULT_LOOKUP_CONCURRENCY_LIMIT;
	}

	async prepareAssetGraph(
		rootRequest: AssetLookupRequestDto,
		preparedByAssetId: Record<string, PreparedAssetRecord> = {},
	): Promise<AssetGraphPreparationResult> {
		const graph = new GraphTraversalState(rootRequest, preparedByAssetId);
		const activeLookupTasks = new Set<Promise<void>>();
		const activePreparationTasks = new Set<Promise<void>>();

		const scheduleLookup = (request: AssetLookupRequestDto): void => {
			const lookupTask = this.runLookup(
				graph,
				request,
				activePreparationTasks,
			).finally(() => {
				activeLookupTasks.delete(lookupTask);
			});
			activeLookupTasks.add(lookupTask);
		};

		while (graph.hasReadyRequests() || activeLookupTasks.size > 0) {
			while (
				!graph.hasFailed() &&
				graph.hasReadyRequests() &&
				activeLookupTasks.size < this.lookupConcurrencyLimit
			) {
				const request = graph.shiftReadyRequest();
				if (request) {
					scheduleLookup(request);
				}
			}

			if (activeLookupTasks.size === 0) {
				break;
			}

			await Promise.race(activeLookupTasks);
		}

		await Promise.all(activePreparationTasks);
		return graph.toResult();
	}

	private async runLookup(
		graph: GraphTraversalState,
		request: AssetLookupRequestDto,
		activePreparationTasks: Set<Promise<void>>,
	): Promise<void> {
		try {
			const lookedUp = await this.gateway.lookupAssetResponse(request);
			graph.enqueueDependencies(lookedUp.dependencyAssetIds);
			const preparationTask = this.gateway
				.prepareLookedUpAsset(lookedUp, request)
				.then((asset) => {
					graph.addPreparedAsset(asset);
				})
				.catch((error: unknown) => {
					graph.addFailure(request.assetId, toError(error));
				})
				.finally(() => {
					activePreparationTasks.delete(preparationTask);
				});
			activePreparationTasks.add(preparationTask);
		} catch (error) {
			graph.addFailure(request.assetId, toError(error));
		}
	}
}

class GraphTraversalState {
	private readonly readyQueue: AssetLookupRequestDto[];
	private readonly scheduledAssetIds: Set<string>;
	private readonly failedAssetIds = new Map<string, Error>();
	private readonly preparedByAssetId: Record<string, PreparedAssetRecord>;
	private readonly returnOrderByAssetId = new Map<string, number>();
	private rootAsset: PreparedAssetRecord | null;

	constructor(
		private readonly rootRequest: AssetLookupRequestDto,
		initialPreparedByAssetId: Record<string, PreparedAssetRecord>,
	) {
		this.preparedByAssetId = { ...initialPreparedByAssetId };
		this.rootAsset = this.preparedByAssetId[rootRequest.assetId] ?? null;
		this.readyQueue = this.rootAsset ? [] : [rootRequest];
		this.scheduledAssetIds = new Set<string>([
			rootRequest.assetId,
			...Object.keys(this.preparedByAssetId),
		]);

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

	shiftReadyRequest(): AssetLookupRequestDto | null {
		return this.readyQueue.shift() ?? null;
	}

	hasFailed(): boolean {
		return this.failedAssetIds.size > 0;
	}

	enqueueDependencies(dependencyAssetIds: string[]): void {
		for (const dependencyAssetId of dependencyAssetIds) {
			if (
				this.scheduledAssetIds.has(dependencyAssetId) ||
				this.preparedByAssetId[dependencyAssetId]
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
		this.preparedByAssetId[asset.request.assetId] = asset;
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
			.map(([assetId]) => this.preparedByAssetId[assetId])
			.filter((asset): asset is PreparedAssetRecord => asset !== undefined);

		return {
			rootAsset: this.rootAsset,
			preparedAssets,
			preparedByAssetId: this.preparedByAssetId,
			dependencyStatus: derivePreparedAssetDependencyStatus(
				this.rootAsset,
				this.preparedByAssetId,
			),
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
