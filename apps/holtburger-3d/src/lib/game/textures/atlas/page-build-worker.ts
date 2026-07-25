import {
	BoundedClosedWorkerPool,
	type ClosedWorkerPoolDiagnostics,
	type ClosedWorkerPort,
} from "../../workers/closed-worker";
import {
	buildAtlasPage,
	type AtlasPageBuildJob,
	type AtlasPageBuildResult,
} from "./page-build";

/** Execute one complete page build without querying resident state or source assets. */
export function runAtlasPageBuildWorkerJob(
	job: AtlasPageBuildJob,
): AtlasPageBuildResult {
	return buildAtlasPage(job);
}

/** Bounded client for independent replacement-page materialization jobs. */
export class AtlasPageBuildWorkerPool {
	readonly #pool: BoundedClosedWorkerPool<
		AtlasPageBuildJob,
		AtlasPageBuildResult
	>;

	constructor(options: {
		readonly createWorker: () => ClosedWorkerPort;
		readonly workerCount: number;
	}) {
		this.#pool = new BoundedClosedWorkerPool(options);
	}

	build(
		job: AtlasPageBuildJob,
		transfer: readonly Transferable[],
	): Promise<AtlasPageBuildResult> {
		return this.#pool.dispatch(job, transfer);
	}

	getDiagnostics(): ClosedWorkerPoolDiagnostics {
		return this.#pool.getDiagnostics();
	}

	destroy(): void {
		this.#pool.destroy();
	}
}
