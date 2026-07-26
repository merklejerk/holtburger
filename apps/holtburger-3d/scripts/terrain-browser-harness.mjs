#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_CHROME_PATH = "/opt/google/chrome/chrome";
const DEFAULT_VITE_URL = "http://127.0.0.1:1420";
const READY_KIND = "holtburger-3d-dev-landblock-content-host-ready";
const DEFAULT_LANDBLOCK_ID = "0xda55ffff";
const DEFAULT_SETTLE_MS = 10_000;
const workspaceDats = resolve(
	fileURLToPath(new URL("../../../", import.meta.url)),
	"dats",
);
const childEnvironment = { ...process.env };
if (
	childEnvironment.HOLTBURGER_DATS === undefined &&
	existsSync(workspaceDats)
) {
	childEnvironment.HOLTBURGER_DATS = workspaceDats;
}

const options = parseArgs(process.argv.slice(2));
const children = [];
const tempDirectories = [];

try {
	const contentHostUrl = await startContentHost();
	const viteUrl = await startViteServer();
	const result = await runHarness({ contentHostUrl, viteUrl });
	const browserErrors = result.consoleMessages.filter(
		({ level }) => level === "error" || level === "exception",
	);
	if (options.screenshotPath) {
		await writeFile(
			options.screenshotPath,
			Buffer.from(result.screenshot, "base64"),
		);
	}
	process.stdout.write(
		`${JSON.stringify(
			{
				buildingRadius: options.buildingRadius,
				cameraPitchDegrees: options.cameraPitchDegrees,
				cameraYawDegrees: options.cameraYawDegrees,
				explicitObjectRadius: options.explicitObjectRadius,
				generatedObjectRadius: options.generatedObjectRadius,
				cameraLandblockId: options.cameraLandblockId,
				relocateLandblockId: options.relocateLandblockId,
				consoleMessages: result.consoleMessages,
				generatedDisabledState: result.generatedDisabledState,
				fixture: options.fixture,
				frames: result.state.frames,
				initialState: result.initialState,
				landblockId: options.landblockId,
				lifecycleState: result.lifecycleState,
				relocationState: result.relocationState,
				metrics: result.state.metrics,
				ready: result.state.ready,
				screenshotPath: options.screenshotPath,
				settleMs: options.settleMs,
			},
			null,
			2,
		)}\n`,
	);
	if (result.state.error) {
		throw new Error(
			`Terrain harness reported startup failure: ${result.state.error}`,
		);
	}
	if (browserErrors.length > 0) {
		throw new Error(
			`Terrain harness observed browser errors: ${browserErrors.map(({ text }) => text).join(" | ")}`,
		);
	}
} finally {
	await Promise.allSettled(children.toReversed().map(stopChild));
	await Promise.allSettled(
		tempDirectories.map((directory) =>
			rm(directory, { force: true, recursive: true }),
		),
	);
}

function parseArgs(args) {
	const parsed = {
		chromePath: process.env.CHROME_PATH ?? DEFAULT_CHROME_PATH,
		landblockId: DEFAULT_LANDBLOCK_ID,
		buildingRadius: 0,
		cameraPitchDegrees: -45,
		cameraYawDegrees: 0,
		explicitObjectRadius: null,
		generatedObjectRadius: null,
		disableGeneratedBeforeCapture: false,
		cameraLandblockId: null,
		relocateLandblockId: null,
		lifecycle: false,
		fixture: null,
		screenshotPath: null,
		settleMs: DEFAULT_SETTLE_MS,
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--chrome-path":
				parsed.chromePath = requireValue(args, ++index, arg);
				break;
			case "--landblock":
				parsed.landblockId = requireValue(args, ++index, arg);
				break;
			case "--building-radius":
				parsed.buildingRadius = Number(requireValue(args, ++index, arg));
				if (
					!Number.isInteger(parsed.buildingRadius) ||
					parsed.buildingRadius < 0
				) {
					throw new Error("--building-radius must be a non-negative integer.");
				}
				break;
			case "--explicit-object-radius":
				parsed.explicitObjectRadius = Number(requireValue(args, ++index, arg));
				if (
					!Number.isInteger(parsed.explicitObjectRadius) ||
					parsed.explicitObjectRadius < 0
				) {
					throw new Error(
						"--explicit-object-radius must be a non-negative integer.",
					);
				}
				break;
			case "--generated-object-radius":
				parsed.generatedObjectRadius = Number(requireValue(args, ++index, arg));
				if (
					!Number.isInteger(parsed.generatedObjectRadius) ||
					parsed.generatedObjectRadius < 0
				) {
					throw new Error(
						"--generated-object-radius must be a non-negative integer.",
					);
				}
				break;
			case "--disable-generated-before-capture":
				parsed.disableGeneratedBeforeCapture = true;
				break;
			case "--camera-landblock":
				parsed.cameraLandblockId = requireValue(args, ++index, arg);
				break;
			case "--relocate-landblock":
				parsed.relocateLandblockId = requireValue(args, ++index, arg);
				break;
			case "--camera-yaw":
				parsed.cameraYawDegrees = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(parsed.cameraYawDegrees)) {
					throw new Error("--camera-yaw must be finite.");
				}
				break;
			case "--camera-pitch":
				parsed.cameraPitchDegrees = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(parsed.cameraPitchDegrees)) {
					throw new Error("--camera-pitch must be finite.");
				}
				break;
			case "--lifecycle":
				parsed.lifecycle = true;
				break;
			case "--fixture":
				parsed.fixture = requireValue(args, ++index, arg);
				if (!["blended", "instanced"].includes(parsed.fixture)) {
					throw new Error("--fixture must be either blended or instanced.");
				}
				break;
			case "--screenshot":
				parsed.screenshotPath = requireValue(args, ++index, arg);
				break;
			case "--settle-ms":
				parsed.settleMs = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(parsed.settleMs) || parsed.settleMs < 0) {
					throw new Error("--settle-ms must be a non-negative number.");
				}
				break;
			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
				return parsed;
			default:
				throw new Error(`Unsupported argument ${arg}.`);
		}
	}
	if (
		parsed.explicitObjectRadius !== null &&
		parsed.explicitObjectRadius > parsed.buildingRadius
	) {
		throw new Error(
			"--explicit-object-radius must be no greater than --building-radius.",
		);
	}
	if (
		parsed.generatedObjectRadius !== null &&
		parsed.generatedObjectRadius > parsed.buildingRadius
	) {
		throw new Error(
			"--generated-object-radius must be no greater than --building-radius.",
		);
	}
	if (parsed.cameraLandblockId && parsed.relocateLandblockId) {
		throw new Error(
			"--camera-landblock and --relocate-landblock cannot be combined.",
		);
	}
	return parsed;
}

function requireValue(args, index, label) {
	const value = args[index];
	if (!value) throw new Error(`${label} requires a value.`);
	return value;
}

function printHelp() {
	process.stdout.write(`Usage: npm run harness:terrain -- [options]

Options:
  --landblock <hex>     Outdoor landblock to render. Default: ${DEFAULT_LANDBLOCK_ID}

  --building-radius <n> Request a square terrain/building neighborhood. Default: 0
  --explicit-object-radius <n> Request explicit objects within the building neighborhood.
  --generated-object-radius <n> Request generated objects within the building neighborhood.
  --disable-generated-before-capture
                         Withdraw generated interest after the initial snapshot.
  --camera-yaw <degrees>    Initial and relocation camera yaw. Default: 0
  --camera-pitch <degrees>  Initial and relocation camera pitch. Default: -45
  --camera-landblock <hex>  Move only the camera after the initial request.
  --relocate-landblock <hex> Replace scene interest and camera at a new landblock.
  --lifecycle           Clear and reload the requested neighborhood before capture.
  --fixture <name>      Use the app-local blended or instanced renderer fixture.
  --settle-ms <ms>      Wait after requesting terrain. Default: ${DEFAULT_SETTLE_MS}
  --screenshot <path>   Persist the captured PNG after the harness exits.
  --chrome-path <path>  Chrome executable. Default: ${DEFAULT_CHROME_PATH}
`);
}

async function startContentHost() {
	const child = startChild("cargo", [
		"run",
		"--manifest-path",
		"src-tauri/Cargo.toml",
		"--bin",
		"dev_landblock_content_host",
		"--",
		"--port",
		"0",
	]);
	return waitForReadyLine(child, (line) => {
		const message = parseJsonLine(line);
		return message?.kind === READY_KIND ? message.url : null;
	});
}

async function startViteServer() {
	if (await isUrlReady(`${DEFAULT_VITE_URL}/harness/terrain/`)) {
		process.stderr.write(`Reusing Vite server at ${DEFAULT_VITE_URL}.\n`);
		return DEFAULT_VITE_URL;
	}
	startChild("npm", ["run", "dev:vite"]);
	await waitForUrl(`${DEFAULT_VITE_URL}/harness/terrain/`, 60_000);
	return DEFAULT_VITE_URL;
}

async function runHarness({ contentHostUrl, viteUrl }) {
	const userDataDirectory = await mkdtemp(
		join(tmpdir(), "holtburger-3d-terrain-"),
	);
	tempDirectories.push(userDataDirectory);
	const fixture = options.fixture
		? `&fixture=${encodeURIComponent(options.fixture)}`
		: "";
	const pageUrl = `${viteUrl}/harness/terrain/?contentHost=${encodeURIComponent(contentHostUrl)}${fixture}`;
	const chrome = startChild(options.chromePath, [
		"--remote-debugging-port=0",
		`--user-data-dir=${userDataDirectory}`,
		"--no-first-run",
		"--disable-background-networking",
		"--use-gl=angle",
		"--use-angle=swiftshader",
		"--enable-unsafe-swiftshader",
		"--headless=new",
		"--window-size=1280,720",
		"--force-device-scale-factor=1",
		pageUrl,
	]);
	const browserWebSocketUrl = await waitForChromeDevToolsUrl(chrome);
	const pageWebSocketUrl = await waitForPageWebSocketUrl(
		browserWebSocketUrl,
		pageUrl,
	);
	const client = await createCdpClient(pageWebSocketUrl);
	try {
		const consoleMessages = [];
		client.on("Runtime.consoleAPICalled", (message) => {
			consoleMessages.push({
				level: message.type,
				text: message.args
					.map((argument) => argument.value ?? argument.description ?? "")
					.join(" "),
			});
		});
		client.on("Runtime.exceptionThrown", (message) => {
			consoleMessages.push({
				level: "exception",
				text:
					message.exceptionDetails.exception?.description ??
					message.exceptionDetails.text ??
					"Unspecified browser exception.",
			});
		});
		await client.send("Runtime.enable");
		await waitForHarnessApi(client);
		await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_TERRAIN_HARNESS__.requestOutdoorTerrain",
			[
				options.landblockId,
				options.buildingRadius,
				options.explicitObjectRadius,
				options.generatedObjectRadius,
				options.cameraYawDegrees,
				options.cameraPitchDegrees,
			],
		);
		await delay(options.settleMs);
		const initialState = await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_TERRAIN_HARNESS__.state",
			[],
		);
		let lifecycleState = null;
		if (options.lifecycle) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_TERRAIN_HARNESS__.clearSceneInterest",
				[],
			);
			await delay(50);
			const cleared = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_TERRAIN_HARNESS__.state",
				[],
			);
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_TERRAIN_HARNESS__.requestOutdoorTerrain",
				[
					options.landblockId,
					options.buildingRadius,
					options.explicitObjectRadius,
					options.generatedObjectRadius,
					options.cameraYawDegrees,
					options.cameraPitchDegrees,
				],
			);
			await delay(options.settleMs);
			const reloaded = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_TERRAIN_HARNESS__.state",
				[],
			);
			lifecycleState = { cleared, reloaded };
		}
		let relocationState = null;
		if (options.relocateLandblockId) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_TERRAIN_HARNESS__.requestOutdoorTerrain",
				[
					options.relocateLandblockId,
					options.buildingRadius,
					options.explicitObjectRadius,
					options.generatedObjectRadius,
					options.cameraYawDegrees,
					options.cameraPitchDegrees,
				],
			);
			await delay(options.settleMs);
			relocationState = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_TERRAIN_HARNESS__.state",
				[],
			);
		}
		let generatedDisabledState = null;
		if (options.disableGeneratedBeforeCapture) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_TERRAIN_HARNESS__.requestOutdoorTerrain",
				[
					options.relocateLandblockId ?? options.landblockId,
					options.buildingRadius,
					options.explicitObjectRadius,
					null,
					options.cameraYawDegrees,
					options.cameraPitchDegrees,
				],
			);
			await delay(options.settleMs);
			generatedDisabledState = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_TERRAIN_HARNESS__.state",
				[],
			);
		}
		if (options.cameraLandblockId) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_TERRAIN_HARNESS__.setCameraLandblock",
				[
					options.cameraLandblockId,
					options.cameraYawDegrees,
					options.cameraPitchDegrees,
				],
			);
			await delay(50);
		}
		const state = await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_TERRAIN_HARNESS__.state",
			[],
		);
		const screenshot = await client.send("Page.captureScreenshot", {
			captureBeyondViewport: false,
			format: "png",
		});
		return {
			consoleMessages,
			generatedDisabledState,
			initialState,
			lifecycleState,
			relocationState,
			screenshot: screenshot.data,
			state,
		};
	} finally {
		client.close();
	}
}

function startChild(command, args) {
	const child = spawn(command, args, {
		cwd: process.cwd(),
		detached: process.platform !== "win32",
		env: childEnvironment,
		stdio: ["ignore", "pipe", "pipe"],
	});
	children.push(child);
	child.stdout.on("data", (chunk) => process.stderr.write(chunk));
	child.stderr.on("data", (chunk) => process.stderr.write(chunk));
	return child;
}

async function stopChild(child) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	if (process.platform === "win32") {
		child.kill("SIGTERM");
	} else {
		process.kill(-child.pid, "SIGTERM");
	}
	await Promise.race([
		new Promise((resolve) => child.once("exit", resolve)),
		delay(5_000),
	]);
	if (child.exitCode === null && child.signalCode === null) {
		if (process.platform === "win32") child.kill("SIGKILL");
		else process.kill(-child.pid, "SIGKILL");
	}
}

function waitForReadyLine(child, selectValue) {
	return new Promise((resolve, reject) => {
		let buffer = "";
		const timeout = setTimeout(
			() =>
				reject(
					new Error("Timed out waiting for terrain content host startup."),
				),
			60_000,
		);
		child.once("exit", (code) => {
			clearTimeout(timeout);
			reject(
				new Error(
					`Terrain content host exited before startup with code ${code}.`,
				),
			);
		});
		child.stdout.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline < 0) return;
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				const value = selectValue(line);
				if (value) {
					clearTimeout(timeout);
					resolve(value);
					return;
				}
			}
		});
	});
}

async function waitForUrl(url, timeoutMs) {
	const startedAt = Date.now();
	while (!(await isUrlReady(url))) {
		if (Date.now() - startedAt >= timeoutMs)
			throw new Error(`Timed out waiting for ${url}.`);
		await delay(250);
	}
}

async function isUrlReady(url) {
	try {
		return (await fetch(url)).ok;
	} catch {
		return false;
	}
}

function parseJsonLine(line) {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

function waitForChromeDevToolsUrl(child) {
	return new Promise((resolve, reject) => {
		let buffer = "";
		const timeout = setTimeout(
			() =>
				reject(new Error("Timed out waiting for Chrome DevTools endpoint.")),
			60_000,
		);
		child.once("exit", (code) => {
			clearTimeout(timeout);
			reject(
				new Error(`Chrome exited before DevTools startup with code ${code}.`),
			);
		});
		child.stderr.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (!match?.[1]) return;
			clearTimeout(timeout);
			resolve(match[1]);
		});
	});
}

async function waitForPageWebSocketUrl(browserWebSocketUrl, expectedPageUrl) {
	const { port } = new URL(browserWebSocketUrl);
	const listUrl = `http://127.0.0.1:${port}/json/list`;
	const startedAt = Date.now();
	for (;;) {
		const targets = await fetch(listUrl).then((response) => response.json());
		const page = targets.find(
			(target) =>
				target.type === "page" && target.url.startsWith(expectedPageUrl),
		);
		if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
		if (Date.now() - startedAt >= 60_000)
			throw new Error("Timed out waiting for Chrome page target.");
		await delay(250);
	}
}

function createCdpClient(webSocketUrl) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(webSocketUrl);
		let nextId = 1;
		const listeners = new Map();
		const pending = new Map();
		socket.addEventListener("open", () => {
			resolve({
				close: () => socket.close(),
				on(method, listener) {
					const current = listeners.get(method) ?? [];
					listeners.set(method, [...current, listener]);
				},
				send(method, params = {}) {
					const id = nextId++;
					socket.send(JSON.stringify({ id, method, params }));
					return new Promise((requestResolve, requestReject) => {
						pending.set(id, { reject: requestReject, resolve: requestResolve });
					});
				},
			});
		});
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (!message.id) {
				for (const listener of listeners.get(message.method) ?? [])
					listener(message.params);
				return;
			}
			const request = pending.get(message.id);
			if (!request) return;
			pending.delete(message.id);
			if (message.error) request.reject(new Error(message.error.message));
			else request.resolve(message.result);
		});
		socket.addEventListener("error", reject);
	});
}

async function waitForHarnessApi(client) {
	const startedAt = Date.now();
	for (;;) {
		if (
			await evaluateExpression(
				client,
				"Boolean(globalThis.__HOLTBURGER_3D_TERRAIN_HARNESS__)",
			)
		)
			return;
		if (Date.now() - startedAt >= 60_000) {
			throw new Error(
				`Timed out waiting for terrain harness API: ${JSON.stringify(await evaluateExpression(client, "({ text: document.body.innerText, title: document.title })"))}`,
			);
		}
		await delay(250);
	}
}

async function evaluate(client, functionExpression, args) {
	return evaluateExpression(
		client,
		`(${functionExpression})(...${JSON.stringify(args)})`,
	);
}

async function evaluateExpression(client, expression) {
	const result = await client.send("Runtime.evaluate", {
		awaitPromise: true,
		expression,
		returnByValue: true,
	});
	if (result.exceptionDetails) {
		throw new Error(
			result.exceptionDetails.exception?.description ??
				result.exceptionDetails.text ??
				"Browser evaluation failed.",
		);
	}
	return result.result.value;
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
