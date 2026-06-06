import {
	describeBrowserDestinationIdentity,
	type BrowserLocationSelection,
} from "../../app/browser-mode";
import type { AssetLookupRequestDto, AssetPriority } from "../host/contracts";
import {
	profileBrowserJsScope,
	profileBrowserJsScopeAsync,
	recordBrowserJsProfileSample,
} from "../diagnostics/browser-js-profiler";
import {
	classifyAssetRequestProfileKind,
	classifyAssetHydration,
	isDirectSceneRootAssetId,
	isStaticRenderableAssetId,
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
	deriveVisibleMaterialAssetIdsForBrowserDestination,
	type OutdoorSceneRequestOptions,
} from "./scene-asset-request-planner";
import { NORMALIZED_MATERIAL_TEXTURE_PREPARATION_POLICY } from "./material-texture-preparation-policy";
import type { PreparedAssetCacheMetadata, PreparedAssetRecord } from "./types";

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
				const syncKey = profileBrowserJsScope(
					"asset-stream.createSceneInterestSyncKey",
					() => createSceneInterestSyncKey(input),
				);
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

				await profileBrowserJsScopeAsync(
					"asset-stream.syncPriority.bootstrap",
					() => this.syncPriority(input, "bootstrap"),
				);
				await profileBrowserJsScopeAsync(
					"asset-stream.syncPriority.streaming",
					() => this.syncPriority(input, "streaming"),
				);
				profileBrowserJsScope("asset-stream.prunePreparedCache", () => {
					this.prunePreparedCache(input);
				});

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
		const requests = profileBrowserJsScope(
			`asset-stream.planRequests.${priority}`,
			() =>
				createSceneCoverageRequests(
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
							materialTexturePreparationPolicy:
								NORMALIZED_MATERIAL_TEXTURE_PREPARATION_POLICY,
						},
					},
					priority,
				),
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
		reportMaterialGraphRequests({
			priority,
			requestRevision: this.requestRevision,
			requests,
			preparedByAssetId,
			inFlightAssetIds: [...this.inFlightAssetIds],
		});
		reportMaterialPlannerMismatch({
			priority,
			requestRevision: this.requestRevision,
			browserDestination: input.browserDestination,
			preparedByAssetId,
			pendingAssetIds: [...this.inFlightAssetIds],
			requests,
			options: {
				terrainRadius: input.terrainLodRadius,
				buildingRadius: input.buildingLodRadius,
				detailRadius: input.detailLodRadius,
				envCellRadius: input.envCellLodRadius,
			},
		});

		if (requests.length === 0) {
			profileBrowserJsScope("asset-stream.prunePreparedCache", () => {
				this.prunePreparedCache(input);
			});
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
		profileBrowserJsScope("asset-stream.prunePreparedCache", () => {
			this.prunePreparedCache(input);
		});
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
		profileBrowserJsScope("asset-stream.applyAssetCachePrune", () => {
			this.deps.applyAssetCachePrune(prunePlan);
		});
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
					materialTexturePreparationPolicy:
						NORMALIZED_MATERIAL_TEXTURE_PREPARATION_POLICY,
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
										this.deps.getPreparedByAssetId(),
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
					this.deps.getPreparedByAssetId(),
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
	preparedByAssetId: Record<string, PreparedAssetRecord>,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const asset of Object.values(preparedByAssetId)) {
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
	preparedByAssetId: Record<string, PreparedAssetRecord>;
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
		preparedAssetCounts: countPreparedAssetsByKind(options.preparedByAssetId),
		inFlightMaterialAssetIds: options.inFlightAssetIds
			.filter((assetId) => assetId.startsWith("material/"))
			.slice(0, 32),
	});
}

function reportMaterialPlannerMismatch(options: {
	priority: AssetPriority;
	requestRevision: number;
	browserDestination: SceneAssetStreamingInput["browserDestination"];
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	pendingAssetIds: string[];
	requests: readonly AssetLookupRequestDto[];
	options: OutdoorSceneRequestOptions;
}): void {
	const materialRequests = options.requests.filter((request) =>
		request.assetId.startsWith("material/"),
	);
	if (materialRequests.length > 0) {
		return;
	}

	const visibleMaterialAssetIds =
		deriveVisibleMaterialAssetIdsForBrowserDestination({
			browserDestination: options.browserDestination,
			preparedByAssetId: options.preparedByAssetId,
			pendingAssetIds: options.pendingAssetIds,
			options: options.options,
		});
	if (visibleMaterialAssetIds.length === 0) {
		return;
	}

	console.error("[holtburger-3d][asset-planner][material-mismatch]", {
		priority: options.priority,
		requestRevision: options.requestRevision,
		visibleMaterialAssetIds: visibleMaterialAssetIds.slice(0, 64),
		visibleMaterialCount: visibleMaterialAssetIds.length,
		preparedAssetCounts: countPreparedAssetsByKind(options.preparedByAssetId),
		pendingMaterialAssetIds: options.pendingAssetIds
			.filter((assetId) => assetId.startsWith("material/"))
			.slice(0, 64),
	});
}

function createSceneInterestSyncKey(input: SceneAssetStreamingInput): string {
	const preparedPlanningAssetKey = Object.keys(input.preparedByAssetId)
		.filter(
			(assetId) =>
				isDirectSceneRootAssetId(assetId) || isStaticRenderableAssetId(assetId),
		)
		.sort()
		.join(",");
	const destination = input.browserDestination;
	const interestKey = [
		`terrain-${input.terrainLodRadius}`,
		`buildings-${input.buildingLodRadius}`,
		`detail-${input.detailLodRadius}`,
		`env-cells-${input.envCellLodRadius}`,
		`prepared-${preparedPlanningAssetKey}`,
	].join(":");

	const destinationIdentity = describeBrowserDestinationIdentity(destination);
	return destinationIdentity
		? `${destinationIdentity}:${interestKey}`
		: `none:${interestKey}`;
}
