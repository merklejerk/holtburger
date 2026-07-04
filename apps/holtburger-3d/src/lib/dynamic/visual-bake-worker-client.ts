import type {
	DynamicVisualBakeInput,
	DynamicVisualBakeResult,
} from "./contracts";
import type { DynamicVisualBaker } from "./visual-baker";
import type { DynamicVisualBakeWorkerPort } from "./visual-bake-protocol";
import { StandardWorkerPool } from "../workers/pool";

export class DynamicVisualBakeWorkerClient implements DynamicVisualBaker {
	readonly #pool: StandardWorkerPool<
		DynamicVisualBakeInput,
		DynamicVisualBakeResult
	>;

	constructor(port: DynamicVisualBakeWorkerPort) {
		this.#pool = new StandardWorkerPool({
			createWorker: () => port,
			requestIdPrefix: "dynamic-visual-bake",
			size: 1,
		});
	}

	bake(input: DynamicVisualBakeInput): Promise<DynamicVisualBakeResult> {
		return this.#pool.submit(input);
	}

	dispose(): void {
		this.#pool.dispose();
	}
}

export class WorkerPoolDynamicVisualBaker implements DynamicVisualBaker {
	readonly #pool: StandardWorkerPool<
		DynamicVisualBakeInput,
		DynamicVisualBakeResult
	>;

	constructor(options: {
		readonly createWorker: () => DynamicVisualBakeWorkerPort;
		readonly workerCount: number;
	}) {
		this.#pool = new StandardWorkerPool({
			createWorker: options.createWorker,
			requestIdPrefix: "dynamic-visual-bake",
			size: options.workerCount,
		});
	}

	bake(input: DynamicVisualBakeInput): Promise<DynamicVisualBakeResult> {
		return this.#pool.submit(input);
	}

	dispose(): void {
		this.#pool.dispose();
	}
}
