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
const DEFAULT_PORTAL_GRAPH_WORK_LIMIT = 100_000;
const DEFAULT_VIEWPORT_WIDTH = 1_280;
const DEFAULT_VIEWPORT_HEIGHT = 720;
const DEFAULT_DEVICE_SCALE_FACTOR = 1;
/** Harness-local mirror of the browser policy contract, including capability admission. */
const TEXTURE_FILTERING_OPTIONS = [
	{ minimumAnisotropy: 1, policy: "nearest" },
	{ minimumAnisotropy: 1, policy: "linear" },
	{ minimumAnisotropy: 2, policy: "anisotropic-2x" },
	{ minimumAnisotropy: 4, policy: "anisotropic-4x" },
	{ minimumAnisotropy: 8, policy: "anisotropic-8x" },
];
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
			options.brief
				? briefHarnessReport(result)
				: {
						buildingRadius: options.buildingRadius,
						camera: result.state.camera,
						envCellRadius: options.envCellRadius,
						cameraPitchDegrees: options.cameraPitchDegrees,
						cameraYawDegrees: options.cameraYawDegrees,
						explicitObjectRadius: options.explicitObjectRadius,
						generatedObjectRadius: options.generatedObjectRadius,
						cameraLandblockId: options.cameraLandblockId,
						relocateLandblockId: options.relocateLandblockId,
						portalTrace: result.portalTrace,
						frameMode: options.frameMode,
						frameSettings: result.state.frameSettings,
						frameProfile: result.state.frameProfile,
						textureFiltering: options.textureFiltering,
						filteringCycleStates: result.filteringCycleStates,
						modeCycleStates: result.modeCycleStates,
						portalExecution: result.portalExecution,
						portalRenderGraph: result.portalRenderGraph,
						portalContextLossPolicy: result.state.portalContextLossPolicy,
						portalSubstrate: result.state.portalSubstrate,
						hybridPortalExecution: result.state.hybridPortalExecution,
						internalPortalExecutionFixture:
							result.state.internalPortalExecution,
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
						isolateAuthoredDynamics: options.isolateAuthoredDynamics,
						excludeAuthoredDynamics: options.excludeAuthoredDynamics,
						measureMs: options.measureMs,
						settleMs: options.settleMs,
						viewport: result.state.viewport,
					},
			null,
			2,
		)}\n`,
	);
	if (result.state.error) {
		throw new Error(
			`Browser harness reported startup failure: ${result.state.error}`,
		);
	}
	if (browserErrors.length > 0) {
		throw new Error(
			`Browser harness observed browser errors: ${browserErrors.map(({ text }) => text).join(" | ")}`,
		);
	}
	if (options.modeCycle) {
		assertModeCycle(result.initialState, result.modeCycleStates);
	}
	if (options.filteringCycle) {
		assertFilteringCycle(result.initialState, result.filteringCycleStates);
	}
	if (options.fixture === "portal-substrate") {
		assertPortalSubstrateFixture(result.state);
	}
	if (options.fixture === "portal-hybrid-execution") {
		assertHybridPortalExecutionFixture(result.state);
	}
	if (options.fixture === "portal-internal-execution") {
		assertInternalPortalExecutionFixture(result.state);
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
		brief: false,
		landblockId: DEFAULT_LANDBLOCK_ID,
		buildingRadius: 0,
		envCellRadius: null,
		cameraPitchDegrees: -45,
		cameraYawDegrees: 0,
		cameraHeight: 600,
		cameraPosition: null,
		cameraEndPitchDegrees: null,
		cameraEndYawDegrees: null,
		explorerFocus: false,
		explicitObjectRadius: null,
		generatedObjectRadius: null,
		disableGeneratedBeforeCapture: false,
		isolateAuthoredDynamics: false,
		excludeAuthoredDynamics: false,
		cameraLandblockId: null,
		relocateLandblockId: null,
		traceAnchorCellId: null,
		traceStart: null,
		traceEndpoint: null,
		envCellCameraId: null,
		envCellCameraPosition: null,
		portalWorkLimit: DEFAULT_PORTAL_GRAPH_WORK_LIMIT,
		minimumPortalFootprintPixelArea: null,
		minimumObjectFootprintPixelArea: null,
		offscreenAnimationSampleIntervalMs: null,
		probePortalGraph: false,
		executePortal: false,
		frameMode: null,
		timeOfDay: null,
		modeCycle: false,
		filteringCycle: false,
		profileRenderer: false,
		textureFiltering: null,
		lifecycle: false,
		fixture: null,
		screenshotPath: null,
		measureMs: 0,
		settleMs: DEFAULT_SETTLE_MS,
		viewportWidth: DEFAULT_VIEWPORT_WIDTH,
		viewportHeight: DEFAULT_VIEWPORT_HEIGHT,
		deviceScaleFactor: DEFAULT_DEVICE_SCALE_FACTOR,
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--brief":
				parsed.brief = true;
				break;
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
			case "--env-cell-radius":
				parsed.envCellRadius = Number(requireValue(args, ++index, arg));
				if (
					!Number.isInteger(parsed.envCellRadius) ||
					parsed.envCellRadius < 0
				) {
					throw new Error("--env-cell-radius must be a non-negative integer.");
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
			case "--isolate-authored-dynamics":
				parsed.isolateAuthoredDynamics = true;
				break;
			case "--exclude-authored-dynamics":
				parsed.excludeAuthoredDynamics = true;
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
			case "--camera-height":
				parsed.cameraHeight = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(parsed.cameraHeight)) {
					throw new Error("--camera-height must be finite.");
				}
				break;
			case "--camera-position":
				parsed.cameraPosition = parsePoint(
					requireValue(args, ++index, arg),
					arg,
				);
				break;
			case "--camera-end-yaw":
				parsed.cameraEndYawDegrees = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(parsed.cameraEndYawDegrees)) {
					throw new Error("--camera-end-yaw must be finite.");
				}
				break;
			case "--camera-end-pitch":
				parsed.cameraEndPitchDegrees = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(parsed.cameraEndPitchDegrees)) {
					throw new Error("--camera-end-pitch must be finite.");
				}
				break;
			case "--explorer-focus":
				parsed.explorerFocus = true;
				break;
			case "--viewport-width":
				parsed.viewportWidth = parsePositiveInteger(
					requireValue(args, ++index, arg),
					arg,
				);
				break;
			case "--viewport-height":
				parsed.viewportHeight = parsePositiveInteger(
					requireValue(args, ++index, arg),
					arg,
				);
				break;
			case "--device-scale-factor":
				parsed.deviceScaleFactor = Number(requireValue(args, ++index, arg));
				if (
					!Number.isFinite(parsed.deviceScaleFactor) ||
					parsed.deviceScaleFactor <= 0
				) {
					throw new Error("--device-scale-factor must be a positive number.");
				}
				break;
			case "--lifecycle":
				parsed.lifecycle = true;
				break;
			case "--trace-anchor-cell":
				parsed.traceAnchorCellId = requireValue(args, ++index, arg);
				break;
			case "--trace-start":
				parsed.traceStart = parsePoint(requireValue(args, ++index, arg), arg);
				break;
			case "--trace-end":
				parsed.traceEndpoint = parsePoint(
					requireValue(args, ++index, arg),
					arg,
				);
				break;
			case "--env-cell-camera":
				parsed.envCellCameraId = requireValue(args, ++index, arg);
				break;
			case "--env-cell-position":
				parsed.envCellCameraPosition = parsePoint(
					requireValue(args, ++index, arg),
					arg,
				);
				break;
			case "--portal-work-limit":
				parsed.portalWorkLimit = Number(requireValue(args, ++index, arg));
				if (
					!Number.isInteger(parsed.portalWorkLimit) ||
					parsed.portalWorkLimit <= 0
				) {
					throw new Error("--portal-work-limit must be a positive integer.");
				}
				break;
			case "--minimum-portal-footprint-pixel-area":
				parsed.minimumPortalFootprintPixelArea = Number(
					requireValue(args, ++index, arg),
				);
				if (
					!Number.isFinite(parsed.minimumPortalFootprintPixelArea) ||
					parsed.minimumPortalFootprintPixelArea < 0
				) {
					throw new Error(
						"--minimum-portal-footprint-pixel-area must be a non-negative number.",
					);
				}
				break;
			case "--minimum-object-footprint-pixel-area":
				parsed.minimumObjectFootprintPixelArea = Number(
					requireValue(args, ++index, arg),
				);
				if (
					!Number.isFinite(parsed.minimumObjectFootprintPixelArea) ||
					parsed.minimumObjectFootprintPixelArea < 0
				) {
					throw new Error(
						"--minimum-object-footprint-pixel-area must be a non-negative number.",
					);
				}
				break;
			case "--offscreen-animation-sample-interval-ms":
				parsed.offscreenAnimationSampleIntervalMs = Number(
					requireValue(args, ++index, arg),
				);
				if (
					!Number.isFinite(parsed.offscreenAnimationSampleIntervalMs) ||
					parsed.offscreenAnimationSampleIntervalMs < 0
				) {
					throw new Error(
						"--offscreen-animation-sample-interval-ms must be a non-negative number.",
					);
				}
				break;
			case "--probe-portal-graph":
				parsed.probePortalGraph = true;
				break;
			case "--execute-portal":
				parsed.executePortal = true;
				break;
			case "--time-of-day": {
				const value = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(value) || value < 0 || value >= 1) {
					throw new Error("--time-of-day must be in [0, 1).");
				}
				parsed.timeOfDay = value;
				break;
			}
			case "--frame-mode":
				parsed.frameMode = requireValue(args, ++index, arg);
				if (!["flat", "portal"].includes(parsed.frameMode)) {
					throw new Error("--frame-mode must be flat or portal.");
				}
				break;
			case "--mode-cycle":
				parsed.modeCycle = true;
				break;
			case "--filtering-cycle":
				parsed.filteringCycle = true;
				break;
			case "--profile-renderer":
				parsed.profileRenderer = true;
				break;
			case "--texture-filtering":
				parsed.textureFiltering = requireValue(args, ++index, arg);
				if (
					!TEXTURE_FILTERING_OPTIONS.some(
						({ policy }) => policy === parsed.textureFiltering,
					)
				) {
					throw new Error(
						`--texture-filtering must be one of ${TEXTURE_FILTERING_OPTIONS.map(({ policy }) => policy).join(", ")}.`,
					);
				}
				break;
			case "--fixture":
				parsed.fixture = requireValue(args, ++index, arg);
				if (
					![
						"blended",
						"instanced",
						"portal-hybrid-execution",
						"portal-internal-execution",
						"portal-substrate",
					].includes(parsed.fixture)
				) {
					throw new Error(
						"--fixture must be blended, instanced, portal-hybrid-execution, portal-internal-execution, or portal-substrate.",
					);
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
			case "--measure-ms":
				parsed.measureMs = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(parsed.measureMs) || parsed.measureMs < 0) {
					throw new Error("--measure-ms must be a non-negative number.");
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
		parsed.envCellRadius !== null &&
		parsed.envCellRadius > parsed.buildingRadius
	) {
		throw new Error(
			"--env-cell-radius must be no greater than --building-radius.",
		);
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
	if (parsed.filteringCycle && parsed.textureFiltering !== null) {
		throw new Error(
			"--filtering-cycle and --texture-filtering cannot be combined.",
		);
	}
	if (parsed.isolateAuthoredDynamics && parsed.excludeAuthoredDynamics) {
		throw new Error(
			"--isolate-authored-dynamics and --exclude-authored-dynamics cannot be combined.",
		);
	}
	if (parsed.cameraLandblockId && parsed.relocateLandblockId) {
		throw new Error(
			"--camera-landblock and --relocate-landblock cannot be combined.",
		);
	}
	if (
		parsed.explorerFocus &&
		(parsed.cameraLandblockId ||
			parsed.relocateLandblockId ||
			parsed.envCellCameraId ||
			parsed.cameraPosition)
	) {
		throw new Error(
			"--explorer-focus cannot be combined with another camera or relocation option.",
		);
	}
	if (
		parsed.cameraPosition &&
		(parsed.cameraLandblockId ||
			parsed.relocateLandblockId ||
			parsed.envCellCameraId)
	) {
		throw new Error(
			"--camera-position cannot be combined with another camera or relocation option.",
		);
	}
	const cameraEndOptionCount = [
		parsed.cameraEndYawDegrees,
		parsed.cameraEndPitchDegrees,
	].filter((value) => value !== null).length;
	if (cameraEndOptionCount !== 0 && cameraEndOptionCount !== 2) {
		throw new Error(
			"--camera-end-yaw and --camera-end-pitch must be supplied together.",
		);
	}
	if (cameraEndOptionCount !== 0 && parsed.cameraPosition === null) {
		throw new Error(
			"--camera-end-yaw and --camera-end-pitch require --camera-position.",
		);
	}
	const traceOptionCount = [
		parsed.traceAnchorCellId,
		parsed.traceStart,
		parsed.traceEndpoint,
	].filter((value) => value !== null).length;
	if (traceOptionCount !== 0 && traceOptionCount !== 3) {
		throw new Error(
			"--trace-anchor-cell, --trace-start, and --trace-end must be supplied together.",
		);
	}
	const envCellCameraOptionCount = [
		parsed.envCellCameraId,
		parsed.envCellCameraPosition,
	].filter((value) => value !== null).length;
	if (envCellCameraOptionCount !== 0 && envCellCameraOptionCount !== 2) {
		throw new Error(
			"--env-cell-camera and --env-cell-position must be supplied together.",
		);
	}
	if (
		(parsed.executePortal || parsed.probePortalGraph) &&
		envCellCameraOptionCount !== 2
	) {
		throw new Error(
			"--execute-portal and --probe-portal-graph require an EnvCell camera and position.",
		);
	}
	return parsed;
}

function parsePoint(value, label) {
	const coordinates = value.split(",").map(Number);
	if (
		coordinates.length !== 3 ||
		coordinates.some((coordinate) => !Number.isFinite(coordinate))
	) {
		throw new Error(`${label} must be a finite comma-separated x,y,z tuple.`);
	}
	return coordinates;
}

function parsePositiveInteger(value, label) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${label} must be a positive integer.`);
	}
	return parsed;
}

function requireValue(args, index, label) {
	const value = args[index];
	if (!value) throw new Error(`${label} requires a value.`);
	return value;
}

function printHelp() {
	process.stdout.write(`Usage: npm run harness:browser -- [options]

Options:
  --landblock <hex>     Outdoor landblock to render. Default: ${DEFAULT_LANDBLOCK_ID}
  --brief               Print frame and content-summary evidence instead of full diagnostics.

  --building-radius <n> Request a square terrain/building neighborhood. Default: 0
  --env-cell-radius <n> Request EnvCells within the building neighborhood.
  --explicit-object-radius <n> Request explicit objects within the building neighborhood.
  --generated-object-radius <n> Request generated objects within the building neighborhood.
  --disable-generated-before-capture
                         Withdraw generated interest after the initial snapshot.
  --isolate-authored-dynamics
                         Keep terrain and promoted outdoor dynamics but strip outdoor statics.
  --exclude-authored-dynamics
                         Keep outdoor statics but strip promoted dynamics.
  --camera-yaw <degrees>    Initial and relocation camera yaw. Default: 0
  --camera-pitch <degrees>  Initial and relocation camera pitch. Default: -45
  --camera-position <x,y,z>
                         Explicit canonical outdoor camera position.
  --camera-end-yaw <degrees>
  --camera-end-pitch <degrees>
                         Apply a second orientation after settlement; requires --camera-position.
  --explorer-focus      Apply the Explorer's automatic outdoor camera pose after loading.
  --viewport-width <px> CSS render width. Default: ${DEFAULT_VIEWPORT_WIDTH}
  --viewport-height <px> CSS render height. Default: ${DEFAULT_VIEWPORT_HEIGHT}
  --device-scale-factor <n> Browser device scale factor. Default: ${DEFAULT_DEVICE_SCALE_FACTOR}
  --camera-landblock <hex>  Move only the camera after the initial request.
  --relocate-landblock <hex> Replace scene interest and camera at a new landblock.
  --lifecycle           Clear and reload the requested neighborhood before capture.
  --trace-anchor-cell <hex>
                         Authoritative EnvCell DID for a production portal trace.
  --trace-start <x,y,z> Trace anchor in canonical world coordinates.
  --trace-end <x,y,z>   Desired endpoint in canonical world coordinates.
  --env-cell-camera <hex>
                         Authoritative EnvCell residency for the continuous camera.
  --env-cell-position <x,y,z>
                         Canonical position for the EnvCell camera.
  --portal-work-limit <n>
                         Explicit planner safety bound. Default: ${DEFAULT_PORTAL_GRAPH_WORK_LIMIT}
  --minimum-portal-footprint-pixel-area <px2>
                         Override the production recursive portal-footprint cutoff.
  --minimum-object-footprint-pixel-area <px2>
                         Override independently optional object footprint culling.
  --offscreen-animation-sample-interval-ms <ms>
                         Override offscreen visual animation sampling; zero is full cadence.
  --probe-portal-graph   Run the one-shot pure portal graph diagnostic.
  --execute-portal
                         Execute the complete planned graph through production GPU passes.
  --time-of-day <0..1>  Resolve region lighting and fog at this day fraction.
  --frame-mode <flat|portal>
                         Change continuous rendering policy without reloading content.
  --mode-cycle           Exercise portal, flat, portal, flat frames without reloading content.
  --filtering-cycle      Change filtering during loading, then cycle supported modes without reload.
  --profile-renderer     Enable opt-in renderer CPU/GPU profiling before capture.
  --texture-filtering <mode>
                         Select nearest, linear, or anisotropic-2x/4x/8x before content settles.
  --fixture <name>      Use the blended, instanced, portal-hybrid-execution,
                         portal-internal-execution, or portal-substrate fixture.
  --settle-ms <ms>      Wait after requesting scene content. Default: ${DEFAULT_SETTLE_MS}
  --measure-ms <ms>     Reset timings after settling, then measure steady-state frames.
  --screenshot <path>   Persist the captured PNG after the harness exits.
  --chrome-path <path>  Chrome executable. Default: ${DEFAULT_CHROME_PATH}
`);
}

function assertPortalSubstrateFixture(state) {
	const capabilities = state.portalTargetCapabilities;
	if (
		capabilities?.framebufferComplete !== true ||
		capabilities.colorFormat !== "RGBA8" ||
		capabilities.depthStencilFormat !== "DEPTH24_STENCIL8" ||
		capabilities.depthBits !== 24 ||
		capabilities.stencilBits !== 8 ||
		capabilities.maximumTextureSize < 16
	) {
		throw new Error(
			`Portal target capability probe failed: ${JSON.stringify(capabilities)}.`,
		);
	}
	const fixture = state.portalSubstrate;
	if (!fixture) {
		throw new Error("Portal substrate fixture did not publish evidence.");
	}
	for (const field of [
		"arbitraryApertureMaskPassed",
		"finalPresentationPassed",
		"layerUnionPassed",
		"maskedDepthResetPassed",
		"maskedDepthResetRetainedColor",
		"maskedSceneInitializationPassed",
		"nestedLayerConfinementPassed",
		"ordinaryStateRestored",
		"orderedLayerOverwritePassed",
		"parentConstrainedApertureMaskPassed",
		"parentConstrainedWindowMaskPassed",
		"resizedTargetReplaced",
	]) {
		if (fixture[field] !== true) {
			throw new Error(`Portal substrate fixture failed ${field}.`);
		}
	}
	assertTargetDiagnostics(fixture.targetDiagnostics, {
		activeBytes: 512,
		activeTargetCount: 1,
		allocatedTargetCount: 1,
		disposedTargetCount: 0,
		extent: { height: 8, width: 8 },
	});
	assertTargetDiagnostics(fixture.resizedDiagnostics, {
		activeBytes: 2_048,
		activeTargetCount: 1,
		allocatedTargetCount: 2,
		disposedTargetCount: 1,
		extent: { height: 16, width: 16 },
	});
	assertTargetDiagnostics(fixture.disposedDiagnostics, {
		activeBytes: 0,
		activeTargetCount: 0,
		allocatedTargetCount: 2,
		disposedTargetCount: 2,
		extent: null,
	});
	const contextLoss = state.portalContextLossPolicy;
	if (
		!contextLoss?.lossEventCanceled ||
		!contextLoss.operationRejected ||
		!contextLoss.rendererDrawRejected ||
		contextLoss.status?.kind !== "restart-required"
	) {
		throw new Error(
			`Portal context-loss policy failed: ${JSON.stringify(contextLoss)}.`,
		);
	}
	const metrics = state.metrics;
	if (
		!metrics ||
		metrics.envCellRenderMode !== "flat" ||
		metrics.submittedPortalApertureDrawCount !== 0 ||
		metrics.sceneDomainTargetCount !== 0
	) {
		throw new Error(
			`Portal substrate fixture contaminated flat rendering: ${JSON.stringify(metrics)}.`,
		);
	}
}

function briefHarnessReport(result) {
	const staticObjects = result.state.staticObjects;
	const authoredDynamics = result.state.authoredDynamics;
	return {
		authoredDynamics:
			authoredDynamics === null
				? null
				: {
						animation: authoredDynamics.animation,
						dynamics: authoredDynamics.dynamics,
						presentationCadence: authoredDynamics.presentationCadence,
						effects: {
							residentEffectStateCount:
								authoredDynamics.effects.residentEffectStateCount,
							deferredHookCount: authoredDynamics.effects.deferredHookCount,
							executedHookCount: authoredDynamics.effects.executedHookCount,
							recentObservationCount:
								authoredDynamics.effects.observations.length,
						},
						residentCount: authoredDynamics.residents.length,
					},
		consoleMessages: result.consoleMessages.filter(
			({ level }) => level === "error" || level === "exception",
		),
		envCellLayers: summarizeEnvCellLayers(staticObjects?.envCellLayers ?? []),
		finalMetrics: result.state.metrics,
		frameProfile: result.state.frameProfile,
		frameSettings: result.state.frameSettings,
		initialMetrics: result.initialState.metrics,
		initialCamera: result.initialState.camera,
		modeCycleMetrics: result.modeCycleStates.map((state) => state.metrics),
		filteringCycle: result.filteringCycleStates.map(
			({ frameSettings }) => frameSettings.quality.textureFiltering,
		),
		filteringCapabilities: result.state.textureFilteringCapabilities,
		camera: result.state.camera,
		viewport: result.state.viewport,
		ready: result.state.ready,
		sourceBatches: summarizeSourceBatches(result.state.sourceBatches),
		staticResourceCounts:
			staticObjects === null
				? null
				: {
						geometryResourceCount: staticObjects.geometryResourceCount,
						staticObjectNodeCount: staticObjects.staticObjectNodeCount,
						staticObjectOwnerCount: staticObjects.staticObjectOwnerCount,
						textureAtlasPageCount: staticObjects.textureAtlasPages.length,
						textureResidentSourceCount:
							staticObjects.texture.residentSourceCount,
					},
		timing: result.state.timing,
	};
}

function summarizeEnvCellLayers(envCellLayers) {
	return envCellLayers.reduce(
		(summary, layer) => ({
			apertureCount: summary.apertureCount + layer.apertureCount,
			expectedCellCount: summary.expectedCellCount + layer.expectedCellCount,
			landblockCount: summary.landblockCount + 1,
			plannedStaticResidentCount:
				summary.plannedStaticResidentCount + layer.plannedStaticResidentCount,
			shellCount: summary.shellCount + layer.shellCount,
		}),
		{
			apertureCount: 0,
			expectedCellCount: 0,
			landblockCount: 0,
			plannedStaticResidentCount: 0,
			shellCount: 0,
		},
	);
}

function summarizeSourceBatches(sourceBatches) {
	const layerCounts = {};
	let responseBytes = 0;
	for (const batch of sourceBatches) {
		responseBytes += batch.responseBytes;
		for (const layer of batch.layers) {
			layerCounts[layer] = (layerCounts[layer] ?? 0) + 1;
		}
	}
	return {
		batchCount: sourceBatches.length,
		layerCounts,
		responseBytes,
	};
}

function assertModeCycle(initialState, states) {
	const expectedModes = ["portal", "flat", "portal", "flat"];
	if (states.length !== expectedModes.length) {
		throw new Error(
			`Mode cycle produced ${states.length} snapshots, expected ${expectedModes.length}.`,
		);
	}
	const initialResources = JSON.stringify({
		sourceBatches: initialState.sourceBatches,
		staticObjects: initialState.staticObjects,
	});
	for (const [index, expectedMode] of expectedModes.entries()) {
		const state = states[index];
		if (state?.metrics?.envCellRenderMode !== expectedMode) {
			throw new Error(
				`Mode cycle snapshot ${index} reported ${state?.metrics?.envCellRenderMode ?? "no mode"}, expected ${expectedMode}.`,
			);
		}
		const resources = JSON.stringify({
			sourceBatches: state.sourceBatches,
			staticObjects: state.staticObjects,
		});
		if (resources !== initialResources) {
			throw new Error(
				`Mode cycle snapshot ${index} changed content or resource ownership.`,
			);
		}
		if (expectedMode === "flat") {
			for (const key of [
				"portalExteriorRenderCount",
				"portalMaskEdgeCount",
				"portalNearPlaneSeedCount",
				"portalRenderLayerCount",
				"portalRenderNodeCount",
				"portalRejectedFacingCrossingCount",
				"portalRejectedFootprintCount",
				"portalSameDomainBoundaryCrossingCount",
				"portalSubmittedRenderNodeCount",
				"submittedPortalApertureDrawCount",
			]) {
				if (state.metrics[key] !== 0) {
					throw new Error(
						`Flat mode cycle snapshot ${index} retained portal frame work in ${key}.`,
					);
				}
			}
		}
	}
	const firstPortalTargets = states[0].metrics.sceneDomainTargetCount;
	const firstPortalTargetBytes = states[0].metrics.sceneDomainTargetBytes;
	if (firstPortalTargets <= 0 || firstPortalTargetBytes <= 0) {
		throw new Error(
			"Mode cycle portal frame did not retain scene-domain targets and bytes.",
		);
	}
	for (const [index, state] of states.entries()) {
		if (
			state.metrics.sceneDomainTargetCount !== firstPortalTargets ||
			state.metrics.sceneDomainTargetBytes !== firstPortalTargetBytes
		) {
			throw new Error(
				`Mode cycle snapshot ${index} drifted retained portal target ownership.`,
			);
		}
	}
}

function assertFilteringCycle(initialState, states) {
	const maximum =
		initialState.textureFilteringCapabilities?.maximumAnisotropy ?? 1;
	const expected = supportedTextureFilteringPolicies(maximum);
	if (states.length !== expected.length) {
		throw new Error(
			`Filtering cycle produced ${states.length} snapshots, expected ${expected.length}.`,
		);
	}
	const initialResources = JSON.stringify(initialState.staticObjects);
	for (const [index, policy] of expected.entries()) {
		const state = states[index];
		if (state?.frameSettings?.quality?.textureFiltering !== policy) {
			throw new Error(
				`Filtering cycle step ${index} expected ${policy}: ${JSON.stringify(state?.frameSettings)}.`,
			);
		}
		if (JSON.stringify(state.staticObjects) !== initialResources) {
			throw new Error(
				`Filtering cycle ${policy} changed resident resources without a content request.`,
			);
		}
	}
}

function assertHybridPortalExecutionFixture(state) {
	const fixture = state.hybridPortalExecution;
	if (!fixture) {
		throw new Error(
			"Direct exterior contribution fixture did not publish evidence.",
		);
	}
	for (const field of [
		"blendOrderingPassed",
		"exteriorDepthOcclusionPassed",
		"hybridCyclePassed",
		"hybridStraddlePassed",
		"interiorDepthOrderingPassed",
		"multiWindowUnionPassed",
		"noStaleViewReusePassed",
		"rootReentryPassed",
		"straddleDualSidePassed",
		"straddleExteriorBranchPassed",
		"targetReusePassed",
		"tunnelDepthResetPassed",
	]) {
		if (fixture[field] !== true) {
			throw new Error(
				`Direct exterior contribution fixture failed ${field}: ${JSON.stringify(fixture)}.`,
			);
		}
	}
	const expectedOutdoor = {
		admittedScopeWindowStateCount: 0,
		exteriorRenderCount: 1,
		maskDrawCount: 2,
		maskEdgeCount: 2,
		nearPlaneSeedCount: 0,
		rejectedFacingCrossingCount: 0,
		sameDomainBoundaryCrossingCount: 0,
		renderLayerCount: 2,
		renderNodeCount: 2,
		submittedRenderNodeCount: 2,
	};
	const expectedIndoor = { ...expectedOutdoor };
	if (JSON.stringify(fixture.outdoorRoot) !== JSON.stringify(expectedOutdoor)) {
		throw new Error(
			`Exterior-root composition diagnostics mismatch: ${JSON.stringify(fixture.outdoorRoot)}.`,
		);
	}
	if (JSON.stringify(fixture.indoorRoot) !== JSON.stringify(expectedIndoor)) {
		throw new Error(
			`Indoor-root composition diagnostics mismatch: ${JSON.stringify(fixture.indoorRoot)}.`,
		);
	}
	const expectedOutdoorStraddle = {
		...expectedOutdoor,
		maskDrawCount: 2,
		nearPlaneSeedCount: 1,
		renderNodeCount: 3,
		submittedRenderNodeCount: 3,
	};
	const expectedIndoorStraddle = {
		...expectedOutdoorStraddle,
		renderLayerCount: 3,
	};
	if (
		JSON.stringify(fixture.outdoorStraddle) !==
		JSON.stringify(expectedOutdoorStraddle)
	) {
		throw new Error(
			`outdoor straddle diagnostics mismatch: ${JSON.stringify(fixture.outdoorStraddle)}.`,
		);
	}
	if (
		JSON.stringify(fixture.indoorStraddle) !==
		JSON.stringify(expectedIndoorStraddle)
	) {
		throw new Error(
			`indoor straddle diagnostics mismatch: ${JSON.stringify(fixture.indoorStraddle)}.`,
		);
	}
	const expectedHybridTrace = {
		admittedScopeWindowStateCount: 4,
		exteriorRenderCount: 1,
		maskDrawCount: 3,
		maskEdgeCount: 4,
		nearPlaneSeedCount: 0,
		rejectedFacingCrossingCount: 0,
		sameDomainBoundaryCrossingCount: 0,
		renderLayerCount: 2,
		renderNodeCount: 3,
		submittedRenderNodeCount: 3,
	};
	if (
		JSON.stringify(fixture.hybridTrace) !== JSON.stringify(expectedHybridTrace)
	) {
		throw new Error(
			`Hybrid portal diagnostics mismatch: ${JSON.stringify(fixture.hybridTrace)}.`,
		);
	}
	const expectedRootReentryTrace = {
		admittedScopeWindowStateCount: 3,
		exteriorRenderCount: 1,
		maskDrawCount: 3,
		maskEdgeCount: 3,
		nearPlaneSeedCount: 0,
		rejectedFacingCrossingCount: 0,
		sameDomainBoundaryCrossingCount: 0,
		renderLayerCount: 2,
		renderNodeCount: 2,
		submittedRenderNodeCount: 3,
	};
	if (
		JSON.stringify(fixture.rootReentryTrace) !==
		JSON.stringify(expectedRootReentryTrace)
	) {
		throw new Error(
			`Root re-entry diagnostics mismatch: ${JSON.stringify(fixture.rootReentryTrace)}.`,
		);
	}
	const metrics = state.metrics;
	if (
		!metrics ||
		metrics.envCellRenderMode !== "flat" ||
		metrics.submittedPortalApertureDrawCount !== 0 ||
		metrics.sceneDomainTargetCount !== 0
	) {
		throw new Error(
			`Exterior composition fixture contaminated flat rendering: ${JSON.stringify(metrics)}.`,
		);
	}
}

function assertInternalPortalExecutionFixture(state) {
	const fixture = state.internalPortalExecution;
	if (!fixture) {
		throw new Error(
			"Internal portal execution fixture did not publish evidence.",
		);
	}
	for (const field of [
		"alphaTestPassed",
		"exactMaskConfinementPassed",
		"layerUnionPassed",
		"materialOrderingPassed",
		"nearPlaneDualSidePassed",
		"nestedDepthConfinementPassed",
		"uniqueNodeSubmissionPassed",
	]) {
		if (fixture[field] !== true) {
			throw new Error(
				`Internal portal execution fixture failed ${field}: ${JSON.stringify(fixture)}.`,
			);
		}
	}
	const expectedTrace = {
		admittedScopeWindowStateCount: 5,
		exteriorRenderCount: 0,
		maskDrawCount: 4,
		maskEdgeCount: 4,
		nearPlaneSeedCount: 0,
		rejectedFacingCrossingCount: 0,
		sameDomainBoundaryCrossingCount: 0,
		renderLayerCount: 3,
		renderNodeCount: 4,
		submittedRenderNodeCount: 4,
	};
	if (JSON.stringify(fixture.trace) !== JSON.stringify(expectedTrace)) {
		throw new Error(
			`Internal portal execution diagnostics mismatch: ${JSON.stringify(fixture.trace)}.`,
		);
	}
	const expectedReverseTrace = {
		admittedScopeWindowStateCount: 2,
		exteriorRenderCount: 0,
		maskDrawCount: 1,
		maskEdgeCount: 1,
		nearPlaneSeedCount: 1,
		rejectedFacingCrossingCount: 0,
		sameDomainBoundaryCrossingCount: 0,
		renderLayerCount: 2,
		renderNodeCount: 2,
		submittedRenderNodeCount: 2,
	};
	if (
		JSON.stringify(fixture.reverseTrace) !==
		JSON.stringify(expectedReverseTrace)
	) {
		throw new Error(
			`Reverse internal portal diagnostics mismatch: ${JSON.stringify(fixture.reverseTrace)}.`,
		);
	}
	const metrics = state.metrics;
	if (
		!metrics ||
		metrics.envCellRenderMode !== "flat" ||
		metrics.submittedPortalApertureDrawCount !== 0 ||
		metrics.sceneDomainTargetCount !== 0
	) {
		throw new Error(
			`Internal portal execution fixture contaminated flat rendering: ${JSON.stringify(metrics)}.`,
		);
	}
}

function assertTargetDiagnostics(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`Portal target diagnostics mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
		);
	}
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
	if (await isUrlReady(`${DEFAULT_VITE_URL}/harness/browser/`)) {
		process.stderr.write(`Reusing Vite server at ${DEFAULT_VITE_URL}.\n`);
		return DEFAULT_VITE_URL;
	}
	startChild("npm", ["run", "dev:vite"]);
	await waitForUrl(`${DEFAULT_VITE_URL}/harness/browser/`, 60_000);
	return DEFAULT_VITE_URL;
}

async function runHarness({ contentHostUrl, viteUrl }) {
	const userDataDirectory = await mkdtemp(
		join(tmpdir(), "holtburger-3d-browser-harness-"),
	);
	tempDirectories.push(userDataDirectory);
	const fixture = options.fixture
		? `&fixture=${encodeURIComponent(options.fixture)}`
		: "";
	const dynamicIsolation = options.isolateAuthoredDynamics
		? "&isolateAuthoredDynamics=true"
		: "";
	const dynamicExclusion = options.excludeAuthoredDynamics
		? "&excludeAuthoredDynamics=true"
		: "";
	const timeOfDay =
		options.timeOfDay === null
			? ""
			: `&timeOfDay=${encodeURIComponent(options.timeOfDay)}`;
	const pageUrl = `${viteUrl}/harness/browser/?contentHost=${encodeURIComponent(contentHostUrl)}&cameraHeight=${encodeURIComponent(options.cameraHeight)}&viewportWidth=${encodeURIComponent(options.viewportWidth)}&viewportHeight=${encodeURIComponent(options.viewportHeight)}${dynamicIsolation}${dynamicExclusion}${fixture}${timeOfDay}`;
	const chrome = startChild(options.chromePath, [
		"--remote-debugging-port=0",
		`--user-data-dir=${userDataDirectory}`,
		"--no-first-run",
		"--disable-background-networking",
		"--use-gl=angle",
		"--use-angle=swiftshader",
		"--enable-unsafe-swiftshader",
		"--headless=new",
		`--window-size=${options.viewportWidth},${options.viewportHeight}`,
		`--force-device-scale-factor=${options.deviceScaleFactor}`,
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
			"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.requestSceneInterest",
			[
				options.landblockId,
				options.buildingRadius,
				options.envCellRadius,
				options.explicitObjectRadius,
				options.generatedObjectRadius,
				options.cameraYawDegrees,
				options.cameraPitchDegrees,
			],
		);
		if (options.minimumPortalFootprintPixelArea !== null) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setMinimumPortalFootprintPixelArea",
				[options.minimumPortalFootprintPixelArea],
			);
		}
		if (options.minimumObjectFootprintPixelArea !== null) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setMinimumObjectFootprintPixelArea",
				[options.minimumObjectFootprintPixelArea],
			);
		}
		if (options.offscreenAnimationSampleIntervalMs !== null) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setOffscreenAnimationSampleIntervalSeconds",
				[options.offscreenAnimationSampleIntervalMs / 1000],
			);
		}
		if (options.filteringCycle || options.textureFiltering !== null) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setTextureFiltering",
				[options.textureFiltering ?? "nearest"],
			);
		}
		if (options.envCellRadius !== null) {
			await waitForEnvCellPublication(client, options.landblockId);
		}
		if (options.cameraPosition !== null) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setOutdoorCamera",
				[
					options.landblockId,
					options.cameraPosition,
					options.cameraYawDegrees,
					options.cameraPitchDegrees,
				],
			);
		}
		await delay(options.settleMs);
		if (options.explorerFocus) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.focusExplorerOutdoor",
				[options.landblockId],
			);
			await delay(250);
		}
		const initialState = await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
			[],
		);
		if (options.cameraEndYawDegrees !== null) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setOutdoorCamera",
				[
					options.landblockId,
					options.cameraPosition,
					options.cameraEndYawDegrees,
					options.cameraEndPitchDegrees,
				],
			);
			await delay(250);
		}
		if (
			(options.frameMode !== null || options.modeCycle) &&
			options.envCellCameraId !== null
		) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setEnvCellCamera",
				[
					options.envCellCameraId,
					options.envCellCameraPosition,
					options.cameraYawDegrees,
					options.cameraPitchDegrees,
				],
			);
		}
		const modeCycleStates = [];
		const filteringCycleStates = [];
		if (options.filteringCycle) {
			const maximum =
				initialState.textureFilteringCapabilities?.maximumAnisotropy ?? 1;
			const policies = supportedTextureFilteringPolicies(maximum);
			for (const policy of policies) {
				await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setTextureFiltering",
					[policy],
				);
				await delay(100);
				filteringCycleStates.push(
					await evaluate(
						client,
						"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
						[],
					),
				);
			}
		}
		if (options.modeCycle) {
			for (const mode of ["portal", "flat", "portal", "flat"]) {
				await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setEnvCellRenderMode",
					[mode],
				);
				await delay(250);
				modeCycleStates.push(
					await evaluate(
						client,
						"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
						[],
					),
				);
			}
		} else if (options.frameMode !== null) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setEnvCellRenderMode",
				[options.frameMode],
			);
			await delay(250);
		}
		const portalTrace = options.traceAnchorCellId
			? await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.tracePortalSegment",
					[
						options.traceAnchorCellId,
						options.traceStart,
						options.traceEndpoint,
					],
				)
			: null;
		const portalRenderGraph = options.probePortalGraph
			? await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.probePortalRenderGraph",
					[
						options.envCellCameraId,
						options.envCellCameraPosition,
						options.cameraYawDegrees,
						options.cameraPitchDegrees,
						options.portalWorkLimit,
					],
				)
			: null;
		const portalExecution = options.executePortal
			? await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.probePortalExecution",
					[
						options.envCellCameraId,
						options.envCellCameraPosition,
						options.cameraYawDegrees,
						options.cameraPitchDegrees,
						options.portalWorkLimit,
					],
				)
			: null;
		let lifecycleState = null;
		if (options.lifecycle) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.clearSceneInterest",
				[],
			);
			await delay(50);
			const cleared = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
				[],
			);
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.requestSceneInterest",
				[
					options.landblockId,
					options.buildingRadius,
					options.envCellRadius,
					options.explicitObjectRadius,
					options.generatedObjectRadius,
					options.cameraYawDegrees,
					options.cameraPitchDegrees,
				],
			);
			await delay(options.settleMs);
			const reloaded = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
				[],
			);
			lifecycleState = { cleared, reloaded };
		}
		let relocationState = null;
		if (options.relocateLandblockId) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.requestSceneInterest",
				[
					options.relocateLandblockId,
					options.buildingRadius,
					options.envCellRadius,
					options.explicitObjectRadius,
					options.generatedObjectRadius,
					options.cameraYawDegrees,
					options.cameraPitchDegrees,
				],
			);
			await delay(options.settleMs);
			relocationState = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
				[],
			);
		}
		let generatedDisabledState = null;
		if (options.disableGeneratedBeforeCapture) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.requestSceneInterest",
				[
					options.relocateLandblockId ?? options.landblockId,
					options.buildingRadius,
					options.envCellRadius,
					options.explicitObjectRadius,
					null,
					options.cameraYawDegrees,
					options.cameraPitchDegrees,
				],
			);
			await delay(options.settleMs);
			generatedDisabledState = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
				[],
			);
		}
		if (options.cameraLandblockId) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setCameraLandblock",
				[
					options.cameraLandblockId,
					options.cameraYawDegrees,
					options.cameraPitchDegrees,
				],
			);
			await delay(50);
		}
		if (options.profileRenderer) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setFrameProfiling",
				[true],
			);
		}
		if (options.measureMs > 0) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.resetTiming",
				[],
			);
			await delay(options.measureMs);
		} else if (options.profileRenderer) {
			await delay(250);
		}
		const state = await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
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
			filteringCycleStates,
			modeCycleStates,
			lifecycleState,
			portalRenderGraph,
			portalExecution,
			portalTrace,
			relocationState,
			screenshot: screenshot.data,
			state,
		};
	} finally {
		client.close();
	}
}

function supportedTextureFilteringPolicies(maximumAnisotropy) {
	return TEXTURE_FILTERING_OPTIONS.filter(
		({ minimumAnisotropy }) => minimumAnisotropy <= maximumAnisotropy,
	).map(({ policy }) => policy);
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
			() => reject(new Error("Timed out waiting for content host startup.")),
			60_000,
		);
		child.once("exit", (code) => {
			clearTimeout(timeout);
			reject(
				new Error(`Content host exited before startup with code ${code}.`),
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
				"Boolean(globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__)",
			)
		)
			return;
		if (Date.now() - startedAt >= 60_000) {
			// A startup exception leaves the API unset, so surface whatever the page recorded
			// instead of reporting only that the wait expired.
			throw new Error(
				`Timed out waiting for browser harness API: ${JSON.stringify(await evaluateExpression(client, "({ text: document.body.innerText, title: document.title, startupError: globalThis.__HOLTBURGER_3D_HARNESS_STARTUP_ERROR__ ?? null })"))}`,
			);
		}
		await delay(250);
	}
}

async function waitForEnvCellPublication(client, requestedLandblockId) {
	const expectedId = requestedLandblockId
		.toLowerCase()
		.replace(/^0x/, "")
		.slice(0, 4);
	const timeoutAt = Date.now() + 30_000;
	while (Date.now() < timeoutAt) {
		const state = await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
			[],
		);
		if (state.error) {
			throw new Error(
				`Browser harness failed while awaiting EnvCell publication: ${state.error}`,
			);
		}
		if (
			state.staticObjects?.envCellLayers.some(
				({ landblockId }) =>
					landblockId.toLowerCase().slice(2, 6) === expectedId,
			)
		) {
			return;
		}
		await delay(100);
	}
	throw new Error(
		`Timed out awaiting EnvCell publication for landblock 0x${expectedId}ffff.`,
	);
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
