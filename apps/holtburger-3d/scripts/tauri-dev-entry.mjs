#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { buildEntryPath, requireEntry } from "./entry-paths.mjs";

const [entryName, ...allArgs] = process.argv.slice(2);

// Split `--release` out before the rest reach `buildEntryPath`, which turns every remaining flag
// into an entry query parameter. Release only changes the Rust host's optimization level; the
// frontend is served by the same Vite dev server either way.
const release = allArgs.includes("--release");
const rawArgs = allArgs.filter((arg) => arg !== "--release");

let entry;
let entryPath;
try {
	entry = requireEntry(entryName);
	entryPath = buildEntryPath(entry.path, rawArgs);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

console.info(
	`Launching ${entryName} Tauri entry at ${entryPath}${release ? " (release)" : ""}`,
);

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
const tauriArgs = ["dev", "--config", JSON.stringify(config)];
if (release) tauriArgs.push("--release");

const child = spawn("tauri", tauriArgs, {
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
