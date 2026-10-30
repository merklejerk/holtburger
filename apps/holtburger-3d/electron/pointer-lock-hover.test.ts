import { describe, expect, it, vi } from "vitest";
import type { MouseInputEvent } from "electron";
import {
	PointerLockHover,
	type PointerPosition,
} from "./pointer-lock-hover.js";

/** Distinct widget/screen origins expose accidental mixing of the two coordinate systems. */
const ORIGIN: PointerPosition = { x: 100, y: 80, globalX: 120, globalY: 165 };
const DISPLACED = { x: 300, y: 480, globalX: 320, globalY: 565 };

function fixture() {
	const sent: MouseInputEvent[] = [];
	const preventDefault = vi.fn();
	const contents = {
		isDestroyed: vi.fn(() => false),
		isFocused: vi.fn(() => true),
		sendInputEvent(input: MouseInputEvent) {
			sent.push(input);
			// Electron re-enters before-mouse-event for injected input as well.
			owner.beforeMouse({ preventDefault }, input);
		},
	};
	const owner = new PointerLockHover(contents);
	const native = (input: MouseInputEvent) =>
		owner.beforeMouse({ preventDefault }, input);
	return { owner, contents, sent, preventDefault, native };
}

describe("Wayland pointer-lock hover restoration", () => {
	it("restores hover and click targeting without resetting the native screen-position baseline", () => {
		const test = fixture();
		test.owner.restore(ORIGIN);
		test.native({
			type: "mouseDown",
			button: "left",
			clickCount: 2,
			modifiers: ["shift"],
			...DISPLACED,
		});
		test.native({ type: "mouseUp", button: "left", ...DISPLACED });
		expect(test.sent).toEqual([
			{ type: "mouseMove", ...ORIGIN },
			{
				type: "mouseDown",
				button: "left",
				clickCount: 2,
				modifiers: ["shift"],
				...DISPLACED,
				x: ORIGIN.x,
				y: ORIGIN.y,
			},
			{
				type: "mouseUp",
				button: "left",
				...DISPLACED,
				x: ORIGIN.x,
				y: ORIGIN.y,
			},
		]);
		expect(test.preventDefault).toHaveBeenCalledTimes(2);
	});

	it.each(["mouseMove", "mouseEnter", "mouseLeave"] as const)(
		"lets %s retire the correction before subsequent clicks",
		(type) => {
			const test = fixture();
			test.owner.restore(ORIGIN);
			test.native({ type, ...DISPLACED });
			test.native({ type: "mouseDown", button: "right", ...DISPLACED });
			expect(test.preventDefault).not.toHaveBeenCalled();
			expect(test.sent).toEqual([{ type: "mouseMove", ...ORIGIN }]);
		},
	);

	it("does not inject an old unlock into a newly held mouse gesture", () => {
		const test = fixture();
		test.native({ type: "mouseDown", button: "left", ...DISPLACED });
		test.owner.restore(ORIGIN);
		expect(test.sent).toEqual([]);
		test.native({ type: "mouseUp", button: "left", ...DISPLACED });
		test.owner.restore(ORIGIN);
		expect(test.sent).toEqual([{ type: "mouseMove", ...ORIGIN }]);
	});

	it("drops correction and held state when the document or window loses ownership", () => {
		const test = fixture();
		test.owner.restore(ORIGIN);
		test.native({ type: "mouseDown", button: "middle", ...DISPLACED });
		test.owner.clear();
		test.preventDefault.mockClear();
		test.native({ type: "mouseUp", button: "middle", ...DISPLACED });
		expect(test.preventDefault).not.toHaveBeenCalled();
		test.owner.restore(ORIGIN);
		expect(test.sent.at(-1)).toEqual({ type: "mouseMove", ...ORIGIN });
	});

	it("does not inject into an unfocused or destroyed window", () => {
		const test = fixture();
		test.contents.isFocused.mockReturnValue(false);
		test.owner.restore(ORIGIN);
		test.contents.isFocused.mockReturnValue(true);
		test.contents.isDestroyed.mockReturnValue(true);
		test.owner.restore(ORIGIN);
		expect(test.sent).toEqual([]);
	});
});
