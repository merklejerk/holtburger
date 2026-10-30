import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
	observeWindowGeometry,
	WINDOW_GEOMETRY_WRITE_DELAY_MS,
} from "./window-geometry";

describe("surface geometry lifetime", () => {
	it("captures final source geometry, detaches listeners, and prevents delayed cross-writes", async () => {
		vi.useFakeTimers();
		try {
			const events = new EventEmitter();
			let bounds = { x: 0, y: 0, width: 900, height: 650 };
			const window = Object.assign(events, {
				getNormalBounds: () => bounds,
				isMaximized: () => false,
			});
			const savePicker = vi.fn(async () => {});
			const saveGame = vi.fn(async () => {});
			const report = vi.fn();
			const stop = observeWindowGeometry(window, savePicker, report);
			window.emit("resize");
			await stop();
			bounds = { x: 0, y: 0, width: 1440, height: 900 };
			window.emit("resize");
			const stopGame = observeWindowGeometry(window, saveGame, report);
			window.emit("resize");
			await vi.advanceTimersByTimeAsync(WINDOW_GEOMETRY_WRITE_DELAY_MS);
			expect(savePicker).toHaveBeenCalledExactlyOnceWith({
				normalBounds: { width: 900, height: 650 },
				maximized: false,
			});
			expect(saveGame).toHaveBeenCalledWith({
				normalBounds: { width: bounds.width, height: bounds.height },
				maximized: false,
			});
			await stopGame();
			expect(window.listenerCount("resize")).toBe(0);
			expect(report).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
	it("notifies the user once per write-failure burst and rejects a failed final flush", async () => {
		vi.useFakeTimers();
		try {
			const events = new EventEmitter();
			const window = Object.assign(events, {
				getNormalBounds: () => ({ x: 0, y: 0, width: 900, height: 650 }),
				isMaximized: () => false,
			});
			const save = vi.fn(async () => {
				throw new Error("Permission denied");
			});
			const notifyUser = vi.fn();
			const stop = observeWindowGeometry(window, save, notifyUser);
			for (let attempt = 0; attempt < 2; attempt++) {
				window.emit("resize");
				await vi.advanceTimersByTimeAsync(WINDOW_GEOMETRY_WRITE_DELAY_MS);
			}
			expect(notifyUser).toHaveBeenCalledOnce();
			await expect(stop()).rejects.toThrow("Permission denied");
			expect(window.listenerCount("resize")).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});
