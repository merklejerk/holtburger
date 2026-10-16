import type {
	ClientKeyboardConfiguration,
	ClientShortcut,
	CharacterAction,
	PreciseJumpAction,
	InputDigitIndex,
	CombatHeightIndex,
	CombatBreakpointIndex,
	KeyBinding,
	ACTION_BAR_COMMANDS,
} from "./input-contract";

/** Existing focused-bar command identities. */
type ActionBarCommand = (typeof ACTION_BAR_COMMANDS)[number];
/** A configuration address, independent of target, content, and keyboard ownership. */
export type ClientBindingReference =
	| { readonly kind: "client"; readonly action: ClientShortcut }
	| { readonly kind: "character"; readonly action: CharacterAction }
	| { readonly kind: "preciseJump"; readonly action: PreciseJumpAction }
	| { readonly kind: "spellTab"; readonly index: InputDigitIndex }
	| { readonly kind: "spellCell"; readonly index: InputDigitIndex }
	| { readonly kind: "spellCaster" }
	| { readonly kind: "combatHeight"; readonly index: CombatHeightIndex }
	| { readonly kind: "combatBreakpoint"; readonly index: CombatBreakpointIndex }
	| { readonly kind: "actionBarFocus"; readonly index: InputDigitIndex }
	| { readonly kind: "actionBarCell"; readonly index: InputDigitIndex }
	| { readonly kind: "actionBarCommand"; readonly action: ActionBarCommand };

/** Stable settings row identity derived from its typed address. */
export type ClientBindingId =
	| `client.${ClientShortcut}`
	| `character.${CharacterAction}`
	| `preciseJump.${PreciseJumpAction}`
	| `spellBar.tabs.${InputDigitIndex}`
	| `spellBar.cells.${InputDigitIndex}`
	| "spellBar.caster"
	| `combatBar.heights.${CombatHeightIndex}`
	| `combatBar.breakpoints.${CombatBreakpointIndex}`
	| `actionBars.focus.${InputDigitIndex}`
	| `actionBars.cells.${InputDigitIndex}`
	| `actionBars.commands.${ActionBarCommand}`;

/** Preserve editor row identities without parsing untrusted strings. */
export function clientBindingId(
	reference: ClientBindingReference,
): ClientBindingId {
	switch (reference.kind) {
		case "client":
			return `client.${reference.action}`;
		case "character":
			return `character.${reference.action}`;
		case "preciseJump":
			return `preciseJump.${reference.action}`;
		case "spellTab":
			return `spellBar.tabs.${reference.index}`;
		case "spellCell":
			return `spellBar.cells.${reference.index}`;
		case "spellCaster":
			return "spellBar.caster";
		case "combatHeight":
			return `combatBar.heights.${reference.index}`;
		case "combatBreakpoint":
			return `combatBar.breakpoints.${reference.index}`;
		case "actionBarFocus":
			return `actionBars.focus.${reference.index}`;
		case "actionBarCell":
			return `actionBars.cells.${reference.index}`;
		case "actionBarCommand":
			return `actionBars.commands.${reference.action}`;
	}
}

/** Read ordered alternatives from the accepted configuration. */
export function readClientBinding(
	settings: ClientKeyboardConfiguration,
	reference: ClientBindingReference,
): readonly KeyBinding[] {
	switch (reference.kind) {
		case "client":
			return settings.client[reference.action];
		case "character":
			return settings.character[reference.action];
		case "preciseJump":
			return settings.preciseJump[reference.action];
		case "spellTab":
			return settings.spellBar.tabs[reference.index];
		case "spellCell":
			return settings.spellBar.cells[reference.index];
		case "spellCaster":
			return settings.spellBar.caster;
		case "combatHeight":
			return settings.combatBar.heights[reference.index];
		case "combatBreakpoint":
			return settings.combatBar.breakpoints[reference.index];
		case "actionBarFocus":
			return settings.actionBars.focus[reference.index];
		case "actionBarCell":
			return settings.actionBars.cells[reference.index];
		case "actionBarCommand":
			return settings.actionBars.commands[reference.action];
	}
}

/** Replace one address while retaining every unrelated configuration field. */
export function replaceClientBinding(
	settings: ClientKeyboardConfiguration,
	reference: ClientBindingReference,
	bindings: readonly KeyBinding[],
): ClientKeyboardConfiguration {
	switch (reference.kind) {
		case "client":
			return {
				...settings,
				client: { ...settings.client, [reference.action]: bindings },
			};
		case "character":
			return {
				...settings,
				character: { ...settings.character, [reference.action]: bindings },
			};
		case "preciseJump":
			return {
				...settings,
				preciseJump: { ...settings.preciseJump, [reference.action]: bindings },
			};
		case "spellTab":
			return {
				...settings,
				spellBar: {
					...settings.spellBar,
					tabs: { ...settings.spellBar.tabs, [reference.index]: bindings },
				},
			};
		case "spellCell":
			return {
				...settings,
				spellBar: {
					...settings.spellBar,
					cells: { ...settings.spellBar.cells, [reference.index]: bindings },
				},
			};
		case "spellCaster":
			return {
				...settings,
				spellBar: { ...settings.spellBar, caster: bindings },
			};
		case "combatHeight":
			return {
				...settings,
				combatBar: {
					...settings.combatBar,
					heights: {
						...settings.combatBar.heights,
						[reference.index]: bindings,
					},
				},
			};
		case "combatBreakpoint":
			return {
				...settings,
				combatBar: {
					...settings.combatBar,
					breakpoints: {
						...settings.combatBar.breakpoints,
						[reference.index]: bindings,
					},
				},
			};
		case "actionBarFocus":
			return {
				...settings,
				actionBars: {
					...settings.actionBars,
					focus: { ...settings.actionBars.focus, [reference.index]: bindings },
				},
			};
		case "actionBarCell":
			return {
				...settings,
				actionBars: {
					...settings.actionBars,
					cells: { ...settings.actionBars.cells, [reference.index]: bindings },
				},
			};
		case "actionBarCommand":
			return {
				...settings,
				actionBars: {
					...settings.actionBars,
					commands: {
						...settings.actionBars.commands,
						[reference.action]: bindings,
					},
				},
			};
	}
}
