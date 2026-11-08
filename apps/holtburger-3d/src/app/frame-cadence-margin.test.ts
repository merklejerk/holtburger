import { afterEach, describe, expect, it, vi } from "vitest";
import {
	readFrameCadenceMargin,
	startFrameLoopWithCadenceMargin,
} from "./frame-cadence-margin";
import { BACKGROUND_FRAME_INTERVAL_MS } from "./presentation-frame-loop";

/** A display clock independent of the ordinary task queue used for paced rendering. */
function browserClock() {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
	let focused = true;
	let nextHandle = 0;
	const callbacks = new Map<number, FrameRequestCallback>();
	vi.stubGlobal("document", { hasFocus: () => focused });
	vi.stubGlobal("window", {
		requestAnimationFrame: (callback: FrameRequestCallback) => {
			const handle = ++nextHandle;
			callbacks.set(handle, callback);
			return handle;
		},
		cancelAnimationFrame: (handle: number) => callbacks.delete(handle),
		reportError: vi.fn(),
		scheduler: {
			postTask: (
				callback: () => void,
				options: { delay?: number; signal?: AbortSignal },
			) =>
				new Promise<void>((resolve, reject) => {
					const abort = () => {
						clearTimeout(handle);
						reject(new DOMException("Task aborted", "AbortError"));
					};
					const handle = setTimeout(() => {
						options.signal?.removeEventListener("abort", abort);
						try {
							callback();
							resolve();
						} catch (error) {
							reject(error);
						}
					}, options.delay ?? 0);
					options.signal?.addEventListener("abort", abort, { once: true });
				}),
		},
	});
	const displayHz = 60;
	return {
		displayHz,
		focus: (value: boolean) => {
			focused = value;
		},
		refresh: async (durationMs: number) => {
			for (
				let index = 0;
				index < Math.round((durationMs * displayHz) / 1000);
				index++
			) {
				await vi.advanceTimersByTimeAsync(1000 / displayHz);
				const pending = [...callbacks.values()];
				callbacks.clear();
				for (const callback of pending) callback(performance.now());
				await vi.advanceTimersByTimeAsync(0);
			}
		},
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("frame cadence margin", () => {
	it("uses the supplied tuning default and lets explicit CLI values override it", () => {
		const configuredDefault = 7;
		expect(readFrameCadenceMargin("", configuredDefault)).toBe(
			configuredDefault,
		);
		expect(
			readFrameCadenceMargin("?frame-cadence-margin=10", configuredDefault),
		).toBe(10);
		expect(
			readFrameCadenceMargin("?frame-cadence-margin=0", configuredDefault),
		).toBe(0);
	});
	it.each(["", "true", "-1", "101", "NaN", "Infinity"])(
		"rejects invalid percentage %s",
		(value) => {
			expect(() =>
				readFrameCadenceMargin("?frame-cadence-margin=" + value, 7),
			).toThrow("percentage");
		},
	);
	it("uses the native display cadence when the margin is zero", async () => {
		const browser = browserClock();
		const frame = vi.fn();
		const stop = startFrameLoopWithCadenceMargin(frame, () => 0, 0);
		await browser.refresh(1000);
		expect(frame).toHaveBeenCalledTimes(browser.displayHz);
		stop();
	});
	it("generates the requested extra frames between display refreshes", async () => {
		const browser = browserClock();
		const frame = vi.fn();
		const margin = 10;
		const stop = startFrameLoopWithCadenceMargin(frame, () => 0, margin);
		await browser.refresh(1000);
		frame.mockClear();
		await browser.refresh(1000);
		const expected = browser.displayHz * (1 + margin / 100);
		expect(Math.abs(frame.mock.calls.length - expected)).toBeLessThanOrEqual(1);
		stop();
	});
	it("retains background throttling and resumes foreground pacing", async () => {
		const browser = browserClock();
		const frame = vi.fn();
		const stop = startFrameLoopWithCadenceMargin(frame, () => 0, 10);
		await browser.refresh(1000);
		browser.focus(false);
		frame.mockClear();
		const duration = BACKGROUND_FRAME_INTERVAL_MS * 6;
		await browser.refresh(duration);
		expect(frame.mock.calls.length).toBeGreaterThan(0);
		expect(frame.mock.calls.length).toBeLessThanOrEqual(
			duration / BACKGROUND_FRAME_INTERVAL_MS,
		);
		browser.focus(true);
		frame.mockClear();
		await browser.refresh(100);
		expect(frame.mock.calls.length).toBeGreaterThan(1);
		stop();
	});
	it("cancels queued rendering and observation on stop", async () => {
		const browser = browserClock();
		const frame = vi.fn();
		const stop = startFrameLoopWithCadenceMargin(frame, () => 0, 10);
		await browser.refresh(1000);
		frame.mockClear();
		stop();
		await browser.refresh(1000);
		expect(frame).not.toHaveBeenCalled();
		expect(window.reportError).not.toHaveBeenCalled();
	});
});
