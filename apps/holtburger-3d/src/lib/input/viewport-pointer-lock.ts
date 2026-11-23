/**
 * Generation-fenced pointer-lock session for a single viewport canvas.
 *
 * Pending acquisition is distinct from held capture so a queued unlock from an earlier gesture
 * never cancels a fresh request, and an unexpected OS/Escape unlock triggers `onLost` cleanly.
 */
export class PointerLockSession {
	readonly #canvas: HTMLCanvasElement;
	readonly #document: Document;
	readonly #onLost: () => void;
	readonly #onError: (message: string) => void;
	#generation = 0;
	#state: "idle" | "pending" | "held" = "idle";

	constructor(options: {
		readonly canvas: HTMLCanvasElement;
		readonly onLost: () => void;
		readonly onError: (message: string) => void;
	}) {
		this.#canvas = options.canvas;
		this.#document = options.canvas.ownerDocument;
		this.#onLost = options.onLost;
		this.#onError = options.onError;
		this.#document.addEventListener("pointerlockchange", this.#lockChanged);
	}

	/** Whether this canvas currently owns browser pointer lock. */
	get locked(): boolean {
		return this.#document.pointerLockElement === this.#canvas;
	}

	/** Request pointer lock on the canvas if not already pending or held. */
	request(): void {
		if (this.#state !== "idle" || this.locked) return;
		const generation = this.#generation;
		this.#state = "pending";
		let result: unknown;
		try {
			// Must be invoked synchronously inside the user gesture to preserve transient activation.
			result = this.#canvas.requestPointerLock();
		} catch (error: unknown) {
			this.#state = "idle";
			this.#onLost();
			this.#onError(
				`Mouse camera controls could not capture the pointer: ${String(error)}`,
			);
			return;
		}
		Promise.resolve(result)
			.then(() => {
				if (generation !== this.#generation) {
					if (this.#state === "idle" && this.locked) {
						this.#document.exitPointerLock();
					}
					return;
				}
				if (this.#state === "pending") {
					this.#state = this.locked ? "held" : "idle";
				}
			})
			.catch((error: unknown) => {
				if (generation !== this.#generation) return;
				this.#state = "idle";
				this.#onLost();
				this.#onError(
					`Mouse camera controls could not capture the pointer: ${String(error)}`,
				);
			})
			.finally(() => {
				if (generation === this.#generation && this.#state === "pending") {
					this.#state = "idle";
				}
			});
	}

	/** Release pointer lock and invalidate any in-flight acquisition promise. */
	unlock(): void {
		this.#generation += 1;
		this.#state = "idle";
		if (this.locked) this.#document.exitPointerLock();
	}

	readonly #lockChanged = (): void => {
		if (this.locked) {
			if (this.#state === "idle") {
				this.#document.exitPointerLock();
				return;
			}
			this.#state = "held";
			return;
		}
		if (this.#state === "held") {
			this.#state = "idle";
			this.#onLost();
		}
	};

	destroy(): void {
		this.unlock();
		this.#document.removeEventListener("pointerlockchange", this.#lockChanged);
	}
}
