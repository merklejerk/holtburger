import type {
	EscapeContextHandle,
	KeyboardInputPolicy,
} from "../lib/input/keyboard-input-policy";
import type { AppInput } from "../lib/input/app-input";
import type {
	ClientCycleSelectionController,
	CycleCategory,
	CycleSubset,
} from "./client-cycle-selection-controller";
import type { ClientEntitySelection } from "./client-entity-selection";

/** One acquisition press; release and hold completion are mutually exclusive. */
interface PendingSelectionPress {
	/** Physical key identity captured before modifiers can change. */
	readonly key: string;
	/** Category and direction captured for the short-press action. */
	readonly category: CycleCategory;
	readonly subset: CycleSubset;
	readonly direction: 1 | -1;
	/** Timer is cancelled when release or interruption consumes this press. */
	readonly timer: ReturnType<typeof setTimeout>;
	/** Monotonic start used when release beats an overdue timer callback. */
	readonly startedAtMs: number;
}

/** Gameplay input lifetime, invoked after focused UI and contextual cancellation have first refusal. */
export class ClientSelectionInput {
	readonly #input: AppInput;
	readonly #selection: ClientEntitySelection;
	readonly #cycle: ClientCycleSelectionController;
	readonly #holdDelayMs: number;
	/** Release acquisition listeners and the selection cancellation context together. */
	readonly #unsubscribe: () => void;
	#press: PendingSelectionPress | null = null;
	#destroyed = false;

	constructor(options: {
		readonly input: AppInput;
		/** App-local Escape ordering shared with windows and other interactions. */
		readonly keyboard: KeyboardInputPolicy;
		readonly selection: ClientEntitySelection;
		readonly cycle: ClientCycleSelectionController;
		/** Duration before a held cycle binding acquires its nearest target. */
		readonly holdDelayMs: number;
	}) {
		this.#input = options.input;
		this.#selection = options.selection;
		this.#cycle = options.cycle;
		this.#holdDelayMs = options.holdDelayMs;
		const unsubscribeIntent = options.selection.subscribeExternalIntent(() =>
			this.cancel(),
		);
		let context: EscapeContextHandle | null = null;
		const updateContext = (guid: number | null): void => {
			context?.release();
			context =
				guid === null
					? null
					: options.keyboard.bindEscapeContext(() => {
							this.cancel();
							this.#selection.select(null);
						});
		};
		updateContext(options.selection.selectedGuid());
		const unsubscribeSelection = options.selection.subscribe(updateContext);
		this.#unsubscribe = () => {
			unsubscribeIntent();
			unsubscribeSelection();
			context?.release();
		};
	}

	keydown(event: KeyboardEvent, nowMs: number): boolean {
		if (this.#destroyed) return false;
		if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) this.cancel();
		if (event.defaultPrevented || event.isComposing) return false;
		const action = (
			[
				"selectSelf",
				"nextCreature",
				"previousCreature",
				"nextNonCreature",
				"previousNonCreature",
				"nextUnopenedCorpse",
				"previousUnopenedCorpse",
				"cancel",
			] as const
		).find((action) => this.#input.shortcut(action, event));
		if (action === undefined) return false;
		// An empty selection must leave the fallback Escape action reachable.
		if (
			action === "cancel" &&
			this.#selection.selectedGuid() === null &&
			this.#press === null
		)
			return false;
		event.preventDefault();
		if (event.repeat) return true;
		this.cancel();
		switch (action) {
			case "selectSelf":
				this.#selection.selectSelf();
				break;
			case "cancel":
				this.#selection.select(null);
				break;
			case "nextCreature":
				this.#beginPress(event, "creature", 1, nowMs);
				break;
			case "previousCreature":
				this.#beginPress(event, "creature", -1, nowMs);
				break;
			case "nextNonCreature":
				this.#beginPress(event, "non-creature", 1, nowMs);
				break;
			case "previousNonCreature":
				this.#beginPress(event, "non-creature", -1, nowMs);
				break;
			case "nextUnopenedCorpse":
				this.#beginPress(event, "non-creature", 1, nowMs, "unopened-corpse");
				break;
			case "previousUnopenedCorpse":
				this.#beginPress(event, "non-creature", -1, nowMs, "unopened-corpse");
				break;
		}
		return true;
	}

	keyup(event: KeyboardEvent, nowMs: number): void {
		const pending = this.#press;
		if (pending !== null && pending.key === (event.code || event.key)) {
			this.cancel();
			event.preventDefault();
			if (event.isComposing) return;
			// Event-loop delays must not turn a completed hold into a short press.
			if (nowMs - pending.startedAtMs >= this.#holdDelayMs)
				this.#cycle.selectNearest(pending.category, pending.subset);
			else
				this.#cycle.cycle(
					pending.category,
					pending.direction,
					nowMs,
					pending.subset,
				);
		} else if (["Shift", "Control", "Alt", "Meta"].includes(event.key))
			this.cancel();
	}

	/** Focus/context loss and newer external acquisition retire delayed work immediately. */
	cancel(): void {
		if (this.#press === null) return;
		clearTimeout(this.#press.timer);
		this.#press = null;
	}

	destroy(): void {
		this.#destroyed = true;
		this.cancel();
		this.#unsubscribe();
	}

	#beginPress(
		event: KeyboardEvent,
		category: CycleCategory,
		direction: 1 | -1,
		nowMs: number,
		subset: CycleSubset = "all",
	): void {
		// Express intent now, without changing selection or advancing the cycle before release.
		this.#selection.beginAcquisition("cycle");
		const pending: PendingSelectionPress = {
			key: event.code || event.key,
			category,
			subset,
			direction,
			startedAtMs: nowMs,
			timer: setTimeout(() => {
				if (this.#press !== pending) return;
				this.#press = null;
				this.#cycle.selectNearest(category, subset);
			}, this.#holdDelayMs),
		};
		this.#press = pending;
	}
}
