import { resolve } from "node:path";

const ENTRY_PATHS = {
	explorer: {
		path: "explorer/index.html",
		title: "Holtburger 3D Explorer",
	},
	client: {
		path: "client/index.html",
		title: "Holtburger 3D Client",
	},
};

const CLIENT_LAUNCH_ARGUMENT_NAMES = new Set([
	"server",
	"host",
	"port",
	"account",
	"password",
	"melee-max-chase-distance",
	"ignore-config",
	"ignore-world-map-cache",
	"settings-file",
]);
const CLIENT_SHORT_ARGUMENT_NAMES = new Map([
	["s", "server"],
	["h", "host"],
	["p", "port"],
	["a", "account"],
	["P", "password"],
	["i", "ignore-config"],
]);
const CLIENT_BOOLEAN_ARGUMENT_NAMES = new Set([
	"ignore-config",
	"ignore-world-map-cache",
]);

function isKnownEntry(value) {
	return Object.hasOwn(ENTRY_PATHS, value);
}

/** An omitted positional entry selects the client, including launches starting with short flags. */
export function extractEntryArguments(args) {
	const explicit = args[0] !== undefined && !args[0].startsWith("-");
	const name = explicit ? args[0] : "client";
	requireEntry(name);
	return { name, args: explicit ? args.slice(1) : args };
}

/** Consume shared content selection before entry, client, or renderer argument parsing. */
export function extractContentArguments(args, invocationDirectory) {
	let contentPath = null;
	const flags = new Set();
	const remaining = [];
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--no-content-search" || argument === "--clear-content") {
			if (flags.has(argument))
				throw new Error(`${argument} was specified more than once`);
			flags.add(argument);
			continue;
		}
		if (
			argument.startsWith("--no-content-search=") ||
			argument.startsWith("--clear-content=")
		)
			throw new Error(`${argument.split("=", 1)[0]} does not take a value`);
		if (argument !== "--content" && !argument.startsWith("--content=")) {
			remaining.push(argument);
			continue;
		}
		if (contentPath !== null)
			throw new Error("--content was specified more than once");
		const value =
			argument === "--content"
				? args[++index]
				: argument.slice("--content=".length);
		if (value === undefined || value.length === 0 || value.startsWith("--"))
			throw new Error("--content requires a nonempty path");
		contentPath = resolve(invocationDirectory, value);
	}
	return {
		contentPath,
		noContentSearch: flags.has("--no-content-search"),
		clearContent: flags.has("--clear-content"),
		args: remaining,
	};
}

export function buildEntryPath(basePath, args) {
	const params = new URLSearchParams();

	for (const arg of args) {
		if (arg.startsWith("--query=")) {
			appendQuery(params, arg.slice("--query=".length));
			continue;
		}

		if (!arg.startsWith("--")) {
			throw new Error(
				`Unsupported positional argument "${arg}". Use --name=value.`,
			);
		}

		const withoutPrefix = arg.slice(2);
		const separatorIndex = withoutPrefix.indexOf("=");
		const key =
			separatorIndex === -1
				? withoutPrefix
				: withoutPrefix.slice(0, separatorIndex);
		const value =
			separatorIndex === -1 ? "true" : withoutPrefix.slice(separatorIndex + 1);

		if (key.length === 0) {
			throw new Error(`Invalid empty parameter in "${arg}".`);
		}

		params.append(key, value);
	}

	const query = params.toString();
	return query.length === 0 ? basePath : `${basePath}?${query}`;
}

/**
 * Collapses renderer flags into one application-owned query argument.
 *
 * Electron interprets some flags (notably `--debug`) even when they follow the application path.
 * Encoding renderer state under `--query` prevents those flags from leaking into Electron's CLI
 * while preserving the entry URL assembled by `buildEntryPath`.
 */
export function collapseRendererArguments(args) {
	const queryPath = buildEntryPath("", args);
	return queryPath.length === 0 ? [] : [`--query=${queryPath.slice(1)}`];
}

/** Default Chrome DevTools port when renderer diagnostics are enabled. */
const DEFAULT_DEBUG_PORT = 9222;

/** Consume shell flags and translate the effective debug query after client arguments are partitioned. */
export function extractElectronLaunchArguments(args) {
	const remainingArgs = [];
	const switches = new Set();
	let debugPort;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		const parsed = parseLongArgument(argument);
		if (parsed.name === "dev") {
			// Keep renderer diagnostics on their existing query contract in both launch paths.
			remainingArgs.push(
				parsed.value === undefined ? "--debug" : `--debug=${parsed.value}`,
			);
			continue;
		}
		if (parsed.name === "debug-port") {
			if (debugPort !== undefined) {
				throw new Error("Debug port was specified more than once.");
			}
			let value = parsed.value;
			if (value === undefined) {
				value = args[index + 1];
				if (value === undefined || value.startsWith("--")) {
					throw new Error("--debug-port requires a value.");
				}
				index += 1;
			}
			const port = Number(value);
			if (
				!/^(0|[1-9][0-9]*)$/.test(value) ||
				!Number.isSafeInteger(port) ||
				port > 65_535
			) {
				throw new Error("--debug-port must be an integer from 0 to 65535.");
			}
			debugPort = port;
			continue;
		}
		if (parsed.name !== "uncapped") {
			remainingArgs.push(argument);
			continue;
		}
		if (parsed.value !== undefined) {
			throw new Error("--uncapped does not accept a value.");
		}
		switches.add("--disable-frame-rate-limit");
		switches.add("--disable-gpu-vsync");
	}
	// Use the same query assembly and first-value semantics as the renderer diagnostics flag.
	const query = new URLSearchParams(buildEntryPath("", remainingArgs));
	if (debugPort !== undefined || query.get("debug") === "true") {
		switches.add(`--remote-debugging-port=${debugPort ?? DEFAULT_DEBUG_PORT}`);
	}
	return { args: remainingArgs, electronSwitches: [...switches] };
}

/**
 * Removes the client connection arguments before a renderer URL is assembled.
 *
 * These values belong to Electron main and must not become query parameters. Long and abbreviated
 * inline/separated forms are accepted here so the wrapper cannot reject a valid client launch
 * before `parseClientLaunchArguments` gets to validate it.
 */
export function partitionClientLaunchArguments(
	args,
	settingsDirectory = process.cwd(),
) {
	const launchArguments = [];
	const rendererArgs = [];
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		const parsed = parseClientLaunchArgument(argument);
		if (parsed === null) {
			rendererArgs.push(argument);
			continue;
		}
		if (CLIENT_BOOLEAN_ARGUMENT_NAMES.has(parsed.name)) {
			if (parsed.value !== undefined) {
				throw new Error(`${argument} does not accept a value.`);
			}
			launchArguments.push(argument);
			continue;
		}
		let value = parsed.value;
		if (value === undefined) {
			value = args[index + 1];
			if (value === undefined || value.startsWith("-")) {
				throw new Error(`${argument} requires a value.`);
			}
			index += 1;
		}
		if (parsed.name === "settings-file") {
			if (value.length === 0) throw new Error(`${argument} cannot be empty.`);
			launchArguments.push(
				"--settings-file",
				resolve(settingsDirectory, value),
			);
		} else {
			launchArguments.push(argument);
			if (parsed.value === undefined) launchArguments.push(value);
		}
	}
	return { launchArguments, rendererArguments: rendererArgs };
}

/** Resolve a canonical client option name from either its long or one-character spelling. */
export function parseClientLaunchArgument(argument) {
	let parsed;
	if (argument.startsWith("--")) {
		parsed = parseLongArgument(argument);
		if (!CLIENT_LAUNCH_ARGUMENT_NAMES.has(parsed.name)) return null;
	} else {
		const match = /^-([^-=])(?:=(.*))?$/.exec(argument);
		if (match === null) return null;
		const name = CLIENT_SHORT_ARGUMENT_NAMES.get(match[1]);
		if (name === undefined) return null;
		parsed = { name, value: match[2] };
	}
	return parsed;
}

export function stripClientLaunchArguments(args) {
	return partitionClientLaunchArguments(args).rendererArguments;
}

/**
 * Extracts the Vite-facing port from a development wrapper's arguments.
 *
 * `--vite-port` is intentionally distinct from the client's ACE server `--port`. Vite-only
 * wrappers may opt into `--port` as an ergonomic alias because they have no server endpoint flag.
 */
export function extractVitePortArguments(
	args,
	{ allowPortAlias = false } = {},
) {
	const remainingArgs = [];
	let vitePort;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		const parsed = parseLongArgument(argument);
		const isVitePort =
			parsed.name === "vite-port" || (allowPortAlias && parsed.name === "port");
		if (!isVitePort) {
			remainingArgs.push(argument);
			continue;
		}
		if (vitePort !== undefined) {
			throw new Error("Vite port was specified more than once.");
		}
		vitePort = parsed.value;
		if (vitePort === undefined) {
			vitePort = args[index + 1];
			if (vitePort === undefined || vitePort.startsWith("--")) {
				throw new Error(`${argument} requires a value.`);
			}
			index += 1;
		}
	}
	return { args: remainingArgs, vitePort };
}

export function requireEntry(value) {
	if (isKnownEntry(value)) {
		return ENTRY_PATHS[value];
	}

	const knownEntries = Object.keys(ENTRY_PATHS).join(", ");
	throw new Error(
		`Unknown application entry "${value ?? ""}". Expected one of: ${knownEntries}.`,
	);
}

function appendQuery(params, query) {
	const queryParams = new URLSearchParams(
		query.startsWith("?") ? query.slice(1) : query,
	);

	for (const [key, value] of queryParams.entries()) {
		params.append(key, value);
	}
}

function parseLongArgument(argument) {
	if (!argument.startsWith("--")) return { name: "", value: undefined };
	const withoutPrefix = argument.slice(2);
	const separatorIndex = withoutPrefix.indexOf("=");
	return {
		name:
			separatorIndex === -1
				? withoutPrefix
				: withoutPrefix.slice(0, separatorIndex),
		value:
			separatorIndex === -1
				? undefined
				: withoutPrefix.slice(separatorIndex + 1),
	};
}
