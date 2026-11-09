import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	WindowDisplay,
	changeNativeFullscreen,
	restoreWindowGeometry,
} from "./window-display";
import { APP_WINDOW_TUNING } from "../src/app/app-tuning";
import {
	WINDOW_CONTENT_PRESETS,
	type WindowDisplayRequest,
} from "../src/app/window-display-contract";
import { clientWindowSettingsSchema } from "../src/app/window-settings-contract";

const NATIVE_DECORATION_HEIGHT = 30;

/** Model OS acknowledgements separately from requests, including intervening resize events. */
class NativeWindow extends EventEmitter {
	borderless = false;
	setMinimumSize = vi.fn();
	async getViewportSize() {
		const [width, height] = this.getContentSize();
		return { width, height };
	}
	get native() {
		return this;
	}
	isBorderless() {
		return this.borderless;
	}
	setBorderless(enabled: boolean) {
		if (this.borderless === enabled) return;
		const content = this.getContentBounds();
		this.borderless = enabled;
		this.bounds = {
			...this.bounds,
			height: content.height + (enabled ? 0 : NATIVE_DECORATION_HEIGHT),
		};
		this.normalBounds = this.bounds;
		this.emit("resize");
	}
	bounds = { x: 0, y: 0, width: 1440, height: 930 };
	normalBounds = this.bounds;
	fullscreen = false;
	maximized = false;
	resizable = true;
	maximizable = true;
	getBounds() {
		return this.bounds;
	}
	getContentSize(): [number, number] {
		return [
			this.bounds.width,
			this.bounds.height - (this.borderless ? 0 : NATIVE_DECORATION_HEIGHT),
		];
	}
	getContentBounds() {
		const [width, height] = this.getContentSize();
		return { ...this.bounds, width, height };
	}
	setContentBounds(bounds: {
		x: number;
		y: number;
		width: number;
		height: number;
	}) {
		this.setContentSize(bounds.width, bounds.height);
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
				height: height + (this.borderless ? 0 : NATIVE_DECORATION_HEIGHT),
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
	return {
		window,
		owner,
		publish,
		report,
	};
}

/** Geometry regression cases accept each successful display preview explicitly. */
async function changeAndKeep(
	owner: WindowDisplay,
	request: WindowDisplayRequest,
): Promise<void> {
	await owner.change(request);
	const confirmation = owner.snapshot().confirmation;
	if (confirmation !== null)
		await owner.change({ kind: "confirm", id: confirmation.id, keep: true });
}

describe("native display controls", () => {
	it("reports viewport failures only while their controls remain active", async () => {
		const { owner, window, report } = fixture();
		const error = new Error("Document context changed.");
		window.getViewportSize = async () => {
			await new Promise<void>((resolve) => setImmediate(resolve));
			throw error;
		};
		owner.refresh();
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(report).toHaveBeenCalledExactlyOnceWith(error);
		report.mockClear();
		owner.refresh();
		await owner.close();
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(report).not.toHaveBeenCalled();
	});

	it("corrects native rounding for presets and repeated border changes", async () => {
		const { owner, window } = fixture();
		const target = smallestPreset();
		const rounding = { width: 2, height: 1 };
		const setContentSize = window.setContentSize.bind(window);
		window.setContentBounds = (bounds) =>
			setContentSize(
				bounds.width + rounding.width,
				bounds.height + rounding.height,
			);
		const setBorderless = window.setBorderless.bind(window);
		window.setBorderless = (enabled) => {
			setBorderless(enabled);
			const [width, height] = window.getContentSize();
			setContentSize(width + rounding.width, height + rounding.height);
		};
		await changeAndKeep(owner, { kind: "size", size: target });
		expect(owner.snapshot().contentSize).toEqual(target);
		for (const enabled of [true, false, true, false]) {
			await changeAndKeep(owner, { kind: "borderless", enabled });
			expect(owner.snapshot().contentSize).toEqual(target);
		}
		await owner.close();
	});
	it("corrects against the page viewport when native DIP dimensions differ", async () => {
		const { owner, window } = fixture();
		const target = smallestPreset();
		window.getViewportSize = async () => {
			const [width, height] = window.getContentSize();
			return { width: width + 1, height };
		};
		await changeAndKeep(owner, { kind: "size", size: target });
		expect(owner.snapshot().contentSize).toEqual(target);
		expect(window.getContentSize()[0]).toBe(target.width - 1);
		for (const enabled of [true, false]) {
			await changeAndKeep(owner, { kind: "borderless", enabled });
			expect(owner.snapshot().contentSize).toEqual(target);
		}
		await owner.close();
	});
	it("accepts actual dimensions when the native minimum prevents closer sizing", async () => {
		const { owner, window } = fixture();
		const target = smallestPreset();
		const minimumWidth = target.width + 17;
		const setContentSize = window.setContentSize.bind(window);
		window.setContentBounds = (bounds) =>
			setContentSize(Math.max(minimumWidth, bounds.width), bounds.height);
		await changeAndKeep(owner, { kind: "size", size: target });
		expect(owner.snapshot().contentSize).toEqual({
			...target,
			width: minimumWidth,
		});
		await owner.close();
	});

	it("uses viewport dimensions independently of outer and content rectangle discrepancies", async () => {
		const { owner, window } = fixture();
		const contentSize = owner.snapshot().contentSize;
		vi.spyOn(window, "getContentBounds").mockImplementation(() => ({
			...window.bounds,
			width: contentSize.width + 2,
			height: contentSize.height + 3,
		}));
		expect(owner.snapshot().contentSize).toEqual(contentSize);
		const setContentSize = vi.spyOn(window, "setContentSize");
		await owner.change({ kind: "size", size: contentSize });
		expect(setContentSize).not.toHaveBeenCalled();
		await owner.close();
	});

	it("previews borderless windows at the same viewport size and reverts their geometry and resize lock", async () => {
		const { owner, window } = fixture();
		await changeAndKeep(owner, { kind: "free-resize", enabled: false });
		const previous = owner.settings();
		const content = owner.snapshot().contentSize;
		await owner.change({ kind: "borderless", enabled: true });
		expect(owner.snapshot().borderless).toBe(true);
		expect(owner.snapshot().contentSize).toEqual(content);
		expect(owner.settings()).toEqual(previous);
		expect(window.resizable).toBe(false);
		const confirmation = owner.snapshot().confirmation;
		if (confirmation === null) throw new Error("Missing borderless preview.");
		await owner.change({ kind: "confirm", id: confirmation.id, keep: false });
		expect(owner.snapshot().borderless).toBe(false);
		expect(owner.snapshot().contentSize).toEqual(content);
		expect(owner.settings()).toEqual(previous);
		expect(window.resizable).toBe(false);
		await owner.close();
	});
	it("retains accepted borderless geometry through fullscreen and rejects frame changes inside it", async () => {
		const { owner } = fixture();
		await changeAndKeep(owner, { kind: "borderless", enabled: true });
		const previous = owner.settings();
		expect(previous.borderless).toBe(true);
		await changeAndKeep(owner, { kind: "fullscreen", enabled: true });
		await expect(
			owner.change({ kind: "borderless", enabled: false }),
		).rejects.toThrow("Leave fullscreen");
		await changeAndKeep(owner, { kind: "fullscreen", enabled: false });
		expect(owner.settings()).toEqual(previous);
		await owner.close();
	});

	it("measures normal decorations after unmaximizing when setting the content minimum", async () => {
		const window = new NativeWindow();
		window.maximized = true;
		vi.spyOn(window, "getContentSize").mockImplementation(() => [
			window.bounds.width,
			window.bounds.height - (window.maximized ? 0 : NATIVE_DECORATION_HEIGHT),
		]);
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
			borderless: false,
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
			borderless: false,
			fullscreen: true,
		});
		const owner = new WindowDisplay(window, accepted, vi.fn(), vi.fn());
		await changeAndKeep(owner, { kind: "fullscreen", enabled: false });
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
			borderless: false,
			fullscreen: false,
			freeResize: true,
		});
	});
	it("allows presets while locked and reports manually resized content as actual dimensions", async () => {
		const { window, owner } = fixture();
		await changeAndKeep(owner, { kind: "free-resize", enabled: false });
		const preset = owner.snapshot().presets[0];
		if (preset === undefined) throw new Error("Fixture must admit a preset.");
		await changeAndKeep(owner, { kind: "size", size: preset });
		expect(owner.snapshot().contentSize).toEqual(preset);
		expect(window.resizable).toBe(false);
		expect(window.maximizable).toBe(false);
		expect(owner.settings().freeResize).toBe(false);
		await changeAndKeep(owner, { kind: "free-resize", enabled: true });
		window.bounds = { ...window.bounds, width: preset.width + 17 };
		window.normalBounds = window.bounds;
		window.emit("resize");
		expect((await owner.read()).contentSize.width).toBe(preset.width + 17);
		await owner.close();
	});

	it("keeps larger presets available after choosing a smaller locked window", async () => {
		const { owner } = fixture();
		const smallest = WINDOW_CONTENT_PRESETS[0];
		const largest = WINDOW_CONTENT_PRESETS.at(-1);
		if (smallest === undefined || largest === undefined)
			throw new Error("Fixture needs window presets.");
		expect(owner.snapshot().presets).toContainEqual(largest);
		await changeAndKeep(owner, { kind: "free-resize", enabled: false });
		await changeAndKeep(owner, { kind: "size", size: smallest });
		expect(owner.snapshot().presets).toContainEqual(largest);
		await changeAndKeep(owner, { kind: "size", size: largest });
		expect(owner.snapshot().contentSize).toEqual(largest);
		expect(owner.settings().freeResize).toBe(false);
		await owner.close();
	});

	it("releases the native lock before fullscreen without changing the windowed preference", async () => {
		const { window, owner } = fixture();
		await changeAndKeep(owner, { kind: "free-resize", enabled: false });
		const enter = vi
			.spyOn(window, "setFullScreen")
			.mockImplementation((enabled) => {
				expect(window.resizable).toBe(true);
				expect(window.maximizable).toBe(true);
				NativeWindow.prototype.setFullScreen.call(window, enabled);
			});
		await changeAndKeep(owner, { kind: "fullscreen", enabled: true });
		expect(enter).toHaveBeenCalledWith(true);
		expect(window.resizable).toBe(true);
		expect(owner.settings()).toMatchObject({
			borderless: false,
			fullscreen: true,
			freeResize: false,
		});
		await changeAndKeep(owner, { kind: "fullscreen", enabled: false });
		expect(window.resizable).toBe(false);
		expect(window.maximizable).toBe(false);
		expect(owner.settings()).toMatchObject({
			borderless: false,
			fullscreen: false,
			freeResize: false,
		});
		await owner.close();
	});
	it("restores the windowed lock after a failed fullscreen entry", async () => {
		const { window, owner } = fixture();
		await changeAndKeep(owner, { kind: "free-resize", enabled: false });
		window.setFullScreen = () => {
			throw new Error("Native fullscreen failed.");
		};
		await expect(
			changeAndKeep(owner, { kind: "fullscreen", enabled: true }),
		).rejects.toThrow("Native fullscreen failed.");
		expect(window.resizable).toBe(false);
		expect(owner.snapshot()).toMatchObject({
			borderless: false,
			fullscreen: false,
			freeResize: false,
			busy: false,
		});
		await owner.close();
	});
	it("applies windowed resize policy to native fullscreen events", async () => {
		const { window, owner } = fixture();
		await changeAndKeep(owner, { kind: "free-resize", enabled: false });
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
		await changeAndKeep(owner, { kind: "free-resize", enabled: false });
		await changeAndKeep(owner, { kind: "size", size: preset });
		const before = window.getBounds();
		await changeAndKeep(owner, { kind: "fullscreen", enabled: true });
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
		await changeAndKeep(owner, { kind: "fullscreen", enabled: false });
		expect(window.getBounds()).toEqual(before);
		expect(owner.snapshot().contentSize).toEqual(preset);
		expect(window.resizable).toBe(false);
		await owner.close();
	});
	it("restores a maximized window before locking its edges", async () => {
		const { window, owner } = fixture();
		window.maximized = true;
		window.emit("maximize");
		await changeAndKeep(owner, { kind: "free-resize", enabled: false });
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
		const entering = changeAndKeep(owner, {
			kind: "fullscreen",
			enabled: true,
		});
		await entering;
		expect(owner.settings()).toMatchObject({
			borderless: false,
			fullscreen: true,
			maximized: true,
			normalBounds: before,
		});
		// Some native window managers restore an unmaximized window after fullscreen.
		window.maximized = false;
		await changeAndKeep(owner, { kind: "fullscreen", enabled: false });
		expect(window.maximized).toBe(true);
		expect(owner.settings().normalBounds).toEqual(before);
		await owner.close();
	});
	it("rejects fullscreen sizing and unsupported presets without disabling later requests", async () => {
		const { owner } = fixture();
		const unsupported = { width: 1234, height: 789 };
		await expect(
			changeAndKeep(owner, { kind: "size", size: unsupported }),
		).rejects.toThrow("not a supported preset");
		await changeAndKeep(owner, { kind: "fullscreen", enabled: true });
		await expect(
			changeAndKeep(owner, { kind: "free-resize", enabled: false }),
		).rejects.toThrow("Leave fullscreen");
		await changeAndKeep(owner, { kind: "fullscreen", enabled: false });
		expect(owner.snapshot().busy).toBe(false);
		await owner.close();
	});
	it("drains admitted changes and removes native listeners before retiring controls", async () => {
		const { window, owner, publish } = fixture();
		const changing = owner.change({
			kind: "fullscreen",
			enabled: true,
		});
		await owner.close();
		await changing;
		await expect(
			changeAndKeep(owner, { kind: "fullscreen", enabled: false }),
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

/** Settle configure bursts without advancing through the confirmation deadline. */
async function settleChange(changing: Promise<void>): Promise<void> {
	await vi.advanceTimersByTimeAsync(APP_WINDOW_TUNING.geometryQuietMs * 4);
	await changing;
}
function confirmationId(owner: WindowDisplay): number {
	const confirmation = owner.snapshot().confirmation;
	if (confirmation === null)
		throw new Error("Expected a settled display preview.");
	return confirmation.id;
}
function smallestPreset() {
	const preset = WINDOW_CONTENT_PRESETS[0];
	if (preset === undefined) throw new Error("Fixture requires a preset.");
	return preset;
}

describe("display confirmation", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("protects saved settings during preview and cancels the deadline on Keep", async () => {
		const { owner, window } = fixture();
		const before = owner.settings();
		const changing = owner.change({ kind: "size", size: smallestPreset() });
		await Promise.resolve();
		expect(owner.settings()).toEqual(before);
		await settleChange(changing);
		expect(window.getBounds().width).toBe(smallestPreset().width);
		expect(owner.settings()).toEqual(before);
		await owner.change({
			kind: "confirm",
			id: confirmationId(owner),
			keep: true,
		});
		const accepted = owner.settings();
		expect(accepted.normalBounds.width).toBe(smallestPreset().width);
		await vi.advanceTimersByTimeAsync(APP_WINDOW_TUNING.displayConfirmationMs);
		expect(owner.settings()).toEqual(accepted);
		expect(owner.snapshot().confirmation).toBeNull();
		await owner.close();
	});

	it("restores custom normal bounds and maximization on Revert", async () => {
		const { owner, window } = fixture();
		window.bounds = { ...window.bounds, width: window.bounds.width + 17 };
		window.normalBounds = window.bounds;
		window.maximized = true;
		window.emit("maximize");
		const before = owner.settings();
		await settleChange(owner.change({ kind: "size", size: smallestPreset() }));
		expect(window.maximized).toBe(false);
		await settleChange(
			owner.change({ kind: "confirm", id: confirmationId(owner), keep: false }),
		);
		expect(owner.settings()).toEqual(before);
		expect(window.maximized).toBe(true);
		expect(window.normalBounds.width).toBe(before.normalBounds.width);
		await owner.close();
	});

	it.each([false, true])(
		"restores previous fullscreen state (%s) on timeout without the renderer",
		async (fullscreen) => {
			const { owner, window, report } = fixture();
			await settleChange(owner.change({ kind: "free-resize", enabled: false }));
			if (fullscreen) {
				await settleChange(owner.change({ kind: "fullscreen", enabled: true }));
				await owner.change({
					kind: "confirm",
					id: confirmationId(owner),
					keep: true,
				});
			}
			const before = owner.settings();
			await settleChange(
				owner.change({ kind: "fullscreen", enabled: !fullscreen }),
			);
			expect(window.isFullScreen()).toBe(!fullscreen);
			expect(owner.settings()).toEqual(before);
			await vi.advanceTimersByTimeAsync(
				APP_WINDOW_TUNING.displayConfirmationMs +
					APP_WINDOW_TUNING.geometryQuietMs * 4,
			);
			expect(window.isFullScreen()).toBe(fullscreen);
			expect(window.resizable).toBe(fullscreen);
			expect(owner.settings()).toEqual(before);
			expect(owner.snapshot().confirmation).toBeNull();
			expect(report).not.toHaveBeenCalled();
			await owner.close();
		},
	);

	it("rejects competing requests, ignores stale answers, and reverts on retirement", async () => {
		const { owner, window } = fixture();
		await settleChange(owner.change({ kind: "fullscreen", enabled: true }));
		const oldId = confirmationId(owner);
		await expect(
			owner.change({ kind: "fullscreen", enabled: false }),
		).rejects.toThrow("Keep or revert");
		await settleChange(
			owner.change({ kind: "confirm", id: oldId, keep: false }),
		);
		await settleChange(owner.change({ kind: "fullscreen", enabled: true }));
		const currentId = confirmationId(owner);
		await owner.change({ kind: "confirm", id: oldId, keep: true });
		expect(confirmationId(owner)).toBe(currentId);
		expect(owner.settings().fullscreen).toBe(false);
		await settleChange(owner.close());
		expect(window.fullscreen).toBe(false);
		expect(window.listenerCount("resize")).toBe(0);
	});

	it("protects persistence during OS fullscreen gestures and times them out", async () => {
		const { owner, window } = fixture();
		const before = owner.settings();
		window.fullscreen = true;
		window.emit("enter-full-screen");
		await vi.advanceTimersByTimeAsync(APP_WINDOW_TUNING.geometryQuietMs / 2);
		expect(owner.settings()).toEqual(before);
		await vi.advanceTimersByTimeAsync(APP_WINDOW_TUNING.geometryQuietMs);
		expect(confirmationId(owner)).toBeGreaterThan(0);
		await vi.advanceTimersByTimeAsync(
			APP_WINDOW_TUNING.displayConfirmationMs +
				APP_WINDOW_TUNING.geometryQuietMs * 4,
		);
		expect(window.fullscreen).toBe(false);
		expect(owner.settings()).toEqual(before);
		await owner.close();
	});

	it("restores partially applied failed resizes before exposing settings again", async () => {
		const { owner, window } = fixture();
		const before = owner.settings();
		window.setContentSize = (width, height) => {
			window.bounds = {
				...window.bounds,
				width,
				height: height + (window.borderless ? 0 : NATIVE_DECORATION_HEIGHT),
			};
			throw new Error("Resize failed after changing bounds.");
		};
		const rejected = expect(
			owner.change({ kind: "size", size: smallestPreset() }),
		).rejects.toThrow("Resize failed");
		await vi.advanceTimersByTimeAsync(APP_WINDOW_TUNING.geometryQuietMs * 4);
		await rejected;
		expect(owner.settings()).toEqual(before);
		expect(window.getBounds()).toMatchObject(before.normalBounds);
		expect(owner.snapshot().confirmation).toBeNull();
		await owner.close();
	});

	it("reports both native failures and allows another attempt to restore", async () => {
		const { owner, window } = fixture();
		const before = owner.settings();
		window.setContentSize = (width, height) => {
			window.bounds = { ...window.bounds, width, height };
			throw new Error("Native resize failed.");
		};
		const restore = vi.spyOn(window, "setSize").mockImplementation(() => {
			throw new Error("Native restoration failed.");
		});
		await expect(
			owner.change({ kind: "size", size: smallestPreset() }),
		).rejects.toMatchObject({
			message: "Display change and restoration both failed.",
			errors: [
				expect.objectContaining({ message: "Native resize failed." }),
				expect.objectContaining({ message: "Native restoration failed." }),
			],
		});
		expect(owner.settings()).toEqual(before);
		expect(confirmationId(owner)).toBeGreaterThan(0);
		restore.mockRestore();
		// A recovery prompt cannot accept the broken preview, even on a late Keep.
		await settleChange(
			owner.change({ kind: "confirm", id: confirmationId(owner), keep: true }),
		);
		expect(window.getBounds()).toMatchObject(before.normalBounds);
		expect(owner.snapshot().confirmation).toBeNull();
		await owner.close();
	});

	it("does not accept a partially restored preview after Revert fails before the deadline", async () => {
		const { owner, window } = fixture();
		const before = owner.settings();
		await settleChange(owner.change({ kind: "size", size: smallestPreset() }));
		const id = confirmationId(owner);
		const restore = vi.spyOn(window, "setSize").mockImplementation(() => {
			throw new Error("Native restoration failed.");
		});
		await expect(
			owner.change({ kind: "confirm", id, keep: false }),
		).rejects.toThrow("Native restoration failed.");
		restore.mockRestore();
		await settleChange(owner.change({ kind: "confirm", id, keep: true }));
		expect(window.getBounds()).toMatchObject(before.normalBounds);
		expect(owner.settings()).toEqual(before);
		await owner.close();
	});

	it("restores retained geometry before locking an OS fullscreen exit", async () => {
		const { owner, window } = fixture();
		await settleChange(owner.change({ kind: "free-resize", enabled: false }));
		const before = owner.settings();
		await settleChange(owner.change({ kind: "fullscreen", enabled: true }));
		await owner.change({
			kind: "confirm",
			id: confirmationId(owner),
			keep: true,
		});
		window.bounds = {
			...window.bounds,
			width: before.normalBounds.width * 2,
			height: before.normalBounds.height * 2,
		};
		window.fullscreen = false;
		window.emit("leave-full-screen");
		expect(window.resizable).toBe(true);
		// The mode acknowledgement can precede the windowed configure burst.
		window.emit("resize");
		await vi.advanceTimersByTimeAsync(APP_WINDOW_TUNING.geometryQuietMs * 4);
		expect(window.getBounds()).toMatchObject(before.normalBounds);
		expect(window.resizable).toBe(false);
		await owner.change({
			kind: "confirm",
			id: confirmationId(owner),
			keep: true,
		});
		expect(owner.settings()).toEqual(before);
		await owner.close();
	});

	it("detaches native listeners even when retirement cannot restore the preview", async () => {
		const { owner, window } = fixture();
		const before = owner.settings();
		await settleChange(owner.change({ kind: "size", size: smallestPreset() }));
		vi.spyOn(window, "setSize").mockImplementation(() => {
			throw new Error("Native restoration failed.");
		});
		await expect(owner.close()).rejects.toThrow("Native restoration failed.");
		expect(window.eventNames()).toEqual([]);
		expect(owner.settings()).toEqual(before);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("does not prompt when the requested mode or size is already active", async () => {
		const { owner } = fixture();
		await owner.change({ kind: "fullscreen", enabled: false });
		await owner.change({ kind: "size", size: owner.snapshot().contentSize });
		expect(owner.snapshot().confirmation).toBeNull();
		await owner.close();
	});
});
