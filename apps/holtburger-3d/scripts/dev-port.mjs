/// <reference types="node" />

import net from "node:net";

/**
 * Parses a Vite port while preserving zero as the explicit request for a random ephemeral port.
 * @param {string | number} value
 * @param {string} [label]
 * @returns {number}
 */
export function parseVitePort(value, label = "--vite-port") {
	if (!/^[0-9]+$/.test(String(value))) {
		throw new Error(`${label} must be an integer from 0 to 65535.`);
	}
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
		throw new Error(`${label} must be an integer from 0 to 65535.`);
	}
	return port;
}

/**
 * Resolves an explicit Vite port or selects a free loopback port when no port was requested.
 *
 * The caller starts Vite immediately after this probe with `--strictPort`; the short release/
 * launch window is still guarded by Vite's own bind check, while avoiding a fixed cross-worktree
 * default in the normal path.
 * @param {string | number | undefined} requestedPort
 * @param {string | number | undefined} [environmentPort]
 * @returns {Promise<number>}
 */
export async function resolveVitePort(
	requestedPort,
	environmentPort = process.env.HOLTBURGER_VITE_PORT,
) {
	const rawPort = requestedPort ?? environmentPort;
	const parsed =
		rawPort === undefined
			? 0
			: parseVitePort(
					rawPort,
					requestedPort === undefined ? "HOLTBURGER_VITE_PORT" : "--vite-port",
				);
	return parsed === 0 ? findAvailablePort() : parsed;
}

/**
 * Returns one currently free TCP port on the requested loopback host.
 * @param {string} [host]
 * @returns {Promise<number>}
 */
export function findAvailablePort(host = "127.0.0.1") {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, host, () => {
			const address = server.address();
			if (typeof address !== "object" || address === null) {
				server.close(() =>
					reject(new Error("Could not determine the ephemeral Vite port.")),
				);
				return;
			}
			server.close((error) => {
				if (error) reject(error);
				else resolve(address.port);
			});
		});
	});
}
