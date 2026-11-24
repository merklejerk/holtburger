import type { ClientHostAppraisalTuningConfig } from "../src/client/settings/tuning-contract.js";
import type { LiveApiSettings } from "../src/app/desktop/app-settings-contract.js";
import {
	isClientOnlyLaunchArgument,
	isExplorerOnlyLaunchArgument,
	parseClientLaunchArgument,
	parseExplorerLaunchArgument,
} from "../scripts/entry-paths.mjs";
import { resolve } from "node:path";

/** Resolved localhost Live API launch configuration forwarded to the Rust host sidecar. */
export interface LiveApiLaunchConfiguration {
	/** Localhost TCP port (`0` requests an OS-assigned ephemeral port). */
	readonly port: number;
}

/** Explicit CLI Live API overrides (`--api`, `--api-port`), applied over AppSettings. */
export interface LiveApiCliOverride {
	readonly enabled: true;
	readonly port?: number;
}

/** Resolves effective sidecar Live API startup from saved AppSettings and optional CLI overrides. */
export function resolveLiveApiLaunch(
	settings: LiveApiSettings,
	override: LiveApiCliOverride | null,
): LiveApiLaunchConfiguration | undefined {
	const enabled = override !== null ? override.enabled : settings.enabled;
	if (!enabled) return undefined;
	return {
		port: override?.port ?? settings.port ?? 0,
	};
}

/** Session content, credentials, and endpoint resolved by Electron main. */
export interface ClientLaunchConfiguration {
	/** Session asset selection; null uses the application default. */
	contentPath: string | null;
	host: string;
	port: number;
	account: string;
	password: string;
	/** Optional developer override for the shared melee pursuit leash, in meters. */
	meleeMaxChaseDistance?: number;
	/** Shared appraisal cooldown and response-timeout bounds forwarded to the native host at startup. */
	appraisalTuning?: ClientHostAppraisalTuningConfig;
	/** Opt-in localhost Live API configuration; omitted when disabled. */
	liveApi?: LiveApiLaunchConfiguration;
}

/** Offline Explorer session configuration resolved by Electron main or the Explorer Launcher. */
export interface ExplorerLaunchConfiguration {
	readonly kind: "explorer";
	/** Session asset selection; null uses the application default. */
	contentPath: string | null;
	/** Optional explicit path to a weenies.hwc catalog file; null uses sibling discovery. */
	weenieCatalogPath: string | null;
	/** Optional initial residence target string; null uses the Explorer default starting location. */
	initialLocation: string | null;
}

/** Discriminated launch configuration consumed by the unified desktop application owner. */
export type DesktopLaunchConfiguration =
	| ({ readonly kind: "client" } & ClientLaunchConfiguration)
	| ExplorerLaunchConfiguration;

export interface ParsedExplorerLaunchArguments {
	readonly startup: ExplorerLaunchConfiguration;
	readonly noLauncher: boolean;
	readonly noUpdates: boolean;
	readonly ignorePersistedConfig: boolean;
	readonly ignoreWorldMapCache: boolean;
	readonly settingsFile: string | null;
	readonly rendererArguments: readonly string[];
}

export interface ParsedClientLaunchArguments {
	readonly startup: ClientLaunchConfiguration | null;
	/** Initial launcher tab when no direct connection is requested. */
	readonly initialLauncherView: "client" | "explorer";
	/** Direct sessions exit on disconnect/cancellation instead of returning to the picker. */
	readonly noLauncher: boolean;
	/** Disable update lookups for this process without changing persisted settings. */
	readonly noUpdates: boolean;
	/** Treat persisted renderer-owned settings as absent without disabling later saves. */
	readonly ignorePersistedConfig: boolean;
	/** Regenerate the map on first request, then reuse it for this host lifetime. */
	readonly ignoreWorldMapCache: boolean;
	/** Resolved path for the collection-format settings file. */
	readonly settingsFile: string | null;
	/** Optional CLI override enabling/configuring the localhost Live API for this process. */
	readonly liveApiOverride: LiveApiCliOverride | null;
	/** Arguments intentionally left for the renderer entry URL (for example --query). */
	readonly rendererArguments: readonly string[];
}

/** Remove Electron's executable and, for unpackaged development, its application path. */
export function electronApplicationArguments(
	argv: readonly string[],
	unpackaged: boolean,
	applicationPath: string,
): readonly string[] {
	if (!unpackaged) return argv.slice(1);
	const appIndex = argv.findIndex(
		(argument, index) =>
			index > 0 &&
			!argument.startsWith("-") &&
			resolve(argument) === resolve(applicationPath),
	);
	if (appIndex < 0)
		throw new Error("Electron development application path is missing");
	return argv.slice(appIndex + 1);
}

/** Identifies client-only connection flags invalid in Explorer mode. */
export function isClientOnlyArgument(argument: string): boolean {
	return isClientOnlyLaunchArgument(argument);
}

/** Identifies Explorer-only flags invalid in Client mode. */
export function isExplorerOnlyArgument(argument: string): boolean {
	return isExplorerOnlyLaunchArgument(argument);
}

/**
 * Resolves shared desktop flags and Explorer-only flags (`--weenie-catalog`, `--location`).
 */
export function parseExplorerLaunchArguments(
	arguments_: readonly string[],
): ParsedExplorerLaunchArguments {
	let weenieCatalogPath: string | null = null;
	let initialLocation: string | null = null;
	let ignorePersistedConfig = false;
	let noLauncher = false;
	let noUpdates = false;
	let ignoreWorldMapCache = false;
	let settingsFile: string | null = null;
	const rendererArguments: string[] = [];
	const seen = new Set<string>();

	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		const parsed = parseExplorerLaunchArgument(argument);
		if (parsed === null) {
			rendererArguments.push(argument);
			continue;
		}
		const { name } = parsed;
		if (seen.has(name))
			throw new Error(
				`Explorer launch argument --${name} was specified more than once`,
			);
		seen.add(name);
		if (name === "no-launcher") {
			if (parsed.value !== undefined)
				throw new Error("--no-launcher does not accept a value");
			noLauncher = true;
			continue;
		}
		if (name === "no-updates") {
			if (parsed.value !== undefined)
				throw new Error("--no-updates does not accept a value");
			noUpdates = true;
			continue;
		}
		if (name === "ignore-config") {
			if (parsed.value !== undefined)
				throw new Error(
					"Explorer launch argument --ignore-config/-i does not accept a value",
				);
			ignorePersistedConfig = true;
			continue;
		}
		if (name === "ignore-world-map-cache") {
			if (parsed.value !== undefined)
				throw new Error("--ignore-world-map-cache does not accept a value");
			ignoreWorldMapCache = true;
			continue;
		}

		let value = parsed.value;
		if (value === undefined) {
			value = arguments_[index + 1];
			if (value === undefined || value.startsWith("-"))
				throw new Error(`Explorer launch argument --${name} requires a value`);
			index += 1;
		}
		if (value.length === 0)
			throw new Error(`Explorer launch argument --${name} cannot be empty`);

		switch (name) {
			case "settings-file":
				settingsFile = resolve(value);
				break;
			case "weenie-catalog":
				weenieCatalogPath = resolve(value);
				break;
			case "location":
				initialLocation = value.trim() || null;
				break;
		}
	}

	return {
		startup: {
			kind: "explorer",
			contentPath: null,
			weenieCatalogPath,
			initialLocation,
		},
		ignorePersistedConfig,
		noLauncher,
		noUpdates,
		ignoreWorldMapCache,
		settingsFile,
		rendererArguments,
	};
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9000;

/**
 * Resolves the TUI-shaped connection flags without copying credentials into an entry URL.
 * `--server` wins over `--host`/`--port`; an explicitly embedded server port must be valid.
 */
export function parseClientLaunchArguments(
	arguments_: readonly string[],
): ParsedClientLaunchArguments {
	let server: string | undefined;
	let host = DEFAULT_HOST;
	let port = DEFAULT_PORT;
	let account: string | undefined;
	let password = "";
	let meleeMaxChaseDistance: number | undefined;
	let initialLauncherView: "client" | "explorer" = "client";
	let ignorePersistedConfig = false;
	let noLauncher = false;
	let noUpdates = false;
	let ignoreWorldMapCache = false;
	let settingsFile: string | null = null;
	let apiEnabled = false;
	let apiPort: number | undefined;
	const rendererArguments: string[] = [];
	const seen = new Set<string>();

	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		const parsed = parseClientLaunchArgument(argument);
		if (parsed === null) {
			rendererArguments.push(argument);
			continue;
		}
		const { name } = parsed;
		if (seen.has(name))
			throw new Error(
				`client launch argument --${name} was specified more than once`,
			);
		seen.add(name);
		if (name === "no-launcher") {
			if (parsed.value !== undefined)
				throw new Error("--no-launcher does not accept a value");
			noLauncher = true;
			continue;
		}
		if (name === "no-updates") {
			if (parsed.value !== undefined)
				throw new Error("--no-updates does not accept a value");
			noUpdates = true;
			continue;
		}
		if (name === "ignore-config") {
			if (parsed.value !== undefined)
				throw new Error(
					"client launch argument --ignore-config/-i does not accept a value",
				);
			ignorePersistedConfig = true;
			continue;
		}

		if (name === "ignore-world-map-cache") {
			if (parsed.value !== undefined)
				throw new Error("--ignore-world-map-cache does not accept a value");
			ignoreWorldMapCache = true;
			continue;
		}
		if (name === "api") {
			if (parsed.value !== undefined)
				throw new Error("--api does not accept a value");
			apiEnabled = true;
			continue;
		}

		let value = parsed.value;
		if (value === undefined) {
			value = arguments_[index + 1];
			if (value === undefined || value.startsWith("-"))
				throw new Error(`client launch argument --${name} requires a value`);
			index += 1;
		}
		if (value.length === 0 && name !== "password")
			throw new Error(`client launch argument --${name} cannot be empty`);

		switch (name) {
			case "settings-file":
				settingsFile = resolve(value);
				break;
			case "server":
				server = value;
				break;
			case "host":
				host = value;
				break;
			case "port":
				port = parsePort(value, "--port");
				break;
			case "account":
				account = value;
				break;
			case "password":
				password = value;
				break;
			case "melee-max-chase-distance":
				meleeMaxChaseDistance = parsePositiveFinite(
					value,
					"--melee-max-chase-distance",
				);
				break;
			case "launcher-view":
				if (value !== "client" && value !== "explorer") {
					throw new Error(
						'client launch argument --launcher-view must be "client" or "explorer"',
					);
				}
				initialLauncherView = value;
				break;
			case "api-port":
				apiEnabled = true;
				apiPort = parsePort(value, "--api-port");
				break;
		}
	}

	const connectionSupplied = [
		"server",
		"host",
		"port",
		"account",
		"password",
		"melee-max-chase-distance",
	].some((name) => seen.has(name));
	if (seen.has("launcher-view") && (noLauncher || connectionSupplied)) {
		throw new Error(
			"--launcher-view cannot be combined with a direct connection or --no-launcher",
		);
	}
	if (noLauncher && account === undefined)
		throw new Error("--no-launcher requires --account");
	if (connectionSupplied && account === undefined)
		throw new Error("client mode requires --account");
	if (server !== undefined) {
		const resolved = parseServer(server, port);
		host = resolved.host;
		port = resolved.port;
	}
	const liveApiOverride: LiveApiCliOverride | null = apiEnabled
		? {
				enabled: true,
				...(apiPort === undefined ? {} : { port: apiPort }),
			}
		: null;
	return {
		startup:
			account === undefined
				? null
				: {
						contentPath: null,
						host,
						port,
						account,
						password,
						...(meleeMaxChaseDistance === undefined
							? {}
							: { meleeMaxChaseDistance }),
					},
		initialLauncherView,
		ignorePersistedConfig,
		noLauncher,
		noUpdates,
		ignoreWorldMapCache,
		settingsFile,
		liveApiOverride,
		rendererArguments,
	};
}

function parseServer(
	value: string,
	defaultPort: number,
): { host: string; port: number } {
	const separator = value.lastIndexOf(":");
	if (separator === -1) return { host: value, port: defaultPort };
	const host = value.slice(0, separator);
	if (host.length === 0)
		throw new Error(`client launch argument --server has an empty host`);
	return { host, port: parsePort(value.slice(separator + 1), "--server") };
}

function parsePort(value: string, argumentName: string): number {
	if (!/^[0-9]+$/.test(value))
		throw new Error(
			`client launch argument ${argumentName} has an invalid port`,
		);
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
		throw new Error(
			`client launch argument ${argumentName} has an invalid port`,
		);
	return port;
}

function parsePositiveFinite(value: string, argumentName: string): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0)
		throw new Error(`${argumentName} must be a finite positive number`);
	return parsed;
}
