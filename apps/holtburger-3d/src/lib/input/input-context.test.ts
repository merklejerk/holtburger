import { describe, expect, it, vi } from "vitest";
import { InputContext } from "./input-context";
import { AppInput } from "./app-input";
import { INPUT_DEFAULTS } from "./input-defaults";

describe("InputContext", () => {
	it("maps unmodified number keys 1–5 to combat breakpoints", () => {
		const input = new AppInput(INPUT_DEFAULTS);
		for (const [index, digit] of ["1", "2", "3", "4", "5"].entries()) {
			expect(
				input.combatBreakpoint({
					key: digit,
					code: `Digit${digit}`,
					shiftKey: false,
					ctrlKey: false,
					altKey: false,
					metaKey: false,
				}),
			).toBe(index);
		}
		expect(
			input.combatBreakpoint({
				key: "!",
				code: "Digit1",
				shiftKey: true,
			}),
		).toBeNull();
	});

	it("binds auto-run to unmodified Q while permitting the walk modifier", () => {
		const input = new AppInput(INPUT_DEFAULTS);
		for (const shiftKey of [false, true]) {
			expect(
				input.shortcut("toggleAutoRun", {
					key: "Q",
					shiftKey,
					ctrlKey: false,
					altKey: false,
					metaKey: false,
				}),
			).toBe(true);
		}
		for (const modifier of ["ctrlKey", "altKey", "metaKey"] as const) {
			expect(
				input.shortcut("toggleAutoRun", {
					key: "q",
					shiftKey: false,
					ctrlKey: false,
					altKey: false,
					metaKey: false,
					[modifier]: true,
				}),
			).toBe(false);
		}
	});

	it("binds both backquote characters without consuming modified system chords", () => {
		const input = new AppInput(INPUT_DEFAULTS);
		for (const [key, shiftKey] of [
			["`", false],
			["~", true],
		] as const) {
			const event = {
				key,
				shiftKey,
				ctrlKey: false,
				altKey: false,
				metaKey: false,
			};
			expect(input.shortcut("toggleCombat", event)).toBe(true);
			for (const modifier of ["ctrlKey", "altKey", "metaKey"] as const) {
				expect(
					input.shortcut("toggleCombat", { ...event, [modifier]: true }),
				).toBe(false);
			}
		}
	});

	it("resolves give from the configured chord rather than the default key", () => {
		const input = new AppInput({
			...INPUT_DEFAULTS,
			client: { ...INPUT_DEFAULTS.client, give: [{ key: "F9", ctrl: true }] },
		});
		expect(
			input.shortcut("give", { key: "F9", shiftKey: false, ctrlKey: true }),
		).toBe(true);
		expect(
			input.shortcut("give", { key: "F9", shiftKey: false, ctrlKey: false }),
		).toBe(false);
		const original = INPUT_DEFAULTS.client.give[0];
		expect(
			input.shortcut("give", {
				key: original.key,
				shiftKey: false,
				ctrlKey: original.ctrl,
				altKey: original.alt,
				metaKey: original.meta,
			}),
		).toBe(false);
	});

	it("resolves an alternate configured examine binding with exact modifiers", () => {
		const input = new AppInput({
			...INPUT_DEFAULTS,
			client: {
				...INPUT_DEFAULTS.client,
				examine: [
					{
						code: "KeyQ",
						shift: true,
						ctrl: false,
						alt: false,
						meta: false,
					},
				],
			},
		});
		expect(
			input.shortcut("examine", {
				key: "Q",
				code: "KeyQ",
				shiftKey: true,
			}),
		).toBe(true);
		expect(
			input.shortcut("examine", {
				key: "Q",
				code: "KeyQ",
				shiftKey: false,
			}),
		).toBe(false);
	});

	it("resolves configured modifiers held before pointer focus", () => {
		const context = new InputContext(
			{ precision: [{ key: "Control" }] },
			vi.fn(),
		);
		expect(
			context.modifierActive("precision", {
				shiftKey: false,
				getModifierState: (key) => key === "Control",
			}),
		).toBe(true);
		expect(
			context.modifierActive("precision", {
				shiftKey: true,
				getModifierState: (key) => key === "Shift",
			}),
		).toBe(false);
	});
	it("rejects ambiguous actions within a context while permitting distinct chords", () => {
		expect(
			() =>
				new InputContext(
					{
						forward: [{ key: "w" }],
						jump: [{ key: "W", shift: true }],
					},
					vi.fn(),
				),
		).toThrow("Input bindings overlap for forward and jump.");
		expect(
			() =>
				new InputContext(
					{
						forward: [{ key: "w", shift: false }],
						jump: [{ key: "W", shift: true }],
					},
					vi.fn(),
				),
		).not.toThrow();
	});
	it("retains the press mapping through modifier changes and ignores repeat", () => {
		const action = vi.fn();
		const context = new InputContext(
			{ activate: [{ key: "j", shift: true }] },
			action,
		);
		const press = { key: "J", code: "KeyJ", shiftKey: true };
		context.apply(press, true);
		context.apply({ ...press, repeat: true }, true);
		context.apply({ ...press, key: "j", shiftKey: false }, false);
		expect(action.mock.calls).toEqual([
			["activate", true],
			["activate", false],
		]);
	});

	it("keeps an action held until its final physical binding releases", () => {
		const action = vi.fn();
		const context = new InputContext(
			{ ascend: [{ key: "q" }, { key: "PageUp" }] },
			action,
		);
		const first = { key: "q", code: "KeyQ", shiftKey: false };
		const second = { key: "PageUp", code: "PageUp", shiftKey: false };
		context.apply(first, true);
		context.apply(second, true);
		context.apply(first, false);
		expect(action.mock.calls).toEqual([["ascend", true]]);
		context.apply(second, false);
		expect(action.mock.calls).toEqual([
			["ascend", true],
			["ascend", false],
		]);
	});

	it("cancels without a release action and requires a fresh press after reset", () => {
		const action = vi.fn();
		const context = new InputContext({ jump: [{ key: "x" }] }, action);
		const event = { key: "x", code: "KeyX", shiftKey: false };
		context.apply(event, true);
		context.reset();
		context.apply({ ...event, repeat: true }, true);
		expect(context.apply(event, false)).toBe(false);
		expect(action.mock.calls).toEqual([["jump", true]]);
		context.apply(event, true);
		expect(action).toHaveBeenCalledTimes(2);
	});

	it("uses an injected configuration for keyboard and pointer mappings", () => {
		const input = new AppInput({
			...INPUT_DEFAULTS,
			character: { ...INPUT_DEFAULTS.character, forward: [{ key: "ArrowUp" }] },
			pointer: { ...INPUT_DEFAULTS.pointer, clientInteract: [2] },
		});
		const action = vi.fn();
		const context = input.characterContext(action);
		context.apply({ key: "ArrowUp", shiftKey: false }, true);
		expect(action).toHaveBeenCalledWith("forward", true);
		expect(input.pointer("clientInteract", { button: 2 })).toBe(true);
		expect(input.pointer("clientInteract", { button: 0 })).toBe(false);
		expect(input.pointer("clientExamine", { button: 2 })).toBe(true);
	});
});
