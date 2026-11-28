import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_WINDOW_TUNING } from "../src/app/desktop/app-tuning";
import { ApplicationWindow } from "./application-window";

vi.mock("electron", () => ({
	BaseWindow: class extends EventEmitter {
		readonly contentView = {
			addChildView: vi.fn(),
			removeChildView: vi.fn(),
		};
		readonly size: [number, number];
		readonly x: number | undefined;
		readonly y: number | undefined;
		readonly minWidth: number | undefined;
		readonly minHeight: number | undefined;
		visible: boolean;
		constructor(options: {
			width: number;
			height: number;
			x?: number;
			y?: number;
			minWidth?: number;
			minHeight?: number;
			show?: boolean;
		}) {
			super();
			this.size = [options.width, options.height];
			this.x = options.x;
			this.y = options.y;
			this.minWidth = options.minWidth;
			this.minHeight = options.minHeight;
			this.visible = options.show !== false;
		}
		getContentSize() {
			return this.size;
		}
		setContentSize(width: number, height: number) {
			this.size[0] = width;
			this.size[1] = height;
		}
		getBounds() {
			return {
				x: this.x ?? 0,
				y: this.y ?? 0,
				width: this.size[0],
				height: this.size[1],
			};
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
			getURL: vi.fn(() => "http://127.0.0.1:1421/client/index.html"),
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

	it("replaces the native surface at a new size and minimum without carrying over prior coordinates", () => {
		const window = createWindow();
		const previous = window.native;
		const target = APP_WINDOW_TUNING.launcher.initialContentSize;
		const minimum = APP_WINDOW_TUNING.launcher.minimumSize;
		window.replaceSurface({
			borderless: false,
			contentSize: target,
			minimumSize: minimum,
		});
		expect(window.native).not.toBe(previous);
		expect(window.native.getContentSize()).toEqual([
			target.width,
			target.height,
		]);
		const replaced = window.native as unknown as {
			x?: number;
			y?: number;
			minWidth?: number;
			minHeight?: number;
		};
		expect(replaced.x).toBeUndefined();
		expect(replaced.y).toBeUndefined();
		expect(replaced.minWidth).toBe(minimum.width);
		expect(replaced.minHeight).toBe(minimum.height);
		window.native.destroy();
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

	it("reads native content size directly before any document has loaded", async () => {
		const window = createWindow();
		vi.spyOn(window.webContents, "getURL").mockReturnValueOnce("");
		await expect(window.getViewportSize()).resolves.toEqual(
			APP_WINDOW_TUNING.game.initialContentSize,
		);
		expect(window.webContents.executeJavaScript).not.toHaveBeenCalled();
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
