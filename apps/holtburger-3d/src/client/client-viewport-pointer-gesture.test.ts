import { describe, expect, it } from "vitest";

import {
	advanceClientViewportPointerGesture,
	beginClientViewportPointerGesture,
} from "./client-viewport-pointer-gesture";

describe("client viewport pointer gesture", () => {
	it("keeps click-scale jitter armed without emitting orbit", () => {
		const started = beginClientViewportPointerGesture(7, 10, 20);
		const advanced = advanceClientViewportPointerGesture(started, 12, 22);

		expect(advanced.gesture.dragging).toBe(false);
		expect(advanced.orbitDelta).toBeNull();
	});

	it("emits the full threshold-crossing delta then incremental orbit", () => {
		const started = beginClientViewportPointerGesture(7, 10, 20);
		const jitter = advanceClientViewportPointerGesture(started, 12, 22);
		const crossed = advanceClientViewportPointerGesture(jitter.gesture, 14, 24);
		const continued = advanceClientViewportPointerGesture(
			crossed.gesture,
			15,
			22,
		);

		expect(crossed.orbitDelta).toEqual({ x: 4, y: 4 });
		expect(continued.orbitDelta).toEqual({ x: 1, y: -2 });
	});
});
