import type {
	LocalDialogSource,
	LocalConfirmationRequest,
} from "./client-dialogs";
import type { ClientLifecycleSession } from "./client-lifecycle-session";
import {
	PARTY_MEMBER_LIMIT,
	partyActionSchema,
	type PartyAction,
	type PartyPreferences,
} from "./client-party-contract";

/** A missing update ends local presentation, never retries the mutation. */
export const PARTY_UPDATE_WAIT_MS = 5_000;
/** Management display pulls only cold identity/status facts, excluding vital payloads. */
export const PARTY_DISPLAY_INTERVAL_MS = 200;
type PartySession = Pick<
	ClientLifecycleSession,
	| "partySnapshot"
	| "partyPreferences"
	| "submitParty"
	| "setPartyUpdates"
	| "subscribe"
> & {
	state(): Pick<
		ReturnType<ClientLifecycleSession["state"]>,
		"playerGuid" | "lifecycle"
	>;
};
/** Local pending intent carries its original character and invocation identity. */
interface PendingAction {
	readonly action: PartyAction;
	readonly player: number;
	readonly expires: number;
}
/** Session-owned UI policy; core and world retain the authoritative roster. */
export class ClientPartyState implements LocalDialogSource {
	readonly #session: PartySession;
	readonly #failure: (message: string) => void;
	/** Reports queued invitation requests through the existing client notification surface. */
	readonly #notice: (message: string) => void;
	readonly #unsubscribe: () => void;
	readonly #listeners = new Set<() => void>();
	#pending: PendingAction | null = null;
	#review: {
		request: LocalConfirmationRequest;
		action: PartyAction;
		player: number;
		roster: string;
	} | null = null;
	#visible = false;
	#disposed = false;
	#sequence = 0;

	constructor(
		session: PartySession,
		failure: (message: string) => void,
		notice: (message: string) => void,
	) {
		this.#session = session;
		this.#failure = failure;
		this.#notice = notice;
		this.#unsubscribe = session.subscribe((event) => {
			if (event.type === "current-state" || event.type === "resyncing")
				this.#clearReview();
			if (event.type === "lifecycle") {
				if (event.lifecycle.kind === "in-world") {
					if (this.#visible) void this.#updates(true);
				} else if (event.lifecycle.kind !== "portal-space") {
					this.#pending = null;
					this.#clearReview();
				}
			}
		});
	}
	#roster(): string {
		const party = this.#session.partySnapshot();
		return JSON.stringify(
			party === null
				? null
				: [
						party.name,
						party.leader,
						party.members.map((member) => member.guid),
					],
		);
	}
	read() {
		const state = this.#session.state();
		const party = this.#session.partySnapshot();
		const preferences = this.#session.partyPreferences();
		const pending = this.#pending;
		if (pending !== null) {
			const action = pending.action;
			const observed =
				action.kind === "openness"
					? party?.open === action.open
					: action.kind === "promote"
						? party?.leader === action.target
						: action.kind === "dismiss"
							? party !== null &&
								!party.members.some((member) => member.guid === action.target)
							: action.kind === "leave" || action.kind === "disband"
								? party === null
								: action.kind === "create"
									? party !== null
									: action.kind === "shareXp"
										? preferences?.shareXp === action.enabled
										: action.kind === "shareLoot"
											? preferences?.shareLoot === action.enabled
											: action.kind === "ignoreRequests"
												? preferences?.ignoreRequests === action.enabled
												: false;
			if (state.playerGuid !== pending.player || observed) this.#pending = null;
			else if (performance.now() >= pending.expires) {
				this.#pending = null;
				this.#failure(
					"No party update arrived. Showing the latest known state.",
				);
			}
		}
		if (
			this.#review !== null &&
			(this.#review.player !== state.playerGuid ||
				this.#review.roster !== this.#roster())
		)
			this.#clearReview();
		return {
			party:
				party === null
					? null
					: {
							name: party.name,
							leader: party.leader,
							shareXp: party.shareXp,
							evenShare: party.evenShare,
							open:
								this.#pending?.action.kind === "openness"
									? this.#pending.action.open
									: party.open,
							locked: party.locked,
							members: party.members.map(({ guid, name, level }) => ({
								guid,
								name,
								level,
							})),
						},
			preferences,
			player: state.playerGuid,
			enabled:
				!this.#disposed &&
				state.playerGuid !== null &&
				state.lifecycle?.kind === "in-world" &&
				this.#pending === null &&
				this.#review === null,
			pending: this.#pending !== null,
		};
	}
	question(): LocalConfirmationRequest | null {
		return this.#review?.request ?? null;
	}
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
	#clearReview(): void {
		if (this.#review === null) return;
		this.#review = null;
		for (const listener of this.#listeners) listener();
	}
	respond(requestId: string, accepted: boolean): void {
		this.read();
		const review = this.#review;
		if (review === null || review.request.requestId !== requestId) return;
		this.#clearReview();
		if (accepted) void this.#submit(review.action, null, []);
	}
	request(action: PartyAction): void {
		action = partyActionSchema.parse(action);
		const view = this.read();
		if (!view.enabled || view.player === null) return;
		if (action.kind === "dismiss" || action.kind === "disband") {
			const target =
				action.kind === "dismiss"
					? view.party?.members.find((member) => member.guid === action.target)
					: null;
			if (action.kind === "dismiss" && target === undefined) return;
			this.#review = {
				request: {
					requestId: `party-${++this.#sequence}`,
					text:
						action.kind === "dismiss"
							? `Dismiss ${target?.name} from the party?`
							: "Disband this party for every member?",
				},
				action,
				player: view.player,
				roster: this.#roster(),
			};
			for (const listener of this.#listeners) listener();
		} else if (action.kind === "leave") this.leave(null);
		else void this.#submit(action, null, []);
	}
	/** Frontend recruitment policy; private recipient restrictions remain server-owned. */
	canInvite(target: number): boolean {
		const view = this.read();
		return (
			view.enabled &&
			view.party !== null &&
			target !== view.player &&
			(view.party.leader === view.player || view.party.open) &&
			view.party.members.length < PARTY_MEMBER_LIMIT &&
			!view.party.members.some((member) => member.guid === target)
		);
	}
	/** Leave directly, requiring a current roster member for a multi-member leader handoff. */
	leave(successor: number | null): void {
		const view = this.read();
		if (!view.enabled || view.party === null) return;
		const needsHandoff =
			view.party.leader === view.player && view.party.members.length > 1;
		if (
			needsHandoff &&
			(successor === null ||
				successor === view.player ||
				!view.party.members.some((member) => member.guid === successor))
		)
			return;
		void this.#submit({ kind: "leave" }, needsHandoff ? successor : null, []);
	}

	/** Queue changed creation preferences before create; ACE samples loot from character options.
	 * Queue ordering is sufficient here; this does not promise atomic server acceptance.
	 */
	create(
		name: string,
		settings: Pick<PartyPreferences, "shareXp" | "shareLoot">,
	): void {
		const view = this.read();
		if (!view.enabled || view.party !== null || view.preferences === null)
			return;
		const action = partyActionSchema.parse({ kind: "create", name });
		const preparation: PartyAction[] = [];
		if (settings.shareXp !== view.preferences.shareXp)
			preparation.push({ kind: "shareXp", enabled: settings.shareXp });
		if (settings.shareLoot !== view.preferences.shareLoot)
			preparation.push({ kind: "shareLoot", enabled: settings.shareLoot });
		void this.#submit(action, null, preparation);
	}
	async #submit(
		action: PartyAction,
		successor: number | null,
		preparation: readonly PartyAction[],
	): Promise<void> {
		const player = this.#session.state().playerGuid;
		if (player === null || this.#disposed) return;
		const pending = {
			action,
			player,
			expires: performance.now() + PARTY_UPDATE_WAIT_MS,
		};
		this.#pending = pending;
		try {
			for (const preference of preparation) {
				if (
					this.#disposed ||
					this.#pending !== pending ||
					this.#session.state().playerGuid !== player
				)
					return;
				await this.#session.submitParty(preference);
			}
			// Ordered handoff and quit follow retail; neither queue acceptance nor this pair is atomic.
			if (action.kind === "leave" && successor !== null)
				await this.#session.submitParty({ kind: "promote", target: successor });
			if (
				this.#disposed ||
				this.#pending !== pending ||
				this.#session.state().playerGuid !== player
			)
				return;
			await this.#session.submitParty(action);
			if (
				action.kind === "invite" &&
				!this.#disposed &&
				this.#pending === pending
			) {
				this.#pending = null;
				// Queue acceptance confirms submission, not the recipient's acceptance or eligibility.
				this.#notice("Party invitation sent.");
			}
		} catch (error) {
			if (!this.#disposed && this.#pending === pending) {
				this.#pending = null;
				this.#failure(String(error));
			}
		}
	}
	setVisible(visible: boolean): void {
		if (this.#visible === visible) return;
		this.#visible = visible;
		if (this.#session.state().lifecycle?.kind === "in-world")
			void this.#updates(visible);
	}
	async #updates(enabled: boolean): Promise<void> {
		try {
			await this.#session.setPartyUpdates(enabled);
		} catch (error) {
			if (!this.#disposed) this.#failure(String(error));
		}
	}
	destroy(): void {
		this.setVisible(false);
		this.#disposed = true;
		this.#pending = null;
		this.#clearReview();
		this.#unsubscribe();
		this.#listeners.clear();
	}
}
