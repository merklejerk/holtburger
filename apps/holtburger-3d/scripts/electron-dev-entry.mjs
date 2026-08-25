#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { buildEntryPath, requireEntry } from "./entry-paths.mjs";

const [entryName, ...allArgs] = process.argv.slice(2);
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

const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const workspaceRoot = resolve(appRoot, "../..");
const hostBinary = resolve(
	workspaceRoot,
	"target",
	release ? "release" : "debug",
	process.platform === "win32"
		? "holtburger-3d-host.exe"
		: "holtburger-3d-host",
);
const electronSwitches = [];
const ozonePlatform = process.env.HOLTBURGER_ELECTRON_OZONE_PLATFORM;
if (ozonePlatform !== undefined) {
	if (!new Set(["auto", "wayland", "x11"]).has(ozonePlatform)) {
		throw new Error(`Unsupported Electron ozone platform "${ozonePlatform}".`);
	}
	electronSwitches.push(`--ozone-platform=${ozonePlatform}`);
}
if (process.env.HOLTBURGER_ELECTRON_DISABLE_GPU === "1")
	electronSwitches.push("--disable-gpu");

console.info(`Building ${release ? "release" : "debug"} host sidecar…`);
const hostBuild = spawnSync(
	"cargo",
	[
		"build",
		...(release ? ["--release"] : []),
		"-p",
		"holtburger-3d-host",
		"--bin",
		"holtburger-3d-host",
	],
	{
		cwd: workspaceRoot,
		stdio: "inherit",
		shell: process.platform === "win32",
	},
);
if (hostBuild.status !== 0) process.exit(hostBuild.status ?? 1);
if (!existsSync(hostBinary)) {
	throw new Error(`Cargo did not produce the host sidecar at ${hostBinary}`);
}

const viteEntry = resolve(appRoot, "node_modules", "vite", "bin", "vite.js");
if (!existsSync(viteEntry)) {
	throw new Error(
		`Vite entry point is missing at ${viteEntry}; run npm install first.`,
	);
}
const vite = spawn(
	process.execPath,
	[viteEntry, "--host", "127.0.0.1", "--port", "1420", "--strictPort"],
	{
		cwd: appRoot,
		env: { ...process.env },
		stdio: "inherit",
		shell: false,
	},
);

async function waitForVite() {
	const url = `http://127.0.0.1:1420/${entryPath}`;
	const deadline = Date.now() + 15_000;
	await Promise.race([
		(async () => {
			while (Date.now() < deadline) {
				try {
					const response = await fetch(url);
					if (response.ok) return;
				} catch {
					// Vite is still starting; the bounded deadline turns a real startup failure into an error.
				}
				await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
			}
			throw new Error(`Vite did not serve ${url} within 15 seconds`);
		})(),
		new Promise((_, reject) => {
			vite.once("error", reject);
			vite.once("exit", (code, signal) => {
				reject(
					new Error(
						`Vite exited before startup (code=${code ?? "none"}, signal=${signal ?? "none"})`,
					),
				);
			});
		}),
	]);
}

try {
	await waitForVite();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	vite.kill();
	await waitForExit(vite);
	process.exit(1);
}
if (vite.exitCode !== null || vite.signalCode !== null) {
	throw new Error("Vite exited after its readiness check.");
}

const electronCommand =
	process.platform === "win32" ? "electron.cmd" : "electron";
const electron = spawn(
	electronCommand,
	[
		...electronSwitches,
		".",
		entryName ?? "explorer",
		...rawArgs,
		...(release ? ["--release"] : []),
	],
	{
		cwd: appRoot,
		env: {
			...process.env,
			HOLTBURGER_HOST_BIN: hostBinary,
			HOLTBURGER_DATS:
				process.env.HOLTBURGER_DATS ??
				(existsSync(resolve(workspaceRoot, "dats"))
					? resolve(workspaceRoot, "dats")
					: undefined),
		},
		stdio: "inherit",
		shell: false,
	},
);

const VITE_SHUTDOWN_GRACE_MS = 2_000;
let cleanupStarted = false;

function waitForExit(child) {
	if (child.exitCode !== null || child.signalCode !== null) {
		return Promise.resolve();
	}
	return new Promise((resolvePromise) => child.once("close", resolvePromise));
}

async function stopVite() {
	if (vite.exitCode !== null || vite.signalCode !== null) return;
	const exited = waitForExit(vite);
	vite.kill("SIGTERM");
	const forced = await Promise.race([
		exited.then(() => false),
		new Promise((resolvePromise) =>
			setTimeout(() => resolvePromise(true), VITE_SHUTDOWN_GRACE_MS),
		),
	]);
	if (!forced || vite.exitCode !== null || vite.signalCode !== null) return;
	vite.kill("SIGKILL");
	await exited;
}

async function finish(code, signal) {
	if (cleanupStarted) return;
	cleanupStarted = true;
	await stopVite();
	if (signal !== null) process.kill(process.pid, signal);
	else process.exit(code ?? 1);
}

electron.on("exit", (code, signal) => void finish(code, signal));
electron.on("error", (error) => {
	console.error(`Electron failed to start: ${error.message}`);
	void finish(1, null);
});
vite.on("exit", (code, signal) => {
	if (cleanupStarted) return;
	console.error(
		`Vite exited while Electron was running (code=${code ?? "none"}, signal=${signal ?? "none"}).`,
	);
	electron.kill("SIGTERM");
});

process.on("SIGINT", () => {
	electron.kill("SIGINT");
});

process.on("SIGTERM", () => {
	electron.kill("SIGTERM");
});
