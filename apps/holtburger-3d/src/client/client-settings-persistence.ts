/** Cold-snapshot scheduler that coalesces changes and never overlaps saves. */
export class ClientSettingsPersistence<Snapshot> {
	readonly #save: (snapshot: Snapshot) => Promise<void>;
	readonly #report: (error: unknown) => void;
	readonly #delayMs: number;
	#pending: Snapshot | null = null;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#inFlight: Promise<void> | null = null;

	constructor(options: {
		readonly delayMs: number;
		readonly save: (snapshot: Snapshot) => Promise<void>;
		readonly report: (error: unknown) => void;
	}) {
		this.#delayMs = options.delayMs;
		this.#save = options.save;
		this.#report = options.report;
	}

	publish(snapshot: Snapshot): void {
		this.#pending = snapshot;
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
			if (this.#pending === null) this.#pending = snapshot;
			this.#report(error);
			throw error;
		} finally {
			this.#inFlight = null;
		}
		if (this.#pending !== null) await this.#drain();
	}
}
