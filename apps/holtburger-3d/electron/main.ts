import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildEntryPath, requireEntry } from "../scripts/entry-paths.mjs";
import { SidecarHostClient, SidecarProtocolError } from "./host-protocol.js";
import { isAllowedNavigation } from "./navigation-policy.js";
import {
	HOST_COMMAND_NAMES,
	HOST_EVENT_NAMES,
} from "../src/lib/host/host-transport.js";
import type {
	HostCommandArguments,
	HostCommandName,
} from "../src/lib/host/host-transport.js";

const ELECTRON_DEV_ORIGIN = "http://127.0.0.1:1420";
const WINDOW_BACKGROUND_COLOR = "#0b0a08";
const INITIAL_WINDOW_CONTENT_SIZE = Object.freeze({ width: 1440, height: 900 });
const ALLOWED_COMMANDS: ReadonlySet<string> = new Set(HOST_COMMAND_NAMES);

const currentDirectory = dirname(fileURLToPath(import.meta.url));
let hostClient: SidecarHostClient | undefined;
let quitting = false;
let exitCode = 0;

function entryArguments(): {
	path: string;
	title: string;
} {
	const processArguments = process.argv.slice(2);
	const entryArguments =
		processArguments[0] === "." || processArguments[0] === app.getAppPath()
			? processArguments.slice(1)
			: processArguments;
	const [entryName, ...rawArgs] = entryArguments;
	const release = rawArgs.includes("--release");
	const entryArgs = rawArgs.filter((arg) => arg !== "--release");
	const entry = requireEntry(entryName ?? "explorer");
	return {
		path: buildEntryPath(entry.path, entryArgs),
		title: entry.title + (release ? " (release host)" : ""),
	};
}

function workspaceRoot(): string {
	return resolve(app.getAppPath(), "../..");
}

function hostBinaryPath(): string {
	if (process.env.HOLTBURGER_HOST_BIN) return process.env.HOLTBURGER_HOST_BIN;
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

async function startHost(window: BrowserWindow): Promise<void> {
	const child = spawn(hostBinaryPath(), [], {
		env: hostEnvironment(),
		stdio: "pipe",
		windowsHide: true,
	});
	child.stderr?.on("data", (chunk) =>
		console.error(`[holtburger-host] ${chunk.toString()}`),
	);
	const client = new SidecarHostClient(child);
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
	for (const event of HOST_EVENT_NAMES) {
		await client.listen(event, (payload) => {
			if (!window.isDestroyed())
				window.webContents.send("host:event", { event, payload });
		});
	}
}

function isHostCommandName(command: string): command is HostCommandName {
	return ALLOWED_COMMANDS.has(command);
}

function isHostCommandArguments(value: unknown): value is HostCommandArguments {
	return (
		value === undefined ||
		(typeof value === "object" && value !== null && !Array.isArray(value))
	);
}

function installIpcBridge(): void {
	ipcMain.handle("host:invoke", async (_event, request: unknown) => {
		if (
			typeof request !== "object" ||
			request === null ||
			!("command" in request) ||
			typeof request.command !== "string"
		) {
			throw new Error("host request envelope is malformed");
		}
		if (!isHostCommandName(request.command)) {
			throw new Error(`host command is not allowlisted: ${request.command}`);
		}
		const args = "args" in request ? request.args : undefined;
		if (!isHostCommandArguments(args))
			throw new Error("host command arguments must be an object");
		if (!hostClient)
			throw new Error("host sidecar is not running for this entry");
		return hostClient.invoke(request.command, args);
	});
}

function createWindow(entry: { path: string; title: string }): BrowserWindow {
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
	window.webContents.on("context-menu", (_event, params) => {
		const template: MenuItemConstructorOptions[] = [{ role: "reload" }];
		if (params.isEditable) {
			template.push(
				{ type: "separator" },
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			);
		} else if (params.selectionText.length > 0) {
			template.push({ type: "separator" }, { role: "copy" });
		}
		template.push(
			{ type: "separator" },
			{
				label: "Inspect Element",
				click: () => window.webContents.inspectElement(params.x, params.y),
			},
		);
		Menu.buildFromTemplate(template).popup({ window });
	});
	window.webContents.on("will-navigate", (event, targetUrl) => {
		if (
			!isAllowedNavigation(targetUrl, {
				packaged: app.isPackaged,
				appPath: app.getAppPath(),
				developmentOrigin: ELECTRON_DEV_ORIGIN,
			})
		) {
			event.preventDefault();
		}
	});
	return window;
}

function reportFatalError(title: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	console.error(error);
	dialog.showErrorBox(title, message);
	exitCode = 1;
	app.quit();
}

async function loadEntry(
	window: BrowserWindow,
	entryPath: string,
): Promise<void> {
	if (!app.isPackaged) {
		await window.loadURL(`${ELECTRON_DEV_ORIGIN}/${entryPath}`);
		return;
	}
	const [pathname, query = ""] = entryPath.split("?", 2);
	await window.loadFile(join(app.getAppPath(), "dist", pathname), {
		search: query.length === 0 ? undefined : `?${query}`,
	});
}

app.whenReady().then(async () => {
	const entry = entryArguments();
	Menu.setApplicationMenu(null);
	installIpcBridge();
	const window = createWindow(entry);
	try {
		const [hostResult, entryResult] = await Promise.allSettled([
			startHost(window),
			loadEntry(window, entry.path),
		]);
		if (entryResult.status === "rejected") throw entryResult.reason;
		if (hostResult.status === "rejected") throw hostResult.reason;
	} catch (error) {
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
