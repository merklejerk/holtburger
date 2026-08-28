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
]);

function isKnownEntry(value) {
	return Object.hasOwn(ENTRY_PATHS, value);
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

/**
 * Removes the client connection arguments before a renderer URL is assembled.
 *
 * These values belong to Electron main and must not become query parameters. Both `--name=value`
 * and `--name value` forms are accepted here so the wrapper cannot reject a valid client launch
 * before `parseClientLaunchArguments` gets to validate it.
 */
export function partitionClientLaunchArguments(args) {
	const launchArguments = [];
	const rendererArgs = [];
	for (let index = 0; index < args.length; index += 1) {
		const parsed = parseLongArgument(args[index]);
		if (!CLIENT_LAUNCH_ARGUMENT_NAMES.has(parsed.name)) {
			rendererArgs.push(args[index]);
			continue;
		}
		launchArguments.push(args[index]);
		if (parsed.value === undefined) {
			const value = args[index + 1];
			if (value === undefined || value.startsWith("--")) {
				throw new Error(`${args[index]} requires a value.`);
			}
			launchArguments.push(value);
			index += 1;
		}
	}
	return { launchArguments, rendererArguments: rendererArgs };
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
		`Unknown dev entry "${value ?? ""}". Expected one of: ${knownEntries}.`,
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
