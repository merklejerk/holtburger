#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildEntryPath, requireEntry } from "./entry-paths.mjs";

const [entryName, ...rawArgs] = process.argv.slice(2);

let entry;
let openPath;
try {
	entry = requireEntry(entryName);
	openPath = `/${buildEntryPath(entry.path, rawArgs)}`;
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
const viteArgs = [
	viteEntry,
	"--host",
	"127.0.0.1",
	"--port",
	"1420",
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
