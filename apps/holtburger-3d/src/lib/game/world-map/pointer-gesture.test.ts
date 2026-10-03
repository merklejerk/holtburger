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
	const pan = vi.fn(),
		click = vi.fn();
	const cancel = trackWorldMapGesture(
		target as unknown as Window,
		pointer("pointerdown", 20, 30),
		5,
		pan,
		click,
	);
	return { target, pan, click, cancel };
}

describe("map pointer gesture", () => {
	it("allows jitter and dispatches exactly once at release", () => {
		const { target, pan, click } = gesture();
		target.dispatchEvent(pointer("pointermove", 23, 34));
		const release = pointer("pointerup", 22, 31);
		target.dispatchEvent(release);
		target.dispatchEvent(release);
		expect(pan).not.toHaveBeenCalled();
		expect(click).toHaveBeenCalledExactlyOnceWith(release);
	});
	it("never clicks after crossing the threshold, even if panning is clamped or returns", () => {
		const { target, pan, click } = gesture();
		target.dispatchEvent(pointer("pointermove", 26, 30));
		target.dispatchEvent(pointer("pointermove", 20, 30));
		target.dispatchEvent(pointer("pointerup", 20, 30));
		expect(pan.mock.calls).toEqual([
			[6, 0],
			[0, 0],
		]);
		expect(click).not.toHaveBeenCalled();
	});
	it("rejects release travel even without a move event", () => {
		const { target, click } = gesture();
		target.dispatchEvent(pointer("pointerup", 30, 30));
		expect(click).not.toHaveBeenCalled();
	});
	it("ignores sibling pointers and aborts on cancellation", () => {
		const { target, pan, click } = gesture();
		target.dispatchEvent(pointer("pointermove", 100, 100, 8));
		target.dispatchEvent(pointer("pointerup", 20, 30, 8));
		target.dispatchEvent(pointer("pointercancel", 20, 30));
		target.dispatchEvent(pointer("pointerup", 20, 30));
		expect(pan).not.toHaveBeenCalled();
		expect(click).not.toHaveBeenCalled();
	});
	it("external cancellation removes every gesture listener", () => {
		const { target, pan, click, cancel } = gesture();
		cancel();
		cancel();
		target.dispatchEvent(pointer("pointermove", 50, 30));
		target.dispatchEvent(pointer("pointerup", 20, 30));
		expect(pan).not.toHaveBeenCalled();
		expect(click).not.toHaveBeenCalled();
	});
});
