#!/usr/bin/env node

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { stringifyRedactedProbeReport } from "./live-client-probe-report.mjs";

const PASSIVE_CAMERA_SETTLE_MS = 3_000;
const PASSIVE_CAMERA_INPUT_COUNT = 40;
const PASSIVE_CAMERA_INPUT_INTERVAL_MS = 25;
const PRECISE_JUMP_SWEEP_INPUT_COUNT = 120;
const PRECISE_JUMP_SWEEP_INPUT_INTERVAL_MS = 5;
const PROFILE_SETTLE_MS = 10_000;
const PROFILE_WINDOW_MS = 10_000;
const WORLD_READY_NOTICE = "World ready";

const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const account = requiredEnvironment("HOLTBURGER_PROBE_ACCOUNT");
const password = requiredEnvironment("HOLTBURGER_PROBE_PASSWORD");
const mode = probeMode(process.env.HOLTBURGER_PROBE_MODE);
const performanceInstrumentationEnabled =
	process.env.HOLTBURGER_PROBE_PROFILE_INSTRUMENTATION !== "0";
if (
	mode !== "teleport" &&
	process.env.HOLTBURGER_PROBE_TELEPORT_SEQUENCE !== undefined
) {
	throw new Error(`${mode} mode rejects HOLTBURGER_PROBE_TELEPORT_SEQUENCE.`);
}
let commands =
	mode === "teleport" && process.env.HOLTBURGER_PROBE_TELEPORT_SEQUENCE
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
		mode === "teleport" ? "dev:client" : "dev:client:release",
		"--",
		"--vite-port",
		"1432",
		"--account",
		account,
		"--password",
		password,
		`--debug=${mode !== "profile" || performanceInstrumentationEnabled}`,
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
	const selectedCharacter = await evaluate(
		client,
		`() => {
			const character = document.querySelector(".client-character");
			if (!character) throw new Error("No character is available for the probe.");
			const label = character.textContent.trim();
			character.click();
			return label;
		}`,
	);
	printReport({ selectedCharacter });
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

	if (mode === "profile") {
		const instrumentationEnabled = performanceInstrumentationEnabled;
		await waitFor(
			client,
			`() => window.__holtburgerClientPerformance !== undefined`,
			timeoutMs,
			"client performance bridge",
		);
		await delay(PROFILE_SETTLE_MS);
		if (instrumentationEnabled) {
			await evaluate(
				client,
				`() => window.__holtburgerClientPerformance.setRendererProfilingEnabled(true)`,
			);
			await client.send("Profiler.enable");
			await client.send("Profiler.setSamplingInterval", { interval: 100 });
			await client.send("Profiler.start");
		}
		await evaluate(
			client,
			`() => window.__holtburgerClientPerformance.reset()`,
		);
		const snapshots = [];
		const profileStartedAt = Date.now();
		while (Date.now() - profileStartedAt < PROFILE_WINDOW_MS) {
			await delay(1_000);
			snapshots.push(
				await evaluate(
					client,
					`() => window.__holtburgerClientPerformance.snapshot()`,
				),
			);
		}
		// Close the frame-count and duration window together, before stopping/exporting V8's
		// profiler can allow more frames to accumulate in the final snapshot.
		const finalSnapshot = await evaluate(
			client,
			`() => window.__holtburgerClientPerformance.snapshot()`,
		);
		const measuredWindowMs = Date.now() - profileStartedAt;
		let cpuProfilePath = null;
		if (instrumentationEnabled) {
			const { profile } = await client.send("Profiler.stop");
			cpuProfilePath =
				process.env.HOLTBURGER_PROBE_CPU_PROFILE ??
				"/tmp/holtburger-client-ts.cpuprofile";
			await writeFile(cpuProfilePath, JSON.stringify(profile));
		}
		let screenshotPath = null;
		if (process.env.HOLTBURGER_PROBE_SCREENSHOT !== undefined) {
			screenshotPath = process.env.HOLTBURGER_PROBE_SCREENSHOT;
			await client.send("Page.enable");
			const screenshot = await client.send("Page.captureScreenshot", {
				format: "png",
			});
			await writeFile(screenshotPath, screenshot.data, "base64");
		}
		if (instrumentationEnabled) {
			await evaluate(
				client,
				`() => window.__holtburgerClientPerformance.setRendererProfilingEnabled(false)`,
			);
		}
		const report = {
			materialTableProbe:
				process.env.HOLTBURGER_PROBE_MATERIAL_TABLES === "1"
					? await evaluate(
							client,
							`async () => (await import('/src/harness/browser/dynamic-material-table-probe.ts')).probeDynamicMaterialTables()`,
						)
					: null,
			ok: true,
			mode,
			instrumentationEnabled,
			cpuProfilePath,
			selectedCharacter,
			settleMs: PROFILE_SETTLE_MS,
			windowMs: measuredWindowMs,
			snapshots,
			finalSnapshot,
			screenshotPath,
			consoleMessages: [...consoleMessages.values()],
			page: await pageState(client),
			hostOutput: redact(output).slice(-30_000),
		};
		const reportPath = process.env.HOLTBURGER_PROBE_REPORT;
		if (reportPath !== undefined) {
			await writeFile(
				reportPath,
				stringifyRedactedProbeReport(report, { account, password }),
			);
			printReport({
				ok: true,
				mode,
				instrumentationEnabled,
				cpuProfilePath,
				reportPath,
				windowMs: report.windowMs,
				finalSnapshot: summarizePerformanceSnapshot(finalSnapshot),
			});
		} else {
			printReport(report);
		}
	} else if (mode === "passive-camera") {
		await delay(PASSIVE_CAMERA_SETTLE_MS);
		const cameraEvidence = await capturePassiveCameraGesture(client);
		const cameraSummary = summarizeCameraEvidence(cameraEvidence);
		const captureComplete =
			cameraSummary.inputEventCount === PASSIVE_CAMERA_INPUT_COUNT &&
			cameraSummary.cameraEventCount > 0 &&
			cameraSummary.animationFrameCount > 0;
		printReport({
			ok: captureComplete,
			mode,
			commands: [],
			teleports: [],
			cameraEvidence: cameraSummary,
			consoleMessages: [...consoleMessages.values()],
			page: await pageState(client),
			hostOutput: redact(output).slice(-30_000),
		});
		process.exitCode = captureComplete ? 0 : 1;
	} else if (mode === "precise-jump") {
		const preciseJump = await capturePreciseJumpEntry(client, timeoutMs);
		const responsive =
			preciseJump.sweep.evaluationCount > 1 &&
			Number.isFinite(preciseJump.sweep.postStopLatencyMs);
		printReport({
			ok:
				responsive &&
				preciseJump.page.error === null &&
				!preciseJump.webgl.contextLost,
			mode,
			commands: [],
			teleports: [],
			preciseJump,
			consoleMessages: [...consoleMessages.values()],
			page: preciseJump.page,
			hostOutput: redact(output).slice(-30_000),
		});
		process.exitCode =
			responsive &&
			preciseJump.page.error === null &&
			!preciseJump.webgl.contextLost
				? 0
				: 1;
	} else {
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
				notice: outcome.lastState.notice,
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
	}
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

function probeMode(value) {
	if (value === undefined) {
		throw new Error(
			"HOLTBURGER_PROBE_MODE must be explicitly set to teleport, passive-camera, precise-jump, or profile.",
		);
	}
	const mode = value;
	if (
		mode !== "teleport" &&
		mode !== "passive-camera" &&
		mode !== "precise-jump" &&
		mode !== "profile"
	) {
		throw new Error(
			"HOLTBURGER_PROBE_MODE must be teleport, passive-camera, precise-jump, or profile.",
		);
	}
	return mode;
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

function summarizePerformanceSnapshot(snapshot) {
	const profile = snapshot.diagnostics.renderer?.profile;
	return {
		frameRates: snapshot.frameRates,
		meanFrameWorkMs: snapshot.meanFrameWorkMs,
		renderedFrames: snapshot.sampledFrameCount,
		rendererCpuMean: profile?.cpu.mean ?? null,
		rendererGpuMean:
			profile?.gpu.kind === "available" ? profile.gpu.mean : null,
		runtimeTickMean: snapshot.diagnostics.tickProfile?.mean ?? null,
		selectionMetrics: snapshot.diagnostics.renderer?.selectionMetrics ?? null,
		dynamicResources: snapshot.diagnostics.renderer?.dynamicResources ?? null,
		viewport: snapshot.diagnostics.viewport,
		playerResidency: snapshot.diagnostics.playerResidency,
		cameraResidency: snapshot.diagnostics.cameraResidency,
	};
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
			const evidence = {
				camera: null,
				cameraGenerations: [],
				lifecycle: null,
				lifecycles: [],
				collecting: false,
				cameraEvents: [],
				animationFrames: [],
				inputEvents: [],
				preciseJumpEvaluations: [],
				preciseJumpEvaluationTimes: [],
			};
			Object.defineProperty(window, "__holtburgerProbeEvidence", {
				configurable: true,
				value: evidence,
			});
			await bridge.listen("client-camera", (tick) => {
				if (evidence.collecting) evidence.cameraEvents.push(performance.now());
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
			await bridge.listen("client-precise-jump-evaluation", (evaluation) => {
				evidence.preciseJumpEvaluations.push(evaluation);
				evidence.preciseJumpEvaluationTimes.push(performance.now());
			});
			const collectAnimationFrame = (timestamp) => {
				if (evidence.collecting) evidence.animationFrames.push(timestamp);
				requestAnimationFrame(collectAnimationFrame);
			};
			requestAnimationFrame(collectAnimationFrame);
		}`,
	);
}

async function capturePreciseJumpEntry(client_, milliseconds) {
	const bounds = await evaluate(
		client_,
		`() => {
			const canvas = document.querySelector(".client-canvas");
			if (!(canvas instanceof HTMLCanvasElement)) {
				throw new Error("Client canvas is unavailable.");
			}
			canvas.focus();
			const rect = canvas.getBoundingClientRect();
			window.__holtburgerProbeEvidence.preciseJumpEvaluations = [];
			window.__holtburgerProbeEvidence.preciseJumpEvaluationTimes = [];
			return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
		}`,
	);
	const x = bounds.x + bounds.width * 0.5;
	const y = bounds.y + bounds.height * 0.6;
	await client_.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x,
		y,
		button: "none",
		buttons: 0,
	});
	await evaluate(
		client_,
		`() => {
			const dispatch = (type, key, shiftKey) =>
				window.dispatchEvent(
					new KeyboardEvent(type, { bubbles: true, key, shiftKey }),
				);
			dispatch("keydown", "J", true);
			dispatch("keyup", "J", false);
		}`,
	);
	const startedAt = Date.now();
	for (;;) {
		const state = await evaluate(
			client_,
			`() => ({
				evaluations: window.__holtburgerProbeEvidence.preciseJumpEvaluations,
				error: document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
			})`,
		);
		if (state.evaluations.length > 0 || state.error !== null) break;
		if (Date.now() - startedAt >= milliseconds) {
			throw new Error("Timed out waiting for precise-jump evaluation.");
		}
		await delay(100);
	}
	const sweepStartedAt = await evaluate(client_, "() => performance.now()");
	for (let index = 0; index < PRECISE_JUMP_SWEEP_INPUT_COUNT; index += 1) {
		const fraction = index / (PRECISE_JUMP_SWEEP_INPUT_COUNT - 1);
		await client_.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: bounds.x + bounds.width * (0.35 + fraction * 0.3),
			y: bounds.y + bounds.height * 0.6,
			button: "none",
			buttons: 0,
		});
		await delay(PRECISE_JUMP_SWEEP_INPUT_INTERVAL_MS);
	}
	const stoppedAt = await evaluate(client_, "() => performance.now()");
	await waitFor(
		client_,
		`() => window.__holtburgerProbeEvidence.preciseJumpEvaluationTimes.some(
			(time) => time >= ${stoppedAt},
		)`,
		milliseconds,
		"post-sweep precise-jump evaluation",
	);
	await delay(100);
	const result = await evaluate(
		client_,
		`() => {
			const canvas = document.querySelector(".client-canvas");
			const gl = canvas instanceof HTMLCanvasElement ? canvas.getContext("webgl2") : null;
			return {
				evaluations: window.__holtburgerProbeEvidence.preciseJumpEvaluations,
				evaluationTimes: window.__holtburgerProbeEvidence.preciseJumpEvaluationTimes,
				page: {
					notice: document.querySelector(".client-toast")?.textContent?.trim() ?? null,
					error: document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
				},
				webgl: {
					contextLost: gl?.isContextLost() ?? true,
					renderer: gl?.getParameter(gl.RENDERER) ?? null,
					vendor: gl?.getParameter(gl.VENDOR) ?? null,
				},
			};
		}`,
	);
	const sweepEvaluationTimes = result.evaluationTimes.filter(
		(time) => time >= sweepStartedAt,
	);
	return {
		...result,
		sweep: {
			inputCount: PRECISE_JUMP_SWEEP_INPUT_COUNT,
			durationMs: stoppedAt - sweepStartedAt,
			evaluationCount: sweepEvaluationTimes.length,
			maximumEvaluationGapMs: maximumAdjacentGap(sweepEvaluationTimes),
			postStopLatencyMs:
				sweepEvaluationTimes.find((time) => time >= stoppedAt) - stoppedAt,
		},
	};
}

function maximumAdjacentGap(values) {
	let maximum = 0;
	for (let index = 1; index < values.length; index += 1) {
		maximum = Math.max(maximum, values[index] - values[index - 1]);
	}
	return maximum;
}

async function capturePassiveCameraGesture(client_) {
	const bounds = await evaluate(
		client_,
		`() => {
			const canvas = document.querySelector(".client-canvas");
			if (!(canvas instanceof HTMLCanvasElement)) {
				throw new Error("Client canvas is unavailable.");
			}
			const rect = canvas.getBoundingClientRect();
			const evidence = window.__holtburgerProbeEvidence;
			evidence.cameraEvents = [];
			evidence.animationFrames = [];
			evidence.inputEvents = [];
			evidence.collecting = true;
			return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
		}`,
	);
	const startX = bounds.x + bounds.width * 0.45;
	const startY = bounds.y + bounds.height * 0.5;
	await client_.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x: startX,
		y: startY,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	for (let step = 1; step <= PASSIVE_CAMERA_INPUT_COUNT; step += 1) {
		await evaluate(
			client_,
			"() => window.__holtburgerProbeEvidence.inputEvents.push(performance.now())",
		);
		await client_.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: startX + step * 2,
			y: startY + Math.sin(step / 6) * 12,
			button: "left",
			buttons: 1,
		});
		await delay(PASSIVE_CAMERA_INPUT_INTERVAL_MS);
	}
	await client_.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: startX + 80,
		y: startY,
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
	await delay(2_000);
	return evaluate(
		client_,
		`() => {
			const evidence = window.__holtburgerProbeEvidence;
			evidence.collecting = false;
			return {
				cameraEvents: evidence.cameraEvents,
				animationFrames: evidence.animationFrames,
				inputEvents: evidence.inputEvents,
			};
		}`,
	);
}

function summarizeCameraEvidence(evidence) {
	const cameraIntervals = intervals(evidence.cameraEvents);
	const animationFrameIntervals = intervals(evidence.animationFrames);
	const inputLatencies = evidence.inputEvents.flatMap((input) => {
		const camera = evidence.cameraEvents.find((event) => event >= input);
		return camera === undefined ? [] : [camera - input];
	});
	return {
		cameraEventCount: evidence.cameraEvents.length,
		animationFrameCount: evidence.animationFrames.length,
		inputEventCount: evidence.inputEvents.length,
		cameraIntervalMs: distribution(cameraIntervals),
		animationFrameIntervalMs: distribution(animationFrameIntervals),
		inputToCameraMs: distribution(inputLatencies),
	};
}

function intervals(values) {
	return values.slice(1).map((value, index) => value - values[index]);
}

function distribution(values) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	const percentile = (fraction) =>
		sorted[
			Math.min(
				sorted.length - 1,
				Math.max(0, Math.ceil(sorted.length * fraction) - 1),
			)
		];
	return {
		count: sorted.length,
		mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
		p50: percentile(0.5),
		p95: percentile(0.95),
		max: sorted.at(-1),
	};
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
		if (state.notice !== null && state.notice !== WORLD_READY_NOTICE) {
			sawLoading = true;
		}
		const hasCurrentCamera =
			state.camera !== null &&
			(previousCameraGeneration === null ||
				state.camera.cameraGeneration !== previousCameraGeneration);
		if (
			state.notice === WORLD_READY_NOTICE &&
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
			notice: document.querySelector(".client-toast")?.textContent?.trim() ?? null,
			error: document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
			camera: window.__holtburgerProbeEvidence?.camera ?? null,
			cameraGenerations: window.__holtburgerProbeEvidence?.cameraGenerations ?? [],
			lifecycle: window.__holtburgerProbeEvidence?.lifecycle ?? null,
			lifecycles: window.__holtburgerProbeEvidence?.lifecycles ?? [],
			bodyText: document.body?.innerText.slice(0, 4000) ?? "",
		})`,
	);
}
