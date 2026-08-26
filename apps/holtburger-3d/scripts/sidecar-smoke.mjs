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
async function smokeMode(mode) {
	const child = spawn(hostPath, [`--mode=${mode}`], {
		env: { ...process.env, HOLTBURGER_DATS: emptyContentDirectory },
		stdio: "pipe",
		windowsHide: true,
	});
	const exited = waitForExit(child);
	let stderr = "";
	child.stderr.on("data", (chunk) => {
		stderr += chunk.toString();
	});
	const client = new SidecarHostClient(child, mode);

	try {
		await client.connect();
		if (mode === "client") {
			// Client startup needs a real DAT bootstrap and server; this smoke intentionally
			// injects an empty repository, so verify mode admission without opening a socket.
			await expectModeRejection(client, "explorer_catalog_capability");
		} else {
			await expectModeRejection(client, "start_client", {
				startup: {
					host: "127.0.0.1",
					port: 9000,
					account: "smoke",
					password: "",
				},
			});
		}
		const status = await client.invoke("host_status");
		if (
			status?.appName !== "holtburger-3d" ||
			status?.status !== `${mode}-host-ready`
		) {
			throw new Error(
				`unexpected ${mode} host status: ${JSON.stringify(status)}`,
			);
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
		return { mode, status, shutdown: "clean" };
	} catch (error) {
		const diagnostic = stderr.trim();
		throw new Error(
			`${mode} sidecar smoke failed${diagnostic.length === 0 ? "" : `: ${diagnostic}`}`,
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
	}
}

async function expectModeRejection(client, command, args) {
	try {
		await client.invoke(command, args);
		throw new Error(`host accepted unavailable command ${command}`);
	} catch (error) {
		if (error?.code !== "mode_command_unavailable") throw error;
	}
}

try {
	const results = [];
	for (const mode of ["explorer", "client"])
		results.push(await smokeMode(mode));
	console.log(
		JSON.stringify({
			binary: basename(hostPath),
			platform: process.platform,
			architecture: process.arch,
			modes: results,
		}),
	);
} finally {
	await rm(emptyContentDirectory, { force: true, recursive: true });
}
