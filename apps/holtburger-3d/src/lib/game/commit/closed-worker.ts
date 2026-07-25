/** One worker endpoint used by a closed request/response client. */
export interface ClosedWorkerPort {
	onerror: ((event: ErrorEvent) => void) | null;
	onmessage: ((event: MessageEvent<ClosedWorkerResponse<unknown>>) => void) | null;
	postMessage(message: ClosedWorkerRequest<unknown>, transfer: readonly Transferable[]): void;
	terminate(): void;
}

/** Correlated closed worker request; the worker cannot emit follow-up source requests. */
export interface ClosedWorkerRequest<TInput> {
	readonly id: number;
	readonly input: TInput;
}

/** Correlated worker result or terminal execution error. */
export type ClosedWorkerResponse<TResult> =
	| { readonly id: number; readonly ok: true; readonly result: TResult }
	| { readonly id: number; readonly ok: false; readonly error: string };

/** Minimal lifecycle wrapper that rejects all unsettled work when its owned worker stops. */
export class ClosedWorkerClient<TInput, TResult> {
	readonly #worker: ClosedWorkerPort;
	readonly #pending = new Map<
		number,
		{ readonly resolve: (result: TResult) => void; readonly reject: (error: Error) => void }
	>();
	#destroyed = false;
	#nextId = 0;

	constructor(worker: ClosedWorkerPort) {
		this.#worker = worker;
		worker.onmessage = (event) => this.#handleResponse(event.data as ClosedWorkerResponse<TResult>);
		worker.onerror = (event) => this.#rejectAll(new Error(event.message || "Closed worker failed."));
	}

	dispatch(input: TInput, transfer: readonly Transferable[]): Promise<TResult> {
		if (this.#destroyed) return Promise.reject(new Error("Closed worker is destroyed."));
		const id = this.#nextId;
		this.#nextId += 1;
		return new Promise<TResult>((resolve, reject) => {
			this.#pending.set(id, { reject, resolve });
			try {
				this.#worker.postMessage({ id, input }, transfer);
			} catch (cause) {
				this.#pending.delete(id);
				reject(cause instanceof Error ? cause : new Error(String(cause)));
			}
		});
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#worker.terminate();
		this.#rejectAll(new Error("Closed worker was terminated."));
	}

	#handleResponse(response: ClosedWorkerResponse<TResult>): void {
		const pending = this.#pending.get(response.id);
		if (!pending) return;
		this.#pending.delete(response.id);
		if (response.ok) {
			pending.resolve(response.result);
		} else {
			pending.reject(new Error(response.error));
		}
	}

	#rejectAll(error: Error): void {
		for (const pending of this.#pending.values()) pending.reject(error);
		this.#pending.clear();
	}
}
