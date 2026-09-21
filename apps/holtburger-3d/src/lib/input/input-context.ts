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
			(binding.key !== undefined
				? binding.key.toLowerCase() === event.key.toLowerCase()
				: binding.code === event.code) &&
			(binding.shift === undefined || binding.shift === event.shiftKey) &&
			(binding.ctrl === undefined || binding.ctrl === Boolean(event.ctrlKey)) &&
			(binding.alt === undefined || binding.alt === Boolean(event.altKey)) &&
			(binding.meta === undefined || binding.meta === Boolean(event.metaKey)),
	);
}

/** Only identical key or code bindings prove a configuration-time conflict; mixed identities depend on layout. */
function bindingIdentitiesOverlap(a: KeyBinding, b: KeyBinding): boolean {
	if (a.key !== undefined && b.key !== undefined)
		return a.key.toLowerCase() === b.key.toLowerCase();
	if (a.code !== undefined && b.code !== undefined) return a.code === b.code;
	return false;
}

/** Static overlap proof for matching selector identities and compatible modifier constraints. */
export function keyBindingsOverlap(a: KeyBinding, b: KeyBinding): boolean {
	return (
		bindingIdentitiesOverlap(a, b) &&
		(["shift", "ctrl", "alt", "meta"] as const).every(
			(modifier) =>
				a[modifier] === undefined ||
				b[modifier] === undefined ||
				a[modifier] === b[modifier],
		)
	);
}

/** Owns physical-key lifetimes for one active context and emits semantic action edges. */
export class InputContext<Action extends string> {
	readonly #held = new Map<string, Action>();
	constructor(
		private bindings: InputBindings<Action>,
		private readonly onAction: (action: Action, pressed: boolean) => void,
	) {
		this.#validateBindings(bindings);
	}

	/** Replace accepted bindings without emitting release edges for held actions. */
	replaceBindings(bindings: InputBindings<Action>): void {
		this.#validateBindings(bindings);
		this.reset();
		this.bindings = bindings;
	}

	#validateBindings(bindings: InputBindings<Action>): void {
		const actions = Object.keys(bindings) as Action[];
		for (const [index, action] of actions.entries()) {
			for (const other of actions.slice(index + 1)) {
				if (
					bindings[action].some((binding) =>
						bindings[other].some((candidate) =>
							keyBindingsOverlap(binding, candidate),
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
		const matches = (Object.keys(this.bindings) as Action[]).filter(
			(candidate) => matchesKey(event, this.bindings[candidate]),
		);
		// A real event supplies the layout relationship that mixed key/code bindings cannot prove statically.
		if (matches.length > 1)
			throw new Error(
				`Input event matches multiple actions: ${matches.join(", ")}.`,
			);
		const action = matches[0];
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
