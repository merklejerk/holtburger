import { parseClientLaunchArgument } from "../scripts/entry-paths.mjs";

/** Launch-only credentials and endpoint resolved by Electron main. */
export interface ClientLaunchConfiguration {
	host: string;
	port: number;
	account: string;
	password: string;
	/** Optional developer override for the shared melee pursuit leash, in meters. */
	meleeMaxChaseDistance?: number;
}

export interface ParsedClientLaunchArguments {
	readonly startup: ClientLaunchConfiguration;
	/** Treat persisted renderer-owned settings as absent without disabling later saves. */
	readonly ignorePersistedConfig: boolean;
	/** Arguments intentionally left for the renderer entry URL (for example --query). */
	readonly rendererArguments: readonly string[];
}

/** Remove Electron's executable and, for default-app development, its application path. */
export function electronApplicationArguments(
	argv: readonly string[],
	defaultApp: boolean,
): readonly string[] {
	return argv.slice(defaultApp ? 2 : 1);
}

/** Identifies flags reserved for the client launch contract before entry-query construction. */
export function isClientLaunchArgument(argument: string): boolean {
	return parseClientLaunchArgument(argument) !== null;
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
	let ignorePersistedConfig = false;
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
		if (name === "ignore-config") {
			if (parsed.value !== undefined)
				throw new Error(
					"client launch argument --ignore-config/-i does not accept a value",
				);
			ignorePersistedConfig = true;
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
		}
	}

	if (account === undefined) throw new Error("client mode requires --account");
	if (server !== undefined) {
		const resolved = parseServer(server, port);
		host = resolved.host;
		port = resolved.port;
	}
	return {
		startup: {
			host,
			port,
			account,
			password,
			...(meleeMaxChaseDistance === undefined ? {} : { meleeMaxChaseDistance }),
		},
		ignorePersistedConfig,
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
