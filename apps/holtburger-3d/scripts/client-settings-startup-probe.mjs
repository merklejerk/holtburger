#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCdpClient } from "./cdp-client.mjs";

const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const deadlineMs = 60_000;
const directory = await mkdtemp(join(tmpdir(), "holtburger-settings-probe-"));
const settingsPath = join(directory, "client-settings-sections.json");
const savedCharacterSheet = {
	horizontal: { alignment: "start", offset: 73 },
	vertical: { alignment: "start", offset: 82 },
	preferredWidth: 620,
	preferredHeight: 640,
};
const unknownBook = { version: 2, value: { from: "future-build" } };
/** Test-owned nondefault scale and fonts must be present on the first mounted client UI. */
const savedUi = {
	fonts: { body: "mono", heading: "serif", mono: "sans" },
	textScale: 1.5,
	iconScale: 1.75,
};
await writeFile(
	settingsPath,
	JSON.stringify({
		formatVersion: 1,
		user: {
			ui: {
				version: 1,
				value: {
					...savedUi,
					fonts: { ...savedUi.fonts, heading: "retired-font" },
					retiredTheme: true,
				},
			},
			hudPlacements: {
				book: unknownBook,
				characterSheet: { version: 1, value: savedCharacterSheet },
			},
		},
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
		"--debug-port=0",
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
		env: { ...process.env },
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
				`() => document.querySelector(".client-appearance-scope") !== null`,
			).catch(() => false),
		"client settings bootstrap and appearance mount",
	);
	const result = await evaluate(
		client,
		`async () => {
			const bridge = window.holtburgerSettings;
			if (!bridge) throw new Error("Settings preload bridge is missing");
			const themes = window.holtburgerThemes;
			if (!themes || !Array.isArray(await themes.list())) throw new Error("Theme discovery preload bridge is missing");
			const { createDefaultClientUserSettings } =
				await import("/src/client/client-settings-defaults.ts");
			const defaults = createDefaultClientUserSettings(
				{ width: window.innerWidth, height: window.innerHeight }, 0
			);
			const before = await bridge.loadUser(defaults);
			if (before.repaired.length !== 0)
				throw new Error("Startup repair was repeated on the second load");
			if (before.sections.ui.fonts.heading !== defaults.ui.fonts.heading ||
				before.sections.ui.fonts.body !== "mono")
				throw new Error("Startup repair did not preserve valid sibling preferences");
			const expectedUi = ${JSON.stringify(savedUi)};
			if (before.sections.ui.themeId !== null) throw new Error("Older UI preferences did not restore Base");
			if (before.sections.ui?.textScale !== expectedUi.textScale)
				throw new Error("Saved text scale did not cross the preload bridge");
			const scope = document.querySelector('.client-appearance-scope');
			if (!scope || Number(scope.style.getPropertyValue('--ui-text-scale')) !== expectedUi.textScale)
				throw new Error("Client mounted without the saved appearance scope");
			if (before.sections.ui?.iconScale !== expectedUi.iconScale)
				throw new Error('Persisted icon scale did not reach startup settings');
			if (Number(scope.style.getPropertyValue('--ui-icon-scale')) !== expectedUi.iconScale)
				throw new Error('Client appearance did not apply persisted icon scale');

			const authoredSize = Number.parseFloat(getComputedStyle(scope).getPropertyValue('--ui-font-size-body'));
			if (Math.abs(Number.parseFloat(getComputedStyle(scope).fontSize) - authoredSize * expectedUi.textScale) > 0.02)
				throw new Error("Client startup did not apply the restored text scale");
			if (!before.unavailable.some((reason) => reason.includes("hudPlacements.book")))
				throw new Error("Future book section was not reported");
			const expectedPanel = ${JSON.stringify(savedCharacterSheet)};
			if (JSON.stringify(before.hudPlacements.characterSheet) !== JSON.stringify(expectedPanel))
				throw new Error("Character panel placement did not cross the preload bridge");
			await bridge.saveUserPatch({
				sections: { chatFilters: defaults.chatFilters },
				hudPlacements: { characterSheet: { ...expectedPanel, preferredWidth: 700 } }
			});
			return { bridgeReady: true, themesReady: true, unavailable: before.unavailable };
		}`,
	);
	const collection = JSON.parse(await readFile(settingsPath, "utf8"));
	if ("retiredTheme" in collection.user.ui.value)
		throw new Error("Startup repair left a retired setting on disk");
	const backups = (await readdir(directory)).filter((name) =>
		name.includes(".backup-"),
	);
	if (backups.length !== 1)
		throw new Error(
			"Startup repair did not retain exactly one original backup",
		);
	if (
		JSON.stringify(collection.user.hudPlacements.book) !==
		JSON.stringify(unknownBook)
	)
		throw new Error("A save changed the future book placement");
	if (
		collection.user.hudPlacements.characterSheet?.value.preferredWidth !== 700
	)
		throw new Error(
			"Character panel placement save did not reach the selected file",
		);
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
