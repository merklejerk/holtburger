import { EventEmitter } from "node:events";
import { APP_WINDOW_TUNING } from "../src/app/desktop/app-tuning.js";
import {
	windowContentSizeSchema,
	type WindowContentSize,
} from "../src/app/desktop/window-display-contract.js";
import {
	BaseWindow,
	WebContentsView,
	type BaseWindowConstructorOptions,
	type WebPreferences,
} from "electron";

/** Native chrome can be replaced while the admitted document and game session remain alive. */
export class ApplicationWindow extends EventEmitter {
	readonly #options: BaseWindowConstructorOptions;
	readonly #view: WebContentsView;
	#native: BaseWindow;
	#borderless = false;
	#detach: (() => void)[] = [];

	constructor(
		options: Omit<BaseWindowConstructorOptions, "frame"> & {
			webPreferences: WebPreferences;
		},
	) {
		super();
		const { webPreferences, ...nativeOptions } = options;
		this.#options = nativeOptions;
		this.#view = new WebContentsView({ webPreferences });
		this.#native = new BaseWindow({ ...nativeOptions, frame: true });
		this.#attach();
	}
	/** Current native surface; callers must not retain it across a chrome change. */
	get native(): BaseWindow {
		return this.#native;
	}
	/** Renderer identity survives native surface replacement. */
	get webContents() {
		return this.#view.webContents;
	}
	/** Native DIP bounds can differ from the page viewport after fractional scaling. */
	async getViewportSize(): Promise<WindowContentSize> {
		// Before any document loads, executeJavaScript has no renderer frame and would stall.
		if (this.webContents.getURL() === "") {
			const [width, height] = this.#native.getContentSize();
			return { width, height };
		}
		// A stalled page must not hold queued native controls or their retirement open.
		let deadline: ReturnType<typeof setTimeout> | undefined;
		try {
			const value = await Promise.race([
				this.webContents.executeJavaScript(
					"({ width: innerWidth, height: innerHeight })",
				),
				new Promise<never>((_resolve, reject) => {
					deadline = setTimeout(
						() => reject(new Error("Window viewport measurement timed out.")),
						APP_WINDOW_TUNING.transitionTimeoutMs,
					);
				}),
			]);
			return windowContentSizeSchema.parse(value);
		} finally {
			clearTimeout(deadline);
		}
	}

	isBorderless(): boolean {
		return this.#borderless;
	}

	/** Callers own fullscreen, maximization, geometry restoration, and resize policy. */
	setBorderless(enabled: boolean): void {
		if (enabled === this.#borderless) return;
		const [width, height] = this.#native.getContentSize();
		this.#replaceNative({
			borderless: enabled,
			contentSize: { width, height },
			preservePosition: true,
		});
	}

	/**
	 * Swap the native frame at a new content size without carrying over the prior position.
	 * On Wayland, compositors ignore client-side moves on mapped windows, so mapping a fresh
	 * toplevel at the target size lets the compositor place it inside the monitor work area.
	 */
	replaceSurface(options: {
		readonly borderless: boolean;
		readonly contentSize: WindowContentSize;
		readonly minimumSize: WindowContentSize;
	}): void {
		this.#replaceNative({
			borderless: options.borderless,
			contentSize: options.contentSize,
			minimumSize: options.minimumSize,
			preservePosition: false,
		});
	}

	#replaceNative(options: {
		readonly borderless: boolean;
		readonly contentSize: WindowContentSize;
		readonly minimumSize?: WindowContentSize;
		readonly preservePosition: boolean;
	}): void {
		if (this.#native.isFullScreen())
			throw new Error("Leave fullscreen before changing window borders.");
		const previous = this.#native;
		const { width, height } = options.contentSize;
		// Preserve the viewport directly. Normal and current outer bounds can disagree;
		// subtracting them feeds that discrepancy into each successive replacement.
		const position = options.preservePosition
			? (() => {
					const { x, y } = previous.getBounds();
					return { x, y };
				})()
			: {};
		const minimum =
			options.minimumSize === undefined
				? {}
				: {
						minWidth: options.minimumSize.width,
						minHeight: options.minimumSize.height,
					};
		const replacement = new BaseWindow({
			...this.#options,
			...minimum,
			frame: !options.borderless,
			...position,
			width,
			height,
			useContentSize: true,
			show: false,
		});
		// Reapply while hidden so Electron/Wayland does not negotiate down to minWidth.
		replacement.setContentSize(width, height);
		const visible = previous.isVisible();
		for (const detach of this.#detach.splice(0)) detach();
		previous.contentView.removeChildView(this.#view);
		this.#native = replacement;
		this.#borderless = options.borderless;
		this.#attach();
		// Create the replacement before destroying its predecessor so this is never app shutdown.
		previous.destroy();
		if (visible) replacement.show();
		this.webContents.focus();
	}

	#attach(): void {
		const native = this.#native;
		native.contentView.addChildView(this.#view);
		const resize = () => {
			const [width, height] = native.getContentSize();
			this.#view.setBounds({ x: 0, y: 0, width, height });
		};
		resize();
		native.on("resize", resize);
		this.#detach.push(() => native.removeListener("resize", resize));
		const events: Pick<EventEmitter, "on" | "removeListener"> = native;
		for (const event of [
			"resize",
			"move",
			"maximize",
			"unmaximize",
			"enter-full-screen",
			"leave-full-screen",
			"show",
			"hide",
			"minimize",
			"restore",
			"focus",
			"blur",
			"close",
			"closed",
		] as const) {
			const forward = (...args: unknown[]) => this.emit(event, ...args);
			events.on(event, forward);
			this.#detach.push(() => events.removeListener(event, forward));
		}
		const closed = () => {
			for (const detach of this.#detach.splice(0)) detach();
			this.webContents.close();
		};
		native.once("closed", closed);
		this.#detach.push(() => native.removeListener("closed", closed));
	}
}
