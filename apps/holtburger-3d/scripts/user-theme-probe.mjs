import { createServer } from "vite";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
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
try {
	await server.listen();
	const origin = server.resolvedUrls?.local[0];
	if (origin === undefined) throw new Error("Probe server has no local URL");
	const child = spawn(
		electron,
		[
			resolve(appRoot, "dist-electron/electron/ui-theme-probe.js"),
			`--probe-origin=${origin.replace(/\/$/, "")}`,
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
		const [code] = await once(child, "exit");
		if (code !== 0)
			throw new Error(`User theme Electron probe exited with code ${code}`);
	} finally {
		clearTimeout(timeout);
	}
} finally {
	await server.close();
}
