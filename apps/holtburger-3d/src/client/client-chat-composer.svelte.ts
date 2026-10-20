import type {
	ClientChatMessage,
	ClientChatRequest,
	ClientChatTellTarget,
} from "./client-host-contract";
import type { ChatSelection, ChatSendDestination } from "./client-chat-compose";

import { clientChatRequestSchema } from "./client-host-contract";
import type { ClientSoulEmotes } from "./client-soul-emotes";
import { CLIENT_TUNING } from "./client-tuning";

/** Partial queueing must not leave a draft that silently replays completed actions. */
export class ChatSubmissionError extends Error {
	constructor(
		readonly queued: number,
		total: number,
		cause: unknown,
	) {
		super(
			`${queued > 0 ? `Queued ${queued} of ${total} actions. ` : ""}${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		);
	}
}

/** Session chat choices and user-scoped emote history survive editor remounts. */
export class ClientChatComposer {
	/** Monotonic counter is imperative so reset does not subscribe resource-owning effects. */
	#nextGeneration = 0;
	/** Complete destination selected by the picker, independent of per-message overrides. */
	destination = $state<ChatSendDestination>({ kind: "speech" });
	/** Last structured incoming tell address, including identifiable NPC speakers. */
	reply = $state<ClientChatTellTarget | null>(null);
	/** Last locally enqueued outgoing tell, independent of server acceptance. */
	retell = $state<ClientChatTellTarget | null>(null);
	/** Selected recipient preview, updated only when addressability or identity changes. */
	selection = $state<ChatSelection>({ kind: "none" });
	/** Cold membership fact from the session; solo parties are still valid chat destinations. */
	inParty = $state(false);
	/** Editor reset and asynchronous completion identity; portals do not increment this. */
	generation = $state(0);
	/** Static vocabulary shared by editor and wheel; loaded once per app mount. */
	#emotes = $state<ClientSoulEmotes | null>(null);
	/** User-scoped queue-acknowledged pose identities, pruned when content loads. */
	#recentEmotes = $state<readonly string[]>([]);
	/** Settings publication is injected; the composer owns no storage or save timing. */
	readonly #onRecentEmotesChange: (ids: readonly string[]) => void;

	constructor(options: {
		/** Saved user history, independent of character/server identity. */
		readonly recentEmotes: readonly string[];
		/** Publish changed history through the frontend's existing settings owner. */
		readonly onRecentEmotesChange: (ids: readonly string[]) => void;
	}) {
		this.#recentEmotes = options.recentEmotes;
		this.#onRecentEmotesChange = options.onRecentEmotesChange;
	}

	get emotes(): ClientSoulEmotes | null {
		return this.#emotes;
	}

	get recentEmotes(): readonly string[] {
		return this.#recentEmotes;
	}

	/** Content owns valid identities; keep order while retiring stale and duplicate saved entries. */
	setEmotes(catalog: ClientSoulEmotes): void {
		this.#emotes = catalog;
		this.#changeRecentEmotes(
			[...new Set(this.#recentEmotes)].filter(
				(id) => catalog.pose(id) !== undefined,
			),
		);
	}

	#changeRecentEmotes(ids: readonly string[]): void {
		const next = ids.slice(0, CLIENT_TUNING.emotes.recentLimit);
		if (
			next.length === this.#recentEmotes.length &&
			next.every((id, index) => id === this.#recentEmotes[index])
		)
			return;
		this.#recentEmotes = next;
		this.#onRecentEmotesChange(next);
	}

	reset(): void {
		this.generation = ++this.#nextGeneration;
		this.destination = { kind: "speech" };
		this.reply = null;
		this.retell = null;
		this.selection = { kind: "none" };
		this.inParty = false;
	}

	accept(message: ClientChatMessage): void {
		if (message.kind === "tell" && message.target !== null) {
			// RETAIL DIVERGENCE: acclient.c:395542-395545 remembers only player tellers.
			// NPC replies use the same TalkDirect packet as selected-NPC Tell; content sees
			// no new operation. Restoring the player-only gate would block /r dialogue.
			// Local ace_world census: 10 templates have ReceiveTalkDirect emotes, including 5 professors.
			this.reply = message.target;
		}
	}

	setSelection(selection: ChatSelection): void {
		const previous = this.selection;
		if (previous.kind === selection.kind) {
			if (previous.kind !== "target" || selection.kind !== "target") return;
			const a = previous.target,
				b = selection.target;
			if (
				a.kind === b.kind &&
				a.name === b.name &&
				(a.kind !== "npc" || (b.kind === "npc" && a.guid === b.guid))
			)
				return;
		}
		this.selection = selection;
	}

	/** Validate before side effects; successful returns acknowledge enqueue, never server acceptance. */
	async sendAll(
		requests: readonly [ClientChatRequest, ...ClientChatRequest[]],
		enqueue: (request: ClientChatRequest) => Promise<void>,
	): Promise<void> {
		const generation = this.generation;
		const resolved = requests.map((request) => {
			clientChatRequestSchema.parse(request);
			if (request.kind !== "soul-emote") return { request, emote: null };
			const emote = this.emotes?.resolve(request.token);
			if (emote === undefined)
				throw new Error(`Unknown soul emote: ${request.token}`);
			return { request, emote };
		});
		let queued = 0;
		try {
			for (const { request, emote } of resolved) {
				if (this.generation !== generation)
					throw new Error("Chat session changed before dispatch.");
				await enqueue(request);
				queued++;
				if (this.generation !== generation)
					throw new Error("Chat session changed during dispatch.");
				if (request.kind === "tell") this.retell = request.target;
				if (emote !== null)
					this.#changeRecentEmotes([
						emote.id,
						...this.#recentEmotes.filter((id) => id !== emote.id),
					]);
			}
		} catch (cause) {
			throw new ChatSubmissionError(queued, requests.length, cause);
		}
	}
}
