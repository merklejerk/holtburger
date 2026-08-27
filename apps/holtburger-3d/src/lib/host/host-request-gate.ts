interface PendingHostRequest<T> {
	readonly operation: () => Promise<T>;
	readonly resolve: (value: T) => void;
	readonly reject: (error: unknown) => void;
}

/**
 * Bounded scheduler for frontend work that creates sidecar requests.
 *
 * The protocol pending-request ceiling is a final circuit breaker, not a work queue. Domain
 * requesters use this scheduler so they retain ordering and can decline stale work before it
 * crosses the host boundary.
 */
export class HostRequestGate {
	readonly #maxConcurrent: number;
	readonly #pending: PendingHostRequest<unknown>[] = [];
	#active = 0;
	#peakActive = 0;
	#destroyed = false;

	constructor(maxConcurrent: number) {
		if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent <= 0) {
			throw new Error("Host request concurrency must be positive.");
		}
		this.#maxConcurrent = maxConcurrent;
	}

	get activeCount(): number {
		return this.#active;
	}

	get peakActiveCount(): number {
		return this.#peakActive;
	}

	schedule<T>(operation: () => Promise<T>): Promise<T> {
		if (this.#destroyed) {
			return Promise.reject(new Error("Host requests are stopped."));
		}
		return new Promise<T>((resolve, reject) => {
			this.#pending.push({
				operation,
				resolve: resolve as (value: unknown) => void,
				reject,
			});
			this.#drain();
		});
	}

	/** Reject queued operations; in-flight host calls are allowed to settle naturally. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		const error = new Error("Host requests are stopped.");
		for (const request of this.#pending.splice(0)) request.reject(error);
	}

	#drain(): void {
		while (!this.#destroyed && this.#active < this.#maxConcurrent) {
			const request = this.#pending.shift();
			if (request === undefined) return;
			this.#active += 1;
			this.#peakActive = Math.max(this.#peakActive, this.#active);
			let completion: Promise<unknown>;
			try {
				completion = request.operation();
			} catch (error) {
				this.#active -= 1;
				request.reject(error);
				continue;
			}
			void completion.then(request.resolve, request.reject).finally(() => {
				this.#active -= 1;
				this.#drain();
			});
		}
	}
}
