import { expect, it, vi } from "vitest";
import { AppInput } from "./app-input";
import { INPUT_DEFAULTS } from "./input-defaults";
import { InputContext, matchesKey } from "./input-context";

it("remaps numbered focus, cells, navigation, confirm, cancel, and the pointer/key modifier", () => {
	const input = new AppInput({
		...INPUT_DEFAULTS,
		actionBars: {
			focus: {
				...INPUT_DEFAULTS.actionBars.focus,
				0: [{ key: "F5" }],
				9: [{ key: "b", alt: true }],
			},
			cells: {
				...INPUT_DEFAULTS.actionBars.cells,
				0: [{ code: "KeyQ" }],
				9: [],
			},
			commands: {
				up: [{ key: "i" }],
				down: [{ key: "k" }],
				left: [{ key: "j" }],
				right: [{ key: "l" }],
				confirm: [{ key: "F6" }],
				cancel: [{ key: "Backspace" }],
			},
			alternate: "ctrl",
		},
	});
	const event = {
		key: "F5",
		code: "F5",
		shiftKey: false,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
	};
	expect(input.actionBarFocus(0, event)).toBe(true);
	expect(
		input.actionBarFocus(0, {
			...event,
			key: "1",
			code: "Digit1",
			ctrlKey: true,
		}),
	).toBe(false);
	expect(input.actionBarFocus(9, { ...event, key: "B", altKey: true })).toBe(
		true,
	);
	expect(
		input.actionBarCell(0, {
			...event,
			key: "A",
			code: "KeyQ",
			shiftKey: true,
		}),
	).toBe(true);
	expect(input.actionBarCell(9, { ...event, key: "0", code: "Digit0" })).toBe(
		false,
	);
	expect(input.actionBarDirection({ ...event, key: "J" })).toBe("left");
	expect(input.actionBarDirection({ ...event, key: "ArrowLeft" })).toBeNull();
	expect(input.actionBarCommand("confirm", { ...event, key: "F6" })).toBe(true);
	expect(input.actionBarCommand("cancel", { ...event, key: "Backspace" })).toBe(
		true,
	);
	expect(input.actionBarAlternate({ shiftKey: false, ctrlKey: true })).toBe(
		true,
	);
	expect(input.actionBarAlternate({ shiftKey: true, ctrlKey: false })).toBe(
		false,
	);
});

it("physical bindings match shifted digits without changing key-based matching", () => {
	const event = { key: "#", code: "Digit3", shiftKey: true };
	expect(matchesKey(event, [{ code: "Digit3" }])).toBe(true);
	expect(matchesKey(event, [{ key: "3" }])).toBe(false);
	expect(matchesKey(event, [{ code: "Digit3", shift: false }])).toBe(false);
	expect(matchesKey({ key: "3", shiftKey: false }, [{ code: "Digit3" }])).toBe(
		false,
	);
});

it("physical held bindings retain release identity and reject ambiguous key/code maps", () => {
	const action = vi.fn();
	const context = new InputContext(
		{ first: [{ code: "Digit3" }], second: [{ code: "Digit4" }] },
		action,
	);
	context.apply({ key: "#", code: "Digit3", shiftKey: true }, true);
	context.apply({ key: "3", code: "Digit3", shiftKey: false }, false);
	expect(action.mock.calls).toEqual([
		["first", true],
		["first", false],
	]);
	expect(
		() =>
			new InputContext(
				{ first: [{ code: "Digit3" }], second: [{ code: "Digit3" }] },
				vi.fn(),
			),
	).toThrow("overlap");
	const mixed = new InputContext(
		{ first: [{ code: "KeyQ" }], second: [{ key: "q" }] },
		vi.fn(),
	);
	expect(() =>
		mixed.apply({ key: "a", code: "KeyQ", shiftKey: false }, true),
	).not.toThrow();
	mixed.reset();
	expect(() =>
		mixed.apply({ key: "q", code: "KeyQ", shiftKey: false }, true),
	).toThrow("Input event matches multiple actions: first, second.");
});
