import type { ClientBook, ClientBookOpened } from "./client-book-contract";
import type { ClientLifecycle } from "./client-host-contract";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";

/** Maximum wait for one requested page before offering an explicit retry. */
export const BOOK_PAGE_TIMEOUT_MS = 10_000;

type BookSession = Pick<
	ClientLifecycleSession,
	"readBookPage" | "state" | "subscribe"
>;

/** One reader window's cold presentation state. */
export type ClientBookReaderState =
	| { readonly kind: "idle" }
	| {
			readonly kind: "loading" | "failed" | "ready";
			/** Opens again even when the same book identity is reused. */
			readonly revision: number;
			/** Entity name captured with the full response. */
			readonly name: string;
			/** Latest page facts for the active book. */
			readonly book: ClientBook;
			/** Number of entries whose text is present. */
			readonly loaded: number;
			/** Number of actual page entries in the full response. */
			readonly total: number;
			/** Terminal fetch failure shown until the user retries or closes. */
			readonly error?: string;
	  };

/** Owns the single open book and serial requests for page text. */
export class ClientBookReader {
	readonly #session: BookSession;
	readonly #listeners = new Set<(state: ClientBookReaderState) => void>();
	readonly #unsubscribe: () => void;
	#state: ClientBookReaderState = { kind: "idle" };
	#player: number | null;
	#requested: number | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#generation = 0;
	#destroyed = false;

	constructor(session: BookSession) {
		this.#session = session;
		this.#player = session.state().playerGuid;
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
	}

	read(): ClientBookReaderState {
		return this.#state;
	}

	subscribe(listener: (state: ClientBookReaderState) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	close(): void {
		this.#generation++;
		this.#clearRequest();
		this.#publish({ kind: "idle" });
	}

	retry(): void {
		if (this.#state.kind !== "failed") return;
		this.#publish({ ...this.#state, kind: "loading", error: undefined });
		this.#requestNext();
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#unsubscribe();
		this.close();
		this.#listeners.clear();
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		switch (event.type) {
			case "book-opened":
				this.#open(event.receipt);
				return;
			case "book-updated":
				this.#update(event.book);
				return;
			case "current-state": {
				const nextPlayer = event.state.localPlayerGuid;
				const teleport =
					event.state.lifecycle.kind === "portal-space" &&
					event.state.lifecycle.cause === "teleport";
				if (
					!retainsOpenBook(event.state.lifecycle) ||
					(teleport && this.#player === null) ||
					(this.#player !== null && nextPlayer !== this.#player)
				)
					this.close();
				this.#player = nextPlayer;
				return;
			}
			case "resyncing":
			case "exit-requested":
				this.close();
				return;
			case "lifecycle":
				if (!retainsOpenBook(event.lifecycle)) this.close();
				return;
			default:
				return;
		}
	}

	#open(receipt: ClientBookOpened): void {
		if (this.#destroyed || this.#session.state().lifecycle?.kind !== "in-world")
			return;
		this.close();
		const book = receipt.book;
		const loaded = book.pages.filter((page) => page.text !== null).length;
		this.#publish({
			kind: loaded === book.pages.length ? "ready" : "loading",
			revision: this.#generation,
			name: receipt.name,
			book,
			loaded,
			total: book.pages.length,
		});
		this.#requestNext();
	}

	#update(book: ClientBook): void {
		const state = this.#state;
		if (
			(state.kind !== "loading" && state.kind !== "failed") ||
			book.guid !== state.book.guid
		)
			return;
		const loaded = book.pages.filter((page) => page.text !== null).length;
		this.#publish({ ...state, book, loaded });
		if (state.kind === "failed") return;
		if (
			this.#requested !== null &&
			book.pages.some(
				(page) => page.index === this.#requested && page.text !== null,
			)
		) {
			this.#clearRequest();
			this.#requestNext();
		}
	}

	#requestNext(): void {
		const state = this.#state;
		if (state.kind !== "loading" || this.#requested !== null) return;
		const next = state.book.pages.find((page) => page.text === null);
		if (next === undefined) {
			this.#publish({ ...state, kind: "ready" });
			return;
		}
		const player = this.#player;
		if (player === null) {
			this.#publish({
				...state,
				kind: "failed",
				error: "Character is unavailable.",
			});
			return;
		}
		const generation = this.#generation;
		const index = next.index;
		this.#requested = index;
		this.#timer = setTimeout(() => {
			if (generation !== this.#generation || this.#requested !== index) return;
			this.#fail("The page did not arrive in time.");
		}, BOOK_PAGE_TIMEOUT_MS);
		void this.#session
			.readBookPage({ player, book: state.book.guid, pageIndex: index })
			.catch((error: unknown) => {
				if (generation !== this.#generation || this.#requested !== index)
					return;
				this.#fail(String(error));
			});
	}

	#fail(error: string): void {
		this.#clearRequest();
		if (this.#state.kind === "loading")
			this.#publish({ ...this.#state, kind: "failed", error });
	}

	#clearRequest(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
		this.#requested = null;
	}

	#publish(state: ClientBookReaderState): void {
		this.#state = state;
		for (const listener of this.#listeners) listener(state);
	}
}

/** A teleport changes the scene without replacing the reading character. */
function retainsOpenBook(lifecycle: ClientLifecycle): boolean {
	return (
		lifecycle.kind === "in-world" ||
		(lifecycle.kind === "portal-space" && lifecycle.cause === "teleport")
	);
}
