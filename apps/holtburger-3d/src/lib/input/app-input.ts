import { INPUT_DEFAULTS } from "./input-defaults";
import { InputContext, matchesKey } from "./input-context";
import type {
	CharacterAction,
	FlyAction,
	InputConfiguration,
	InputKeyEvent,
} from "./input-contract";

/** Shared configuration and input resolution; each mounted owner retains its own context lifetime. */
export class AppInput {
	constructor(private readonly configuration: InputConfiguration) {}

	/** Create an independently owned character context using the shared character map. */
	characterContext(
		onAction: (action: CharacterAction, pressed: boolean) => void,
	): InputContext<CharacterAction> {
		return new InputContext(this.configuration.character, onAction);
	}

	/** Create an Explorer camera context using the configured fly map. */
	flyContext(
		onAction: (action: FlyAction, pressed: boolean) => void,
	): InputContext<FlyAction> {
		return new InputContext(this.configuration.fly, onAction);
	}

	/** UI owners decide whether their shortcut context is active before resolving an event. */
	shortcut(
		action: keyof InputConfiguration["client"],
		event: InputKeyEvent,
	): boolean {
		return matchesKey(event, this.configuration.client[action]);
	}

	/** Resolve gesture activation without imposing click/drag interpretation on the viewport. */
	pointer(
		action: keyof InputConfiguration["pointer"],
		event: Pick<PointerEvent, "button">,
	): boolean {
		return this.configuration.pointer[action].includes(event.button);
	}
}

/** One configuration entry point for both app modes; no storage or settings UI policy lives here. */
export const APP_INPUT = new AppInput(INPUT_DEFAULTS);

/** Editable controls retain native keyboard behavior instead of initiating viewport actions. */
export function isEditingInput(target: EventTarget | null): boolean {
	return (
		target instanceof Element &&
		target.closest(
			"input, textarea, select, [contenteditable]:not([contenteditable='false'])",
		) !== null
	);
}
