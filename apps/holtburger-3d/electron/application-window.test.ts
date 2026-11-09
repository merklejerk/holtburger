import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_WINDOW_TUNING } from "../src/app/app-tuning";
import { ApplicationWindow } from "./application-window";

vi.mock("electron", () => ({
	BaseWindow: class extends EventEmitter {
		readonly contentView = {
			addChildView: vi.fn(),
			removeChildView: vi.fn(),
		};
		readonly size: [number, number];
		visible: boolean;
		constructor(options: { width: number; height: number; show?: boolean }) {
			super();
			this.size = [options.width, options.height];
			this.visible = options.show !== false;
		}
		getContentSize() {
			return this.size;
		}
		getBounds() {
			return { x: 0, y: 0, width: this.size[0], height: this.size[1] };
		}
		isFullScreen() {
			return false;
		}
		isVisible() {
			return this.visible;
		}
		show() {
			this.visible = true;
			this.emit("show");
		}
		destroy() {
			this.emit("closed");
		}
	},
	WebContentsView: class {
		readonly webContents = {
			executeJavaScript: vi.fn(
				async () => APP_WINDOW_TUNING.game.initialContentSize,
			),
			focus: vi.fn(),
			close: vi.fn(),
		};
		setBounds = vi.fn();
	},
}));

function createWindow() {
	return new ApplicationWindow({
		...APP_WINDOW_TUNING.game.initialContentSize,
		webPreferences: { sandbox: true },
	});
}

afterEach(() => vi.useRealTimers());

describe("application window ownership", () => {
	it("moves the same page into replacement chrome and retires the old native listeners", () => {
		const window = createWindow();
		const previous = window.native;
		const contents = window.webContents;
		const resized = vi.fn();
		window.on("resize", resized);
		window.setBorderless(true);
		expect(window.native).not.toBe(previous);
		expect(window.webContents).toBe(contents);
		expect(window.isBorderless()).toBe(true);
		expect(contents.close).not.toHaveBeenCalled();
		expect(previous.eventNames()).toEqual([]);
		window.native.emit("resize");
		expect(resized).toHaveBeenCalledOnce();
		window.native.destroy();
		expect(contents.close).toHaveBeenCalledOnce();
	});

	it("clears the viewport deadline after a successful page measurement", async () => {
		vi.useFakeTimers();
		const window = createWindow();
		await expect(window.getViewportSize()).resolves.toEqual(
			APP_WINDOW_TUNING.game.initialContentSize,
		);
		expect(vi.getTimerCount()).toBe(0);
		window.native.destroy();
	});

	it("bounds a page measurement that never replies", async () => {
		vi.useFakeTimers();
		const window = createWindow();
		vi.spyOn(window.webContents, "executeJavaScript").mockImplementationOnce(
			() => new Promise(() => {}),
		);
		const failed = expect(window.getViewportSize()).rejects.toThrow(
			"viewport measurement timed out",
		);
		await vi.advanceTimersByTimeAsync(APP_WINDOW_TUNING.transitionTimeoutMs);
		await failed;
		expect(vi.getTimerCount()).toBe(0);
		window.native.destroy();
	});
});
