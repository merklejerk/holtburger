import type {
	StaticAtlasBatchSnapshot,
	StaticBakeAttachmentProvider,
	StaticBakeBatchInput,
	StaticBakeBatchResult,
	StaticBakeBatchItem,
	StaticBaker,
	StaticCoordinatorCommitDelta,
	StaticCoordinatorSourcePayloadDelta,
	StaticCoordinatorSnapshot,
	StaticDemand,
	StaticDomain,
	StaticDrawUnit,
	StaticMaterialCoverageReport,
	LandblockEnvCellsPayloadSummary,
	OutdoorStaticObjectsPayloadSummary,
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

const DEFAULT_STATIC_BATCH_MAX_PAYLOADS = 10;
const DEFAULT_STATIC_BATCH_COALESCE_DELAY_MS = 500;
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
	readonly resolver: StaticResolver;
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
	readonly #resolver: StaticResolver;
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
	readonly #residentResourcesByDesiredKey = new Map<
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
		const newWorkItems: ScheduledStaticWork[] = [];

		for (const status of Array.from(this.#activeWork.values())) {
			if (!desiredKeys.has(status.desiredKey)) {
				this.#activeWork.delete(status.workId);
			}
		}
		const removedResources = this.#evictResidentResourcesExcept(desiredKeys);
		if (removedResources.length > 0) {
			this.#emitEvictionCommitDelta({ removedResources });
		}
		this.#pruneMaterialCoverageByDesiredKeys(desiredKeys);

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
			void this.#resolveThenBake(work);
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
			requested: activeWork.length,
			resolving: countStatus(activeWork, "resolving"),
			revision: this.#revision,
			staleBakeResults: this.#staleBakeResults,
			staleResolverResults: this.#staleResolverResults,
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

	async #resolveThenBake(work: ScheduledStaticWork): Promise<void> {
		this.#setStatus(work, "resolving");

		let payload: StaticScopePayload;
		try {
			payload = await this.#resolver.resolve(work.job);
		} catch (error: unknown) {
			this.#markFailedIfCurrent(
				work,
				error instanceof Error ? error.message : String(error),
			);
			return;
		}

		if (!this.#isCurrent(work)) {
			this.#staleResolverResults += 1;
			this.#emit();
			return;
		}

		this.#recordResolvedPayload(payload);
		this.#emitSourcePayloadDelta({
			payload,
			revision: work.revision,
			work,
		});
		this.#enqueueBakePayload(work, payload);
	}

	#enqueueBakePayload(
		work: ScheduledStaticWork,
		payload: StaticScopePayload,
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

		pendingBatch.items.push({ payload, work });
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

		const items = pendingBatch.items.filter((item) =>
			this.#isCurrent(item.work),
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

		const currentWorks = result.works.filter((work) => this.#isCurrent(work));
		if (currentWorks.length !== result.works.length) {
			this.#staleBakeResults += result.works.length - currentWorks.length;
			result = filterStaticBakeResultForWorks(result, currentWorks);
			if (currentWorks.length === 0) {
				this.#emit();
				return;
			}
		}

		try {
			this.#commit(result);
		} catch (error: unknown) {
			for (const work of currentWorks) {
				this.#markFailedIfCurrent(
					work,
					error instanceof Error ? error.message : String(error),
				);
			}
		}
	}

	#commit(result: StaticBakeBatchResult): void {
		const resourcesByDesiredKey =
			collectCommittedResourceKeysByDesiredKey(result);

		for (const work of result.works) {
			const status = this.#activeWork.get(work.workId);
			if (!status) {
				continue;
			}
			status.status = "committed";
			this.#committed += 1;
		}
		for (const [desiredKey, resources] of resourcesByDesiredKey) {
			const residentResources =
				this.#residentResourcesByDesiredKey.get(desiredKey) ?? [];
			this.#residentResourcesByDesiredKey.set(desiredKey, [
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
		this.#committedDrawUnits = this.#residentDrawUnitIds.size;
		this.#emitCommitDelta({
			addedDrawUnits: result.drawUnits,
			addedPortalApertureResources: result.portalApertureResources,
			materialCoverage: result.materialCoverage,
			removedResources: [],
			revision: result.revision,
			staticAuthoredDynamicSeeds: result.staticAuthoredDynamicSeeds,
			staticBatchId: result.staticBatchId,
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
		desiredKeys: ReadonlySet<string>,
	): readonly StaticResourceKey[] {
		const removedResources: StaticResourceKey[] = [];
		for (const [desiredKey, resources] of Array.from(
			this.#residentResourcesByDesiredKey,
		)) {
			if (desiredKeys.has(desiredKey)) {
				continue;
			}
			removedResources.push(...resources);
			this.#residentResourcesByDesiredKey.delete(desiredKey);
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

	#pruneMaterialCoverageByDesiredKeys(desiredKeys: ReadonlySet<string>): void {
		for (const coverage of Array.from(
			this.#latestMaterialCoverageByKey.values(),
		)) {
			const hasDesiredDomain = Array.from(desiredKeys).some((desiredKey) =>
				desiredKey.endsWith(`:${coverage.domain}`),
			);
			if (!hasDesiredDomain) {
				this.#latestMaterialCoverageByKey.delete(coverage.coverageKey);
			}
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

	#isCurrent(work: ScheduledStaticWork): boolean {
		return !this.#disposed && this.#activeWork.has(work.workId);
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
}

type MutableScheduledStaticWorkStatus = {
	-readonly [Key in keyof ScheduledStaticWorkStatus]: ScheduledStaticWorkStatus[Key];
} & {
	readonly desiredKey: string;
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

function collectCommittedResourceKeysByDesiredKey(
	result: StaticBakeBatchResult,
): Map<string, StaticResourceKey[]> {
	const resourcesByDesiredKey = new Map<string, StaticResourceKey[]>();
	for (const drawUnit of result.drawUnits) {
		addResourceKey(resourcesByDesiredKey, getDrawUnitDesiredKey(drawUnit), {
			drawUnitId: drawUnit.drawUnitId,
			kind: "draw-unit",
		});
	}
	for (const resource of result.portalApertureResources) {
		addResourceKey(
			resourcesByDesiredKey,
			createDesiredKeyForDrawUnit({
				domain: resource.sourceDomain,
				landblockId: resource.landblockId,
			}),
			{
				apertureResourceId: resource.apertureResourceId,
				kind: "portal-aperture-resource",
			},
		);
	}
	return resourcesByDesiredKey;
}

function addResourceKey(
	resourcesByDesiredKey: Map<string, StaticResourceKey[]>,
	desiredKey: string,
	resource: StaticResourceKey,
): void {
	const resources = resourcesByDesiredKey.get(desiredKey) ?? [];
	resources.push(resource);
	resourcesByDesiredKey.set(desiredKey, resources);
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
	const workIds = new Set(works.map((work) => work.workId));
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

	return {
		...result,
		drawUnits: result.drawUnits.filter((drawUnit) =>
			drawUnitIds.has(drawUnit.drawUnitId),
		),
		materialCoverage: result.materialCoverage.filter((coverage) =>
			works.some((work) => work.job.domain === coverage.domain),
		),
		portalApertureResources: result.portalApertureResources.filter((resource) =>
			retainedPortalApertureResourceIds.has(resource.apertureResourceId),
		),
		staticAuthoredDynamicSeeds: result.staticAuthoredDynamicSeeds.filter(
			(record) =>
				isPeerRecordOwnedByCurrentWork(record.owner, workIds, drawUnitIds),
		),
		staticPortalInteriorRecords: result.staticPortalInteriorRecords.filter(
			(record) =>
				isPeerRecordOwnedByCurrentWork(record.owner, workIds, drawUnitIds),
		),
		staticPortalGraphs: result.staticPortalGraphs.filter((record) =>
			isPeerRecordOwnedByCurrentWork(record.owner, workIds, drawUnitIds),
		),
		staticSourceMappings: result.staticSourceMappings.filter((record) =>
			isPeerRecordOwnedByCurrentWork(record.owner, workIds, drawUnitIds),
		),
		staticSpatialRecords: result.staticSpatialRecords.filter((record) =>
			isPeerRecordOwnedByCurrentWork(record.owner, workIds, drawUnitIds),
		),
		staticVisibilityRecords: result.staticVisibilityRecords.filter((record) =>
			isPeerRecordOwnedByCurrentWork(record.owner, workIds, drawUnitIds),
		),
		textureUses: result.textureUses.filter((textureUse) =>
			textureUse.ownerDrawUnitIds.some((drawUnitId) =>
				drawUnitIds.has(drawUnitId),
			),
		),
		works,
	};
}

function isPeerRecordOwnedByCurrentWork(
	owner: StaticPeerRecordOwner,
	workIds: ReadonlySet<string>,
	drawUnitIds: ReadonlySet<string>,
): boolean {
	if (owner.kind === "draw-unit") {
		return drawUnitIds.has(owner.drawUnitId);
	}

	return workIds.has(owner.workId);
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

function createEvictionStaticBatchId(revision: number): string {
	return ["static-batch", revision.toString(), "evict"].join(":");
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
