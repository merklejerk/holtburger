/** Presentation class; progress is neutral and yields to active warnings and errors. */
export type HudToastTone =
	"progress" | "status" | "success" | "warning" | "error";

/** Complete cold-UI snapshot rendered by the toast overlay. */
export interface HudToast {
	readonly id: number;
	readonly message: string;
	readonly tone: HudToastTone;
}

/** Injectable browser-timer boundary used to prove replacement and expiry ordering. */
export interface HudToastScheduler {
	readonly cancel: (handle: number) => void;
	readonly schedule: (callback: () => void, delayMs: number) => number;
}

export const HUD_TOAST_DURATION_MS = 2_500;

type HudToastListener = (toast: HudToast | null) => void;

/** Owns one ephemeral toast; warnings retain their duration across lower-priority updates. */
export class HudToastCenter {
	readonly #durationMs: number;
	readonly #scheduler: HudToastScheduler;
	readonly #listeners = new Set<HudToastListener>();
	#current: HudToast | null = null;
	#nextId = 1;
	#timerHandle: number | null = null;
	#destroyed = false;

	constructor(options: {
		readonly durationMs: number;
		readonly scheduler: HudToastScheduler;
	}) {
		if (!Number.isFinite(options.durationMs) || options.durationMs <= 0)
			throw new Error("Toast duration must be finite and positive.");
		this.#durationMs = options.durationMs;
		this.#scheduler = options.scheduler;
	}

	snapshot(): HudToast | null {
		return this.#current;
	}

	subscribe(listener: HudToastListener): () => void {
		this.#assertActive();
		this.#listeners.add(listener);
		listener(this.#current);
		return () => this.#listeners.delete(listener);
	}

	publish(input: {
		readonly message: string;
		readonly tone: HudToastTone;
	}): void {
		this.#assertActive();
		if (input.message.trim().length === 0)
			throw new Error("Toast message must not be empty.");
		if (
			(this.#current?.tone === "warning" || this.#current?.tone === "error") &&
			input.tone === "progress"
		)
			return;
		this.#cancelExpiry();
		const toast: HudToast = {
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
		if (this.#destroyed) throw new Error("Toast center is destroyed.");
	}
}
