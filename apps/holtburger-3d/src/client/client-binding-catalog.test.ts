import { describe, expect, it } from "vitest";
import { CLIENT_KEYBOARD_DEFAULTS } from "./client-input-settings";
import { ACTION_SLOT_INDICES } from "./client-action-bar-contract";
import { ACTION_BAR_COMMANDS } from "../lib/input/input-contract";
import {
	CLIENT_BINDING_GROUPS,
	CLIENT_BINDING_ROWS,
	captureClientBinding,
	conflictingClientBindings,
	replaceConflictingClientBindings,
} from "./client-binding-catalog";

function row(id: string) {
	const match = CLIENT_BINDING_ROWS.find((candidate) => candidate.id === id);
	if (match === undefined) throw new Error(`Missing binding row ${id}`);
	return match;
}

const ctrlDigitTwo = {
	key: "2",
	code: "Digit2",
	shiftKey: false,
	ctrlKey: true,
	altKey: false,
	metaKey: false,
};

describe("client binding catalog", () => {
	it("shows all spell tabs before spell slots in one Spells group", () => {
		const groups = CLIENT_BINDING_GROUPS.filter(
			(group) => group.title === "Spells",
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].rows.map((row) => row.id)).toEqual([
			...ACTION_SLOT_INDICES.map((index) => `spellBar.tabs.${index}`),
			...ACTION_SLOT_INDICES.map((index) => `spellBar.cells.${index}`),
		]);
	});

	it("shows action-bar focus bindings before cells and commands", () => {
		const groups = CLIENT_BINDING_GROUPS.filter(
			(group) => group.title === "Action bars",
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].rows.map((row) => row.id)).toEqual([
			...ACTION_SLOT_INDICES.map((index) => `actionBars.focus.${index}`),
			...ACTION_SLOT_INDICES.map((index) => `actionBars.cells.${index}`),
			...ACTION_BAR_COMMANDS.map((action) => `actionBars.commands.${action}`),
		]);
	});

	it("covers every default action and accepts its context-specific overlaps", () => {
		expect(new Set(CLIENT_BINDING_ROWS.map((row) => row.id)).size).toBe(
			CLIENT_BINDING_ROWS.length,
		);
		for (const row of CLIENT_BINDING_ROWS) {
			for (const binding of row.read(CLIENT_KEYBOARD_DEFAULTS)) {
				expect(
					conflictingClientBindings(
						CLIENT_KEYBOARD_DEFAULTS,
						row,
						binding,
						null,
					),
					row.id,
				).toEqual([]);
			}
		}
	});

	it("replaces only an overlapping alternative in the same dispatch context", () => {
		const forward = CLIENT_BINDING_ROWS.find(
			(row) => row.id === "character.forward",
		);
		const backward = CLIENT_BINDING_ROWS.find(
			(row) => row.id === "character.backward",
		);
		if (forward === undefined || backward === undefined)
			throw new Error("Missing movement row");
		const binding = { key: "s", ctrl: false, alt: false, meta: false };
		const conflicts = conflictingClientBindings(
			CLIENT_KEYBOARD_DEFAULTS,
			forward,
			binding,
			null,
		);
		expect(conflicts.map((row) => row.id)).toEqual([backward.id]);
		const next = replaceConflictingClientBindings(
			CLIENT_KEYBOARD_DEFAULTS,
			forward,
			[...forward.read(CLIENT_KEYBOARD_DEFAULTS), binding],
			conflicts,
			null,
		);
		expect(backward.read(next)).toEqual([]);
		expect(forward.read(next)).toContainEqual(binding);
	});

	it("treats shared cancellation as active inside a focused action bar", () => {
		const cancel = CLIENT_BINDING_ROWS.find(
			(row) => row.id === "client.cancel",
		);
		if (cancel === undefined)
			throw new Error("Missing client cancellation row");
		expect(
			conflictingClientBindings(
				CLIENT_KEYBOARD_DEFAULTS,
				cancel,
				{
					key: "Enter",
				},
				null,
			).map((row) => row.id),
		).toContain("actionBars.commands.confirm");
	});

	it("rejects Ctrl+2 on action bar 1 while action bar 2 owns that chord", () => {
		const first = row("actionBars.focus.0");
		const second = row("actionBars.focus.1");
		const binding = captureClientBinding(ctrlDigitTwo);
		expect(binding).toEqual({
			code: "Digit2",
			shift: false,
			ctrl: true,
			alt: false,
			meta: false,
		});
		expect(captureClientBinding({ ...ctrlDigitTwo, key: "é" })).toEqual(
			binding,
		);
		const conflicts = conflictingClientBindings(
			CLIENT_KEYBOARD_DEFAULTS,
			first,
			binding,
			ctrlDigitTwo,
		);
		expect(conflicts).toContain(second);
	});

	it("uses the observed event to replace a legacy key binding with a code binding", () => {
		const first = row("actionBars.focus.0");
		const second = row("actionBars.focus.1");
		const legacy = {
			key: "2",
			shift: false,
			ctrl: true,
			alt: false,
			meta: false,
		};
		const settings = second.write(CLIENT_KEYBOARD_DEFAULTS, [legacy]);
		const binding = captureClientBinding(ctrlDigitTwo);
		const conflicts = conflictingClientBindings(
			settings,
			first,
			binding,
			ctrlDigitTwo,
		);
		expect(conflicts).toContain(second);
		const next = replaceConflictingClientBindings(
			settings,
			first,
			[...first.read(settings), binding],
			conflicts,
			ctrlDigitTwo,
		);
		expect(second.read(next)).toEqual([]);
	});

	it("distinguishes numpad digits and permits different combat contexts", () => {
		const first = row("actionBars.focus.0");
		const spell = row("spellBar.tabs.1");
		const combat = row("combatBar.heights.1");
		const numpad = {
			key: "2",
			code: "Numpad2",
			shiftKey: false,
			ctrlKey: true,
			altKey: false,
			metaKey: false,
		};
		const binding = captureClientBinding(numpad);
		expect(binding).toMatchObject({ code: "Numpad2" });
		expect(
			conflictingClientBindings(
				CLIENT_KEYBOARD_DEFAULTS,
				first,
				binding,
				numpad,
			),
		).toEqual([]);
		const shared = combat.read(CLIENT_KEYBOARD_DEFAULTS)[0];
		expect(
			conflictingClientBindings(CLIENT_KEYBOARD_DEFAULTS, spell, shared, null),
		).toEqual([]);
	});
});
