import { describe, expect, it } from "vitest";
import { CLIENT_KEYBOARD_DEFAULTS } from "./client-input-settings";
import { ACTION_SLOT_INDICES } from "./client-action-bar-contract";
import { ACTION_BAR_COMMANDS } from "../lib/input/input-contract";
import {
	CLIENT_BINDING_GROUPS,
	CLIENT_BINDING_ROWS,
	conflictingClientBindings,
	replaceConflictingClientBindings,
} from "./client-binding-catalog";

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
					conflictingClientBindings(CLIENT_KEYBOARD_DEFAULTS, row, binding),
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
		);
		expect(conflicts.map((row) => row.id)).toEqual([backward.id]);
		const next = replaceConflictingClientBindings(
			CLIENT_KEYBOARD_DEFAULTS,
			forward,
			[...forward.read(CLIENT_KEYBOARD_DEFAULTS), binding],
			conflicts,
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
			conflictingClientBindings(CLIENT_KEYBOARD_DEFAULTS, cancel, {
				key: "Enter",
			}).map((row) => row.id),
		).toContain("actionBars.commands.confirm");
	});
});
