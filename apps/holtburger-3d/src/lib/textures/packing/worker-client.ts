import type {
	TexturePackingJob,
	TexturePackingResult,
	TexturePackingWorkerProgress,
	TexturePackingWorkerPort,
} from "./protocol";
import type { TexturePacker } from "./packer";
import { StandardWorkerPool } from "../../workers/pool";

interface TexturePackingRequestDiagnostics {
	/** Main-thread wall-clock timestamp when this pack request was submitted. */
	readonly submittedAtEpochMs: number;
	/** Main-thread wall-clock timestamp when result-ready progress arrived. */
	resultReady: TexturePackingResultReadyDiagnostics | null;
}

/** Worker handoff counters captured immediately before the pack worker posts its result. */
export interface TexturePackingResultReadyDiagnostics {
	/** Worker wall-clock timestamp immediately before result postMessage. */
	readonly completedAtEpochMs: number;
	/** Packed page pixel bytes sent with the worker result. */
	readonly pagePixelByteLength: number;
	/** Packed pages returned by the worker result. */
	readonly pageCount: number;
	/** Packed rects returned by the worker result. */
	readonly rectCount: number;
	/** Transferable objects sent with the worker result. */
	readonly transferCount: number;
}

/** Direct diagnostics for the texture packing worker boundary. */
export interface TexturePackingBoundaryDiagnostics {
	/** Main-thread delay from worker result-ready progress to resolved result delivery. */
	readonly deliveryMs: number | null;
	/** Packed page pixel bytes sent with the worker result. */
	readonly pagePixelByteLength: number;
	/** Packed pages returned by the worker result. */
	readonly pageCount: number;
	/** Packed rects returned by the worker result. */
	readonly rectCount: number;
	/** Main-thread wall-clock timestamp when the result promise resolved. */
	readonly resolvedAtEpochMs: number;
	/** Main-thread wall-clock timestamp when this request was submitted. */
	readonly submittedAtEpochMs: number;
	/** Transferable objects sent with the worker result. */
	readonly transferCount: number;
}

export interface TexturePackingResultWithDiagnostics {
	/** Direct worker-boundary diagnostics, or null for packers that cannot emit result-ready progress. */
	readonly diagnostics: TexturePackingBoundaryDiagnostics | null;
	/** Texture packing result returned by the packer. */
	readonly result: TexturePackingResult;
}

export class WorkerPoolTexturePacker implements TexturePacker {
	readonly #pool: StandardWorkerPool<
		TexturePackingJob,
		TexturePackingResult,
		TexturePackingWorkerProgress
	>;
	readonly #requests = new Map<string, TexturePackingRequestDiagnostics>();

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
		return this.packWithDiagnostics(job).then(({ result }) => result);
	}

	async packWithDiagnostics(
		job: TexturePackingJob,
	): Promise<TexturePackingResultWithDiagnostics> {
		let requestId = "";
		const handle = this.#pool.submitHandle(job, {
			onProgress: (event) => this.#recordProgress(requestId, event),
		});
		requestId = handle.requestId;
		this.#requests.set(requestId, {
			resultReady: null,
			submittedAtEpochMs: Date.now(),
		});
		try {
			const result = await handle.result;
			return {
				diagnostics: this.#createBoundaryDiagnostics(requestId),
				result,
			};
		} finally {
			this.#requests.delete(requestId);
		}
	}

	dispose(): void {
		this.#pool.dispose();
		this.#requests.clear();
	}

	#recordProgress(
		requestId: string,
		event: TexturePackingWorkerProgress,
	): void {
		const request = this.#requests.get(requestId);
		if (!request) {
			return;
		}
		request.resultReady = {
			completedAtEpochMs: event.completedAtEpochMs,
			pageCount: event.pageCount,
			pagePixelByteLength: event.pagePixelByteLength,
			rectCount: event.rectCount,
			transferCount: event.transferCount,
		};
	}

	#createBoundaryDiagnostics(
		requestId: string,
	): TexturePackingBoundaryDiagnostics | null {
		const request = this.#requests.get(requestId);
		const resultReady = request?.resultReady;
		if (!request || !resultReady) {
			return null;
		}
		const resolvedAtEpochMs = Date.now();
		return {
			deliveryMs: Math.max(0, resolvedAtEpochMs - resultReady.completedAtEpochMs),
			pageCount: resultReady.pageCount,
			pagePixelByteLength: resultReady.pagePixelByteLength,
			rectCount: resultReady.rectCount,
			resolvedAtEpochMs,
			submittedAtEpochMs: request.submittedAtEpochMs,
			transferCount: resultReady.transferCount,
		};
	}
}
