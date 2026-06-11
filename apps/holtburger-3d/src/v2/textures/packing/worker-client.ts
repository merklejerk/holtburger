import type {
	TexturePackingJob,
	TexturePackingResult,
	TexturePackingWorkerPort,
	TexturePackingWorkerThreadMessage,
} from "./protocol";

interface PendingPackingRequest {
	readonly resolve: (result: TexturePackingResult) => void;
	readonly reject: (error: Error) => void;
}

export interface TexturePackingRequestHandle {
	readonly requestId: string;
	readonly result: Promise<TexturePackingResult>;
	cancel(): void;
}

export class TexturePackingWorkerClient {
	readonly #port: TexturePackingWorkerPort;
	readonly #pending = new Map<string, PendingPackingRequest>();
	#nextRequestIndex = 0;
	readonly #onMessage = (
		event: MessageEvent<TexturePackingWorkerThreadMessage>,
	): void => {
		this.#handleResponse(event.data);
	};

	constructor(port: TexturePackingWorkerPort) {
		this.#port = port;
		this.#port.addEventListener("message", this.#onMessage);
	}

	pack(job: TexturePackingJob): TexturePackingRequestHandle {
		const requestId = `texture-pack:${this.#nextRequestIndex}`;
		this.#nextRequestIndex += 1;

		const result = new Promise<TexturePackingResult>((resolve, reject) => {
			this.#pending.set(requestId, { reject, resolve });
			this.#port.postMessage({
				job,
				kind: "pack-textures",
				requestId,
			});
		});

		return {
			cancel: () => this.#cancel(requestId),
			requestId,
			result,
		};
	}

	dispose(): void {
		this.#port.removeEventListener("message", this.#onMessage);
		for (const pending of this.#pending.values()) {
			pending.reject(new Error("Texture packing worker client was disposed."));
		}
		this.#pending.clear();
	}

	#cancel(requestId: string): void {
		const pending = this.#pending.get(requestId);
		if (!pending) {
			return;
		}

		this.#pending.delete(requestId);
		pending.reject(new Error("Texture packing request was canceled."));
		this.#port.postMessage({
			kind: "cancel-texture-pack",
			requestId,
		});
	}

	#handleResponse(response: TexturePackingWorkerThreadMessage): void {
		const pending = this.#pending.get(response.requestId);
		if (!pending) {
			return;
		}

		this.#pending.delete(response.requestId);
		if (response.kind === "texture-pack-failed") {
			pending.reject(new Error(response.message));
			return;
		}

		pending.resolve(response.result);
	}
}
