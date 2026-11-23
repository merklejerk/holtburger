import { describe, expect, it } from "vitest";

import {
	VIEWPORT_DRAG_THRESHOLD_PIXELS,
	advanceViewportPointerGesture,
	beginViewportPointerGesture,
} from "./viewport-pointer-gesture";

describe("viewport pointer gesture", () => {
	it("keeps click-scale jitter armed without emitting orbit", () => {
		const started = beginViewportPointerGesture();
		const advanced = advanceViewportPointerGesture(
			started,
			VIEWPORT_DRAG_THRESHOLD_PIXELS / 4,
			VIEWPORT_DRAG_THRESHOLD_PIXELS / 4,
		);

		expect(advanced.gesture.kind).toBe("pending");
		expect(advanced.dragDelta).toBeNull();
	});

	it("emits the full threshold-crossing delta then incremental orbit", () => {
		const started = beginViewportPointerGesture();
		const jitterDistance = VIEWPORT_DRAG_THRESHOLD_PIXELS / 4;
		const jitter = advanceViewportPointerGesture(
			started,
			jitterDistance,
			jitterDistance,
		);
		const displacement = VIEWPORT_DRAG_THRESHOLD_PIXELS + 1;
		const crossed = advanceViewportPointerGesture(
			jitter.gesture,
			displacement - jitterDistance,
			displacement - jitterDistance,
		);
		const continued = advanceViewportPointerGesture(crossed.gesture, 1, -2);

		expect(crossed.dragDelta).toEqual({ x: displacement, y: displacement });
		expect(continued.dragDelta).toEqual({ x: 1, y: -2 });
	});

	it("uses net jitter displacement and ignores motionless samples after dragging", () => {
		const jitterDistance = VIEWPORT_DRAG_THRESHOLD_PIXELS / 2;
		const jitter = advanceViewportPointerGesture(
			beginViewportPointerGesture(),
			jitterDistance,
			0,
		);
		const returned = advanceViewportPointerGesture(
			jitter.gesture,
			-jitterDistance,
			0,
		);
		expect(returned.gesture.kind).toBe("pending");
		expect(returned.dragDelta).toBeNull();
		const dragged = advanceViewportPointerGesture(
			returned.gesture,
			VIEWPORT_DRAG_THRESHOLD_PIXELS + 1,
			0,
		);
		const stationary = advanceViewportPointerGesture(dragged.gesture, 0, 0);
		expect(stationary.gesture.kind).toBe("dragging");
		expect(stationary.dragDelta).toBeNull();
	});
});
