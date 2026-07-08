#!/usr/bin/env node
import { spawn } from "node:child_process";

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

const viteArgs = ["--host", "127.0.0.1", "--port", "1420", "--strictPort", "--open", openPath];
const child = spawn("vite", viteArgs, {
	stdio: "inherit",
	shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
	if (signal !== null) {
		process.kill(process.pid, signal);
		return;
	}

	process.exit(code ?? 1);
});
