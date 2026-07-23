#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { buildEntryPath, requireEntry } from "./entry-paths.mjs";

const [entryName, ...rawArgs] = process.argv.slice(2);

let entry;
let entryPath;
try {
	entry = requireEntry(entryName);
	entryPath = buildEntryPath(entry.path, rawArgs);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

console.info(`Launching ${entryName} Tauri entry at ${entryPath}`);

const workspaceDats = resolve(
	fileURLToPath(new URL("../../../", import.meta.url)),
	"dats",
);
const devEnvironment = { ...process.env };
if (devEnvironment.HOLTBURGER_DATS === undefined && existsSync(workspaceDats)) {
	devEnvironment.HOLTBURGER_DATS = workspaceDats;
}

const config = {
	build: {
		beforeDevCommand: "npm run dev:vite",
	},
	app: {
		windows: [
			{
				label: "main",
				title: entry.title,
				url: entryPath,
				width: 1440,
				height: 900,
				minWidth: 1100,
				minHeight: 700,
				resizable: true,
			},
		],
	},
};
const child = spawn("tauri", ["dev", "--config", JSON.stringify(config)], {
	env: devEnvironment,
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
