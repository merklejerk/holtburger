import {
	clientClosePreparationSchema,
	clientFailureDiagnostic,
	type ClientClosePreparation,
} from "../src/client/client-close-contract.js";

/** Bounds renderer registration/preparation only; native disk flush retains its existing contract. */
export const CLIENT_CLOSE_PREPARATION_TIMEOUT_MS = 5_000;

/** Only a preparing close operation can accept a renderer acknowledgement. */
type ClosePhase =
	| { readonly kind: "open" | "finishing" | "closed" }
	| {
			readonly kind: "preparing";
			readonly complete: (result: ClientClosePreparation) => void;
	  };

/** Native owners are invoked only after renderer acknowledgement or an explicit fallback. */
interface Dependencies {
	/** Keep the window alive while requesting the renderer acknowledgement. */
	readonly prepareRenderer: () => void;
	/** Flush accepted persistence and stop the host after the renderer IPC acceptance cutoff. */
	readonly shutdownNative: () => Promise<void>;
	/** Native diagnostic/exit-status owner; failure does not skip the remaining releases. */
	readonly reportFailure: (error: unknown) => void;
	/** Final native exit bypasses intercepted close events. */
	readonly exit: () => void;
	/** One budget covers early handler registration and renderer preparation. */
	readonly deadlineMs: number;
}

/** Main-process window close policy; Electron events delegate to this one operation. */
export class ClientWindowClose {
	readonly #dependencies: Dependencies;
	#phase: ClosePhase = { kind: "open" };
	#completion: Promise<void> | null = null;
	/** Renderer loss can precede the close event that it triggers. */
	#rendererFailure: string | null = null;

	constructor(dependencies: Dependencies) {
		this.#dependencies = dependencies;
	}

	/** Persistence and camera-stop IPC remain available during preparation, then close atomically. */
	get acceptsRendererRequests(): boolean {
		return this.#phase.kind === "open" || this.#phase.kind === "preparing";
	}
	get preparing(): boolean {
		return this.#phase.kind === "preparing";
	}

	request(): Promise<void> {
		return (this.#completion ??= Promise.resolve().then(() => this.#close()));
	}

	/** Main authenticates the application frame before forwarding this unknown IPC value. */
	acceptPreparation(payload: unknown): void {
		if (this.#phase.kind !== "preparing") return;
		const parsed = clientClosePreparationSchema.safeParse(payload);
		this.#phase.complete(
			parsed.success
				? parsed.data
				: {
						kind: "failed",
						diagnostic: "Invalid client close preparation acknowledgement.",
					},
		);
	}

	/** A vanished/replaced renderer cannot acknowledge the old preparation operation. */
	rendererUnavailable(reason: string): void {
		if (this.#phase.kind === "finishing" || this.#phase.kind === "closed")
			return;
		this.#rendererFailure = reason;
		if (this.#phase.kind === "preparing")
			this.#phase.complete({ kind: "failed", diagnostic: reason });
	}

	#prepare(): Promise<ClientClosePreparation> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				if (this.#phase.kind === "preparing")
					this.#phase.complete({
						kind: "failed",
						diagnostic:
							"Client renderer did not complete close preparation before its deadline.",
					});
			}, this.#dependencies.deadlineMs);
			const complete = (result: ClientClosePreparation) => {
				clearTimeout(timer);
				this.#phase = { kind: "finishing" };
				resolve(result);
			};
			this.#phase = { kind: "preparing", complete };
			if (this.#rendererFailure !== null) {
				complete({ kind: "failed", diagnostic: this.#rendererFailure });
				return;
			}
			try {
				this.#dependencies.prepareRenderer();
			} catch (error) {
				complete({
					kind: "failed",
					diagnostic: clientFailureDiagnostic(error),
				});
			}
		});
	}

	async #close(): Promise<void> {
		const preparation = await this.#prepare();
		if (preparation.kind === "failed")
			this.#dependencies.reportFailure(new Error(preparation.diagnostic));
		try {
			await this.#dependencies.shutdownNative();
		} catch (error) {
			this.#dependencies.reportFailure(error);
		} finally {
			this.#phase = { kind: "closed" };
			this.#dependencies.exit();
		}
	}
}
