import { describe, expect, it, vi } from "vitest";

import { trackPointerGesture } from "./pointer-gesture";

function pointerEvent(type: string, pointerId: number): PointerEvent {
	const event = new Event(type);
	Object.defineProperty(event, "pointerId", { value: pointerId });
	return event as PointerEvent;
}

describe("trackPointerGesture", () => {
	it("tracks only the selected pointer until its gesture ends", () => {
		const events = new EventTarget();
		const update = vi.fn();
		trackPointerGesture(events as unknown as Window, 7, update);

		events.dispatchEvent(pointerEvent("pointermove", 8));
		events.dispatchEvent(pointerEvent("pointerup", 8));
		events.dispatchEvent(pointerEvent("pointermove", 7));
		expect(update).toHaveBeenCalledTimes(1);

		events.dispatchEvent(pointerEvent("pointercancel", 7));
		events.dispatchEvent(pointerEvent("pointermove", 7));
		expect(update).toHaveBeenCalledTimes(1);
	});

	it("returns an idempotent cancellation function", () => {
		const events = new EventTarget();
		const update = vi.fn();
		const cancel = trackPointerGesture(events as unknown as Window, 7, update);

		cancel();
		cancel();
		events.dispatchEvent(pointerEvent("pointermove", 7));
		expect(update).not.toHaveBeenCalled();
	});
});
