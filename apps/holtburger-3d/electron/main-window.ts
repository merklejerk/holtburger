import { app, dialog } from "electron";
import { join } from "node:path";
import { APP_WINDOW_TUNING } from "../src/app/desktop/app-tuning.js";
import type { WindowDisplayRequest } from "../src/app/desktop/window-display-contract.js";
import type { ClientWindowSettings } from "../src/app/desktop/window-settings-contract.js";
import { formatError } from "../src/lib/format-error.js";
import type { HostMode } from "../src/lib/host/host-transport.js";
import type {
	AppFailureKind,
	AppFailureReportStore,
} from "./app-failure-report.js";
import { ApplicationWindow } from "./application-window.js";
import type { ClientRetirement } from "./client-retirement.js";
import type { ClientSettingsStore } from "./client-settings-store.js";
import type { DocumentRole } from "./document-admission.js";
import { electronDevOrigin } from "./main-entry.js";
import { requireApplicationFrame, type IpcHandleFn } from "./main-ipc-guard.js";
import { isAllowedNavigation } from "./navigation-policy.js";
import {
	PointerLockHover,
	pointerPositionSchema,
} from "./pointer-lock-hover.js";
import type { RuntimeLog } from "./runtime-log.js";
import { setGameMinimumContentSize, WindowDisplay } from "./window-display.js";

export interface WindowGeometrySlot {
	windowDisplay: WindowDisplay | null;
	stopGeometry: (() => Promise<void>) | null;
}

export interface CreateWindowContext {
	readonly applicationIconPath: string;
	readonly preloadPath: string;
	readonly handle: IpcHandleFn;
	readonly getDocumentRetirement: () => ClientRetirement | undefined;
	readonly isQuitting: () => boolean;
	readonly getDocumentRole: () => DocumentRole | null;
	readonly clientRuntimeLog: RuntimeLog;
	readonly failureReports: AppFailureReportStore;
	readonly getWindowDisplay: () => WindowDisplay | null;
	readonly changeWindowDisplay: (
		request: WindowDisplayRequest,
	) => Promise<void>;
	readonly onFatalError: (
		title: string,
		error: unknown,
		kind: AppFailureKind,
	) => void;
}

export function createWindow(
	entry: {
		title: string;
		mode: HostMode;
		noLauncher: boolean;
	},
	context: CreateWindowContext,
): ApplicationWindow {
	const developmentOrigin = electronDevOrigin(entry.mode);
	const ozonePlatform = app.commandLine.getSwitchValue("ozone-platform");
	const restoreWaylandPointer =
		process.platform === "linux" &&
		ozonePlatform !== "x11" &&
		(ozonePlatform === "wayland" || process.env.XDG_SESSION_TYPE === "wayland");
	const window = new ApplicationWindow({
		title: entry.title,
		icon: context.applicationIconPath,
		width: APP_WINDOW_TUNING.game.initialContentSize.width,
		height: APP_WINDOW_TUNING.game.initialContentSize.height,
		useContentSize: true,
		minWidth: APP_WINDOW_TUNING.game.minimumContentSize.width,
		minHeight: APP_WINDOW_TUNING.game.minimumContentSize.height,
		resizable: true,
		show: false,
		backgroundColor: APP_WINDOW_TUNING.backgroundColor,
		webPreferences: {
			preload: context.preloadPath,
			additionalArguments: [
				...(entry.noLauncher ? ["--holtburger-launcher-disabled"] : []),
				...(restoreWaylandPointer
					? ["--holtburger-wayland-pointer-restore"]
					: []),
			],
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			// Chromium 152 counts successive camera holds until a two-second pause, rejecting normal play.
			// Opt this application window out of that browser-page limiter; capture still ends on release.
			// Upstream fix: https://chromium-review.googlesource.com/c/chromium/src/+/8226204
			disableBlinkFeatures: "RateLimitPointerLockRequests",
			devTools: true,
		},
	});
	if (restoreWaylandPointer) {
		const pointerHover = new PointerLockHover(window.webContents);
		window.webContents.on("before-mouse-event", (event, input) =>
			pointerHover.beforeMouse(event, input),
		);
		window.on("blur", () => pointerHover.clear());
		window.webContents.on("did-start-navigation", () => pointerHover.clear());
		context.handle(
			"window:restore-pointer",
			undefined,
			(event, point: unknown) => {
				requireApplicationFrame(event, window);
				pointerHover.restore(pointerPositionSchema.parse(point));
			},
		);
	}
	// Electron/Wayland can negotiate the constructor width down to minWidth. Reapply the
	// content size while hidden so the first visible frame keeps the configured inner dimensions.
	window.native.setContentSize(
		APP_WINDOW_TUNING.game.initialContentSize.width,
		APP_WINDOW_TUNING.game.initialContentSize.height,
	);
	setGameMinimumContentSize(window.native);
	// Restored dimensions can stall ready-to-show's first-paint notification on Wayland.
	// Show after the initial document loads so a mounted launcher cannot remain hidden.
	window.webContents.once("did-finish-load", () => window.native.show());
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("render-process-gone", (_event, details) => {
		context
			.getDocumentRetirement()
			?.rendererUnavailable(`Client renderer stopped: ${details.reason}.`);
		if (context.isQuitting()) return;
		context.onFatalError(
			"Holtburger 3D renderer stopped",
			new Error(
				`renderer process stopped (reason=${details.reason}, exitCode=${details.exitCode})`,
			),
			"process",
		);
	});
	window.webContents.on(
		"console-message",
		({ level, message, lineNumber, sourceId, frame }) => {
			if (level === "warning" || level === "error") {
				if (frame === window.webContents.mainFrame) {
					const role = context.getDocumentRole();
					if (role === "client" || role === "explorer") {
						context.clientRuntimeLog.record(level, message);
						context.failureReports.recordWebGLWarning(message);
					}
				}
				const severity = level === "error" ? "error" : "warn";
				console[severity](
					`[holtburger-renderer:${severity}] ${message} (${sourceId}:${lineNumber})`,
				);
				return;
			}
			if (process.env.HOLTBURGER_RENDERER_VERBOSE === "1") {
				console.info(`[holtburger-renderer:info] ${message}`);
			}
		},
	);
	window.webContents.on("did-navigate", () => {
		context.failureReports.beginDocument();
		context.clientRuntimeLog.clear();
	});
	window.webContents.on("before-input-event", (event, input) => {
		const controls = context.getWindowDisplay();
		if (
			input.key === "F11" &&
			!input.control &&
			!input.shift &&
			!input.alt &&
			!input.meta &&
			controls !== null
		) {
			event.preventDefault();
			if (input.type === "keyDown" && !input.isAutoRepeat) {
				const display = controls.snapshot();
				if (display.busy || display.confirmation !== null) return;
				void context
					.changeWindowDisplay({
						kind: "fullscreen",
						enabled: !display.fullscreen,
					})
					.catch((error) => reportWindowSettingsFailure(window, error));
			}
			return;
		}
		if (
			input.control &&
			input.shift &&
			!input.alt &&
			!input.meta &&
			input.key.toLowerCase() === "i"
		) {
			event.preventDefault();
			if (input.type === "keyDown" && !input.isAutoRepeat)
				window.webContents.toggleDevTools();
		}
	});
	window.webContents.on("will-navigate", (event, targetUrl) => {
		if (
			!isAllowedNavigation(targetUrl, {
				packaged: app.isPackaged,
				appPath: app.getAppPath(),
				developmentOrigin,
			})
		) {
			event.preventDefault();
		}
	});
	return window;
}

export async function stopWindowGeometry(
	slot: WindowGeometrySlot,
): Promise<void> {
	const controls = slot.windowDisplay;
	slot.windowDisplay = null;
	const stop = slot.stopGeometry;
	slot.stopGeometry = null;
	try {
		await controls?.close();
	} finally {
		// A failed rollback must not leave persistence subscribed to a retired window owner.
		await stop?.();
	}
}

export function initialGeometry(
	width: number,
	height: number,
): ClientWindowSettings {
	return {
		contentSize: {
			width,
			height,
		},
		maximized: false,
		fullscreen: false,
		borderless: false,
		freeResize: true,
	};
}

/** Both settings controls and native shortcuts commit through the same settings owner. */
export async function changeWindowDisplay(
	slot: WindowGeometrySlot,
	requireSettings: () => ClientSettingsStore,
	request: WindowDisplayRequest,
): Promise<void> {
	if (slot.windowDisplay === null)
		throw new Error("Client window controls are unavailable.");
	const controls = slot.windowDisplay;
	const settings = requireSettings();
	await controls.change(request);
	await settings.updateWindow(controls.settings());
}

/** Both launcher drafts and startup recovery use the same native folder selection behavior. */
export async function chooseContentFolder(
	window: ApplicationWindow,
	previous: string | null,
): Promise<string | null> {
	const result = await dialog.showOpenDialog(window.native, {
		title: "Choose Asheron's Call assets",
		properties: ["openDirectory"],
		...(previous === null ? {} : { defaultPath: previous }),
	});
	if (result.canceled) return null;
	const [path] = result.filePaths;
	if (path === undefined)
		throw new Error("Folder picker returned no selection");
	return path;
}

/** Explorer launcher catalog override picker for compiled `weenies.hwc` files. */
export async function chooseWeenieCatalogFile(
	window: ApplicationWindow,
	previous: string | null,
): Promise<string | null> {
	const result = await dialog.showOpenDialog(window.native, {
		title: "Choose Weenie Catalog (weenies.hwc)",
		properties: ["openFile"],
		filters: [
			{ name: "Holtburger Weenie Catalog", extensions: ["hwc"] },
			{ name: "All Files", extensions: ["*"] },
		],
		...(previous === null ? {} : { defaultPath: previous }),
	});
	if (result.canceled) return null;
	const [path] = result.filePaths;
	if (path === undefined) throw new Error("File picker returned no selection");
	return path;
}

/** Geometry persistence errors must remain visible even when no form save is in progress. */
export function reportWindowSettingsFailure(
	window: ApplicationWindow,
	error: unknown,
): void {
	console.error(error);
	if (!window.native.isDestroyed())
		dialog.showErrorBox(
			"Holtburger window settings could not be saved",
			formatError(error),
		);
}

export function reportTransitionFailure(
	window: ApplicationWindow,
	error: unknown,
	context: {
		readonly setPickerFailure: (message: string) => void;
		readonly saveAppFailure: (
			kind: AppFailureKind,
			message: string,
		) => Promise<void>;
	},
): void {
	const message = formatError(error);
	context.setPickerFailure(message);
	void context.saveAppFailure("session", message);
	console.error(error);
	if (!window.native.isDestroyed())
		dialog.showErrorBox("Holtburger session could not finish", message);
}

export function reportFatalError(
	title: string,
	error: unknown,
	context: {
		readonly isFatalReported: () => boolean;
		readonly markFatalReported: () => void;
		readonly setExitCode: (code: number) => void;
		readonly saveAppFailure: (
			kind: AppFailureKind,
			message: string,
		) => Promise<void>;
	},
	kind: AppFailureKind = "startup",
): void {
	if (context.isFatalReported()) return;
	context.markFatalReported();
	const message = error instanceof Error ? error.message : String(error);
	console.error(error);
	context.setExitCode(1);
	void context
		.saveAppFailure(kind, `${title}: ${formatError(error)}`)
		.then(() => {
			dialog.showErrorBox(title, message);
			app.quit();
		});
}

export async function loadEntry(
	window: ApplicationWindow,
	entryPath: string,
	mode: HostMode,
): Promise<void> {
	if (!app.isPackaged) {
		await window.webContents.loadURL(`${electronDevOrigin(mode)}/${entryPath}`);
		return;
	}
	const [pathname, query = ""] = entryPath.split("?", 2);
	await window.webContents.loadFile(join(app.getAppPath(), "dist", pathname), {
		search: query.length === 0 ? undefined : `?${query}`,
	});
}
