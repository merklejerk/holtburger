import type { PreparedAssetReader } from "../../../../assets/contracts";
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
import type { RuntimeHost } from "../../../../host/runtime-contracts";
import type {
	OpenWorldObjectVisualAtlasBuildInput,
	OpenWorldObjectVisualAtlasBuilder,
	OpenWorldObjectVisualAtlasPlacementOutput,
} from "./object-visual-atlas-builder";
import type { OpenWorldObjectVisualAtlasWorkerPort } from "./object-visual-atlas-worker-protocol";

export class WorkerPoolOpenWorldObjectVisualAtlasBuilder implements OpenWorldObjectVisualAtlasBuilder {
	readonly #pool: StandardWorkerPool<
		OpenWorldObjectVisualAtlasBuildInput,
		OpenWorldObjectVisualAtlasPlacementOutput,
		never,
		PreparedAssetServiceRequest,
		PreparedAssetServiceResponse
	>;

	constructor(options: {
		readonly assetReader: PreparedAssetReader;
		readonly createWorker: () => OpenWorldObjectVisualAtlasWorkerPort;
		readonly host?: RuntimeHost;
		readonly workerCount: number;
	}) {
		this.#pool = new StandardWorkerPool({
			createWorker: options.createWorker,
			describe: (input) => ({
				label: "open-world-texture-layout",
				taskId: input.jobId,
			}),
			requestIdPrefix: "open-world-texture-layout",
			serviceHandler: options.host
				? createHostPreparedAssetServiceHandler(options.host)
				: createPreparedAssetServiceHandler(options.assetReader),
			size: options.workerCount,
		});
	}

	planAtlasPlacement(
		input: OpenWorldObjectVisualAtlasBuildInput,
	): Promise<OpenWorldObjectVisualAtlasPlacementOutput> {
		return this.#pool.submit(input);
	}

	createDiagnosticsSnapshot(): WorkerPoolDiagnosticsSnapshot {
		return this.#pool.createDiagnosticsSnapshot();
	}

	dispose(): void {
		this.#pool.dispose();
	}
}
