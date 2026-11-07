import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
	WindowDisplay,
	changeNativeFullscreen,
	restoreWindowGeometry,
} from "./window-display";
import { APP_WINDOW_TUNING } from "../src/app/app-tuning";
import { WINDOW_CONTENT_PRESETS } from "../src/app/window-display-contract";
import { clientWindowSettingsSchema } from "../src/app/window-settings-contract";

const NATIVE_DECORATION_HEIGHT = 30;

/** Model OS acknowledgements separately from requests, including intervening resize events. */
class NativeWindow extends EventEmitter {
	bounds = { x: 0, y: 0, width: 1440, height: 930 };
	normalBounds = this.bounds;
	fullscreen = false;
	maximized = false;
	resizable = true;
	maximizable = true;
	getBounds() {
		return this.bounds;
	}
	getContentBounds() {
		return {
			...this.bounds,
			height: this.bounds.height - NATIVE_DECORATION_HEIGHT,
		};
	}
	getNormalBounds() {
		return this.normalBounds;
	}

	isFullScreen() {
		return this.fullscreen;
	}
	isMaximized() {
		return this.maximized;
	}
	isResizable() {
		return this.resizable;
	}
	setResizable(enabled: boolean) {
		this.resizable = enabled;
	}
	setMaximizable(enabled: boolean) {
		this.maximizable = enabled;
	}
	setFullScreen(enabled: boolean) {
		queueMicrotask(() => {
			this.emit("resize");
			this.fullscreen = enabled;
			this.emit(enabled ? "enter-full-screen" : "leave-full-screen");
		});
	}
	maximize() {
		queueMicrotask(() => {
			this.maximized = true;
			this.emit("maximize");
			this.emit("resize");
		});
	}
	unmaximize() {
		queueMicrotask(() => {
			this.maximized = false;
			this.bounds = this.normalBounds;
			this.emit("unmaximize");
			this.emit("resize");
		});
	}
	setSize(width: number, height: number) {
		queueMicrotask(() => {
			this.bounds = { ...this.bounds, width, height };
			this.normalBounds = this.bounds;
			this.emit("resize");
		});
	}

	setContentSize(width: number, height: number) {
		queueMicrotask(() => {
			this.bounds = {
				...this.bounds,
				width,
				height: height + NATIVE_DECORATION_HEIGHT,
			};
			this.normalBounds = this.bounds;
			this.emit("resize");
		});
	}
}
function fixture() {
	const window = new NativeWindow();
	const saved = clientWindowSettingsSchema.parse({
		normalBounds: window.normalBounds,
		maximized: false,
	});
	const publish = vi.fn();
	const report = vi.fn();
	const owner = new WindowDisplay(window, saved, publish, report);
	return { window, owner, publish, report };
}

describe("native display controls", () => {
	it("measures normal decorations after unmaximizing when setting the content minimum", async () => {
		const window = new NativeWindow();
		window.maximized = true;
		vi.spyOn(window, "getContentBounds").mockImplementation(() => ({
			...window.bounds,
			height:
				window.bounds.height -
				(window.maximized ? 0 : NATIVE_DECORATION_HEIGHT),
		}));
		const setMinimumSize = vi.fn();
		const saved = clientWindowSettingsSchema.parse({
			normalBounds: window.normalBounds,
			maximized: false,
		});
		await restoreWindowGeometry(
			Object.assign(window, { setMinimumSize }),
			saved,
			"client",
		);
		const minimum = APP_WINDOW_TUNING.game.minimumContentSize;
		expect(setMinimumSize).toHaveBeenCalledWith(
			minimum.width,
			minimum.height + NATIVE_DECORATION_HEIGHT,
		);
	});

	it("returns accepted normal bounds before entering saved fullscreen", async () => {
		const window = new NativeWindow();
		const minimum = APP_WINDOW_TUNING.game.minimumContentSize;
		const setMinimumSize = vi.fn();
		window.setSize = (width, height) => {
			queueMicrotask(() => {
				window.bounds = {
					...window.bounds,
					width,
					height: Math.max(height, minimum.height + NATIVE_DECORATION_HEIGHT),
				};
				window.normalBounds = window.bounds;
				window.emit("resize");
			});
		};
		const saved = clientWindowSettingsSchema.parse({
			normalBounds: {
				width: minimum.width,
				height: Math.floor(minimum.height / 2),
			},
			maximized: false,
			fullscreen: true,
		});
		const accepted = await restoreWindowGeometry(
			Object.assign(window, { setMinimumSize }),
			saved,
			"client",
		);
		expect(accepted).toMatchObject({
			normalBounds: {
				width: minimum.width,
				height: minimum.height + NATIVE_DECORATION_HEIGHT,
			},
			fullscreen: true,
		});
		const owner = new WindowDisplay(window, accepted, vi.fn(), vi.fn());
		await owner.change({ kind: "fullscreen", enabled: false });
		expect(owner.settings().normalBounds).toEqual(accepted.normalBounds);
		await owner.close();
	});
	it("keeps legacy outer geometry while supplying new preference defaults", () => {
		const bounds = { width: 1440, height: 930 };
		expect(
			clientWindowSettingsSchema.parse({
				normalBounds: bounds,
				maximized: true,
			}),
		).toEqual({
			normalBounds: bounds,
			maximized: true,
			fullscreen: false,
			freeResize: true,
		});
	});
	it("allows presets while locked and reports manually resized content as actual dimensions", async () => {
		const { window, owner } = fixture();
		await owner.change({ kind: "free-resize", enabled: false });
		const preset = owner.snapshot().presets[0];
		if (preset === undefined) throw new Error("Fixture must admit a preset.");
		await owner.change({ kind: "size", size: preset });
		expect(owner.snapshot().contentSize).toEqual(preset);
		expect(window.resizable).toBe(false);
		expect(window.maximizable).toBe(false);
		expect(owner.settings().freeResize).toBe(false);
		await owner.change({ kind: "free-resize", enabled: true });
		window.bounds = { ...window.bounds, width: preset.width + 17 };
		window.normalBounds = window.bounds;
		window.emit("resize");
		expect(owner.snapshot().contentSize.width).toBe(preset.width + 17);
		await owner.close();
	});

	it("keeps larger presets available after choosing a smaller locked window", async () => {
		const { owner } = fixture();
		const smallest = WINDOW_CONTENT_PRESETS[0];
		const largest = WINDOW_CONTENT_PRESETS.at(-1);
		if (smallest === undefined || largest === undefined)
			throw new Error("Fixture needs window presets.");
		expect(owner.snapshot().presets).toContainEqual(largest);
		await owner.change({ kind: "free-resize", enabled: false });
		await owner.change({ kind: "size", size: smallest });
		expect(owner.snapshot().presets).toContainEqual(largest);
		await owner.change({ kind: "size", size: largest });
		expect(owner.snapshot().contentSize).toEqual(largest);
		expect(owner.settings().freeResize).toBe(false);
		await owner.close();
	});

	it("releases the native lock before fullscreen without changing the windowed preference", async () => {
		const { window, owner } = fixture();
		await owner.change({ kind: "free-resize", enabled: false });
		const enter = vi
			.spyOn(window, "setFullScreen")
			.mockImplementation((enabled) => {
				expect(window.resizable).toBe(true);
				expect(window.maximizable).toBe(true);
				NativeWindow.prototype.setFullScreen.call(window, enabled);
			});
		await owner.change({ kind: "fullscreen", enabled: true });
		expect(enter).toHaveBeenCalledWith(true);
		expect(window.resizable).toBe(true);
		expect(owner.settings()).toMatchObject({
			fullscreen: true,
			freeResize: false,
		});
		await owner.change({ kind: "fullscreen", enabled: false });
		expect(window.resizable).toBe(false);
		expect(window.maximizable).toBe(false);
		expect(owner.settings()).toMatchObject({
			fullscreen: false,
			freeResize: false,
		});
		await owner.close();
	});
	it("restores the windowed lock after a failed fullscreen entry", async () => {
		const { window, owner } = fixture();
		await owner.change({ kind: "free-resize", enabled: false });
		window.setFullScreen = () => {
			throw new Error("Native fullscreen failed.");
		};
		await expect(
			owner.change({ kind: "fullscreen", enabled: true }),
		).rejects.toThrow("Native fullscreen failed.");
		expect(window.resizable).toBe(false);
		expect(owner.snapshot()).toMatchObject({
			fullscreen: false,
			freeResize: false,
			busy: false,
		});
		await owner.close();
	});
	it("applies windowed resize policy to native fullscreen events", async () => {
		const { window, owner } = fixture();
		await owner.change({ kind: "free-resize", enabled: false });
		window.fullscreen = true;
		window.emit("enter-full-screen");
		expect(window.resizable).toBe(true);
		expect(owner.settings().freeResize).toBe(false);
		window.fullscreen = false;
		window.emit("leave-full-screen");
		window.emit("resize");
		await owner.close();
		expect(window.resizable).toBe(false);
	});

	it("restores actual pre-fullscreen size when native normal-bounds metadata is stale", async () => {
		const { window, owner } = fixture();
		const staleNormalBounds = window.normalBounds;
		vi.spyOn(window, "getNormalBounds").mockReturnValue(staleNormalBounds);
		const preset = WINDOW_CONTENT_PRESETS[1];
		if (preset === undefined) throw new Error("Fixture needs a window preset.");
		await owner.change({ kind: "free-resize", enabled: false });
		await owner.change({ kind: "size", size: preset });
		const before = window.getBounds();
		await owner.change({ kind: "fullscreen", enabled: true });
		window.bounds = {
			...before,
			width: before.width * 2,
			height: before.height * 2,
		};
		window.emit("resize");
		expect(owner.settings().normalBounds).toEqual({
			width: before.width,
			height: before.height,
		});
		await owner.change({ kind: "fullscreen", enabled: false });
		expect(window.getBounds()).toEqual(before);
		expect(owner.snapshot().contentSize).toEqual(preset);
		expect(window.resizable).toBe(false);
		await owner.close();
	});
	it("restores a maximized window before locking its edges", async () => {
		const { window, owner } = fixture();
		window.maximized = true;
		window.emit("maximize");
		await owner.change({ kind: "free-resize", enabled: false });
		expect(window.maximized).toBe(false);
		expect(window.maximizable).toBe(false);
		expect(owner.settings()).toMatchObject({
			maximized: false,
			freeResize: false,
		});
		await owner.close();
	});
	it("restores maximization across fullscreen and retains normal bounds during intermediate events", async () => {
		const { window, owner } = fixture();
		await new Promise<void>((resolve) => {
			window.once("maximize", resolve);
			window.maximize();
		});
		const before = owner.settings().normalBounds;
		const entering = owner.change({ kind: "fullscreen", enabled: true });
		const leaving = owner.change({ kind: "fullscreen", enabled: false });
		await entering;
		expect(owner.settings()).toMatchObject({
			fullscreen: true,
			maximized: true,
			normalBounds: before,
		});
		// Some native window managers restore an unmaximized window after fullscreen.
		window.maximized = false;
		await leaving;
		expect(window.maximized).toBe(true);
		expect(owner.settings().normalBounds).toEqual(before);
		await owner.close();
	});
	it("rejects fullscreen sizing and unsupported presets without disabling later requests", async () => {
		const { owner } = fixture();
		const unsupported = { width: 1234, height: 789 };
		await expect(
			owner.change({ kind: "size", size: unsupported }),
		).rejects.toThrow("not a supported preset");
		await owner.change({ kind: "fullscreen", enabled: true });
		await expect(
			owner.change({ kind: "free-resize", enabled: false }),
		).rejects.toThrow("Leave fullscreen");
		await owner.change({ kind: "fullscreen", enabled: false });
		expect(owner.snapshot().busy).toBe(false);
		await owner.close();
	});
	it("drains admitted changes and removes native listeners before retiring controls", async () => {
		const { window, owner, publish } = fixture();
		const changing = owner.change({ kind: "fullscreen", enabled: true });
		await owner.close();
		await changing;
		await expect(
			owner.change({ kind: "fullscreen", enabled: false }),
		).rejects.toThrow("retired");
		publish.mockClear();
		window.emit("resize");
		expect(publish).not.toHaveBeenCalled();
	});

	it("does not admit native fullscreen restoration after retirement starts", async () => {
		const { window, owner, report } = fixture();
		const closing = owner.close();
		window.emit("leave-full-screen");
		await closing;
		await Promise.resolve();
		expect(report).not.toHaveBeenCalled();
		expect(window.listenerCount("resize")).toBe(0);
	});

	it("waits for native geometry to settle after a fullscreen mode acknowledgement", async () => {
		const window = new NativeWindow();
		window.setFullScreen = (enabled) => {
			window.fullscreen = enabled;
			window.emit(enabled ? "enter-full-screen" : "leave-full-screen");
		};
		let finished = false;
		const changing = changeNativeFullscreen(window, true).then(() => {
			finished = true;
		});
		await Promise.resolve();
		expect(finished).toBe(false);
		window.emit("resize");
		await changing;
		expect(finished).toBe(true);
		expect(window.listenerCount("resize")).toBe(0);
	});

	it("accepts an acknowledged mode change without a resize event", async () => {
		const window = new NativeWindow();
		window.setFullScreen = (enabled) => {
			window.fullscreen = enabled;
			window.emit(enabled ? "enter-full-screen" : "leave-full-screen");
		};
		await changeNativeFullscreen(window, true);
		expect(window.isFullScreen()).toBe(true);
		expect(window.listenerCount("resize")).toBe(0);
	});
	it("reports a missing OS acknowledgement and removes the pending listener", async () => {
		vi.useFakeTimers();
		try {
			const window = new NativeWindow();
			window.setFullScreen = () => {};
			const changing = changeNativeFullscreen(window, true);
			const rejected = expect(changing).rejects.toThrow("timed out");
			await vi.advanceTimersByTimeAsync(APP_WINDOW_TUNING.transitionTimeoutMs);
			await rejected;
			expect(window.listenerCount("enter-full-screen")).toBe(0);
			expect(window.listenerCount("resize")).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});
