#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { stringifyRedactedProbeReport } from "./live-client-probe-report.mjs";

const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const account = requiredEnvironment("HOLTBURGER_PROBE_ACCOUNT");
const password = requiredEnvironment("HOLTBURGER_PROBE_PASSWORD");
let commands = process.env.HOLTBURGER_PROBE_TELEPORT_SEQUENCE
	? parseCommands(process.env.HOLTBURGER_PROBE_TELEPORT_SEQUENCE)
	: null;
const timeoutMs = Number(process.env.HOLTBURGER_PROBE_TIMEOUT_MS ?? "45000");

if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
	throw new Error("HOLTBURGER_PROBE_TIMEOUT_MS must be a positive integer.");
}
const child = spawn(
	process.platform === "win32" ? "npm.cmd" : "npm",
	[
		"run",
		"dev:client",
		"--",
		"--vite-port",
		"1432",
		"--account",
		account,
		"--password",
		password,
		"--debug=true",
	],
	{
		cwd: appRoot,
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
const consoleMessages = new Map();
const hops = [];
try {
	const browserWebSocketUrl = await waitForDevToolsUrl(child, () => output);
	const pageWebSocketUrl = await waitForPageWebSocketUrl(browserWebSocketUrl);
	client = await createCdpClient(pageWebSocketUrl);
	client.on("Runtime.consoleAPICalled", (message) => {
		recordConsoleMessage({
			level: message.type,
			text: message.args
				.map((argument) => argument.value ?? argument.description ?? "")
				.join(" "),
		});
	});
	client.on("Runtime.exceptionThrown", (message) => {
		recordConsoleMessage({
			level: "exception",
			text:
				message.exceptionDetails.exception?.description ??
				message.exceptionDetails.text,
		});
	});
	await client.send("Runtime.enable");
	await installEvidenceCollector(client);
	await waitFor(
		client,
		`() => document.body?.innerText.includes("Choose a character")`,
		timeoutMs,
		"character selection",
	);
	await evaluate(
		client,
		`() => document.querySelector(".client-character")?.click()`,
	);
	await evaluate(
		client,
		`() => [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Enter World"))?.click()`,
	);
	const initial = await waitForReady(
		client,
		timeoutMs,
		"initial world entry",
		true,
	);
	if (!initial.ready) {
		throw new Error("Initial world entry did not produce a destination frame.");
	}
	commands ??= defaultTeleportSequence(initial.lastState.bodyText);

	for (const command of commands) {
		const before = await pageState(client);
		await submitChat(client, command);
		const outcome = await waitForReady(
			client,
			timeoutMs,
			command,
			true,
			before.camera?.cameraGeneration ?? null,
		);
		const generation = outcome.lastState.camera?.cameraGeneration;
		const cameraGeneration = outcome.lastState.cameraGenerations.find(
			(evidence) => evidence.cameraGeneration === generation,
		);
		const provenInitialReseed =
			cameraGeneration?.first.kind === "reseeded" &&
			cameraGeneration.first.reason === "initial-placement" &&
			cameraGeneration.first.clearance !== null;
		const lastState = {
			status: outcome.lastState.status,
			error: outcome.lastState.error,
			camera: outcome.lastState.camera,
			bodyText: outcome.lastState.bodyText,
		};
		hops.push({
			command,
			ready: outcome.ready,
			elapsedMs: outcome.elapsedMs,
			lastState,
			cameraGeneration,
			provenInitialReseed,
		});
		if (!outcome.ready) break;
	}

	printReport({
		ok:
			hops.length === commands.length &&
			hops.every((hop) => hop.ready && hop.provenInitialReseed),
		hops,
		consoleMessages: [...consoleMessages.values()],
		page: await pageState(client),
		hostOutput: redact(output).slice(-30_000),
	});
} catch (error) {
	printReport({
		ok: false,
		error: safeError(error),
		hops,
		consoleMessages: [...consoleMessages.values()],
		page:
			client === undefined ? null : await pageState(client).catch(() => null),
		hostOutput: redact(output).slice(-12_000),
	});
	process.exitCode = 1;
} finally {
	client?.close();
	if (child.exitCode === null && child.signalCode === null)
		child.kill("SIGTERM");
}

function requiredEnvironment(name) {
	const value = process.env[name];
	if (value === undefined || value.length === 0)
		throw new Error(`${name} must be set.`);
	return value;
}

function parseCommands(value) {
	const parsed = value
		.split("|")
		.map((command) => command.trim())
		.filter((command) => command.length > 0);
	if (
		parsed.length === 0 ||
		parsed.some((command) => !command.startsWith("@"))
	) {
		throw new Error(
			"Teleport sequence must contain pipe-separated chat commands.",
		);
	}
	return parsed;
}

function defaultTeleportSequence(bodyText) {
	if (bodyText.includes("22.0S, 2.0W")) {
		return parseCommands(
			"@teledungeon 0288|@tele 22s 2w|@teledungeon 0288|@tele 22s 2w",
		);
	}
	return parseCommands(
		"@tele 22s 2w|@teledungeon 0288|@tele 22s 2w|@teledungeon 0288",
	);
}

function redact(value) {
	return value
		.replaceAll(account, "<account>")
		.replaceAll(password, "<password>");
}

function safeError(error) {
	return redact(error instanceof Error ? error.message : String(error));
}

function printReport(report) {
	console.log(
		stringifyRedactedProbeReport(report, {
			account,
			password,
		}),
	);
}

function recordConsoleMessage(message) {
	const key = `${message.level}\u0000${message.text}`;
	const previous = consoleMessages.get(key);
	consoleMessages.set(key, {
		...message,
		count: (previous?.count ?? 0) + 1,
	});
}

function delay(milliseconds) {
	return new Promise((resolvePromise) =>
		setTimeout(resolvePromise, milliseconds),
	);
}

async function waitForDevToolsUrl(process_, readOutput) {
	const startedAt = Date.now();
	for (;;) {
		const match = readOutput().match(/DevTools listening on (ws:\/\/[^\s]+)/);
		if (match?.[1]) return match[1];
		if (process_.exitCode !== null || process_.signalCode !== null) {
			throw new Error("Electron exited before opening its DevTools endpoint.");
		}
		if (Date.now() - startedAt >= 60_000) {
			throw new Error("Timed out waiting for Electron DevTools endpoint.");
		}
		await delay(100);
	}
}

async function waitForPageWebSocketUrl(browserWebSocketUrl) {
	const { port } = new URL(browserWebSocketUrl);
	const startedAt = Date.now();
	for (;;) {
		const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
			(response) => response.json(),
		);
		const page = targets.find(
			(target) => target.type === "page" && target.url.includes("/client/"),
		);
		if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
		if (Date.now() - startedAt >= 60_000) {
			throw new Error("Timed out waiting for the Electron client page.");
		}
		await delay(100);
	}
}

function createCdpClient(webSocketUrl) {
	return new Promise((resolvePromise, rejectPromise) => {
		const socket = new WebSocket(webSocketUrl);
		let nextId = 1;
		const listeners = new Map();
		const pending = new Map();
		socket.addEventListener("open", () => {
			resolvePromise({
				close: () => socket.close(),
				on(method, listener) {
					listeners.set(method, [...(listeners.get(method) ?? []), listener]);
				},
				send(method, params = {}) {
					const id = nextId++;
					socket.send(JSON.stringify({ id, method, params }));
					return new Promise((resolveRequest, rejectRequest) => {
						pending.set(id, { reject: rejectRequest, resolve: resolveRequest });
					});
				},
			});
		});
		socket.addEventListener("error", rejectPromise);
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (!message.id) {
				for (const listener of listeners.get(message.method) ?? []) {
					listener(message.params);
				}
				return;
			}
			const request = pending.get(message.id);
			if (request === undefined) return;
			pending.delete(message.id);
			if (message.error) request.reject(new Error(message.error.message));
			else request.resolve(message.result);
		});
	});
}

async function evaluate(client_, expression) {
	const result = await client_.send("Runtime.evaluate", {
		expression: `(${expression})()`,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
	return result.result.value;
}

async function waitFor(client_, predicate, milliseconds, description) {
	const startedAt = Date.now();
	for (;;) {
		if (await evaluate(client_, predicate)) return;
		if (Date.now() - startedAt >= milliseconds) {
			throw new Error(`Timed out waiting for ${description}.`);
		}
		await delay(100);
	}
}

async function installEvidenceCollector(client_) {
	await evaluate(
		client_,
		`async () => {
			const bridge = window.holtburgerHost;
			if (bridge === undefined) throw new Error("Electron host bridge is unavailable.");
			const evidence = { camera: null, cameraGenerations: [], lifecycle: null, lifecycles: [] };
			Object.defineProperty(window, "__holtburgerProbeEvidence", {
				configurable: true,
				value: evidence,
			});
			await bridge.listen("client-camera", (tick) => {
				const pathEnd = tick.path.legs.at(-1)?.end.position ?? tick.path.initial.position;
				const summary = {
					cameraGeneration: tick.cameraGeneration,
					sequence: tick.sequence,
					kind: tick.kind,
					reason: tick.reason ?? null,
					clearance: tick.clearance ?? null,
					initialLandblockId: tick.path.initial.position.landblockId,
					finalLandblockId: pathEnd.landblockId,
				};
				evidence.camera = summary;
				const generation = evidence.cameraGenerations.find(
					(candidate) => candidate.cameraGeneration === tick.cameraGeneration,
				);
				if (generation === undefined) {
					evidence.cameraGenerations.push({
						cameraGeneration: tick.cameraGeneration,
						first: summary,
						latest: summary,
					});
				} else {
					generation.latest = summary;
				}
			});
			await bridge.listen("client-lifecycle-changed", (lifecycle) => {
				evidence.lifecycle = lifecycle;
				evidence.lifecycles.push(lifecycle);
			});
		}`,
	);
}

async function submitChat(client_, message) {
	await evaluate(
		client_,
		`() => {
			const input = document.querySelector('input[aria-label="Chat message"]');
			if (!(input instanceof HTMLInputElement)) throw new Error("Chat input is unavailable.");
			const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
			setter?.call(input, ${JSON.stringify(message)});
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.form?.requestSubmit();
		}`,
	);
}

async function waitForReady(
	client_,
	milliseconds,
	description,
	requireLoading,
	previousCameraGeneration = null,
) {
	const startedAt = Date.now();
	let sawLoading = false;
	for (;;) {
		const state = await pageState(client_);
		if (state.status !== null) sawLoading = true;
		const hasCurrentCamera =
			state.camera !== null &&
			(previousCameraGeneration === null ||
				state.camera.cameraGeneration !== previousCameraGeneration);
		if (
			state.status === null &&
			hasCurrentCamera &&
			(!requireLoading || sawLoading)
		) {
			return {
				ready: true,
				elapsedMs: Date.now() - startedAt,
				lastState: state,
			};
		}
		if (Date.now() - startedAt >= milliseconds) {
			return {
				ready: false,
				elapsedMs: Date.now() - startedAt,
				lastState: state,
			};
		}
		await delay(100);
	}
}

function pageState(client_) {
	return evaluate(
		client_,
		`() => ({
			status: document.querySelector(".client-world-status span")?.textContent?.trim() ?? null,
			error: document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
			camera: window.__holtburgerProbeEvidence?.camera ?? null,
			cameraGenerations: window.__holtburgerProbeEvidence?.cameraGenerations ?? [],
			lifecycle: window.__holtburgerProbeEvidence?.lifecycle ?? null,
			lifecycles: window.__holtburgerProbeEvidence?.lifecycles ?? [],
			bodyText: document.body?.innerText.slice(0, 4000) ?? "",
		})`,
	);
}
