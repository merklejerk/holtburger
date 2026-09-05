import type {
	InputBindings,
	InputKeyEvent,
	KeyBinding,
} from "./input-contract";

/** Resolves a key without retaining state, for UI shortcuts and pointer modifiers. */
export function matchesKey(
	event: InputKeyEvent,
	bindings: readonly KeyBinding[],
): boolean {
	return bindings.some(
		(binding) =>
			binding.key.toLowerCase() === event.key.toLowerCase() &&
			(binding.shift === undefined || binding.shift === event.shiftKey),
	);
}

/** Owns physical-key lifetimes for one active context and emits semantic action edges. */
export class InputContext<Action extends string> {
	readonly #held = new Map<string, Action>();
	constructor(
		private readonly bindings: InputBindings<Action>,
		private readonly onAction: (action: Action, pressed: boolean) => void,
	) {
		const actions = Object.keys(bindings) as Action[];
		for (const [index, action] of actions.entries()) {
			for (const other of actions.slice(index + 1)) {
				if (
					bindings[action].some((binding) =>
						bindings[other].some(
							(candidate) =>
								binding.key.toLowerCase() === candidate.key.toLowerCase() &&
								(binding.shift === undefined ||
									candidate.shift === undefined ||
									binding.shift === candidate.shift),
						),
					)
				)
					throw new Error(`Input bindings overlap for ${action} and ${other}.`);
			}
		}
	}

	/** Releases use the original press mapping, even after modifiers change. */
	apply(event: InputKeyEvent, pressed: boolean): boolean {
		const physical = event.code || event.key.toLowerCase();
		const held = this.#held.get(physical);
		if (!pressed) {
			if (held === undefined) return false;
			this.#held.delete(physical);
			if (![...this.#held.values()].includes(held)) this.onAction(held, false);
			return true;
		}
		if (held !== undefined) return true;
		const action = (Object.keys(this.bindings) as Action[]).find((candidate) =>
			matchesKey(event, this.bindings[candidate]),
		);
		if (action === undefined) return false;
		// A repeat after focus/context loss must not resurrect an outgoing press.
		if (event.repeat) return true;
		const alreadyHeld = [...this.#held.values()].includes(action);
		this.#held.set(physical, action);
		if (!alreadyHeld) this.onAction(action, true);
		return true;
	}

	/** Drop presses without release edges: cancellation must never release a charged jump. */
	reset(): void {
		this.#held.clear();
	}

	/** Pointer events can observe a modifier pressed before the viewport acquired focus. */
	modifierActive(
		action: Action,
		event: Pick<MouseEvent, "getModifierState" | "shiftKey">,
	): boolean {
		return ["Shift", "Control", "Alt", "Meta"].some(
			(key) =>
				event.getModifierState(key) &&
				matchesKey({ key, shiftKey: event.shiftKey }, this.bindings[action]),
		);
	}
}
