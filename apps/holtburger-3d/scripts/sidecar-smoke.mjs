#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SidecarHostClient } from "../dist-electron/electron/host-protocol.js";

const EXIT_TIMEOUT_MS = 5_000;
const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const hostExecutable =
	process.platform === "win32"
		? "holtburger-3d-host.exe"
		: "holtburger-3d-host";
const hostPath = resolve(
	process.env.HOLTBURGER_HOST_BIN ??
		join(appRoot, "../../target/release", hostExecutable),
);

function waitForExit(child) {
	return new Promise((resolvePromise, rejectPromise) => {
		child.once("error", rejectPromise);
		child.once("exit", (code, signal) => resolvePromise({ code, signal }));
	});
}

async function withTimeout(promise, timeoutMs, message) {
	let timeout;
	try {
		return await Promise.race([
			promise,
			new Promise((_, rejectPromise) => {
				timeout = setTimeout(
					() => rejectPromise(new Error(message)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		clearTimeout(timeout);
	}
}

await access(hostPath, constants.X_OK);
const emptyContentDirectory = await mkdtemp(
	join(tmpdir(), "holtburger-3d-sidecar-smoke-"),
);
const child = spawn(hostPath, [], {
	env: { ...process.env, HOLTBURGER_DATS: emptyContentDirectory },
	stdio: "pipe",
	windowsHide: true,
});
const exited = waitForExit(child);
let stderr = "";
child.stderr.on("data", (chunk) => {
	stderr += chunk.toString();
});
const client = new SidecarHostClient(child);

try {
	await client.connect();
	const status = await client.invoke("host_status");
	if (
		status?.appName !== "holtburger-3d" ||
		status?.status !== "landblock-source-batch-host-ready"
	) {
		throw new Error(`unexpected host status: ${JSON.stringify(status)}`);
	}
	await client.shutdown();
	const result = await withTimeout(
		exited,
		EXIT_TIMEOUT_MS,
		"host did not exit after acknowledging shutdown",
	);
	if (result.code !== 0 || result.signal !== null) {
		throw new Error(
			`host exited uncleanly (code=${result.code ?? "none"}, signal=${result.signal ?? "none"})`,
		);
	}
	console.log(
		JSON.stringify({
			binary: basename(hostPath),
			platform: process.platform,
			architecture: process.arch,
			status,
			shutdown: "clean",
		}),
	);
} catch (error) {
	const diagnostic = stderr.trim();
	throw new Error(
		`sidecar smoke failed${diagnostic.length === 0 ? "" : `: ${diagnostic}`}`,
		{ cause: error },
	);
} finally {
	if (child.exitCode === null && child.signalCode === null) {
		child.kill();
		await withTimeout(
			exited.catch(() => undefined),
			EXIT_TIMEOUT_MS,
			"host did not exit after forced smoke cleanup",
		);
	}
	await rm(emptyContentDirectory, { force: true, recursive: true });
}
