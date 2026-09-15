import { bindingAction } from "./client-action-item";
import type { ClientEntitySelection } from "./client-entity-selection";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";
import type {
	ClientItemUseRequest,
	ClientItemUseResult,
} from "./client-item-use-contract";

/** Frontend-local question; its identity never crosses the host boundary. */
interface ItemUseQuestion {
	readonly id: string;
	readonly text: string;
}
/** Cold state consumed by Notifications guidance and the local confirmation dialog. */
export type ItemInteractionState =
	| { readonly kind: "idle" }
	| {
			readonly kind: "acquiring";
			readonly source: number;
			/** Source ownership captured for lifecycle invalidation. */
			readonly sourceOwned: boolean;
			readonly name: string;
			readonly generation: number;
			/** Only target transitions and authority replies update the cold cursor cue. */
			readonly considered: {
				readonly target: number;
				readonly sequence: number;
				readonly eligibility: "pending" | "eligible" | "ineligible";
			} | null;
	  }
	| {
			/** Await compatibility before choosing automatic use or explicit acquisition. */
			readonly kind: "resolving";
			readonly source: number;
			readonly sourceOwned: boolean;
			readonly target: number;
			readonly sequence: number;
	  }
	| {
			readonly kind: "submitting";
			readonly request: ClientItemUseRequest;
			readonly resume: Acquisition | null;
	  }
	| {
			readonly kind: "confirming";
			readonly request: ClientItemUseRequest;
			readonly question: ItemUseQuestion;
	  };
type Acquisition = Extract<ItemInteractionState, { kind: "acquiring" }>;
type Session = Pick<
	ClientLifecycleSession,
	| "entities"
	| "state"
	| "subscribe"
	| "submitItemUse"
	| "queryItemUseTarget"
	| "equipItem"
	| "submitInventory"
>;

// Identities survive controller replacement so late host results cannot match a new owner.
let nextOperation = 0;
function allocateOperation(): number {
	if (nextOperation === 0xffff_ffff)
		throw new Error("Item interaction identity space exhausted.");
	return ++nextOperation;
}

/** One frontend use flow. Rust evaluates consequences; this owner decides whether to ask. */
export class ClientItemInteractions {
	readonly #session: Session;
	readonly #selection: Pick<
		ClientEntitySelection,
		"selectedGuid" | "previousGuid"
	>;
	readonly #failure: (message: string) => void;
	readonly #notice: (message: string) => void;
	readonly #beginAcquisition: () => void;
	readonly #unsubscribe: () => void;
	readonly #listeners = new Set<(state: ItemInteractionState) => void>();
	#state: ItemInteractionState = { kind: "idle" };
	#destroyed = false;

	constructor(options: {
		readonly session: Session;
		readonly selection: Pick<
			ClientEntitySelection,
			"selectedGuid" | "previousGuid"
		>;
		readonly reportFailure: (message: string) => void;
		/** Ordinary local gameplay refusal, without warning severity. */
		readonly reportNotice: (message: string) => void;
		/** Retire mutually exclusive frontend modes before acquisition begins. */
		readonly beginAcquisition: () => void;
	}) {
		this.#session = options.session;
		this.#selection = options.selection;
		this.#failure = options.reportFailure;
		this.#notice = options.reportNotice;
		this.#beginAcquisition = options.beginAcquisition;
		this.#unsubscribe = options.session.subscribe((event) =>
			this.#receive(event),
		);
	}

	snapshot(): ItemInteractionState {
		return this.#state;
	}
	subscribe(listener: (state: ItemInteractionState) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Interact uses selection as a target only while already acquiring. */
	interactSelected(unrestricted: boolean): void {
		const selected = this.#selection.selectedGuid();
		if (selected === null) {
			this.#failure("No target selected.");
			return;
		}
		if (this.#state.kind === "acquiring")
			this.target(selected, this.#state.generation);
		else {
			const item = this.#item(selected);
			if (item === null) return;
			if (item.canPickUp) {
				this.cancel();
				void this.#session
					.submitInventory({ item: selected, target: { kind: "pickup" } })
					.catch((error: unknown) => this.#failure(String(error)));
			} else this.use(selected, unrestricted);
		}
	}

	/** Give uses the current item and exactly one previous recipient; selection is unchanged. */
	giveSelected(): void {
		if (this.#destroyed) return;
		const source = this.#selection.selectedGuid();
		const recipient = this.#selection.previousGuid();
		this.cancel();
		const read = this.#session.entities.read();
		if (
			read.kind === "pending" ||
			this.#session.state().lifecycle?.kind !== "in-world"
		) {
			this.#notice("Giving requires current world information.");
			return;
		}
		if (source === null || recipient === null) {
			this.#notice("Select a recipient, then select the item to give.");
			return;
		}
		if (!read.level.entities.get(source)?.ownedByPlayer) {
			this.#notice("Select an item you are carrying or wearing to give.");
			return;
		}
		if (!read.level.entities.get(recipient)?.canReceiveGive) {
			this.#notice("The previous selection cannot receive an item.");
			return;
		}
		void this.#session
			.submitInventory({
				item: source,
				target: { kind: "give", guid: recipient },
			})
			.catch((error: unknown) => this.#failure(String(error)));
	}

	/** Inventory supplies its clicked identity, independent of selection toggles. */
	use(source: number, unrestricted: boolean): void {
		this.cancel();
		const item = this.#item(source);
		if (item === null) return;
		const capability = item.description.useCapability;
		if (capability === "targeted") {
			this.#beginAcquisition();
			this.#set({
				kind: "acquiring",
				source,
				name: item.description.name,
				sourceOwned: item.ownedByPlayer,
				generation: allocateOperation(),
				considered: null,
			});
		} else if (
			capability === "direct" ||
			(capability === "unsupported" && unrestricted)
		) {
			this.#submit({ kind: "direct", source, unrestricted }, null);
		} else this.#failure("This item cannot currently be used.");
	}

	/** Bars try self/selection when compatible, otherwise enter ordinary target acquisition. */
	activate(
		source: number,
		kind: "equipment" | "direct" | "targeted",
		alternate: boolean,
	): void {
		this.cancel();
		const item = this.#item(source);
		if (item === null) return;
		if (bindingAction(item)?.kind !== kind) {
			this.#failure("Bound action is unavailable.");
			return;
		}
		if (kind === "equipment") {
			void this.#session
				.equipItem(source, alternate)
				.catch((error: unknown) => this.#failure(String(error)));
			return;
		}
		if (kind === "direct")
			this.#submit({ kind: "direct", source, unrestricted: false }, null);
		else {
			const read = this.#session.entities.read();
			const target = alternate
				? this.#selection.selectedGuid()
				: read.kind === "current"
					? read.level.playerGuid
					: null;
			if (target === null) {
				this.use(source, false);
				return;
			}
			const state: ItemInteractionState = {
				kind: "resolving",
				source,
				sourceOwned: item.ownedByPlayer,
				target,
				sequence: allocateOperation(),
			};
			this.#set(state);
			// Validating the player also checks the source's creature target mask in world.
			void this.#session
				.queryItemUseTarget({ sequence: state.sequence, source, target })
				.catch((error: unknown) => {
					if (this.#state !== state) return;
					this.use(source, false);
					this.#failure(String(error));
				});
		}
	}

	/** Hover checks never submit a use action or open a confirmation. */
	consider(candidate: number | "self" | null): void {
		const read = this.#session.entities.read();
		const target =
			candidate === "self"
				? read.kind === "current"
					? read.level.playerGuid
					: null
				: candidate;
		const state = this.#state;
		if (
			state.kind !== "acquiring" ||
			(state.considered?.target ?? null) === target
		)
			return;
		if (target === null) this.#set({ ...state, considered: null });
		else this.#queryTarget(state, target);
	}

	#queryTarget(state: Acquisition, target: number): void {
		const sequence = allocateOperation();
		this.#set({
			...state,
			considered: { target, sequence, eligibility: "pending" },
		});
		void this.#session
			.queryItemUseTarget({ sequence, source: state.source, target })
			.catch((error: unknown) => {
				const current = this.#state;
				if (
					current.kind !== "acquiring" ||
					current.considered?.sequence !== sequence
				)
					return;
				this.#set({ ...current, considered: null });
				this.#failure(String(error));
			});
	}

	/** Explicit player HUD target, independent of rendered player mesh picking. */
	targetSelf(): void {
		const state = this.#state;
		const read = this.#session.entities.read();
		if (state.kind === "acquiring" && read.kind === "current")
			this.target(read.level.playerGuid, state.generation);
	}

	/** A stale pick cannot target a replacement operation. True consumes this target click. */
	target(target: number | null, generation: number): boolean {
		const state = this.#state;
		if (state.kind !== "acquiring" || state.generation !== generation)
			return false;
		if (target !== null)
			this.#submit(
				{ kind: "targeted", source: state.source, target },
				{ ...state, generation: allocateOperation(), considered: null },
			);
		return true;
	}

	/** Accept submits the displayed operation, never the current selection. */
	respond(id: string, accepted: boolean): void {
		const state = this.#state;
		if (state.kind !== "confirming" || state.question.id !== id) return;
		if (!accepted) {
			this.cancel();
			return;
		}
		this.#send({ ...state.request, sequence: allocateOperation() }, null);
	}

	/** Keyboard ownership changes retire targeting, including retries, without losing dispatched results. */
	cancelTargeting(): void {
		if (this.#state.kind === "acquiring" || this.#state.kind === "resolving")
			this.cancel();
		else if (this.#state.kind === "submitting" && this.#state.resume !== null)
			this.#set({ ...this.#state, resume: null });
	}

	cancel(): boolean {
		if (this.#state.kind === "idle") return false;
		this.#set({ kind: "idle" });
		return true;
	}
	destroy(): void {
		this.cancel();
		this.#destroyed = true;
		this.#unsubscribe();
		this.#listeners.clear();
	}

	#item(source: number) {
		if (this.#destroyed || this.#session.state().lifecycle?.kind !== "in-world")
			return null;
		const read = this.#session.entities.read();
		const item =
			read.kind === "current" ? read.level.entities.get(source) : undefined;
		if (item === undefined || item.description.kind !== "known") {
			this.#failure("Item is unavailable.");
			return null;
		}
		return { ...item, description: item.description };
	}

	#submit(
		intent: ClientItemUseRequest["intent"],
		resume: Acquisition | null,
	): void {
		const read = this.#session.entities.read();
		if (read.kind !== "current" || read.level.playerGuid === null) {
			this.#failure("Player is unavailable.");
			return;
		}
		const source = read.level.entities.get(intent.source);
		if (source === undefined) {
			this.#failure("Item is unavailable.");
			return;
		}
		this.#send(
			{
				sequence: allocateOperation(),
				player: read.level.playerGuid,
				sourceOwned: source.ownedByPlayer,
				intent,
				expected: { kind: "ordinary" },
			},
			resume,
		);
	}
	#send(request: ClientItemUseRequest, resume: Acquisition | null): void {
		const state: ItemInteractionState = { kind: "submitting", request, resume };
		this.#set(state);
		void this.#session.submitItemUse(request).catch((error: unknown) => {
			const current = this.#state;
			if (
				current.kind !== "submitting" ||
				current.request.sequence !== request.sequence
			)
				return;
			this.#set(current.resume ?? { kind: "idle" });
			this.#failure(String(error));
		});
	}

	#result(result: ClientItemUseResult): void {
		const state = this.#state;
		if (
			state.kind !== "submitting" ||
			state.request.sequence !== result.sequence
		)
			return;
		const outcome = result.outcome;
		if (outcome.kind === "executed") this.cancel();
		else if (outcome.kind === "rejected") {
			this.#set(state.resume ?? { kind: "idle" });
			this.#failure(outcome.reason);
		} else if (outcome.evaluation.kind === "destroy-item") {
			const { target, amount, name } = outcome.evaluation;
			this.#set({
				kind: "confirming",
				request: {
					...state.request,
					expected: { kind: "destroy-item", target, amount },
				},
				question: {
					id: "item-use-" + allocateOperation(),
					text:
						"Using this mana stone will destroy " +
						amount +
						" × " +
						name +
						". Continue?",
				},
			});
		} else {
			// Changed semantics retire approval; do not retry a different operation automatically.
			this.cancel();
			this.#failure("The item's use has changed. Trigger it again.");
		}
	}
	#receive(event: ClientLifecycleSessionEvent): void {
		if (event.type === "item-use-target-result") {
			const state = this.#state;
			if (
				state.kind === "resolving" &&
				state.sequence === event.result.sequence
			) {
				if (event.result.eligible)
					this.#submit(
						{ kind: "targeted", source: state.source, target: state.target },
						null,
					);
				else this.use(state.source, false);
				return;
			}
			if (
				state.kind === "acquiring" &&
				state.considered?.sequence === event.result.sequence
			)
				this.#set({
					...state,
					considered: {
						...state.considered,
						eligibility: event.result.eligible ? "eligible" : "ineligible",
					},
				});
			return;
		}
		if (event.type === "item-use-result") {
			this.#result(event.result);
			return;
		}
		if (
			event.type === "resyncing" ||
			event.type === "current-state" ||
			(event.type === "lifecycle" && event.lifecycle.kind !== "in-world") ||
			(event.type === "confirmation" && event.confirmation !== null)
		) {
			this.cancel();
			return;
		}
		if (event.type === "entities" && this.#state.kind !== "idle") {
			const source =
				this.#state.kind === "acquiring" || this.#state.kind === "resolving"
					? this.#state.source
					: this.#state.request.intent.source;
			const read = this.#session.entities.read();
			const item =
				read.kind === "current" ? read.level.entities.get(source) : undefined;
			if (
				item === undefined ||
				(this.#state.kind === "acquiring" || this.#state.kind === "resolving"
					? this.#state.sourceOwned !== item.ownedByPlayer
					: this.#state.request.sourceOwned !== item.ownedByPlayer)
			)
				this.cancel();
			else if (
				this.#state.kind === "acquiring" &&
				this.#state.considered !== null
			)
				this.#queryTarget(this.#state, this.#state.considered.target);
		}
	}
	#set(state: ItemInteractionState): void {
		this.#state = state;
		for (const listener of this.#listeners) listener(state);
	}
}
