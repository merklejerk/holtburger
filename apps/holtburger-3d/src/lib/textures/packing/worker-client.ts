import type {
	TexturePackingJob,
	TexturePackingResult,
	TexturePackingWorkerPort,
} from "./protocol";
import type { TexturePacker } from "./packer";
import { StandardWorkerPool } from "../../workers/pool";

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
