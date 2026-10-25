import {
	ClientWindowClose,
	CLIENT_CLOSE_PREPARATION_TIMEOUT_MS,
} from "./client-window-close.js";
import { app, BrowserWindow, dialog, ipcMain, Menu, screen } from "electron";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	buildEntryPath,
	requireEntry,
	extractContentArguments,
} from "../scripts/entry-paths.mjs";
import { applicationMenuTemplate } from "./application-menu.js";
import {
	electronApplicationArguments,
	isClientLaunchArgument,
	parseClientLaunchArguments,
	type ClientLaunchConfiguration,
} from "./client-launch.js";
import { SidecarHostClient } from "./host-protocol.js";
import {
	ContentStartup,
	type HostContentSelection,
} from "./content-startup.js";
import { ContentPreferenceStore } from "./content-preference-store.js";
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
	clientCharacterSectionsSchema,
	clientUserSettingsPatchSchema,
} from "../src/client/client-settings-sections.js";
import {
	ClientSettingsStore,
	type ClientSettingsReadMode,
} from "./client-settings-store.js";
import { clientCharacterProfileKey } from "./client-profile-key.js";
import {
	clientSettingsFilePath,
	clientUserDataPath,
} from "./client-user-data.js";
import { clientWindowBoundsReachable } from "./client-window-settings.js";
import { ClientVisualCacheStore } from "./client-visual-cache-store.js";
import { playerVisualCaptureSchema } from "../src/client/client-object-preview-contract.js";

const WINDOW_BACKGROUND_COLOR = "#0b0a08";
const INITIAL_WINDOW_CONTENT_SIZE = Object.freeze({ width: 1440, height: 900 });
const WINDOW_SETTINGS_WRITE_DELAY_MS = 250;
const VISUAL_CACHE_WRITE_DELAY_MS = 500;

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
// Forge copies the native-window image outside ASAR; development reads the same export.
const applicationIconPath = app.isPackaged
	? join(process.resourcesPath, "icon.png")
	: resolve(app.getAppPath(), "../../assets/branding/icon.png");
let contentStartup: ContentStartup<SidecarHostClient> | undefined;
let quitting = false;
/** Client window close joins renderer preparation before native store/process shutdown. */
let clientWindowClose: ClientWindowClose | undefined;
let exitCode = 0;
let fatalReported = false;
let flushClientSettings: (() => Promise<void>) | undefined;
let visualCache: ClientVisualCacheStore | undefined;
function requireActiveHost(): SidecarHostClient {
	const host = contentStartup?.activeHost;
	if (host === undefined || host === null)
		throw new Error("Game commands are unavailable during asset setup");
	return host;
}

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
	ignoreWorldMapCache: boolean;
	settingsFile: string | null;
	contentPath: string | null;
	noContentSearch: boolean;
	clearContent: boolean;
} {
	const entryArguments = electronApplicationArguments(
		process.argv,
		!app.isPackaged,
		app.getAppPath(),
	);
	const extracted = extractContentArguments(entryArguments, process.cwd());
	const hasEntry =
		extracted.args[0] !== undefined && !extracted.args[0].startsWith("--");
	const entryName = hasEntry ? extracted.args[0] : "explorer";
	const rawArgs = hasEntry ? extracted.args.slice(1) : extracted.args;
	const release = rawArgs.includes("--release");
	const entryArgs = rawArgs.filter((arg) => arg !== "--release");
	const selectedEntryName = entryName ?? "explorer";
	const entry = requireEntry(selectedEntryName);
	const mode: HostMode = selectedEntryName === "client" ? "client" : "explorer";
	let clientStartup: ClientLaunchConfiguration | undefined;
	let ignorePersistedConfig = false;
	let ignoreWorldMapCache = false;
	let settingsFile: string | null = null;
	let rendererArguments: readonly string[] = entryArgs;
	if (mode === "client") {
		const parsed = parseClientLaunchArguments(entryArgs);
		clientStartup = parsed.startup;
		ignorePersistedConfig = parsed.ignorePersistedConfig;
		ignoreWorldMapCache = parsed.ignoreWorldMapCache;
		settingsFile = parsed.settingsFile;
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
		ignoreWorldMapCache,
		settingsFile,
		contentPath: extracted.contentPath,
		noContentSearch: extracted.noContentSearch,
		clearContent: extracted.clearContent,
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

function hostEnvironment(ignoreWorldMapCache: boolean): NodeJS.ProcessEnv {
	const environment = { ...process.env };
	environment.HOLTBURGER_IGNORE_WORLD_MAP_CACHE = ignoreWorldMapCache
		? "1"
		: "0";
	environment.HOLTBURGER_WORLD_MAP_CACHE = join(
		app.getPath("userData"),
		"cache",
		"world-map",
	);
	// Content is supplied explicitly in the host launch contract, never inherited as an override.
	delete environment.HOLTBURGER_DATS;
	return environment;
}

function launchHost(
	mode: HostMode,
	ignoreWorldMapCache: boolean,
	selection: HostContentSelection,
): SidecarHostClient {
	const args =
		selection.kind === "explicit"
			? ["--content", selection.path]
			: ["--discovery-root", selection.root];
	const child = spawn(hostBinaryPath(), [`--mode=${mode}`, ...args], {
		env: hostEnvironment(ignoreWorldMapCache),
		stdio: "pipe",
		windowsHide: true,
	});
	child.stderr?.on("data", (chunk) =>
		console.error(`[holtburger-host] ${chunk.toString()}`),
	);
	return new SidecarHostClient(child, mode);
}

function installContentStartup(
	window: BrowserWindow,
	entry: ReturnType<typeof entryArguments>,
): ContentStartup<SidecarHostClient> {
	const startup = new ContentStartup({
		store: new ContentPreferenceStore(
			join(app.getPath("userData"), "content-selection.json"),
		),
		overridePath: entry.contentPath,
		noContentSearch: entry.noContentSearch,
		clearContent: entry.clearContent,
		portableRoot: join(
			app.isPackaged ? dirname(process.execPath) : workspaceRoot(),
			"dats",
		),
		launch: (selection) =>
			launchHost(entry.mode, entry.ignoreWorldMapCache, selection),
		admit: async (client) => {
			for (const event of hostEventNamesForMode(entry.mode)) {
				await client.listen(event, (payload) => {
					if (!window.isDestroyed())
						window.webContents.send("host:event", { event, payload });
				});
			}
		},
		pickFolder: async (previous) => {
			const result = await dialog.showOpenDialog(window, {
				title: "Choose Asheron's Call assets",
				properties: ["openDirectory"],
				...(previous === null ? {} : { defaultPath: previous }),
			});
			if (result.canceled) return null;
			const [path] = result.filePaths;
			if (path === undefined)
				throw new Error("Folder picker returned no selection");
			return path;
		},
	});
	startup.listen((snapshot) => {
		if (!window.isDestroyed())
			window.webContents.send("content:state", snapshot);
	});
	ipcMain.handle("content:snapshot", (event) => {
		requireApplicationFrame(event, window);
		return startup.snapshot;
	});
	ipcMain.handle("content:choose", (event) => {
		requireApplicationFrame(event, window);
		return startup.choose();
	});
	ipcMain.handle("content:retry", (event) => {
		requireApplicationFrame(event, window);
		return startup.retry();
	});
	ipcMain.handle("content:quit", (event) => {
		requireApplicationFrame(event, window);
		app.quit();
	});
	return startup;
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
	ipcMain.handle("client:start", async (event) => {
		requireApplicationFrame(event, window);
		if (quitting)
			throw new Error(
				"Client launch is unavailable while the application is closing.",
			);
		if (mode !== "client" || startup === undefined)
			throw new Error("Client startup is unavailable in this application mode");
		const client = requireActiveHost();
		if (quitting)
			throw new Error("Client launch was cancelled by application close.");
		// Memoize the sole launch attempt; credentials remain private to the Electron main process.
		clientLaunch ??= client.startClient(startup);
		await clientLaunch;
	});
	ipcMain.handle("host:invoke", async (event, request: unknown) => {
		requireApplicationFrame(event, window);
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
		const client = requireActiveHost();
		return client.invoke(request.command, args);
	});
}

function requireApplicationFrame(
	event: Electron.IpcMainInvokeEvent,
	window: BrowserWindow,
): void {
	if (
		clientWindowClose !== undefined &&
		!clientWindowClose.acceptsRendererRequests
	)
		throw new Error("Client renderer request admission is closed.");
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
	ipcMain.handle("settings:load-user", async (event, defaults: unknown) => {
		requireApplicationFrame(event, window);
		try {
			return await store.loadUser(defaults, readMode);
		} catch (error) {
			// User settings load before the renderer mounts, so no toast can report
			// a failed backup or repair write. Use the existing startup error surface.
			reportFatalError("Holtburger client settings could not be loaded", error);
			throw error;
		}
	});
	ipcMain.handle("settings:save-user-patch", async (event, patch: unknown) => {
		requireApplicationFrame(event, window);
		await store.saveUserPatch(clientUserSettingsPatchSchema.parse(patch));
	});
	ipcMain.handle("settings:reset-user", async (event, settings: unknown) => {
		requireApplicationFrame(event, window);
		return store.resetUser(settings);
	});
	ipcMain.handle(
		"settings:load-character",
		(event, guid: unknown, defaults: unknown) => {
			requireApplicationFrame(event, window);
			return store.loadCharacter(
				clientCharacterProfileKey(startup, requireCharacterGuid(guid)),
				defaults,
				readMode,
			);
		},
	);
	ipcMain.handle(
		"settings:save-character-patch",
		async (event, request: unknown) => {
			requireApplicationFrame(event, window);
			if (typeof request !== "object" || request === null)
				throw new Error("character settings request is malformed");
			if (!("characterGuid" in request) || !("patch" in request))
				throw new Error("character settings request is incomplete");
			const guid = requireCharacterGuid(request.characterGuid);
			await store.saveCharacterPatch(
				clientCharacterProfileKey(startup, guid),
				clientCharacterSectionsSchema.parse(request.patch),
			);
		},
	);
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
		icon: applicationIconPath,
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
			// Chromium 152 counts successive camera holds until a two-second pause, rejecting normal play.
			// Opt this application window out of that browser-page limiter; capture still ends on release.
			// Upstream fix: https://chromium-review.googlesource.com/c/chromium/src/+/8226204
			disableBlinkFeatures: "RateLimitPointerLockRequests",
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
		clientWindowClose?.rendererUnavailable(
			`Client renderer stopped: ${details.reason}.`,
		);
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
	// Capture constructor-negotiated normal bounds before renderer bootstrap creates a document.
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
	app.dock?.setIcon(applicationIconPath);
	let entry: ReturnType<typeof entryArguments>;
	try {
		entry = entryArguments();
	} catch (error) {
		reportFatalError("Holtburger 3D launch arguments are invalid", error);
		return;
	}
	const menuTemplate = applicationMenuTemplate(process.platform);
	Menu.setApplicationMenu(
		menuTemplate === null ? null : Menu.buildFromTemplate(menuTemplate),
	);
	let settingsStore: ClientSettingsStore | undefined;
	if (entry.mode === "client") {
		const primary = screen.getPrimaryDisplay().workArea;
		settingsStore = new ClientSettingsStore(
			entry.settingsFile ?? clientSettingsFilePath(app.getPath("userData")),
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
			const repaired = await settingsStore.load();
			if (repaired.length > 0)
				console.warn(`Client window settings repaired: ${repaired.join("; ")}`);
		} catch (error) {
			reportFatalError("Holtburger client settings are invalid", error);
			return;
		}
	}
	// Native window restoration is independent of the renderer-owned config bypass.
	const restoredWindow = settingsStore?.readWindow();
	if (
		restoredWindow?.unavailable !== null &&
		restoredWindow?.unavailable !== undefined
	)
		console.warn(
			`Client window settings unavailable: ${restoredWindow.unavailable}`,
		);
	const window = createWindow(entry, restoredWindow?.settings ?? null);
	if (settingsStore !== undefined && entry.clientStartup !== undefined) {
		visualCache = new ClientVisualCacheStore(
			join(app.getPath("userData"), "character-visuals"),
			entry.clientStartup,
			VISUAL_CACHE_WRITE_DELAY_MS,
			(message) => {
				console.error(message);
				if (!window.isDestroyed() && !window.webContents.isDestroyed())
					window.webContents.send("visual-cache:failure", message);
			},
		);
		const cache = visualCache;
		ipcMain.handle("visual-cache:read", (event, guid: unknown) => {
			requireApplicationFrame(event, window);
			return cache.read(requireCharacterGuid(guid));
		});
		ipcMain.handle("visual-cache:stage", (event, capture: unknown) => {
			requireApplicationFrame(event, window);
			cache.stage(playerVisualCaptureSchema.parse(capture));
		});
		installSettingsIpcBridge(
			window,
			settingsStore,
			entry.clientStartup,
			entry.ignorePersistedConfig,
		);
		flushClientSettings = installWindowSettings(window, settingsStore);
	}

	if (entry.mode === "client") {
		const close = new ClientWindowClose({
			deadlineMs: CLIENT_CLOSE_PREPARATION_TIMEOUT_MS,
			prepareRenderer: () => {
				if (contentStartup?.activeHost === null) {
					close.acceptPreparation({ kind: "prepared" });
					return;
				}
				if (
					window.isDestroyed() ||
					window.webContents.isDestroyed() ||
					fatalReported
				)
					throw new Error(
						"Client renderer is unavailable for close preparation.",
					);
				window.webContents.send("client:prepare-close");
			},
			shutdownNative: async () => {
				const results = await Promise.allSettled([
					contentStartup?.close() ?? Promise.resolve(),
					flushClientSettings?.() ?? Promise.resolve(),
					visualCache?.close() ?? Promise.resolve(),
				]);
				const failures = results.filter(
					(result): result is PromiseRejectedResult =>
						result.status === "rejected",
				);
				if (failures.length)
					throw new AggregateError(
						failures.map((result) => result.reason),
						"Application shutdown failed",
					);
			},
			reportFailure: (error) => {
				exitCode = 1;
				console.error("application shutdown failed", error);
			},
			exit: () => app.exit(exitCode),
		});
		clientWindowClose = close;
		window.on("close", (event) => {
			event.preventDefault();
			quitting = true;
			void close.request();
		});
		window.webContents.on(
			"did-start-navigation",
			(_event, _url, isInPlace, isMainFrame) => {
				if (isMainFrame && !isInPlace && close.preparing)
					close.rendererUnavailable(
						"Client renderer navigated during close preparation.",
					);
			},
		);
		ipcMain.handle("client:request-close", (event) => {
			if (!close.acceptsRendererRequests) return;
			requireApplicationFrame(event, window);
			quitting = true;
			void close.request();
		});
		ipcMain.handle("client:prepared-close", (event, payload: unknown) => {
			// A timed-out/finished close ignores late acknowledgements without reopening admission.
			if (!close.preparing) return;
			requireApplicationFrame(event, window);
			close.acceptPreparation(payload);
		});
	}
	installIpcBridge(window, entry.mode, entry.clientStartup);
	contentStartup = installContentStartup(window, entry);
	try {
		await loadEntry(window, entry.path, entry.mode);
		await contentStartup.start();
	} catch (error) {
		reportFatalError("Holtburger 3D failed to start", error);
	}
});

app.on("window-all-closed", () => {
	// The host belongs to the sole product window; retaining a headless macOS app would orphan it.
	app.quit();
});

app.on("before-quit", (event) => {
	if (clientWindowClose !== undefined) {
		event.preventDefault();
		quitting = true;
		void clientWindowClose.request();
		return;
	}
	if (
		quitting ||
		(!contentStartup &&
			flushClientSettings === undefined &&
			visualCache === undefined)
	)
		return;
	quitting = true;
	event.preventDefault();
	Promise.allSettled([
		contentStartup?.close() ?? Promise.resolve(),
		flushClientSettings?.() ?? Promise.resolve(),
		visualCache?.close() ?? Promise.resolve(),
	])
		.then((results) => {
			const failures = results.filter((result) => result.status === "rejected");
			if (failures.length > 0)
				throw new AggregateError(
					failures.map((result) => result.reason),
					"Application shutdown failed",
				);
		})
		.catch((error) => {
			exitCode = 1;
			console.error("application shutdown failed", error);
		})
		.finally(() => app.exit(exitCode));
});
