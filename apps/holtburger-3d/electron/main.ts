import { ClientRetirement } from "./client-retirement.js";
import {
	APP_WINDOW_TUNING,
	APP_PERSISTENCE_TUNING,
	APP_LIFECYCLE_TUNING,
} from "../src/app/app-tuning.js";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	powerMonitor,
	screen,
	shell,
} from "electron";
import { AppUpdates, loadUpdateBuild } from "./app-updates.js";
import type { PregameRegistrationStatus } from "../src/app/app-update-contract.js";
import {
	ClientApplication,
	type ApplicationAttempt,
} from "./client-application.js";
import { DocumentAdmission, type DocumentRole } from "./document-admission.js";
import {
	WindowDisplay,
	setGameMinimumContentSize,
	restoreWindowGeometry as restoreGeometry,
} from "./window-display.js";
import {
	windowDisplayRequestSchema,
	type WindowDisplayRequest,
} from "../src/app/window-display-contract.js";
import { observeWindowGeometry } from "./window-geometry.js";
import {
	PointerLockHover,
	pointerPositionSchema,
} from "./pointer-lock-hover.js";
import { LauncherStore } from "./launcher-store.js";
import { copyHardwareInfo } from "./hardware-info.js";
import { DEV_RESTART_EXIT_CODE } from "../src/app/desktop-restart-contract.js";
import {
	AppSettingsStore,
	appSettingsRequireRestart,
	applyAppGraphicsSettings,
	graphicsBackendOptions,
} from "./app-settings.js";
import type { AppSettingsSnapshot } from "../src/app/app-settings-contract.js";
import { ServerDirectoryCatalog } from "./server-directory.js";
import { formatError } from "../src/lib/format-error.js";
import { z } from "zod";
import { decodeClientExitRequested } from "../src/client/client-exit-contract.js";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	buildEntryPath,
	requireEntry,
	extractContentArguments,
	defaultContentRoot,
	extractEntryArguments,
	extractElectronLaunchArguments,
} from "../scripts/entry-paths.mjs";
import { applicationMenuTemplate } from "./application-menu.js";
import {
	electronApplicationArguments,
	isClientLaunchArgument,
	parseClientLaunchArguments,
	type ClientLaunchConfiguration,
} from "./client-launch.js";
import { SidecarHostClient, SidecarProtocolError } from "./host-protocol.js";
import type { HostCommandResult } from "../src/lib/host/host-command-result.js";
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
import type { ClientWindowSettings } from "../src/app/window-settings-contract.js";
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
import { ClientVisualCacheStore } from "./client-visual-cache-store.js";
import { UiThemeCatalog } from "./ui-theme-catalog.js";
import {
	registerUiThemeScheme,
	installUiThemeProtocol,
} from "./ui-theme-protocol.js";
import { uiThemeIdSchema } from "../src/app/ui-theme-contract.js";
import { playerVisualCaptureSchema } from "../src/client/client-object-preview-contract.js";

registerUiThemeScheme();

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
let explorerContent: ContentStartup<SidecarHostClient> | undefined;
let quitting = false;
/** Client window close joins renderer preparation before native store/process shutdown. */
let documentRetirement: ClientRetirement | undefined;
let exitCode = 0;
let fatalReported = false;
const documents = new DocumentAdmission();
let restartRequested = false;
let desktop: ClientApplication<NativeAttempt> | undefined;
let windowDisplay: WindowDisplay | null = null;
let stopGeometry: (() => Promise<void>) | null = null;
let pickerFailure: string | null = null;
/** Update availability survives native document replacement and never owns the game lifecycle. */
let appUpdates: AppUpdates | undefined;

/** Native resources are bound to exactly one admitted endpoint. */
interface NativeAttempt extends ApplicationAttempt {
	/** Immutable endpoint plus transient credentials consumed by this attempt's private launch. */
	readonly startup: ClientLaunchConfiguration;
	/** Content admission and host lifetime are replaced together on another Play. */
	readonly content: ContentStartup<SidecarHostClient>;
	/** Partial setup retains its settings owner for flush even if cache construction never completes. */
	resources:
		| { readonly kind: "pending" }
		| { readonly kind: "settings"; readonly settings: ClientSettingsStore }
		| {
				readonly kind: "ready";
				readonly settings: ClientSettingsStore;
				readonly cache: ClientVisualCacheStore;
		  };
	/** Settings/navigation barrier; excludes host readiness so cancellation cannot deadlock on handshake. */
	opening: Promise<void>;
	/** Exactly one private connection request after renderer listener admission. */
	launch: Promise<void> | null;
	/** Host/startup subscriptions are detached before a replacement document is admitted. */
	readonly detach: (() => void)[];
}
function requireAttempt(): NativeAttempt {
	const attempt = desktop?.attempt;
	if (!attempt) throw new Error("No game attempt is active");
	return attempt;
}
function requireSettings(): ClientSettingsStore {
	const resources = requireAttempt().resources;
	if (resources.kind === "pending")
		throw new Error("Game settings are not ready");
	return resources.settings;
}
function requireCache(): ClientVisualCacheStore {
	const resources = requireAttempt().resources;
	if (resources.kind !== "ready")
		throw new Error("Character visual cache is not ready");
	return resources.cache;
}
/** IPC is registered once; each preload attaches its document identity before feature arguments. */
function handle<Args extends unknown[], Result>(
	channel: string,
	role: DocumentRole | undefined,
	listener: (event: Electron.IpcMainInvokeEvent, ...args: Args) => Result,
): void {
	ipcMain.handle(channel, (event, identity: unknown, ...args: Args) => {
		requireApplicationFrame(event, BrowserWindow.fromWebContents(event.sender));
		documents.require(identity, role);
		if (
			documentRetirement !== undefined &&
			!documentRetirement.acceptsRendererRequests
		)
			throw new Error("Document retirement has sealed game IPC");
		if (
			role === "picker" &&
			channel !== "launcher:snapshot" &&
			desktop !== undefined &&
			!desktop.canPlay
		)
			throw new Error(
				"Launcher changes are unavailable during a game attempt or Quit",
			);
		return listener(event, ...args);
	});
}
/** Client content belongs to its attempt; only Explorer keeps an application-lived content host. */
function currentContent(): ContentStartup<SidecarHostClient> | undefined {
	return desktop === undefined ? explorerContent : desktop.attempt?.content;
}
function requireActiveHost(): SidecarHostClient {
	const host = currentContent()?.activeHost;
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
	noLauncher: boolean;
	/** Process-only update lookup opt-out consumed by the native update owner. */
	noUpdates: boolean;
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
	const selectedEntry = extractEntryArguments(extracted.args);
	const rawArgs = selectedEntry.args;
	const release = rawArgs.includes("--release");
	const entryArgs = rawArgs.filter((arg) => arg !== "--release");
	const selectedEntryName = selectedEntry.name;
	const entry = requireEntry(selectedEntryName);
	const mode: HostMode = selectedEntryName === "client" ? "client" : "explorer";
	let clientStartup: ClientLaunchConfiguration | undefined;
	let noLauncher = false;
	let noUpdates = false;
	let ignorePersistedConfig = false;
	let ignoreWorldMapCache = false;
	let settingsFile: string | null = null;
	let rendererArguments: readonly string[] = entryArgs;
	if (mode === "client") {
		const parsed = parseClientLaunchArguments(entryArgs);
		clientStartup =
			parsed.startup === null
				? undefined
				: { ...parsed.startup, contentPath: extracted.contentPath };
		noLauncher = parsed.noLauncher;
		noUpdates = parsed.noUpdates;
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
	const launch = extractElectronLaunchArguments(rendererArguments);
	for (const argument of launch.electronSwitches) {
		const [name, value] = argument.slice(2).split("=", 2);
		// Preserve native switches supplied directly or by the development launcher.
		if (!app.commandLine.hasSwitch(name))
			app.commandLine.appendSwitch(name, value);
	}
	if (process.platform === "win32") {
		// Request the faster adapter on hybrid laptops; OS and driver selection may prevail.
		if (!app.commandLine.hasSwitch("force-high-performance-gpu"))
			app.commandLine.appendSwitch("force-high-performance-gpu");
	}
	return {
		path: buildEntryPath(entry.path, launch.args),
		title: entry.title + (release ? " (release host)" : ""),
		mode,
		clientStartup,
		noLauncher,
		noUpdates,
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
	delete environment.HOLTBURGER_DEFAULT_CONTENT;
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

/** Both launcher drafts and startup recovery use the same native folder selection behavior. */
async function chooseContentFolder(
	window: BrowserWindow,
	previous: string | null,
): Promise<string | null> {
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
}

function createContentStartup(
	window: BrowserWindow,
	entry: ReturnType<typeof entryArguments>,
	clearContent: boolean,
	overridePath: string | null,
	isCurrent: () => boolean,
	detach: (() => void)[],
): ContentStartup<SidecarHostClient> {
	const startup = new ContentStartup({
		store: new ContentPreferenceStore(
			join(app.getPath("userData"), "content-selection.json"),
		),
		overridePath,
		noContentSearch: entry.noContentSearch,
		clearContent,
		defaultDiscoveryRoot: () =>
			defaultContentRoot(
				process.env.HOLTBURGER_DEFAULT_CONTENT,
				process.cwd(),
				join(dirname(process.execPath), "dats"),
			),
		launch: (selection) =>
			launchHost(entry.mode, entry.ignoreWorldMapCache, selection),
		admit: async (client) => {
			for (const event of hostEventNamesForMode(entry.mode)) {
				const unlisten = await client.listen(event, (payload) => {
					if (isCurrent() && !window.isDestroyed()) {
						window.webContents.send("host:event", { event, payload });
						if (
							event === "client-exit-requested" &&
							desktop !== undefined &&
							!quitting
						) {
							const exit = decodeClientExitRequested(payload);
							if (
								exit.cause !== "explicit-disconnect" &&
								exit.cause !== "host-shutdown"
							) {
								void desktop.back(exit.diagnostic).catch(console.error);
							}
						}
					}
				});
				if (isCurrent()) detach.push(unlisten);
				else unlisten();
			}
		},
		pickFolder: (previous) => chooseContentFolder(window, previous),
	});
	detach.push(
		startup.listen((snapshot) => {
			if (isCurrent() && !window.isDestroyed()) {
				window.webContents.send("content:state", snapshot);
				if (
					snapshot.phase.kind === "fatal" &&
					desktop !== undefined &&
					!quitting
				) {
					void desktop.back(snapshot.phase.message).catch(console.error);
				}
			}
		}),
	);
	return startup;
}

function installContentIpc(): void {
	const requireContent = () => {
		const content = currentContent();
		if (!content) throw new Error("Content startup is unavailable");
		return content;
	};
	handle("content:snapshot", undefined, () => requireContent().snapshot);
	handle("content:choose", undefined, () => requireContent().choose());
	handle("content:retry", undefined, () => requireContent().retry());
	handle("content:quit", undefined, () => app.quit());
	handle("launcher:back", "client", (_event, diagnostic: unknown) => {
		const localFailure = z.string().nullable().parse(diagnostic);
		const phase = currentContent()?.snapshot.phase;
		const contentFailure =
			phase?.kind === "fatal" || phase?.kind === "restart_required"
				? phase.message
				: null;
		void desktop?.back(localFailure ?? contentFailure).catch(console.error);
	});
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

function installIpcBridge(window: BrowserWindow, mode: HostMode): void {
	handle("client:start", "client", async (event) => {
		requireApplicationFrame(event, window);
		if (quitting)
			throw new Error(
				"Client launch is unavailable while the application is closing.",
			);
		if (mode !== "client")
			throw new Error("Client startup is unavailable in Explorer");
		const attempt = requireAttempt();
		if (attempt.cancellation.signal.aborted)
			throw new Error("Client attempt is retiring");
		attempt.launch ??= requireActiveHost().startClient(attempt.startup);
		await attempt.launch;
	});
	handle("host:invoke", undefined, async (event, request: unknown) => {
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

		// Renderer preparation withdraws input and drains construction/teardown RPC. The document
		// retirement acknowledgement, not the cancellation signal, is the native admission cutoff.

		const client = requireActiveHost();
		try {
			return {
				kind: "ok",
				value: await client.invoke(request.command, args),
			} satisfies HostCommandResult;
		} catch (error) {
			if (!(error instanceof SidecarProtocolError)) throw error;
			return {
				kind: "failed",
				error: {
					code: error.code,
					message: error.message,
					resource: error.resource,
				},
			} satisfies HostCommandResult;
		}
	});
}

function requireApplicationFrame(
	event: Electron.IpcMainInvokeEvent,
	window: BrowserWindow | null,
): void {
	if (window === null) throw new Error("Application window is unavailable");
	const applicationContents = window.webContents;
	if (
		applicationContents.isDestroyed() ||
		event.sender !== applicationContents ||
		event.senderFrame !== applicationContents.mainFrame
	)
		throw new Error("requests are accepted only from the application frame");
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

function requireWindowDisplay(): WindowDisplay {
	if (windowDisplay === null)
		throw new Error("Client window controls are unavailable.");
	return windowDisplay;
}

/** Both settings controls and native shortcuts commit through the same settings owner. */
async function changeWindowDisplay(
	request: WindowDisplayRequest,
): Promise<void> {
	const controls = requireWindowDisplay();
	const settings = requireSettings();
	await controls.change(request);
	await settings.updateWindow(controls.settings());
}

function installSettingsIpcBridge(
	window: BrowserWindow,
	ignorePersistedConfig: boolean,
): void {
	handle("window:display-snapshot", "client", () =>
		requireWindowDisplay().snapshot(),
	);
	handle("window:display-change", "client", (_event, request: unknown) =>
		changeWindowDisplay(windowDisplayRequestSchema.parse(request)),
	);
	const readMode: ClientSettingsReadMode = ignorePersistedConfig
		? "fresh"
		: "persisted";
	handle("settings:load-user", "client", async (event, context: unknown) => {
		requireApplicationFrame(event, window);
		const attempt = requireAttempt();
		try {
			return await requireSettings().loadUser(context, readMode);
		} catch (error) {
			// User settings load before the renderer mounts, so no toast can report
			// a failed backup or repair write. Use the existing startup error surface.
			attempt.content.fail(formatError(error));
			throw error;
		}
	});
	handle(
		"settings:save-user-patch",
		"client",
		async (event, patch: unknown) => {
			requireApplicationFrame(event, window);
			await requireSettings().saveUserPatch(
				clientUserSettingsPatchSchema.parse(patch),
			);
		},
	);
	handle("settings:reset-user", "client", async (event, settings: unknown) => {
		requireApplicationFrame(event, window);
		return requireSettings().resetUser(settings);
	});
	handle(
		"settings:load-character",
		"client",
		(event, guid: unknown, defaults: unknown) => {
			requireApplicationFrame(event, window);
			return requireSettings().loadCharacter(
				clientCharacterProfileKey(
					requireAttempt().startup,
					requireCharacterGuid(guid),
				),
				defaults,
				readMode,
			);
		},
	);
	handle(
		"settings:save-character-patch",
		"client",
		async (event, request: unknown) => {
			requireApplicationFrame(event, window);
			if (typeof request !== "object" || request === null)
				throw new Error("character settings request is malformed");
			if (!("characterGuid" in request) || !("patch" in request))
				throw new Error("character settings request is incomplete");
			const guid = requireCharacterGuid(request.characterGuid);
			await requireSettings().saveCharacterPatch(
				clientCharacterProfileKey(requireAttempt().startup, guid),
				clientCharacterSectionsSchema.parse(request.patch),
			);
		},
	);
}

function createWindow(entry: {
	title: string;
	mode: HostMode;
	noLauncher: boolean;
}): BrowserWindow {
	const developmentOrigin = electronDevOrigin(entry.mode);
	const ozonePlatform = app.commandLine.getSwitchValue("ozone-platform");
	const restoreWaylandPointer =
		process.platform === "linux" &&
		ozonePlatform !== "x11" &&
		(ozonePlatform === "wayland" || process.env.XDG_SESSION_TYPE === "wayland");
	const window = new BrowserWindow({
		title: entry.title,
		icon: applicationIconPath,
		width: APP_WINDOW_TUNING.game.initialContentSize.width,
		height: APP_WINDOW_TUNING.game.initialContentSize.height,
		useContentSize: true,
		minWidth: APP_WINDOW_TUNING.game.minimumContentSize.width,
		minHeight: APP_WINDOW_TUNING.game.minimumContentSize.height,
		resizable: true,
		show: false,
		backgroundColor: APP_WINDOW_TUNING.backgroundColor,
		webPreferences: {
			preload: join(currentDirectory, "preload.cjs"),
			additionalArguments: [
				`--holtburger-mode=${entry.mode}`,
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
		handle("window:restore-pointer", undefined, (event, point: unknown) => {
			requireApplicationFrame(event, window);
			pointerHover.restore(pointerPositionSchema.parse(point));
		});
	}
	// Electron/Wayland can negotiate the constructor width down to minWidth. Reapply the
	// content size while hidden so the first visible frame keeps the configured inner dimensions.
	window.setContentSize(
		APP_WINDOW_TUNING.game.initialContentSize.width,
		APP_WINDOW_TUNING.game.initialContentSize.height,
	);
	setGameMinimumContentSize(window);
	// Restored dimensions can stall ready-to-show's first-paint notification on Wayland.
	// Show after the initial document loads so a mounted launcher cannot remain hidden.
	window.webContents.once("did-finish-load", () => window.show());
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("render-process-gone", (_event, details) => {
		documentRetirement?.rendererUnavailable(
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
			input.key === "F11" &&
			!input.control &&
			!input.shift &&
			!input.alt &&
			!input.meta &&
			windowDisplay !== null
		) {
			event.preventDefault();
			if (input.type === "keyDown" && !input.isAutoRepeat) {
				const controls = windowDisplay;
				const display = controls.snapshot();
				if (display.busy || display.confirmation !== null) return;
				void changeWindowDisplay({
					kind: "fullscreen",
					enabled: !display.fullscreen,
				}).catch((error) => reportWindowSettingsFailure(window, error));
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

async function stopWindowGeometry(): Promise<void> {
	const controls = windowDisplay;
	windowDisplay = null;
	const stop = stopGeometry;
	stopGeometry = null;
	try {
		await controls?.close();
	} finally {
		// A failed rollback must not leave persistence subscribed to a retired window owner.
		await stop?.();
	}
}
function initialGeometry(width: number, height: number): ClientWindowSettings {
	return {
		normalBounds: {
			width,
			height,
		},
		maximized: false,
		fullscreen: false,
		freeResize: true,
	};
}
/** Geometry persistence errors must remain visible even when no form save is in progress. */
function reportWindowSettingsFailure(
	window: BrowserWindow,
	error: unknown,
): void {
	console.error(error);
	if (!window.isDestroyed())
		dialog.showErrorBox(
			"Holtburger window settings could not be saved",
			formatError(error),
		);
}
function reportTransitionFailure(window: BrowserWindow, error: unknown): void {
	pickerFailure = formatError(error);
	console.error(error);
	if (!window.isDestroyed())
		dialog.showErrorBox("Holtburger session could not finish", pickerFailure);
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

void (async () => {
	let entry: ReturnType<typeof entryArguments>;
	let appSettings: AppSettingsStore;
	let graphicsOverrides: readonly string[];
	try {
		entry = entryArguments();
		appSettings = new AppSettingsStore(
			join(app.getPath("userData"), "app-settings.json"),
			process.platform,
		);
		graphicsOverrides = applyAppGraphicsSettings(
			appSettings.settings,
			app.commandLine,
		);
	} catch (error) {
		await app.whenReady();
		reportFatalError("Holtburger 3D launch arguments are invalid", error);
		return;
	}
	const startupSettings = appSettings.settings;
	await app.whenReady();
	app.dock?.setIcon(applicationIconPath);
	const menuTemplate = applicationMenuTemplate(process.platform);
	Menu.setApplicationMenu(
		menuTemplate === null ? null : Menu.buildFromTemplate(menuTemplate),
	);
	const window = createWindow(entry);
	const refreshDisplay = () => windowDisplay?.refresh();
	screen.on("display-metrics-changed", refreshDisplay);
	window.once("closed", () =>
		screen.removeListener("display-metrics-changed", refreshDisplay),
	);
	const themes = new UiThemeCatalog(
		join(app.getPath("userData"), "themes"),
		console.error,
	);
	installUiThemeProtocol(window.webContents.session, themes);
	ipcMain.handle("document:boot", (event) => {
		const frame = event.senderFrame;
		if (
			event.sender !== window.webContents ||
			frame === null ||
			frame !== window.webContents.mainFrame
		)
			throw new Error("Document boot requires the application frame");
		return documents.boot(frame.url);
	});
	handle("themes:list", undefined, () => themes.list());
	handle("themes:resolve", undefined, (_event, id: unknown) =>
		themes.resolve(uiThemeIdSchema.parse(id)),
	);
	handle("themes:open-directory", undefined, async () => {
		const error = await shell.openPath(await themes.directory());
		if (error) throw new Error(`Could not open themes directory: ${error}`);
	});
	installIpcBridge(window, entry.mode);
	installContentIpc();
	const navigate = async (role: DocumentRole, path: string) => {
		appUpdates?.clearPregame();
		documents.navigate(role, path);
		await loadEntry(window, path, entry.mode);
	};
	if (entry.mode === "explorer") {
		const detach: (() => void)[] = [];
		explorerContent = createContentStartup(
			window,
			entry,
			entry.clearContent,
			entry.contentPath,
			() => !quitting,
			detach,
		);
		await navigate("explorer", entry.path);
		await explorerContent.start();
		return;
	}

	const updates = new AppUpdates(
		app.isPackaged && !entry.noUpdates
			? loadUpdateBuild(
					join(app.getAppPath(), "dist/build-info.json"),
					console.error,
				)
			: null,
		{
			request: fetch,
			now: Date.now,
			publish: (snapshot) => {
				if (documents.role !== null && !window.webContents.isDestroyed())
					window.webContents.send("updates:state", snapshot);
			},
			report: console.error,
			openExternal: (url) => shell.openExternal(url),
		},
	);
	appUpdates = updates;
	const reconsiderUpdates = () => {
		if (!window.isDestroyed())
			updates.setWindowVisible(window.isVisible() && !window.isMinimized());
	};
	window.on("show", reconsiderUpdates);
	window.on("hide", reconsiderUpdates);
	window.on("minimize", reconsiderUpdates);
	window.on("restore", reconsiderUpdates);
	window.on("focus", reconsiderUpdates);
	powerMonitor.on("resume", reconsiderUpdates);
	window.once("closed", () => {
		updates.stop();
		powerMonitor.removeListener("resume", reconsiderUpdates);
	});
	handle("updates:snapshot", undefined, () => updates.snapshot);
	handle("updates:register-pregame", undefined, (_event, visible: unknown) =>
		updates.registerPregame(z.boolean().parse(visible)),
	);
	// Optional lifecycle withdrawals can arrive after native navigation seals their document.
	// Acknowledge retirement without admitting stale registration, snapshot or download actions.
	const updateRegistration = (
		event: Electron.IpcMainInvokeEvent,
		identity: unknown,
		operation: () => PregameRegistrationStatus,
	) => {
		requireApplicationFrame(event, BrowserWindow.fromWebContents(event.sender));
		if (
			!documents.isAdmitted(identity) ||
			(documentRetirement !== undefined &&
				!documentRetirement.acceptsRendererRequests)
		)
			return "retired";
		return operation();
	};
	ipcMain.handle(
		"updates:pregame-visible",
		(event, identity: unknown, token: unknown, visible: unknown) =>
			updateRegistration(event, identity, () =>
				updates.setPregameVisible(
					z.uuid().parse(token),
					z.boolean().parse(visible),
				),
			),
	);
	ipcMain.handle(
		"updates:release-pregame",
		(event, identity: unknown, token: unknown) =>
			updateRegistration(event, identity, () =>
				updates.releasePregame(z.uuid().parse(token)),
			),
	);
	handle("updates:open-downloads", undefined, () => updates.openDownloads());
	handle("updates:refresh", undefined, () => updates.refresh());
	handle("updates:open-history", undefined, () => updates.openHistory());
	updates.start();
	reconsiderUpdates();

	const launcher = new LauncherStore(
		join(app.getPath("userData"), "launcher-settings.json"),
		initialGeometry(
			APP_WINDOW_TUNING.launcher.initialContentSize.width,
			APP_WINDOW_TUNING.launcher.initialContentSize.height,
		),
	);
	await launcher.load();
	let clearContent = entry.clearContent;
	const gamePath = entry.path;
	// CLI content overrides only the first interactive attempt or the direct launch.
	let initialContentPath =
		entry.clientStartup === undefined ? entry.contentPath : null;
	const showPicker = async (diagnostic: string | null) => {
		if (quitting) return;
		await stopWindowGeometry();
		if (quitting) return;
		pickerFailure = diagnostic;
		documentRetirement = undefined;
		await restoreGeometry(window, launcher.window, "picker");
		stopGeometry = observeWindowGeometry(
			window,
			(value) => launcher.updateWindow(value),
			(error) => {
				pickerFailure = formatError(error);
				reportWindowSettingsFailure(window, error);
			},
		);
		await navigate("picker", "launcher/index.html");
	};
	const cleanup = async (attempt: NativeAttempt) => {
		updates.clearPregame();
		documents.close();
		for (const detach of attempt.detach.splice(0)) detach();
		const results = await Promise.allSettled([
			stopWindowGeometry(),
			attempt.content.close(),
			attempt.resources.kind === "pending"
				? Promise.resolve()
				: attempt.resources.settings.flush(),
			attempt.resources.kind === "ready"
				? attempt.resources.cache.close()
				: Promise.resolve(),
		]);
		attempt.startup.password = "";
		const failures = results.filter(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		if (failures.length)
			throw new AggregateError(
				failures.map((result) => result.reason),
				"Session retirement failed",
			);
	};
	const owner = new ClientApplication<NativeAttempt>({
		launcherEnabled: !entry.noLauncher,
		create: (startup) => {
			pickerFailure = null;
			const detach: (() => void)[] = [];
			const content = createContentStartup(
				window,
				entry,
				clearContent,
				startup.contentPath,
				() => owner.attempt?.content === content,
				detach,
			);
			return {
				startup,
				content,
				resources: { kind: "pending" },
				opening: Promise.resolve(),
				launch: null,
				detach,
				cancellation: new AbortController(),
			};
		},
		initialize: async (attempt) => {
			attempt.opening = (async () => {
				await stopWindowGeometry();
				attempt.cancellation.signal.throwIfAborted();
				const settings = new ClientSettingsStore(
					entry.settingsFile ?? clientSettingsFilePath(app.getPath("userData")),
					initialGeometry(
						APP_WINDOW_TUNING.game.initialContentSize.width,
						APP_WINDOW_TUNING.game.initialContentSize.height,
					),
				);
				attempt.resources = { kind: "settings", settings };
				const repaired = await settings.load();
				if (repaired.length)
					console.warn(
						`Client window settings repaired: ${repaired.join("; ")}`,
					);
				attempt.cancellation.signal.throwIfAborted();
				const savedWindow = settings.readWindow();
				const restoredWindow = await restoreGeometry(
					window,
					savedWindow,
					"client",
				);
				const controls = new WindowDisplay(
					window,
					restoredWindow,
					(snapshot) => {
						if (!window.isDestroyed())
							window.webContents.send("window:display-state", snapshot);
					},
					(error) => reportWindowSettingsFailure(window, error),
				);
				windowDisplay = controls;
				stopGeometry = observeWindowGeometry(
					window,
					(value) => settings.updateWindow(value),
					(error) => reportWindowSettingsFailure(window, error),
					() => controls.settings(),
				);
				const cache = new ClientVisualCacheStore(
					join(app.getPath("userData"), "character-visuals"),
					attempt.startup,
					APP_PERSISTENCE_TUNING.visualCacheWriteDelayMs,
					(message) => {
						console.error(message);
						if (owner.attempt === attempt && !window.isDestroyed())
							window.webContents.send("visual-cache:failure", message);
					},
				);
				attempt.resources = { kind: "ready", settings, cache };
				documentRetirement = undefined;
				await navigate("client", gamePath);
				attempt.cancellation.signal.throwIfAborted();
			})();
			await attempt.opening;
			attempt.cancellation.signal.throwIfAborted();
			clearContent = false;
			await attempt.content.start();
		},
		retire: async (attempt) => {
			updates.clearPregame();
			// Opening contains settings/navigation only; host readiness must be cancelled by native close.
			try {
				await attempt.opening;
			} catch (error) {
				if (!attempt.cancellation.signal.aborted) throw error;
			}
			const retirement = new ClientRetirement({
				deadlineMs: APP_LIFECYCLE_TUNING.rendererClosePreparationTimeoutMs,
				prepareRenderer: () => {
					if (
						documents.role !== "client" ||
						window.isDestroyed() ||
						fatalReported
					) {
						retirement.acceptPreparation({ kind: "prepared" });
						return;
					}
					window.webContents.send("client:prepare-close");
				},
				shutdownNative: () => cleanup(attempt),
			});
			documentRetirement = retirement;
			const preparation = await retirement.request();
			if (preparation.kind === "failed") {
				pickerFailure = preparation.diagnostic;
				console.error(preparation.diagnostic);
				if (quitting) exitCode = 1;
			}
		},
		showPicker: async (diagnostic) => {
			const messages = new Set(
				[diagnostic, pickerFailure].filter(
					(value): value is string => value !== null,
				),
			);
			await showPicker(messages.size === 0 ? null : [...messages].join("\n"));
		},
		flushLauncher: async () => {
			// Both independent stores must settle even when another persistence owner fails.
			const results = await Promise.allSettled([
				(async () => {
					if (owner.attempt === null) await stopWindowGeometry();
					await launcher.flush();
				})(),
				appSettings.flush(),
			]);
			const failures = results.flatMap((result) =>
				result.status === "rejected" ? [formatError(result.reason)] : [],
			);
			if (failures.length > 0) throw new Error(failures.join("\n"));
		},
		exit: (failures) => {
			for (const failure of failures) console.error(failure);
			if (restartRequested && failures.length === 0) {
				if (
					!app.isPackaged &&
					process.env.HOLTBURGER_ELECTRON_SUPERVISED === "1"
				) {
					// The dev launcher owns Vite and must also own replacement Electron processes.
					app.exit(DEV_RESTART_EXIT_CODE);
					return;
				}
				app.relaunch();
			}
			app.exit(failures.length ? 1 : exitCode);
		},
		report: (diagnostic) =>
			reportTransitionFailure(window, new Error(diagnostic)),
	});
	desktop = owner;
	installSettingsIpcBridge(window, entry.ignorePersistedConfig);
	handle("visual-cache:read", "client", (_event, guid: unknown) =>
		requireCache().read(requireCharacterGuid(guid)),
	);
	handle("visual-cache:stage", "client", (_event, capture: unknown) =>
		requireCache().stage(playerVisualCaptureSchema.parse(capture)),
	);
	handle("launcher:snapshot", "picker", () =>
		launcher.snapshot(pickerFailure, owner.canPlay),
	);
	handle(
		"launcher:app-settings",
		"picker",
		async (): Promise<AppSettingsSnapshot> => {
			let renderer: string | null = null;
			let gpuDiagnostic: string | null = null;
			try {
				// Electron returns Chromium's evolving GPUInfo shape; consume only its renderer string.
				const info = z
					.object({
						auxAttributes: z.object({ glRenderer: z.string().optional() }),
					})
					.parse(await app.getGPUInfo("complete"));
				renderer = info.auxAttributes.glRenderer ?? null;
			} catch (error) {
				gpuDiagnostic = `Graphics information could not be read: ${formatError(error)}`;
			}
			const settings = appSettings.settings;
			return {
				settings,
				defaults: appSettings.defaults,
				backends: graphicsBackendOptions(process.platform),
				restartRequired: appSettingsRequireRestart(startupSettings, settings),
				overrides: graphicsOverrides,
				renderer,
				hardwareAcceleration: app.isHardwareAccelerationEnabled(),
				diagnostic:
					[appSettings.diagnostic, gpuDiagnostic]
						.filter((value) => value !== null)
						.join("\n") || null,
			};
		},
	);
	handle("launcher:save-app-settings", "picker", (_event, input: unknown) =>
		appSettings.save(input),
	);
	handle("launcher:copy-hardware-info", "picker", (_event, input: unknown) =>
		copyHardwareInfo(
			window,
			input,
			startupSettings,
			appSettings.settings,
			graphicsOverrides,
		),
	);
	handle("launcher:restart", "picker", async () => {
		restartRequested = true;
		quitting = true;
		await owner.quit();
	});
	const directory = new ServerDirectoryCatalog(fetch);

	handle(
		"launcher:choose-content-path",
		"picker",
		async (_event, previous: unknown) => {
			const path = z.string().min(1).nullable().parse(previous);
			return chooseContentFolder(window, path);
		},
	);
	handle("launcher:directory", "picker", async (_event, refresh: unknown) => {
		await directory.load(z.boolean().parse(refresh));
		return directory.view(
			launcher.snapshot(pickerFailure, owner.canPlay).servers,
		);
	});
	handle("launcher:import-server", "picker", (_event, key: unknown) =>
		launcher.importServer(directory.select(key)),
	);
	handle("launcher:save-server", "picker", (_event, value: unknown) =>
		launcher.saveServer(value),
	);
	handle("launcher:delete-server", "picker", (_event, id: unknown) =>
		launcher.deleteServer(z.string().uuid().parse(id)),
	);
	handle("launcher:save-profile", "picker", (_event, value: unknown) =>
		launcher.saveProfile(value),
	);
	handle("launcher:delete-profile", "picker", (_event, id: unknown) =>
		launcher.deleteProfile(z.string().uuid().parse(id)),
	);
	handle("launcher:credentials", "picker", (_event, selection: unknown) =>
		launcher.credentials(selection),
	);
	handle("launcher:play", "picker", (_event, selection: unknown) =>
		owner.play(async () => {
			const startup = await launcher.select(selection);
			const contentPath = initialContentPath ?? startup.contentPath;
			initialContentPath = null;
			return { ...startup, contentPath };
		}),
	);
	ipcMain.handle("client:request-close", (event, identity: unknown) => {
		requireApplicationFrame(event, window);
		documents.requireIdentity(identity);
		app.quit();
	});
	handle("client:prepared-close", "client", (_event, payload: unknown) => {
		documentRetirement?.acceptPreparation(payload);
	});
	window.on("close", (event) => {
		event.preventDefault();
		updates.stop();
		quitting = true;
		void owner.quit();
	});
	window.webContents.on(
		"did-start-navigation",
		(_event, _url, inPlace, mainFrame) => {
			if (mainFrame && !inPlace && documentRetirement?.preparing)
				documentRetirement.rendererUnavailable(
					"Client renderer navigated during retirement preparation.",
				);
		},
	);
	app.on("before-quit", (event) => {
		event.preventDefault();
		quitting = true;
		void owner.quit();
	});
	const directStartup = entry.clientStartup;
	if (directStartup !== undefined) await owner.play(async () => directStartup);
	else await showPicker(null);
})().catch((error: unknown) =>
	reportFatalError("Holtburger 3D failed to start", error),
);

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
	appUpdates?.stop();
	if (desktop !== undefined || quitting || !explorerContent) return;
	event.preventDefault();
	quitting = true;
	void explorerContent
		.close()
		.catch((error: unknown) => {
			console.error(error);
			exitCode = 1;
		})
		.finally(() => app.exit(exitCode));
});
