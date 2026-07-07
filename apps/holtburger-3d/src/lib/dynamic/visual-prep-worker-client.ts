import type { PreparedAssetReader } from "../assets/contracts";
import type {
	DynamicVisualBakeResult,
	DynamicVisualPrepInput,
} from "./contracts";
import type { DynamicVisualPrepper } from "./visual-prepper";
import type { DynamicVisualPrepWorkerPort } from "./visual-prep-protocol";
import {
	createPreparedAssetServiceHandler,
	type PreparedAssetServiceRequest,
	type PreparedAssetServiceResponse,
} from "../workers/prepared-asset-service";
import {
	StandardWorkerPool,
	type WorkerPoolDiagnosticsSnapshot,
} from "../workers/pool";

export class WorkerPoolDynamicVisualPrepper implements DynamicVisualPrepper {
	readonly #pool: StandardWorkerPool<
		DynamicVisualPrepInput,
		DynamicVisualBakeResult,
		never,
		PreparedAssetServiceRequest,
		PreparedAssetServiceResponse
	>;

	constructor(options: {
		readonly assetReader: PreparedAssetReader;
		readonly createWorker: () => DynamicVisualPrepWorkerPort;
		readonly workerCount: number;
	}) {
		this.#pool = new StandardWorkerPool({
			createWorker: options.createWorker,
			requestIdPrefix: "dynamic-visual-prep",
			serviceHandler: createPreparedAssetServiceHandler(options.assetReader, {
				payloadView: "full",
			}),
			size: options.workerCount,
		});
	}

	prepare(input: DynamicVisualPrepInput): Promise<DynamicVisualBakeResult> {
		return this.#pool.submit(input);
	}

	createDiagnosticsSnapshot(): WorkerPoolDiagnosticsSnapshot {
		return this.#pool.createDiagnosticsSnapshot();
	}

	dispose(): void {
		this.#pool.dispose();
	}
}
