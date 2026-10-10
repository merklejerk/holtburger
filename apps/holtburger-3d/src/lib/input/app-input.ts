import { readClientBinding } from "./client-keyboard-bindings";
import {
	COMBAT_BREAKPOINT_INDICES,
	COMBAT_HEIGHT_INDICES,
} from "./input-contract";
import { INPUT_DEFAULTS } from "./input-defaults";
import { InputContext, matchesKey } from "./input-context";
import type {
	ActionBarDirection,
	CombatBreakpointIndex,
	CombatHeightIndex,
	InputDigitIndex,
	CharacterAction,
	FlyAction,
	InputConfiguration,
	InputKeyEvent,
} from "./input-contract";

/** Shared configuration and input resolution; each mounted owner retains its own context lifetime. */
export class AppInput {
	constructor(private configuration: InputConfiguration) {}

	/** Replace resolved policy after its owner cancels held input and validates the snapshot. */
	replaceConfiguration(configuration: InputConfiguration): void {
		this.configuration = configuration;
	}

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
		return matchesKey(
			event,
			readClientBinding(this.configuration, { kind: "client", action }),
		);
	}

	/** Resolve spell intent only after keyboard ownership admits game input. */
	spellBarCommand(
		event: InputKeyEvent,
	):
		| { readonly kind: "tabs" | "cells"; readonly index: InputDigitIndex }
		| { readonly kind: "caster" }
		| null {
		if (
			matchesKey(
				event,
				readClientBinding(this.configuration, { kind: "spellCaster" }),
			)
		)
			return { kind: "caster" };
		const indices: readonly InputDigitIndex[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		for (const kind of ["tabs", "cells"] as const) {
			const index = indices.find((index) =>
				matchesKey(
					event,
					readClientBinding(this.configuration, {
						kind: kind === "tabs" ? "spellTab" : "spellCell",
						index,
					}),
				),
			);
			if (index !== undefined) return { kind, index };
		}
		return null;
	}

	/** Resolve the five physical-combat breakpoint keys after gameplay gains keyboard ownership. */
	combatBreakpoint(event: InputKeyEvent): CombatBreakpointIndex | null {
		const indices = COMBAT_BREAKPOINT_INDICES;
		return (
			indices.find((index) =>
				matchesKey(
					event,
					readClientBinding(this.configuration, {
						kind: "combatBreakpoint",
						index,
					}),
				),
			) ?? null
		);
	}

	/** Resolve the three top-to-bottom physical attack-height keys. */
	combatHeight(event: InputKeyEvent): CombatHeightIndex | null {
		const indices = COMBAT_HEIGHT_INDICES;
		return (
			indices.find((index) =>
				matchesKey(
					event,
					readClientBinding(this.configuration, {
						kind: "combatHeight",
						index,
					}),
				),
			) ?? null
		);
	}

	/** Resolve a numbered bar's focus chord using the shared installation configuration. */
	actionBarFocus(index: InputDigitIndex, event: InputKeyEvent): boolean {
		return matchesKey(
			event,
			readClientBinding(this.configuration, { kind: "actionBarFocus", index }),
		);
	}
	/** Resolve direct activation of a cell within the currently focused bar. */
	actionBarCell(index: InputDigitIndex, event: InputKeyEvent): boolean {
		return matchesKey(
			event,
			readClientBinding(this.configuration, { kind: "actionBarCell", index }),
		);
	}
	/** Resolve scoped command intent without assigning keyboard ownership. */
	actionBarCommand(
		action: keyof InputConfiguration["actionBars"]["commands"],
		event: InputKeyEvent,
	): boolean {
		return matchesKey(
			event,
			readClientBinding(this.configuration, {
				kind: "actionBarCommand",
				action,
			}),
		);
	}
	/** Return spatial navigation intent, independent of browser key names. */
	actionBarDirection(event: InputKeyEvent): ActionBarDirection | null {
		return (
			(["up", "down", "left", "right"] as const).find((direction) =>
				this.actionBarCommand(direction, event),
			) ?? null
		);
	}
	/** Both keyboard and pointer activation read the same configured modifier state. */
	actionBarAlternate(
		event: Pick<InputKeyEvent, "shiftKey" | "ctrlKey" | "altKey" | "metaKey">,
	): boolean {
		const fields = {
			shift: "shiftKey",
			ctrl: "ctrlKey",
			alt: "altKey",
			meta: "metaKey",
		} as const;
		return Boolean(event[fields[this.configuration.actionBars.alternate]]);
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
