import type {
	StaticAtlasBatchSnapshot,
	StaticBakeBatchInput,
	StaticBakeBatchResult,
	StaticBakeBatchItem,
	StaticBaker,
	StaticCoordinatorCommitDelta,
	StaticCoordinatorSnapshot,
	StaticDemand,
	StaticDomain,
	StaticMaterialCoverageReport,
	DungeonStaticPayloadSummary,
	LandblockTopologyPayloadSummary,
	OutdoorStaticObjectsPayloadSummary,
	StaticResolverFailureSnapshot,
	StaticResolver,
	StaticScopePayload,
	TerrainStaticScopePayloadSummary,
	ScheduledStaticWork,
	ScheduledStaticWorkStatus,
} from "../contracts";
import {
	describeStaticScopeKey,
	planScheduledStaticWork,
} from "../demand-planner";

const DEFAULT_STATIC_BATCH_MAX_PAYLOADS = 10;
const DEFAULT_STATIC_BATCH_COALESCE_DELAY_MS = 500;

export type StaticCoordinatorListener = (
	snapshot: StaticCoordinatorSnapshot,
) => void;
export type StaticCoordinatorCommitListener = (
	delta: StaticCoordinatorCommitDelta,
) => void;

export interface StaticCoordinatorOptions {
	readonly resolver: StaticResolver;
	readonly baker: StaticBaker;
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
	readonly #batching: StaticCoordinatorBatchingOptions;
	#createAtlasSnapshot: (
		payloads: readonly StaticScopePayload[],
		staticBatchId: string,
	) => StaticAtlasBatchSnapshot;
	readonly #listeners = new Set<StaticCoordinatorListener>();
	readonly #commitListeners = new Set<StaticCoordinatorCommitListener>();
	readonly #activeWork = new Map<string, MutableScheduledStaticWorkStatus>();
	readonly #pendingBatches = new Map<string, PendingStaticBakeBatch>();
	readonly #residentDrawUnitIds = new Set<string>();
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
	#latestLandblockTopologyPayload: LandblockTopologyPayloadSummary | null =
		null;
	#latestDungeonPayload: DungeonStaticPayloadSummary | null = null;
	readonly #latestMaterialCoverageByDomain = new Map<
		StaticDomain,
		StaticMaterialCoverageReport
	>();
	#latestResolverFailure: StaticResolverFailureSnapshot | null = null;

	constructor(options: StaticCoordinatorOptions) {
		this.#resolver = options.resolver;
		this.#baker = options.baker;
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

	requestStaticDemand(demand: StaticDemand): readonly ScheduledStaticWork[] {
		this.#assertActive();
		this.#revision += 1;
		this.#activeWork.clear();
		this.#latestMaterialCoverageByDomain.clear();
		this.#evictResidentDrawUnits();

		const workItems = planScheduledStaticWork(demand, this.#revision);

		for (const work of workItems) {
			this.#activeWork.set(work.workId, {
				domain: work.job.domain,
				failureMessage: null,
				workId: work.workId,
				revision: work.revision,
				scopeKey: describeStaticScopeKey(work.job.scope),
				status: "requested",
			});
		}

		this.#emit();

		for (const work of workItems) {
			void this.#resolveThenBake(work);
		}

		return workItems;
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

	createSnapshot(): StaticCoordinatorSnapshot {
		const activeWork = Array.from(this.#activeWork.values());

		return {
			activeWork,
			baking: countStatus(activeWork, "baking"),
			committed: this.#committed,
			committedDrawUnits: this.#committedDrawUnits,
			failed: this.#failed,
			latestDungeonPayload: this.#latestDungeonPayload,
			latestLandblockTopologyPayload: this.#latestLandblockTopologyPayload,
			materialCoverage: Array.from(
				this.#latestMaterialCoverageByDomain.values(),
			).sort((left, right) => left.domain.localeCompare(right.domain)),
			latestOutdoorStaticObjectsPayload:
				this.#latestOutdoorStaticObjectsPayload,
			latestResolverFailure: this.#latestResolverFailure,
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
		this.#evictResidentDrawUnits();
		this.#emit();
		this.#listeners.clear();
		this.#commitListeners.clear();
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
		const bakeInput: StaticBakeBatchInput = {
			atlasSnapshot: this.#createAtlasSnapshot(
				items.map((item) => item.payload),
				staticBatchId,
			),
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
			this.#emit();
			return;
		}

		this.#commit(result);
	}

	#commit(result: StaticBakeBatchResult): void {
		for (const work of result.works) {
			const status = this.#activeWork.get(work.workId);
			if (!status) {
				continue;
			}
			status.status = "committed";
			this.#committed += 1;
		}
		for (const drawUnit of result.drawUnits) {
			this.#residentDrawUnitIds.add(drawUnit.drawUnitId);
		}
		for (const coverage of result.materialCoverage) {
			this.#latestMaterialCoverageByDomain.set(coverage.domain, coverage);
		}
		this.#committedDrawUnits = this.#residentDrawUnitIds.size;
		this.#emitCommitDelta({
			addedDrawUnits: result.drawUnits,
			removedDrawUnitIds: [],
			revision: result.revision,
			staticAuthoredDynamicSeeds: result.staticAuthoredDynamicSeeds,
			staticBatchId: result.staticBatchId,
			staticPortalInteriorRecords: result.staticPortalInteriorRecords,
			staticSourceMappings: result.staticSourceMappings,
			staticSpatialRecords: result.staticSpatialRecords,
			staticVisibilityRecords: result.staticVisibilityRecords,
			textureUses: result.textureUses,
		});
		this.#emit();
	}

	#evictResidentDrawUnits(): void {
		if (this.#residentDrawUnitIds.size === 0) {
			return;
		}

		const removedDrawUnitIds = Array.from(this.#residentDrawUnitIds);
		this.#residentDrawUnitIds.clear();
		this.#committedDrawUnits = 0;
		this.#emitCommitDelta({
			addedDrawUnits: [],
			removedDrawUnitIds,
			revision: this.#revision,
			staticAuthoredDynamicSeeds: [],
			staticBatchId: createEvictionStaticBatchId(this.#revision),
			staticPortalInteriorRecords: [],
			staticSourceMappings: [],
			staticSpatialRecords: [],
			staticVisibilityRecords: [],
			textureUses: [],
		});
	}

	#markFailedIfCurrent(work: ScheduledStaticWork, message: string): void {
		if (!this.#isCurrent(work)) {
			return;
		}

		const status = this.#activeWork.get(work.workId);

		if (status) {
			status.status = "failed";
			status.failureMessage = message;
			this.#failed += 1;
			this.#latestResolverFailure = {
				domain: work.job.domain,
				message,
				workId: work.workId,
				revision: work.revision,
				scopeKey: describeStaticScopeKey(work.job.scope),
			};
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

		if (payload.scope.kind === "landblock-topology") {
			this.#latestLandblockTopologyPayload = {
				classification: payload.scope.classification,
				envCellCount: payload.scope.envCells.length,
				landblockId: payload.scope.landblock.landblockId,
				missingRefCount: payload.scope.missingRefs.length,
				portalLinkCount: payload.scope.portalLinks.length,
				visibleCellCount: countDistinctVisibleEnvCells(payload.scope.envCells),
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
				sourceAssetCount: payload.scope.sourceAssets.length,
				textureRefCount: payload.scope.textureRefs.length,
			};
		}

		if (payload.scope.kind === "dungeon-static") {
			this.#latestDungeonPayload = {
				envCellCount: payload.scope.envCells.length,
				landblockId: payload.scope.landblock.landblockId,
				missingRefCount: payload.scope.missingRefs.length,
				portalCount: payload.scope.envCells.reduce(
					(count, envCell) => count + envCell.portalCount,
					0,
				),
				selectedEnvCellId: null,
				visibleCellCount: countDistinctVisibleEnvCells(payload.scope.envCells),
			};
		}

		this.#latestResolverFailure = null;
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
		return (
			!this.#disposed &&
			work.revision === this.#revision &&
			this.#activeWork.has(work.workId)
		);
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
}

type MutableScheduledStaticWorkStatus = {
	-readonly [Key in keyof ScheduledStaticWorkStatus]: ScheduledStaticWorkStatus[Key];
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
