import type {
	DomainAtlasSnapshot,
	StaticBakeInput,
	StaticBakeResult,
	StaticBakerClient,
	StaticCoordinatorCommitDelta,
	StaticCoordinatorSnapshot,
	StaticDemand,
	DungeonStaticPayloadSummary,
	LandblockTopologyPayloadSummary,
	StaticResolverFailureSnapshot,
	StaticResolverClient,
	StaticScopePayload,
	TerrainStaticScopePayloadSummary,
	ScheduledStaticWork,
	ScheduledStaticWorkStatus,
} from "../contracts";
import { describeStaticScopeKey, planScheduledStaticWork } from "../demand-planner";

export type StaticCoordinatorListener = (
	snapshot: StaticCoordinatorSnapshot,
) => void;
export type StaticCoordinatorCommitListener = (
	delta: StaticCoordinatorCommitDelta,
) => void;

export interface StaticCoordinatorOptions {
	readonly resolver: StaticResolverClient;
	readonly baker: StaticBakerClient;
	readonly createAtlasSnapshot?: (
		payload: StaticScopePayload,
	) => DomainAtlasSnapshot;
}

export class StaticCoordinator {
	readonly #resolver: StaticResolverClient;
	readonly #baker: StaticBakerClient;
	readonly #createAtlasSnapshot: (
		payload: StaticScopePayload,
	) => DomainAtlasSnapshot;
	readonly #listeners = new Set<StaticCoordinatorListener>();
	readonly #commitListeners = new Set<StaticCoordinatorCommitListener>();
	readonly #activeWork = new Map<string, MutableScheduledStaticWorkStatus>();
	readonly #residentDrawUnitIds = new Set<string>();
	#revision = 0;
	#disposed = false;
	#committed = 0;
	#failed = 0;
	#staleResolverResults = 0;
	#staleBakeResults = 0;
	#committedDrawUnits = 0;
	#latestTerrainPayload: TerrainStaticScopePayloadSummary | null = null;
	#latestLandblockTopologyPayload: LandblockTopologyPayloadSummary | null = null;
	#latestDungeonPayload: DungeonStaticPayloadSummary | null = null;
	#latestResolverFailure: StaticResolverFailureSnapshot | null = null;

	constructor(options: StaticCoordinatorOptions) {
		this.#resolver = options.resolver;
		this.#baker = options.baker;
		this.#createAtlasSnapshot =
			options.createAtlasSnapshot ?? createEmptyAtlasSnapshotForPayload;
	}

	requestStaticDemand(demand: StaticDemand): readonly ScheduledStaticWork[] {
		this.#assertActive();
		this.#revision += 1;
		this.#activeWork.clear();
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
		this.#setStatus(work, "baking");

		const bakeInput: StaticBakeInput = {
			atlasSnapshot: this.#createAtlasSnapshot(payload),
			payload,
			work,
		};

		let result: StaticBakeResult;
		try {
			result = await this.#baker.bake(bakeInput);
		} catch (error: unknown) {
			this.#markFailedIfCurrent(
				work,
				error instanceof Error ? error.message : String(error),
			);
			return;
		}

		if (!this.#isCurrent(result.work)) {
			this.#staleBakeResults += 1;
			this.#emit();
			return;
		}

		this.#commit(result);
	}

	#commit(result: StaticBakeResult): void {
		const status = this.#activeWork.get(result.work.workId);

		if (!status) {
			return;
		}

		status.status = "committed";
		this.#committed += 1;
		for (const drawUnit of result.drawUnits) {
			this.#residentDrawUnitIds.add(drawUnit.drawUnitId);
		}
		this.#committedDrawUnits = this.#residentDrawUnitIds.size;
		this.#emitCommitDelta({
			addedDrawUnits: result.drawUnits,
			removedDrawUnitIds: [],
			revision: result.work.revision,
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

function createEmptyAtlasSnapshotForPayload(
	payload: StaticScopePayload,
): DomainAtlasSnapshot {
	return {
		domain: payload.job.domain,
		revision: payload.sourceRevision,
		textureUses:
			payload.scope.kind === "placeholder"
				? payload.scope.referencedTextureUses
				: payload.scope.kind === "terrain"
					? payload.scope.textureUses.map((textureUse) => textureUse.texture)
					: [],
	};
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
