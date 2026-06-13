import type { AssetLookupRequestDto, AssetPriority } from "../host/contracts";
import {
	profileBrowserJsScope,
	profileBrowserJsScopeAsync,
	recordBrowserJsProfileSample,
} from "../diagnostics/browser-js-profiler";
import {
	classifyAssetRequestProfileKind,
	classifyAssetHydration,
} from "./asset-hydration-policy";
import type { AssetGraphPreparationResult } from "./asset-graph-scheduler";
import {
	DEFAULT_PREPARED_ASSET_PRUNE_EVALUATION_BATCH_SIZE,
	DEFAULT_PREPARED_ASSET_PRUNE_EVICTION_BATCH_SIZE,
	DEFAULT_PREPARED_ASSET_PRUNE_INTERVAL_MS,
	DEFAULT_PREPARED_ASSET_WARM_RETAIN_MS,
	planPreparedAssetCachePruneBatchFromResolver,
	type PreparedAssetCachePruneBatchPlan,
} from "./asset-cache-policy";
import { recordPreparedAssetPruneDiagnostics } from "./prepared-asset-hot-path-diagnostics";
import type { PreparedAssetResolver } from "./prepared-asset-store";
import {
	describeSceneResourceInterestKey,
	type SceneResourceInterest,
} from "../scene-runtime/scene-resource-interest";
import type { ClientAssetRuntime } from "../scene-runtime/scene-resource-runtime";
import {
	createSceneCoverageRequests,
	deriveSceneCoverageAssetIds,
	deriveVisibleMaterialAssetIdsForSceneInterest,
	type OutdoorSceneRequestOptions,
} from "./scene-asset-request-planner";
import { NORMALIZED_MATERIAL_TEXTURE_PREPARATION_POLICY } from "./material-texture-preparation-policy";
import type { PreparedAssetRecord } from "./types";

interface SceneAssetChannel {
	prepareAsset(request: AssetLookupRequestDto): Promise<PreparedAssetRecord>;
	prepareAssetGraph(
		rootRequest: AssetLookupRequestDto,
		preparedAssetResolver?: PreparedAssetResolver,
	): Promise<AssetGraphPreparationResult>;
}

export interface SceneAssetStreamingControllerDeps {
	assetChannel: SceneAssetChannel;
	preparedAssetResolver: PreparedAssetResolver;
	markAssetsPending(requests: AssetLookupRequestDto[]): void;
	applyPreparedAssets(assets: PreparedAssetRecord[]): void;
	applyAssetCachePruneBatch(prunePlan: PreparedAssetCachePruneBatchPlan): void;
	applyAssetError(request: AssetLookupRequestDto, message: string): void;
	debugLog(label: string, detail: unknown): void;
	nowMs?(): number;
	warmRetainMs?: number;
	pruneIntervalMs?: number;
	pruneEvaluationBatchSize?: number;
	pruneEvictionBatchSize?: number;
	setTimeoutFn?: typeof setTimeout;
	clearTimeoutFn?: typeof clearTimeout;
}

export class SceneAssetStreamingController implements ClientAssetRuntime {
	private readonly inFlightAssetIds = new Set<string>();
	private latestInput: SceneResourceInterest | null = null;
	private lastSyncedKey: string | null = null;
	private requestRevision = 0;
	private running = false;
	private disposed = false;
	private pruneTimer: ReturnType<typeof setTimeout> | null = null;
	private pruneCursorAssetId: string | null = null;
	private latestActiveCoverageAssetIds: readonly string[] = [];

	constructor(private readonly deps: SceneAssetStreamingControllerDeps) {}

	get preparedAssetResolver(): PreparedAssetResolver {
		return this.deps.preparedAssetResolver;
	}

	syncSceneInterest(sceneInterest: SceneResourceInterest): void {
		if (this.disposed) {
			return;
		}

		this.latestInput = sceneInterest;
		this.schedulePreparedCachePrune();
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
		this.clearPreparedCachePruneTimer();
	}

	private async runSyncLoop(): Promise<void> {
		try {
			while (!this.disposed && this.latestInput) {
				const input = this.latestInput;
				const syncKey = profileBrowserJsScope(
					"asset-stream.createSceneInterestSyncKey",
					() =>
						createSceneInterestSyncKey(
							input,
							this.deps.preparedAssetResolver.getPreparedRevision(),
						),
				);
				if (syncKey === this.lastSyncedKey) {
					break;
				}

				this.lastSyncedKey = syncKey;
				this.requestRevision += 1;
				this.deps.debugLog("coverage-key", {
					coverageKey: syncKey,
					sceneInterest: describeSceneResourceInterestKey(input),
					requestRevision: this.requestRevision,
				});

				await profileBrowserJsScopeAsync(
					"asset-stream.syncPriority.bootstrap",
					() => this.syncPriority(input, "bootstrap"),
				);
				await profileBrowserJsScopeAsync(
					"asset-stream.syncPriority.streaming",
					() => this.syncPriority(input, "streaming"),
				);

				if (this.latestInput === input) {
					break;
				}
			}
		} finally {
			this.running = false;
			if (!this.disposed && this.latestInput) {
				const syncKey = createSceneInterestSyncKey(
					this.latestInput,
					this.deps.preparedAssetResolver.getPreparedRevision(),
				);
				if (syncKey !== this.lastSyncedKey) {
					this.syncSceneInterest(this.latestInput);
				}
			}
		}
	}

	private async syncPriority(
		sceneInterest: SceneResourceInterest,
		priority: AssetPriority,
	): Promise<void> {
		if (this.disposed) {
			return;
		}

		const preparedAssets = this.deps.preparedAssetResolver;
		this.latestActiveCoverageAssetIds = deriveSceneCoverageAssetIds(
			sceneInterest,
			preparedAssets,
			NORMALIZED_MATERIAL_TEXTURE_PREPARATION_POLICY,
		);
		const requests = profileBrowserJsScope(
			`asset-stream.planRequests.${priority}`,
			() =>
				createSceneCoverageRequests(
					{
						requestRevision: this.requestRevision,
						sceneInterest,
						preparedAssets,
						pendingAssetIds: [...this.inFlightAssetIds],
						materialTexturePreparationPolicy:
							NORMALIZED_MATERIAL_TEXTURE_PREPARATION_POLICY,
					},
					priority,
				),
		);

		this.deps.debugLog("scene-coverage", {
			priority,
			requestRevision: this.requestRevision,
			sceneInterest: describeSceneResourceInterestKey(sceneInterest),
			preparedCount: preparedAssets.getPreparedCount(),
			inFlightAssetIds: [...this.inFlightAssetIds],
			requestAssetIds: requests.map((request) => request.assetId),
		});
		reportMaterialGraphRequests({
			priority,
			requestRevision: this.requestRevision,
			requests,
			preparedAssets,
			inFlightAssetIds: [...this.inFlightAssetIds],
		});
		reportMaterialPlannerMismatch({
			priority,
			requestRevision: this.requestRevision,
			sceneInterest,
			preparedAssets,
			pendingAssetIds: [...this.inFlightAssetIds],
			requests,
			materialTexturePreparationPolicy:
				NORMALIZED_MATERIAL_TEXTURE_PREPARATION_POLICY,
		});

		if (requests.length === 0) {
			return;
		}

		for (const request of requests) {
			this.inFlightAssetIds.add(request.assetId);
		}
		recordAssetStreamBatchShape(priority, requests);
		profileBrowserJsScope("asset-stream.markAssetsPending", () => {
			this.deps.markAssetsPending(requests);
		});

		await profileBrowserJsScopeAsync(
			`asset-stream.prepareBatch.${priority}`,
			() =>
				Promise.allSettled(
					requests.map((request) => this.prepareAndApplyRequest(request)),
				),
		);
		this.schedulePreparedCachePrune();
	}

	private schedulePreparedCachePrune(): void {
		if (this.disposed || this.pruneTimer !== null) {
			return;
		}
		const setTimeoutFn = this.deps.setTimeoutFn ?? setTimeout;
		this.pruneTimer = setTimeoutFn(
			() => this.runPreparedCachePruneTick(),
			this.deps.pruneIntervalMs ?? DEFAULT_PREPARED_ASSET_PRUNE_INTERVAL_MS,
		);
	}

	private clearPreparedCachePruneTimer(): void {
		if (this.pruneTimer === null) {
			return;
		}
		const clearTimeoutFn = this.deps.clearTimeoutFn ?? clearTimeout;
		clearTimeoutFn(this.pruneTimer);
		this.pruneTimer = null;
	}

	private runPreparedCachePruneTick(): void {
		this.pruneTimer = null;
		const input = this.latestInput;
		if (this.disposed || !input) {
			return;
		}
		profileBrowserJsScope("asset-stream.prunePreparedCacheBatch", () => {
			this.prunePreparedCacheBatch();
		});
		this.schedulePreparedCachePrune();
	}

	private prunePreparedCacheBatch(): void {
		if (this.disposed) {
			return;
		}

		const startedAtMs = performance.now();
		const prunePlan = this.planPreparedCachePruneBatch();
		this.pruneCursorAssetId = prunePlan.nextCursorAssetId;
		const completedAtMs = this.deps.nowMs?.() ?? Date.now();
		recordPreparedAssetPruneDiagnostics({
			source: "scene-asset-streaming-controller",
			durationMs: performance.now() - startedAtMs,
			evaluatedAssetCount: prunePlan.evaluatedAssetCount,
			evictedAssetCount: prunePlan.evictedAssetIds.length,
			retainedAssetCount: prunePlan.retainedAssetIds.length,
			completedAtMs,
		});

		this.deps.debugLog("asset-cache-prune", {
			retainedAssetCount: prunePlan.retainedAssetIds.length,
			evictedAssetCount: prunePlan.evictedAssetIds.length,
			evaluatedAssetCount: prunePlan.evaluatedAssetCount,
			nextCursorAssetId: prunePlan.nextCursorAssetId,
			nextWarmPruneAtMs: prunePlan.nextWarmPruneAtMs,
		});
		profileBrowserJsScope("asset-stream.applyAssetCachePruneBatch", () => {
			this.deps.applyAssetCachePruneBatch(prunePlan);
		});
	}

	private planPreparedCachePruneBatch(): PreparedAssetCachePruneBatchPlan {
		const maxEvaluatedAssetCount =
			this.deps.pruneEvaluationBatchSize ??
			DEFAULT_PREPARED_ASSET_PRUNE_EVALUATION_BATCH_SIZE;
		const preparedAssetScan =
			this.deps.preparedAssetResolver.scanPreparedAssets({
				cursorAssetId: this.pruneCursorAssetId,
				limit: maxEvaluatedAssetCount,
			});
		return planPreparedAssetCachePruneBatchFromResolver({
			preparedAssets: this.deps.preparedAssetResolver,
			candidateEntries: preparedAssetScan.entries,
			nextCandidateCursorAssetId: preparedAssetScan.nextCursorAssetId,
			activeCoverageAssetIds: this.latestActiveCoverageAssetIds,
			inFlightAssetIds: [...this.inFlightAssetIds],
			nowMs: this.deps.nowMs?.() ?? Date.now(),
			warmRetainMs:
				this.deps.warmRetainMs ?? DEFAULT_PREPARED_ASSET_WARM_RETAIN_MS,
			maxEvaluatedAssetCount,
			maxEvictedAssetCount:
				this.deps.pruneEvictionBatchSize ??
				DEFAULT_PREPARED_ASSET_PRUNE_EVICTION_BATCH_SIZE,
		});
	}

	private async prepareAndApplyRequest(
		request: AssetLookupRequestDto,
	): Promise<void> {
		const hydrationKind = classifyAssetHydration(request.assetId);
		try {
			const preparedAssets = await profileBrowserJsScopeAsync(
				`asset-stream.prepareRequest.${hydrationKind}.${classifyAssetRequestProfileKind(
					request.assetId,
				)}`,
				async () => {
					const assets =
						hydrationKind === "direct"
							? [await this.deps.assetChannel.prepareAsset(request)]
							: (
									await this.deps.assetChannel.prepareAssetGraph(
										request,
										this.deps.preparedAssetResolver,
									)
								).preparedAssets;
					recordPreparedAssetOutputShape(hydrationKind, assets);
					return assets;
				},
			);

			if (this.disposed) {
				return;
			}

			profileBrowserJsScope("asset-stream.applyPreparedAssets", () => {
				this.deps.applyPreparedAssets(preparedAssets);
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const detail = {
				request,
				hydrationKind,
				message,
				messageChunks: chunkDiagnosticString(message),
				preparedAssetCounts: countPreparedAssetsByKind(
					this.deps.preparedAssetResolver.values(),
				),
				inFlightAssetIds: [...this.inFlightAssetIds],
			};
			console.error("[holtburger-3d][asset-graph][diag-2026-05-24a]", detail);
			this.deps.debugLog("asset-error", detail);
			if (!this.disposed) {
				this.deps.applyAssetError(request, message);
			}
		} finally {
			this.inFlightAssetIds.delete(request.assetId);
		}
	}
}

function recordAssetStreamBatchShape(
	priority: AssetPriority,
	requests: readonly AssetLookupRequestDto[],
): void {
	recordBrowserJsProfileSample(
		`asset-stream.batchRequestCount.${priority}`,
		requests.length,
	);
	for (const request of requests) {
		recordBrowserJsProfileSample(
			`asset-stream.batchRequestKind.${priority}.${classifyAssetRequestProfileKind(
				request.assetId,
			)}`,
			0,
		);
		recordBrowserJsProfileSample(
			`asset-stream.batchHydration.${priority}.${classifyAssetHydration(
				request.assetId,
			)}`,
			0,
		);
	}
}

function recordPreparedAssetOutputShape(
	hydrationKind: ReturnType<typeof classifyAssetHydration>,
	assets: readonly PreparedAssetRecord[],
): void {
	recordBrowserJsProfileSample(
		`asset-stream.preparedOutputCount.${hydrationKind}`,
		assets.length,
	);
	for (const asset of assets) {
		recordBrowserJsProfileSample(
			`asset-stream.preparedOutputKind.${hydrationKind}.${asset.payload.kind}`,
			0,
		);
	}
}

function countPreparedAssetsByKind(
	preparedAssets: Iterable<PreparedAssetRecord>,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const asset of preparedAssets) {
		counts[asset.payload.kind] = (counts[asset.payload.kind] ?? 0) + 1;
	}
	return counts;
}

function chunkDiagnosticString(value: string, chunkSize = 120): string[] {
	const chunks: string[] = [];
	for (let index = 0; index < value.length; index += chunkSize) {
		chunks.push(value.slice(index, index + chunkSize));
	}
	return chunks;
}

function reportMaterialGraphRequests(options: {
	priority: AssetPriority;
	requestRevision: number;
	requests: readonly AssetLookupRequestDto[];
	preparedAssets: PreparedAssetResolver;
	inFlightAssetIds: string[];
}): void {
	const materialRequests = options.requests.filter((request) =>
		request.assetId.startsWith("material/"),
	);
	if (materialRequests.length === 0) {
		return;
	}

	console.info("[holtburger-3d][asset-graph][material-requested]", {
		priority: options.priority,
		requestRevision: options.requestRevision,
		requestCount: materialRequests.length,
		requestAssetIds: materialRequests
			.map((request) => request.assetId)
			.slice(0, 32),
		preparedAssetCounts: countPreparedAssetsByKind(
			options.preparedAssets.values(),
		),
		inFlightMaterialAssetIds: options.inFlightAssetIds
			.filter((assetId) => assetId.startsWith("material/"))
			.slice(0, 32),
	});
}

function reportMaterialPlannerMismatch(options: {
	priority: AssetPriority;
	requestRevision: number;
	sceneInterest: SceneResourceInterest;
	preparedAssets: PreparedAssetResolver;
	pendingAssetIds: string[];
	requests: readonly AssetLookupRequestDto[];
	materialTexturePreparationPolicy: OutdoorSceneRequestOptions["materialTexturePreparationPolicy"];
}): void {
	const materialRequests = options.requests.filter((request) =>
		request.assetId.startsWith("material/"),
	);
	if (materialRequests.length > 0) {
		return;
	}

	const visibleMaterialAssetIds = deriveVisibleMaterialAssetIdsForSceneInterest(
		{
			sceneInterest: options.sceneInterest,
			preparedAssets: options.preparedAssets,
			pendingAssetIds: options.pendingAssetIds,
			materialTexturePreparationPolicy:
				options.materialTexturePreparationPolicy,
		},
	);
	if (visibleMaterialAssetIds.length === 0) {
		return;
	}

	console.error("[holtburger-3d][asset-planner][material-mismatch]", {
		priority: options.priority,
		requestRevision: options.requestRevision,
		visibleMaterialAssetIds: visibleMaterialAssetIds.slice(0, 64),
		visibleMaterialCount: visibleMaterialAssetIds.length,
		preparedAssetCounts: countPreparedAssetsByKind(
			options.preparedAssets.values(),
		),
		pendingMaterialAssetIds: options.pendingAssetIds
			.filter((assetId) => assetId.startsWith("material/"))
			.slice(0, 64),
	});
}

function createSceneInterestSyncKey(
	sceneInterest: SceneResourceInterest,
	preparedRevision: number,
): string {
	return [
		describeSceneResourceInterestKey(sceneInterest),
		`prepared-revision-${preparedRevision}`,
	].join(":");
}
