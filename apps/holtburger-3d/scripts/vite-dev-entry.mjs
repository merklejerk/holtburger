#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	buildEntryPath,
	extractVitePortArguments,
	requireEntry,
	stripClientLaunchArguments,
} from "./entry-paths.mjs";
import { resolveVitePort } from "./dev-port.mjs";

const [entryName, ...allArgs] = process.argv.slice(2);

let entry;
let openPath;
let requestedVitePort;
try {
	entry = requireEntry(entryName);
	const extracted = extractVitePortArguments(allArgs, { allowPortAlias: true });
	requestedVitePort = extracted.vitePort;
	const rendererArgs =
		entryName === "client"
			? stripClientLaunchArguments(extracted.args)
			: extracted.args;
	openPath = `/${buildEntryPath(entry.path, rendererArgs)}`;
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

console.info(`Launching ${entryName} Vite entry at ${openPath}`);

const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const viteEntry = resolve(appRoot, "node_modules", "vite", "bin", "vite.js");
if (!existsSync(viteEntry)) {
	throw new Error(
		`Vite entry point is missing at ${viteEntry}; run npm install first.`,
	);
}
const vitePort = await resolveVitePort(requestedVitePort);
console.info(`Using Vite port ${vitePort}`);
const viteArgs = [
	viteEntry,
	"--host",
	"127.0.0.1",
	"--port",
	String(vitePort),
	"--strictPort",
	"--open",
	openPath,
];
const child = spawn(process.execPath, viteArgs, {
	stdio: "inherit",
	shell: false,
});

child.on("exit", (code, signal) => {
	if (signal !== null) {
		process.kill(process.pid, signal);
		return;
	}

	process.exit(code ?? 1);
});
