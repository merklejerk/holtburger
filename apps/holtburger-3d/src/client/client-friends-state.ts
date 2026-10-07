import { characterLookupName } from "./client-character-name";
import {
	friendsActionSchema,
	type FriendsAction,
	type FriendsPreferences,
	type FriendsSnapshot,
} from "./client-friends-contract";

/** Bound missing evidence without retrying mutations or inventing a refresh path. */
export const FRIENDS_UPDATE_WAIT_MS = 5_000;

/** One local intent; its object identity protects against stale promise completions. */
interface PendingFriendAction {
	readonly action: FriendsAction;
	readonly player: number;
}
/** Session-lifetime read model and interaction owner; world remains authoritative. */
export class ClientFriendsState {
	readonly #submit: (action: FriendsAction) => Promise<void>;
	readonly #listeners = new Set<() => void>();
	#snapshot: FriendsSnapshot | null = null;
	#preferences: FriendsPreferences | null = null;
	#player: number | null = null;
	#enabled = false;
	#pending: PendingFriendAction | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#search = "";
	#onlineOnly = false;
	#feedback: string | null = null;

	constructor(submit: (action: FriendsAction) => Promise<void>) {
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
	/** Transport lifecycle supplies availability; portal travel preserves accepted facts. */
	setContext(player: number | null, enabled: boolean): void {
		if (player === this.#player && enabled === this.#enabled) return;
		if (player !== this.#player) this.#clearPending();
		this.#player = player;
		this.#enabled = enabled;
		this.#publish();
	}
	/** Replacement recovery and incremental events use this single projection owner. */
	recover(
		snapshot: FriendsSnapshot | null,
		preferences: FriendsPreferences | null,
		player: number | null,
		enabled: boolean,
	): void {
		if (this.#player !== null && player !== this.#player) this.reset();
		this.#player = player;
		this.#enabled = enabled;
		this.#snapshot = snapshot;
		this.#preferences = preferences;
		this.#feedback = null;
		this.#settle();
		this.#publish();
	}
	/** Incremental membership publication follows the same settlement path as recovery. */
	update(snapshot: FriendsSnapshot | null): void {
		this.#snapshot = snapshot;
		if (snapshot !== null) this.#feedback = null;
		this.#settle();
		this.#publish();
	}
	updatePreferences(preferences: FriendsPreferences | null): void {
		this.#preferences = preferences;
		if (preferences !== null) this.#feedback = null;
		this.#settle();
		this.#publish();
	}
	#settle(): void {
		const action = this.#pending?.action;
		if (action === undefined) return;
		const members = this.#snapshot?.members;
		const settled =
			action.kind === "appearOffline"
				? this.#preferences?.appearOffline === action.enabled
				: members !== undefined &&
					(action.kind === "add"
						? members.some(
								(member) =>
									characterLookupName(member.name) ===
									characterLookupName(action.name),
							)
						: !members.some((member) => member.guid === action.guid));
		if (settled) this.#clearPending();
	}
	setFilters(search: string, onlineOnly: boolean): void {
		this.#search = search;
		this.#onlineOnly = onlineOnly;
		this.#publish();
	}
	read() {
		const query = this.#search.trim().toLocaleLowerCase();
		const members = (this.#snapshot?.members ?? [])
			.filter(
				(member) =>
					(!this.#onlineOnly || member.online) &&
					member.name.toLocaleLowerCase().includes(query),
			)
			.toSorted(
				(left, right) =>
					Number(right.online) - Number(left.online) ||
					left.name.localeCompare(right.name) ||
					left.guid - right.guid,
			);
		return {
			members,
			known: this.#snapshot !== null,
			preferences: this.#preferences,
			enabled: this.#enabled && this.#player !== null,
			pending: this.#pending?.action ?? null,
			search: this.#search,
			onlineOnly: this.#onlineOnly,
			feedback: this.#feedback,
		};
	}
	/** Queue acceptance retains pending presentation until matching current-state evidence. */
	async request(intent: FriendsAction): Promise<boolean> {
		const parsed = friendsActionSchema.safeParse(intent);
		if (
			!parsed.success ||
			!this.#enabled ||
			this.#player === null ||
			this.#pending !== null
		)
			return false;
		const action = parsed.data;
		if (
			action.kind === "remove" &&
			!this.#snapshot?.members.some((member) => member.guid === action.guid)
		)
			return false;
		if (action.kind === "appearOffline" && this.#preferences === null)
			return false;
		this.#clearPending();
		const pending: PendingFriendAction = { action, player: this.#player };
		this.#pending = pending;
		this.#feedback = null;
		this.#timer = setTimeout(() => {
			if (this.#pending !== pending) return;
			this.#clearPending();
			this.#publish();
		}, FRIENDS_UPDATE_WAIT_MS);
		this.#publish();
		try {
			await this.#submit(action);
			return true;
		} catch (error) {
			if (this.#pending === pending && this.#player === pending.player) {
				console.error("Friends request failed", error);
				this.#clearPending();
				this.#feedback =
					action.kind === "add"
						? "Couldn’t add friend."
						: action.kind === "remove"
							? "Couldn’t remove friend."
							: "Couldn’t change your presence setting.";
				this.#publish();
			}
			return false;
		}
	}
	/** Character retirement clears facts and drafts; tab unmount never calls this. */
	reset(): void {
		this.#clearPending();
		this.#snapshot = null;
		this.#preferences = null;
		this.#player = null;
		this.#enabled = false;
		this.#search = "";
		this.#onlineOnly = false;
		this.#feedback = null;
		this.#publish();
	}
	destroy(): void {
		this.reset();
		this.#listeners.clear();
	}
}
