import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildEntryPath, requireEntry } from "../scripts/entry-paths.mjs";
import {
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

const WINDOW_BACKGROUND_COLOR = "#0b0a08";
const INITIAL_WINDOW_CONTENT_SIZE = Object.freeze({ width: 1440, height: 900 });

const currentDirectory = dirname(fileURLToPath(import.meta.url));
let hostClient: SidecarHostClient | undefined;
let quitting = false;
let exitCode = 0;
let fatalReported = false;
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
} {
	const processArguments = process.argv.slice(2);
	const entryArguments =
		processArguments[0] === "." || processArguments[0] === app.getAppPath()
			? processArguments.slice(1)
			: processArguments;
	const [entryName, ...rawArgs] = entryArguments;
	const release = rawArgs.includes("--release");
	const entryArgs = rawArgs.filter((arg) => arg !== "--release");
	const selectedEntryName = entryName ?? "explorer";
	const entry = requireEntry(selectedEntryName);
	const mode: HostMode = selectedEntryName === "client" ? "client" : "explorer";
	let clientStartup: ClientLaunchConfiguration | undefined;
	let rendererArguments: readonly string[] = entryArgs;
	if (mode === "client") {
		const parsed = parseClientLaunchArguments(entryArgs);
		clientStartup = parsed.startup;
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

async function startHost(
	window: BrowserWindow,
	mode: HostMode,
	clientStartup?: ClientLaunchConfiguration,
): Promise<void> {
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
	// Resolve before the private client launch follow-up so an early renderer request waits for a
	// selected, fully negotiated host rather than observing an empty/global allowlist.
	hostReady.resolve(client);
	if (mode === "client" && clientStartup !== undefined) {
		try {
			await client.startClient(clientStartup);
		} finally {
			// The encoded request has been handed to the sidecar; do not retain the password in
			// Electron's entry state after the one launch attempt.
			clientStartup.password = "";
		}
	}
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
		return client.invoke(request.command, args);
	});
}

function createWindow(entry: {
	path: string;
	title: string;
	mode: HostMode;
}): BrowserWindow {
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
		(_event, level, message, line, sourceId) => {
			if (level >= 2) {
				const severity = level >= 3 ? "error" : "warn";
				console[severity](
					`[holtburger-renderer:${severity}] ${message} (${sourceId}:${line})`,
				);
				return;
			}
			if (process.env.HOLTBURGER_RENDERER_VERBOSE === "1") {
				console.info(`[holtburger-renderer:info] ${message}`);
			}
		},
	);
	window.webContents.on("context-menu", (_event, params) => {
		const template: MenuItemConstructorOptions[] = [];
		if (params.isEditable) {
			template.push(
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			);
		} else if (params.selectionText.length > 0) {
			template.push({ role: "copy" });
		}
		if (template.length > 0) template.push({ type: "separator" });
		template.push({
			label: "Inspect Element",
			click: () => window.webContents.inspectElement(params.x, params.y),
		});
		Menu.buildFromTemplate(template).popup({ window });
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
	const window = createWindow(entry);
	installIpcBridge(window, entry.mode);
	try {
		await startHost(window, entry.mode, entry.clientStartup);
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
	if (quitting || !hostClient) return;
	quitting = true;
	event.preventDefault();
	hostClient
		.shutdown()
		.catch((error) => console.error("host shutdown failed", error))
		.finally(() => app.exit(exitCode));
});
