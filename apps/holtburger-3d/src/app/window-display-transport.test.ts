import { describe, expect, it, vi } from "vitest";
import type { WindowDisplaySnapshot } from "./window-display-contract";
import { observeWindowDisplay } from "./window-display-transport";

const snapshot: WindowDisplaySnapshot = {
	fullscreen: false,
	freeResize: true,
	busy: false,
	vsyncRefreshHz: 144,
	contentSize: { width: 1024, height: 768 },
	presets: [],
};

describe("native display observation", () => {
	it("retains a monitor event that arrives before an older bootstrap reply", async () => {
		const initial = Promise.resolve(snapshot);
		const handlers = new Set<(value: unknown) => void>();
		const accept = vi.fn();
		const report = vi.fn();
		const stop = observeWindowDisplay(
			{
				snapshot: () => initial,
				change: async () => {},
				onState: (handler) => {
					handlers.add(handler);
					return () => handlers.delete(handler);
				},
			},
			accept,
			report,
		);
		for (const handler of handlers)
			handler({ ...snapshot, vsyncRefreshHz: 60 });
		await initial;
		expect(accept).toHaveBeenCalledTimes(1);
		expect(accept).toHaveBeenLastCalledWith({
			...snapshot,
			vsyncRefreshHz: 60,
		});
		expect(report).not.toHaveBeenCalled();
		stop();
		expect(handlers.size).toBe(0);
	});

	it("ignores bootstrap completion after the consumer unmounts", async () => {
		const initial = Promise.resolve(snapshot);
		const accept = vi.fn();
		const report = vi.fn();
		const unsubscribe = vi.fn();
		const stop = observeWindowDisplay(
			{
				snapshot: () => initial,
				change: async () => {},
				onState: () => unsubscribe,
			},
			accept,
			report,
		);
		stop();
		await initial;
		expect(accept).not.toHaveBeenCalled();
		expect(report).not.toHaveBeenCalled();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
