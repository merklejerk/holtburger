import type { DynamicVisualBaker } from "./visual-baker";
import type {
	DynamicVisualBakeInput,
	DynamicVisualBakeResult,
} from "./contracts";
import type {
	DynamicVisualBakeWorkerPort,
	DynamicVisualBakeWorkerThreadMessage,
} from "./visual-bake-protocol";

interface PendingDynamicVisualBakeRequest {
	readonly reject: (error: Error) => void;
	readonly resolve: (result: DynamicVisualBakeResult) => void;
}

interface DynamicVisualBakeWorkerClientOptions {
	readonly disposePort?: () => void;
}

export class DynamicVisualBakeWorkerClient implements DynamicVisualBaker {
	readonly #disposePort: (() => void) | null;
	#disposed = false;
	#nextRequestIndex = 0;
	readonly #pending = new Map<string, PendingDynamicVisualBakeRequest>();
	readonly #port: DynamicVisualBakeWorkerPort;
	readonly #onMessage = (
		event: MessageEvent<DynamicVisualBakeWorkerThreadMessage>,
	): void => {
		this.#handleResponse(event.data);
	};

	constructor(
		port: DynamicVisualBakeWorkerPort,
		options: DynamicVisualBakeWorkerClientOptions = {},
	) {
		this.#port = port;
		this.#disposePort = options.disposePort ?? null;
		this.#port.addEventListener("message", this.#onMessage);
	}

	bake(input: DynamicVisualBakeInput): Promise<DynamicVisualBakeResult> {
		if (this.#disposed) {
			return Promise.reject(
				new Error("Dynamic visual bake worker client was disposed."),
			);
		}

		const requestId = `dynamic-visual-bake:${this.#nextRequestIndex}`;
		this.#nextRequestIndex += 1;

		return new Promise((resolve, reject) => {
			this.#pending.set(requestId, { reject, resolve });
			this.#port.postMessage({
				input,
				kind: "bake-dynamic-visual-batch",
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
			pending.reject(
				new Error("Dynamic visual bake worker client was disposed."),
			);
		}
		this.#pending.clear();
		this.#disposePort?.();
	}

	#handleResponse(response: DynamicVisualBakeWorkerThreadMessage): void {
		const pending = this.#pending.get(response.requestId);
		if (!pending) {
			return;
		}

		this.#pending.delete(response.requestId);
		if (response.kind === "dynamic-visual-batch-bake-failed") {
			pending.reject(new Error(response.message));
			return;
		}

		pending.resolve(response.result);
	}
}

export class WorkerPoolDynamicVisualBaker implements DynamicVisualBaker {
	readonly #bakers: readonly DynamicVisualBaker[];
	#disposed = false;
	#nextBakerIndex = 0;

	constructor(bakers: readonly DynamicVisualBaker[]) {
		if (bakers.length === 0) {
			throw new Error(
				"WorkerPoolDynamicVisualBaker requires at least one baker.",
			);
		}

		this.#bakers = bakers;
	}

	bake(input: DynamicVisualBakeInput): Promise<DynamicVisualBakeResult> {
		if (this.#disposed) {
			return Promise.reject(
				new Error("WorkerPoolDynamicVisualBaker has been disposed."),
			);
		}

		const baker = this.#bakers[this.#nextBakerIndex];
		if (!baker) {
			return Promise.reject(
				new Error("WorkerPoolDynamicVisualBaker has no active baker."),
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
