import type { BaseWindow } from "electron";
import { APP_WINDOW_TUNING } from "../src/app/desktop/app-tuning.js";
import {
	WINDOW_CONTENT_PRESETS,
	type WindowContentSize,
	type WindowDisplayRequest,
	type WindowDisplaySnapshot,
} from "../src/app/desktop/window-display-contract.js";
import type { ClientWindowSettings } from "../src/app/desktop/window-settings-contract.js";

/** Bound viewport convergence steps when a compositor clamps or oscillates. */
const MAX_VIEWPORT_RESIZE_ATTEMPTS = 4;

/** Native operations needed by the app-local display owner, also usable by focused probes. */
type DisplayWindow = Pick<
	BaseWindow,
	| "getBounds"
	| "getContentSize"
	| "setContentSize"
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

/** Request the target viewport via content size, correcting native scaling roundoff. */
async function resizeWindowContent(
	surface: DisplaySurface,
	target: WindowContentSize,
): Promise<WindowContentSize> {
	const window = surface.native;
	let request = target;
	let best: {
		readonly request: WindowContentSize;
		readonly measured: WindowContentSize;
		readonly error: number;
	} | null = null;
	for (let attempt = 0; attempt < MAX_VIEWPORT_RESIZE_ATTEMPTS; attempt += 1) {
		await nativeTransition(window, null, () =>
			window.setContentSize(request.width, request.height),
		);
		const measured = await surface.getViewportSize();
		const error =
			Math.abs(target.width - measured.width) +
			Math.abs(target.height - measured.height);
		if (error === 0) return measured;
		// Clamping and unrepresentable logical sizes can prevent an exact result.
		// Retain the closest achieved viewport; the snapshot reports its actual dimensions.
		if (best !== null && error >= best.error) {
			if (error > best.error) {
				const closest = best.request;
				await nativeTransition(window, null, () =>
					window.setContentSize(closest.width, closest.height),
				);
				return await surface.getViewportSize();
			}
			return measured;
		}
		best = { request, measured, error };
		request = {
			width: Math.max(1, request.width + target.width - measured.width),
			height: Math.max(1, request.height + target.height - measured.height),
		};
	}
	return best?.measured ?? (await surface.getViewportSize());
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

/** Unlock fixed-size hints during programmatic resizes so compositors accept the new size. */
async function withUnlockedResize<T>(
	surface: DisplaySurface,
	freeResize: boolean,
	operation: () => Promise<T>,
): Promise<T> {
	surface.native.setResizable(true);
	surface.native.setMaximizable(true);
	try {
		return await operation();
	} finally {
		applyNativeResizePolicy(surface.native, freeResize);
	}
}

/** Retained windowed geometry is independent of native fullscreen configure events. */
type WindowedGeometry = Pick<ClientWindowSettings, "contentSize" | "maximized">;

function readWindowedGeometry(
	window: DisplayWindow,
	previous: WindowedGeometry,
	measured?: WindowContentSize,
): WindowedGeometry {
	const maximized = window.isMaximized();
	if (maximized) return { contentSize: previous.contentSize, maximized: true };
	if (measured !== undefined)
		return { contentSize: measured, maximized: false };
	const [width, height] = window.getContentSize();
	return { contentSize: { width, height }, maximized: false };
}

/** Restore windowed viewport size and maximize state before reinstating resize locks. */
async function restoreWindowedGeometry(
	surface: DisplaySurface,
	geometry: WindowedGeometry,
): Promise<WindowedGeometry> {
	const window = surface.native;
	// A compositor may already have restored maximization on fullscreen exit.
	// Do not unmaximize and remaximize it; those configure events can outlive the next request.
	if (geometry.maximized && window.isMaximized()) return geometry;
	if (window.isMaximized())
		await nativeTransition(window, "unmaximize", () => window.unmaximize());
	const current = await surface.getViewportSize();
	const accepted =
		current.width === geometry.contentSize.width &&
		current.height === geometry.contentSize.height
			? current
			: await resizeWindowContent(surface, geometry.contentSize);
	if (geometry.maximized && !window.isMaximized())
		await nativeTransition(window, "maximize", () => window.maximize());
	return { contentSize: accepted, maximized: window.isMaximized() };
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
			contentSize: saved.contentSize,
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
					if (!this.#closed) {
						if (!this.#busy && !this.#window.isFullScreen())
							this.#windowed = readWindowedGeometry(
								this.#window,
								this.#windowed,
								this.#contentSize,
							);
						this.#publish(this.snapshot());
					}
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
			contentSize: previous.contentSize,
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
			contentSize: previous.contentSize,
			maximized: previous.maximized,
		};
		this.#freeResize = previous.freeResize;
		await withUnlockedResize(this.#surface, this.#freeResize, async () => {
			await changeNativeFullscreen(this.#window, false);
			this.#surface.setBorderless(previous.borderless);
			setGameMinimumContentSize(this.#window);
			this.#windowed = await restoreWindowedGeometry(
				this.#surface,
				this.#windowed,
			);
			await changeNativeFullscreen(this.#window, previous.fullscreen);
			this.#preview = null;
		});
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
			if (request.enabled && !window.isFullScreen()) {
				const measured = await this.#surface.getViewportSize();
				this.#windowed = readWindowedGeometry(window, this.#windowed, measured);
			}
			await withUnlockedResize(this.#surface, this.#freeResize, async () => {
				await changeNativeFullscreen(window, request.enabled);
				if (!request.enabled)
					this.#windowed = await restoreWindowedGeometry(
						this.#surface,
						this.#windowed,
					);
			});
			return;
		}
		if (window.isFullScreen())
			throw new Error(
				"Leave fullscreen before changing window borders, size, or free resize.",
			);
		if (request.kind === "borderless") {
			await withUnlockedResize(this.#surface, this.#freeResize, async () => {
				const maximized = this.#window.isMaximized();
				if (maximized)
					await nativeTransition(this.#window, "unmaximize", () =>
						this.#window.unmaximize(),
					);
				const target = await this.#surface.getViewportSize();
				this.#surface.setBorderless(request.enabled);
				setGameMinimumContentSize(this.#window);
				await nativeTransition(this.#window, null, () => {});
				const accepted = await resizeWindowContent(this.#surface, target);
				this.#windowed = { contentSize: accepted, maximized };
				if (maximized)
					await nativeTransition(this.#window, "maximize", () =>
						this.#window.maximize(),
					);
			});
			return;
		}
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
		await withUnlockedResize(this.#surface, this.#freeResize, async () => {
			this.#windowed = await restoreWindowedGeometry(this.#surface, {
				contentSize: request.size,
				maximized: false,
			});
		});
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
		minimum.width + Math.max(0, outer.width - width),
		minimum.height + Math.max(0, outer.height - height),
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
	const freeResize = role === "picker" || value.freeResize;
	const accepted = await withUnlockedResize(surface, freeResize, async () => {
		const window = surface.native;
		if (window.isMaximized())
			await nativeTransition(window, "unmaximize", () => window.unmaximize());
		if (role === "picker") {
			const minimum = APP_WINDOW_TUNING.launcher.minimumSize;
			window.setMinimumSize(minimum.width, minimum.height);
		} else setGameMinimumContentSize(window);
		const restored = await restoreWindowedGeometry(surface, {
			contentSize: value.contentSize,
			maximized: value.maximized && freeResize,
		});
		if (role === "client")
			await changeNativeFullscreen(window, value.fullscreen);
		return restored;
	});
	return {
		...accepted,
		fullscreen: surface.native.isFullScreen(),
		freeResize,
		borderless: surface.isBorderless(),
	};
}
