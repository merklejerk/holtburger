interface PendingHostRequest<T> {
	readonly operation: () => Promise<T>;
	readonly resolve: (value: T) => void;
	readonly reject: (error: unknown) => void;
}

/**
 * Bounded scheduler for host requests or domain preparation jobs.
 *
 * The protocol pending-request ceiling is a final circuit breaker, not a work queue.
 * Connection admission and domain requesters use this scheduler to bound their own work.
 * Domain requesters can additionally decline stale work before it crosses the host boundary.
 */
export class HostRequestGate {
	readonly #maxConcurrent: number;
	readonly #pending: PendingHostRequest<unknown>[] = [];
	#active = 0;
	/** Terminal reason shared by queued and future operations. */
	#closedReason: Error | undefined;

	constructor(maxConcurrent: number) {
		if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent <= 0) {
			throw new Error("Host request concurrency must be positive.");
		}
		this.#maxConcurrent = maxConcurrent;
	}

	schedule<T>(operation: () => Promise<T>): Promise<T> {
		if (this.#closedReason !== undefined) {
			return Promise.reject(this.#closedReason);
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
	destroy(error: Error): void {
		if (this.#closedReason !== undefined) return;
		this.#closedReason = error;
		for (const request of this.#pending.splice(0)) request.reject(error);
	}

	#drain(): void {
		while (
			this.#closedReason === undefined &&
			this.#active < this.#maxConcurrent
		) {
			const request = this.#pending.shift();
			if (request === undefined) return;
			this.#active += 1;
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
