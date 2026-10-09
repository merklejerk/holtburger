import { characterLookupName } from "./client-character-name";
import {
	squelchActionSchema,
	type SquelchAction,
	type SquelchSnapshot,
} from "./client-squelch-contract";

/** Quietly release pending presentation when server evidence is absent; never retry. */
export const SQUELCH_UPDATE_WAIT_MS = 5_000;
/** One frontend intent; identity guards asynchronous dispatch completion after retirement. */
interface PendingSquelchAction {
	readonly action: SquelchAction;
	readonly player: number;
}
/** Session-lifetime projection and interaction owner; world retains authoritative facts. */
export class ClientSquelchState {
	readonly #submit: (action: SquelchAction) => Promise<void>;
	readonly #listeners = new Set<() => void>();
	#snapshot: SquelchSnapshot | null = null;
	#player: number | null = null;
	#enabled = false;
	#pending: PendingSquelchAction | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#search = "";
	#feedback: string | null = null;

	constructor(submit: (action: SquelchAction) => Promise<void>) {
		this.#submit = submit;
	}
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
	#publish(): void {
		for (const listener of this.#listeners) listener();
	}
	#clearPending(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
		this.#pending = null;
	}
	/** Portal/resync availability changes retain facts and the current intent. */
	setContext(player: number | null, enabled: boolean): void {
		if (player === this.#player && enabled === this.#enabled) return;
		// Character retirement is explicit in the session. Identity establishment can
		// follow an early DB while session context still names the previous player.
		if (player !== this.#player) this.#clearPending();
		this.#player = player;
		this.#enabled = enabled;
		this.#publish();
	}
	/** Event-loss recovery reads retained world state; it is not a server refresh. */
	recover(
		snapshot: SquelchSnapshot | null,
		player: number | null,
		enabled: boolean,
	): void {
		if (this.#player !== null && player !== this.#player) this.reset();
		this.#player = player;
		this.#enabled = enabled;
		this.update(snapshot);
	}
	/** Replace facts atomically; no optimistic removal of overlapping scopes. */
	update(snapshot: SquelchSnapshot | null): void {
		this.#snapshot = snapshot;
		this.#feedback = null;
		const action = this.#pending?.action;
		if (action !== undefined && snapshot !== null) {
			const entry = snapshot.entries.find((entry) =>
				action.kind === "add"
					? characterLookupName(entry.name) === characterLookupName(action.name)
					: entry.guid === action.guid,
			);
			const settled =
				action.kind === "add"
					? entry !== undefined &&
						(action.scope === "account"
							? entry.account
							: entry.coverage === "all")
					: entry === undefined ||
						(action.scope === "account"
							? !entry.account
							: entry.coverage === "none");
			if (settled) this.#clearPending();
		}
		this.#publish();
	}
	setSearch(search: string): void {
		this.#search = search;
		this.#publish();
	}
	read() {
		const query = this.#search.trim().toLocaleLowerCase();
		return {
			entries: (this.#snapshot?.entries ?? [])
				.filter((entry) => entry.name.toLocaleLowerCase().includes(query))
				.toSorted((a, b) => a.name.localeCompare(b.name) || a.guid - b.guid),
			legacyAccounts: this.#snapshot?.legacyAccounts ?? [],
			globalCoverage: this.#snapshot?.globalCoverage ?? "none",
			known: this.#snapshot !== null,
			enabled:
				this.#enabled && this.#player !== null && this.#snapshot !== null,
			pending: this.#pending?.action ?? null,
			search: this.#search,
			feedback: this.#feedback,
		};
	}
	/** Known account ignores suppress the shortcut regardless of panel filtering.
	 * Other characters on that account cannot be identified locally; ACE resolves them.
	 */
	canIgnoreAccount(guid: number, name: string): boolean {
		return (
			this.#enabled &&
			this.#player !== null &&
			this.#snapshot !== null &&
			guid !== this.#player &&
			name.trim().length > 0 &&
			!this.#snapshot.entries.some(
				(entry) =>
					entry.account &&
					(entry.guid === guid ||
						characterLookupName(entry.name) ===
							characterLookupName(name.trim())),
			)
		);
	}
	/** Queue acceptance does not claim that a scope was added or removed. */
	async request(
		intent: SquelchAction,
		/** Optional caller notice for this request’s current dispatch failure only. */
		onFailure?: (message: string) => void,
	): Promise<boolean> {
		const parsed = squelchActionSchema.safeParse(intent);
		if (
			!parsed.success ||
			!this.#enabled ||
			this.#player === null ||
			this.#snapshot === null ||
			this.#pending !== null
		)
			return false;
		const action = parsed.data;
		if (
			action.kind === "remove" &&
			!this.#snapshot.entries.some(
				(entry) =>
					entry.guid === action.guid && entry.removalScope === action.scope,
			)
		)
			return false;
		const pending = { action, player: this.#player };
		this.#pending = pending;
		this.#feedback = null;
		this.#timer = setTimeout(() => {
			if (this.#pending !== pending) return;
			this.#clearPending();
			this.#publish();
		}, SQUELCH_UPDATE_WAIT_MS);
		this.#publish();
		try {
			await this.#submit(action);
			return true;
		} catch (error) {
			if (this.#pending === pending && this.#player === pending.player) {
				console.error("Ignore request failed", error);
				this.#clearPending();
				this.#feedback =
					action.kind === "add"
						? "Couldn’t add ignore."
						: "Couldn’t remove ignore.";
				const feedback = this.#feedback;
				this.#publish();
				onFailure?.(feedback);
			}
			return false;
		}
	}
	/** Character retirement clears the owner; tab dismissal does not. */
	reset(): void {
		this.#clearPending();
		this.#snapshot = null;
		this.#player = null;
		this.#enabled = false;
		this.#search = "";
		this.#feedback = null;
		this.#publish();
	}
	destroy(): void {
		this.reset();
		this.#listeners.clear();
	}
}
