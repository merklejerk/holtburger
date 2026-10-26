type TeardownOperation = () => void | Promise<void>;

/**
 * Reverse-order cleanup that attempts every release and reports all failures together.
 *
 * Startup is deliberately progressive, so a failed device/runtime step can leave several earlier
 * resources alive. Nested `finally` blocks guarantee progress but hide later failures; this stack
 * keeps the same ordering while making the complete shutdown result observable.
 */
export class PresentationTeardownStack {
	readonly #operations: {
		readonly label: string;
		readonly release: TeardownOperation;
	}[] = [];
	#completion: Promise<void> | null = null;

	add(label: string, release: TeardownOperation | undefined): void {
		if (release === undefined) return;
		this.#operations.push({ label, release });
	}

	close(): Promise<void> {
		return (this.#completion ??= this.#release());
	}

	async #release(): Promise<void> {
		const failures: unknown[] = [];
		const labels: string[] = [];
		for (const operation of [...this.#operations].reverse()) {
			try {
				await operation.release();
			} catch (error) {
				failures.push(error);
				labels.push(operation.label);
			}
		}
		if (failures.length === 0) return;
		throw new AggregateError(
			failures,
			`Presentation teardown failed for: ${labels.join(", ")}.`,
		);
	}
}

/** Attempt every synchronous operation; a context message groups even a single failure. */
export function completePresentationOperations(
	steps: readonly (() => void)[],
	message?: string,
): void {
	const failures: unknown[] = [];
	for (const step of steps) {
		try {
			step();
		} catch (cause) {
			failures.push(cause);
		}
	}
	if (failures.length === 1 && message === undefined) throw failures[0];
	if (failures.length > 0)
		throw new AggregateError(
			failures,
			message ?? "Presentation resource operations failed.",
		);
}
