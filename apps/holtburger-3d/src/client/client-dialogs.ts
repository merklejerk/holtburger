import type { ClientConfirmation } from "./client-host-contract";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";

/** Local confirmation content; the shared dialog shell owns cancellation gestures. */
export interface LocalConfirmationRequest {
	readonly requestId: string;
	readonly text: string;
	/** Optional acceptance wording supplied by the feature owner. */
	readonly acceptLabel?: string;
	/** Optional cancellation wording supplied by the feature owner. */
	readonly cancelLabel?: string;
	/** The owner decides the duration and scope; the presenter only returns the choice. */
	readonly suppressionLabel?: string;
	readonly typedConfirmation?: {
		/** Exact input required before the acceptance callback can run. */
		readonly requiredText: string;
	};
}

/** One cold UI value: popup dismissal and server response retain different identities. */
export type ClientDialogPresentation =
	| {
			readonly kind: "local-confirmation";
			readonly request: LocalConfirmationRequest;
			readonly submission: { readonly kind: "ready"; readonly error: null };
	  }
	| { readonly kind: "popup"; readonly id: number; readonly text: string }
	| {
			readonly kind: "confirmation";
			readonly request: ClientConfirmation;
			readonly submission:
				| { readonly kind: "ready"; readonly error: string | null }
				| { readonly kind: "submitting" };
	  };

/** Each local owner retains its question and dispatch policy; dialogs only present and route answers. */
export interface LocalDialogSource {
	readonly question: () => LocalConfirmationRequest | null;
	readonly subscribe: (listener: () => void) => () => void;
	readonly respond: (
		requestId: string,
		accepted: boolean,
		suppress?: boolean,
	) => void;
}

type DialogSession = Pick<
	ClientLifecycleSession,
	"subscribe" | "state" | "respondToConfirmation"
>;

type ConfirmationPresentation = Extract<
	ClientDialogPresentation,
	{ kind: "confirmation" }
>;
type PopupPresentation = Extract<ClientDialogPresentation, { kind: "popup" }>;

/** App-session dialog policy. Confirmations take priority; popups await FIFO dismissal. */
export class ClientDialogs {
	readonly #session: DialogSession;
	readonly #unsubscribe: () => void;
	readonly #listeners = new Set<
		(dialog: ClientDialogPresentation | null) => void
	>();
	readonly #popups: PopupPresentation[] = [];
	#confirmation: ConfirmationPresentation | null = null;
	/** Binding order chooses among local questions; server confirmations retain priority. */
	readonly #localBindings = new Map<
		LocalDialogSource,
		{
			readonly source: LocalDialogSource;
			readonly unsubscribe: () => void;
		}
	>();
	#nextPopupId = 1;
	#destroyed = false;

	constructor(session: DialogSession) {
		this.#session = session;
		this.#replaceConfirmation(session.state().activeConfirmation);
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
	}

	#localQuestion(): {
		readonly source: LocalDialogSource;
		readonly question: NonNullable<ReturnType<LocalDialogSource["question"]>>;
	} | null {
		for (const { source } of this.#localBindings.values()) {
			const question = source.question();
			if (question !== null) return { source, question };
		}
		return null;
	}

	snapshot(): ClientDialogPresentation | null {
		const local = this.#localQuestion();
		return (
			this.#confirmation ??
			(local === null
				? (this.#popups[0] ?? null)
				: {
						kind: "local-confirmation",
						request: local.question,
						submission: { kind: "ready", error: null },
					})
		);
	}

	subscribe(
		listener: (dialog: ClientDialogPresentation | null) => void,
	): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Bind an owner-provided question without copying its operation or feature policy. */
	bindLocal(source: LocalDialogSource): () => void {
		if (this.#destroyed)
			throw new Error("Cannot bind local dialogs after destruction.");
		if (this.#localBindings.has(source))
			throw new Error("Local dialog owner is already bound.");
		const binding = {
			source,
			unsubscribe: source.subscribe(() => this.#publish()),
		};
		this.#localBindings.set(source, binding);
		this.#publish();
		return () => {
			if (this.#localBindings.get(source) !== binding) return;
			binding.unsubscribe();
			this.#localBindings.delete(source);
			this.#publish();
		};
	}

	/** A delayed close event can dismiss only the popup that supplied its button. */
	dismissPopup(id: number): void {
		if (this.#destroyed || this.#popups[0]?.id !== id) return;
		this.#popups.shift();
		this.#publish();
	}

	/** Local answers return to their owner; server questions await authority acknowledgement. */
	async respond(
		requestId: string,
		accepted: boolean,
		suppress?: boolean,
	): Promise<void> {
		const local = this.#localQuestion();
		if (
			!this.#destroyed &&
			this.#confirmation === null &&
			local?.question.requestId === requestId
		) {
			local.source.respond(requestId, accepted, suppress);
			return;
		}
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
		for (const binding of this.#localBindings.values()) binding.unsubscribe();
		this.#localBindings.clear();
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
