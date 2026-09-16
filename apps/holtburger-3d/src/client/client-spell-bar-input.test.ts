import { expect, it, vi } from "vitest";
import { handleSpellBarKeydown } from "./client-spell-bar-input";
import { SPELL_BAR_INDICES } from "./client-spell-bar-state";
import { KeyboardInputPolicy } from "../lib/input/keyboard-input-policy";
import { ViewportInputGate } from "../lib/input/viewport-input-gate";

/** Physical key facts exercised through the production game-dispatch function. */
function event(
	index: number,
	modifiers: Partial<KeyboardEvent>,
): KeyboardEvent {
	return Object.assign(
		new Event("keydown", { cancelable: true }),
		{
			key: String((index + 1) % 10),
			code: `Digit${(index + 1) % 10}`,
			shiftKey: false,
			ctrlKey: false,
			altKey: false,
			metaKey: false,
			repeat: false,
			isComposing: false,
		},
		modifiers,
	) as KeyboardEvent;
}
it("maps every numbered tab/cell and consumes repeats without executing", () => {
	const tab = vi.fn();
	const cast = vi.fn();
	for (const index of SPELL_BAR_INDICES) {
		expect(handleSpellBarKeydown(event(index, {}), true, tab, cast)).toBe(true);
		expect(cast).toHaveBeenLastCalledWith(index);
		expect(
			handleSpellBarKeydown(
				event(index, { shiftKey: true, key: ")" }),
				true,
				tab,
				cast,
			),
		).toBe(true);
		expect(tab).toHaveBeenLastCalledWith(index);
	}
	handleSpellBarKeydown(event(0, { repeat: true }), true, tab, cast);
	expect(cast).toHaveBeenCalledTimes(SPELL_BAR_INDICES.length);
	expect(tab).toHaveBeenCalledTimes(SPELL_BAR_INDICES.length);
	for (const modifier of [
		{ ctrlKey: true },
		{ altKey: true },
		{ metaKey: true },
		{ isComposing: true },
	]) {
		expect(handleSpellBarKeydown(event(0, modifier), true, tab, cast)).toBe(
			false,
		);
	}
	expect(handleSpellBarKeydown(event(0, {}), false, tab, cast)).toBe(false);
	const consumed = event(0, {});
	consumed.preventDefault();
	expect(handleSpellBarKeydown(consumed, true, tab, cast)).toBe(false);
});
it("uses the existing keyboard gate and quarantines repeat presses across blocking", () => {
	const viewport = new ViewportInputGate();
	const keyboard = new KeyboardInputPolicy(viewport);
	const cast = vi.fn();
	keyboard.bindGame({
		keydown: (key) => {
			handleSpellBarKeydown(key, true, () => {}, cast);
		},
		keyup: () => {},
		cancel: () => {},
	});
	keyboard.keydown(event(0, {}));
	expect(cast).toHaveBeenCalledOnce();
	const release = viewport.block();
	keyboard.keydown(event(1, {}));
	release();
	keyboard.keydown(event(1, { repeat: true }));
	expect(cast).toHaveBeenCalledOnce();
	keyboard.keyup(event(1, {}));
	keyboard.keydown(event(1, {}));
	expect(cast).toHaveBeenCalledTimes(2);
});
