import type {
	StaticAtlasBatchSnapshot,
	StaticBakeAttachmentProvider,
	StaticBakeBatchInput,
	StaticBakeBatchResult,
	StaticBakeBatchItem,
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
	StaticLandblockSceneLodLayerRequest,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticMaterialCoverageReport,
	LandblockEnvCellsPayloadSummary,
	OutdoorStaticObjectsPayloadSummary,
	StaticObjectBakeDiagnostics,
	StaticObjectRenderInstance,
	StaticResolver,
	StaticPeerRecordOwner,
	StaticResourceKey,
	StaticRetentionReconciliation,
	StaticScopePayload,
	TerrainStaticScopePayloadSummary,
	ScheduledStaticWork,
	ScheduledStaticWorkStatus,
} from "../contracts";
import { describeStaticScopeKey, planStaticDemand } from "../demand-planner";
import { createEmptyStaticBakeAttachments } from "../bake/attachments";
import {
	createLayerOwnerKeyForStaticScope,
	createLayerOwnerKeyId,
} from "../layer-owners";

const DEFAULT_STATIC_BATCH_MAX_PAYLOADS = 10;
const DEFAULT_STATIC_BATCH_COALESCE_DELAY_MS = 500;
const STATIC_COORDINATOR_RECENT_DIAGNOSTICS_LIMIT = 20;
const DEFAULT_STATIC_BAKE_ATTACHMENT_PROVIDER: StaticBakeAttachmentProvider = {
	createAttachments: () => Promise.resolve(createEmptyStaticBakeAttachments()),
};

export type StaticCoordinatorListener = (
	snapshot: StaticCoordinatorSnapshot,
) => void;
export type StaticCoordinatorCommitListener = (
	delta: StaticCoordinatorCommitDelta,
) => void;
export type StaticCoordinatorSourcePayloadListener = (
	delta: StaticCoordinatorSourcePayloadDelta,
) => void;

export interface StaticCoordinatorOptions {
	readonly resolver: StaticResolver & StaticLandblockSceneLodSourceResolver;
	readonly baker: StaticBaker;
	readonly attachmentProvider?: StaticBakeAttachmentProvider;
	readonly batching?: Partial<StaticCoordinatorBatchingOptions>;
	readonly createAtlasSnapshot?: (
		payloads: readonly StaticScopePayload[],
		staticBatchId: string,
	) => StaticAtlasBatchSnapshot;
}

export interface StaticCoordinatorBatchingOptions {
	readonly maxPayloadsPerBatch: number;
	readonly maxWaitMs: number;
}

export class StaticCoordinator {
	readonly #resolver: StaticResolver & StaticLandblockSceneLodSourceResolver;
	readonly #baker: StaticBaker;
	readonly #attachmentProvider: StaticBakeAttachmentProvider;
	readonly #batching: StaticCoordinatorBatchingOptions;
	#createAtlasSnapshot: (
		payloads: readonly StaticScopePayload[],
		staticBatchId: string,
	) => StaticAtlasBatchSnapshot;
	readonly #listeners = new Set<StaticCoordinatorListener>();
	readonly #commitListeners = new Set<StaticCoordinatorCommitListener>();
	readonly #sourcePayloadListeners =
		new Set<StaticCoordinatorSourcePayloadListener>();
	readonly #activeWork = new Map<string, MutableScheduledStaticWorkStatus>();
	readonly #pendingBatches = new Map<string, PendingStaticBakeBatch>();
	readonly #residentDrawUnitIds = new Set<string>();
	readonly #residentResourcesByOwnerId = new Map<
		string,
		StaticResourceKey[]
	>();
	#revision = 0;
	#disposed = false;
	#committed = 0;
	#failed = 0;
	#staleResolverResults = 0;
	#staleBakeResults = 0;
	#committedDrawUnits = 0;
	#latestTerrainPayload: TerrainStaticScopePayloadSummary | null = null;
	#latestOutdoorStaticObjectsPayload: OutdoorStaticObjectsPayloadSummary | null =
		null;
	#latestLandblockEnvCellsPayload: LandblockEnvCellsPayloadSummary | null =
		null;
	readonly #latestStaticObjectBakeDiagnosticsByKey = new Map<
		string,
		StaticObjectBakeDiagnostics
	>();
	readonly #recentTiming: StaticCoordinatorTimingDiagnostics[] = [];
	readonly #resolverMsByWorkId = new Map<string, number>();
	readonly #latestMaterialCoverageByKey = new Map<
		string,
		StaticMaterialCoverageReport
	>();
	constructor(options: StaticCoordinatorOptions) {
		this.#resolver = options.resolver;
		this.#baker = options.baker;
		this.#attachmentProvider =
			options.attachmentProvider ?? DEFAULT_STATIC_BAKE_ATTACHMENT_PROVIDER;
		this.#batching = {
			maxPayloadsPerBatch:
				options.batching?.maxPayloadsPerBatch ??
				DEFAULT_STATIC_BATCH_MAX_PAYLOADS,
			maxWaitMs:
				options.batching?.maxWaitMs ?? DEFAULT_STATIC_BATCH_COALESCE_DELAY_MS,
		};
		this.#createAtlasSnapshot =
			options.createAtlasSnapshot ?? createEmptyAtlasSnapshotForPayload;
	}

	setAtlasSnapshotProvider(
		createAtlasSnapshot: (
			payloads: readonly StaticScopePayload[],
			staticBatchId: string,
		) => StaticAtlasBatchSnapshot,
	): void {
		this.#createAtlasSnapshot = createAtlasSnapshot;
	}

	reconcileStaticDemand(demand: StaticDemand): StaticRetentionReconciliation {
		this.#assertActive();
		this.#revision += 1;
		const demandPlan = planStaticDemand(demand, this.#revision);
		const desiredKeys = new Set(demandPlan.work.map(createDesiredWorkKey));
		const desiredOwnerIds = new Set(
			demandPlan.work.map((work) => createLayerOwnerKeyIdForWork(work)),
		);
		const newWorkItems: ScheduledStaticWork[] = [];

		for (const status of Array.from(this.#activeWork.values())) {
			if (!desiredKeys.has(status.desiredKey)) {
				this.#activeWork.delete(status.workId);
			}
		}
		const removedResources = this.#evictResidentResourcesExcept(desiredOwnerIds);
		if (removedResources.length > 0) {
			this.#emitEvictionCommitDelta({ removedResources });
		}
		this.#pruneMaterialCoverageByOwnerIds(desiredOwnerIds);
		this.#pruneStaticObjectBakeDiagnosticsByOwnerIds(desiredOwnerIds);

		for (const work of demandPlan.work) {
			const desiredKey = createDesiredWorkKey(work);
			const existing = this.#findActiveWorkByDesiredKey(desiredKey);
			if (existing && existing.status !== "failed") {
				continue;
			}
			if (existing) {
				this.#activeWork.delete(existing.workId);
			}
			this.#activeWork.set(work.workId, {
				desiredKey,
				domain: work.job.domain,
				ownerId: createLayerOwnerKeyIdForWork(work),
				ownerKey: createLayerOwnerKeyForWork(work),
				workId: work.workId,
				revision: work.revision,
				scopeKey: describeStaticScopeKey(work.job.scope),
				status: "requested",
				work,
			});
			newWorkItems.push(work);
		}

		this.#emit();

		for (const work of newWorkItems) {
			this.#setStatus(work, "resolving");
		}

		for (const sourceRequest of createSourceRequestsForNewWork(
			demandPlan.sourceRequests,
			newWorkItems,
		)) {
			void this.#resolveSourceThenBake(sourceRequest);
		}

		const activeWork = demandPlan.work
			.map((work) =>
				this.#findActiveWorkByDesiredKey(createDesiredWorkKey(work)),
			)
			.filter((status): status is MutableScheduledStaticWorkStatus =>
				Boolean(status),
			)
			.map((status) => status.work);

		return {
			activeWork,
			removedResources,
			retainedScopes: demandPlan.retainedScopes,
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

	subscribeSourcePayloads(
		listener: StaticCoordinatorSourcePayloadListener,
	): () => void {
		this.#sourcePayloadListeners.add(listener);

		return () => {
			this.#sourcePayloadListeners.delete(listener);
		};
	}

	createSnapshot(): StaticCoordinatorSnapshot {
		const activeWork = Array.from(this.#activeWork.values()).map(
			toScheduledStaticWorkStatus,
		);
		const ownerStates = this.#createOwnerStates();

		return {
			activeWork,
			baking: countStatus(activeWork, "baking"),
			committed: this.#committed,
			committedDrawUnits: this.#committedDrawUnits,
			failed: this.#failed,
			latestLandblockEnvCellsPayload: this.#latestLandblockEnvCellsPayload,
			materialCoverage: Array.from(
				this.#latestMaterialCoverageByKey.values(),
			).sort(compareMaterialCoverageReports),
			latestOutdoorStaticObjectsPayload:
				this.#latestOutdoorStaticObjectsPayload,
			latestTerrainPayload: this.#latestTerrainPayload,
			ownerStates,
			recentTiming: [...this.#recentTiming],
			requested: activeWork.length,
			resolving: countStatus(activeWork, "resolving"),
			revision: this.#revision,
			staleBakeResults: this.#staleBakeResults,
			staleResolverResults: this.#staleResolverResults,
			staticObjectBakeDiagnostics: Array.from(
				this.#latestStaticObjectBakeDiagnosticsByKey.values(),
			).sort(compareStaticObjectBakeDiagnostics),
		};
	}

	createOverviewSnapshot(): StaticCoordinatorOverviewSnapshot {
		const activeWork = Array.from(this.#activeWork.values());
		return {
			baking: activeWork.filter((work) => work.status === "baking").length,
			committed: this.#committed,
			latestLandblockEnvCellsPayload: this.#latestLandblockEnvCellsPayload,
			latestTerrainPayload: this.#latestTerrainPayload,
			requested: activeWork.length,
			resolving: activeWork.filter((work) => work.status === "resolving")
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
		this.#activeWork.clear();
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
		const works = sourceRequest.requestedLayers.flatMap((layer) => {
			const work = this.#findActiveWorkByDesiredKey(
				createDesiredWorkKeyForSourceLayer(sourceRequest.landblockId, layer),
			)?.work;
			return work ? [work] : [];
		});
		const resolverStartedAt = nowMs();
		let resolution: Awaited<
			ReturnType<StaticLandblockSceneLodSourceResolver["resolveSource"]>
		>;
		try {
			resolution = await this.#resolver.resolveSource(sourceRequest);
		} catch (error: unknown) {
			for (const work of works) {
				this.#markFailedIfCurrent(
					work,
					error instanceof Error ? error.message : String(error),
				);
			}
			return;
		}
		const resolverMs = nowMs() - resolverStartedAt;

		for (const recipe of resolution.recipes) {
			const work = this.#findActiveWorkByDesiredKey(
				createDesiredWorkKeyForJob(recipe.payload.job),
			)?.work;
			if (
				!work ||
				!this.#isCurrent(work) ||
				!this.#isLayerOwnerDemanded(recipe.targetOwnerKey)
			) {
				this.#staleResolverResults += 1;
				this.#emit();
				continue;
			}

			this.#resolverMsByWorkId.set(work.workId, resolverMs);

			this.#recordResolvedPayload(recipe.payload);
			this.#emitSourcePayloadDelta({
				payload: recipe.payload,
				revision: work.revision,
				work,
			});
			this.#enqueueBakePayload(work, recipe.payload, recipe.targetOwnerKey);
		}
	}

	#enqueueBakePayload(
		work: ScheduledStaticWork,
		payload: StaticScopePayload,
		targetOwnerKey: LayerOwnerState["key"],
	): void {
		const batchKey = createPendingBatchKey(work);
		let pendingBatch = this.#pendingBatches.get(batchKey);
		if (!pendingBatch) {
			const timeoutId =
				this.#batching.maxWaitMs > 0
					? setTimeout(
							() => this.#flushPendingBatch(batchKey),
							this.#batching.maxWaitMs,
						)
					: null;
			if (!timeoutId) {
				queueMicrotask(() => void this.#flushPendingBatch(batchKey));
			}
			pendingBatch = {
				domain: work.job.domain,
				items: [],
				revision: work.revision,
				timeoutId,
			};
			this.#pendingBatches.set(batchKey, pendingBatch);
		}

		pendingBatch.items.push({
			payload,
			targetOwnerKey,
			work,
		});
		if (pendingBatch.items.length >= this.#batching.maxPayloadsPerBatch) {
			this.#flushPendingBatch(batchKey);
		}
	}

	async #flushPendingBatch(batchKey: string): Promise<void> {
		const pendingBatch = this.#pendingBatches.get(batchKey);
		if (!pendingBatch) {
			return;
		}

		this.#pendingBatches.delete(batchKey);
		if (pendingBatch.timeoutId) {
			clearTimeout(pendingBatch.timeoutId);
		}

		const items = pendingBatch.items.filter(
			(item) =>
				this.#isCurrent(item.work) &&
				this.#isLayerOwnerDemanded(item.targetOwnerKey),
		);
		if (items.length === 0) {
			return;
		}

		for (const item of items) {
			this.#setStatus(item.work, "baking");
		}

		const staticBatchId = createStaticBatchId({
			domain: pendingBatch.domain,
			items,
			revision: pendingBatch.revision,
		});
		let attachments: StaticBakeBatchInput["attachments"];
		const attachmentStartedAt = nowMs();
		try {
			attachments = await this.#attachmentProvider.createAttachments({
				domain: pendingBatch.domain,
				items,
				revision: pendingBatch.revision,
				staticBatchId,
			});
		} catch (error: unknown) {
			for (const item of items) {
				this.#markFailedIfCurrent(
					item.work,
					error instanceof Error ? error.message : String(error),
				);
			}
			return;
		}
		const attachmentMs = nowMs() - attachmentStartedAt;
		const bakeInput: StaticBakeBatchInput = {
			atlasSnapshot: this.#createAtlasSnapshot(
				items.map((item) => item.payload),
				staticBatchId,
			),
			attachments,
			domain: pendingBatch.domain,
			items,
			revision: pendingBatch.revision,
			staticBatchId,
		};

		let result: StaticBakeBatchResult;
		const bakeStartedAt = nowMs();
		try {
			result = await this.#baker.bake(bakeInput);
		} catch (error: unknown) {
			for (const item of items) {
				this.#markFailedIfCurrent(
					item.work,
					error instanceof Error ? error.message : String(error),
				);
			}
			return;
		}
		const bakeMs = nowMs() - bakeStartedAt;

		const currentWorks = result.works.filter(
			(work) => this.#isCurrent(work) && this.#isWorkOwnerDemanded(work),
		);
		if (currentWorks.length !== result.works.length) {
			this.#staleBakeResults += result.works.length - currentWorks.length;
			result = filterStaticBakeResultForWorks(result, currentWorks);
			if (currentWorks.length === 0) {
				this.#emit();
				return;
			}
		}

		try {
			this.#commit(result, {
				attachmentMs,
				bakeMs,
				resolverMs: sumNullableNumbers(
					currentWorks.map(
						(work) => this.#resolverMsByWorkId.get(work.workId) ?? null,
					),
				),
			});
		} catch (error: unknown) {
			for (const work of currentWorks) {
				this.#markFailedIfCurrent(
					work,
					error instanceof Error ? error.message : String(error),
				);
			}
		}
	}

	#commit(
		result: StaticBakeBatchResult,
		timing: {
			readonly resolverMs: number | null;
			readonly attachmentMs: number | null;
			readonly bakeMs: number | null;
		},
	): void {
		const commitStartedAt = nowMs();
		const resourcesByOwnerId = collectCommittedResourceKeysByOwnerId(result);

		for (const work of result.works) {
			const status = this.#activeWork.get(work.workId);
			if (!status) {
				continue;
			}
			status.status = "committed";
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
		for (const work of result.works) {
			this.#resolverMsByWorkId.delete(work.workId);
		}
		this.#recordTiming({
			attachmentMs: timing.attachmentMs,
			bakeMs: timing.bakeMs,
			commitMs: nowMs() - commitStartedAt,
			domain: result.domain,
			itemCount: result.works.length,
			kind: "static-coordinator-timing",
			resolverMs: timing.resolverMs,
			revision: result.revision,
			staticBatchId: result.staticBatchId,
		});
		this.#emitCommitDelta({
			addedDrawUnits: result.drawUnits,
			addedPortalApertureResources: result.portalApertureResources,
			materialCoverage: result.materialCoverage,
			removedResources: [],
			revision: result.revision,
			staticAuthoredDynamicSeeds: result.staticAuthoredDynamicSeeds,
			staticBatchId: result.staticBatchId,
			staticObjectRenderInstances: result.staticObjectRenderInstances,
			staticObjectVisualResources: result.staticObjectVisualResources,
			staticPortalGraphs: result.staticPortalGraphs,
			staticPortalInteriorRecords: result.staticPortalInteriorRecords,
			staticSourceMappings: result.staticSourceMappings,
			staticSpatialRecords: result.staticSpatialRecords,
			staticVisibilityRecords: result.staticVisibilityRecords,
			textureUses: result.textureUses,
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
		this.#emitCommitDelta({
			addedDrawUnits: [],
			addedPortalApertureResources: [],
			materialCoverage: [],
			removedResources: options.removedResources,
			revision: this.#revision,
			staticAuthoredDynamicSeeds: [],
			staticBatchId: createEvictionStaticBatchId(this.#revision),
			staticObjectRenderInstances: [],
			staticObjectVisualResources: [],
			staticPortalGraphs: [],
			staticPortalInteriorRecords: [],
			staticSourceMappings: [],
			staticSpatialRecords: [],
			staticVisibilityRecords: [],
			textureUses: [],
		});
	}

	#findActiveWorkByDesiredKey(
		desiredKey: string,
	): MutableScheduledStaticWorkStatus | null {
		for (const status of this.#activeWork.values()) {
			if (status.desiredKey === desiredKey) {
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

	#markFailedIfCurrent(work: ScheduledStaticWork, message: string): void {
		if (!this.#isCurrent(work)) {
			return;
		}

		const status = this.#activeWork.get(work.workId);

		if (status) {
			status.status = "failed";
			this.#failed += 1;
			console.error(
				`static resolver work ${work.workId} failed; static content for ${describeStaticScopeKey(work.job.scope)}/${work.job.domain} was not resolved.`,
				{
					message,
					revision: work.revision,
				},
			);
			this.#emit();
		}
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

		if (payload.scope.kind === "landblock-env-cells") {
			this.#latestLandblockEnvCellsPayload = {
				acceptedEnvCellCount: payload.scope.acceptedEnvCellIds.length,
				envCellCount: payload.scope.envCells.length,
				landblockId: payload.scope.landblock.landblockId,
				missingRefCount: payload.scope.missingRefs.length,
				portalCount: payload.scope.envCells.reduce(
					(count, envCell) => count + envCell.portals.length,
					0,
				),
				portalLinkCount: payload.scope.portalLinks.length,
				staticObjectSeedCount: payload.scope.envCells.reduce(
					(count, envCell) => count + envCell.staticObjectSeeds.length,
					0,
				),
				visibilityDiagnosticCount: payload.scope.visibilityDiagnostics.length,
				visibleCellCount: countDistinctVisibleEnvCells(payload.scope.envCells),
			};
		}
		this.#emit();
	}

	#setStatus(
		work: ScheduledStaticWork,
		status: MutableScheduledStaticWorkStatus["status"],
	): void {
		if (!this.#isCurrent(work)) {
			return;
		}

		const current = this.#activeWork.get(work.workId);

		if (!current) {
			return;
		}

		current.status = status;
		this.#emit();
	}

	#createOwnerStates(): readonly LayerOwnerState[] {
		return Array.from(this.#activeWork.values())
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

	#isCurrent(work: ScheduledStaticWork): boolean {
		return !this.#disposed && this.#activeWork.has(work.workId);
	}

	#isWorkOwnerDemanded(work: ScheduledStaticWork): boolean {
		return this.#isLayerOwnerDemanded(createLayerOwnerKeyForWork(work));
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

	#emitCommitDelta(delta: StaticCoordinatorCommitDelta): void {
		for (const listener of this.#commitListeners) {
			listener(delta);
		}
	}

	#emitSourcePayloadDelta(delta: StaticCoordinatorSourcePayloadDelta): void {
		for (const listener of this.#sourcePayloadListeners) {
			listener(delta);
		}
	}

	#isLayerOwnerDemanded(ownerKey: LayerOwnerState["key"]): boolean {
		const ownerId = createLayerOwnerKeyId(ownerKey);
		for (const status of this.#activeWork.values()) {
			if (status.ownerId === ownerId) {
				return true;
			}
		}
		return false;
	}
}

type MutableScheduledStaticWorkStatus = {
	-readonly [Key in keyof ScheduledStaticWorkStatus]: ScheduledStaticWorkStatus[Key];
} & {
	readonly desiredKey: string;
	readonly ownerId: string;
	readonly ownerKey: LayerOwnerState["key"];
	readonly work: ScheduledStaticWork;
};

interface PendingStaticBakeBatch {
	readonly domain: ScheduledStaticWork["job"]["domain"];
	readonly revision: number;
	readonly items: StaticBakeBatchItem[];
	readonly timeoutId: ReturnType<typeof setTimeout> | null;
}

function createEmptyAtlasSnapshotForPayload(
	payloads: readonly StaticScopePayload[],
	staticBatchId: string,
): StaticAtlasBatchSnapshot {
	const firstPayload = payloads[0];

	return {
		domain: firstPayload?.job.domain ?? "outdoor-terrain",
		placements: [],
		staticBatchId,
		textureUses: payloads.flatMap((payload) =>
			payload.scope.kind === "placeholder"
				? payload.scope.referencedTextureUses
				: payload.scope.kind === "terrain"
					? payload.scope.textureUses.map((textureUse) => textureUse.texture)
					: [],
		),
	};
}

function createStaticBatchId(input: {
	readonly domain: ScheduledStaticWork["job"]["domain"];
	readonly revision: number;
	readonly items: readonly StaticBakeBatchItem[];
}): string {
	const scopeKeys = input.items.map((item) =>
		describeStaticScopeKey(item.work.job.scope),
	);
	return [
		"static-batch",
		input.revision.toString(),
		input.domain,
		scopeKeys[0] ?? "empty",
		input.items.length.toString(),
	].join(":");
}

function createPendingBatchKey(work: ScheduledStaticWork): string {
	return [work.revision.toString(), work.job.domain].join(":");
}

function createDesiredWorkKey(work: ScheduledStaticWork): string {
	return `${describeStaticScopeKey(work.job.scope)}:${work.job.domain}`;
}

function createDesiredWorkKeyForJob(job: ScheduledStaticWork["job"]): string {
	return `${describeStaticScopeKey(job.scope)}:${job.domain}`;
}

function createDesiredWorkKeyForSourceLayer(
	landblockId: number,
	layer: StaticLandblockSceneLodLayerRequest,
): string {
	return `landblock:${formatHex32(landblockId)}:${staticDomainForSourceLayer(layer.kind)}`;
}

function createSourceRequestsForNewWork(
	sourceRequests: readonly StaticLandblockSceneLodSourceRequest[],
	newWorkItems: readonly ScheduledStaticWork[],
): readonly StaticLandblockSceneLodSourceRequest[] {
	const newDesiredKeys = new Set(newWorkItems.map(createDesiredWorkKey));
	return sourceRequests.flatMap((sourceRequest) => {
		const requestedLayers = sourceRequest.requestedLayers.filter((layer) =>
			newDesiredKeys.has(
				createDesiredWorkKeyForSourceLayer(sourceRequest.landblockId, layer),
			),
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

function staticDomainForSourceLayer(
	kind: StaticLandblockSceneLodLayerRequest["kind"],
): StaticDomain {
	switch (kind) {
		case "terrain":
			return "outdoor-terrain";
		case "outdoor-buildings":
			return "outdoor-buildings";
		case "outdoor-explicit-objects":
			return "outdoor-explicit-objects";
		case "outdoor-generated-scenery":
			return "outdoor-generated-scenery";
		case "env-cell-system":
			return "landblock-env-cells";
	}
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

function createDesiredKeyForDrawUnit(input: {
	readonly domain: StaticDomain;
	readonly landblockId: number;
}): string {
	return `landblock:${(input.landblockId >>> 0).toString(16).padStart(8, "0")}:${input.domain}`;
}

function getDrawUnitDesiredKey(drawUnit: StaticDrawUnit): string {
	if (
		drawUnit.kind === "terrain-geometry" ||
		drawUnit.kind === "static-object-geometry" ||
		drawUnit.kind === "structured-interior-geometry"
	) {
		return createDesiredKeyForDrawUnit({
			domain: drawUnit.domain,
			landblockId: drawUnit.landblockId,
		});
	}

	throw new Error(
		`Static coordinator cannot commit ownerless draw unit ${String((drawUnit as { drawUnitId?: unknown }).drawUnitId ?? "unknown")}.`,
	);
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

function createLayerOwnerKeyForWork(
	work: ScheduledStaticWork,
): LayerOwnerState["key"] {
	return createLayerOwnerKeyForStaticScope({
		domain: work.job.domain,
		scope: work.job.scope,
		scopeKey: describeStaticScopeKey(work.job.scope),
	});
}

function createLayerOwnerKeyIdForWork(work: ScheduledStaticWork): string {
	return createLayerOwnerKeyId(createLayerOwnerKeyForWork(work));
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
		case "outdoor-detail":
			return "outdoor-generated-scenery";
		case "landblock-env-cells":
			return "env-cell-system";
	}
}

function collectCommittedResourceKeysByOwnerId(
	result: StaticBakeBatchResult,
): Map<string, StaticResourceKey[]> {
	const resourcesByOwnerId = new Map<string, StaticResourceKey[]>();
	for (const drawUnit of result.drawUnits) {
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
	for (const instance of result.staticObjectRenderInstances) {
		visualResourceDomains.set(instance.resourceId, {
			domain: instance.domain,
			landblockId: instance.landblockId,
		});
	}
	for (const resource of result.staticObjectVisualResources) {
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

function filterStaticBakeResultForWorks(
	result: StaticBakeBatchResult,
	works: readonly ScheduledStaticWork[],
): StaticBakeBatchResult {
	const desiredKeys = new Set(works.map(createDesiredWorkKey));
	const ownerIds = new Set(works.map(createLayerOwnerKeyIdForWork));
	const drawUnitIds = new Set(
		result.drawUnits
			.filter((drawUnit) => desiredKeys.has(getDrawUnitDesiredKey(drawUnit)))
			.map((drawUnit) => drawUnit.drawUnitId),
	);
	const retainedPortalApertureResourceIds = new Set(
		result.portalApertureResources
			.filter((resource) =>
				desiredKeys.has(
					createDesiredKeyForDrawUnit({
						domain: resource.sourceDomain,
						landblockId: resource.landblockId,
					}),
				),
			)
			.map((resource) => resource.apertureResourceId),
	);
	const retainedStaticObjectRenderInstances =
		result.staticObjectRenderInstances.filter((instance) =>
			desiredKeys.has(
				createDesiredKeyForDrawUnit({
					domain: instance.domain,
					landblockId: instance.landblockId,
				}),
			),
		);
	const retainedStaticObjectVisualResourceIds = new Set(
		retainedStaticObjectRenderInstances.map((instance) => instance.resourceId),
	);

	return {
		...result,
		drawUnits: result.drawUnits.filter((drawUnit) =>
			drawUnitIds.has(drawUnit.drawUnitId),
		),
		staticObjectBakeDiagnostics: result.staticObjectBakeDiagnostics.filter(
			(diagnostics) =>
				desiredKeys.has(
					createDesiredKeyForDrawUnit({
						domain: diagnostics.domain,
						landblockId: diagnostics.landblockId,
					}),
				),
		),
		materialCoverage: result.materialCoverage.filter((coverage) =>
			works.some((work) => work.job.domain === coverage.domain),
		),
		portalApertureResources: result.portalApertureResources.filter((resource) =>
			retainedPortalApertureResourceIds.has(resource.apertureResourceId),
		),
		staticAuthoredDynamicSeeds: result.staticAuthoredDynamicSeeds.filter(
			(record) =>
				isPeerRecordOwnedByRetainedWork(record.owner, {
					drawUnitIds,
					ownerIds,
				}),
		),
		staticObjectRenderInstances: retainedStaticObjectRenderInstances,
		staticObjectVisualResources: result.staticObjectVisualResources.filter(
			(resource) =>
				retainedStaticObjectVisualResourceIds.has(resource.resourceId),
		),
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
					: retainedStaticObjectVisualResourceIds.has(owner.resourceId),
			),
		),
		works,
	};
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

function toScheduledStaticWorkStatus(
	status: MutableScheduledStaticWorkStatus,
): ScheduledStaticWorkStatus {
	return {
		domain: status.domain,
		revision: status.revision,
		scopeKey: status.scopeKey,
		status: status.status,
		workId: status.workId,
	};
}

function createLayerOwnerLifecycle(
	status: MutableScheduledStaticWorkStatus,
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
		case "committed":
			return (residentResourcesByOwnerId.get(status.ownerId)?.length ?? 0) >
				0
				? "materialized"
				: "empty";
		case "failed":
			return "failed";
	}
}

function createEvictionStaticBatchId(revision: number): string {
	return ["static-batch", revision.toString(), "evict"].join(":");
}

function createStaticObjectBakeDiagnosticsKey(
	diagnostics: StaticObjectBakeDiagnostics,
): string {
	return createDesiredKeyForDrawUnit({
		domain: diagnostics.domain,
		landblockId: diagnostics.landblockId,
	});
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

function countStatus(
	requests: readonly ScheduledStaticWorkStatus[],
	status: ScheduledStaticWorkStatus["status"],
): number {
	return requests.filter((request) => request.status === status).length;
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
