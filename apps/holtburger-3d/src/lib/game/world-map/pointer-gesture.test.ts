import { describe, expect, it, vi } from "vitest";
import { trackWorldMapGesture } from "./pointer-gesture";

function pointer(
	type: string,
	x: number,
	y: number,
	pointerId = 7,
): PointerEvent {
	const event = new Event(type);
	Object.defineProperties(event, {
		pointerId: { value: pointerId },
		clientX: { value: x },
		clientY: { value: y },
	});
	return event as PointerEvent;
}

function gesture() {
	const target = new EventTarget();
	const pan = vi.fn();
	const cancel = trackWorldMapGesture(
		target as unknown as Window,
		pointer("pointerdown", 20, 30),
		5,
		pan,
	);
	return { target, pan, cancel };
}

describe("map pointer gesture", () => {
	it("ignores jitter and stops tracking at release", () => {
		const { target, pan } = gesture();
		target.dispatchEvent(pointer("pointermove", 23, 34));
		const release = pointer("pointerup", 22, 31);
		target.dispatchEvent(release);
		target.dispatchEvent(release);
		target.dispatchEvent(pointer("pointermove", 100, 100));
		expect(pan).not.toHaveBeenCalled();
	});
	it("keeps panning after crossing the threshold even when returning to the origin", () => {
		const { target, pan } = gesture();
		target.dispatchEvent(pointer("pointermove", 26, 30));
		target.dispatchEvent(pointer("pointermove", 20, 30));
		target.dispatchEvent(pointer("pointerup", 20, 30));
		expect(pan.mock.calls).toEqual([
			[6, 0],
			[0, 0],
		]);
	});
	it("does not pan from release travel without a move event", () => {
		const { target, pan } = gesture();
		target.dispatchEvent(pointer("pointerup", 30, 30));
		expect(pan).not.toHaveBeenCalled();
	});
	it("ignores sibling pointers and aborts on cancellation", () => {
		const { target, pan } = gesture();
		target.dispatchEvent(pointer("pointermove", 100, 100, 8));
		target.dispatchEvent(pointer("pointerup", 20, 30, 8));
		target.dispatchEvent(pointer("pointercancel", 20, 30));
		target.dispatchEvent(pointer("pointerup", 20, 30));
		expect(pan).not.toHaveBeenCalled();
	});
	it("external cancellation removes every gesture listener", () => {
		const { target, pan, cancel } = gesture();
		cancel();
		cancel();
		target.dispatchEvent(pointer("pointermove", 50, 30));
		target.dispatchEvent(pointer("pointerup", 20, 30));
		expect(pan).not.toHaveBeenCalled();
	});
});
