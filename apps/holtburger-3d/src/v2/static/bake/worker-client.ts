import type {
	StaticBakeInput,
	StaticBakeResult,
	StaticBakerClient,
} from "../contracts";
import type {
	StaticBakeWorkerPort,
	StaticBakeWorkerThreadMessage,
} from "./protocol";

interface PendingBakeRequest {
	readonly resolve: (result: StaticBakeResult) => void;
	readonly reject: (error: Error) => void;
}

export class StaticBakeWorkerClient implements StaticBakerClient {
	readonly #port: StaticBakeWorkerPort;
	readonly #pending = new Map<string, PendingBakeRequest>();
	#nextRequestIndex = 0;
	readonly #onMessage = (
		event: MessageEvent<StaticBakeWorkerThreadMessage>,
	): void => {
		this.#handleResponse(event.data);
	};

	constructor(port: StaticBakeWorkerPort) {
		this.#port = port;
		this.#port.addEventListener("message", this.#onMessage);
	}

	bake(input: StaticBakeInput): Promise<StaticBakeResult> {
		const requestId = `bake-job:${this.#nextRequestIndex}`;
		this.#nextRequestIndex += 1;

		return new Promise((resolve, reject) => {
			this.#pending.set(requestId, { reject, resolve });
			this.#port.postMessage({
				input,
				kind: "bake-static-scope",
				requestId,
			});
		});
	}

	dispose(): void {
		this.#port.removeEventListener("message", this.#onMessage);
		for (const pending of this.#pending.values()) {
			pending.reject(new Error("Static bake worker client was disposed."));
		}
		this.#pending.clear();
	}

	#handleResponse(response: StaticBakeWorkerThreadMessage): void {
		const pending = this.#pending.get(response.requestId);
		if (!pending) {
			return;
		}

		this.#pending.delete(response.requestId);
		if (response.kind === "static-scope-bake-failed") {
			pending.reject(new Error(response.message));
			return;
		}

		pending.resolve(response.result);
	}
}
