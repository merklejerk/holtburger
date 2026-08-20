const TIME_EPSILON_SECONDS = 1e-9;

/** Owns the bounded cadence for listener-relative audio control updates. */
export class AudioControlCadence {
	readonly #intervalSeconds: number;
	#lastUpdateTimeSeconds: number | null = null;

	constructor(intervalSeconds: number) {
		if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
			throw new Error("Audio control interval must be finite and positive.");
		}
		this.#intervalSeconds = intervalSeconds;
	}

	/**
	 * Decide whether this frame updates ambient weights and live voice placements.
	 *
	 * Forced updates rebase the cadence, as do long stalls and clock regressions. There is no
	 * catch-up loop: audio control consumes only the listener state that is current now.
	 */
	shouldUpdate(timeSeconds: number, forced: boolean): boolean {
		if (!Number.isFinite(timeSeconds)) {
			throw new Error("Audio control time must be finite.");
		}
		const lastUpdate = this.#lastUpdateTimeSeconds;
		if (
			forced ||
			lastUpdate === null ||
			timeSeconds < lastUpdate ||
			timeSeconds - lastUpdate + TIME_EPSILON_SECONDS >= this.#intervalSeconds
		) {
			this.#lastUpdateTimeSeconds = timeSeconds;
			return true;
		}
		return false;
	}
}
