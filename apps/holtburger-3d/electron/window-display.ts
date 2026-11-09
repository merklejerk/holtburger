import type { BaseWindow } from "electron";
import { APP_WINDOW_TUNING } from "../src/app/app-tuning.js";
import {
	WINDOW_CONTENT_PRESETS,
	type WindowContentSize,
	type WindowDisplayRequest,
	type WindowDisplaySnapshot,
} from "../src/app/window-display-contract.js";
import type { ClientWindowSettings } from "../src/app/window-settings-contract.js";

/** Native operations needed by the app-local display owner, also usable by focused probes. */
type DisplayWindow = Pick<
	BaseWindow,
	| "getBounds"
	| "setSize"
	| "getContentSize"
	| "getContentBounds"
	| "setContentBounds"
	| "isFullScreen"
	| "isMaximized"
	| "setFullScreen"
	| "setResizable"
	| "setMaximizable"
	| "unmaximize"
	| "maximize"
	| "setMinimumSize"
> & {
	on(event: string, listener: () => void): unknown;
	removeListener(event: string, listener: () => void): unknown;
};

/** Stable document owner forwards native events across frame replacement. */
interface DisplaySurface {
	readonly native: DisplayWindow;
	/** Actual page dimensions after the native-to-renderer scaling conversion. */
	getViewportSize(): Promise<WindowContentSize>;
	isBorderless(): boolean;
	setBorderless(enabled: boolean): void;
	on(event: string, listener: () => void): unknown;
	removeListener(event: string, listener: () => void): unknown;
}

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

/** Correct native scaling roundoff without repeatedly converting the window's position. */
async function resizeWindowContent(
	surface: DisplaySurface,
	target: WindowContentSize,
): Promise<void> {
	const window = surface.native;
	const { x, y } = window.getContentBounds();
	let request = target;
	let best: {
		readonly request: WindowContentSize;
		readonly error: number;
	} | null = null;
	for (;;) {
		await nativeTransition(window, null, () =>
			window.setContentBounds({ x, y, ...request }),
		);
		const { width, height } = await surface.getViewportSize();
		const error =
			Math.abs(target.width - width) + Math.abs(target.height - height);
		if (error === 0) return;
		// Clamping and unrepresentable logical sizes can prevent an exact result.
		// Retain the closest achieved viewport; the snapshot reports its actual dimensions.
		if (best !== null && error >= best.error) {
			const closest = best.request;
			await nativeTransition(window, null, () =>
				window.setContentBounds({ x, y, ...closest }),
			);
			return;
		}
		best = { request, error };
		// Each continuing step must reduce the integer error, so this search is finite.
		request = {
			width: Math.max(1, request.width + target.width - width),
			height: Math.max(1, request.height + target.height - height),
		};
	}
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
	readonly #surface: DisplaySurface;
	get #window(): DisplayWindow {
		return this.#surface.native;
	}
	readonly #publish: (snapshot: WindowDisplaySnapshot) => void;
	readonly #report: (error: unknown) => void;
	#windowed: WindowedGeometry;
	#freeResize: boolean;
	/** Last measured page viewport, shared by controls and confirmation text. */
	#contentSize: WindowContentSize;
	/** Reject a measurement superseded by another native configure event. */
	#contentRevision = 0;
	#busy = false;
	#preview: DisplayPreview | null = null;
	#confirmationId = 0;
	#confirmationTimer: ReturnType<typeof setTimeout> | undefined;
	#closed = false;
	#tail: Promise<void> = Promise.resolve();
	readonly #events = ["resize", "move", "maximize", "unmaximize"];
	constructor(
		surface: DisplaySurface,
		saved: ClientWindowSettings,
		publish: (snapshot: WindowDisplaySnapshot) => void,
		report: (error: unknown) => void,
	) {
		this.#surface = surface;
		const [width, height] = surface.native.getContentSize();
		this.#contentSize = { width, height };
		this.#windowed = {
			normalBounds: saved.normalBounds,
			maximized: saved.maximized,
		};
		this.#report = report;
		this.#freeResize = saved.freeResize;
		this.#publish = publish;
		for (const event of this.#events) surface.on(event, this.refresh);
		surface.on("enter-full-screen", this.#fullscreenChanged);
		surface.on("leave-full-screen", this.#fullscreenChanged);
	}
	/** Persist retained windowed geometry without consulting fullscreen bounds. */
	settings(): ClientWindowSettings {
		if (this.#preview !== null) return this.#preview.previous;
		return {
			...this.#windowed,
			fullscreen: this.#window.isFullScreen(),
			borderless: this.#surface.isBorderless(),
			freeResize: this.#freeResize,
		};
	}
	/** IPC reads measure the admitted page before exposing its viewport dimensions. */
	async read(): Promise<WindowDisplaySnapshot> {
		await this.#measureViewport();
		return this.snapshot();
	}
	snapshot(): WindowDisplaySnapshot {
		const window = this.#window;
		// Linux can expose the locked window size as its native minimum. Preset admission
		// uses the app’s viewport policy, independently of temporary native resize locks.
		const { width: minimumWidth, height: minimumHeight } =
			APP_WINDOW_TUNING.game.minimumContentSize;
		return {
			fullscreen: window.isFullScreen(),
			borderless: this.#surface.isBorderless(),
			freeResize: this.#freeResize,
			busy: this.#busy,
			confirmation: this.#busy ? null : (this.#preview?.confirmation ?? null),
			contentSize: this.#contentSize,
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
		if (!this.#busy && !this.#closed)
			void this.#measureViewport()
				.then(() => {
					if (!this.#closed) this.#publish(this.snapshot());
				})
				.catch((error: unknown) => {
					// Navigation may reject a pending measurement after this attempt retires.
					if (!this.#closed) this.#report(error);
				});
	};

	async #measureViewport(): Promise<void> {
		const revision = ++this.#contentRevision;
		const size = await this.#surface.getViewportSize();
		if (!this.#closed && revision === this.#contentRevision)
			this.#contentSize = size;
	}

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
					(request.kind === "fullscreen" &&
						request.enabled === this.#window.isFullScreen()) ||
					(request.kind === "borderless" &&
						request.enabled === this.#surface.isBorderless())
				)
					return;
				const { width, height } = await this.#surface.getViewportSize();
				if (
					request.kind === "size" &&
					!this.#window.isFullScreen() &&
					!this.#window.isMaximized() &&
					width === request.size.width &&
					height === request.size.height
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
			this.#surface.setBorderless(previous.borderless);
			setGameMinimumContentSize(this.#window);
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
				await this.#measureViewport();
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
				"Leave fullscreen before changing window borders, size, or free resize.",
			);
		if (request.kind === "borderless") {
			const maximized = window.isMaximized();
			if (maximized)
				await nativeTransition(window, "unmaximize", () => window.unmaximize());
			const { width, height } = await this.#surface.getViewportSize();
			this.#surface.setBorderless(request.enabled);
			setGameMinimumContentSize(this.#window);
			applyNativeResizePolicy(this.#window, this.#freeResize);
			await nativeTransition(this.#window, null, () => {});
			await resizeWindowContent(this.#surface, { width, height });
			this.#windowed = readWindowedGeometry(this.#window, this.#windowed);
			if (maximized)
				await nativeTransition(this.#window, "maximize", () =>
					this.#window.maximize(),
				);
			return;
		}
		if (request.kind === "free-resize") {
			if (!request.enabled && window.isMaximized())
				await nativeTransition(window, "unmaximize", () => window.unmaximize());
			const { width, height } = await this.#surface.getViewportSize();
			applyNativeResizePolicy(window, request.enabled);
			if (!window.isMaximized()) {
				await nativeTransition(window, null, () => {});
				await resizeWindowContent(this.#surface, { width, height });
			}
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
		const { width, height } = await this.#surface.getViewportSize();
		if (width === request.size.width && height === request.size.height) return;
		await resizeWindowContent(this.#surface, request.size);
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
				this.#surface.removeListener(event, this.refresh);
			this.#surface.removeListener(
				"enter-full-screen",
				this.#fullscreenChanged,
			);
			this.#surface.removeListener(
				"leave-full-screen",
				this.#fullscreenChanged,
			);
		}
	}
}

/** Convert the game viewport minimum to the outer dimensions required by Electron. */
export function setGameMinimumContentSize(
	window: Pick<BaseWindow, "getBounds" | "getContentSize" | "setMinimumSize">,
): void {
	const outer = window.getBounds();
	const [width, height] = window.getContentSize();
	const minimum = APP_WINDOW_TUNING.game.minimumContentSize;
	window.setMinimumSize(
		minimum.width + outer.width - width,
		minimum.height + outer.height - height,
	);
}

/** Replace surface geometry only after leaving the preceding surface’s native fullscreen state. */
export async function restoreWindowGeometry(
	surface: DisplaySurface,
	value: ClientWindowSettings,
	role: "picker" | "client",
): Promise<ClientWindowSettings> {
	await changeNativeFullscreen(surface.native, false);
	surface.setBorderless(role === "client" && value.borderless);
	const window = surface.native;
	window.setResizable(true);
	window.setMaximizable(true);
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
	return {
		...accepted,
		fullscreen: window.isFullScreen(),
		freeResize,
		borderless: surface.isBorderless(),
	};
}
