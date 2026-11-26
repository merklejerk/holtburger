import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { observeWindowGeometry } from "./window-geometry";
import { APP_PERSISTENCE_TUNING } from "../src/app/desktop/app-tuning.js";

describe("surface geometry lifetime", () => {
	it("captures final source geometry, detaches listeners, and prevents delayed cross-writes", async () => {
		vi.useFakeTimers();
		try {
			const window = new EventEmitter();
			let size = { width: 900, height: 650 };
			const savePicker = vi.fn(async () => {});
			const saveGame = vi.fn(async () => {});
			const report = vi.fn();
			const snapshot = () => ({
				contentSize: { width: size.width, height: size.height },
				maximized: false,
				fullscreen: false,
				freeResize: true,
				borderless: false,
			});
			const stop = observeWindowGeometry(window, savePicker, report, snapshot);
			window.emit("resize");
			await stop();
			size = { width: 1440, height: 900 };
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
				contentSize: { width: 900, height: 650 },
				maximized: false,
				borderless: false,
				fullscreen: false,
				freeResize: true,
			});
			expect(saveGame).toHaveBeenCalledWith({
				contentSize: { width: size.width, height: size.height },
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
			const window = new EventEmitter();
			const save = vi.fn(async () => {
				throw new Error("Permission denied");
			});
			const notifyUser = vi.fn();
			const stop = observeWindowGeometry(window, save, notifyUser, () => ({
				contentSize: { width: 900, height: 650 },
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
