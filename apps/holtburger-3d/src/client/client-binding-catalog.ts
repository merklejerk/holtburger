import {
	compactInputHint,
	formatInputBindings,
	type InputDisplayPlatform,
} from "../lib/input/input-presentation";
import {
	clientBindingId,
	readClientBinding,
	replaceClientBinding,
	type ClientBindingReference,
	type ClientBindingId,
} from "../lib/input/client-keyboard-bindings";
import {
	ACTION_BAR_COMMANDS,
	CHARACTER_ACTIONS,
	PRECISE_JUMP_ACTIONS,
	CLIENT_SHORTCUT_ACTIONS,
	CLIENT_PANEL_SHORTCUT_ACTIONS,
	COMBAT_BREAKPOINT_INDICES,
	COMBAT_HEIGHT_INDICES,
	type CharacterAction,
	type ClientKeyboardConfiguration,
	type ClientShortcut,
	type KeyBinding,
	type InputKeyEvent,
} from "../lib/input/input-contract";
import { keyBindingsOverlap, matchesKey } from "../lib/input/input-context";
import { ACTION_SLOT_INDICES } from "./client-action-bar-contract";
import { COMBAT_BREAKPOINTS } from "./client-combat-bar-state";

type BindingContext =
	| "game-peace"
	| "game-magic"
	| "game-physical"
	| "precise-jump"
	| "focused-bar"
	| "chat";
type ClientBindingGroup =
	| "System panels"
	| "Movement"
	| "Targeting & interaction"
	| "Combat"
	| "Spells"
	| "Action bars"
	| "Chat";

/** One editable binding with metadata for settings overlap checks. */
export interface ClientBindingRow {
	readonly id: ClientBindingId;
	/** Address shared with runtime matching and presentation. */
	readonly reference: ClientBindingReference;
	readonly label: string;
	readonly group: ClientBindingGroup;
	/** Settings overlap model; runtime scope admission remains with KeyboardInputPolicy. */
	readonly contexts: readonly BindingContext[];
}

/** Catalog source metadata; stable identities are generated once at publication. */
type BindingDefinition = Omit<ClientBindingRow, "id">;

const GAME_CONTEXTS = ["game-peace", "game-magic", "game-physical"] as const;
const CHARACTER_LABELS: Readonly<Record<CharacterAction, string>> = {
	forward: "Move forward",
	backward: "Move backward",
	turnLeft: "Turn left",
	turnRight: "Turn right",
	strafeLeft: "Strafe left",
	strafeRight: "Strafe right",
	walk: "Walk",
	jump: "Jump",
};
const CLIENT_LABELS: Readonly<Record<ClientShortcut, string>> = {
	toggleInventory: "Toggle inventory",
	toggleCharacter: "Toggle character",
	toggleSocial: "Toggle social",
	toggleWorld: "Toggle world",
	toggleJournal: "Toggle journal",
	toggleSettings: "Toggle settings",

	selectSelf: "Select self",
	nextCreature: "Next creature",
	previousCreature: "Previous creature",
	nextNonCreature: "Next world object",
	previousNonCreature: "Previous world object",
	nextUnopenedCorpse: "Next unopened corpse",
	previousUnopenedCorpse: "Previous unopened corpse",
	interact: "Interact",
	examine: "Examine",
	give: "Give selected item",
	splitStack: "Split stack",
	toggleCombat: "Toggle combat",
	toggleAutoRun: "Toggle auto-run",
	preciseJump: "Aim precise jump",
	cancel: "Cancel / clear selection",
	chat: "Open chat",
	openEmotes: "Open emotes",
	toggleChatHistory: "Toggle chat history",
	holdChatHistory: "Interact with chat history (hold)",
	chatPreviousPage: "Earlier chat page",
	chatNextPage: "Later chat page",
};
const ACTION_COMMAND_LABELS: Readonly<
	Record<(typeof ACTION_BAR_COMMANDS)[number], string>
> = {
	up: "Move up",
	down: "Move down",
	left: "Move left",
	right: "Move right",
	confirm: "Activate selected cell",
};

function characterRow(action: CharacterAction): BindingDefinition {
	return {
		reference: { kind: "character", action },
		label: CHARACTER_LABELS[action],
		group: "Movement",
		// Turning and launch remain live while precise targeting owns translation.
		contexts:
			action === "turnLeft" || action === "turnRight" || action === "jump"
				? [...GAME_CONTEXTS, "precise-jump"]
				: GAME_CONTEXTS,
	};
}

function clientRow(action: ClientShortcut): BindingDefinition {
	const chatOnly = action === "chatPreviousPage" || action === "chatNextPage";
	const group: ClientBindingGroup = CLIENT_PANEL_SHORTCUT_ACTIONS.some(
		(panelAction) => panelAction === action,
	)
		? "System panels"
		: action === "toggleAutoRun" || action === "preciseJump"
			? "Movement"
			: action === "toggleCombat"
				? "Combat"
				: chatOnly ||
					  action === "chat" ||
					  action === "toggleChatHistory" ||
					  action === "holdChatHistory"
					? "Chat"
					: "Targeting & interaction";
	// Panels remain available during precise aiming and unhandled focused-bar input.
	const contexts: readonly BindingContext[] =
		group === "System panels"
			? [...GAME_CONTEXTS, "precise-jump", "focused-bar"]
			: chatOnly
				? ["chat"]
				: action === "toggleChatHistory"
					? [...GAME_CONTEXTS, "chat"]
					: action === "cancel"
						? [...GAME_CONTEXTS, "precise-jump", "focused-bar", "chat"]
						: GAME_CONTEXTS;
	return {
		reference: { kind: "client", action },
		label: CLIENT_LABELS[action],
		group,
		contexts,
	};
}

const characterRows = CHARACTER_ACTIONS.map(characterRow);
const preciseJumpRows: BindingDefinition[] = PRECISE_JUMP_ACTIONS.map(
	(action) => ({
		reference: { kind: "preciseJump", action },
		label:
			action === "increasePower"
				? "Increase jump power (precise mode)"
				: "Decrease jump power (precise mode)",
		group: "Movement",
		contexts: ["precise-jump"],
	}),
);
const clientRows = CLIENT_SHORTCUT_ACTIONS.map(clientRow);
const spellTabRows: BindingDefinition[] = ACTION_SLOT_INDICES.map((index) => ({
	reference: { kind: "spellTab", index },
	label: `Select spell tab ${(index + 1) % ACTION_SLOT_INDICES.length}`,
	group: "Spells",
	contexts: ["game-magic"],
}));
const spellCasterRow: BindingDefinition = {
	reference: { kind: "spellCaster" },
	label: "Cast wielded caster spell",
	group: "Spells",
	contexts: ["game-magic"],
};
const spellSlotRows: BindingDefinition[] = ACTION_SLOT_INDICES.map((index) => ({
	reference: { kind: "spellCell", index },
	label: `Cast spell slot ${(index + 1) % ACTION_SLOT_INDICES.length}`,
	group: "Spells",
	contexts: ["game-magic"],
}));
const combatRows: BindingDefinition[] = [
	...COMBAT_BREAKPOINT_INDICES.map((index): BindingDefinition => ({
		reference: { kind: "combatBreakpoint", index },
		label: `Melee power / missile accuracy ${Math.round(COMBAT_BREAKPOINTS[index] * 100)}%`,
		group: "Combat",
		contexts: ["game-physical"],
	})),
	...COMBAT_HEIGHT_INDICES.map((index): BindingDefinition => ({
		reference: { kind: "combatHeight", index },
		label: ["High", "Medium", "Low"][index] + " attack height",
		group: "Combat",
		contexts: ["game-physical"],
	})),
];
const actionBarRows: BindingDefinition[] = [
	...ACTION_SLOT_INDICES.map((index): BindingDefinition => ({
		reference: { kind: "actionBarFocus", index },
		label: `Focus action bar ${(index + 1) % ACTION_SLOT_INDICES.length}`,
		group: "Action bars",
		// Focus acquisition precedes game commands; inside a focused bar it intentionally
		// precedes cell activation, so that overlap is not a configuration error.
		contexts: GAME_CONTEXTS,
	})),
	...ACTION_SLOT_INDICES.map((index): BindingDefinition => ({
		reference: { kind: "actionBarCell", index },
		label: `Activate action cell ${(index + 1) % ACTION_SLOT_INDICES.length}`,
		group: "Action bars",
		contexts: ["focused-bar"],
	})),
	...ACTION_BAR_COMMANDS.map((action): BindingDefinition => ({
		reference: { kind: "actionBarCommand", action },
		label: ACTION_COMMAND_LABELS[action],
		group: "Action bars",
		contexts: ["focused-bar"],
	})),
];

/** Editor order follows runtime ownership rather than object nesting. */
const bindingGroups: readonly {
	readonly title: ClientBindingGroup;
	readonly rows: readonly BindingDefinition[];
}[] = [
	{
		title: "Movement",
		rows: [
			...characterRows,
			...clientRows.filter((row) => row.group === "Movement"),
			...preciseJumpRows,
		],
	},
	{
		title: "Targeting & interaction",
		rows: clientRows.filter((row) => row.group === "Targeting & interaction"),
	},
	{
		title: "Combat",
		rows: [
			...clientRows.filter((row) => row.group === "Combat"),
			...combatRows,
		],
	},
	{
		title: "Spells",
		rows: [...spellTabRows, spellCasterRow, ...spellSlotRows],
	},
	{ title: "Action bars", rows: actionBarRows },
	{
		title: "System panels",
		rows: clientRows.filter((row) => row.group === "System panels"),
	},
	{
		title: "Chat",
		rows: clientRows.filter((row) => row.group === "Chat"),
	},
];
export const CLIENT_BINDING_GROUPS: readonly {
	readonly title: ClientBindingGroup;
	readonly rows: readonly ClientBindingRow[];
}[] = bindingGroups.map((group) => ({
	...group,
	rows: group.rows.map((row) => ({
		...row,
		id: clientBindingId(row.reference),
	})),
}));
export const CLIENT_BINDING_ROWS: readonly ClientBindingRow[] =
	CLIENT_BINDING_GROUPS.flatMap((group) => group.rows);

/** Capture digit keys by position, keeping the top row and numpad distinct. */
export function captureClientBinding(event: InputKeyEvent): KeyBinding {
	const modifiers = {
		shift: event.shiftKey,
		ctrl: Boolean(event.ctrlKey),
		alt: Boolean(event.altKey),
		meta: Boolean(event.metaKey),
	};
	return event.code !== undefined && /^(?:Digit|Numpad)[0-9]$/.test(event.code)
		? { code: event.code, ...modifiers }
		: { key: event.key, ...modifiers };
}

/** A captured event proves mixed key/code overlap on this layout. */
export function clientBindingsOverlap(
	a: KeyBinding,
	b: KeyBinding,
	witness: InputKeyEvent | null,
): boolean {
	return (
		keyBindingsOverlap(a, b) ||
		(witness !== null && matchesKey(witness, [a]) && matchesKey(witness, [b]))
	);
}

/** Detect overlaps within the existing Settings context model. */
export function conflictingClientBindings(
	settings: ClientKeyboardConfiguration,
	row: ClientBindingRow,
	candidate: KeyBinding,
	witness: InputKeyEvent | null,
): readonly ClientBindingRow[] {
	return CLIENT_BINDING_ROWS.filter(
		(other) =>
			other.id !== row.id &&
			// Chat scope activation consumes its toggle before movement can see the press.
			!(
				(row.id === "client.toggleChatHistory" &&
					other.reference.kind === "character") ||
				(other.id === "client.toggleChatHistory" &&
					row.reference.kind === "character")
			) &&
			other.contexts.some((context) => row.contexts.includes(context)) &&
			readClientBinding(settings, other.reference).some((binding) =>
				clientBindingsOverlap(candidate, binding, witness),
			),
	);
}

/** A replacement removes only conflicting alternatives from named actions. */
export function replaceConflictingClientBindings(
	settings: ClientKeyboardConfiguration,
	row: ClientBindingRow,
	bindings: readonly KeyBinding[],
	conflicts: readonly ClientBindingRow[],
	witness: InputKeyEvent | null,
): ClientKeyboardConfiguration {
	let next = settings;
	for (const other of conflicts) {
		next = replaceClientBinding(
			next,
			other.reference,
			readClientBinding(next, other.reference).filter(
				(binding) =>
					!bindings.some((candidate) =>
						clientBindingsOverlap(candidate, binding, witness),
					),
			),
		);
	}
	return replaceClientBinding(next, row.reference, bindings);
}

const definitions = new Map(CLIENT_BINDING_ROWS.map((row) => [row.id, row]));

/** Resolve metadata by structural identity; an incomplete catalog is an internal error. */
function clientBindingDefinition(
	reference: ClientBindingReference,
): ClientBindingRow {
	const id = clientBindingId(reference);
	const definition = definitions.get(id);
	if (definition === undefined)
		throw new Error(`Missing client binding definition ${id}`);
	return definition;
}

/** Prepared shortcut facts shared by compact markers and full action tooltips. */
export function presentClientBinding(
	settings: ClientKeyboardConfiguration,
	reference: ClientBindingReference,
	platform: InputDisplayPlatform,
): { readonly hint: string | null; readonly description: string } {
	const definition = clientBindingDefinition(reference);
	const bindings = readClientBinding(settings, definition.reference);
	return {
		hint: compactInputHint(bindings, platform),
		description: formatInputBindings(bindings, platform),
	};
}
