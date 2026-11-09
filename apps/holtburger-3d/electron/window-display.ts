import type { BrowserWindow } from "electron";
import { APP_WINDOW_TUNING } from "../src/app/app-tuning.js";
import {
	WINDOW_CONTENT_PRESETS,
	type WindowDisplayRequest,
	type WindowDisplaySnapshot,
} from "../src/app/window-display-contract.js";
import type { ClientWindowSettings } from "../src/app/window-settings-contract.js";

/** Native operations needed by the app-local display owner, also usable by focused probes. */
type DisplayWindow = Pick<
	BrowserWindow,
	| "getBounds"
	| "setSize"
	| "getContentBounds"
	| "isFullScreen"
	| "isMaximized"
	| "setFullScreen"
	| "setResizable"
	| "setMaximizable"
	| "unmaximize"
	| "maximize"
	| "setContentSize"
> & {
	on(event: string, listener: () => void): unknown;
	removeListener(event: string, listener: () => void): unknown;
};

/** Wait for the native mode acknowledgement and its associated geometry configure burst. */
export function changeNativeFullscreen(
	window: DisplayWindow,
	enabled: boolean,
): Promise<void> {
	if (window.isFullScreen() === enabled) return Promise.resolve();
	return nativeTransition(
		window,
		enabled ? "enter-full-screen" : "leave-full-screen",
		() => window.setFullScreen(enabled),
	);
}

/** Mode events precede configure events on Wayland; unchanged geometry may emit no resize. */
function nativeTransition(
	window: DisplayWindow,
	event: string | null,
	change: () => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		// A null event means a native mode event has already been received by the caller.
		let acknowledged = event === null;
		let quietTimer: ReturnType<typeof setTimeout> | undefined;
		const events = [
			"resize",
			"maximize",
			"unmaximize",
			"enter-full-screen",
			"leave-full-screen",
		];
		const cleanup = () => {
			clearTimeout(deadline);
			clearTimeout(quietTimer);
			for (const { name, listener } of listeners)
				window.removeListener(name, listener);
		};
		const settle = () => {
			if (!acknowledged) return;
			clearTimeout(quietTimer);
			quietTimer = setTimeout(() => {
				cleanup();
				resolve();
			}, APP_WINDOW_TUNING.geometryQuietMs);
		};
		const listeners = events.map((name) => ({
			name,
			listener: () => {
				if (name === event) acknowledged = true;
				settle();
			},
		}));
		const deadline = setTimeout(() => {
			cleanup();
			reject(
				new Error(
					`Window transition timed out waiting for ${acknowledged ? "geometry to settle" : event}.`,
				),
			);
		}, APP_WINDOW_TUNING.transitionTimeoutMs);
		for (const { name, listener } of listeners) window.on(name, listener);
		try {
			change();
			settle();
		} catch (error) {
			cleanup();
			reject(error);
		}
	});
}

/** Resize locking is windowed policy; fullscreen needs an unconstrained native surface. */
function applyNativeResizePolicy(
	window: DisplayWindow,
	freeResize: boolean,
): void {
	const enabled = window.isFullScreen() || freeResize;
	window.setResizable(enabled);
	window.setMaximizable(enabled);
}

/** Retained windowed geometry is independent of native fullscreen configure events. */
type WindowedGeometry = Pick<
	ClientWindowSettings,
	"normalBounds" | "maximized"
>;

function readWindowedGeometry(
	window: DisplayWindow,
	previous: WindowedGeometry,
): WindowedGeometry {
	const maximized = window.isMaximized();
	// Native normal-bounds metadata can lag programmatic sizing while resize is locked.
	// Read actual windowed bounds; maximizing retains the last observed normal size.
	const { width, height } = maximized
		? previous.normalBounds
		: window.getBounds();
	return { normalBounds: { width, height }, maximized };
}

/** Wait for native sizing before locking; leave-full-screen can precede the windowed resize. */
async function restoreWindowedGeometry(
	window: DisplayWindow,
	geometry: WindowedGeometry,
): Promise<WindowedGeometry> {
	// A compositor may already have restored maximization on fullscreen exit.
	// Do not unmaximize and remaximize it; those configure events can outlive the next request.
	if (geometry.maximized && window.isMaximized()) return geometry;
	if (window.isMaximized())
		await nativeTransition(window, "unmaximize", () => window.unmaximize());
	const bounds = window.getBounds();
	const { width, height } = geometry.normalBounds;
	if (bounds.width !== width || bounds.height !== height) {
		await nativeTransition(window, "resize", () =>
			window.setSize(width, height),
		);
	}
	const accepted = readWindowedGeometry(window, geometry);
	if (geometry.maximized && !window.isMaximized())
		await nativeTransition(window, "maximize", () => window.maximize());
	return { ...accepted, maximized: window.isMaximized() };
}

/** A preview retains persistence-safe settings throughout apply, confirmation, and rollback. */
interface DisplayPreview {
	/** Last accepted mode and windowed geometry. */
	readonly previous: ClientWindowSettings;
	/** Decision published after native operations settle; failed restores permit only recovery. */
	confirmation: NonNullable<WindowDisplaySnapshot["confirmation"]>;
}

/** One client-attempt owner serializes native changes and preserves windowed size and maximize state. */
export class WindowDisplay {
	readonly #window: DisplayWindow;
	readonly #publish: (snapshot: WindowDisplaySnapshot) => void;
	readonly #report: (error: unknown) => void;
	#windowed: WindowedGeometry;
	#freeResize: boolean;
	#busy = false;
	#preview: DisplayPreview | null = null;
	#confirmationId = 0;
	#confirmationTimer: ReturnType<typeof setTimeout> | undefined;
	#closed = false;
	#tail: Promise<void> = Promise.resolve();
	readonly #events = ["resize", "move", "maximize", "unmaximize"];
	constructor(
		window: DisplayWindow,
		saved: ClientWindowSettings,
		publish: (snapshot: WindowDisplaySnapshot) => void,
		report: (error: unknown) => void,
	) {
		this.#window = window;
		this.#windowed = {
			normalBounds: saved.normalBounds,
			maximized: saved.maximized,
		};
		this.#report = report;
		this.#freeResize = saved.freeResize;
		this.#publish = publish;
		for (const event of this.#events) window.on(event, this.refresh);
		window.on("enter-full-screen", this.#fullscreenChanged);
		window.on("leave-full-screen", this.#fullscreenChanged);
	}
	/** Persist retained windowed geometry without consulting fullscreen bounds. */
	settings(): ClientWindowSettings {
		if (this.#preview !== null) return this.#preview.previous;
		return {
			...this.#windowed,
			fullscreen: this.#window.isFullScreen(),
			freeResize: this.#freeResize,
		};
	}
	snapshot(): WindowDisplaySnapshot {
		const window = this.#window;
		const content = window.getContentBounds();
		// Linux can expose the locked window size as its native minimum. Preset admission
		// uses the app’s viewport policy, independently of temporary native resize locks.
		const { width: minimumWidth, height: minimumHeight } =
			APP_WINDOW_TUNING.game.minimumContentSize;
		return {
			fullscreen: window.isFullScreen(),
			freeResize: this.#freeResize,
			busy: this.#busy,
			confirmation: this.#busy ? null : (this.#preview?.confirmation ?? null),
			contentSize: { width: content.width, height: content.height },
			// Window sizes are requests, not display modes. Native monitor placement can be
			// unavailable under Wayland; do not use it to hide otherwise valid presets.
			presets: WINDOW_CONTENT_PRESETS.filter(
				(size) => size.width >= minimumWidth && size.height >= minimumHeight,
			),
		};
	}
	/** Native events are cold window state, never renderer frame events. */
	readonly refresh = (): void => {
		if (!this.#busy && !this.#window.isFullScreen())
			this.#windowed = readWindowedGeometry(this.#window, this.#windowed);
		this.#publish(this.snapshot());
	};

	/** OS fullscreen gestures use the same preview policy as IPC and F11. */
	readonly #fullscreenChanged = (): void => {
		if (this.#closed || this.#busy) return;
		const enabled = this.#window.isFullScreen();
		// Fullscreen exits must restore windowed geometry before fixed-size hints are reinstated.
		if (enabled) applyNativeResizePolicy(this.#window, this.#freeResize);
		const previous = { ...this.settings(), fullscreen: !enabled };
		const settled = nativeTransition(this.#window, null, () => {});
		void this.#enqueue(async () => {
			if (this.#preview !== null) {
				await settled;
				await this.#revert();
			} else
				await this.#startPreview(previous, async () => {
					await settled;
					await this.#apply({ kind: "fullscreen", enabled });
				});
		}).catch(this.#report);
	};

	change(request: WindowDisplayRequest): Promise<void> {
		return this.#enqueue(async () => {
			if (request.kind === "confirm") {
				const confirmation = this.#preview?.confirmation;
				// Timeout and a late UI answer may race. Obsolete answers never affect a new preview.
				if (confirmation?.id !== request.id) return;
				if (
					request.keep &&
					confirmation.kind === "preview" &&
					Date.now() < confirmation.expiresAt
				) {
					clearTimeout(this.#confirmationTimer);
					this.#preview = null;
				} else await this.#revert();
				return;
			}
			if (this.#preview !== null)
				throw new Error("Keep or revert the current display change first.");
			if (request.kind === "free-resize") await this.#apply(request);
			else {
				if (
					request.kind === "fullscreen" &&
					request.enabled === this.#window.isFullScreen()
				)
					return;
				const content = this.#window.getContentBounds();
				if (
					request.kind === "size" &&
					!this.#window.isFullScreen() &&
					!this.#window.isMaximized() &&
					content.width === request.size.width &&
					content.height === request.size.height
				)
					return;
				await this.#startPreview(this.settings(), () => this.#apply(request));
			}
		});
	}
	async #startPreview(
		previous: ClientWindowSettings,
		apply: () => Promise<void>,
	): Promise<void> {
		const id = ++this.#confirmationId;
		const preview: DisplayPreview = {
			previous,
			confirmation: { kind: "recovery", id },
		};
		this.#preview = preview;
		// An OS mode event can be followed by resize events before this queued operation runs.
		// Its captured windowed geometry remains the authority for fullscreen restoration.
		this.#windowed = {
			normalBounds: previous.normalBounds,
			maximized: previous.maximized,
		};
		try {
			await apply();
		} catch (error) {
			// Partial native changes must be restored before exposing settings to persistence.
			try {
				await this.#revert();
			} catch (rollbackError) {
				throw new AggregateError(
					[error, rollbackError],
					"Display change and restoration both failed.",
					{ cause: rollbackError },
				);
			}
			throw error;
		}
		preview.confirmation = {
			kind: "preview",
			id,
			expiresAt: Date.now() + APP_WINDOW_TUNING.displayConfirmationMs,
		};
		this.#confirmationTimer = setTimeout(() => {
			void this.change({ kind: "confirm", id, keep: false }).catch(
				this.#report,
			);
		}, APP_WINDOW_TUNING.displayConfirmationMs);
	}
	async #revert(): Promise<void> {
		clearTimeout(this.#confirmationTimer);
		const preview = this.#preview;
		if (preview === null) return;
		// Once restoration starts, a failed native operation must never make Keep valid again.
		preview.confirmation = { kind: "recovery", id: preview.confirmation.id };
		const previous = preview.previous;
		this.#windowed = {
			normalBounds: previous.normalBounds,
			maximized: previous.maximized,
		};
		this.#freeResize = previous.freeResize;
		// Release native locks while restoring arbitrary custom bounds and maximization.
		this.#window.setResizable(true);
		this.#window.setMaximizable(true);
		try {
			await changeNativeFullscreen(this.#window, false);
			this.#windowed = await restoreWindowedGeometry(
				this.#window,
				this.#windowed,
			);
			await changeNativeFullscreen(this.#window, previous.fullscreen);
			this.#preview = null;
		} finally {
			applyNativeResizePolicy(this.#window, this.#freeResize);
		}
	}
	#enqueue(apply: () => Promise<void>): Promise<void> {
		if (this.#closed)
			return Promise.reject(new Error("Client window controls have retired."));
		const changing = this.#tail.then(async () => {
			this.#busy = true;
			this.refresh();
			try {
				await apply();
			} finally {
				this.#busy = false;
				this.refresh();
			}
		});
		// The caller receives failures. Keep later user requests usable after a rejected native operation.
		this.#tail = changing.catch(() => {});
		return changing;
	}
	async #apply(
		request: Exclude<WindowDisplayRequest, { kind: "confirm" }>,
	): Promise<void> {
		const window = this.#window;
		if (request.kind === "fullscreen") {
			if (request.enabled && !window.isFullScreen())
				this.#windowed = readWindowedGeometry(window, this.#windowed);
			// Release fixed-size hints before the window manager configures the fullscreen surface.
			window.setResizable(true);
			window.setMaximizable(true);
			try {
				await changeNativeFullscreen(window, request.enabled);
				if (!request.enabled)
					this.#windowed = await restoreWindowedGeometry(
						window,
						this.#windowed,
					);
			} finally {
				applyNativeResizePolicy(window, this.#freeResize);
			}
			return;
		}
		if (window.isFullScreen())
			throw new Error(
				"Leave fullscreen before changing window size or free resize.",
			);
		if (request.kind === "free-resize") {
			if (!request.enabled && window.isMaximized())
				await nativeTransition(window, "unmaximize", () => window.unmaximize());
			applyNativeResizePolicy(window, request.enabled);
			this.#freeResize = request.enabled;
			return;
		}
		if (
			!this.snapshot().presets.some(
				(size) =>
					size.width === request.size.width &&
					size.height === request.size.height,
			)
		)
			throw new Error("Window size is not a supported preset.");
		if (window.isMaximized())
			await nativeTransition(window, "unmaximize", () => window.unmaximize());
		const content = window.getContentBounds();
		if (
			content.width === request.size.width &&
			content.height === request.size.height
		)
			return;
		await nativeTransition(window, "resize", () =>
			window.setContentSize(request.size.width, request.size.height),
		);
	}
	/** Drain requests before another document restores its own native geometry. */
	async close(): Promise<void> {
		this.#closed = true;
		await this.#tail;
		clearTimeout(this.#confirmationTimer);
		this.#busy = true;
		try {
			await this.#revert();
		} finally {
			this.#busy = false;
			for (const event of this.#events)
				this.#window.removeListener(event, this.refresh);
			this.#window.removeListener("enter-full-screen", this.#fullscreenChanged);
			this.#window.removeListener("leave-full-screen", this.#fullscreenChanged);
		}
	}
}

/** Convert the game viewport minimum to the outer dimensions required by Electron. */
export function setGameMinimumContentSize(
	window: Pick<
		BrowserWindow,
		"getBounds" | "getContentBounds" | "setMinimumSize"
	>,
): void {
	const outer = window.getBounds();
	const content = window.getContentBounds();
	const minimum = APP_WINDOW_TUNING.game.minimumContentSize;
	window.setMinimumSize(
		minimum.width + outer.width - content.width,
		minimum.height + outer.height - content.height,
	);
}

/** Replace surface geometry only after leaving the preceding surface’s native fullscreen state. */
export async function restoreWindowGeometry(
	window: DisplayWindow & Pick<BrowserWindow, "setMinimumSize">,
	value: ClientWindowSettings,
	role: "picker" | "client",
): Promise<ClientWindowSettings> {
	window.setResizable(true);
	window.setMaximizable(true);
	await changeNativeFullscreen(window, false);
	if (window.isMaximized())
		await nativeTransition(window, "unmaximize", () => window.unmaximize());
	if (role === "picker") {
		const minimum = APP_WINDOW_TUNING.launcher.minimumSize;
		window.setMinimumSize(minimum.width, minimum.height);
	} else setGameMinimumContentSize(window);
	const accepted = await restoreWindowedGeometry(window, {
		normalBounds: value.normalBounds,
		maximized: value.maximized && value.freeResize,
	});
	if (role === "client") await changeNativeFullscreen(window, value.fullscreen);
	const freeResize = role === "picker" || value.freeResize;
	applyNativeResizePolicy(window, freeResize);
	return { ...accepted, fullscreen: window.isFullScreen(), freeResize };
}
