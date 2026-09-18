import { app, BrowserWindow, dialog, ipcMain, Menu, screen } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildEntryPath, requireEntry } from "../scripts/entry-paths.mjs";
import {
	electronApplicationArguments,
	isClientLaunchArgument,
	parseClientLaunchArguments,
	type ClientLaunchConfiguration,
} from "./client-launch.js";
import { SidecarHostClient, SidecarProtocolError } from "./host-protocol.js";
import { createHostReadyGate } from "./host-ready.js";
import { isAllowedNavigation } from "./navigation-policy.js";
import {
	hostCommandNamesForMode,
	hostEventNamesForMode,
} from "../src/lib/host/host-transport.js";
import type {
	HostCommandArguments,
	HostCommandName,
	HostMode,
} from "../src/lib/host/host-transport.js";
import type { ClientWindowSettings } from "../src/client/client-settings-contract.js";
import {
	ClientSettingsStore,
	type ClientSettingsReadMode,
} from "./client-settings-store.js";
import { clientCharacterProfileKey } from "./client-profile-key.js";
import { clientUserDataPath } from "./client-user-data.js";
import { clientWindowBoundsReachable } from "./client-window-settings.js";

const WINDOW_BACKGROUND_COLOR = "#0b0a08";
const INITIAL_WINDOW_CONTENT_SIZE = Object.freeze({ width: 1440, height: 900 });
const WINDOW_SETTINGS_WRITE_DELAY_MS = 250;

if (!app.isPackaged) {
	const developmentUserData = clientUserDataPath(
		app.getPath("appData"),
		app.getName(),
		false,
	);
	mkdirSync(developmentUserData, { recursive: true });
	app.setPath("userData", developmentUserData);
}

const currentDirectory = dirname(fileURLToPath(import.meta.url));
let hostClient: SidecarHostClient | undefined;
let quitting = false;
let exitCode = 0;
let fatalReported = false;
let flushClientSettings: (() => Promise<void>) | undefined;
const hostReady = createHostReadyGate<SidecarHostClient>();

// The client dev entry uses a separate default port so two worktrees cannot silently share a
// renderer server. The launcher may override it for an explicit isolated diagnostic run.
function electronDevOrigin(mode: HostMode): string {
	return (
		process.env.HOLTBURGER_ELECTRON_DEV_ORIGIN ??
		`http://127.0.0.1:${mode === "client" ? 1421 : 1420}`
	);
}

function entryArguments(): {
	path: string;
	title: string;
	mode: HostMode;
	clientStartup?: ClientLaunchConfiguration;
	ignorePersistedConfig: boolean;
} {
	const entryArguments = electronApplicationArguments(
		process.argv,
		process.defaultApp === true,
	);
	const [entryName, ...rawArgs] = entryArguments;
	const release = rawArgs.includes("--release");
	const entryArgs = rawArgs.filter((arg) => arg !== "--release");
	const selectedEntryName = entryName ?? "explorer";
	const entry = requireEntry(selectedEntryName);
	const mode: HostMode = selectedEntryName === "client" ? "client" : "explorer";
	let clientStartup: ClientLaunchConfiguration | undefined;
	let ignorePersistedConfig = false;
	let rendererArguments: readonly string[] = entryArgs;
	if (mode === "client") {
		const parsed = parseClientLaunchArguments(entryArgs);
		clientStartup = parsed.startup;
		ignorePersistedConfig = parsed.ignorePersistedConfig;
		rendererArguments = parsed.rendererArguments;
	} else {
		const clientArgument = entryArgs.find(isClientLaunchArgument);
		if (clientArgument !== undefined) {
			throw new Error(
				`client launch argument ${clientArgument} is unavailable in Explorer mode`,
			);
		}
	}
	return {
		path: buildEntryPath(entry.path, rendererArguments),
		title: entry.title + (release ? " (release host)" : ""),
		mode,
		clientStartup,
		ignorePersistedConfig,
	};
}

function workspaceRoot(): string {
	return resolve(app.getAppPath(), "../..");
}

function hostBinaryPath(): string {
	if (!app.isPackaged && process.env.HOLTBURGER_HOST_BIN)
		return process.env.HOLTBURGER_HOST_BIN;
	const executable =
		process.platform === "win32"
			? "holtburger-3d-host.exe"
			: "holtburger-3d-host";
	return app.isPackaged
		? join(process.resourcesPath, executable)
		: join(workspaceRoot(), "target", "debug", executable);
}

function hostEnvironment(): NodeJS.ProcessEnv {
	const environment = { ...process.env };
	if (environment.HOLTBURGER_DATS === undefined && !app.isPackaged) {
		const workspaceDats = join(workspaceRoot(), "dats");
		if (existsSync(workspaceDats)) environment.HOLTBURGER_DATS = workspaceDats;
	}
	return environment;
}

async function startHost(window: BrowserWindow, mode: HostMode): Promise<void> {
	const child = spawn(hostBinaryPath(), [`--mode=${mode}`], {
		env: hostEnvironment(),
		stdio: "pipe",
		windowsHide: true,
	});
	child.stderr?.on("data", (chunk) =>
		console.error(`[holtburger-host] ${chunk.toString()}`),
	);
	const client = new SidecarHostClient(child, mode);
	hostClient = client;
	let connected = false;
	child.on("exit", (code, signal) => {
		if (quitting || !connected) return;
		const error = new SidecarProtocolError(
			"host_exit",
			`host exited unexpectedly (code=${code ?? "none"}, signal=${signal ?? "none"})`,
		);
		reportFatalError("Holtburger 3D host stopped", error);
	});
	await client.connect();
	connected = true;
	for (const event of hostEventNamesForMode(mode)) {
		await client.listen(event, (payload) => {
			if (event === "client-exit-requested") {
				const cause =
					typeof payload === "object" &&
					payload !== null &&
					"cause" in payload &&
					typeof payload.cause === "string"
						? payload.cause
						: undefined;
				const diagnostic =
					typeof payload === "object" &&
					payload !== null &&
					"diagnostic" in payload &&
					typeof payload.diagnostic === "string"
						? payload.diagnostic
						: "client host requested application exit";
				// Explicit disconnect and orderly app shutdown are terminal lifecycle states, not
				// failures. Connection, startup, and runtime failures remain whole-app fatal.
				if (cause !== "explicit-disconnect" && cause !== "host-shutdown") {
					reportFatalError("Holtburger client stopped", new Error(diagnostic));
				}
			}
			if (!window.isDestroyed())
				window.webContents.send("host:event", { event, payload });
		});
	}
	hostReady.resolve(client);
}

function isHostCommandName(
	command: string,
	mode: HostMode,
): command is HostCommandName {
	return new Set(hostCommandNamesForMode(mode)).has(command as HostCommandName);
}

function isHostCommandArguments(value: unknown): value is HostCommandArguments {
	return (
		value === undefined ||
		(typeof value === "object" && value !== null && !Array.isArray(value))
	);
}

function installIpcBridge(
	window: BrowserWindow,
	mode: HostMode,
	startup: ClientLaunchConfiguration | undefined,
): void {
	let clientLaunch: Promise<void> | undefined;
	const applicationContents = window.webContents;
	ipcMain.handle("host:invoke", async (event, request: unknown) => {
		if (
			applicationContents.isDestroyed() ||
			event.sender !== applicationContents ||
			event.senderFrame !== applicationContents.mainFrame
		) {
			throw new Error(
				"host requests are accepted only from the application frame",
			);
		}
		if (
			typeof request !== "object" ||
			request === null ||
			!("command" in request) ||
			typeof request.command !== "string"
		) {
			throw new Error("host request envelope is malformed");
		}
		if (!isHostCommandName(request.command, mode)) {
			throw new Error(
				`host command is not allowlisted for ${mode} mode: ${request.command}`,
			);
		}
		const args = "args" in request ? request.args : undefined;
		if (!isHostCommandArguments(args))
			throw new Error("host command arguments must be an object");
		const client = await hostReady.promise;
		// The lifecycle owner installs all event listeners before its first snapshot request.
		// Launch here so login popups cannot arrive while the renderer is still loading.
		if (
			request.command === "request_client_current_state" &&
			startup !== undefined
		) {
			clientLaunch ??= client.startClient(startup).catch((error: unknown) => {
				reportFatalError("Holtburger client failed to start", error);
				throw error;
			});
			await clientLaunch;
		}
		return client.invoke(request.command, args);
	});
}

function requireApplicationFrame(
	event: Electron.IpcMainInvokeEvent,
	window: BrowserWindow,
): void {
	const applicationContents = window.webContents;
	if (
		applicationContents.isDestroyed() ||
		event.sender !== applicationContents ||
		event.senderFrame !== applicationContents.mainFrame
	)
		throw new Error(
			"settings requests are accepted only from the application frame",
		);
}

function requireCharacterGuid(value: unknown): number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 0 ||
		value > 0xffff_ffff
	)
		throw new Error("character GUID must be an unsigned 32-bit integer");
	return value;
}

function installSettingsIpcBridge(
	window: BrowserWindow,
	store: ClientSettingsStore,
	startup: ClientLaunchConfiguration,
	ignorePersistedConfig: boolean,
): void {
	const readMode: ClientSettingsReadMode = ignorePersistedConfig
		? "fresh"
		: "persisted";
	ipcMain.handle("settings:load-user", (event) => {
		requireApplicationFrame(event, window);
		return store.readUser(readMode);
	});
	ipcMain.handle("settings:save-user", async (event, settings: unknown) => {
		requireApplicationFrame(event, window);
		await store.saveUser(settings);
	});
	ipcMain.handle("settings:load-character", (event, guid: unknown) => {
		requireApplicationFrame(event, window);
		return store.readCharacter(
			clientCharacterProfileKey(startup, requireCharacterGuid(guid)),
			readMode,
		);
	});
	ipcMain.handle("settings:save-character", async (event, request: unknown) => {
		requireApplicationFrame(event, window);
		if (typeof request !== "object" || request === null)
			throw new Error("character settings request is malformed");
		if (!("characterGuid" in request) || !("settings" in request))
			throw new Error("character settings request is incomplete");
		const guid = requireCharacterGuid(request.characterGuid);
		const lastKnownName =
			"lastKnownName" in request ? request.lastKnownName : null;
		if (lastKnownName !== null && typeof lastKnownName !== "string")
			throw new Error("last-known character name must be a string or null");
		await store.saveCharacter(
			clientCharacterProfileKey(startup, guid),
			request.settings,
			lastKnownName,
		);
	});
}

function createWindow(
	entry: {
		path: string;
		title: string;
		mode: HostMode;
	},
	restoredWindow: ClientWindowSettings | null,
): BrowserWindow {
	const developmentOrigin = electronDevOrigin(entry.mode);
	const window = new BrowserWindow({
		title: entry.title,
		width: INITIAL_WINDOW_CONTENT_SIZE.width,
		height: INITIAL_WINDOW_CONTENT_SIZE.height,
		useContentSize: true,
		minWidth: 1100,
		minHeight: 700,
		resizable: true,
		show: false,
		backgroundColor: WINDOW_BACKGROUND_COLOR,
		webPreferences: {
			preload: join(currentDirectory, "preload.cjs"),
			additionalArguments: [`--holtburger-mode=${entry.mode}`],
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			devTools: true,
		},
	});
	// Electron/Wayland can negotiate the constructor width down to minWidth. Reapply the
	// content size while hidden so the first visible frame keeps the configured inner dimensions.
	window.setContentSize(
		INITIAL_WINDOW_CONTENT_SIZE.width,
		INITIAL_WINDOW_CONTENT_SIZE.height,
	);
	if (restoredWindow !== null) {
		if (
			clientWindowBoundsReachable(
				restoredWindow.normalBounds,
				screen.getAllDisplays().map((display) => display.workArea),
			)
		)
			window.setBounds(restoredWindow.normalBounds);
		else window.center();
		if (restoredWindow.maximized) window.maximize();
	}
	window.once("ready-to-show", () => window.show());
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("render-process-gone", (_event, details) => {
		if (quitting) return;
		reportFatalError(
			"Holtburger 3D renderer stopped",
			new Error(
				`renderer process stopped (reason=${details.reason}, exitCode=${details.exitCode})`,
			),
		);
	});
	window.webContents.on(
		"console-message",
		({ level, message, lineNumber, sourceId }) => {
			if (level === "warning" || level === "error") {
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
	window.webContents.on("before-input-event", (event, input) => {
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

function installWindowSettings(
	window: BrowserWindow,
	store: ClientSettingsStore,
): () => Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let failureReported = false;
	const write = async (): Promise<void> => {
		timer = undefined;
		if (window.isDestroyed()) return;
		try {
			await store.updateWindow({
				normalBounds: window.getNormalBounds(),
				maximized: window.isMaximized(),
			});
			failureReported = false;
		} catch (error) {
			console.error("client window settings save failed", error);
			if (!failureReported) {
				failureReported = true;
				dialog.showErrorBox(
					"Holtburger settings could not be saved",
					error instanceof Error ? error.message : String(error),
				);
			}
		}
	};
	const schedule = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(() => void write(), WINDOW_SETTINGS_WRITE_DELAY_MS);
	};
	window.on("move", schedule);
	window.on("resize", schedule);
	window.on("maximize", schedule);
	window.on("unmaximize", schedule);
	// Capture the constructor-negotiated normal bounds before renderer bootstrap can create v1.
	void write();
	return async () => {
		if (timer !== undefined) clearTimeout(timer);
		await write();
		await store.flush();
	};
}

function reportFatalError(title: string, error: unknown): void {
	if (fatalReported) return;
	fatalReported = true;
	const message = error instanceof Error ? error.message : String(error);
	console.error(error);
	dialog.showErrorBox(title, message);
	exitCode = 1;
	app.quit();
}

async function loadEntry(
	window: BrowserWindow,
	entryPath: string,
	mode: HostMode,
): Promise<void> {
	if (!app.isPackaged) {
		await window.loadURL(`${electronDevOrigin(mode)}/${entryPath}`);
		return;
	}
	const [pathname, query = ""] = entryPath.split("?", 2);
	await window.loadFile(join(app.getAppPath(), "dist", pathname), {
		search: query.length === 0 ? undefined : `?${query}`,
	});
}

app.whenReady().then(async () => {
	let entry: ReturnType<typeof entryArguments>;
	try {
		entry = entryArguments();
	} catch (error) {
		reportFatalError("Holtburger 3D launch arguments are invalid", error);
		return;
	}
	Menu.setApplicationMenu(null);
	let settingsStore: ClientSettingsStore | undefined;
	if (entry.mode === "client") {
		const primary = screen.getPrimaryDisplay().workArea;
		settingsStore = new ClientSettingsStore(
			join(app.getPath("userData"), "client-settings.json"),
			{
				normalBounds: {
					x: Math.round(
						primary.x + (primary.width - INITIAL_WINDOW_CONTENT_SIZE.width) / 2,
					),
					y: Math.round(
						primary.y +
							(primary.height - INITIAL_WINDOW_CONTENT_SIZE.height) / 2,
					),
					...INITIAL_WINDOW_CONTENT_SIZE,
				},
				maximized: false,
			},
		);
		try {
			await settingsStore.load();
		} catch (error) {
			reportFatalError("Holtburger client settings are invalid", error);
			return;
		}
	}
	// Native window restoration is independent of the renderer-owned config bypass.
	const loadedUser = settingsStore?.readUser("persisted");
	const window = createWindow(
		entry,
		loadedUser?.kind === "loaded"
			? (settingsStore?.readWindow() ?? null)
			: null,
	);
	if (settingsStore !== undefined && entry.clientStartup !== undefined) {
		installSettingsIpcBridge(
			window,
			settingsStore,
			entry.clientStartup,
			entry.ignorePersistedConfig,
		);
		flushClientSettings = installWindowSettings(window, settingsStore);
	}
	installIpcBridge(window, entry.mode, entry.clientStartup);
	try {
		await startHost(window, entry.mode);
		await loadEntry(window, entry.path, entry.mode);
	} catch (error) {
		hostReady.reject(error);
		reportFatalError("Holtburger 3D failed to start", error);
	}
});

app.on("window-all-closed", () => {
	// The host belongs to the sole product window; retaining a headless macOS app would orphan it.
	app.quit();
});

app.on("before-quit", (event) => {
	if (quitting || (!hostClient && flushClientSettings === undefined)) return;
	quitting = true;
	event.preventDefault();
	Promise.all([
		hostClient?.shutdown() ?? Promise.resolve(),
		flushClientSettings?.() ?? Promise.resolve(),
	])
		.catch((error) => {
			exitCode = 1;
			console.error("application shutdown failed", error);
		})
		.finally(() => app.exit(exitCode));
});
