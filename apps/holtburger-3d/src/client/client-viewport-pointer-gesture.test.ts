import { describe, expect, it } from "vitest";

import {
	CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS,
	advanceClientViewportPointerGesture,
	beginClientViewportPointerGesture,
} from "./client-viewport-pointer-gesture";

describe("client viewport pointer gesture", () => {
	it("keeps click-scale jitter armed without emitting orbit", () => {
		const started = beginClientViewportPointerGesture(10, 20);
		const advanced = advanceClientViewportPointerGesture(
			started,
			10 + CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS / 4,
			20 + CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS / 4,
		);

		expect(advanced.gesture.dragging).toBe(false);
		expect(advanced.dragDelta).toBeNull();
	});

	it("emits the full threshold-crossing delta then incremental orbit", () => {
		const started = beginClientViewportPointerGesture(10, 20);
		const jitter = advanceClientViewportPointerGesture(
			started,
			10 + CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS / 4,
			20 + CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS / 4,
		);
		const displacement = CLIENT_VIEWPORT_DRAG_THRESHOLD_PIXELS + 1;
		const crossed = advanceClientViewportPointerGesture(
			jitter.gesture,
			10 + displacement,
			20 + displacement,
		);
		const continued = advanceClientViewportPointerGesture(
			crossed.gesture,
			11 + displacement,
			18 + displacement,
		);

		expect(crossed.dragDelta).toEqual({ x: displacement, y: displacement });
		expect(continued.dragDelta).toEqual({ x: 1, y: -2 });
	});
});
