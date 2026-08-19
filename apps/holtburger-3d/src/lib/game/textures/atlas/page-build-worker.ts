import {
	BoundedClosedWorkerPool,
	type ClosedWorkerPoolDiagnostics,
	type ClosedWorkerPort,
} from "../../workers/closed-worker";
import {
	buildAtlasPage,
	buildAtlasPagePatch,
	type AtlasPageBuildJob,
	type AtlasPageBuildResult,
	type AtlasPagePatchJob,
	type AtlasPagePatchResult,
} from "./page-build";

/** Transport envelope distinguishing whole-page materialization from region patching. */
export type AtlasPageWorkerJob =
	| { readonly kind: "build"; readonly job: AtlasPageBuildJob }
	| { readonly kind: "patch"; readonly job: AtlasPagePatchJob };

/** Transport envelope carrying whichever payload the matching job kind produced. */
export type AtlasPageWorkerResult =
	| { readonly kind: "build"; readonly result: AtlasPageBuildResult }
	| { readonly kind: "patch"; readonly result: AtlasPagePatchResult };

/** Execute one page job without querying resident state or source assets. */
export function runAtlasPageBuildWorkerJob(
	job: AtlasPageWorkerJob,
): AtlasPageWorkerResult {
	return job.kind === "build"
		? { kind: "build", result: buildAtlasPage(job.job) }
		: { kind: "patch", result: buildAtlasPagePatch(job.job) };
}

/** Pixel buffers a completed job hands back to its caller. */
export function atlasPageWorkerResultTransfer(
	result: AtlasPageWorkerResult,
): readonly Transferable[] {
	return result.kind === "build"
		? [result.result.pageBits.buffer]
		: result.result.regions.map((region) => region.data.buffer);
}

/** Bounded client for independent page materialization and patch jobs. */
export class AtlasPageBuildWorkerPool {
	readonly #pool: BoundedClosedWorkerPool<
		AtlasPageWorkerJob,
		AtlasPageWorkerResult
	>;

	constructor(options: {
		readonly createWorker: () => ClosedWorkerPort;
		readonly workerCount: number;
	}) {
		this.#pool = new BoundedClosedWorkerPool(options);
	}

	async build(
		job: AtlasPageBuildJob,
		transfer: readonly Transferable[],
	): Promise<AtlasPageBuildResult> {
		const response = await this.#pool.dispatch(
			{ job, kind: "build" },
			transfer,
		);
		if (response.kind !== "build") {
			throw new Error("Atlas page build job returned a patch result.");
		}
		return response.result;
	}

	async patch(
		job: AtlasPagePatchJob,
		transfer: readonly Transferable[],
	): Promise<AtlasPagePatchResult> {
		const response = await this.#pool.dispatch(
			{ job, kind: "patch" },
			transfer,
		);
		if (response.kind !== "patch") {
			throw new Error("Atlas page patch job returned a build result.");
		}
		return response.result;
	}

	getDiagnostics(): ClosedWorkerPoolDiagnostics {
		return this.#pool.getDiagnostics();
	}

	destroy(): void {
		this.#pool.destroy();
	}
}
