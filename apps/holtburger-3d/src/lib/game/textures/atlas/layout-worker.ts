import {
	BoundedClosedWorkerPool,
	type ClosedWorkerPoolDiagnostics,
	type ClosedWorkerPort,
} from "../../workers/closed-worker";
import {
	planStableAtlasLayout,
	type StableAtlasLayoutPlan,
	type StableAtlasLayoutRequest,
} from "./layout";

/** Closed metadata-only placement job. No decoded source pixels cross this worker boundary. */
export interface AtlasLayoutWorkerJob {
	readonly request: StableAtlasLayoutRequest;
}

/** Closed layout result preserving the request's opaque correlation token. */
export interface AtlasLayoutWorkerResult {
	readonly plan: StableAtlasLayoutPlan;
}

/** Execute one closed layout job without main-thread residency access. */
export function runAtlasLayoutWorkerJob(
	job: AtlasLayoutWorkerJob,
): AtlasLayoutWorkerResult {
	return { plan: planStableAtlasLayout(job.request) };
}

/** Bounded client for independent, metadata-only atlas layout jobs. */
export class AtlasLayoutWorkerPool {
	readonly #pool: BoundedClosedWorkerPool<
		AtlasLayoutWorkerJob,
		AtlasLayoutWorkerResult
	>;

	constructor(options: {
		readonly createWorker: () => ClosedWorkerPort;
		readonly workerCount: number;
	}) {
		this.#pool = new BoundedClosedWorkerPool(options);
	}

	plan(request: StableAtlasLayoutRequest): Promise<StableAtlasLayoutPlan> {
		return this.#pool.dispatch({ request }, []).then((result) => result.plan);
	}

	getDiagnostics(): ClosedWorkerPoolDiagnostics {
		return this.#pool.getDiagnostics();
	}

	destroy(): void {
		this.#pool.destroy();
	}
}
