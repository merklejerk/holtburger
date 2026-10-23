/** Bounded relative-yaw dispatch: one queued submission, with later samples accumulated behind it. */
export class ClientFacingInputDispatch {
	readonly #submit: (
		deltaRadians: number,
		current: () => boolean,
	) => Promise<void>;
	#pending = 0;
	#frame: number | null = null;
	#submissions = 0;
	#generation = 0;

	constructor(
		submit: (deltaRadians: number, current: () => boolean) => Promise<void>,
	) {
		this.#submit = submit;
	}

	/** Accumulate displacement, preserving the sum rather than only the last mouse sample. */
	add(deltaRadians: number): void {
		if (!Number.isFinite(deltaRadians))
			throw new Error("Facing displacement must be finite.");
		this.#pending = (this.#pending + deltaRadians) % (2 * Math.PI);
		this.#schedule();
	}

	#schedule(): void {
		if (this.#submissions !== 0 || this.#frame !== null || this.#pending === 0)
			return;
		this.#frame = requestAnimationFrame(() => {
			this.#frame = null;
			this.flush();
		});
	}

	/** Flush before a drive/jump edge so coalescing cannot reverse browser input order. */
	flush(): void {
		if (this.#pending === 0) return;
		if (this.#frame !== null) cancelAnimationFrame(this.#frame);
		this.#frame = null;
		const delta = this.#pending;
		this.#pending = 0;
		this.#submissions += 1;
		const generation = this.#generation;
		// Explicit lifecycle edges can add a barrier; pointer samples alone never grow the queue.
		void this.#submit(delta, () => generation === this.#generation).finally(
			() => {
				this.#submissions -= 1;
				this.#schedule();
			},
		);
	}

	/** Invalidate queued submissions and forget undispatched samples across cancellation. */
	cancel(): void {
		this.#generation += 1;
		this.#pending = 0;
		if (this.#frame !== null) cancelAnimationFrame(this.#frame);
		this.#frame = null;
	}
}
