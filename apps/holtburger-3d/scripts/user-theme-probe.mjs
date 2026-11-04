import { createServer } from "vite";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import electron from "electron";

const packageRootIndex = process.argv.indexOf("--package-root");
const packageRoot =
	packageRootIndex < 0 ? undefined : process.argv[packageRootIndex + 1];
if (packageRootIndex >= 0 && packageRoot === undefined)
	throw new Error("Missing --package-root value");
const appRoot = resolve(import.meta.dirname, "..");
const server = await createServer({
	root: appRoot,
	server: { host: "127.0.0.1", port: 0, strictPort: true },
});
// The parent owns cleanup after Electron exits and releases its Chromium profile files.
const directory = await mkdtemp(join(tmpdir(), "holtburger-user-theme-probe-"));
try {
	await server.listen();
	const origin = server.resolvedUrls?.local[0];
	if (origin === undefined) throw new Error("Probe server has no local URL");
	const child = spawn(
		electron,
		[
			resolve(appRoot, "dist-electron/electron/ui-theme-probe.js"),
			`--probe-origin=${origin.replace(/\/$/, "")}`,
			`--probe-directory=${directory}`,
			...(packageRoot === undefined
				? []
				: [`--probe-package-root=${resolve(packageRoot)}`]),
		],
		{ cwd: appRoot, stdio: "inherit" },
	);
	const timeout = setTimeout(() => {
		console.error("User theme probe timed out");
		child.kill();
	}, 120_000);
	try {
		const [code] = await once(child, "close");
		if (code !== 0)
			throw new Error(`User theme Electron probe exited with code ${code}`);
	} finally {
		clearTimeout(timeout);
	}
} finally {
	await server.close();
	await rm(directory, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
}
