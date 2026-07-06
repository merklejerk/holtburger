import {
	StandardWorkerPool,
	type WorkerPoolDiagnosticsSnapshot,
} from "../../../../workers/pool";
import type {
	OpenWorldTexturePageBuildInput,
	OpenWorldTexturePageBuildOutput,
	OpenWorldTexturePageBuildWorkerPort,
} from "./protocol";

export interface OpenWorldTexturePageBuilder {
	buildPage(
		input: OpenWorldTexturePageBuildInput,
	): Promise<OpenWorldTexturePageBuildOutput>;
	dispose?(): void;
}

export class WorkerPoolOpenWorldTexturePageBuilder implements OpenWorldTexturePageBuilder {
	readonly #pool: StandardWorkerPool<
		OpenWorldTexturePageBuildInput,
		OpenWorldTexturePageBuildOutput
	>;

	constructor(options: {
		readonly createWorker: () => OpenWorldTexturePageBuildWorkerPort;
		readonly workerCount: number;
	}) {
		this.#pool = new StandardWorkerPool({
			createWorker: options.createWorker,
			describe: (input) => ({
				label: "open-world-texture-page-build",
				taskId: input.jobId,
			}),
			requestIdPrefix: "open-world-texture-page-build",
			size: options.workerCount,
			transferInput: (input) =>
				input.entries.map((entry) => entry.source.pixels.buffer),
		});
	}

	buildPage(
		input: OpenWorldTexturePageBuildInput,
	): Promise<OpenWorldTexturePageBuildOutput> {
		return this.#pool.submit(input);
	}

	createDiagnosticsSnapshot(): WorkerPoolDiagnosticsSnapshot {
		return this.#pool.createDiagnosticsSnapshot();
	}

	dispose(): void {
		this.#pool.dispose();
	}
}
