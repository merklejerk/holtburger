import { afterEach, describe, expect, it, vi } from "vitest";
import {
	BACKGROUND_FRAME_INTERVAL_MS,
	startPresentationFrameLoop,
} from "./presentation-frame-loop";

/** Browser frame queue with independently controlled window focus and timestamps. */
function browserFrames(focused: boolean) {
	let hasFocus = focused;
	let nextHandle = 0;
	const pending = new Map<number, FrameRequestCallback>();
	vi.stubGlobal("document", { hasFocus: () => hasFocus });
	vi.stubGlobal("window", {
		requestAnimationFrame: (callback: FrameRequestCallback) => {
			const handle = ++nextHandle;
			pending.set(handle, callback);
			return handle;
		},
		cancelAnimationFrame: (handle: number) => pending.delete(handle),
	});
	return {
		pending,
		focus: (value: boolean) => {
			hasFocus = value;
		},
		deliver: (timeMs: number) => {
			const callbacks = [...pending.values()];
			pending.clear();
			for (const callback of callbacks) callback(timeMs);
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
			browser.deliver(index * displayInterval);
		expect(frame).toHaveBeenCalledTimes(6);
		expect(browser.pending.size).toBe(1);
		stop();
		stop();
		expect(browser.pending.size).toBe(0);
		browser.deliver(BACKGROUND_FRAME_INTERVAL_MS);
		expect(frame).toHaveBeenCalledTimes(6);
	});

	it("caps complete background frames without replaying missed frames after a stall", () => {
		const browser = browserFrames(false);
		const frame = vi.fn();
		const stop = startPresentationFrameLoop(frame);
		browser.deliver(0);
		browser.deliver(BACKGROUND_FRAME_INTERVAL_MS / 2);
		expect(frame).toHaveBeenCalledTimes(1);
		browser.deliver(BACKGROUND_FRAME_INTERVAL_MS);
		expect(frame).toHaveBeenLastCalledWith(BACKGROUND_FRAME_INTERVAL_MS);
		browser.deliver(BACKGROUND_FRAME_INTERVAL_MS * 20);
		expect(frame).toHaveBeenCalledTimes(3);
		browser.deliver(BACKGROUND_FRAME_INTERVAL_MS * 20.5);
		expect(frame).toHaveBeenCalledTimes(3);
		stop();
	});

	it("applies focus changes on the next browser frame without waiting for the background interval", () => {
		const browser = browserFrames(true);
		const frame = vi.fn();
		const stop = startPresentationFrameLoop(frame);
		browser.deliver(0);
		browser.focus(false);
		browser.deliver(BACKGROUND_FRAME_INTERVAL_MS / 4);
		expect(frame).toHaveBeenCalledTimes(1);
		browser.focus(true);
		browser.deliver(BACKGROUND_FRAME_INTERVAL_MS / 2);
		expect(frame).toHaveBeenCalledTimes(2);
		stop();
	});

	it("does not reschedule when the consumer stops during its frame", () => {
		const browser = browserFrames(true);
		const stop = startPresentationFrameLoop(() => stop());
		browser.deliver(0);
		expect(browser.pending.size).toBe(0);
	});
});
