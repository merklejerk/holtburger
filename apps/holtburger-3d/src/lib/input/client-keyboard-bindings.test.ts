import { describe, expect, expectTypeOf, it } from "vitest";
import { CLIENT_KEYBOARD_DEFAULTS } from "../../client/client-input-settings";
import {
	clientBindingId,
	readClientBinding,
	replaceClientBinding,
	type ClientBindingReference,
} from "./client-keyboard-bindings";
import { AppInput } from "./app-input";
import { clientInputConfiguration } from "../../client/client-input-settings";
import type { KeyBinding } from "./input-contract";

const addresses: readonly ClientBindingReference[] = [
	{ kind: "character", action: "forward" },
	{ kind: "client", action: "selectSelf" },
	{ kind: "client", action: "splitStack" },
	{ kind: "spellTab", index: 9 },
	{ kind: "spellCell", index: 9 },
	{ kind: "spellCaster" },
	{ kind: "combatHeight", index: 2 },
	{ kind: "combatBreakpoint", index: 4 },
	{ kind: "actionBarFocus", index: 9 },
	{ kind: "actionBarCell", index: 9 },
	{ kind: "actionBarCommand", action: "confirm" },
];

describe("typed client binding access", () => {
	for (const reference of addresses) {
		it(`replaces ${clientBindingId(reference)} without changing other addresses`, () => {
			const alternatives: readonly KeyBinding[] = [
				{ key: "é", ctrl: true },
				{ code: "Numpad2", shift: false },
			];
			const next = replaceClientBinding(
				CLIENT_KEYBOARD_DEFAULTS,
				reference,
				alternatives,
			);
			expect(readClientBinding(next, reference)).toBe(alternatives);
			expect(
				replaceClientBinding(
					next,
					reference,
					readClientBinding(CLIENT_KEYBOARD_DEFAULTS, reference),
				),
			).toEqual(CLIENT_KEYBOARD_DEFAULTS);
			expect(CLIENT_KEYBOARD_DEFAULTS).not.toEqual(next);
			for (const other of addresses) {
				if (clientBindingId(other) !== clientBindingId(reference))
					expect(readClientBinding(next, other)).toBe(
						readClientBinding(CLIENT_KEYBOARD_DEFAULTS, other),
					);
			}
			expect(
				readClientBinding(replaceClientBinding(next, reference, []), reference),
			).toEqual([]);
		});
	}
});

it("rejects invalid reference shapes at the type boundary", () => {
	expectTypeOf<{
		kind: "spellCell";
		index: 10;
	}>().not.toExtend<ClientBindingReference>();
	expectTypeOf<{
		kind: "combatHeight";
		index: 3;
	}>().not.toExtend<ClientBindingReference>();
	expectTypeOf<{
		kind: "combatBreakpoint";
		index: 5;
	}>().not.toExtend<ClientBindingReference>();
	expectTypeOf<{
		kind: "client";
		action: "forward";
	}>().not.toExtend<ClientBindingReference>();
	expectTypeOf<{
		kind: "actionBarCommand";
		index: 0;
	}>().not.toExtend<ClientBindingReference>();
});

it("uses accepted replacement addresses in every runtime lookup family", () => {
	const event = { key: "q", code: "KeyQ", shiftKey: false };
	let settings = CLIENT_KEYBOARD_DEFAULTS;
	for (const reference of addresses) {
		settings = replaceClientBinding(settings, reference, [{ code: "KeyQ" }]);
		const input = new AppInput(clientInputConfiguration(settings));
		switch (reference.kind) {
			case "client":
				expect(input.shortcut(reference.action, event)).toBe(true);
				break;
			case "character": {
				const actions: string[] = [];
				const context = input.characterContext((action) =>
					actions.push(action),
				);
				expect(context.apply(event, true)).toBe(true);
				expect(actions).toEqual([reference.action]);
				break;
			}
			case "spellTab":
				expect(input.spellBarCommand(event)).toEqual({
					kind: "tabs",
					index: reference.index,
				});
				break;
			case "spellCell":
				expect(input.spellBarCommand(event)).toEqual({
					kind: "cells",
					index: reference.index,
				});
				break;
			case "spellCaster":
				expect(input.spellBarCommand(event)).toEqual({ kind: "caster" });
				break;
			case "combatHeight":
				expect(input.combatHeight(event)).toBe(reference.index);
				break;
			case "combatBreakpoint":
				expect(input.combatBreakpoint(event)).toBe(reference.index);
				break;
			case "actionBarFocus":
				expect(input.actionBarFocus(reference.index, event)).toBe(true);
				break;
			case "actionBarCell":
				expect(input.actionBarCell(reference.index, event)).toBe(true);
				break;
			case "actionBarCommand":
				expect(input.actionBarCommand(reference.action, event)).toBe(true);
				break;
		}
		settings = CLIENT_KEYBOARD_DEFAULTS;
	}
});
