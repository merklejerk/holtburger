import { app } from "electron";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import {
	buildEntryPath,
	requireEntry,
	extractContentArguments,
	extractEntryArguments,
	extractElectronLaunchArguments,
} from "../scripts/entry-paths.mjs";
import {
	electronApplicationArguments,
	isClientOnlyArgument,
	isExplorerOnlyArgument,
	parseClientLaunchArguments,
	parseExplorerLaunchArguments,
	type ClientLaunchConfiguration,
	type ExplorerLaunchConfiguration,
	type LiveApiCliOverride,
} from "./client-launch.js";
import type { HostContentSelection } from "./content-startup.js";
import { SidecarHostClient } from "./host-protocol.js";
import type { HostMode } from "../src/lib/host/host-transport.js";

export type EntryArguments = ReturnType<typeof entryArguments>;

// The client dev entry uses a separate default port so two worktrees cannot silently share a
// renderer server. The launcher may override it for an explicit isolated diagnostic run.
export function electronDevOrigin(mode: HostMode): string {
	return (
		process.env.HOLTBURGER_ELECTRON_DEV_ORIGIN ??
		`http://127.0.0.1:${mode === "client" ? 1421 : 1420}`
	);
}

export function entryArguments(): {
	path: string;
	title: string;
	mode: HostMode;
	clientStartup?: ClientLaunchConfiguration;
	explorerStartup?: ExplorerLaunchConfiguration;
	initialLauncherView: "client" | "explorer";
	noLauncher: boolean;
	/** Process-only update lookup opt-out consumed by the native update owner. */
	noUpdates: boolean;
	ignorePersistedConfig: boolean;
	ignoreWorldMapCache: boolean;
	settingsFile: string | null;
	liveApiOverride: LiveApiCliOverride | null;
	contentPath: string | null;
	noContentSearch: boolean;
	clearContent: boolean;
} {
	const appArgs = electronApplicationArguments(
		process.argv,
		!app.isPackaged,
		app.getAppPath(),
	);
	const extracted = extractContentArguments(appArgs, process.cwd());
	const selectedEntry = extractEntryArguments(extracted.args);
	const rawArgs = selectedEntry.args;
	const release = rawArgs.includes("--release");
	const entryArgs = rawArgs.filter((arg) => arg !== "--release");
	const selectedEntryName = selectedEntry.name;
	const entry = requireEntry(selectedEntryName);
	const mode: HostMode = selectedEntryName === "client" ? "client" : "explorer";
	let clientStartup: ClientLaunchConfiguration | undefined;
	let explorerStartup: ExplorerLaunchConfiguration | undefined;
	let initialLauncherView: "client" | "explorer" = "client";
	let noLauncher: boolean;
	let noUpdates: boolean;
	let ignorePersistedConfig: boolean;
	let ignoreWorldMapCache: boolean;
	let settingsFile: string | null;
	let liveApiOverride: LiveApiCliOverride | null = null;
	let rendererArguments: readonly string[];
	if (mode === "client") {
		const explorerArgument = entryArgs.find(isExplorerOnlyArgument);
		if (explorerArgument !== undefined) {
			throw new Error(
				`Explorer launch argument ${explorerArgument} is unavailable in Client mode`,
			);
		}
		const parsed = parseClientLaunchArguments(entryArgs);
		clientStartup =
			parsed.startup === null
				? undefined
				: { ...parsed.startup, contentPath: extracted.contentPath };
		initialLauncherView = parsed.initialLauncherView;
		noLauncher = parsed.noLauncher;
		noUpdates = parsed.noUpdates;
		ignorePersistedConfig = parsed.ignorePersistedConfig;
		ignoreWorldMapCache = parsed.ignoreWorldMapCache;
		settingsFile = parsed.settingsFile;
		liveApiOverride = parsed.liveApiOverride;
		rendererArguments = parsed.rendererArguments;
	} else {
		const clientArgument = entryArgs.find(isClientOnlyArgument);
		if (clientArgument !== undefined) {
			throw new Error(
				`client launch argument ${clientArgument} is unavailable in Explorer mode`,
			);
		}
		const parsed = parseExplorerLaunchArguments(entryArgs);
		explorerStartup = {
			...parsed.startup,
			contentPath: extracted.contentPath,
		};
		noLauncher = parsed.noLauncher;
		noUpdates = parsed.noUpdates;
		ignorePersistedConfig = parsed.ignorePersistedConfig;
		ignoreWorldMapCache = parsed.ignoreWorldMapCache;
		settingsFile = parsed.settingsFile;
		rendererArguments = parsed.rendererArguments;
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
		explorerStartup,
		initialLauncherView,
		noLauncher,
		noUpdates,
		ignorePersistedConfig,
		ignoreWorldMapCache,
		settingsFile,
		liveApiOverride,
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

export function launchHost(
	mode: HostMode,
	ignoreWorldMapCache: boolean,
	selection: HostContentSelection,
	options?: { readonly weenieCatalogPath?: string | null },
): SidecarHostClient {
	const args =
		selection.kind === "explicit"
			? ["--content", selection.path]
			: ["--discovery-root", selection.root];
	if (mode === "explorer" && options?.weenieCatalogPath) {
		args.push("--weenie-catalog", options.weenieCatalogPath);
	}
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
