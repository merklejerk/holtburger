#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCdpClient } from "./cdp-client.mjs";

const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const deadlineMs = 60_000;
const directory = await mkdtemp(join(tmpdir(), "holtburger-settings-probe-"));
const settingsPath = join(directory, "client-settings-sections.json");
const unknownBook = { version: 2, value: { from: "future-build" } };
await writeFile(
	settingsPath,
	JSON.stringify({
		formatVersion: 1,
		user: { hudPlacements: { book: unknownBook } },
		characters: {},
	}),
);

const child = spawn(
	process.platform === "win32" ? "npm.cmd" : "npm",
	[
		"--prefix",
		appRoot,
		"run",
		"dev:client",
		"--",
		"--vite-port",
		"0",
		"--settings-file",
		"client-settings-sections.json",
		"--account",
		"settings-probe",
		"--port",
		"1",
	],
	{
		cwd: directory,
		env: {
			...process.env,
			HOLTBURGER_ELECTRON_REMOTE_DEBUGGING_PORT: "0",
		},
		stdio: ["ignore", "pipe", "pipe"],
	},
);
let output = "";
for (const stream of [child.stdout, child.stderr]) {
	stream.on("data", (chunk) => {
		output += chunk.toString("utf8");
	});
}

let client;
try {
	const browserUrl = await waitFor(
		() => output.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1],
		"Electron DevTools endpoint",
	);
	const { port } = new URL(browserUrl);
	const pageUrl = await waitFor(async () => {
		try {
			const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
				(response) => response.json(),
			);
			return targets.find(
				(target) => target.type === "page" && target.url.includes("/client/"),
			)?.webSocketDebuggerUrl;
		} catch {
			return undefined;
		}
	}, "client page");
	client = await createCdpClient(pageUrl);
	await waitFor(
		() =>
			evaluate(
				client,
				`() => document.querySelector("#app")?.childElementCount > 0`,
			).catch(() => false),
		"client renderer mount",
	);
	const result = await evaluate(
		client,
		`async () => {
			const bridge = window.holtburgerSettings;
			if (!bridge) throw new Error("Settings preload bridge is missing");
			const before = await bridge.loadUser();
			if (!before.unavailable.some((reason) => reason.includes("hudPlacements.book")))
				throw new Error("Future book section was not reported");
			const { createDefaultClientUserSettings } =
				await import("/src/client/client-settings-defaults.ts");
			const defaults = createDefaultClientUserSettings(
				{ width: window.innerWidth, height: window.innerHeight }, 0
			);
			await bridge.saveUserPatch({
				sections: { chatFilters: defaults.chatFilters }
			});
			return { bridgeReady: true, unavailable: before.unavailable };
		}`,
	);
	const collection = JSON.parse(await readFile(settingsPath, "utf8"));
	if (
		JSON.stringify(collection.user.hudPlacements.book) !==
		JSON.stringify(unknownBook)
	)
		throw new Error("A save changed the future book placement");
	if (collection.user.chatFilters?.version !== 1)
		throw new Error(
			"The preload save did not reach the selected settings file",
		);
	console.log(
		JSON.stringify({ ok: true, ...result, settingsPath: "temporary" }),
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	console.error(output.slice(-8_000));
	process.exitCode = 1;
} finally {
	client?.close();
	if (child.exitCode === null && child.signalCode === null) {
		const stopped = new Promise((resolvePromise) =>
			child.once("close", resolvePromise),
		);
		child.kill("SIGTERM");
		await stopped;
	}
	await rm(directory, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
}

async function waitFor(readValue, description) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < deadlineMs) {
		const value = await readValue();
		if (value) return value;
		if (child.exitCode !== null || child.signalCode !== null)
			throw new Error(`Electron exited before ${description} was available`);
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	throw new Error(`Timed out waiting for ${description}`);
}

async function evaluate(cdp, expression) {
	const response = await cdp.send("Runtime.evaluate", {
		expression: `(${expression})()`,
		awaitPromise: true,
		returnByValue: true,
	});
	if (response.exceptionDetails)
		throw new Error(
			response.exceptionDetails.exception?.description ??
				response.exceptionDetails.text,
		);
	return response.result.value;
}
