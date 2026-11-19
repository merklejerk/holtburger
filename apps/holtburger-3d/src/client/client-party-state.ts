import { z } from "zod";
import equal from "fast-deep-equal";
import type {
	LocalDialogSource,
	LocalConfirmationRequest,
} from "./client-dialogs";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";

const guid = z.number().int().positive().max(0xffff_ffff);
const u32 = z.number().int().nonnegative().max(0xffff_ffff);
/** Membership facts retained imperatively; vitals never enter the management reactive graph. */
export const partySnapshotSchema = z
	.object({
		name: z.string(),
		leader: guid.nullable(),
		shareXp: z.boolean(),
		evenShare: z.boolean(),
		open: z.boolean(),
		locked: z.boolean(),
		/** World-owned actor permissions; frontend adds only local interaction gating. */
		capabilities: z
			.object({
				isLeader: z.boolean(),
				canRecruit: z.boolean(),
				canChangeOpenness: z.boolean(),
			})
			.strict(),
		members: z.array(
			z
				.object({
					guid,
					name: z.string(),
					level: u32,
					/** Shared permission to promote or dismiss this roster member. */
					canManage: z.boolean(),
					vitals: z.tuple([u32, u32, u32, u32, u32, u32]),
				})
				.strict(),
		),
	})
	.strict();
export type PartySnapshot = z.infer<typeof partySnapshotSchema>;
/** Core mirrors these preferences after transport acceptance, without a server acknowledgement. */
export const partyPreferencesSchema = z
	.object({
		shareXp: z.boolean(),
		shareLoot: z.boolean(),
		ignoreRequests: z.boolean(),
	})
	.strict();
export type PartyPreferences = z.infer<typeof partyPreferencesSchema>;
/** Explicit requested effects, independent of stale checkbox values. */
export const partyActionSchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("create"), name: z.string().trim().min(1) })
		.strict(),
	...(["invite", "dismiss", "promote"] as const).map((kind) =>
		z.object({ kind: z.literal(kind), target: guid }).strict(),
	),
	z.object({ kind: z.literal("leave") }).strict(),
	z.object({ kind: z.literal("disband") }).strict(),
	z.object({ kind: z.literal("openness"), open: z.boolean() }).strict(),
	...(["shareXp", "shareLoot", "ignoreRequests"] as const).map((kind) =>
		z.object({ kind: z.literal(kind), enabled: z.boolean() }).strict(),
	),
]);
export type PartyAction = z.infer<typeof partyActionSchema>;

/** A missing update ends local presentation, never retries the mutation. */
export const PARTY_UPDATE_WAIT_MS = 5_000;
type PartySession = Pick<
	ClientLifecycleSession,
	"partySnapshot" | "submitParty" | "setPartyUpdateDemand" | "subscribe"
> & {
	state(): Pick<
		ReturnType<ClientLifecycleSession["state"]>,
		"playerGuid" | "playerName" | "lifecycle" | "characterPreferences"
	>;
};
/** Cold management view excluding frame-hot vital payloads. */
export interface PartyView {
	readonly party: {
		readonly name: string;
		readonly leader: number | null;
		readonly shareXp: boolean;
		readonly evenShare: boolean;
		readonly open: boolean;
		readonly locked: boolean;
		readonly capabilities: PartySnapshot["capabilities"];
		readonly members: readonly {
			readonly guid: number;
			readonly name: string;
			readonly level: number;
			readonly canManage: boolean;
		}[];
	} | null;
	readonly preferences: PartyPreferences | null;
	readonly player: number | null;
	readonly suggestedName: string;
	readonly enabled: boolean;
	readonly pending: boolean;
}
/** Local pending intent carries its original character, invocation identity, and deadline timer. */
interface PendingAction {
	readonly action: PartyAction;
	readonly player: number;
	readonly timer: ReturnType<typeof setTimeout>;
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
	#view: PartyView;
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
		this.#view = this.#buildView();
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
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
	read(): PartyView {
		return this.#view;
	}
	#buildView(): PartyView {
		const state = this.#session.state();
		const party = this.#session.partySnapshot();
		const preferences = state.characterPreferences?.party ?? null;
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
							capabilities: party.capabilities,
							members: party.members.map(
								({ guid, name, level, canManage }) => ({
									guid,
									name,
									level,
									canManage,
								}),
							),
						},
			preferences,
			player: state.playerGuid,
			/** Identity-derived suggestion belongs to the creation UI, not the server roster. */
			suggestedName:
				state.playerName === null ? "New Party" : `${state.playerName}'s Party`,
			enabled:
				!this.#disposed &&
				state.playerGuid !== null &&
				state.lifecycle?.kind === "in-world" &&
				this.#pending === null &&
				this.#review === null,
			pending: this.#pending !== null,
		};
	}
	#syncView(forcePublish = false): void {
		const next = this.#buildView();
		if (!forcePublish && equal(this.#view, next)) return;
		this.#view = next;
		this.#publish();
	}
	#publish(): void {
		for (const listener of this.#listeners) listener();
	}
	#receive(event: ClientLifecycleSessionEvent): void {
		const hadReview = this.#review !== null;
		if (event.type === "current-state" || event.type === "resyncing")
			this.#review = null;
		if (event.type === "lifecycle" && event.lifecycle.kind !== "in-world") {
			this.#review = null;
			if (event.lifecycle.kind !== "portal-space") this.#clearPending();
		}
		if (
			event.type === "current-state" ||
			event.type === "resyncing" ||
			event.type === "lifecycle" ||
			event.type === "local-player-established" ||
			event.type === "player-entered" ||
			event.type === "party-updated" ||
			event.type === "character-preferences"
		) {
			this.#reconcile(hadReview && this.#review === null);
		}
	}
	#reconcile(reviewClearedByLifecycle = false): void {
		const state = this.#session.state();
		const party = this.#session.partySnapshot();
		const preferences = state.characterPreferences?.party ?? null;
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
			if (state.playerGuid !== pending.player || observed) this.#clearPending();
		}
		const hadReview = this.#review !== null;
		if (
			this.#review !== null &&
			(state.lifecycle?.kind !== "in-world" ||
				this.#review.player !== state.playerGuid ||
				this.#review.roster !== this.#roster())
		)
			this.#review = null;
		this.#syncView(
			reviewClearedByLifecycle || (hadReview && this.#review === null),
		);
	}
	#clearPending(): void {
		if (this.#pending === null) return;
		clearTimeout(this.#pending.timer);
		this.#pending = null;
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
		this.#syncView(true);
	}
	respond(requestId: string, accepted: boolean): void {
		const review = this.#review;
		if (review === null || review.request.requestId !== requestId) return;
		const state = this.#session.state();
		const valid =
			state.lifecycle?.kind === "in-world" &&
			review.player === state.playerGuid &&
			review.roster === this.#roster();
		this.#clearReview();
		if (valid && accepted) void this.#submit(review.action, null, []);
	}
	request(action: PartyAction): void {
		action = partyActionSchema.parse(action);
		const view = this.#view;
		if (!view.enabled || view.player === null) return;
		if (action.kind === "invite" && !this.canInvite(action.target)) return;
		if (
			action.kind === "openness" &&
			!view.party?.capabilities.canChangeOpenness
		)
			return;
		if (action.kind === "disband" && !view.party?.capabilities.isLeader) return;
		let question: string | null =
			action.kind === "disband" ? "Disband this party for every member?" : null;
		if (action.kind === "dismiss" || action.kind === "promote") {
			const member = view.party?.members.find(
				(member) => member.guid === action.target,
			);
			if (member === undefined || !member.canManage) return;
			if (action.kind === "dismiss")
				question = `Dismiss ${member.name} from the party?`;
		}
		if (question !== null) {
			this.#review = {
				request: {
					requestId: `party-${++this.#sequence}`,
					text: question,
				},
				action,
				player: view.player,
				roster: this.#roster(),
			};
			this.#syncView(true);
		} else if (action.kind === "leave") this.leave(null);
		else void this.#submit(action, null, []);
	}
	/** Shared recruitment permission plus frontend availability and target identity. */
	canInvite(target: number): boolean {
		const view = this.#view;
		return (
			view.enabled &&
			view.party !== null &&
			target !== view.player &&
			view.party.capabilities.canRecruit &&
			!view.party.members.some((member) => member.guid === target)
		);
	}
	/** Leave directly, requiring a current roster member for a multi-member leader handoff. */
	leave(successor: number | null): void {
		const view = this.#view;
		if (!view.enabled || view.party === null) return;
		const needsHandoff =
			view.party.capabilities.isLeader && view.party.members.length > 1;
		if (
			needsHandoff &&
			(successor === null ||
				successor === view.player ||
				!view.party.members.some((member) => member.guid === successor))
		)
			return;
		void this.#submit({ kind: "leave" }, needsHandoff ? successor : null, []);
	}

	/** Queue changed creation preferences before create; server samples loot from character options.
	 * Queue ordering is sufficient here; this does not promise atomic server acceptance.
	 */
	create(
		name: string,
		settings: Pick<PartyPreferences, "shareXp" | "shareLoot">,
	): void {
		const view = this.#view;
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
		this.#clearPending();
		const pending: PendingAction = {
			action,
			player,
			timer: setTimeout(() => {
				if (this.#disposed || this.#pending !== pending) return;
				this.#clearPending();
				this.#syncView();
				this.#failure(
					"No party update arrived. Showing the latest known state.",
				);
			}, PARTY_UPDATE_WAIT_MS),
		};
		this.#pending = pending;
		this.#syncView();
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
				this.#clearPending();
				this.#syncView();
				// Queue acceptance confirms submission, not the recipient's acceptance or eligibility.
				this.#notice("Party invitation sent.");
			}
		} catch (error) {
			if (!this.#disposed && this.#pending === pending) {
				this.#clearPending();
				this.#syncView();
				this.#failure(String(error));
			}
		}
	}
	setVisible(visible: boolean): void {
		if (this.#visible === visible) return;
		this.#visible = visible;
		if (!visible) this.#clearReview();
		this.#session.setPartyUpdateDemand("management", visible);
	}

	destroy(): void {
		this.setVisible(false);
		this.#disposed = true;
		this.#clearPending();
		this.#review = null;
		this.#syncView(true);
		this.#unsubscribe();
		this.#listeners.clear();
	}
}
