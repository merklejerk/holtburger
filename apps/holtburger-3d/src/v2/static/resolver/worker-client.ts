import type {
	StaticResolverClient,
	StaticScopePayload,
	StaticWorkRequest,
} from "../contracts";
import type {
	StaticResolverWorkerPort,
	StaticResolverWorkerResponse,
} from "./protocol";

interface PendingResolverRequest {
	readonly resolve: (payload: StaticScopePayload) => void;
	readonly reject: (error: Error) => void;
}

export class StaticResolverWorkerClient implements StaticResolverClient {
	readonly #port: StaticResolverWorkerPort;
	readonly #pending = new Map<string, PendingResolverRequest>();
	readonly #onMessage = (
		event: MessageEvent<StaticResolverWorkerResponse>,
	): void => {
		this.#handleResponse(event.data);
	};

	constructor(port: StaticResolverWorkerPort) {
		this.#port = port;
		this.#port.addEventListener("message", this.#onMessage);
	}

	resolve(request: StaticWorkRequest): Promise<StaticScopePayload> {
		if (this.#pending.has(request.requestId)) {
			throw new Error(
				`Static resolver worker already has an in-flight request ${request.requestId}.`,
			);
		}

		return new Promise((resolve, reject) => {
			this.#pending.set(request.requestId, { reject, resolve });
			this.#port.postMessage({
				kind: "resolve-static-scope",
				request,
				requestId: request.requestId,
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

	#handleResponse(response: StaticResolverWorkerResponse): void {
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
