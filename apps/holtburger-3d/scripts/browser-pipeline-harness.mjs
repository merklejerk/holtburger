#!/usr/bin/env node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_CHROME_PATH = "/opt/google/chrome/chrome";
const DEFAULT_VITE_URL = "http://127.0.0.1:1420";
const DEFAULT_STATIC_DOMAINS = [
	"buildings",
	"env-cells",
	"explicit-objects",
	"generated-scenery",
	"terrain",
];
const READY_KIND = "holtburger-3d-dev-asset-host-ready";

const options = parseArgs(process.argv.slice(2));
const childProcesses = [];
const tempDirs = [];

try {
	const assetHostUrl =
		options.assetHostUrl ?? (await startDevAssetHost(options.verbose));
	const viteUrl = options.viteUrl ?? (await startViteDevServer());
	const result = await runBrowserHarness({
		assetHostUrl,
		chromePath: options.chromePath,
		domains: options.domains,
		headed: options.headed,
		landblockId: options.landblockId,
		timeoutMs: options.timeoutMs,
		viteUrl,
	});
	await writeDiagnosticsOutput(
		result.diagnostics,
		options.outputPath,
		result.errorMessage,
	);
	if (result.errorMessage) {
		process.exitCode = 1;
	}
} finally {
	for (const child of childProcesses.toReversed()) {
		child.kill("SIGTERM");
	}
	await Promise.allSettled(
		tempDirs.map((dir) => rm(dir, { force: true, recursive: true })),
	);
}

function parseArgs(args) {
	const parsed = {
		assetHostUrl: null,
		chromePath: process.env.CHROME_PATH ?? DEFAULT_CHROME_PATH,
		domains: DEFAULT_STATIC_DOMAINS,
		headed: false,
		landblockId: "0xda55ffff",
		outputPath: null,
		timeoutMs: 180_000,
		verbose: false,
		viteUrl: null,
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--asset-host-url":
				parsed.assetHostUrl = requireValue(args, ++index, arg);
				break;
			case "--chrome-path":
				parsed.chromePath = requireValue(args, ++index, arg);
				break;
			case "--domains":
				parsed.domains = parseDomains(requireValue(args, ++index, arg));
				break;
			case "--headed":
				parsed.headed = true;
				break;
			case "--landblock":
				parsed.landblockId = requireValue(args, ++index, arg);
				break;
			case "--output":
				parsed.outputPath = requireValue(args, ++index, arg);
				break;
			case "--timeout-ms":
				parsed.timeoutMs = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
					throw new Error("--timeout-ms must be a positive number.");
				}
				break;
			case "--verbose":
				parsed.verbose = true;
				break;
			case "--vite-url":
				parsed.viteUrl = requireValue(args, ++index, arg);
				break;
			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
			default:
				throw new Error(`Unsupported argument ${arg}.`);
		}
	}
	return parsed;
}

function requireValue(args, index, label) {
	const value = args[index];
	if (!value) {
		throw new Error(`${label} requires a value.`);
	}
	return value;
}

function printHelp() {
	process.stdout.write(`Usage: npm run harness:browser -- [options]

Options:
  --landblock <hex>        Outdoor landblock to load. Default: 0xda55ffff
  --domains <csv>          Static domains to request. Default: ${DEFAULT_STATIC_DOMAINS.join(",")}
  --headed                 Launch visible Chrome instead of headless Chrome.
  --output <path>          Write full diagnostics JSON to a file.
  --timeout-ms <ms>        Scene settle timeout. Default: 180000
  --vite-url <url>         Reuse an existing Vite server.
  --asset-host-url <url>   Reuse an existing dev asset host.
  --chrome-path <path>     Chrome executable path. Default: ${DEFAULT_CHROME_PATH}
  --verbose                Enable verbose asset host diagnostics.
`);
}

function parseDomains(value) {
	const domains = value
		.split(",")
		.map((domain) => domain.trim())
		.filter((domain) => domain.length > 0);
	const invalidDomains = domains.filter(
		(domain) => !DEFAULT_STATIC_DOMAINS.includes(domain),
	);
	if (domains.length === 0 || invalidDomains.length > 0) {
		throw new Error(
			`--domains must be a comma-separated subset of ${DEFAULT_STATIC_DOMAINS.join(",")}. Invalid: ${invalidDomains.join(",")}`,
		);
	}
	return domains;
}

async function writeDiagnosticsOutput(diagnostics, outputPath, errorMessage) {
	const serialized = `${JSON.stringify(diagnostics, null, 2)}\n`;
	if (!outputPath) {
		process.stdout.write(serialized);
		if (errorMessage) {
			process.stderr.write(`${errorMessage}\n`);
		}
		return;
	}

	await writeFile(outputPath, serialized);
	process.stdout.write(
		`${JSON.stringify(
			createDiagnosticsSummary(diagnostics, outputPath, errorMessage),
			null,
			2,
		)}\n`,
	);
}

function createDiagnosticsSummary(diagnostics, outputPath, errorMessage) {
	const domains = Array.isArray(diagnostics.domains) ? diagnostics.domains : [];
	const staticCoordinator = domains.find(
		(domain) => domain.kind === "static-coordinator",
	);
	const textureAtlas = domains.find(
		(domain) => domain.kind === "texture-atlas",
	);
	return {
		kind: "browser-pipeline-harness-summary",
		errorMessage: errorMessage ?? null,
		outputPath,
		runtime: diagnostics.runtime,
		staticCoordinator: staticCoordinator?.summary ?? null,
		staticCoordinatorTiming: staticCoordinator?.timingSummary ?? null,
		textureAtlas: textureAtlas?.summary ?? null,
	};
}

async function startDevAssetHost(verbose) {
	const child = spawn(
		"cargo",
		[
			"run",
			"--manifest-path",
			"src-tauri/Cargo.toml",
			"--bin",
			"dev_asset_host",
			"--",
			"--port",
			"0",
			...(verbose ? ["--verbose"] : []),
		],
		{
			cwd: process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	childProcesses.push(child);
	child.stderr.on("data", (chunk) => {
		process.stderr.write(chunk);
	});
	return waitForReadyLine(child, (line) => {
		const message = parseJsonLine(line);
		return message?.kind === READY_KIND ? message.url : null;
	});
}

async function startViteDevServer() {
	if (await isUrlReady(`${DEFAULT_VITE_URL}/browser`)) {
		process.stderr.write(`Reusing Vite server at ${DEFAULT_VITE_URL}.\n`);
		return DEFAULT_VITE_URL;
	}

	const child = spawn("npm", ["run", "dev"], {
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
	});
	childProcesses.push(child);
	child.stdout.on("data", (chunk) => {
		process.stderr.write(chunk);
	});
	child.stderr.on("data", (chunk) => {
		process.stderr.write(chunk);
	});
	await waitForUrl(`${DEFAULT_VITE_URL}/browser`, 60_000);
	return DEFAULT_VITE_URL;
}

function waitForReadyLine(child, selectValue) {
	return new Promise((resolve, reject) => {
		let buffer = "";
		const timeout = setTimeout(() => {
			reject(new Error("Timed out waiting for dev asset host startup."));
		}, 120_000);
		child.once("exit", (code) => {
			clearTimeout(timeout);
			reject(
				new Error(`Dev asset host exited before startup with code ${code}.`),
			);
		});
		child.stdout.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline < 0) {
					return;
				}
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				if (line.length === 0) {
					continue;
				}
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

function parseJsonLine(line) {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

async function waitForUrl(url, timeoutMs) {
	const startedAt = Date.now();
	for (;;) {
		if (await isUrlReady(url)) {
			return;
		}
		if (Date.now() - startedAt >= timeoutMs) {
			throw new Error(`Timed out waiting for ${url}.`);
		}
		await delay(250);
	}
}

async function isUrlReady(url) {
	try {
		const response = await fetch(url);
		return response.ok;
	} catch {
		return false;
	}
}

async function runBrowserHarness({
	assetHostUrl,
	chromePath,
	domains,
	headed,
	landblockId,
	timeoutMs,
	viteUrl,
}) {
	const userDataDir = await mkdtemp(join(tmpdir(), "holtburger-3d-browser-"));
	tempDirs.push(userDataDir);
	const pageUrl = `${viteUrl}/harness/browser-pipeline?assetHost=${encodeURIComponent(assetHostUrl)}`;
	const child = spawn(
		chromePath,
		[
			"--remote-debugging-port=0",
			`--user-data-dir=${userDataDir}`,
			"--no-first-run",
			"--disable-background-networking",
			"--use-gl=swiftshader",
			"--enable-unsafe-swiftshader",
			...(headed ? [] : ["--headless=new"]),
			pageUrl,
		],
		{ stdio: ["ignore", "ignore", "pipe"] },
	);
	childProcesses.push(child);

	const browserWebSocketUrl = await waitForChromeDevToolsUrl(child);
	const pageWebSocketUrl = await waitForPageWebSocketUrl(
		browserWebSocketUrl,
		pageUrl,
	);
	const client = await createCdpClient(pageWebSocketUrl);
	try {
		await client.send("Runtime.enable");
		await client.send("Page.enable");
		await waitForHarnessApi(client, timeoutMs);
		let errorMessage = null;
		const traceCollector = collectPipelineTrace(client, timeoutMs);
		try {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_HARNESS__.requestOutdoorScene",
				[{ domains, landblockId, timeoutMs }],
			);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		}
		const harnessTrace = await traceCollector.stop();
		const diagnostics = await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_HARNESS__.createDiagnosticsReport",
			[],
		);
		diagnostics.harnessTrace = harnessTrace;
		return { diagnostics, errorMessage };
	} finally {
		client.close();
	}
}

function collectPipelineTrace(client, timeoutMs) {
	const samples = [];
	const workerEventsByKey = new Map();
	let stopped = false;
	const sampleIntervalMs = 1000;
	const startedAt = Date.now();

	const interval = setInterval(() => {
		if (stopped || Date.now() - startedAt > timeoutMs + sampleIntervalMs) {
			return;
		}
		void samplePipelineTrace(client, samples, workerEventsByKey);
	}, sampleIntervalMs);

	void samplePipelineTrace(client, samples, workerEventsByKey);

	return {
		async stop() {
			stopped = true;
			clearInterval(interval);
			await samplePipelineTrace(client, samples, workerEventsByKey);
			return {
				kind: "browser-pipeline-harness-trace",
				samples,
				workerEvents: Array.from(workerEventsByKey.values()).sort(
					(left, right) =>
						left.atMs - right.atMs || left.key.localeCompare(right.key),
				),
			};
		},
	};
}

async function samplePipelineTrace(client, samples, workerEventsByKey) {
	let diagnostics;
	try {
		diagnostics = await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_HARNESS__.createDiagnosticsReport",
			[],
		);
	} catch {
		return;
	}

	const domains = Array.isArray(diagnostics.domains) ? diagnostics.domains : [];
	const staticCoordinator = domains.find(
		(domain) => domain.kind === "static-coordinator",
	);
	const textureAtlas = domains.find(
		(domain) => domain.kind === "texture-atlas",
	);
	const staticBaker = staticCoordinator?.staticBaker ?? null;
	const pendingJobs = staticBaker?.pendingJobs ?? [];
	const sourceResolutions = staticCoordinator?.sourceResolutions ?? [];

	samples.push({
		atMs: Date.now(),
		inFlightTasks: (staticCoordinator?.inFlightTasks ?? []).map((task) => ({
			activeBakeBatchId: task.activeBakeBatchId,
			activeBakeStage: task.activeBakeStage,
			activeBakeStageAgeMs: task.activeBakeStageAgeMs,
			domain: task.domain,
			phase: task.phase,
			scopeKey: task.scopeKey,
		})),
		pendingJobs: pendingJobs.map((job) => ({
			bakeBatchId: job.bakeBatchId,
			domain: job.domain,
			itemCount: job.itemCount,
			lastTraceStage: job.traceEvents.at(-1)?.stage ?? null,
			requestId: job.requestId,
			stage: job.stage,
			stageAgeMs: job.stageAgeMs,
			traceEventCount: job.traceEvents.length,
		})),
		renderer: diagnostics.runtime,
		sourceResolutions: sourceResolutions.map((resolution) => ({
			ageMs: resolution.ageMs,
			landblockHex: resolution.landblockHex,
			layerKinds: resolution.layerKinds,
			recipeCount: resolution.recipeCount,
			requestId: resolution.requestId,
			requestSeq: resolution.requestSeq,
			resolverMs: resolution.resolverMs,
			sourceLod: resolution.sourceLod,
			status: resolution.status,
			taskIds: resolution.taskIds,
		})),
		staticCoordinator: staticCoordinator?.summary ?? null,
		textureAtlas: textureAtlas?.summary ?? null,
	});

	if (samples.length > 600) {
		samples.splice(0, samples.length - 600);
	}

	for (const job of pendingJobs) {
		for (const event of job.traceEvents) {
			const key = [
				job.requestId,
				job.bakeBatchId,
				event.atMs,
				event.stage,
				JSON.stringify(event.details),
			].join("|");
			if (!workerEventsByKey.has(key)) {
				workerEventsByKey.set(key, {
					...event,
					bakeBatchId: job.bakeBatchId,
					domain: job.domain,
					itemCount: job.itemCount,
					key,
					requestId: job.requestId,
				});
			}
		}
	}
}

function waitForChromeDevToolsUrl(child) {
	return new Promise((resolve, reject) => {
		let buffer = "";
		const timeout = setTimeout(() => {
			reject(new Error("Timed out waiting for Chrome DevTools endpoint."));
		}, 60_000);
		child.once("exit", (code) => {
			clearTimeout(timeout);
			reject(
				new Error(`Chrome exited before DevTools startup with code ${code}.`),
			);
		});
		child.stderr.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (match?.[1]) {
				clearTimeout(timeout);
				resolve(match[1]);
			}
		});
	});
}

async function waitForPageWebSocketUrl(browserWebSocketUrl, expectedPageUrl) {
	const { port } = new URL(browserWebSocketUrl);
	const listUrl = `http://127.0.0.1:${port}/json/list`;
	const startedAt = Date.now();
	for (;;) {
		const targets = await fetch(listUrl).then((response) => response.json());
		const page =
			targets.find(
				(target) => target.type === "page" && target.url === expectedPageUrl,
			) ??
			targets.find(
				(target) =>
					target.type === "page" &&
					typeof target.url === "string" &&
					target.url.startsWith(expectedPageUrl),
			);
		if (page?.webSocketDebuggerUrl) {
			return page.webSocketDebuggerUrl;
		}
		if (Date.now() - startedAt >= 60_000) {
			throw new Error("Timed out waiting for Chrome page target.");
		}
		await delay(250);
	}
}

function createCdpClient(webSocketUrl) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(webSocketUrl);
		let nextId = 1;
		const pending = new Map();
		socket.addEventListener("open", () => {
			resolve({
				close() {
					socket.close();
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
				return;
			}
			const request = pending.get(message.id);
			if (!request) {
				return;
			}
			pending.delete(message.id);
			if (message.error) {
				request.reject(new Error(message.error.message));
			} else {
				request.resolve(message.result);
			}
		});
		socket.addEventListener("error", reject);
	});
}

async function waitForHarnessApi(client, timeoutMs) {
	const startedAt = Date.now();
	for (;;) {
		const available = await evaluateExpression(
			client,
			"Boolean(globalThis.__HOLTBURGER_3D_HARNESS__)",
		);
		if (available) {
			return;
		}
		if (Date.now() - startedAt >= timeoutMs) {
			const pageState = await evaluateExpression(
				client,
				"({ href: location.href, title: document.title, text: document.body?.innerText?.slice(0, 500) ?? '' })",
			);
			throw new Error(
				`Timed out waiting for browser harness API. Page state: ${JSON.stringify(pageState)}`,
			);
		}
		await delay(250);
	}
}

async function evaluate(client, functionExpression, args) {
	const result = await evaluateExpression(
		client,
		`(${functionExpression})(...${JSON.stringify(args)})`,
	);
	return result;
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

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
