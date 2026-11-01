import { afterEach, describe, expect, it, vi } from "vitest";
import { UiTooltipController } from "./ui-tooltip";

const timing = { openDelayMs: 40, switchGraceMs: 80, closeDelayMs: 20 };
function fixture() {
	vi.useFakeTimers();
	const publish = vi.fn();
	const removed = new Set<string>();
	const controller = new UiTooltipController(
		timing,
		(target: string) => !removed.has(target),
		publish,
		Date.now,
	);
	return { controller, publish, removed };
}
afterEach(() => vi.useRealTimers());

describe("cell tooltip disclosure", () => {
	it("dwells once, switches immediately, and expires browsing grace", () => {
		const { controller, publish } = fixture();
		controller.point("a");
		vi.advanceTimersByTime(timing.openDelayMs - 1);
		controller.point("a");
		expect(controller.visible).toBeNull();
		expect(publish.mock.calls).toEqual([[{ kind: "pending", target: "a" }]]);
		vi.advanceTimersByTime(1);
		expect(controller.visible).toBe("a");
		controller.point("b");
		expect(controller.visible).toBe("b");
		controller.point(null);
		vi.advanceTimersByTime(timing.closeDelayMs);
		expect(controller.visible).toBeNull();
		controller.point("c");
		expect(controller.visible).toBe("c");
		controller.point(null);
		vi.advanceTimersByTime(timing.switchGraceMs);
		controller.point("d");
		expect(controller.visible).toBeNull();
		vi.advanceTimersByTime(timing.openDelayMs);
		expect(controller.visible).toBe("d");
	});

	it("publishes retired pending lifetimes on departure, invalidation and disposal", () => {
		const { controller, removed, publish } = fixture();
		controller.point("a");
		controller.point(null);
		vi.advanceTimersByTime(timing.openDelayMs);
		expect(controller.visible).toBeNull();
		expect(publish.mock.lastCall).toEqual([null]);
		controller.point("b");
		removed.add("b");
		vi.advanceTimersByTime(timing.openDelayMs);
		expect(controller.visible).toBeNull();
		expect(publish.mock.lastCall).toEqual([null]);
		controller.point("c");
		controller.reset();
		vi.runAllTimers();
		expect(publish.mock.calls).toEqual([
			[{ kind: "pending", target: "a" }],
			[null],
			[{ kind: "pending", target: "b" }],
			[null],
			[{ kind: "pending", target: "c" }],
			[null],
		]);
	});

	it("retains hoverable content and restores the remaining engagement", () => {
		const { controller } = fixture();
		controller.focus("a");
		expect(controller.visible).toBe("a");
		controller.point("b");
		expect(controller.visible).toBe("b");
		controller.point(null);
		expect(controller.visible).toBe("a");
		controller.hoverSurface(true);
		controller.focus(null);
		vi.advanceTimersByTime(timing.closeDelayMs * 2);
		expect(controller.visible).toBe("a");
		controller.hoverSurface(false);
		vi.advanceTimersByTime(timing.closeDelayMs);
		expect(controller.visible).toBeNull();
	});

	it("keeps Escape dismissed across label refreshes until fresh engagement", () => {
		const { controller } = fixture();
		controller.focus("a");
		controller.point("a");
		expect(controller.dismiss()).toBe(true);
		controller.refresh();
		controller.point("a");
		vi.runAllTimers();
		expect(controller.visible).toBeNull();
		controller.point("b");
		vi.advanceTimersByTime(timing.openDelayMs);
		expect(controller.visible).toBe("b");
		controller.point(null);
		vi.runAllTimers();
		expect(controller.visible).toBeNull();
		controller.focus(null);
		controller.focus("a");
		expect(controller.visible).toBe("a");
	});
});
