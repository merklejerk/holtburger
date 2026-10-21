import { afterEach, describe, expect, it, vi } from "vitest";
import {
	BACKGROUND_FRAME_INTERVAL_MS,
	startPresentationFrameLoop,
} from "./presentation-frame-loop";

/** Independently driven browser frame/task queues, focus, and timestamps. */
function browserFrames(focused: boolean) {
	let hasFocus = focused;
	let nextHandle = 0;
	const pending = new Map<number, FrameRequestCallback>();
	const tasks: (() => void)[] = [];
	const reportError = vi.fn();
	const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
		const handle = ++nextHandle;
		pending.set(handle, callback);
		return handle;
	});
	vi.stubGlobal("document", { hasFocus: () => hasFocus });
	vi.stubGlobal("window", {
		requestAnimationFrame,
		cancelAnimationFrame: (handle: number) => pending.delete(handle),
		reportError,
		scheduler: {
			postTask: (callback: () => void): Promise<void> =>
				new Promise((resolve, reject) => {
					tasks.push(() => {
						try {
							callback();
							resolve();
						} catch (error) {
							reject(error);
						}
					});
				}),
		},
	});
	const runTasks = (): void => {
		for (const task of tasks.splice(0)) task();
	};
	const deliver = (timeMs: number): void => {
		const callbacks = [...pending.values()];
		pending.clear();
		for (const callback of callbacks) callback(timeMs);
	};
	return {
		pending,
		tasks,
		requestAnimationFrame,
		reportError,
		deliver,
		runTasks,
		focus: (value: boolean) => {
			hasFocus = value;
		},
		advance: (timeMs: number) => {
			deliver(timeMs);
			runTasks();
		},
	};
}

afterEach(() => vi.unstubAllGlobals());

describe("presentation frame loop", () => {
	it("delivers every focused browser frame and releases the pending request on stop", () => {
		const browser = browserFrames(true);
		const frame = vi.fn();
		const stop = startPresentationFrameLoop(frame);
		const displayInterval = BACKGROUND_FRAME_INTERVAL_MS / 6;
		for (let index = 0; index < 6; index += 1)
			browser.advance(index * displayInterval);
		expect(frame).toHaveBeenCalledTimes(6);
		expect(browser.pending.size).toBe(1);
		stop();
		stop();
		expect(browser.pending.size).toBe(0);
		browser.advance(BACKGROUND_FRAME_INTERVAL_MS);
		expect(frame).toHaveBeenCalledTimes(6);
	});

	it("caps complete background frames without replaying missed frames after a stall", () => {
		const browser = browserFrames(false);
		const frame = vi.fn();
		const stop = startPresentationFrameLoop(frame);
		browser.advance(0);
		browser.advance(BACKGROUND_FRAME_INTERVAL_MS / 2);
		expect(frame).toHaveBeenCalledTimes(1);
		browser.advance(BACKGROUND_FRAME_INTERVAL_MS);
		expect(frame).toHaveBeenLastCalledWith(BACKGROUND_FRAME_INTERVAL_MS);
		browser.advance(BACKGROUND_FRAME_INTERVAL_MS * 20);
		expect(frame).toHaveBeenCalledTimes(3);
		browser.advance(BACKGROUND_FRAME_INTERVAL_MS * 20.5);
		expect(frame).toHaveBeenCalledTimes(3);
		stop();
	});

	it("applies focus changes on the next browser frame without waiting for the background interval", () => {
		const browser = browserFrames(true);
		const frame = vi.fn();
		const stop = startPresentationFrameLoop(frame);
		browser.advance(0);
		browser.focus(false);
		browser.advance(BACKGROUND_FRAME_INTERVAL_MS / 4);
		expect(frame).toHaveBeenCalledTimes(1);
		browser.focus(true);
		browser.advance(BACKGROUND_FRAME_INTERVAL_MS / 2);
		expect(frame).toHaveBeenCalledTimes(2);
		stop();
	});

	it("does not reschedule when the consumer stops during its frame", () => {
		const browser = browserFrames(true);
		const stop = startPresentationFrameLoop(() => stop());
		browser.deliver(0);
		expect(browser.pending.size).toBe(0);
		expect(browser.tasks).toHaveLength(0);
	});

	it("yields before re-arming while keeping drawing in the browser frame callback", () => {
		const browser = browserFrames(true);
		const frame = vi.fn();
		const stop = startPresentationFrameLoop(frame);
		browser.deliver(0);
		expect(frame).toHaveBeenCalledExactlyOnceWith(0);
		expect(browser.pending.size).toBe(0);
		browser.deliver(BACKGROUND_FRAME_INTERVAL_MS);
		expect(frame).toHaveBeenCalledTimes(1);
		browser.runTasks();
		expect(frame).toHaveBeenCalledTimes(1);
		browser.deliver(BACKGROUND_FRAME_INTERVAL_MS * 2);
		expect(frame).toHaveBeenLastCalledWith(BACKGROUND_FRAME_INTERVAL_MS * 2);
		stop();
		browser.runTasks();
	});

	it("does not resurrect a stopped loop when its re-arm task is dispatched", () => {
		const browser = browserFrames(true);
		const frame = vi.fn();
		const stop = startPresentationFrameLoop(frame);
		browser.deliver(0);
		expect(browser.tasks).toHaveLength(1);
		stop();
		browser.runTasks();
		expect(browser.pending.size).toBe(0);
		browser.deliver(BACKGROUND_FRAME_INTERVAL_MS);
		expect(frame).toHaveBeenCalledTimes(1);
	});

	it("reports a deferred browser request failure", async () => {
		const browser = browserFrames(true);
		const stop = startPresentationFrameLoop(vi.fn());
		browser.deliver(0);
		const failure = new Error("Browser frame request failed.");
		browser.requestAnimationFrame.mockImplementationOnce(() => {
			throw failure;
		});
		browser.runTasks();
		await Promise.resolve();
		expect(browser.reportError).toHaveBeenCalledExactlyOnceWith(failure);
		stop();
	});
});
