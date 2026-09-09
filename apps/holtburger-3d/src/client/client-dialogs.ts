import type { ClientConfirmation } from "./client-host-contract";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";

/** One cold UI value: popup dismissal and server response retain different identities. */
export type ClientDialogPresentation =
	| { readonly kind: "popup"; readonly id: number; readonly text: string }
	| {
			readonly kind: "confirmation";
			readonly request: ClientConfirmation;
			readonly submission:
				| { readonly kind: "ready"; readonly error: string | null }
				| { readonly kind: "submitting" };
	  };

type DialogSession = Pick<
	ClientLifecycleSession,
	"subscribe" | "state" | "respondToConfirmation"
>;

type ConfirmationPresentation = Extract<
	ClientDialogPresentation,
	{ kind: "confirmation" }
>;
type PopupPresentation = Extract<ClientDialogPresentation, { kind: "popup" }>;

/** App-session dialog policy. Confirmations take priority; popups await explicit FIFO dismissal. */
export class ClientDialogs {
	readonly #session: DialogSession;
	readonly #unsubscribe: () => void;
	readonly #listeners = new Set<
		(dialog: ClientDialogPresentation | null) => void
	>();
	readonly #popups: PopupPresentation[] = [];
	#confirmation: ConfirmationPresentation | null = null;
	#nextPopupId = 1;
	#destroyed = false;

	constructor(session: DialogSession) {
		this.#session = session;
		this.#replaceConfirmation(session.state().activeConfirmation);
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
	}

	snapshot(): ClientDialogPresentation | null {
		return this.#confirmation ?? this.#popups[0] ?? null;
	}

	subscribe(
		listener: (dialog: ClientDialogPresentation | null) => void,
	): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** A delayed close event can dismiss only the popup that supplied its button. */
	dismissPopup(id: number): void {
		if (this.#destroyed || this.#popups[0]?.id !== id) return;
		this.#popups.shift();
		this.#publish();
	}

	/** Keep the question disabled until core replaces it; transport rejection permits retry. */
	async respond(requestId: string, accepted: boolean): Promise<void> {
		const current = this.#confirmation;
		if (
			this.#destroyed ||
			current === null ||
			current.request.requestId !== requestId ||
			current.submission.kind === "submitting"
		)
			return;
		const pending: ConfirmationPresentation = {
			...current,
			submission: { kind: "submitting" },
		};
		this.#confirmation = pending;
		this.#publish();
		try {
			await this.#session.respondToConfirmation(requestId, accepted);
		} catch (error) {
			// A late rejection must not re-open a canceled/replaced request or a destroyed session.
			if (this.#destroyed || this.#confirmation !== pending) return;
			this.#confirmation = {
				...current,
				submission: {
					kind: "ready",
					error: error instanceof Error ? error.message : String(error),
				},
			};
			this.#publish();
		}
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#unsubscribe();
		this.#popups.length = 0;
		this.#confirmation = null;
		this.#publish();
		this.#listeners.clear();
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		switch (event.type) {
			case "popup-string":
				this.#popups.push({
					kind: "popup",
					id: this.#nextPopupId++,
					text: event.message,
				});
				break;
			case "confirmation":
				this.#replaceConfirmation(event.confirmation);
				break;
			case "current-state":
				this.#replaceConfirmation(event.state.activeConfirmation);
				if (event.state.lifecycle.kind === "exiting") this.#clear();
				break;
			case "lifecycle":
				if (event.lifecycle.kind !== "exiting") return;
				this.#clear();
				break;
			default:
				return;
		}
		this.#publish();
	}

	#replaceConfirmation(request: ClientConfirmation | null): void {
		if (request === null) this.#confirmation = null;
		else if (request.requestId !== this.#confirmation?.request.requestId) {
			this.#confirmation = {
				kind: "confirmation",
				request,
				submission: { kind: "ready", error: null },
			};
		}
	}

	#clear(): void {
		this.#popups.length = 0;
		this.#confirmation = null;
	}

	#publish(): void {
		for (const listener of this.#listeners) listener(this.snapshot());
	}
}
