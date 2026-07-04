import type {
	TexturePackingJob,
	TexturePackingResult,
	TexturePackingWorkerPort,
} from "./protocol";
import type { TexturePacker } from "./packer";
import { StandardWorkerPool, type WorkerJobHandle } from "../../workers/pool";

export type TexturePackingRequestHandle = WorkerJobHandle<TexturePackingResult>;

export class TexturePackingWorkerClient {
	readonly #pool: StandardWorkerPool<TexturePackingJob, TexturePackingResult>;

	constructor(port: TexturePackingWorkerPort) {
		this.#pool = new StandardWorkerPool({
			createWorker: () => port,
			requestIdPrefix: "texture-pack",
			size: 1,
		});
	}

	pack(job: TexturePackingJob): TexturePackingRequestHandle {
		return this.#pool.submitHandle(job);
	}

	dispose(): void {
		this.#pool.dispose();
	}
}

export class WorkerTexturePacker implements TexturePacker {
	readonly #client: TexturePackingWorkerClient;

	constructor(port: TexturePackingWorkerPort) {
		this.#client = new TexturePackingWorkerClient(port);
	}

	async pack(job: TexturePackingJob): Promise<TexturePackingResult> {
		return this.#client.pack(job).result;
	}

	dispose(): void {
		this.#client.dispose();
	}
}

export class WorkerPoolTexturePacker implements TexturePacker {
	readonly #pool: StandardWorkerPool<TexturePackingJob, TexturePackingResult>;

	constructor(options: {
		readonly createWorker: () => TexturePackingWorkerPort;
		readonly workerCount: number;
	}) {
		this.#pool = new StandardWorkerPool({
			createWorker: options.createWorker,
			requestIdPrefix: "texture-pack",
			size: options.workerCount,
		});
	}

	pack(job: TexturePackingJob): Promise<TexturePackingResult> {
		return this.#pool.submit(job);
	}

	dispose(): void {
		this.#pool.dispose();
	}
}
