import type {
	ClientChatMessage,
	ClientChatRequest,
	ClientChatTellTarget,
} from "./client-host-contract";
import type { ChatSelection, ChatSendDestination } from "./client-chat-compose";

/** Character-session chat choices survive editor remounts but never cross character sessions. */
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

	/** A successful return acknowledges enqueue only. Stale completions cannot mutate a new session. */
	async send(
		request: ClientChatRequest,
		enqueue: (request: ClientChatRequest) => Promise<void>,
	): Promise<void> {
		const generation = this.generation;
		await enqueue(request);
		if (this.generation === generation && request.kind === "tell")
			this.retell = request.target;
	}
}
