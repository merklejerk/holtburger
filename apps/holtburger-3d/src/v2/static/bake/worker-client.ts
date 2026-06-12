import type {
	StaticBakeBatchInput,
	StaticBakeBatchResult,
	StaticBaker,
} from "../contracts";
import type {
	StaticBakeWorkerPort,
	StaticBakeWorkerThreadMessage,
} from "./protocol";

interface PendingBakeRequest {
	readonly resolve: (result: StaticBakeBatchResult) => void;
	readonly reject: (error: Error) => void;
}

interface StaticBakeWorkerClientOptions {
	readonly disposePort?: () => void;
}

export class StaticBakeWorkerClient implements StaticBaker {
	readonly #port: StaticBakeWorkerPort;
	readonly #disposePort: (() => void) | null;
	readonly #pending = new Map<string, PendingBakeRequest>();
	#nextRequestIndex = 0;
	#disposed = false;
	readonly #onMessage = (
		event: MessageEvent<StaticBakeWorkerThreadMessage>,
	): void => {
		this.#handleResponse(event.data);
	};

	constructor(
		port: StaticBakeWorkerPort,
		options: StaticBakeWorkerClientOptions = {},
	) {
		this.#port = port;
		this.#disposePort = options.disposePort ?? null;
		this.#port.addEventListener("message", this.#onMessage);
	}

	bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		if (this.#disposed) {
			return Promise.reject(new Error("Static bake worker client was disposed."));
		}

		const requestId = `bake-job:${this.#nextRequestIndex}`;
		this.#nextRequestIndex += 1;

		return new Promise((resolve, reject) => {
			this.#pending.set(requestId, { reject, resolve });
			this.#port.postMessage({
				input,
				kind: "bake-static-batch",
				requestId,
			});
		});
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		this.#port.removeEventListener("message", this.#onMessage);
		for (const pending of this.#pending.values()) {
			pending.reject(new Error("Static bake worker client was disposed."));
		}
		this.#pending.clear();
		this.#disposePort?.();
	}

	#handleResponse(response: StaticBakeWorkerThreadMessage): void {
		const pending = this.#pending.get(response.requestId);
		if (!pending) {
			return;
		}

		this.#pending.delete(response.requestId);
		if (response.kind === "static-batch-bake-failed") {
			pending.reject(new Error(response.message));
			return;
		}

		pending.resolve(response.result);
	}
}

export class WorkerPoolStaticBaker implements StaticBaker {
	readonly #bakers: readonly StaticBaker[];
	#nextBakerIndex = 0;
	#disposed = false;

	constructor(bakers: readonly StaticBaker[]) {
		if (bakers.length === 0) {
			throw new Error("WorkerPoolStaticBaker requires at least one baker.");
		}

		this.#bakers = bakers;
	}

	bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		if (this.#disposed) {
			return Promise.reject(
				new Error("WorkerPoolStaticBaker has been disposed."),
			);
		}

		const baker = this.#bakers[this.#nextBakerIndex];
		if (!baker) {
			return Promise.reject(
				new Error("WorkerPoolStaticBaker has no active baker."),
			);
		}

		this.#nextBakerIndex = (this.#nextBakerIndex + 1) % this.#bakers.length;

		return baker.bake(input);
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		for (const baker of this.#bakers) {
			disposeIfAvailable(baker);
		}
	}
}

function disposeIfAvailable(value: unknown): void {
	if (
		typeof value === "object" &&
		value !== null &&
		"dispose" in value &&
		typeof value.dispose === "function"
	) {
		value.dispose();
	}
}
