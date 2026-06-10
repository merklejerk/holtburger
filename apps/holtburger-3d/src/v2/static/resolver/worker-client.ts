import type {
	StaticResolverJob,
	StaticResolverClient,
	StaticScopePayload,
} from "../contracts";
import type {
	StaticResolverWorkerPort,
	StaticResolverWorkerThreadMessage,
} from "./protocol";

interface PendingResolverRequest {
	readonly resolve: (payload: StaticScopePayload) => void;
	readonly reject: (error: Error) => void;
}

export class StaticResolverWorkerClient implements StaticResolverClient {
	readonly #port: StaticResolverWorkerPort;
	readonly #pending = new Map<string, PendingResolverRequest>();
	#nextRequestIndex = 0;
	readonly #onMessage = (
		event: MessageEvent<StaticResolverWorkerThreadMessage>,
	): void => {
		this.#handleResponse(event.data);
	};

	constructor(port: StaticResolverWorkerPort) {
		this.#port = port;
		this.#port.addEventListener("message", this.#onMessage);
	}

	resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		const requestId = `resolver-job:${this.#nextRequestIndex}`;
		this.#nextRequestIndex += 1;

		return new Promise((resolve, reject) => {
			this.#pending.set(requestId, { reject, resolve });
			this.#port.postMessage({
				job,
				kind: "resolve-static-scope",
				requestId,
			});
		});
	}

	dispose(): void {
		this.#port.removeEventListener("message", this.#onMessage);
		for (const pending of this.#pending.values()) {
			pending.reject(new Error("Static resolver worker client was disposed."));
		}
		this.#pending.clear();
	}

	#handleResponse(response: StaticResolverWorkerThreadMessage): void {
		if (
			response.kind !== "static-scope-resolved" &&
			response.kind !== "static-scope-resolve-failed"
		) {
			return;
		}

		const pending = this.#pending.get(response.requestId);
		if (!pending) {
			return;
		}

		this.#pending.delete(response.requestId);
		if (response.kind === "static-scope-resolve-failed") {
			pending.reject(new Error(response.message));
			return;
		}

		pending.resolve(response.payload);
	}
}
