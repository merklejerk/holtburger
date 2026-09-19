import { expect, it, vi } from "vitest";
import { handleCombatBarKeydown } from "./client-combat-bar-input";

/** Physical digit facts exercised through the production combat dispatcher. */
function digit(
	value: number,
	modifiers: Partial<KeyboardEvent> = {},
): KeyboardEvent {
	return Object.assign(
		new Event("keydown", { cancelable: true }),
		{
			key: String(value),
			code: `Digit${value}`,
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

it("routes plain digits to power and shifted digits to attack height", () => {
	const selectBreakpoint = vi.fn();
	const selectHeight = vi.fn();
	for (const value of [1, 2, 3]) {
		expect(
			handleCombatBarKeydown(
				digit(value),
				true,
				selectBreakpoint,
				selectHeight,
			),
		).toBe(true);
		expect(selectBreakpoint).toHaveBeenLastCalledWith(value - 1);
		expect(
			handleCombatBarKeydown(
				digit(value, { shiftKey: true }),
				true,
				selectBreakpoint,
				selectHeight,
			),
		).toBe(true);
		expect(selectHeight).toHaveBeenLastCalledWith(value - 1);
	}
});

it("consumes repeats without selecting and yields when combat is inactive", () => {
	const selectBreakpoint = vi.fn();
	const selectHeight = vi.fn();
	expect(
		handleCombatBarKeydown(
			digit(1, { shiftKey: true, repeat: true }),
			true,
			selectBreakpoint,
			selectHeight,
		),
	).toBe(true);
	expect(selectBreakpoint).not.toHaveBeenCalled();
	expect(selectHeight).not.toHaveBeenCalled();
	expect(
		handleCombatBarKeydown(
			digit(1, { shiftKey: true }),
			false,
			selectBreakpoint,
			selectHeight,
		),
	).toBe(false);
});
