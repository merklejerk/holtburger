/** Viewport availability and cancellation, independent of DOM event delivery or game actions. */
export class ViewportInputGate {
	/** Independent blockers cannot release one another's ownership. */
	readonly #blockers = new Set<symbol>();
	/** Mounted keyboard and gesture participants in this viewport's cancellation boundary. */
	readonly #participants = new Set<() => void>();

	/** Event handlers consult availability before starting actions; releases still finish normally. */
	get allowed(): boolean {
		return this.#blockers.size === 0;
	}

	/** Acquire one blocker; releasing it never resumes previously held input. */
	block(): () => void {
		const wasAllowed = this.allowed;
		const token = Symbol();
		this.#blockers.add(token);
		try {
			if (wasAllowed) this.cancel();
		} catch (error) {
			// No release token reaches the caller when acquisition fails.
			this.#blockers.delete(token);
			throw error;
		}
		return () => {
			this.#blockers.delete(token);
		};
	}

	/** Attach one mounted participant. Detaching cancels it and is safe to repeat. */
	attach(cancel: () => void): () => void {
		const participant = () => cancel();
		if (!this.allowed) participant();
		this.#participants.add(participant);
		return () => {
			if (this.#participants.delete(participant)) participant();
		};
	}

	/** Focus loss or a discontinuity cancels input without installing a persistent blocker. */
	cancel(): void {
		const errors: unknown[] = [];
		for (const participant of [...this.#participants]) {
			if (!this.#participants.has(participant)) continue;
			try {
				participant();
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length > 0)
			throw new AggregateError(errors, "Viewport input cancellation failed.");
	}
}
