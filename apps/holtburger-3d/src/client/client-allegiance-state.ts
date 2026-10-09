import { CLIENT_ALLEGIANCE_REFRESH_INTERVAL_MS } from "./client-tuning";
import {
	allegianceActionSchema,
	type AllegianceAction,
	type AllegiancePreferences,
	type AllegianceSnapshot,
} from "./client-allegiance-contract";

/** Destructive review binds the displayed name, relationship and character identity. */
export interface AllegianceReview {
	readonly role: "patron" | "vassal";
	readonly guid: number;
	readonly name: string;
	readonly player: number;
}

/** H3D interaction policy; shared core owns refresh deadlines and world owns facts. */
export class ClientAllegianceState {
	readonly #submit: (action: AllegianceAction) => Promise<void>;
	readonly #listeners = new Set<() => void>();
	#snapshot: AllegianceSnapshot | null = null;
	#preferences: AllegiancePreferences | null = null;
	#player: number | null = null;
	#enabled = false;
	#visible = false;
	#dispatch: symbol | null = null;
	#review: AllegianceReview | null = null;
	#feedback: string | null = null;
	/** One timer owned by active tab visibility, never by incoming profile events. */
	#refreshTimer: ReturnType<typeof setInterval> | null = null;

	constructor(submit: (action: AllegianceAction) => Promise<void>) {
		this.#submit = submit;
	}
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
	#publish(): void {
		for (const listener of this.#listeners) listener();
	}
	setContext(player: number | null, enabled: boolean): void {
		if (player === this.#player && enabled === this.#enabled) return;
		if (player !== this.#player) {
			this.#stopRefresh();
			this.#review = null;
			this.#dispatch = null;
		}
		this.#player = player;
		this.#enabled = enabled;
		if (!enabled) this.#review = null;
		this.#publish();
		this.#syncRefresh();
	}
	/** Visible tabs read immediately and periodically while retaining known facts. */
	setVisible(visible: boolean): void {
		if (visible === this.#visible) return;
		this.#visible = visible;
		if (!visible) this.#review = null;
		this.#publish();
		this.#syncRefresh();
	}
	#stopRefresh(): void {
		if (this.#refreshTimer !== null) clearInterval(this.#refreshTimer);
		this.#refreshTimer = null;
	}
	#syncRefresh(): void {
		if (!this.#visible || !this.#enabled || this.#player === null) {
			this.#stopRefresh();
			return;
		}
		if (this.#refreshTimer !== null) return;
		this.#refreshTimer = setInterval(() => {
			void this.request({ kind: "refresh" });
		}, CLIENT_ALLEGIANCE_REFRESH_INTERVAL_MS);
		void this.request({ kind: "refresh" });
	}
	/** Snapshot/presence evidence updates facts; it does not settle a mutation transaction. */
	update(snapshot: AllegianceSnapshot): void {
		this.#snapshot = snapshot;
		if (this.#review !== null && !this.#reviewIsCurrent(this.#review))
			this.#review = null;
		this.#publish();
	}
	updatePreferences(preferences: AllegiancePreferences | null): void {
		this.#preferences = preferences;
		this.#publish();
	}
	recover(
		snapshot: AllegianceSnapshot,
		preferences: AllegiancePreferences | null,
		player: number | null,
		enabled: boolean,
	): void {
		this.#preferences = preferences;
		this.update(snapshot);
		this.setContext(player, enabled);
	}
	#reviewIsCurrent(review: AllegianceReview): boolean {
		if (
			!this.#enabled ||
			review.player !== this.#player ||
			this.#snapshot?.playerGuid !== review.player
		)
			return false;
		const profile = this.#snapshot.profile;
		const member =
			review.role === "patron"
				? profile?.patron
				: profile?.directVassals.find((member) => member.guid === review.guid);
		return member?.guid === review.guid && member.name === review.name;
	}
	review(role: AllegianceReview["role"], guid: number): void {
		if (
			!this.#enabled ||
			this.#player === null ||
			this.#snapshot?.playerGuid !== this.#player
		)
			return;
		const profile = this.#snapshot.profile;
		const member =
			role === "patron"
				? profile?.patron
				: profile?.directVassals.find((member) => member.guid === guid);
		if (member === undefined || member === null || member.guid !== guid) return;
		this.#review = { role, guid, name: member.name, player: this.#player };
		this.#publish();
	}
	cancelReview(): void {
		this.#review = null;
		this.#publish();
	}
	async confirmReview(): Promise<boolean> {
		const review = this.#review;
		if (review === null || !this.#reviewIsCurrent(review)) return false;
		this.#review = null;
		return this.request({ kind: "break", guid: review.guid });
	}
	read() {
		return {
			snapshot: this.#snapshot,
			preferences: this.#preferences,
			enabled: this.#enabled && this.#player !== null,
			submitting: this.#dispatch !== null,
			review: this.#review,
			feedback: this.#feedback,
		};
	}
	/** Selection classification belongs to the scene consumer; this owns action admission. */
	canSwear(guid: number): boolean {
		return (
			this.#enabled &&
			this.#player !== null &&
			guid !== this.#player &&
			this.#snapshot?.playerGuid === this.#player &&
			this.#snapshot.canSwear &&
			this.#dispatch === null
		);
	}
	/** Dispatch progress is short-lived queue work; facts remain server-authoritative. */
	async request(intent: AllegianceAction): Promise<boolean> {
		const parsed = allegianceActionSchema.safeParse(intent);
		if (
			!parsed.success ||
			!this.#enabled ||
			this.#player === null ||
			this.#dispatch !== null
		)
			return false;
		const action = parsed.data;
		if (
			(action.kind === "swear" || action.kind === "break") &&
			this.#snapshot?.playerGuid !== this.#player
		)
			return false;
		if (action.kind === "refresh" && this.#snapshot?.refreshing) return false;
		if (action.kind === "swear" && !this.canSwear(action.guid)) return false;
		if (action.kind === "showLogons" && this.#preferences === null)
			return false;
		if (action.kind === "break") {
			const profile = this.#snapshot?.profile;
			if (
				profile?.patron?.guid !== action.guid &&
				!profile?.directVassals.some((member) => member.guid === action.guid)
			)
				return false;
		}
		const dispatch = Symbol("allegiance dispatch");
		this.#dispatch = dispatch;
		if (action.kind !== "refresh") this.#feedback = null;
		this.#publish();
		try {
			await this.#submit(action);
			return true;
		} catch (error) {
			if (this.#dispatch === dispatch) {
				if (action.kind === "refresh")
					console.error("Allegiance profile request failed", error);
				else
					this.#feedback =
						error instanceof Error ? error.message : String(error);
			}
			return false;
		} finally {
			if (this.#dispatch === dispatch) {
				this.#dispatch = null;
				this.#publish();
			}
		}
	}
	reset(): void {
		this.#stopRefresh();
		this.#snapshot = null;
		this.#preferences = null;
		this.#player = null;
		this.#enabled = false;
		this.#dispatch = null;
		this.#review = null;
		this.#feedback = null;
		this.#publish();
	}
}
