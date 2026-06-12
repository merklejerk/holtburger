import type {
	TexturePackingJob,
	TexturePackingResult,
	TexturePackingWorkerPort,
	TexturePackingWorkerThreadMessage,
} from "./protocol";
import type { TexturePacker } from "./packer";

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
	#disposed = false;
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
		if (this.#disposed) {
			const result = Promise.reject(
				new Error("Texture packing worker client was disposed."),
			);
			return {
				cancel: () => {},
				requestId: "disposed",
				result,
			};
		}

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
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
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

export class WorkerTexturePacker implements TexturePacker {
	readonly #client: TexturePackingWorkerClient;
	readonly #disposePort: (() => void) | null;

	constructor(
		port: TexturePackingWorkerPort,
		options: { readonly disposePort?: () => void } = {},
	) {
		this.#client = new TexturePackingWorkerClient(port);
		this.#disposePort = options.disposePort ?? null;
	}

	async pack(job: TexturePackingJob): Promise<TexturePackingResult> {
		return this.#client.pack(job).result;
	}

	dispose(): void {
		this.#client.dispose();
		this.#disposePort?.();
	}
}

export class WorkerPoolTexturePacker implements TexturePacker {
	readonly #packers: readonly TexturePacker[];
	#nextPackerIndex = 0;
	#disposed = false;

	constructor(packers: readonly TexturePacker[]) {
		if (packers.length === 0) {
			throw new Error("WorkerPoolTexturePacker requires at least one packer.");
		}

		this.#packers = packers;
	}

	pack(job: TexturePackingJob): Promise<TexturePackingResult> {
		if (this.#disposed) {
			return Promise.reject(
				new Error("WorkerPoolTexturePacker has been disposed."),
			);
		}

		const packer = this.#packers[this.#nextPackerIndex];
		if (!packer) {
			return Promise.reject(
				new Error("WorkerPoolTexturePacker has no active packer."),
			);
		}

		this.#nextPackerIndex = (this.#nextPackerIndex + 1) % this.#packers.length;

		return packer.pack(job);
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		for (const packer of this.#packers) {
			packer.dispose?.();
		}
	}
}
