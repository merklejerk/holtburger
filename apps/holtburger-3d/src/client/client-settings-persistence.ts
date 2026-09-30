/** Cold-snapshot scheduler that coalesces changes and never overlaps saves. */
export class ClientSettingsPersistence<Snapshot> {
	readonly #save: (snapshot: Snapshot) => Promise<void>;
	readonly #report: (error: unknown) => void;
	readonly #merge:
		((pending: Snapshot, next: Snapshot) => Snapshot) | undefined;
	readonly #delayMs: number;
	#pending: Snapshot | null = null;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#inFlight: Promise<void> | null = null;

	constructor(options: {
		readonly delayMs: number;
		readonly save: (snapshot: Snapshot) => Promise<void>;
		readonly report: (error: unknown) => void;
		/** Combine pending changes when separate settings sections change in one interval. */
		readonly merge?: (pending: Snapshot, next: Snapshot) => Snapshot;
	}) {
		this.#delayMs = options.delayMs;
		this.#save = options.save;
		this.#report = options.report;
		this.#merge = options.merge;
	}

	publish(snapshot: Snapshot): void {
		this.#pending =
			this.#pending === null || this.#merge === undefined
				? snapshot
				: this.#merge(this.#pending, snapshot);
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			void this.#drain().catch(() => undefined);
		}, this.#delayMs);
	}

	async flush(): Promise<void> {
		if (this.#timer !== undefined) {
			clearTimeout(this.#timer);
			this.#timer = undefined;
		}
		await this.#drain();
	}

	/** Retire a failed snapshot when its owner has ended its lifetime. */
	discardPending(): void {
		if (this.#inFlight !== null)
			throw new Error("Cannot discard settings while a save is in flight");
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#pending = null;
	}

	async #drain(): Promise<void> {
		if (this.#inFlight !== null) {
			await this.#inFlight;
			if (this.#pending !== null) await this.#drain();
			return;
		}
		const snapshot = this.#pending;
		if (snapshot === null) return;
		this.#pending = null;
		const save = this.#save(snapshot);
		this.#inFlight = save;
		try {
			await save;
		} catch (error) {
			this.#pending =
				this.#pending === null
					? snapshot
					: this.#merge === undefined
						? this.#pending
						: this.#merge(snapshot, this.#pending);
			this.#report(error);
			throw error;
		} finally {
			this.#inFlight = null;
		}
		if (this.#pending !== null) await this.#drain();
	}
}
