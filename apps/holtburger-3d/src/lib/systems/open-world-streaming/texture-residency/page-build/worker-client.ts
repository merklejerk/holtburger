import type { PreparedAssetReader } from "../../../../assets/contracts";
import type { RuntimeHost } from "../../../../host/runtime-contracts";
import {
	createHostPreparedAssetServiceHandler,
	createPreparedAssetServiceHandler,
	type PreparedAssetServiceRequest,
	type PreparedAssetServiceResponse,
} from "../../../../workers/prepared-asset-service";
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
		OpenWorldTexturePageBuildOutput,
		never,
		PreparedAssetServiceRequest,
		PreparedAssetServiceResponse
	>;

	constructor(options: {
		readonly assetReader: PreparedAssetReader;
		readonly createWorker: () => OpenWorldTexturePageBuildWorkerPort;
		readonly host?: RuntimeHost;
		readonly workerCount: number;
	}) {
		this.#pool = new StandardWorkerPool({
			createWorker: options.createWorker,
			describe: (input) => ({
				label: "open-world-texture-page-build",
				taskId: input.jobId,
			}),
			requestIdPrefix: "open-world-texture-page-build",
			serviceHandler: options.host
				? createHostPreparedAssetServiceHandler(options.host)
				: createPreparedAssetServiceHandler(options.assetReader),
			size: options.workerCount,
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
