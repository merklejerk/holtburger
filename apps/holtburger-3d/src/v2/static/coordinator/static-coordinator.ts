import type {
	DomainAtlasSnapshot,
	StaticBakeInput,
	StaticBakeResult,
	StaticBakerClient,
	StaticCoordinatorSnapshot,
	StaticDemand,
	StaticResolverClient,
	StaticScopePayload,
	StaticWorkRequest,
	StaticWorkRequestStatus,
} from "../contracts";
import { describeStaticScopeKey, planStaticWorkRequests } from "../demand-planner";

export type StaticCoordinatorListener = (
	snapshot: StaticCoordinatorSnapshot,
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
	readonly #activeRequests = new Map<string, MutableStaticWorkRequestStatus>();
	#revision = 0;
	#disposed = false;
	#committed = 0;
	#failed = 0;
	#staleResolverResults = 0;
	#staleBakeResults = 0;
	#committedDrawUnits = 0;

	constructor(options: StaticCoordinatorOptions) {
		this.#resolver = options.resolver;
		this.#baker = options.baker;
		this.#createAtlasSnapshot =
			options.createAtlasSnapshot ?? createEmptyAtlasSnapshotForPayload;
	}

	requestStaticDemand(demand: StaticDemand): readonly StaticWorkRequest[] {
		this.#assertActive();
		this.#revision += 1;
		this.#activeRequests.clear();

		const requests = planStaticWorkRequests(demand, this.#revision);

		for (const request of requests) {
			this.#activeRequests.set(request.requestId, {
				domain: request.domain,
				requestId: request.requestId,
				revision: request.revision,
				scopeKey: describeStaticScopeKey(request.scope),
				status: "requested",
			});
		}

		this.#emit();

		for (const request of requests) {
			void this.#resolveThenBake(request);
		}

		return requests;
	}

	subscribe(listener: StaticCoordinatorListener): () => void {
		this.#listeners.add(listener);
		listener(this.createSnapshot());

		return () => {
			this.#listeners.delete(listener);
		};
	}

	createSnapshot(): StaticCoordinatorSnapshot {
		const activeRequests = Array.from(this.#activeRequests.values());

		return {
			activeRequests,
			baking: countStatus(activeRequests, "baking"),
			committed: this.#committed,
			committedDrawUnits: this.#committedDrawUnits,
			failed: this.#failed,
			requested: activeRequests.length,
			resolving: countStatus(activeRequests, "resolving"),
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
		this.#activeRequests.clear();
		this.#emit();
		this.#listeners.clear();
	}

	async #resolveThenBake(request: StaticWorkRequest): Promise<void> {
		this.#setStatus(request, "resolving");

		let payload: StaticScopePayload;
		try {
			payload = await this.#resolver.resolve(request);
		} catch {
			this.#markFailedIfCurrent(request);
			return;
		}

		if (!this.#isCurrent(request)) {
			this.#staleResolverResults += 1;
			this.#emit();
			return;
		}

		this.#setStatus(request, "baking");

		const bakeInput: StaticBakeInput = {
			atlasSnapshot: this.#createAtlasSnapshot(payload),
			payload,
			request,
		};

		let result: StaticBakeResult;
		try {
			result = await this.#baker.bake(bakeInput);
		} catch {
			this.#markFailedIfCurrent(request);
			return;
		}

		if (!this.#isCurrent(result.request)) {
			this.#staleBakeResults += 1;
			this.#emit();
			return;
		}

		this.#commit(result);
	}

	#commit(result: StaticBakeResult): void {
		const status = this.#activeRequests.get(result.request.requestId);

		if (!status) {
			return;
		}

		status.status = "committed";
		this.#committed += 1;
		this.#committedDrawUnits += result.drawUnitIds.length;
		this.#emit();
	}

	#markFailedIfCurrent(request: StaticWorkRequest): void {
		if (!this.#isCurrent(request)) {
			return;
		}

		const status = this.#activeRequests.get(request.requestId);

		if (status) {
			status.status = "failed";
			this.#failed += 1;
			this.#emit();
		}
	}

	#setStatus(
		request: StaticWorkRequest,
		status: MutableStaticWorkRequestStatus["status"],
	): void {
		if (!this.#isCurrent(request)) {
			return;
		}

		const current = this.#activeRequests.get(request.requestId);

		if (!current) {
			return;
		}

		current.status = status;
		this.#emit();
	}

	#isCurrent(request: StaticWorkRequest): boolean {
		return (
			!this.#disposed &&
			request.revision === this.#revision &&
			this.#activeRequests.has(request.requestId)
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
}

type MutableStaticWorkRequestStatus = {
	-readonly [Key in keyof StaticWorkRequestStatus]: StaticWorkRequestStatus[Key];
};

function createEmptyAtlasSnapshotForPayload(
	payload: StaticScopePayload,
): DomainAtlasSnapshot {
	return {
		domain: payload.request.domain,
		revision: payload.request.revision,
		textureKeys: payload.referencedTextureKeys,
	};
}

function countStatus(
	requests: readonly StaticWorkRequestStatus[],
	status: StaticWorkRequestStatus["status"],
): number {
	return requests.filter((request) => request.status === status).length;
}
