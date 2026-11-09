import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { observeWindowGeometry } from "./window-geometry";
import { APP_PERSISTENCE_TUNING } from "../src/app/app-tuning.js";

describe("surface geometry lifetime", () => {
	it("captures final source geometry, detaches listeners, and prevents delayed cross-writes", async () => {
		vi.useFakeTimers();
		try {
			const events = new EventEmitter();
			let bounds = { x: 0, y: 0, width: 900, height: 650 };
			const window = Object.assign(events, {
				getNormalBounds: () => bounds,
				isMaximized: () => false,
				isFullScreen: () => false,
				isResizable: () => true,
			});
			const savePicker = vi.fn(async () => {});
			const saveGame = vi.fn(async () => {});
			const report = vi.fn();
			const snapshot = () => ({
				normalBounds: { width: bounds.width, height: bounds.height },
				maximized: false,
				fullscreen: false,
				freeResize: true,
				borderless: false,
			});
			const stop = observeWindowGeometry(window, savePicker, report, snapshot);
			window.emit("resize");
			await stop();
			bounds = { x: 0, y: 0, width: 1440, height: 900 };
			window.emit("resize");
			const stopGame = observeWindowGeometry(
				window,
				saveGame,
				report,
				snapshot,
			);
			window.emit("resize");
			await vi.advanceTimersByTimeAsync(
				APP_PERSISTENCE_TUNING.windowGeometryWriteDelayMs,
			);
			expect(savePicker).toHaveBeenCalledExactlyOnceWith({
				normalBounds: { width: 900, height: 650 },
				maximized: false,
				borderless: false,
				fullscreen: false,
				freeResize: true,
			});
			expect(saveGame).toHaveBeenCalledWith({
				normalBounds: { width: bounds.width, height: bounds.height },
				maximized: false,
				borderless: false,
				fullscreen: false,
				freeResize: true,
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
				isFullScreen: () => false,
				isResizable: () => true,
			});
			const save = vi.fn(async () => {
				throw new Error("Permission denied");
			});
			const notifyUser = vi.fn();
			const stop = observeWindowGeometry(window, save, notifyUser, () => ({
				normalBounds: { width: 900, height: 650 },
				maximized: false,
				fullscreen: false,
				freeResize: true,
				borderless: false,
			}));
			for (let attempt = 0; attempt < 2; attempt++) {
				window.emit("resize");
				await vi.advanceTimersByTimeAsync(
					APP_PERSISTENCE_TUNING.windowGeometryWriteDelayMs,
				);
			}
			expect(notifyUser).toHaveBeenCalledOnce();
			await expect(stop()).rejects.toThrow("Permission denied");
			expect(window.listenerCount("resize")).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});
