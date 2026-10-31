import {
	readClientBinding,
	replaceClientBinding,
} from "../lib/input/client-keyboard-bindings";
import { describe, expect, it } from "vitest";
import {
	CLIENT_KEYBOARD_DEFAULTS,
	clientKeyboardSettingsSchema,
} from "./client-input-settings";
import { ACTION_SLOT_INDICES } from "./client-action-bar-contract";
import { ACTION_BAR_COMMANDS } from "../lib/input/input-contract";
import {
	CLIENT_BINDING_GROUPS,
	CLIENT_BINDING_ROWS,
	captureClientBinding,
	conflictingClientBindings,
	replaceConflictingClientBindings,
	presentClientBinding,
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
	it("captures physical Space consistently when its logical key is unidentified", () => {
		for (const key of [" ", "Unidentified"]) {
			expect(
				captureClientBinding({ ...ctrlDigitTwo, key, code: "Space" }),
			).toEqual({
				code: "Space",
				shift: false,
				ctrl: true,
				alt: false,
				meta: false,
			});
		}
		expect(
			captureClientBinding({
				...ctrlDigitTwo,
				key: "Unidentified",
				code: "KeyQ",
			}),
		).toMatchObject({ code: "KeyQ" });
		expect(
			captureClientBinding({ ...ctrlDigitTwo, key: "q", code: "KeyQ" }),
		).toMatchObject({ key: "q" });
	});

	it("normalizes saved Space selectors without changing modifiers or alternate bindings", () => {
		const restored = clientKeyboardSettingsSchema.parse({
			...CLIENT_KEYBOARD_DEFAULTS,
			client: {
				...CLIENT_KEYBOARD_DEFAULTS.client,
				preciseJump: [{ key: " ", ctrl: true }, { key: "F8" }],
			},
			character: {
				...CLIENT_KEYBOARD_DEFAULTS.character,
				jump: [{ key: " ", ctrl: false }],
			},
		});
		expect(restored.client.preciseJump).toEqual([
			{ code: "Space", ctrl: true },
			{ key: "F8" },
		]);
		expect(restored.character.jump).toEqual([{ code: "Space", ctrl: false }]);
	});

	it("renames saved creature shortcuts without losing remaps or overriding explicit interactable bindings", () => {
		const savedClient = { ...CLIENT_KEYBOARD_DEFAULTS.client };
		Reflect.deleteProperty(savedClient, "nextInteractable");
		Reflect.deleteProperty(savedClient, "previousInteractable");
		Reflect.set(savedClient, "nextCreature", [{ key: "F8" }]);
		Reflect.set(savedClient, "previousCreature", []);
		const saved = { ...CLIENT_KEYBOARD_DEFAULTS, client: savedClient };
		const restored = clientKeyboardSettingsSchema.parse(saved);
		expect(restored.client.nextInteractable).toEqual([{ key: "F8" }]);
		expect(restored.client.previousInteractable).toEqual([]);
		const explicit = clientKeyboardSettingsSchema.parse({
			...saved,
			client: { ...savedClient, nextInteractable: [] },
		});
		expect(explicit.client.nextInteractable).toEqual([]);
	});

	it("fills new hostile shortcuts in saved settings and preserves explicit remaps", () => {
		const savedClient = { ...CLIENT_KEYBOARD_DEFAULTS.client };
		Reflect.deleteProperty(savedClient, "nextHostile");
		Reflect.deleteProperty(savedClient, "previousHostile");
		const restored = clientKeyboardSettingsSchema.parse({
			...CLIENT_KEYBOARD_DEFAULTS,
			client: savedClient,
		});
		expect(restored.client.nextHostile).toEqual(
			CLIENT_KEYBOARD_DEFAULTS.client.nextHostile,
		);
		expect(restored.client.previousHostile).toEqual(
			CLIENT_KEYBOARD_DEFAULTS.client.previousHostile,
		);
		const remapped = replaceClientBinding(
			restored,
			{ kind: "client", action: "nextHostile" },
			[{ key: "F8" }],
		);
		expect(
			clientKeyboardSettingsSchema.parse(remapped).client.nextHostile,
		).toEqual([{ key: "F8" }]);
		expect(row("client.nextHostile").group).toBe("Targeting & interaction");
	});

	it("checks panel toggles against every overlapping keyboard context", () => {
		const panel = row("client.toggleInventory");
		for (const id of [
			"character.forward",
			"client.toggleCombat",
			"client.toggleCharacter",
			"preciseJump.increasePower",
			"actionBars.commands.up",
		]) {
			const binding = {
				key: "F8",
				shift: false,
				ctrl: false,
				alt: false,
				meta: false,
			};
			const settings = replaceClientBinding(
				CLIENT_KEYBOARD_DEFAULTS,
				row(id).reference,
				[binding],
			);
			expect(
				conflictingClientBindings(settings, panel, binding, null).map(
					(entry) => entry.id,
				),
			).toContain(id);
		}
	});
	it("distinguishes a panel toggle from a shifted precise-jump binding", () => {
		const settings = replaceClientBinding(
			CLIENT_KEYBOARD_DEFAULTS,
			row("client.preciseJump").reference,
			[{ key: "j", shift: true }],
		);
		expect(
			conflictingClientBindings(
				settings,
				row("client.toggleJournal"),
				{ key: "j", shift: false },
				null,
			).map((entry) => entry.id),
		).not.toContain("client.preciseJump");
	});
	it("keeps chat activation ahead of movement but detects competing activations", () => {
		const toggle = row("client.toggleChatHistory");
		expect(
			conflictingClientBindings(
				CLIENT_KEYBOARD_DEFAULTS,
				toggle,
				{ key: "c", ctrl: true },
				null,
			),
		).toEqual([]);
		expect(
			conflictingClientBindings(
				CLIENT_KEYBOARD_DEFAULTS,
				toggle,
				{ key: "Enter" },
				null,
			).map((entry) => entry.id),
		).toContain("client.chat");
	});
	it("covers the independent persisted keyboard address universe", () => {
		const expected: string[] = [];
		for (const [group, entries] of Object.entries(CLIENT_KEYBOARD_DEFAULTS)) {
			for (const [name, value] of Object.entries(entries)) {
				if (Array.isArray(value)) expected.push(`${group}.${name}`);
				else if (typeof value === "object")
					for (const index of Object.keys(value))
						expected.push(`${group}.${name}.${index}`);
			}
		}
		expect(CLIENT_BINDING_ROWS.map((row) => row.id).sort()).toEqual(
			expected.sort(),
		);
	});

	it("presents current alternatives, empty bindings, and platform modifiers for Select self", () => {
		const reference = { kind: "client", action: "selectSelf" } as const;
		const settings = replaceClientBinding(CLIENT_KEYBOARD_DEFAULTS, reference, [
			{ code: "KeyQ", meta: true },
			{ key: "é" },
		]);
		expect(presentClientBinding(settings, reference, "mac")).toEqual({
			hint: "⌘Q",
			description: "Command + Q / é",
		});
		expect(
			presentClientBinding(settings, reference, "windows").description,
		).toBe("Windows + Q / é");
		expect(
			presentClientBinding(
				replaceClientBinding(settings, reference, []),
				reference,
				"linux",
			),
		).toEqual({ hint: null, description: "Unbound" });
	});

	it("keeps power remaps independent while checking live precise controls", () => {
		const power = row("preciseJump.increasePower");
		const settings = replaceClientBinding(
			CLIENT_KEYBOARD_DEFAULTS,
			power.reference,
			[{ key: "i" }],
		);
		expect(settings.character).toBe(CLIENT_KEYBOARD_DEFAULTS.character);
		expect(presentClientBinding(settings, power.reference, "linux").hint).toBe(
			"I",
		);
		expect(
			conflictingClientBindings(settings, power, { key: "w" }, null),
		).toEqual([]);
		expect(
			conflictingClientBindings(settings, power, { key: "a" }, null).map(
				(row) => row.id,
			),
		).toEqual(["character.turnLeft"]);
		expect(
			conflictingClientBindings(settings, power, { code: "Space" }, null).map(
				(row) => row.id,
			),
		).toEqual(["character.jump"]);
	});
	it("shows all spell tabs before spell slots in one Spells group", () => {
		const groups = CLIENT_BINDING_GROUPS.filter(
			(group) => group.title === "Spells",
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].rows.map((row) => row.id)).toEqual([
			...ACTION_SLOT_INDICES.map((index) => `spellBar.tabs.${index}`),
			"spellBar.caster",
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
			for (const binding of readClientBinding(
				CLIENT_KEYBOARD_DEFAULTS,
				row.reference,
			)) {
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
			[
				...readClientBinding(CLIENT_KEYBOARD_DEFAULTS, forward.reference),
				binding,
			],
			conflicts,
			null,
		);
		expect(readClientBinding(next, backward.reference)).toEqual([]);
		expect(readClientBinding(next, forward.reference)).toContainEqual(binding);
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
		const settings = replaceClientBinding(
			CLIENT_KEYBOARD_DEFAULTS,
			second.reference,
			[legacy],
		);
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
			[...readClientBinding(settings, first.reference), binding],
			conflicts,
			ctrlDigitTwo,
		);
		expect(readClientBinding(next, second.reference)).toEqual([]);
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
		const shared = readClientBinding(
			CLIENT_KEYBOARD_DEFAULTS,
			combat.reference,
		)[0];
		expect(
			conflictingClientBindings(CLIENT_KEYBOARD_DEFAULTS, spell, shared, null),
		).toEqual([]);
	});
});
