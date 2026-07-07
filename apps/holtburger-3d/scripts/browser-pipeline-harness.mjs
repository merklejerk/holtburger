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
const DEFAULT_LANDBLOCK_ID = "0xda55ffff";
const EXPLICIT_OBJECT_RADIUS_EXPANSION_TARGET =
	"outdoor-static-object:outdoor-explicit-objects:dc56ffff:landblock-static/dc56ffff/object/0004/0200024b";

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
		dungeonId: options.dungeonId,
		envCellId: options.envCellId,
		headed: options.headed,
		landblockIds: options.landblockIds,
		lod: options.lod,
		scenario: options.scenario,
		settleDelayMs: options.settleDelayMs,
		sequenceRepeatCount: options.sequenceRepeatCount,
		staticPublicationMode: options.staticPublicationMode,
		targetObjectId: options.targetObjectId,
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
		dungeonId: null,
		envCellId: null,
		headed: false,
		landblockIds: [DEFAULT_LANDBLOCK_ID],
		lod: null,
		outputPath: null,
		scenario: "landblock-sequence",
		sequenceRepeatCount: 1,
		settleDelayMs: 0,
		staticPublicationMode: "defer-dense-renderer-until-ready",
		targetObjectId: EXPLICIT_OBJECT_RADIUS_EXPANSION_TARGET,
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
			case "--dungeon":
				parsed.dungeonId = requireValue(args, ++index, arg);
				break;
			case "--env-cell":
				parsed.envCellId = requireValue(args, ++index, arg);
				break;
			case "--headed":
				parsed.headed = true;
				break;
			case "--landblock":
				parsed.landblockIds = [requireValue(args, ++index, arg)];
				break;
			case "--landblocks":
				parsed.landblockIds = parseLandblocks(requireValue(args, ++index, arg));
				break;
			case "--layer-distance":
				parsed.lod = parseUniformLayerDistance(
					requireValue(args, ++index, arg),
				);
				break;
			case "--output":
				parsed.outputPath = requireValue(args, ++index, arg);
				break;
			case "--repeat":
				parsed.sequenceRepeatCount = Number(requireValue(args, ++index, arg));
				if (
					!Number.isInteger(parsed.sequenceRepeatCount) ||
					parsed.sequenceRepeatCount <= 0
				) {
					throw new Error("--repeat must be a positive integer.");
				}
				break;
			case "--scenario":
				parsed.scenario = parseScenario(requireValue(args, ++index, arg));
				break;
			case "--settle-delay-ms":
				parsed.settleDelayMs = Number(requireValue(args, ++index, arg));
				if (
					!Number.isFinite(parsed.settleDelayMs) ||
					parsed.settleDelayMs < 0
				) {
					throw new Error("--settle-delay-ms must be a non-negative number.");
				}
				break;
			case "--static-publication":
				parsed.staticPublicationMode = parseStaticPublicationMode(
					requireValue(args, ++index, arg),
				);
				break;
			case "--target-object":
				parsed.targetObjectId = requireValue(args, ++index, arg);
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
  --landblocks <csv>       Outdoor landblock sequence to load, in order.
  --dungeon <hex>          Dungeon landblock prefix or id for dungeon-cell scenario.
  --env-cell <hex>         Optional env-cell id for dungeon-cell scenario.
  --domains <csv>          Static domains to request. Default: ${DEFAULT_STATIC_DOMAINS.join(",")}
  --layer-distance <n>     Use one radius for every outdoor static layer.
  --repeat <count>         Repeat the landblock sequence. Default: 1
  --scenario <name>        Scenario: instantiate-only, landblock-sequence, explicit-object-radius-expansion, dungeon-cell.
  --settle-delay-ms <ms>   Delay after each settled scene before continuing. Default: 0
  --static-publication <mode> Static renderer publication: normal, suppress-dense-renderer, defer-dense-renderer-until-ready. Default: defer-dense-renderer-until-ready
  --target-object <id>     Static object id for explicit-object-radius-expansion diagnostics.
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

function parseLandblocks(value) {
	const landblocks = value
		.split(",")
		.map((landblock) => landblock.trim())
		.filter((landblock) => landblock.length > 0);
	if (landblocks.length === 0) {
		throw new Error("--landblocks must contain at least one landblock id.");
	}
	return landblocks;
}

function parseUniformLayerDistance(value) {
	const radius = Number(value);
	if (!Number.isInteger(radius) || radius < 0) {
		throw new Error("--layer-distance must be a non-negative integer.");
	}
	return {
		buildings: radius,
		envCells: radius,
		explicitObjects: radius,
		generatedScenery: radius,
		terrain: radius,
	};
}

function parseScenario(value) {
	if (
		value !== "instantiate-only" &&
		value !== "landblock-sequence" &&
		value !== "explicit-object-radius-expansion" &&
		value !== "dungeon-cell"
	) {
		throw new Error(
			"--scenario must be instantiate-only, landblock-sequence, explicit-object-radius-expansion, or dungeon-cell.",
		);
	}
	return value;
}

function parseStaticPublicationMode(value) {
	if (
		value === "normal" ||
		value === "suppress-dense-renderer" ||
		value === "defer-dense-renderer-until-ready"
	) {
		return value;
	}
	throw new Error(
		"--static-publication must be normal, suppress-dense-renderer, or defer-dense-renderer-until-ready.",
	);
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
	const openWorldStreaming = findOpenWorldStreamingDomain(domains);
	return {
		kind: "browser-pipeline-harness-summary",
		errorMessage: errorMessage ?? null,
		harnessScenario: diagnostics.harnessScenario ?? null,
		harnessFrameDiagnostics: diagnostics.harnessFrameDiagnostics ?? null,
		openWorldStreaming: openWorldStreaming?.summary ?? null,
		outputPath,
		runtime: diagnostics.runtime,
		runtimePipeline: diagnostics.runtimePipeline ?? null,
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
	dungeonId,
	envCellId,
	headed,
	landblockIds,
	lod,
	scenario,
	settleDelayMs,
	sequenceRepeatCount,
	staticPublicationMode,
	targetObjectId,
	timeoutMs,
	viteUrl,
}) {
	const userDataDir = await mkdtemp(join(tmpdir(), "holtburger-3d-browser-"));
	tempDirs.push(userDataDir);
	const pageUrl = `${viteUrl}/harness/browser-pipeline?assetHost=${encodeURIComponent(assetHostUrl)}&static-publication=${encodeURIComponent(staticPublicationMode)}`;
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
		const scenarioSteps = [];
		try {
			if (scenario === "instantiate-only") {
				scenarioSteps.push(
					await runInstantiateOnlyScenario({
						client,
					}),
				);
			} else if (scenario === "explicit-object-radius-expansion") {
				scenarioSteps.push(
					...(await runExplicitObjectRadiusExpansionScenario({
						client,
						targetObjectId,
						timeoutMs,
					})),
				);
			} else if (scenario === "dungeon-cell") {
				scenarioSteps.push(
					await runDungeonCellScenario({
						client,
						dungeonId,
						envCellId,
						timeoutMs,
					}),
				);
			} else {
				scenarioSteps.push(
					...(await runLandblockSequenceScenario({
						client,
						domains,
						landblockIds,
						lod,
						sequenceRepeatCount,
						settleDelayMs,
						timeoutMs,
					})),
				);
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		}
		const harnessTrace = await traceCollector.stop();
		const diagnostics = await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_HARNESS__.createDiagnosticsReport",
			[],
		);
		diagnostics.harnessScenario = {
			domains,
			dungeonId: scenario === "dungeon-cell" ? dungeonId : null,
			envCellId: scenario === "dungeon-cell" ? envCellId : null,
			kind: "browser-pipeline-harness-scenario",
			landblockIds,
			repeat: sequenceRepeatCount,
			runtimePipeline: "open-world-streaming",
			scenario,
			settleDelayMs,
			steps: scenarioSteps,
			targetObjectId:
				scenario === "explicit-object-radius-expansion" ? targetObjectId : null,
		};
		diagnostics.harnessTrace = harnessTrace;
		return { diagnostics, errorMessage };
	} finally {
		client.close();
	}
}

function createLandblockSequence(landblockIds, repeatCount) {
	const sequence = [];
	for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
		sequence.push(...landblockIds);
	}
	return sequence;
}

async function runInstantiateOnlyScenario({ client }) {
	const overview = await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_HARNESS__.createOverviewSnapshot",
		[],
	);
	const diagnostics = await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_HARNESS__.createDiagnosticsReport",
		[],
	);
	return {
		diagnosticsStatus: diagnostics.runtime?.status ?? null,
		kind: "instantiate-only",
		runtimePipeline: diagnostics.runtimePipeline ?? null,
		status: overview.status,
	};
}

async function runLandblockSequenceScenario({
	client,
	domains,
	landblockIds,
	lod,
	sequenceRepeatCount,
	settleDelayMs,
	timeoutMs,
}) {
	const steps = [];
	const sequence = createLandblockSequence(landblockIds, sequenceRepeatCount);
	for (let index = 0; index < sequence.length; index += 1) {
		const landblockId = sequence[index];
		const stepLod = lod ?? {};
		const overview = await requestOutdoorScene(client, {
			domains,
			landblockId,
			lod: stepLod,
			timeoutMs,
		});
		const diagnostics = await createDiagnosticsReport(client);
		steps.push(
			createHarnessScenarioStep({
				diagnostics,
				index,
				landblockId,
				lod: stepLod,
				overview,
				stepName: "landblock-sequence",
			}),
		);
		if (settleDelayMs > 0 && index < sequence.length - 1) {
			await delay(settleDelayMs);
		}
	}
	return steps;
}

async function runExplicitObjectRadiusExpansionScenario({
	client,
	targetObjectId,
	timeoutMs,
}) {
	const targetSelectionKey = parseOutdoorStaticObjectId(targetObjectId);
	const domains = DEFAULT_STATIC_DOMAINS;
	const landblockId = "0xdc560000";
	const initialLod = {
		buildings: 1,
		envCells: 0,
		explicitObjects: 0,
		generatedScenery: 0,
		terrain: 1,
	};
	const expandedLod = {
		...initialLod,
		explicitObjects: 1,
	};
	const scenarioInputs = [
		{
			landblockId,
			lod: initialLod,
			stepName: "initial-explicit-radius-0",
		},
		{
			landblockId,
			lod: expandedLod,
			stepName: "expanded-explicit-radius-1",
		},
	];
	const steps = [];
	for (let index = 0; index < scenarioInputs.length; index += 1) {
		const input = scenarioInputs[index];
		const overview = await requestOutdoorScene(client, {
			domains,
			landblockId: input.landblockId,
			lod: input.lod,
			timeoutMs,
		});
		const diagnostics = await createDiagnosticsReport(client);
		const targetSelection = await createStaticSelectionDiagnosticsReport(
			client,
			targetSelectionKey,
		);
		steps.push(
			createHarnessScenarioStep({
				diagnostics,
				index,
				landblockId: input.landblockId,
				lod: input.lod,
				overview,
				stepName: input.stepName,
				targetSelection,
			}),
		);
	}
	return steps;
}

async function runDungeonCellScenario({
	client,
	dungeonId,
	envCellId,
	timeoutMs,
}) {
	if (!dungeonId) {
		throw new Error("--scenario dungeon-cell requires --dungeon.");
	}
	const target = createDungeonCellTarget(dungeonId, envCellId);
	const overview = await requestInteriorCell(client, {
		envCellId: target.envCellId,
		landblockId: target.landblockId,
		timeoutMs,
	});
	const diagnostics = await createDiagnosticsReport(client);
	return createHarnessScenarioStep({
		diagnostics,
		envCellId: target.envCellId,
		index: 0,
		landblockId: target.landblockId,
		lod: null,
		overview,
		stepName: "dungeon-cell",
	});
}

async function requestOutdoorScene(client, options) {
	return evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_HARNESS__.requestOutdoorScene",
		[options],
	);
}

async function requestInteriorCell(client, options) {
	return evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_HARNESS__.requestInteriorCell",
		[options],
	);
}

async function createDiagnosticsReport(client) {
	return evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_HARNESS__.createDiagnosticsReport",
		[],
	);
}

async function createStaticSelectionDiagnosticsReport(client, selectionKey) {
	return evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_HARNESS__.createStaticSelectionDiagnosticsReport",
		[selectionKey],
	);
}

function parseOutdoorStaticObjectId(value) {
	const prefix = "outdoor-static-object:";
	if (!value.startsWith(prefix)) {
		throw new Error(`Target object id must start with ${prefix}: ${value}.`);
	}
	const withoutPrefix = value.slice(prefix.length);
	const parts = withoutPrefix.split(":");
	if (parts.length !== 3) {
		throw new Error(`Target object id is invalid: ${value}.`);
	}
	const [domain, landblockHex, instanceId] = parts;
	if (
		domain !== "outdoor-buildings" &&
		domain !== "outdoor-explicit-objects" &&
		domain !== "outdoor-generated-scenery"
	) {
		throw new Error(`Target object domain is invalid: ${domain}.`);
	}
	return {
		domain,
		instanceId,
		itemKind: "outdoor-static-object",
		landblockId: parseHexLandblockId(landblockHex),
	};
}

function parseHexLandblockId(value) {
	const parsed = Number.parseInt(
		value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value,
		16,
	);
	if (!Number.isInteger(parsed)) {
		throw new Error(`Invalid landblock id ${value}.`);
	}
	return parsed >>> 0;
}

function createDungeonCellTarget(dungeonId, envCellId) {
	const landblockId = parseDungeonLandblockId(dungeonId);
	return {
		envCellId:
			envCellId === null || envCellId === undefined
				? ((landblockId & 0xffff0000) | 0x0100) >>> 0
				: parseHexLandblockId(envCellId),
		landblockId,
	};
}

function parseDungeonLandblockId(value) {
	const parsed = parseHexLandblockId(value);
	return parsed <= 0xffff ? ((parsed << 16) | 0xffff) >>> 0 : parsed;
}

function createHarnessScenarioStep({
	diagnostics,
	envCellId,
	index,
	landblockId,
	lod,
	overview,
	stepName,
	targetSelection,
}) {
	const domains = Array.isArray(diagnostics.domains) ? diagnostics.domains : [];
	const openWorldStreaming = findOpenWorldStreamingDomain(domains);
	return {
		index,
		envCellId: envCellId ?? null,
		landblockId,
		lod,
		openWorldStreaming: openWorldStreaming?.summary ?? null,
		runtime: diagnostics.runtime,
		staticOverview: overview.static,
		stepName,
		targetSelection: targetSelection ?? null,
	};
}

function collectPipelineTrace(client, timeoutMs) {
	const samples = [];
	let stopped = false;
	const sampleIntervalMs = 1000;
	const startedAt = Date.now();

	const interval = setInterval(() => {
		if (stopped || Date.now() - startedAt > timeoutMs + sampleIntervalMs) {
			return;
		}
		void samplePipelineTrace(client, samples);
	}, sampleIntervalMs);

	void samplePipelineTrace(client, samples);

	return {
		async stop() {
			stopped = true;
			clearInterval(interval);
			await samplePipelineTrace(client, samples);
			return {
				kind: "browser-pipeline-harness-trace",
				samples,
				workerEvents: [],
			};
		},
	};
}

async function samplePipelineTrace(client, samples) {
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
	const openWorldStreaming = findOpenWorldStreamingDomain(domains);

	samples.push({
		atMs: Date.now(),
		harnessFrameDiagnostics: diagnostics.harnessFrameDiagnostics ?? null,
		openWorldStreaming: openWorldStreaming?.summary ?? null,
		renderer: diagnostics.runtime,
	});

	if (samples.length > 600) {
		samples.splice(0, samples.length - 600);
	}
}

function findOpenWorldStreamingDomain(domains) {
	return domains.find((domain) => domain.kind === "open-world-streaming");
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
