import { describe, expect, it } from "vitest";

import {
	CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS,
	advanceClientViewportPointerGesture,
	beginClientViewportPointerGesture,
} from "./client-viewport-pointer-gesture";

describe("client viewport pointer gesture", () => {
	it("keeps click-scale jitter armed without emitting orbit", () => {
		const started = beginClientViewportPointerGesture();
		const advanced = advanceClientViewportPointerGesture(
			started,
			CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS / 4,
			CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS / 4,
		);

		expect(advanced.gesture.kind).toBe("pending");
		expect(advanced.dragDelta).toBeNull();
	});

	it("emits the full threshold-crossing delta then incremental orbit", () => {
		const started = beginClientViewportPointerGesture();
		const jitterDistance = CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS / 4;
		const jitter = advanceClientViewportPointerGesture(
			started,
			jitterDistance,
			jitterDistance,
		);
		const displacement = CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS + 1;
		const crossed = advanceClientViewportPointerGesture(
			jitter.gesture,
			displacement - jitterDistance,
			displacement - jitterDistance,
		);
		const continued = advanceClientViewportPointerGesture(
			crossed.gesture,
			1,
			-2,
		);

		expect(crossed.dragDelta).toEqual({ x: displacement, y: displacement });
		expect(continued.dragDelta).toEqual({ x: 1, y: -2 });
	});

	it("uses net jitter displacement and ignores motionless samples after dragging", () => {
		const jitterDistance = CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS / 2;
		const jitter = advanceClientViewportPointerGesture(
			beginClientViewportPointerGesture(),
			jitterDistance,
			0,
		);
		const returned = advanceClientViewportPointerGesture(
			jitter.gesture,
			-jitterDistance,
			0,
		);
		expect(returned.gesture.kind).toBe("pending");
		expect(returned.dragDelta).toBeNull();
		const dragged = advanceClientViewportPointerGesture(
			returned.gesture,
			CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS + 1,
			0,
		);
		const stationary = advanceClientViewportPointerGesture(
			dragged.gesture,
			0,
			0,
		);
		expect(stationary.gesture.kind).toBe("dragging");
		expect(stationary.dragDelta).toBeNull();
	});
});
