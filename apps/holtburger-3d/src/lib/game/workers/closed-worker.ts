/** One worker endpoint used by a closed request/response client. */
export interface ClosedWorkerPort {
	onerror: ((event: ErrorEvent) => void) | null;
	onmessage:
		((event: MessageEvent<ClosedWorkerResponse<unknown>>) => void) | null;
	postMessage(
		message: ClosedWorkerRequest<unknown>,
		transfer: readonly Transferable[],
	): void;
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
		{
			readonly resolve: (result: TResult) => void;
			readonly reject: (error: Error) => void;
		}
	>();
	#destroyed = false;
	#nextId = 0;

	constructor(worker: ClosedWorkerPort) {
		this.#worker = worker;
		worker.onmessage = (event) =>
			this.#handleResponse(event.data as ClosedWorkerResponse<TResult>);
		worker.onerror = (event) =>
			this.#fail(new Error(event.message || "Closed worker failed."));
	}

	get isDestroyed(): boolean {
		return this.#destroyed;
	}

	dispatch(input: TInput, transfer: readonly Transferable[]): Promise<TResult> {
		if (this.#destroyed)
			return Promise.reject(new Error("Closed worker is destroyed."));
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
		this.#fail(new Error("Closed worker was terminated."));
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

	#fail(error: Error): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#worker.terminate();
		for (const pending of this.#pending.values()) pending.reject(error);
		this.#pending.clear();
	}
}

interface WorkerSlot<TInput, TResult> {
	client: ClosedWorkerClient<TInput, TResult>;
	busy: boolean;
}

interface PendingDispatch<TInput, TResult> {
	readonly input: TInput;
	readonly transfer: readonly Transferable[];
	readonly resolve: (result: TResult) => void;
	readonly reject: (error: Error) => void;
	readonly queuedAt: number;
}

/** Aggregate queue and transfer facts for one bounded closed-worker pool. */
export interface ClosedWorkerPoolDiagnostics {
	readonly activeJobCount: number;
	readonly completedJobCount: number;
	readonly peakQueuedJobCount: number;
	readonly queuedJobCount: number;
	readonly totalExecutionDurationMs: number;
	readonly totalQueueDelayMs: number;
	readonly transferredBytes: number;
	readonly workerCount: number;
}

/**
 * Bounded scheduler for independent closed worker jobs. Every worker handles at most one job, and
 * queued jobs retain their closed payload until a slot becomes available.
 */
export class BoundedClosedWorkerPool<TInput, TResult> {
	readonly #createWorker: () => ClosedWorkerPort;
	readonly #slots: WorkerSlot<TInput, TResult>[];
	readonly #pending: PendingDispatch<TInput, TResult>[] = [];
	#activeJobCount = 0;
	#completedJobCount = 0;
	#peakQueuedJobCount = 0;
	#totalExecutionDurationMs = 0;
	#totalQueueDelayMs = 0;
	#transferredBytes = 0;
	#destroyed = false;

	constructor(options: {
		readonly createWorker: () => ClosedWorkerPort;
		readonly workerCount: number;
	}) {
		if (!Number.isInteger(options.workerCount) || options.workerCount <= 0) {
			throw new Error("Closed worker pool size must be a positive integer.");
		}
		this.#createWorker = options.createWorker;
		this.#slots = Array.from({ length: options.workerCount }, () => ({
			busy: false,
			client: new ClosedWorkerClient<TInput, TResult>(this.#createWorker()),
		}));
	}

	dispatch(input: TInput, transfer: readonly Transferable[]): Promise<TResult> {
		if (this.#destroyed)
			return Promise.reject(new Error("Closed worker pool is destroyed."));
		return new Promise<TResult>((resolve, reject) => {
			this.#pending.push({
				input,
				queuedAt: performance.now(),
				reject,
				resolve,
				transfer,
			});
			this.#peakQueuedJobCount = Math.max(
				this.#peakQueuedJobCount,
				this.#pending.length,
			);
			this.#drain();
		});
	}

	/** Read aggregate scheduling facts without exposing worker or queued payload ownership. */
	getDiagnostics(): ClosedWorkerPoolDiagnostics {
		return {
			activeJobCount: this.#activeJobCount,
			completedJobCount: this.#completedJobCount,
			peakQueuedJobCount: this.#peakQueuedJobCount,
			queuedJobCount: this.#pending.length,
			totalExecutionDurationMs: this.#totalExecutionDurationMs,
			totalQueueDelayMs: this.#totalQueueDelayMs,
			transferredBytes: this.#transferredBytes,
			workerCount: this.#slots.length,
		};
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		const error = new Error("Closed worker pool was terminated.");
		for (const pending of this.#pending.splice(0)) pending.reject(error);
		for (const slot of this.#slots) slot.client.destroy();
	}

	#drain(): void {
		if (this.#destroyed) return;
		for (const slot of this.#slots) {
			if (slot.busy) continue;
			const pending = this.#pending.shift();
			if (!pending) return;
			slot.busy = true;
			this.#activeJobCount += 1;
			this.#totalQueueDelayMs += performance.now() - pending.queuedAt;
			this.#transferredBytes += transferredByteLength(pending.transfer);
			const startedAt = performance.now();
			void slot.client
				.dispatch(pending.input, pending.transfer)
				.then(
					(result) => pending.resolve(result),
					(error: unknown) =>
						pending.reject(
							error instanceof Error ? error : new Error(String(error)),
						),
				)
				.finally(() => {
					slot.busy = false;
					this.#activeJobCount -= 1;
					this.#completedJobCount += 1;
					this.#totalExecutionDurationMs += performance.now() - startedAt;
					if (slot.client.isDestroyed && !this.#destroyed) {
						slot.client = new ClosedWorkerClient<TInput, TResult>(
							this.#createWorker(),
						);
					}
					this.#drain();
				});
		}
	}
}

function transferredByteLength(transfer: readonly Transferable[]): number {
	return transfer.reduce<number>(
		(total, value) =>
			total + (value instanceof ArrayBuffer ? value.byteLength : 0),
		0,
	);
}
