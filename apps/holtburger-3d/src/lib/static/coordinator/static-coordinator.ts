import type {
	StaticAuthoredDynamicPlacementRecord,
	StaticAuthoredDynamicRecipe,
	StaticBakeAttachmentProvider,
	StaticBakeBatchInput,
	StaticBakeBatchResult,
	StaticBakeBatchItem,
	StaticBakeTask,
	StaticBaker,
	StaticCoordinatorCommitDelta,
	StaticCoordinatorOverviewSnapshot,
	StaticCoordinatorSourcePayloadDelta,
	StaticCoordinatorSnapshot,
	StaticCoordinatorTimingDiagnostics,
	StaticDemand,
	StaticDomain,
	StaticDrawUnit,
	LayerOwnerLifecycle,
	LayerOwnerState,
	StaticLandblockSceneLodResolution,
	StaticLandblockSceneLodLayerRequest,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticMaterialCoverageReport,
	EnvCellSystemPayloadSummary,
	OutdoorStaticObjectsPayloadSummary,
	StaticObjectBakeDiagnostics,
	StaticObjectRenderInstance,
	StaticResolver,
	StaticPeerRecordOwner,
	StaticResourceKey,
	StaticRetentionReconciliation,
	StaticScopePayload,
	StaticScopePrepCommit,
	StaticSourceResolutionDiagnostics,
	TerrainStaticScopePayloadSummary,
	StaticActiveBakeStage,
	StaticLayerTaskStatus,
	StaticLayerTaskRequest,
} from "../contracts";
import {
	createEmptyObjectVisualInstallSet,
	createObjectVisualInstallSet,
	type ObjectVisualInstallSet,
} from "../../visual/object-visual-install-set";
import type { PreparedAssetReader } from "../../assets/contracts";
import type {
	DynamicEntityRecipe,
	DynamicVisualBakeResult,
	DynamicVisualTexturePlanning,
} from "../../dynamic/contracts";
import {
	createDynamicVisualTexturePlanning,
	type DynamicVisualBaker,
} from "../../dynamic/visual-baker";
import { createDynamicVisualBakeSourceGeometry } from "../../dynamic/visual-bake-attachments";
import { planStaticDemand } from "../demand-planner";
import { createEmptyStaticBakeAttachments } from "../bake/attachments";
import {
	createLayerOwnerKeyForStaticScope,
	createLayerOwnerKeyId,
} from "../layer-owners";
import { createStaticObjectTexturePlacementIntents } from "../objects/bake/static-object-placement-planner";
import { createTerrainTexturePlacementIntents } from "../terrain/bake/terrain-geometry-baker";
import { createStructuredInteriorTexturePlacementIntents } from "../env-cells/bake/structured-interior-placement-planner";
import { isStaticObjectDomain } from "../objects/bake/static-object-batch-payload";
import type {
	ObjectVisualTexturePlacementIntent,
	ObjectVisualTexturePlacementSnapshot,
	TexturePlacementIntent,
	TexturePlacementSnapshot,
} from "../../textures/placement";
import { requireObjectVisualTexturePlacementSnapshot } from "../../textures/placement";

const DEFAULT_STATIC_BATCH_MAX_PAYLOADS = 10;
const DEFAULT_STATIC_BATCH_COALESCE_DELAY_MS = 500;
const STATIC_COORDINATOR_RECENT_DIAGNOSTICS_LIMIT = 20;
const STATIC_COORDINATOR_SOURCE_DIAGNOSTICS_LIMIT = 80;
const DEFAULT_STATIC_BAKE_ATTACHMENT_PROVIDER: StaticBakeAttachmentProvider = {
	createAttachments: () => Promise.resolve(createEmptyStaticBakeAttachments()),
};
const EMPTY_TEXTURE_PLACEMENT_SNAPSHOT: TexturePlacementSnapshot = {
	placementsByItemId: new Map(),
};
const EMPTY_OBJECT_VISUAL_TEXTURE_PLACEMENT_SNAPSHOT: ObjectVisualTexturePlacementSnapshot =
	{
		itemIdsByTextureUseId: new Map(),
		placementsByItemId: new Map(),
	};

interface StaticSourceReadyPlacementSnapshots {
	readonly objectVisualPlacementSnapshot: ObjectVisualTexturePlacementSnapshot;
	readonly terrainPlacementSnapshot: TexturePlacementSnapshot;
}

export type StaticCoordinatorListener = (
	snapshot: StaticCoordinatorSnapshot,
) => void;
export type StaticCoordinatorCommitListener = (
	commit: StaticScopePrepCommit,
) => void;
export type StaticCoordinatorSourcePayloadListener = (
	delta: StaticCoordinatorSourcePayloadDelta,
) => void;
export type StaticSourceReadyHandler = (
	work: StaticSourceReadyWork,
) => Promise<void> | void;

export interface StaticSourceReadyWork {
	/** Domain represented by this source-ready batch. */
	readonly domain: StaticDomain;
	/** Opaque worker-correlation id for this coalesced bake input. */
	readonly bakeBatchId: string;
	/** Resolved source payloads that are ready for texture placement and baking. */
	readonly sourcePayloads: readonly StaticScopePayload[];
	/** Terrain texture placement intents, still keyed by legacy string ids. */
	readonly terrainPlacementIntents: readonly TexturePlacementIntent[];
	/** Object-like visual placement intents keyed by numeric bake-time ids. */
	readonly objectVisualPlacementIntents: readonly ObjectVisualTexturePlacementIntent[];
	/** Current layer tasks represented by this source-ready batch. */
	readonly tasks: readonly StaticBakeTask[];
	continueWithPlacement(
		snapshots: StaticSourceReadyPlacementSnapshots,
		timing?: StaticSourceReadyPlacementTiming,
	): Promise<void>;
	failPlacement(message: string): void;
}

interface StaticSourceReadyPlacementTiming {
	/** Time spent assigning source-ready texture placement intents to atlas pages. */
	readonly texturePlacementMs: number;
}

export interface StaticCoordinatorOptions {
	readonly resolver: StaticResolver & StaticLandblockSceneLodSourceResolver;
	readonly baker: StaticBaker;
	readonly attachmentProvider?: StaticBakeAttachmentProvider;
	readonly batching?: Partial<StaticCoordinatorBatchingOptions>;
	readonly dynamicVisualBaker?: DynamicVisualBaker;
	readonly dynamicVisualGeometryAssetReader?: PreparedAssetReader;
}

export interface StaticCoordinatorBatchingOptions {
	readonly maxPayloadsPerBatch: number;
	readonly maxWaitMs: number;
}

export class StaticCoordinator {
	readonly #resolver: StaticResolver & StaticLandblockSceneLodSourceResolver;
	readonly #baker: StaticBaker;
	readonly #attachmentProvider: StaticBakeAttachmentProvider;
	readonly #dynamicVisualBaker: DynamicVisualBaker | null;
	readonly #dynamicVisualGeometryAssetReader: PreparedAssetReader | null;
	readonly #batching: StaticCoordinatorBatchingOptions;
	#sourceReadyHandler: StaticSourceReadyHandler = (work) =>
		work.continueWithPlacement({
			objectVisualPlacementSnapshot:
				EMPTY_OBJECT_VISUAL_TEXTURE_PLACEMENT_SNAPSHOT,
			terrainPlacementSnapshot: EMPTY_TEXTURE_PLACEMENT_SNAPSHOT,
		});
	readonly #listeners = new Set<StaticCoordinatorListener>();
	readonly #commitListeners = new Set<StaticCoordinatorCommitListener>();
	readonly #sourcePayloadListeners =
		new Set<StaticCoordinatorSourcePayloadListener>();
	readonly #layerTasksByTaskId = new Map<string, MutableStaticLayerTaskState>();
	readonly #pendingBatches = new Map<string, PendingStaticBakeBatch>();
	readonly #residentDrawUnitIds = new Set<string>();
	readonly #residentResourcesByOwnerId = new Map<string, StaticResourceKey[]>();
	#revision = 0;
	#disposed = false;
	#committed = 0;
	#failed = 0;
	#committedDrawUnits = 0;
	#latestTerrainPayload: TerrainStaticScopePayloadSummary | null = null;
	#latestOutdoorStaticObjectsPayload: OutdoorStaticObjectsPayloadSummary | null =
		null;
	#latestEnvCellSystemPayload: EnvCellSystemPayloadSummary | null = null;
	readonly #latestStaticObjectBakeDiagnosticsByKey = new Map<
		string,
		StaticObjectBakeDiagnostics
	>();
	readonly #recentTiming: StaticCoordinatorTimingDiagnostics[] = [];
	readonly #latestMaterialCoverageByKey = new Map<
		string,
		StaticMaterialCoverageReport
	>();
	readonly #sourceResolutionDiagnostics: MutableStaticSourceResolutionDiagnostics[] =
		[];
	#nextSourceResolutionSequence = 0;
	constructor(options: StaticCoordinatorOptions) {
		this.#resolver = options.resolver;
		this.#baker = options.baker;
		this.#attachmentProvider =
			options.attachmentProvider ?? DEFAULT_STATIC_BAKE_ATTACHMENT_PROVIDER;
		this.#dynamicVisualBaker = options.dynamicVisualBaker ?? null;
		this.#dynamicVisualGeometryAssetReader =
			options.dynamicVisualGeometryAssetReader ?? null;
		this.#batching = {
			maxPayloadsPerBatch:
				options.batching?.maxPayloadsPerBatch ??
				DEFAULT_STATIC_BATCH_MAX_PAYLOADS,
			maxWaitMs:
				options.batching?.maxWaitMs ?? DEFAULT_STATIC_BATCH_COALESCE_DELAY_MS,
		};
	}

	setSourceReadyHandler(handler: StaticSourceReadyHandler): void {
		this.#sourceReadyHandler = handler;
	}

	reconcileStaticDemand(demand: StaticDemand): StaticRetentionReconciliation {
		this.#assertActive();
		this.#revision += 1;
		const demandPlan = planStaticDemand(demand, this.#revision);
		const desiredOwnerIds = new Set(
			demandPlan.retainedLayerOwners.map(createLayerOwnerKeyId),
		);
		const run: StaticReconciliationRunState = {
			desiredOwnerIds,
			retainedLayerOwners: demandPlan.retainedLayerOwners,
			revision: this.#revision,
			runId: createStaticReconciliationRunId(this.#revision),
		};
		const newLayerTasks: StaticLayerTaskRequest[] = [];

		for (const status of Array.from(this.#layerTasksByTaskId.values())) {
			if (!run.desiredOwnerIds.has(status.ownerId)) {
				this.#layerTasksByTaskId.delete(status.taskId);
			}
		}
		const removedResources = this.#evictResidentResourcesExcept(
			run.desiredOwnerIds,
		);
		if (removedResources.length > 0) {
			this.#emitEvictionCommitDelta({ removedResources });
		}
		this.#pruneMaterialCoverageByOwnerIds(run.desiredOwnerIds);
		this.#pruneStaticObjectBakeDiagnosticsByOwnerIds(run.desiredOwnerIds);

		for (const task of demandPlan.layerTasks) {
			const existing = this.#findLayerTaskByOwnerId(task.ownerId);
			if (existing) {
				continue;
			}
			this.#layerTasksByTaskId.set(task.taskId, {
				activeBakeBatchId: null,
				activeBakeStage: null,
				activeBakeStageStartedAtMs: null,
				domain: task.domain,
				ownerId: task.ownerId,
				ownerKey: task.ownerKey,
				phaseStartedAtMs: nowMs(),
				taskId: task.taskId,
				revision: task.revision,
				scope: task.scope,
				scopeKey: task.scopeKey,
				status: "requested",
			});
			newLayerTasks.push(task);
		}

		this.#emit();

		for (const task of newLayerTasks) {
			this.#setTaskStatus(task.taskId, "resolving");
		}

		for (const sourceRequest of createSourceRequestsForNewWork(
			demandPlan.sourceRequests,
			newLayerTasks,
		)) {
			void this.#resolveSourceThenBake(sourceRequest);
		}

		const layerTasks = demandPlan.retainedLayerOwners
			.map((ownerKey) =>
				this.#findLayerTaskByOwnerId(createLayerOwnerKeyId(ownerKey)),
			)
			.filter((status): status is MutableStaticLayerTaskState =>
				Boolean(status),
			)
			.map(toStaticLayerTaskStatus);

		return {
			layerTasks,
			removedResources,
			retainedLayerOwners: run.retainedLayerOwners,
			runId: run.runId,
		};
	}

	subscribe(listener: StaticCoordinatorListener): () => void {
		this.#listeners.add(listener);
		listener(this.createSnapshot());

		return () => {
			this.#listeners.delete(listener);
		};
	}

	subscribeCommits(listener: StaticCoordinatorCommitListener): () => void {
		this.#commitListeners.add(listener);

		return () => {
			this.#commitListeners.delete(listener);
		};
	}

	markCommitMaterialized(delta: StaticCoordinatorCommitDelta): void {
		let changed = false;
		for (const task of delta.tasks) {
			const current = this.#layerTasksByTaskId.get(task.taskId);
			if (!current || current.status !== "materializing") {
				continue;
			}
			current.status = "committed";
			current.activeBakeBatchId = null;
			current.activeBakeStage = null;
			current.activeBakeStageStartedAtMs = null;
			current.phaseStartedAtMs = nowMs();
			changed = true;
		}
		if (changed) {
			this.#emit();
		}
	}

	markCommitMaterializationFailed(
		delta: StaticCoordinatorCommitDelta,
		message: string,
	): void {
		for (const task of delta.tasks) {
			this.#markTaskIdFailedIfCurrent(task.taskId, message);
		}
	}

	subscribeSourcePayloads(
		listener: StaticCoordinatorSourcePayloadListener,
	): () => void {
		this.#sourcePayloadListeners.add(listener);

		return () => {
			this.#sourcePayloadListeners.delete(listener);
		};
	}

	createSnapshot(): StaticCoordinatorSnapshot {
		const layerTasks = Array.from(this.#layerTasksByTaskId.values()).map(
			toStaticLayerTaskStatus,
		);
		const ownerStates = this.#createOwnerStates();

		return {
			layerTasks,
			baking: countPhase(layerTasks, "baking"),
			committed: this.#committed,
			committedDrawUnits: this.#committedDrawUnits,
			failed: this.#failed,
			latestEnvCellSystemPayload: this.#latestEnvCellSystemPayload,
			materialCoverage: Array.from(
				this.#latestMaterialCoverageByKey.values(),
			).sort(compareMaterialCoverageReports),
			latestOutdoorStaticObjectsPayload:
				this.#latestOutdoorStaticObjectsPayload,
			latestTerrainPayload: this.#latestTerrainPayload,
			ownerStates,
			recentTiming: [...this.#recentTiming],
			requested: layerTasks.length,
			resolving: countPhase(layerTasks, "resolving"),
			revision: this.#revision,
			staticBakerDiagnostics: this.#baker.createDiagnosticsSnapshot?.() ?? null,
			sourceResolutionDiagnostics:
				this.#createSourceResolutionDiagnosticsSnapshot(),
			staticObjectBakeDiagnostics: Array.from(
				this.#latestStaticObjectBakeDiagnosticsByKey.values(),
			).sort(compareStaticObjectBakeDiagnostics),
		};
	}

	createOverviewSnapshot(): StaticCoordinatorOverviewSnapshot {
		const layerTasks = Array.from(this.#layerTasksByTaskId.values());
		return {
			baking: layerTasks.filter((task) => task.status === "baking").length,
			committed: this.#committed,
			latestEnvCellSystemPayload: this.#latestEnvCellSystemPayload,
			latestTerrainPayload: this.#latestTerrainPayload,
			requested: layerTasks.length,
			resolving: layerTasks.filter((task) => task.status === "resolving")
				.length,
			revision: this.#revision,
		};
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		disposeIfAvailable(this.#resolver);
		disposeIfAvailable(this.#baker);
		this.#layerTasksByTaskId.clear();
		for (const pendingBatch of this.#pendingBatches.values()) {
			if (pendingBatch.timeoutId) {
				clearTimeout(pendingBatch.timeoutId);
			}
		}
		this.#pendingBatches.clear();
		this.#evictResidentResourcesExcept(new Set());
		this.#emit();
		this.#listeners.clear();
		this.#commitListeners.clear();
		this.#sourcePayloadListeners.clear();
	}

	async #resolveSourceThenBake(
		sourceRequest: StaticLandblockSceneLodSourceRequest,
	): Promise<void> {
		const requestedOwnerIds = new Set(
			sourceRequest.requestedLayers.map((layer) =>
				createLayerOwnerKeyId(layer.targetOwnerKey),
			),
		);
		const tasksByOwnerId = new Map<string, MutableStaticLayerTaskState>();
		for (const layer of sourceRequest.requestedLayers) {
			const ownerId = createLayerOwnerKeyId(layer.targetOwnerKey);
			const task = this.#findLayerTaskByOwnerId(ownerId);
			if (task) {
				tasksByOwnerId.set(ownerId, task);
			}
		}
		const resolverStartedAt = nowMs();
		const sourceDiagnostics = this.#beginSourceResolutionDiagnostics({
			sourceRequest,
			tasks: Array.from(tasksByOwnerId.values()),
		});
		let resolution: Awaited<
			ReturnType<StaticLandblockSceneLodSourceResolver["resolveSource"]>
		>;
		try {
			resolution = await this.#resolver.resolveSource(sourceRequest);
		} catch (error: unknown) {
			this.#finishSourceResolutionDiagnostics(sourceDiagnostics, {
				error: error instanceof Error ? error.message : String(error),
				resolution: null,
				resolverMs: nowMs() - resolverStartedAt,
				status: "failed",
			});
			for (const task of tasksByOwnerId.values()) {
				this.#markTaskFailedIfCurrent(
					task,
					error instanceof Error ? error.message : String(error),
				);
			}
			return;
		}
		const resolverMs = nowMs() - resolverStartedAt;
		this.#finishSourceResolutionDiagnostics(sourceDiagnostics, {
			error: null,
			resolution,
			resolverMs,
			status: "resolved",
		});
		const dynamicRecipesByOwnerId = groupDynamicRecipesByOwnerId(
			resolution.dynamicRecipes,
		);
		const dynamicPlacementsByOwnerId = groupDynamicPlacementsByOwnerId(
			resolution.dynamicPlacements,
		);

		for (const recipe of resolution.recipes) {
			const ownerId = createLayerOwnerKeyId(recipe.targetOwnerKey);
			const task = tasksByOwnerId.get(ownerId);
			if (
				!requestedOwnerIds.has(ownerId) ||
				!task ||
				!this.#isTaskCurrent(task) ||
				task.status === "failed"
			) {
				continue;
			}

			task.status = "source-committed";

			this.#recordResolvedPayload(recipe.payload);
			this.#emitSourcePayloadDelta({
				payload: recipe.payload,
				revision: task.revision,
				task: toStaticLayerTaskStatus(task),
			});
			this.#enqueueBakePayload(
				task,
				recipe.payload,
				resolverMs,
				dynamicPlacementsByOwnerId.get(ownerId) ?? [],
				dynamicRecipesByOwnerId.get(ownerId) ?? [],
			);
		}
	}

	#enqueueBakePayload(
		taskStatus: MutableStaticLayerTaskState,
		payload: StaticScopePayload,
		resolverMs: number,
		dynamicPlacements: readonly StaticAuthoredDynamicPlacementRecord[],
		dynamicRecipes: readonly DynamicEntityRecipe[],
	): void {
		let pendingBatch = this.#findPendingBatchForTask(taskStatus);
		if (!pendingBatch) {
			const pendingBatchId = createPendingStaticBakeBatchId(taskStatus);
			const timeoutId =
				this.#batching.maxWaitMs > 0
					? setTimeout(
							() => this.#flushPendingBatch(pendingBatchId),
							this.#batching.maxWaitMs,
						)
					: null;
			if (!timeoutId) {
				queueMicrotask(() => void this.#flushPendingBatch(pendingBatchId));
			}
			pendingBatch = {
				batchId: pendingBatchId,
				domain: taskStatus.domain,
				items: [],
				revision: taskStatus.revision,
				timeoutId,
			};
			this.#pendingBatches.set(pendingBatchId, pendingBatch);
		}

		const task = createStaticBakeTask(taskStatus);
		pendingBatch.items.push({
			ownerId: task.ownerId,
			ownerKey: task.ownerKey,
			dynamicPlacements,
			dynamicRecipes,
			payload,
			resolverMs,
			task,
			taskId: task.taskId,
		});
		if (
			pendingBatch.items.length >=
			getMaxPayloadsPerBatchForDomain(taskStatus.domain, this.#batching)
		) {
			this.#flushPendingBatch(pendingBatch.batchId);
		}
	}

	async #flushPendingBatch(pendingBatchId: string): Promise<void> {
		const pendingBatch = this.#pendingBatches.get(pendingBatchId);
		if (!pendingBatch) {
			return;
		}

		this.#pendingBatches.delete(pendingBatchId);
		if (pendingBatch.timeoutId) {
			clearTimeout(pendingBatch.timeoutId);
		}

		const pendingItems = pendingBatch.items.filter((item) => {
			const task = this.#layerTasksByTaskId.get(item.taskId);
			return (
				task !== undefined &&
				this.#isTaskCurrent(task) &&
				this.#isLayerOwnerDemanded(item.ownerKey)
			);
		});
		const items = pendingItems.map(toStaticBakeBatchItem);
		if (items.length === 0) {
			return;
		}

		const bakeBatchId = createStaticBakeBatchId({
			domain: pendingBatch.domain,
			items,
			revision: pendingBatch.revision,
		});
		for (const item of items) {
			this.#setTaskStatus(item.task.taskId, "baking", {
				activeBakeBatchId: bakeBatchId,
				activeBakeStage: "source-ready-handler",
			});
		}
		await this.#dispatchSourceReadyWork({
			items,
			pendingBatch,
			pendingItems,
			bakeBatchId,
		});
	}

	async #dispatchSourceReadyWork(options: {
		readonly pendingBatch: PendingStaticBakeBatch;
		readonly pendingItems: readonly PendingStaticBakeBatchItem[];
		readonly items: readonly StaticBakeBatchItem[];
		readonly bakeBatchId: string;
	}): Promise<void> {
		let consumed = false;
		const placementIntentStartedAt = nowMs();
		const dynamicVisualTexturePlannings = options.pendingItems.flatMap((item) =>
			item.dynamicRecipes.map((recipe) =>
				createDynamicVisualTexturePlanning(recipe),
			),
		);
		const objectVisualPlacementIntents = [
			...(isStaticObjectDomain(options.pendingBatch.domain)
				? createStaticObjectTexturePlacementIntents({
						items: options.items,
					})
				: []),
			...(options.pendingBatch.domain === "env-cell-system"
				? createStructuredInteriorTexturePlacementIntents({
						items: options.items,
					})
				: []),
			...dynamicVisualTexturePlannings.flatMap(
				(planning) => planning.placementIntents,
			),
		];
		const terrainPlacementIntents =
			options.pendingBatch.domain === "outdoor-terrain"
				? createTerrainTexturePlacementIntents({
						items: options.items,
					})
				: [];
		const placementIntentMs = nowMs() - placementIntentStartedAt;
		const work: StaticSourceReadyWork = {
			domain: options.pendingBatch.domain,
			objectVisualPlacementIntents,
			terrainPlacementIntents,
			sourcePayloads: options.items.map((item) => item.payload),
			bakeBatchId: options.bakeBatchId,
			tasks: options.items.map((item) => item.task),
			continueWithPlacement: async (placementSnapshots, placementTiming) => {
				if (consumed) {
					throw new Error(
						`Static source-ready work ${options.bakeBatchId} was already consumed.`,
					);
				}
				consumed = true;
				await this.#continueSourceReadyBake({
					...options,
					placementIntentMs,
					placementSnapshots,
					texturePlacementMs: placementTiming?.texturePlacementMs ?? null,
					dynamicVisualTexturePlannings,
				});
			},
			failPlacement: (message) => {
				if (consumed) {
					return;
				}
				consumed = true;
				for (const item of options.items) {
					this.#markTaskIdFailedIfCurrent(item.task.taskId, message);
				}
			},
		};

		try {
			await this.#sourceReadyHandler(work);
		} catch (error: unknown) {
			for (const item of options.items) {
				this.#markTaskIdFailedIfCurrent(
					item.task.taskId,
					error instanceof Error ? error.message : String(error),
				);
			}
			return;
		}
	}

	async #continueSourceReadyBake(options: {
		readonly pendingBatch: PendingStaticBakeBatch;
		readonly pendingItems: readonly PendingStaticBakeBatchItem[];
		readonly items: readonly StaticBakeBatchItem[];
		readonly bakeBatchId: string;
		readonly placementIntentMs: number;
		readonly placementSnapshots: StaticSourceReadyPlacementSnapshots;
		readonly texturePlacementMs: number | null;
		readonly dynamicVisualTexturePlannings: readonly DynamicVisualTexturePlanning[];
	}): Promise<void> {
		const currentItems = options.items.filter(
			(item) =>
				this.#isBakeTaskCurrent(item.task) &&
				this.#isLayerOwnerDemanded(item.task.ownerKey),
		);
		if (currentItems.length === 0) {
			this.#emit();
			return;
		}
		const currentTaskIds = new Set(
			currentItems.map((item) => item.task.taskId),
		);
		const currentPendingItems = options.pendingItems.filter((item) =>
			currentTaskIds.has(item.taskId),
		);

		let attachments: StaticBakeBatchInput["attachments"];
		const attachmentStartedAt = nowMs();
		this.#setTaskBakeStage(currentItems, "attachments", options.bakeBatchId);
		try {
			attachments = await this.#attachmentProvider.createAttachments({
				domain: options.pendingBatch.domain,
				items: currentItems,
				revision: options.pendingBatch.revision,
				bakeBatchId: options.bakeBatchId,
			});
		} catch (error: unknown) {
			for (const item of currentItems) {
				this.#markTaskIdFailedIfCurrent(
					item.task.taskId,
					error instanceof Error ? error.message : String(error),
				);
			}
			return;
		}
		const attachmentMs = nowMs() - attachmentStartedAt;
		const bakeInput: StaticBakeBatchInput = {
			attachments,
			domain: options.pendingBatch.domain,
			items: currentItems,
			revision: options.pendingBatch.revision,
			bakeBatchId: options.bakeBatchId,
			texturePlacementSnapshot:
				options.pendingBatch.domain === "outdoor-terrain"
					? options.placementSnapshots.terrainPlacementSnapshot
					: options.placementSnapshots.objectVisualPlacementSnapshot,
		};

		let result: StaticBakeBatchResult;
		const bakeStartedAt = nowMs();
		this.#setTaskBakeStage(currentItems, "static-baker", options.bakeBatchId);
		try {
			result = await this.#baker.bake(bakeInput);
		} catch (error: unknown) {
			for (const item of currentItems) {
				this.#markTaskIdFailedIfCurrent(
					item.task.taskId,
					error instanceof Error ? error.message : String(error),
				);
			}
			return;
		}
		const bakeMs = nowMs() - bakeStartedAt;
		let dynamicVisualBake: DynamicVisualBakeResult | null;
		let dynamicPlacements: readonly StaticAuthoredDynamicPlacementRecord[] =
			currentPendingItems.flatMap((item) => item.dynamicPlacements);
		let dynamicRecipes: readonly DynamicEntityRecipe[] =
			currentPendingItems.flatMap((item) => item.dynamicRecipes);
		this.#setTaskBakeStage(
			currentItems,
			"dynamic-visual-baker",
			options.bakeBatchId,
		);
		try {
			dynamicVisualBake = await this.#bakeDynamicVisualsForPendingItems({
				pendingItems: currentPendingItems,
				placementSnapshot:
					options.placementSnapshots.objectVisualPlacementSnapshot,
				revision: options.pendingBatch.revision,
				bakeBatchId: options.bakeBatchId,
				texturePlannings: options.dynamicVisualTexturePlannings,
			});
		} catch (error: unknown) {
			for (const item of currentItems) {
				this.#markTaskIdFailedIfCurrent(
					item.task.taskId,
					error instanceof Error ? error.message : String(error),
				);
			}
			return;
		}

		const currentTasks = result.tasks.filter(
			(task) =>
				this.#isBakeTaskCurrent(task) &&
				this.#isLayerOwnerDemanded(task.ownerKey),
		);
		if (currentTasks.length !== result.tasks.length) {
			result = filterStaticBakeResultForCurrentTasks(result, currentTasks);
			dynamicPlacements = filterDynamicPlacementsForCurrentTasks(
				currentPendingItems,
				currentTasks,
			);
			dynamicRecipes = filterDynamicRecipesForCurrentTasks(
				currentPendingItems,
				currentTasks,
			);
			dynamicVisualBake = filterDynamicVisualBakeResultForCurrentTasks(
				dynamicVisualBake,
				currentPendingItems,
				currentTasks,
			);
			if (currentTasks.length === 0) {
				this.#emit();
				return;
			}
		}

		this.#setTaskBakeStage(
			currentItems,
			"commit-synthesis",
			options.bakeBatchId,
		);
		try {
			this.#commit(result, {
				attachmentMs,
				bakeMs,
				dynamicPlacements,
				dynamicRecipes,
				dynamicVisualBake,
				resolverMs: sumNullableNumbers(
					currentTasks.map((task) =>
						findPendingStaticBakeItemResolverMs(
							currentPendingItems,
							task.taskId,
						),
					),
				),
				placementIntentMs: options.placementIntentMs,
				texturePlacementMs: options.texturePlacementMs,
			});
		} catch (error: unknown) {
			for (const task of currentTasks) {
				this.#markTaskIdFailedIfCurrent(
					task.taskId,
					error instanceof Error ? error.message : String(error),
				);
			}
		}
	}

	async #bakeDynamicVisualsForPendingItems(options: {
		readonly pendingItems: readonly PendingStaticBakeBatchItem[];
		readonly placementSnapshot: ObjectVisualTexturePlacementSnapshot;
		readonly revision: number;
		readonly bakeBatchId: string;
		readonly texturePlannings: readonly DynamicVisualTexturePlanning[];
	}): Promise<DynamicVisualBakeResult | null> {
		const recipes = options.pendingItems.flatMap((item) => item.dynamicRecipes);
		if (recipes.length === 0) {
			return null;
		}
		if (!this.#dynamicVisualBaker || !this.#dynamicVisualGeometryAssetReader) {
			throw new Error(
				"Static-authored dynamic recipes require a dynamic visual baker and geometry asset reader.",
			);
		}

		const sourceGeometry = await createDynamicVisualBakeSourceGeometry(
			this.#dynamicVisualGeometryAssetReader,
			recipes,
		);
		return this.#dynamicVisualBaker.bake({
			batchId: createStaticAuthoredDynamicVisualBakeBatchId(
				options.bakeBatchId,
			),
			recipes,
			revision: options.revision,
			sourceGeometry,
			texturePlacementSnapshot: options.placementSnapshot,
			texturePlannings: filterDynamicVisualTexturePlanningsForRecipes(
				options.texturePlannings,
				recipes,
			),
		});
	}

	#commit(
		result: StaticBakeBatchResult,
		timing: {
			readonly resolverMs: number | null;
			readonly placementIntentMs: number | null;
			readonly texturePlacementMs: number | null;
			readonly attachmentMs: number | null;
			readonly bakeMs: number | null;
			readonly dynamicPlacements: readonly StaticAuthoredDynamicPlacementRecord[];
			readonly dynamicRecipes: readonly DynamicEntityRecipe[];
			readonly dynamicVisualBake: DynamicVisualBakeResult | null;
		},
	): void {
		const commitStartedAt = nowMs();
		const resourcesByOwnerId = collectCommittedResourceKeysByOwnerId(result);

		for (const task of result.tasks) {
			const status = this.#layerTasksByTaskId.get(task.taskId);
			if (!status) {
				continue;
			}
			status.status = "materializing";
			status.activeBakeBatchId = null;
			status.activeBakeStage = null;
			status.activeBakeStageStartedAtMs = null;
			status.phaseStartedAtMs = nowMs();
			this.#committed += 1;
		}
		for (const [ownerId, resources] of resourcesByOwnerId) {
			const residentResources =
				this.#residentResourcesByOwnerId.get(ownerId) ?? [];
			this.#residentResourcesByOwnerId.set(ownerId, [
				...residentResources,
				...resources,
			]);
			for (const resource of resources) {
				if (resource.kind === "draw-unit") {
					this.#residentDrawUnitIds.add(resource.drawUnitId);
				}
			}
		}
		for (const coverage of result.materialCoverage) {
			this.#latestMaterialCoverageByKey.set(coverage.coverageKey, coverage);
		}
		for (const diagnostics of result.staticObjectBakeDiagnostics) {
			this.#latestStaticObjectBakeDiagnosticsByKey.set(
				createStaticObjectBakeDiagnosticsKey(diagnostics),
				diagnostics,
			);
		}
		this.#committedDrawUnits = this.#residentDrawUnitIds.size;
		this.#recordTiming({
			attachmentMs: timing.attachmentMs,
			bakeMs: timing.bakeMs,
			commitMs: nowMs() - commitStartedAt,
			domain: result.domain,
			itemCount: result.tasks.length,
			kind: "static-coordinator-timing",
			placementIntentMs: timing.placementIntentMs,
			resolverMs: timing.resolverMs,
			revision: result.revision,
			bakeBatchId: result.bakeBatchId,
			texturePlacementMs: timing.texturePlacementMs,
		});
		this.#emitCommit({
			dynamicPlacements: timing.dynamicPlacements,
			dynamicRecipes: timing.dynamicRecipes,
			dynamicVisualBake: timing.dynamicVisualBake,
			staticCommit: {
				addedDrawUnits: createCommitDrawUnits(result),
				addedPortalApertureResources: result.portalApertureResources,
				commitId: createStaticCommitId({
					revision: result.revision,
					tasks: result.tasks,
				}),
				materialCoverage: result.materialCoverage,
				objectVisualInstallSet: result.objectVisualInstallSet,
				removedResources: [],
				revision: result.revision,
				envCellStaticObjectPlacementRecords:
					result.envCellStaticObjectPlacementRecords,
				staticPortalGraphs: result.staticPortalGraphs,
				staticPortalInteriorRecords: result.staticPortalInteriorRecords,
				staticSourceMappings: result.staticSourceMappings,
				staticSpatialRecords: result.staticSpatialRecords,
				staticVisibilityRecords: result.staticVisibilityRecords,
				tasks: result.tasks,
				textureDependencies: createCommitTextureDependencies(result),
				textureUses: result.textureUses,
			},
		});
		this.#emit();
	}

	#evictResidentResourcesExcept(
		ownerIds: ReadonlySet<string>,
	): readonly StaticResourceKey[] {
		const removedResources: StaticResourceKey[] = [];
		for (const [ownerId, resources] of Array.from(
			this.#residentResourcesByOwnerId,
		)) {
			if (ownerIds.has(ownerId)) {
				continue;
			}
			removedResources.push(...resources);
			this.#residentResourcesByOwnerId.delete(ownerId);
		}

		for (const resource of removedResources) {
			if (resource.kind === "draw-unit") {
				this.#residentDrawUnitIds.delete(resource.drawUnitId);
			}
		}
		this.#committedDrawUnits = this.#residentDrawUnitIds.size;
		return removedResources;
	}

	#emitEvictionCommitDelta(options: {
		readonly removedResources: readonly StaticResourceKey[];
	}): void {
		this.#emitCommit({
			dynamicPlacements: [],
			dynamicRecipes: [],
			dynamicVisualBake: null,
			staticCommit: {
				addedDrawUnits: [],
				addedPortalApertureResources: [],
				commitId: createStaticEvictionCommitId(this.#revision),
				materialCoverage: [],
				objectVisualInstallSet: createEmptyObjectVisualInstallSet(),
				removedResources: options.removedResources,
				revision: this.#revision,
				envCellStaticObjectPlacementRecords: [],
				staticPortalGraphs: [],
				staticPortalInteriorRecords: [],
				staticSourceMappings: [],
				staticSpatialRecords: [],
				staticVisibilityRecords: [],
				tasks: [],
				textureDependencies: [],
				textureUses: [],
			},
		});
	}

	#findLayerTaskByOwnerId(ownerId: string): MutableStaticLayerTaskState | null {
		for (const status of this.#layerTasksByTaskId.values()) {
			if (status.ownerId === ownerId) {
				return status;
			}
		}

		return null;
	}

	#pruneMaterialCoverageByOwnerIds(ownerIds: ReadonlySet<string>): void {
		for (const coverage of Array.from(
			this.#latestMaterialCoverageByKey.values(),
		)) {
			if (coverage.landblockId === null) {
				if (!hasDemandedOwnerForDomain(ownerIds, coverage.domain)) {
					this.#latestMaterialCoverageByKey.delete(coverage.coverageKey);
				}
				continue;
			}
			const ownerId = createLayerOwnerIdForDomainLandblock({
				domain: coverage.domain,
				landblockId: coverage.landblockId,
			});
			if (!ownerIds.has(ownerId)) {
				this.#latestMaterialCoverageByKey.delete(coverage.coverageKey);
			}
		}
	}

	#pruneStaticObjectBakeDiagnosticsByOwnerIds(
		ownerIds: ReadonlySet<string>,
	): void {
		for (const diagnostics of Array.from(
			this.#latestStaticObjectBakeDiagnosticsByKey.values(),
		)) {
			const ownerId = createLayerOwnerIdForDomainLandblock({
				domain: diagnostics.domain,
				landblockId: diagnostics.landblockId,
			});
			if (!ownerIds.has(ownerId)) {
				this.#latestStaticObjectBakeDiagnosticsByKey.delete(
					createStaticObjectBakeDiagnosticsKey(diagnostics),
				);
			}
		}
	}

	#recordTiming(timing: StaticCoordinatorTimingDiagnostics): void {
		this.#recentTiming.push(timing);
		if (
			this.#recentTiming.length > STATIC_COORDINATOR_RECENT_DIAGNOSTICS_LIMIT
		) {
			this.#recentTiming.splice(
				0,
				this.#recentTiming.length - STATIC_COORDINATOR_RECENT_DIAGNOSTICS_LIMIT,
			);
		}
	}

	#beginSourceResolutionDiagnostics(options: {
		readonly sourceRequest: StaticLandblockSceneLodSourceRequest;
		readonly tasks: readonly MutableStaticLayerTaskState[];
	}): MutableStaticSourceResolutionDiagnostics {
		const requestSeq = this.#nextSourceResolutionSequence;
		this.#nextSourceResolutionSequence += 1;
		const revision = options.tasks[0]?.revision ?? this.#revision;
		const diagnostics: MutableStaticSourceResolutionDiagnostics = {
			context: options.sourceRequest.context,
			dynamicPlacementCount: null,
			dynamicRecipeCount: null,
			error: null,
			landblockHex: formatHex32(options.sourceRequest.landblockId),
			landblockId: options.sourceRequest.landblockId,
			layerKinds: options.sourceRequest.requestedLayers.map(
				(layer) => layer.kind,
			),
			ownerIds: options.tasks.map((task) => task.ownerId),
			recipeCount: null,
			requestId: `source-resolution:${revision}:${requestSeq}`,
			requestSeq,
			resolverMs: null,
			revision,
			sourceLod: options.sourceRequest.sourceLod,
			status: "pending",
			submittedAtMs: nowMs(),
			taskIds: options.tasks.map((task) => task.taskId),
		};
		this.#sourceResolutionDiagnostics.push(diagnostics);
		if (
			this.#sourceResolutionDiagnostics.length >
			STATIC_COORDINATOR_SOURCE_DIAGNOSTICS_LIMIT
		) {
			this.#sourceResolutionDiagnostics.splice(
				0,
				this.#sourceResolutionDiagnostics.length -
					STATIC_COORDINATOR_SOURCE_DIAGNOSTICS_LIMIT,
			);
		}
		this.#emit();
		return diagnostics;
	}

	#finishSourceResolutionDiagnostics(
		diagnostics: MutableStaticSourceResolutionDiagnostics,
		result: {
			readonly status: "resolved" | "failed";
			readonly resolverMs: number;
			readonly resolution: StaticLandblockSceneLodResolution | null;
			readonly error: string | null;
		},
	): void {
		diagnostics.status = result.status;
		diagnostics.resolverMs = result.resolverMs;
		diagnostics.error = result.error;
		diagnostics.recipeCount = result.resolution?.recipes.length ?? null;
		diagnostics.dynamicPlacementCount =
			result.resolution?.dynamicPlacements.length ?? null;
		diagnostics.dynamicRecipeCount =
			result.resolution?.dynamicRecipes.length ?? null;
		this.#emit();
	}

	#createSourceResolutionDiagnosticsSnapshot(): readonly StaticSourceResolutionDiagnostics[] {
		return this.#sourceResolutionDiagnostics.map((diagnostics) => ({
			ageMs: nowMs() - diagnostics.submittedAtMs,
			context: diagnostics.context,
			dynamicPlacementCount: diagnostics.dynamicPlacementCount,
			dynamicRecipeCount: diagnostics.dynamicRecipeCount,
			error: diagnostics.error,
			landblockHex: diagnostics.landblockHex,
			landblockId: diagnostics.landblockId,
			layerKinds: diagnostics.layerKinds,
			ownerIds: diagnostics.ownerIds,
			recipeCount: diagnostics.recipeCount,
			requestId: diagnostics.requestId,
			requestSeq: diagnostics.requestSeq,
			resolverMs: diagnostics.resolverMs,
			revision: diagnostics.revision,
			sourceLod: diagnostics.sourceLod,
			status: diagnostics.status,
			submittedAtMs: diagnostics.submittedAtMs,
			taskIds: diagnostics.taskIds,
		}));
	}

	#markTaskFailedIfCurrent(
		task: MutableStaticLayerTaskState,
		message: string,
	): void {
		if (!this.#isTaskCurrent(task)) {
			return;
		}

		this.#markTaskFailed(task, message);
	}

	#markTaskIdFailedIfCurrent(taskId: string, message: string): void {
		const task = this.#layerTasksByTaskId.get(taskId);
		if (!task) {
			return;
		}

		this.#markTaskFailedIfCurrent(task, message);
	}

	#markTaskFailed(task: MutableStaticLayerTaskState, message: string): void {
		if (task.status === "failed") {
			return;
		}

		task.status = "failed";
		task.activeBakeBatchId = null;
		task.activeBakeStage = null;
		task.activeBakeStageStartedAtMs = null;
		task.phaseStartedAtMs = nowMs();
		this.#failed += 1;
		console.error(
			`static layer task ${task.taskId} failed; static content for ${task.scopeKey}/${task.domain} was not resolved.`,
			{
				message,
				revision: task.revision,
			},
		);
		this.#emit();
	}

	#recordResolvedPayload(payload: StaticScopePayload): void {
		if (payload.scope.kind === "terrain") {
			this.#latestTerrainPayload = {
				landblockId: payload.scope.landblock.landblockId,
				missingRefCount: payload.scope.missingRefs.length,
				quadCount: payload.scope.mesh.quadCount,
				regionNumber: payload.scope.terrainMaterial.identity.regionNumber,
				textureUseCount: payload.scope.textureUses.length,
				triangleCount: payload.scope.mesh.triangleCount,
				vertexCount: payload.scope.mesh.vertexCount,
			};
		}

		if (payload.scope.kind === "outdoor-static-objects") {
			this.#latestOutdoorStaticObjectsPayload = {
				domain: payload.scope.domain,
				landblockId: payload.scope.landblock.landblockId,
				materialSlotCount: payload.scope.materialSlots.length,
				materialSourceCount: payload.scope.materialSources.length,
				missingRefCount: payload.scope.missingRefs.length,
				objectCount: payload.scope.objects.length,
				objectKindCounts: countStaticObjectKinds(payload.scope.objects),
				sourceAssetCount: payload.scope.sourceAssets.length,
				textureRefCount: payload.scope.textureRefs.length,
			};
		}

		if (payload.scope.kind === "env-cell-system") {
			this.#latestEnvCellSystemPayload = {
				acceptedEnvCellCount: payload.scope.acceptedEnvCellIds.length,
				envCellCount: payload.scope.envCells.length,
				landblockId: payload.scope.landblock.landblockId,
				missingRefCount: payload.scope.missingRefs.length,
				portalCount: payload.scope.envCells.reduce(
					(count, envCell) => count + envCell.portals.length,
					0,
				),
				portalLinkCount: payload.scope.portalLinks.length,
				staticObjectPlacementCount: payload.scope.envCells.reduce(
					(count, envCell) => count + envCell.staticObjectPlacements.length,
					0,
				),
				visibilityDiagnosticCount: payload.scope.visibilityDiagnostics.length,
				visibleCellCount: countDistinctVisibleEnvCells(payload.scope.envCells),
			};
		}
		this.#emit();
	}

	#setTaskStatus(
		taskId: string,
		status: MutableStaticLayerTaskState["status"],
		options: {
			readonly activeBakeBatchId?: string | null;
			readonly activeBakeStage?: StaticActiveBakeStage | null;
		} = {},
	): void {
		const current = this.#layerTasksByTaskId.get(taskId);

		if (!current || !this.#isTaskCurrent(current)) {
			return;
		}

		current.status = status;
		current.activeBakeBatchId =
			status === "baking" ? (options.activeBakeBatchId ?? null) : null;
		current.activeBakeStage =
			status === "baking" ? (options.activeBakeStage ?? null) : null;
		current.activeBakeStageStartedAtMs =
			current.activeBakeStage !== null ? nowMs() : null;
		current.phaseStartedAtMs = nowMs();
		this.#emit();
	}

	#setTaskBakeStage(
		items: readonly StaticBakeBatchItem[],
		stage: StaticActiveBakeStage,
		bakeBatchId: string,
	): void {
		const stageStartedAtMs = nowMs();
		let changed = false;
		for (const item of items) {
			const current = this.#layerTasksByTaskId.get(item.task.taskId);
			if (
				!current ||
				current.status !== "baking" ||
				current.activeBakeBatchId !== bakeBatchId ||
				!this.#isTaskCurrent(current)
			) {
				continue;
			}
			current.activeBakeStage = stage;
			current.activeBakeStageStartedAtMs = stageStartedAtMs;
			changed = true;
		}
		if (changed) {
			this.#emit();
		}
	}

	#createOwnerStates(): readonly LayerOwnerState[] {
		return Array.from(this.#layerTasksByTaskId.values())
			.map((status) => ({
				key: status.ownerKey,
				lifecycle: createLayerOwnerLifecycle(
					status,
					this.#residentResourcesByOwnerId,
				),
				revision: status.revision,
			}))
			.sort((left, right) =>
				createLayerOwnerKeyId(left.key).localeCompare(
					createLayerOwnerKeyId(right.key),
				),
			);
	}

	#isTaskCurrent(task: MutableStaticLayerTaskState): boolean {
		return (
			!this.#disposed && this.#layerTasksByTaskId.get(task.taskId) === task
		);
	}

	#isBakeTaskCurrent(task: StaticBakeTask): boolean {
		const current = this.#layerTasksByTaskId.get(task.taskId);
		return current !== undefined && this.#isTaskCurrent(current);
	}

	#findPendingBatchForTask(
		task: MutableStaticLayerTaskState,
	): PendingStaticBakeBatch | null {
		for (const pendingBatch of this.#pendingBatches.values()) {
			if (
				pendingBatch.domain === task.domain &&
				pendingBatch.revision === task.revision
			) {
				return pendingBatch;
			}
		}
		return null;
	}

	#assertActive(): void {
		if (this.#disposed) {
			throw new Error("StaticCoordinator has been disposed.");
		}
	}

	#emit(): void {
		const snapshot = this.createSnapshot();

		for (const listener of this.#listeners) {
			listener(snapshot);
		}
	}

	#emitCommit(commit: StaticScopePrepCommit): void {
		for (const listener of this.#commitListeners) {
			listener(commit);
		}
	}

	#emitSourcePayloadDelta(delta: StaticCoordinatorSourcePayloadDelta): void {
		for (const listener of this.#sourcePayloadListeners) {
			listener(delta);
		}
	}

	#isLayerOwnerDemanded(ownerKey: LayerOwnerState["key"]): boolean {
		const ownerId = createLayerOwnerKeyId(ownerKey);
		for (const status of this.#layerTasksByTaskId.values()) {
			if (status.ownerId === ownerId) {
				return true;
			}
		}
		return false;
	}
}

type MutableStaticLayerTaskState = {
	activeBakeBatchId: string | null;
	activeBakeStage: StaticActiveBakeStage | null;
	activeBakeStageStartedAtMs: number | null;
	readonly ownerId: string;
	readonly ownerKey: LayerOwnerState["key"];
	domain: StaticDomain;
	phaseStartedAtMs: number;
	revision: number;
	scope: StaticLayerTaskRequest["scope"];
	scopeKey: string;
	taskId: string;
	status:
		| "requested"
		| "resolving"
		| "source-committed"
		| "baking"
		| "materializing"
		| "committed"
		| "failed";
};

type MutableStaticSourceResolutionDiagnostics = {
	readonly requestSeq: number;
	readonly requestId: string;
	readonly revision: number;
	readonly landblockId: number;
	readonly landblockHex: string;
	readonly context: StaticLandblockSceneLodSourceRequest["context"];
	readonly sourceLod: StaticLandblockSceneLodSourceRequest["sourceLod"];
	readonly layerKinds: readonly StaticLandblockSceneLodLayerRequest["kind"][];
	readonly taskIds: readonly string[];
	readonly ownerIds: readonly string[];
	status: StaticSourceResolutionDiagnostics["status"];
	readonly submittedAtMs: number;
	resolverMs: number | null;
	recipeCount: number | null;
	dynamicPlacementCount: number | null;
	dynamicRecipeCount: number | null;
	error: string | null;
};

interface StaticReconciliationRunState {
	/** Opaque id for one accepted scene-interest reconciliation. */
	readonly runId: string;
	/** Coordinator revision assigned to this run. */
	readonly revision: number;
	/** Desired layer owners after demand planning, keyed by stable owner id. */
	readonly desiredOwnerIds: ReadonlySet<string>;
	/** Layer owners retained by the runtime for this run. */
	readonly retainedLayerOwners: readonly LayerOwnerState["key"][];
}

interface PendingStaticBakeBatch {
	/** Opaque id for one open coordinator-side bake batch. */
	readonly batchId: string;
	readonly domain: StaticDomain;
	readonly revision: number;
	readonly items: PendingStaticBakeBatchItem[];
	readonly timeoutId: ReturnType<typeof setTimeout> | null;
}

interface PendingStaticBakeBatchItem {
	/** Stable layer owner id for diagnostics and demand checks. */
	readonly ownerId: string;
	/** Layer owner identity that owns any resources produced by this item. */
	readonly ownerKey: LayerOwnerState["key"];
	/** Static-authored dynamic placements discovered from the same source fanout. */
	readonly dynamicPlacements: readonly StaticAuthoredDynamicPlacementRecord[];
	/** Static-authored dynamic recipes discovered from the same source fanout. */
	readonly dynamicRecipes: readonly DynamicEntityRecipe[];
	readonly payload: StaticScopePayload;
	/** Source-resolution duration captured with the task instead of a side map. */
	readonly resolverMs: number;
	readonly task: StaticBakeTask;
	/** Stable task id used for currentness checks at async boundaries. */
	readonly taskId: string;
}

function createStaticBakeBatchId(input: {
	readonly domain: StaticDomain;
	readonly revision: number;
	readonly items: readonly StaticBakeBatchItem[];
}): string {
	const scopeKeys = input.items.map((item) => item.task.scopeKey);
	return [
		"static-batch",
		input.revision.toString(),
		input.domain,
		scopeKeys[0] ?? "empty",
		input.items.length.toString(),
	].join(":");
}

function createStaticAuthoredDynamicVisualBakeBatchId(
	bakeBatchId: string,
): string {
	return `${bakeBatchId}:static-authored-dynamic-visuals`;
}

function createPendingStaticBakeBatchId(
	task: MutableStaticLayerTaskState,
): string {
	return [
		"pending-static-batch",
		task.revision.toString(),
		task.domain,
		task.scopeKey,
		task.taskId,
	].join(":");
}

function getMaxPayloadsPerBatchForDomain(
	domain: StaticDomain,
	batching: StaticCoordinatorBatchingOptions,
): number {
	if (domain === "env-cell-system") {
		return 1;
	}
	return batching.maxPayloadsPerBatch;
}

function createStaticReconciliationRunId(revision: number): string {
	return `static-run:${revision}`;
}

function createStaticBakeTask(
	status: MutableStaticLayerTaskState,
): StaticBakeTask {
	return {
		domain: status.domain,
		ownerId: status.ownerId,
		ownerKey: status.ownerKey,
		revision: status.revision,
		scope: status.scope,
		scopeKey: status.scopeKey,
		taskId: status.taskId,
	};
}

function toStaticBakeBatchItem(
	item: PendingStaticBakeBatchItem,
): StaticBakeBatchItem {
	return {
		payload: item.payload,
		task: item.task,
	};
}

function findPendingStaticBakeItemResolverMs(
	items: readonly PendingStaticBakeBatchItem[],
	taskId: string,
): number | null {
	return items.find((item) => item.taskId === taskId)?.resolverMs ?? null;
}

function groupDynamicRecipesByOwnerId(
	recipes: readonly StaticAuthoredDynamicRecipe[],
): ReadonlyMap<string, readonly DynamicEntityRecipe[]> {
	const byOwnerId = new Map<string, DynamicEntityRecipe[]>();
	for (const entry of recipes) {
		const ownerId = createLayerOwnerKeyId(entry.targetOwnerKey);
		const ownerRecipes = byOwnerId.get(ownerId) ?? [];
		ownerRecipes.push(entry.recipe);
		byOwnerId.set(ownerId, ownerRecipes);
	}
	return byOwnerId;
}

function groupDynamicPlacementsByOwnerId(
	placements: readonly StaticAuthoredDynamicPlacementRecord[],
): ReadonlyMap<string, readonly StaticAuthoredDynamicPlacementRecord[]> {
	const byOwnerId = new Map<string, StaticAuthoredDynamicPlacementRecord[]>();
	for (const placement of placements) {
		const ownerId = createLayerOwnerKeyId(placement.owner.key);
		const ownerPlacements = byOwnerId.get(ownerId) ?? [];
		ownerPlacements.push(placement);
		byOwnerId.set(ownerId, ownerPlacements);
	}
	return byOwnerId;
}

function filterDynamicVisualBakeResultForCurrentTasks(
	result: DynamicVisualBakeResult | null,
	pendingItems: readonly PendingStaticBakeBatchItem[],
	currentTasks: readonly StaticBakeTask[],
): DynamicVisualBakeResult | null {
	if (!result) {
		return null;
	}
	const currentTaskIds = new Set(currentTasks.map((task) => task.taskId));
	const currentEntityIds = new Set(
		pendingItems
			.filter((item) => currentTaskIds.has(item.taskId))
			.flatMap((item) => item.dynamicRecipes.map((recipe) => recipe.entityId)),
	);
	return {
		...result,
		failures: result.failures.filter(
			(failure) =>
				failure.entityId === null || currentEntityIds.has(failure.entityId),
		),
		products: result.products.filter((product) =>
			currentEntityIds.has(getDynamicVisualBakeProductEntityId(product)),
		),
	};
}

function filterDynamicPlacementsForCurrentTasks(
	pendingItems: readonly PendingStaticBakeBatchItem[],
	currentTasks: readonly StaticBakeTask[],
): readonly StaticAuthoredDynamicPlacementRecord[] {
	const currentTaskIds = new Set(currentTasks.map((task) => task.taskId));
	return pendingItems
		.filter((item) => currentTaskIds.has(item.taskId))
		.flatMap((item) => item.dynamicPlacements);
}

function filterDynamicRecipesForCurrentTasks(
	pendingItems: readonly PendingStaticBakeBatchItem[],
	currentTasks: readonly StaticBakeTask[],
): readonly DynamicEntityRecipe[] {
	const currentTaskIds = new Set(currentTasks.map((task) => task.taskId));
	return pendingItems
		.filter((item) => currentTaskIds.has(item.taskId))
		.flatMap((item) => item.dynamicRecipes);
}

function filterDynamicVisualTexturePlanningsForRecipes(
	plannings: readonly DynamicVisualTexturePlanning[],
	recipes: readonly DynamicEntityRecipe[],
): readonly DynamicVisualTexturePlanning[] {
	const entityIds = new Set(recipes.map((recipe) => recipe.entityId));
	return plannings.filter((planning) => entityIds.has(planning.entityId));
}

function getDynamicVisualBakeProductEntityId(
	product: DynamicVisualBakeResult["products"][number],
): string {
	return product.kind === "baked"
		? product.resource.entityId
		: product.entityId;
}

function createSourceRequestsForNewWork(
	sourceRequests: readonly StaticLandblockSceneLodSourceRequest[],
	newLayerTasks: readonly StaticLayerTaskRequest[],
): readonly StaticLandblockSceneLodSourceRequest[] {
	const newOwnerIds = new Set(newLayerTasks.map((task) => task.ownerId));
	return sourceRequests.flatMap((sourceRequest) => {
		const requestedLayers = sourceRequest.requestedLayers.filter((layer) =>
			newOwnerIds.has(createLayerOwnerKeyId(layer.targetOwnerKey)),
		);
		if (requestedLayers.length === 0) {
			return [];
		}
		return [
			{
				...sourceRequest,
				requestedLayers,
				sourceLod: maxSourceLodForSourceLayers(requestedLayers),
			},
		];
	});
}

function maxSourceLodForSourceLayers(
	layers: readonly StaticLandblockSceneLodLayerRequest[],
): StaticLandblockSceneLodSourceRequest["sourceLod"] {
	let sourceLod: StaticLandblockSceneLodSourceRequest["sourceLod"] = 0;
	for (const layer of layers) {
		const layerLod = sourceLodForSourceLayer(layer.kind);
		if (layerLod > sourceLod) {
			sourceLod = layerLod;
		}
	}
	return sourceLod;
}

function sourceLodForSourceLayer(
	kind: StaticLandblockSceneLodLayerRequest["kind"],
): StaticLandblockSceneLodSourceRequest["sourceLod"] {
	switch (kind) {
		case "terrain":
			return 0;
		case "outdoor-buildings":
			return 1;
		case "outdoor-explicit-objects":
			return 2;
		case "outdoor-generated-scenery":
			return 3;
		case "env-cell-system":
			return 4;
	}
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}

function getDrawUnitOwnerId(drawUnit: StaticDrawUnit): string {
	if (
		drawUnit.kind === "terrain-geometry" ||
		drawUnit.kind === "static-object-geometry" ||
		drawUnit.kind === "structured-interior-geometry"
	) {
		return createLayerOwnerIdForDomainLandblock({
			domain: drawUnit.domain,
			landblockId: drawUnit.landblockId,
		});
	}

	throw new Error(
		`Static coordinator cannot commit ownerless draw unit ${String((drawUnit as { drawUnitId?: unknown }).drawUnitId ?? "unknown")}.`,
	);
}

function createCommitDrawUnits(
	result: StaticBakeBatchResult,
): StaticCoordinatorCommitDelta["addedDrawUnits"] {
	return result.drawUnits.filter(
		(drawUnit) =>
			drawUnit.kind !== "static-object-geometry" &&
			drawUnit.kind !== "structured-interior-geometry",
	);
}

function createLayerOwnerIdForDomainLandblock(input: {
	readonly domain: StaticDomain;
	readonly landblockId: number;
}): string {
	return createLayerOwnerKeyId(
		createLayerOwnerKeyForStaticScope({
			domain: input.domain,
			scope: {
				kind: "landblock",
				landblockId: input.landblockId,
			},
			scopeKey: `landblock:${formatHex32(input.landblockId)}`,
		}),
	);
}

function hasDemandedOwnerForDomain(
	ownerIds: ReadonlySet<string>,
	domain: StaticDomain,
): boolean {
	const ownerKind = createLayerOwnerKindForDomain(domain);
	for (const ownerId of ownerIds) {
		if (ownerId.startsWith(`${ownerKind}:`)) {
			return true;
		}
	}
	return false;
}

function createLayerOwnerKindForDomain(
	domain: StaticDomain,
): LayerOwnerState["key"]["kind"] {
	switch (domain) {
		case "outdoor-terrain":
			return "terrain";
		case "outdoor-buildings":
			return "outdoor-buildings";
		case "outdoor-explicit-objects":
			return "outdoor-explicit-objects";
		case "outdoor-generated-scenery":
			return "outdoor-generated-scenery";
		case "env-cell-system":
			return "env-cell-system";
	}
}

function collectCommittedResourceKeysByOwnerId(
	result: StaticBakeBatchResult,
): Map<string, StaticResourceKey[]> {
	const resourcesByOwnerId = new Map<string, StaticResourceKey[]>();
	for (const drawUnit of result.drawUnits.filter(
		(drawUnit) =>
			drawUnit.kind !== "static-object-geometry" &&
			drawUnit.kind !== "structured-interior-geometry",
	)) {
		addResourceKey(resourcesByOwnerId, getDrawUnitOwnerId(drawUnit), {
			drawUnitId: drawUnit.drawUnitId,
			kind: "draw-unit",
		});
	}
	for (const drawUnit of result.objectVisualInstallSet.directDrawUnits) {
		addResourceKey(resourcesByOwnerId, getDrawUnitOwnerId(drawUnit), {
			drawUnitId: drawUnit.drawUnitId,
			kind: "draw-unit",
		});
	}
	for (const resource of result.portalApertureResources) {
		addResourceKey(
			resourcesByOwnerId,
			createLayerOwnerIdForDomainLandblock({
				domain: resource.sourceDomain,
				landblockId: resource.landblockId,
			}),
			{
				apertureResourceId: resource.apertureResourceId,
				kind: "portal-aperture-resource",
			},
		);
	}
	const visualResourceDomains = new Map<
		string,
		{
			readonly domain: StaticObjectRenderInstance["domain"];
			readonly landblockId: number;
		}
	>();
	for (const instance of result.objectVisualInstallSet.renderInstances) {
		visualResourceDomains.set(instance.resourceId, {
			domain: instance.domain,
			landblockId: instance.landblockId,
		});
	}
	for (const resource of result.objectVisualInstallSet.visualResources) {
		const owner = visualResourceDomains.get(resource.resourceId);
		if (!owner) {
			continue;
		}
		addResourceKey(
			resourcesByOwnerId,
			createLayerOwnerIdForDomainLandblock({
				domain: owner.domain,
				landblockId: owner.landblockId,
			}),
			{
				kind: "static-object-visual-resource",
				resourceId: resource.resourceId,
			},
		);
	}
	return resourcesByOwnerId;
}

function createCommitTextureDependencies(
	result: StaticBakeBatchResult,
): StaticCoordinatorCommitDelta["textureDependencies"] {
	const legacyObjectResourceIds = new Set([
		...result.drawUnits
			.filter(
				(drawUnit) =>
					drawUnit.kind === "static-object-geometry" ||
					drawUnit.kind === "structured-interior-geometry",
			)
			.map((drawUnit) => drawUnit.drawUnitId),
		...result.objectVisualInstallSet.visualResources.map(
			(resource) => resource.resourceId,
		),
	]);
	return [
		...result.textureDependencies.filter(
			(dependency) => !legacyObjectResourceIds.has(dependency.resourceId),
		),
		...result.objectVisualInstallSet.textureDependencies,
	];
}

function addResourceKey(
	resourcesByOwnerId: Map<string, StaticResourceKey[]>,
	ownerId: string,
	resource: StaticResourceKey,
): void {
	const resources = resourcesByOwnerId.get(ownerId) ?? [];
	resources.push(resource);
	resourcesByOwnerId.set(ownerId, resources);
}

function compareMaterialCoverageReports(
	left: StaticMaterialCoverageReport,
	right: StaticMaterialCoverageReport,
): number {
	return (
		left.domain.localeCompare(right.domain) ||
		left.coverageKey.localeCompare(right.coverageKey)
	);
}

function filterStaticBakeResultForCurrentTasks(
	result: StaticBakeBatchResult,
	tasks: readonly StaticBakeTask[],
): StaticBakeBatchResult {
	const ownerIds = new Set(tasks.map((task) => task.ownerId));
	const drawUnitIds = new Set(
		result.drawUnits
			.filter((drawUnit) => ownerIds.has(getDrawUnitOwnerId(drawUnit)))
			.map((drawUnit) => drawUnit.drawUnitId),
	);
	const retainedPortalApertureResourceIds = new Set(
		result.portalApertureResources
			.filter((resource) =>
				ownerIds.has(
					createLayerOwnerIdForDomainLandblock({
						domain: resource.sourceDomain,
						landblockId: resource.landblockId,
					}),
				),
			)
			.map((resource) => resource.apertureResourceId),
	);
	const retainedObjectVisualInstallSet = filterObjectVisualInstallSetForOwners(
		result.objectVisualInstallSet,
		ownerIds,
	);
	const retainedObjectVisualResourceIds = new Set(
		retainedObjectVisualInstallSet.visualResources.map(
			(resource) => resource.resourceId,
		),
	);
	return {
		...result,
		drawUnits: result.drawUnits.filter((drawUnit) =>
			drawUnitIds.has(drawUnit.drawUnitId),
		),
		staticObjectBakeDiagnostics: result.staticObjectBakeDiagnostics.filter(
			(diagnostics) =>
				ownerIds.has(
					createLayerOwnerIdForDomainLandblock({
						domain: diagnostics.domain,
						landblockId: diagnostics.landblockId,
					}),
				),
		),
		materialCoverage: result.materialCoverage.filter((coverage) =>
			tasks.some((task) => task.domain === coverage.domain),
		),
		portalApertureResources: result.portalApertureResources.filter((resource) =>
			retainedPortalApertureResourceIds.has(resource.apertureResourceId),
		),
		envCellStaticObjectPlacementRecords:
			result.envCellStaticObjectPlacementRecords.filter((record) =>
				isPeerRecordOwnedByRetainedWork(record.owner, {
					drawUnitIds,
					ownerIds,
				}),
			),
		objectVisualInstallSet: retainedObjectVisualInstallSet,
		staticPortalInteriorRecords: result.staticPortalInteriorRecords.filter(
			(record) =>
				isPeerRecordOwnedByRetainedWork(record.owner, {
					drawUnitIds,
					ownerIds,
				}),
		),
		staticPortalGraphs: result.staticPortalGraphs.filter((record) =>
			isPeerRecordOwnedByRetainedWork(record.owner, {
				drawUnitIds,
				ownerIds,
			}),
		),
		staticSourceMappings: result.staticSourceMappings.filter((record) =>
			isPeerRecordOwnedByRetainedWork(record.owner, {
				drawUnitIds,
				ownerIds,
			}),
		),
		staticSpatialRecords: result.staticSpatialRecords.filter((record) =>
			isPeerRecordOwnedByRetainedWork(record.owner, {
				drawUnitIds,
				ownerIds,
			}),
		),
		staticVisibilityRecords: result.staticVisibilityRecords.filter((record) =>
			isPeerRecordOwnedByRetainedWork(record.owner, {
				drawUnitIds,
				ownerIds,
			}),
		),
		textureUses: result.textureUses.filter((textureUse) =>
			textureUse.owners.some((owner) =>
				owner.kind === "draw-unit"
					? drawUnitIds.has(owner.drawUnitId)
					: retainedObjectVisualResourceIds.has(owner.resourceId),
			),
		),
		textureDependencies: result.textureDependencies.filter((dependency) =>
			drawUnitIds.has(dependency.resourceId),
		),
		tasks,
	};
}

function filterObjectVisualInstallSetForOwners(
	installSet: ObjectVisualInstallSet,
	ownerIds: ReadonlySet<string>,
): ObjectVisualInstallSet {
	const directDrawUnits = installSet.directDrawUnits.filter((drawUnit) =>
		ownerIds.has(getDrawUnitOwnerId(drawUnit)),
	);
	const renderInstances = installSet.renderInstances.filter((instance) =>
		ownerIds.has(
			createLayerOwnerIdForDomainLandblock({
				domain: instance.domain,
				landblockId: instance.landblockId,
			}),
		),
	);
	const retainedVisualResourceIds = new Set(
		renderInstances.map((instance) => instance.resourceId),
	);
	const visualResources = installSet.visualResources.filter((resource) =>
		retainedVisualResourceIds.has(resource.resourceId),
	);
	const retainedResourceIds = new Set([
		...directDrawUnits.map((drawUnit) => drawUnit.drawUnitId),
		...visualResources.map((resource) => resource.resourceId),
	]);
	return createObjectVisualInstallSet({
		directDrawUnits,
		dynamicAnimationPartBindings:
			installSet.dynamicAnimationPartBindings.filter((binding) =>
				binding.renderPartIds.some((renderPartId) =>
					retainedResourceIds.has(renderPartId),
				),
			),
		renderInstances,
		textureDependencies: installSet.textureDependencies.filter((dependency) =>
			retainedResourceIds.has(dependency.resourceId),
		),
		visualResources,
	});
}

function isPeerRecordOwnedByRetainedWork(
	owner: StaticPeerRecordOwner,
	retained: {
		readonly drawUnitIds: ReadonlySet<string>;
		readonly ownerIds: ReadonlySet<string>;
	},
): boolean {
	if (owner.kind === "draw-unit") {
		return retained.drawUnitIds.has(owner.drawUnitId);
	}
	return retained.ownerIds.has(owner.ownerId);
}

function toStaticLayerTaskStatus(
	status: MutableStaticLayerTaskState,
): StaticLayerTaskStatus {
	const activeBakeStageStartedAtMs = status.activeBakeStageStartedAtMs;
	return {
		activeBakeBatchId: status.activeBakeBatchId,
		activeBakeStage: status.activeBakeStage,
		activeBakeStageAgeMs:
			activeBakeStageStartedAtMs !== null
				? nowMs() - activeBakeStageStartedAtMs
				: null,
		activeBakeStageStartedAtMs,
		domain: status.domain,
		ownerId: status.ownerId,
		ownerKey: status.ownerKey,
		phase: createStaticLayerTaskPhase(status.status),
		phaseAgeMs: nowMs() - status.phaseStartedAtMs,
		phaseStartedAtMs: status.phaseStartedAtMs,
		revision: status.revision,
		scopeKey: status.scopeKey,
		taskId: status.taskId,
	};
}

function createStaticLayerTaskPhase(
	status: MutableStaticLayerTaskState["status"],
): StaticLayerTaskStatus["phase"] {
	switch (status) {
		case "requested":
		case "resolving":
		case "baking":
		case "committed":
		case "failed":
			return status;
		case "source-committed":
			return "source-resolved";
		case "materializing":
			return "materializing";
	}
}

function createLayerOwnerLifecycle(
	status: MutableStaticLayerTaskState,
	residentResourcesByOwnerId: ReadonlyMap<string, readonly StaticResourceKey[]>,
): LayerOwnerLifecycle {
	switch (status.status) {
		case "requested":
			return "desired";
		case "resolving":
		case "source-committed":
			return "resolving";
		case "baking":
			return "baking";
		case "materializing":
			return "materializing";
		case "committed":
			return (residentResourcesByOwnerId.get(status.ownerId)?.length ?? 0) > 0
				? "materialized"
				: "empty";
		case "failed":
			return "failed";
	}
}

function createStaticCommitId(options: {
	readonly revision: number;
	readonly tasks: readonly StaticBakeTask[];
}): string {
	return [
		"static-commit",
		options.revision.toString(),
		...options.tasks.map((task) => task.taskId).sort(),
	].join(":");
}

function createStaticEvictionCommitId(revision: number): string {
	return ["static-commit", revision.toString(), "evict"].join(":");
}

function createStaticObjectBakeDiagnosticsKey(
	diagnostics: StaticObjectBakeDiagnostics,
): string {
	return [
		"static-object-bake-diagnostics",
		diagnostics.domain,
		formatHex32(diagnostics.landblockId),
	].join(":");
}

function compareStaticObjectBakeDiagnostics(
	left: StaticObjectBakeDiagnostics,
	right: StaticObjectBakeDiagnostics,
): number {
	return (
		left.domain.localeCompare(right.domain) ||
		left.landblockId - right.landblockId
	);
}

function sumNullableNumbers(values: readonly (number | null)[]): number | null {
	const present = values.filter((value): value is number => value !== null);
	if (present.length === 0) {
		return null;
	}
	return present.reduce((sum, value) => sum + value, 0);
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function countDistinctVisibleEnvCells(
	envCells: readonly {
		readonly visibleEnvCellIds: readonly number[];
	}[],
): number {
	const visible = new Set<number>();

	for (const envCell of envCells) {
		for (const envCellId of envCell.visibleEnvCellIds) {
			visible.add(envCellId);
		}
	}

	return visible.size;
}

function countStaticObjectKinds(
	objects: readonly {
		readonly identity: {
			readonly objectKind: "building" | "explicit-object" | "generated-scenery";
		};
	}[],
): OutdoorStaticObjectsPayloadSummary["objectKindCounts"] {
	const counts: {
		-readonly [K in keyof OutdoorStaticObjectsPayloadSummary["objectKindCounts"]]: number;
	} = {
		building: 0,
		"explicit-object": 0,
		"generated-scenery": 0,
	};

	for (const object of objects) {
		counts[object.identity.objectKind] += 1;
	}

	return counts;
}

function countPhase(
	tasks: readonly StaticLayerTaskStatus[],
	phase: StaticLayerTaskStatus["phase"],
): number {
	return tasks.filter((task) => task.phase === phase).length;
}

function disposeIfAvailable(value: unknown): void {
	if (
		typeof value === "object" &&
		value !== null &&
		"dispose" in value &&
		typeof value.dispose === "function"
	) {
		value.dispose();
	}
}
