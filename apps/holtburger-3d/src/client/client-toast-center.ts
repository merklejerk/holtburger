/** Visual urgency of one ephemeral client notice. */
export type ClientToastTone = "status" | "warning";

/** Complete cold-UI snapshot rendered by the client toast overlay. */
export interface ClientToast {
	readonly id: number;
	readonly message: string;
	readonly tone: ClientToastTone;
}

/** Injectable browser-timer boundary used to prove replacement and expiry ordering. */
export interface ClientToastScheduler {
	readonly cancel: (handle: number) => void;
	readonly schedule: (callback: () => void, delayMs: number) => number;
}

export const CLIENT_TOAST_DURATION_MS = 2_500;

type ClientToastListener = (toast: ClientToast | null) => void;

/** Owns one latest-wins ephemeral toast; it is intentionally not an application event queue. */
export class ClientToastCenter {
	readonly #durationMs: number;
	readonly #scheduler: ClientToastScheduler;
	readonly #listeners = new Set<ClientToastListener>();
	#current: ClientToast | null = null;
	#nextId = 1;
	#timerHandle: number | null = null;
	#destroyed = false;

	constructor(options: {
		readonly durationMs: number;
		readonly scheduler: ClientToastScheduler;
	}) {
		if (!Number.isFinite(options.durationMs) || options.durationMs <= 0)
			throw new Error("Client toast duration must be finite and positive.");
		this.#durationMs = options.durationMs;
		this.#scheduler = options.scheduler;
	}

	snapshot(): ClientToast | null {
		return this.#current;
	}

	subscribe(listener: ClientToastListener): () => void {
		this.#assertActive();
		this.#listeners.add(listener);
		listener(this.#current);
		return () => this.#listeners.delete(listener);
	}

	publish(input: {
		readonly message: string;
		readonly tone: ClientToastTone;
	}): void {
		this.#assertActive();
		if (input.message.trim().length === 0)
			throw new Error("Client toast message must not be empty.");
		this.#cancelExpiry();
		const toast: ClientToast = {
			id: this.#nextId++,
			message: input.message,
			tone: input.tone,
		};
		this.#current = toast;
		this.#timerHandle = this.#scheduler.schedule(
			() => this.#expire(toast.id),
			this.#durationMs,
		);
		this.#emit();
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#cancelExpiry();
		this.#current = null;
		this.#listeners.clear();
	}

	#expire(id: number): void {
		if (this.#current?.id !== id) return;
		this.#timerHandle = null;
		this.#current = null;
		this.#emit();
	}

	#cancelExpiry(): void {
		if (this.#timerHandle === null) return;
		this.#scheduler.cancel(this.#timerHandle);
		this.#timerHandle = null;
	}

	#emit(): void {
		for (const listener of this.#listeners) listener(this.#current);
	}

	#assertActive(): void {
		if (this.#destroyed) throw new Error("Client toast center is destroyed.");
	}
}
