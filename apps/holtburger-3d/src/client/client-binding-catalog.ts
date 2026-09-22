import {
	ACTION_BAR_COMMANDS,
	CHARACTER_ACTIONS,
	CLIENT_SHORTCUT_ACTIONS,
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
	"game-peace" | "game-magic" | "game-physical" | "focused-bar" | "chat";
export type ClientBindingGroup =
	| "Movement"
	| "Targeting & interaction"
	| "Combat"
	| "Spells"
	| "Action bars"
	| "Chat";

/** One editable action with its real dispatch contexts and typed read/write path. */
export interface ClientBindingRow {
	readonly id: string;
	readonly label: string;
	readonly group: ClientBindingGroup;
	readonly contexts: readonly BindingContext[];
	readonly read: (
		settings: ClientKeyboardConfiguration,
	) => readonly KeyBinding[];
	readonly write: (
		settings: ClientKeyboardConfiguration,
		bindings: readonly KeyBinding[],
	) => ClientKeyboardConfiguration;
}

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
	toggleCombat: "Toggle combat",
	toggleAutoRun: "Toggle auto-run",
	preciseJump: "Aim precise jump",
	cancel: "Cancel / clear selection",
	chat: "Open chat",
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

function characterRow(action: CharacterAction): ClientBindingRow {
	return {
		id: `character.${action}`,
		label: CHARACTER_LABELS[action],
		group: "Movement",
		contexts: GAME_CONTEXTS,
		read: (settings) => settings.character[action],
		write: (settings, bindings) => ({
			...settings,
			character: { ...settings.character, [action]: bindings },
		}),
	};
}

function clientRow(action: ClientShortcut): ClientBindingRow {
	const chatOnly = action === "chatPreviousPage" || action === "chatNextPage";
	const group: ClientBindingGroup =
		action === "toggleAutoRun" || action === "preciseJump"
			? "Movement"
			: action === "toggleCombat"
				? "Combat"
				: chatOnly || action === "chat"
					? "Chat"
					: "Targeting & interaction";
	const contexts: readonly BindingContext[] = chatOnly
		? ["chat"]
		: action === "cancel"
			? [...GAME_CONTEXTS, "focused-bar", "chat"]
			: GAME_CONTEXTS;
	return {
		id: `client.${action}`,
		label: CLIENT_LABELS[action],
		group,
		contexts,
		read: (settings) => settings.client[action],
		write: (settings, bindings) => ({
			...settings,
			client: { ...settings.client, [action]: bindings },
		}),
	};
}

const characterRows = CHARACTER_ACTIONS.map(characterRow);
const clientRows = CLIENT_SHORTCUT_ACTIONS.map(clientRow);
const spellTabRows: ClientBindingRow[] = ACTION_SLOT_INDICES.map((index) => ({
	id: `spellBar.tabs.${index}`,
	label: `Select spell tab ${(index + 1) % ACTION_SLOT_INDICES.length}`,
	group: "Spells",
	contexts: ["game-magic"],
	read: (settings) => settings.spellBar.tabs[index],
	write: (settings, bindings) => ({
		...settings,
		spellBar: {
			...settings.spellBar,
			tabs: { ...settings.spellBar.tabs, [index]: bindings },
		},
	}),
}));
const spellSlotRows: ClientBindingRow[] = ACTION_SLOT_INDICES.map((index) => ({
	id: `spellBar.cells.${index}`,
	label: `Cast spell slot ${(index + 1) % ACTION_SLOT_INDICES.length}`,
	group: "Spells",
	contexts: ["game-magic"],
	read: (settings) => settings.spellBar.cells[index],
	write: (settings, bindings) => ({
		...settings,
		spellBar: {
			...settings.spellBar,
			cells: { ...settings.spellBar.cells, [index]: bindings },
		},
	}),
}));
const combatRows: ClientBindingRow[] = [
	...COMBAT_BREAKPOINT_INDICES.map((index): ClientBindingRow => ({
		id: `combatBar.breakpoints.${index}`,
		label: `Melee power / missile accuracy ${Math.round(COMBAT_BREAKPOINTS[index] * 100)}%`,
		group: "Combat",
		contexts: ["game-physical"],
		read: (settings) => settings.combatBar.breakpoints[index],
		write: (settings, bindings) => ({
			...settings,
			combatBar: {
				...settings.combatBar,
				breakpoints: {
					...settings.combatBar.breakpoints,
					[index]: bindings,
				},
			},
		}),
	})),
	...COMBAT_HEIGHT_INDICES.map((index): ClientBindingRow => ({
		id: `combatBar.heights.${index}`,
		label: ["High", "Medium", "Low"][index] + " attack height",
		group: "Combat",
		contexts: ["game-physical"],
		read: (settings) => settings.combatBar.heights[index],
		write: (settings, bindings) => ({
			...settings,
			combatBar: {
				...settings.combatBar,
				heights: { ...settings.combatBar.heights, [index]: bindings },
			},
		}),
	})),
];
const actionBarRows: ClientBindingRow[] = [
	...ACTION_SLOT_INDICES.map((index): ClientBindingRow => ({
		id: `actionBars.focus.${index}`,
		label: `Focus action bar ${(index + 1) % ACTION_SLOT_INDICES.length}`,
		group: "Action bars",
		// Focus acquisition precedes game commands; inside a focused bar it intentionally
		// precedes cell activation, so that overlap is not a configuration error.
		contexts: GAME_CONTEXTS,
		read: (settings) => settings.actionBars.focus[index],
		write: (settings, bindings) => ({
			...settings,
			actionBars: {
				...settings.actionBars,
				focus: { ...settings.actionBars.focus, [index]: bindings },
			},
		}),
	})),
	...ACTION_SLOT_INDICES.map((index): ClientBindingRow => ({
		id: `actionBars.cells.${index}`,
		label: `Activate action cell ${(index + 1) % ACTION_SLOT_INDICES.length}`,
		group: "Action bars",
		contexts: ["focused-bar"],
		read: (settings) => settings.actionBars.cells[index],
		write: (settings, bindings) => ({
			...settings,
			actionBars: {
				...settings.actionBars,
				cells: { ...settings.actionBars.cells, [index]: bindings },
			},
		}),
	})),
	...ACTION_BAR_COMMANDS.map((action): ClientBindingRow => ({
		id: `actionBars.commands.${action}`,
		label: ACTION_COMMAND_LABELS[action],
		group: "Action bars",
		contexts: ["focused-bar"],
		read: (settings) => settings.actionBars.commands[action],
		write: (settings, bindings) => ({
			...settings,
			actionBars: {
				...settings.actionBars,
				commands: { ...settings.actionBars.commands, [action]: bindings },
			},
		}),
	})),
];

/** Editor order follows runtime ownership rather than object nesting. */
export const CLIENT_BINDING_GROUPS: readonly {
	readonly title: ClientBindingGroup;
	readonly rows: readonly ClientBindingRow[];
}[] = [
	{
		title: "Movement",
		rows: [
			...characterRows,
			...clientRows.filter((row) => row.group === "Movement"),
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
	{ title: "Spells", rows: [...spellTabRows, ...spellSlotRows] },
	{ title: "Action bars", rows: actionBarRows },
	{
		title: "Chat",
		rows: clientRows.filter((row) => row.group === "Chat"),
	},
];
export const CLIENT_BINDING_ROWS = CLIENT_BINDING_GROUPS.flatMap(
	(group) => group.rows,
);

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

/** Detect conflicts only where two actions can claim the same actual keyboard event. */
export function conflictingClientBindings(
	settings: ClientKeyboardConfiguration,
	row: ClientBindingRow,
	candidate: KeyBinding,
	witness: InputKeyEvent | null,
): readonly ClientBindingRow[] {
	return CLIENT_BINDING_ROWS.filter(
		(other) =>
			other.id !== row.id &&
			other.contexts.some((context) => row.contexts.includes(context)) &&
			other
				.read(settings)
				.some((binding) => clientBindingsOverlap(candidate, binding, witness)),
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
		next = other.write(
			next,
			other
				.read(next)
				.filter(
					(binding) =>
						!bindings.some((candidate) =>
							clientBindingsOverlap(candidate, binding, witness),
						),
				),
		);
	}
	return row.write(next, bindings);
}
