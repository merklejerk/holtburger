#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_CHROME_PATH = "/opt/google/chrome/chrome";
const DEFAULT_VITE_PORT = 1420;
const READY_KIND = "holtburger-3d-dev-landblock-content-host-ready";
const DEFAULT_LANDBLOCK_ID = "0xda55ffff";
/** Lateral metres between showcase subjects; wide enough that two humanoids do not overlap. */
const ENTITY_SHOWCASE_SEPARATION = 1.2;
const DEFAULT_SETTLE_MS = 10_000;
const DEFAULT_RELOCATE_HOP_MS = 1_500;
const DEFAULT_FOLLOW_FLIGHT_MS = 20_000;
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
	const viteUrl = await startViteServer(options.vitePort);
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
	if (options.cpuProfilePath && result.cpuProfile) {
		await writeFile(options.cpuProfilePath, JSON.stringify(result.cpuProfile));
	}
	if (options.screenshotPath && result.cameraSweepScreenshots) {
		for (const [label, screenshot] of Object.entries(
			result.cameraSweepScreenshots,
		)) {
			await writeFile(
				`${options.screenshotPath}.sweep-${label}.png`,
				Buffer.from(screenshot, "base64"),
			);
		}
	}
	process.stdout.write(
		`${JSON.stringify(
			options.brief
				? briefHarnessReport(result)
				: {
						glRenderer: result.glRenderer,
						buildingRadius: options.buildingRadius,
						camera: result.state.camera,
						envCellRadius: options.envCellRadius,
						cameraPitchDegrees: options.cameraPitchDegrees,
						cameraYawDegrees: options.cameraYawDegrees,
						explicitObjectRadius: options.explicitObjectRadius,
						generatedObjectRadius: options.generatedObjectRadius,
						cameraLandblockId: options.cameraLandblockId,
						relocateLandblockId: options.relocateLandblockId,
						frameMode: options.frameMode,
						frameSettings: result.state.frameSettings,
						frameProfile: result.state.frameProfile,
						ambientOcclusionCoverageCensus:
							result.state.ambientOcclusionCoverageCensus,
						textureFiltering: options.textureFiltering,
						filteringCycleStates: result.filteringCycleStates,
						modeCycleStates: result.modeCycleStates,
						portalExecution: result.portalExecution,
						portalContextLossPolicy: result.state.portalContextLossPolicy,
						portalScopeAtlasTargets: result.state.portalScopeAtlasTargets,
						consoleMessages: result.consoleMessages,
						generatedDisabledState: result.generatedDisabledState,
						fixture: options.fixture,
						frames: result.state.frames,
						initialState: result.initialState,
						landblockId: options.landblockId,
						lifecycleState: result.lifecycleState,
						entityLifecycle: result.entityLifecycle,
						possessionScenario: result.possessionScenario,
						followFlight: result.followFlight,
						relocationSequence: result.relocationSequence,
						relocationState: result.relocationState,
						metrics: result.state.metrics,
						terrainGlTrace: result.state.terrainGlTrace,
						ready: result.state.ready,
						screenshotPath: options.screenshotPath,
						isolateAuthoredDynamics: options.isolateAuthoredDynamics,
						excludeAuthoredDynamics: options.excludeAuthoredDynamics,
						measureMs: options.measureMs,
						settleMs: options.settleMs,
						viewport: result.state.viewport,
						audioFlyby: result.audioFlyby,
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
	if (options.traceTerrainGl) {
		assertTerrainGlTrace(result.state);
	}
	if (options.modeCycle) {
		assertModeCycle(result.initialState, result.modeCycleStates);
	}
	if (options.filteringCycle) {
		assertFilteringCycle(result.initialState, result.filteringCycleStates);
	}
	if (options.fixture === "portal-scope-atlas") {
		assertPortalScopeAtlasFixture(result.state);
	}
	if (options.spawnWcid !== null && options.entityShowcaseCount === 0) {
		assertSpawnedEntityLifecycle(result);
	}
	if (options.launchDirection !== null) {
		assertLaunchedEntityLifecycle(result);
	}
	if (options.relocateKind !== null) {
		assertRelocatedEntityLifecycle(result, options.relocateKind);
	}
	if (options.possessionScenario) {
		assertPossessionScenario(result.possessionScenario);
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
		cameraSweepPosition: null,
		audioFlybyTarget: null,
		audioFlybySteps: 60,
		audioFlybyFramesPerStep: 2,
		cameraEndPitchDegrees: null,
		cameraEndYawDegrees: null,
		explorerFocus: false,
		explicitObjectRadius: null,
		generatedObjectRadius: null,
		disableGeneratedBeforeCapture: false,
		disabledLayersBeforeCapture: [],
		isolateAuthoredDynamics: false,
		excludeAuthoredDynamics: false,
		excludeSpawnedAttachments: false,
		spawnWcid: null,
		entityShowcaseCount: 0,
		entityPairWcid: null,
		entityPairTargetWcid: null,
		entityPairSeparation: 3,
		entityPopulationWcid: null,
		entityPopulationCount: 300,
		spawnDistance: 5,
		spawnSimulated: false,
		possessionScenario: false,
		launchDirection: null,
		entityTicks: 0,
		entityTickMs: 1000 / 30,
		relocateKind: null,
		relocateDistance: 10,
		cameraLandblockId: null,
		relocateLandblockId: null,
		relocateSequence: [],
		relocateHopMs: DEFAULT_RELOCATE_HOP_MS,
		followFlightLandblockId: null,
		followFlightMs: DEFAULT_FOLLOW_FLIGHT_MS,
		envCellCameraId: null,
		envCellCameraPosition: null,
		renderScale: null,
		minimumPortalFootprintCssPixelArea: null,
		minimumObjectFootprintCssPixelArea: null,
		offscreenAnimationSampleIntervalMs: null,
		executePortal: false,
		frameMode: null,
		timeOfDay: null,
		dayGroup: null,
		modeCycle: false,
		filteringCycle: false,
		gpu: false,
		ambientOcclusion: null,
		ambientOcclusionCycle: false,
		ambientOcclusionCoverage: false,
		traceTerrainGl: false,
		vitePort: DEFAULT_VITE_PORT,
		colorGrade: null,
		staticLights: true,
		weather: true,
		profileRenderer: false,
		terrainRadius: null,
		textureFiltering: null,
		lifecycle: false,
		fixture: null,
		screenshotPath: null,
		cpuProfilePath: null,
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
			case "--terrain-radius": {
				const value = Number(args[index + 1]);
				if (!Number.isInteger(value) || value < 0) {
					throw new Error("--terrain-radius must be a non-negative integer.");
				}
				parsed.terrainRadius = value;
				index += 1;
				break;
			}
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
			case "--disable-layer-before-capture": {
				const layer = requireValue(args, ++index, arg);
				if (
					![
						"terrain",
						"buildings",
						"objects",
						"generated",
						"env-cells",
					].includes(layer)
				) {
					throw new Error(
						"--disable-layer-before-capture requires a production render layer.",
					);
				}
				parsed.disabledLayersBeforeCapture.push(layer);
				break;
			}
			case "--isolate-authored-dynamics":
				parsed.isolateAuthoredDynamics = true;
				break;
			case "--exclude-authored-dynamics":
				parsed.excludeAuthoredDynamics = true;
				break;
			case "--exclude-spawned-attachments":
				parsed.excludeSpawnedAttachments = true;
				break;
			case "--spawn-wcid":
				parsed.spawnWcid = requireValue(args, ++index, arg);
				break;
			case "--entity-showcase-count":
				parsed.entityShowcaseCount = parsePositiveInteger(
					requireValue(args, ++index, arg),
					arg,
				);
				break;
			case "--entity-pair-wcid":
				parsed.entityPairWcid = requireValue(args, ++index, arg);
				break;
			case "--entity-pair-target-wcid":
				parsed.entityPairTargetWcid = requireValue(args, ++index, arg);
				break;
			case "--entity-pair-separation":
				parsed.entityPairSeparation = Number(requireValue(args, ++index, arg));
				if (
					!Number.isFinite(parsed.entityPairSeparation) ||
					parsed.entityPairSeparation <= 0
				) {
					throw new Error(
						"--entity-pair-separation must be positive and finite.",
					);
				}
				break;
			case "--entity-population-wcid":
				parsed.entityPopulationWcid = requireValue(args, ++index, arg);
				break;
			case "--entity-population-count":
				parsed.entityPopulationCount = parsePositiveInteger(
					requireValue(args, ++index, arg),
					arg,
				);
				break;
			case "--spawn-distance":
				parsed.spawnDistance = Number(requireValue(args, ++index, arg));
				if (
					!Number.isFinite(parsed.spawnDistance) ||
					parsed.spawnDistance <= 0
				) {
					throw new Error("--spawn-distance must be positive and finite.");
				}
				break;
			case "--spawn-simulated":
				parsed.spawnSimulated = true;
				break;
			case "--possession-scenario":
				parsed.possessionScenario = true;
				break;
			case "--launch-direction":
				parsed.launchDirection = parsePoint(
					requireValue(args, ++index, arg),
					arg,
				);
				if (Math.hypot(...parsed.launchDirection) === 0) {
					throw new Error("--launch-direction must be nonzero.");
				}
				break;
			case "--entity-ticks":
				parsed.entityTicks = parsePositiveInteger(
					requireValue(args, ++index, arg),
					arg,
				);
				break;
			case "--entity-tick-ms":
				parsed.entityTickMs = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(parsed.entityTickMs) || parsed.entityTickMs <= 0) {
					throw new Error("--entity-tick-ms must be positive and finite.");
				}
				break;
			case "--relocate-kind": {
				const kind = requireValue(args, ++index, arg);
				if (kind !== "teleport" && kind !== "reset") {
					throw new Error("--relocate-kind must be teleport or reset.");
				}
				parsed.relocateKind = kind;
				break;
			}
			case "--relocate-distance":
				parsed.relocateDistance = Number(requireValue(args, ++index, arg));
				if (
					!Number.isFinite(parsed.relocateDistance) ||
					parsed.relocateDistance <= 0
				) {
					throw new Error("--relocate-distance must be positive and finite.");
				}
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
			case "--camera-sweep-position":
				parsed.cameraSweepPosition = parsePoint(
					requireValue(args, ++index, arg),
					arg,
				);
				break;
			case "--audio-flyby":
				parsed.audioFlybyTarget = parsePoint(
					requireValue(args, ++index, arg),
					arg,
				);
				break;
			case "--audio-flyby-steps":
				parsed.audioFlybySteps = Number(requireValue(args, ++index, arg));
				if (
					!Number.isInteger(parsed.audioFlybySteps) ||
					parsed.audioFlybySteps < 2
				) {
					throw new Error(
						"--audio-flyby-steps must be an integer of at least 2.",
					);
				}
				break;
			case "--audio-flyby-frames-per-step":
				parsed.audioFlybyFramesPerStep = Number(
					requireValue(args, ++index, arg),
				);
				if (
					!Number.isInteger(parsed.audioFlybyFramesPerStep) ||
					parsed.audioFlybyFramesPerStep < 1
				) {
					throw new Error(
						"--audio-flyby-frames-per-step must be a positive integer.",
					);
				}
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
			case "--env-cell-camera":
				parsed.envCellCameraId = requireValue(args, ++index, arg);
				break;
			case "--env-cell-position":
				{
					const value = requireValue(args, ++index, arg);
					parsed.envCellCameraPosition =
						value === "center" ? value : parsePoint(value, arg);
				}
				break;
			case "--render-scale":
				parsed.renderScale = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(parsed.renderScale) || parsed.renderScale <= 0) {
					throw new Error("--render-scale must be a positive number.");
				}
				break;
			case "--minimum-portal-footprint-css-pixel-area":
				parsed.minimumPortalFootprintCssPixelArea = Number(
					requireValue(args, ++index, arg),
				);
				if (
					!Number.isFinite(parsed.minimumPortalFootprintCssPixelArea) ||
					parsed.minimumPortalFootprintCssPixelArea < 0
				) {
					throw new Error(
						"--minimum-portal-footprint-css-pixel-area must be a non-negative number.",
					);
				}
				break;
			case "--minimum-object-footprint-css-pixel-area":
				parsed.minimumObjectFootprintCssPixelArea = Number(
					requireValue(args, ++index, arg),
				);
				if (
					!Number.isFinite(parsed.minimumObjectFootprintCssPixelArea) ||
					parsed.minimumObjectFootprintCssPixelArea < 0
				) {
					throw new Error(
						"--minimum-object-footprint-css-pixel-area must be a non-negative number.",
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
			case "--execute-portal":
				parsed.executePortal = true;
				break;
			case "--capture-frame": {
				const value = Number(requireValue(args, ++index, arg));
				if (!Number.isInteger(value) || value <= 0) {
					throw new Error("--capture-frame must be a positive integer.");
				}
				parsed.captureFrame = value;
				break;
			}
			case "--frame-interval-ms": {
				const value = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(value) || value <= 0) {
					throw new Error("--frame-interval-ms must be a positive number.");
				}
				parsed.frameIntervalMs = value;
				break;
			}
			case "--particle-seed": {
				const value = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(value)) {
					throw new Error("--particle-seed must be a finite number.");
				}
				parsed.particleSeed = value;
				break;
			}
			case "--time-of-day": {
				const value = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(value) || value < 0 || value >= 1) {
					throw new Error("--time-of-day must be in [0, 1).");
				}
				parsed.timeOfDay = value;
				break;
			}
			case "--day-group": {
				const value = Number(requireValue(args, ++index, arg));
				if (!Number.isInteger(value) || value < 0) {
					throw new Error("--day-group must be a non-negative integer.");
				}
				parsed.dayGroup = value;
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
			case "--gpu":
				parsed.gpu = true;
				break;
			case "--trace-terrain-gl":
				parsed.traceTerrainGl = true;
				break;
			case "--ambient-occlusion":
				parsed.ambientOcclusion = true;
				break;
			case "--no-ambient-occlusion":
				parsed.ambientOcclusion = false;
				break;
			case "--ambient-occlusion-coverage":
				parsed.ambientOcclusion = true;
				parsed.ambientOcclusionCoverage = true;
				break;
			case "--ambient-occlusion-cycle":
				parsed.ambientOcclusionCycle = true;
				break;
			case "--vite-port":
				parsed.vitePort = Number(requireValue(args, ++index, arg));
				break;
			case "--color-grade": {
				const source = requireValue(args, ++index, arg);
				try {
					parsed.colorGrade = JSON.parse(source);
				} catch (cause) {
					throw new Error(
						"--color-grade must be JSON color-grade parameters.",
						{
							cause,
						},
					);
				}
				break;
			}
			case "--no-static-lights":
				parsed.staticLights = false;
				break;
			case "--no-weather":
				parsed.weather = false;
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
					!["blended", "instanced", "portal-scope-atlas"].includes(
						parsed.fixture,
					)
				) {
					throw new Error(
						"--fixture must be blended, instanced, or portal-scope-atlas.",
					);
				}
				break;
			case "--screenshot":
				parsed.screenshotPath = requireValue(args, ++index, arg);
				break;
			case "--relocate-sequence":
				parsed.relocateSequence = requireValue(args, ++index, arg)
					.split(",")
					.map((entry) => entry.trim())
					.filter((entry) => entry.length > 0);
				if (parsed.relocateSequence.length === 0) {
					throw new Error("--relocate-sequence needs at least one landblock.");
				}
				break;
			case "--follow-flight":
				parsed.followFlightLandblockId = requireValue(args, ++index, arg);
				break;
			case "--follow-flight-ms":
				parsed.followFlightMs = Number(requireValue(args, ++index, arg));
				if (
					!Number.isFinite(parsed.followFlightMs) ||
					parsed.followFlightMs <= 0
				) {
					throw new Error("--follow-flight-ms must be a positive number.");
				}
				break;
			case "--relocate-hop-ms":
				parsed.relocateHopMs = Number(requireValue(args, ++index, arg));
				if (
					!Number.isFinite(parsed.relocateHopMs) ||
					parsed.relocateHopMs < 0
				) {
					throw new Error("--relocate-hop-ms must be a non-negative number.");
				}
				break;
			case "--cpu-profile":
				parsed.cpuProfilePath = requireValue(args, ++index, arg);
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
		parsed.terrainRadius !== null &&
		parsed.terrainRadius < parsed.buildingRadius
	) {
		throw new Error("--terrain-radius must be no less than --building-radius.");
	}
	if (parsed.relocateKind !== null && parsed.spawnWcid === null) {
		throw new Error("--relocate-kind requires --spawn-wcid.");
	}
	if (
		parsed.relocateHopMs !== DEFAULT_RELOCATE_HOP_MS &&
		parsed.relocateSequence.length === 0
	) {
		throw new Error("--relocate-hop-ms requires --relocate-sequence.");
	}
	if (
		parsed.followFlightMs !== DEFAULT_FOLLOW_FLIGHT_MS &&
		parsed.followFlightLandblockId === null
	) {
		throw new Error("--follow-flight-ms requires --follow-flight.");
	}
	if (
		parsed.followFlightLandblockId !== null &&
		(parsed.relocateLandblockId || parsed.relocateSequence.length > 0)
	) {
		throw new Error(
			"--follow-flight and relocation options cannot be combined; the flight re-anchors by itself.",
		);
	}
	if (parsed.relocateSequence.length > 0 && parsed.relocateLandblockId) {
		throw new Error(
			"--relocate-sequence and --relocate-landblock cannot be combined.",
		);
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
	if (
		parsed.cameraLandblockId &&
		(parsed.relocateLandblockId || parsed.relocateSequence.length > 0)
	) {
		throw new Error(
			"--camera-landblock cannot be combined with a relocation option.",
		);
	}
	if (
		parsed.explorerFocus &&
		(parsed.cameraLandblockId ||
			parsed.relocateLandblockId ||
			parsed.relocateSequence.length > 0 ||
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
			parsed.relocateSequence.length > 0 ||
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
	if (parsed.cameraSweepPosition !== null && parsed.cameraPosition === null) {
		throw new Error("--camera-sweep-position requires --camera-position.");
	}
	if (parsed.audioFlybyTarget !== null && parsed.cameraPosition === null) {
		throw new Error("--audio-flyby requires --camera-position.");
	}
	if (parsed.cameraSweepPosition !== null && cameraEndOptionCount !== 0) {
		throw new Error(
			"--camera-sweep-position cannot be combined with end-orientation options.",
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
	if (parsed.executePortal && envCellCameraOptionCount !== 2) {
		throw new Error(
			"Portal execution requires an EnvCell camera and position.",
		);
	}
	if (parsed.executePortal && parsed.envCellCameraPosition === "center") {
		throw new Error(
			"--execute-portal requires an explicit --env-cell-position.",
		);
	}
	if (parsed.spawnSimulated && parsed.spawnWcid === null) {
		throw new Error("--spawn-simulated requires --spawn-wcid.");
	}
	if (parsed.possessionScenario && parsed.spawnWcid === null) {
		throw new Error("--possession-scenario requires --spawn-wcid.");
	}
	if (parsed.excludeSpawnedAttachments && parsed.spawnWcid === null) {
		throw new Error("--exclude-spawned-attachments requires --spawn-wcid.");
	}
	// The pair and population scenarios spawn simulated fleets of their own, so they satisfy the
	// same requirement without --spawn-simulated.
	const simulatedScenario =
		parsed.spawnSimulated ||
		parsed.possessionScenario ||
		parsed.entityPairWcid !== null ||
		parsed.entityPopulationWcid !== null;
	if (
		(parsed.launchDirection !== null || parsed.entityTicks > 0) &&
		!simulatedScenario
	) {
		throw new Error(
			"--launch-direction and --entity-ticks require a simulated entity scenario.",
		);
	}
	if (parsed.entityPairWcid !== null && parsed.entityTicks === 0) {
		throw new Error("--entity-pair-wcid requires --entity-ticks.");
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

  --terrain-radius <n>  Request terrain out to this radius independently of buildings, so a
                         terrain-cost capture does not also load a building neighborhood that
                         large. Must be at least --building-radius. Default: --building-radius
  --building-radius <n> Request a square terrain/building neighborhood. Default: 0
  --env-cell-radius <n> Request EnvCells within the building neighborhood.
  --explicit-object-radius <n> Request explicit objects within the building neighborhood.
  --generated-object-radius <n> Request generated objects within the building neighborhood.
  --disable-generated-before-capture
                         Withdraw generated interest after the initial snapshot.
  --disable-layer-before-capture <layer>
                         Hide one production layer for diagnostic workload isolation; repeatable.
  --isolate-authored-dynamics
                         Keep terrain and promoted outdoor dynamics but strip outdoor statics.
  --exclude-authored-dynamics
                         Keep outdoor statics but strip promoted dynamics.
  --exclude-spawned-attachments
                         Harness-only A/B: realize a spawned wearer without its attached children.
  --spawn-wcid <id>     Spawn one decimal or 0x WCID through the real catalog host, capture it,
                         then exact-despawn it and assert shared-runtime resource cleanup.
  --entity-pair-wcid <id>
                        Launch this simulated WCID along AC +x into the pair target. Needs a
                        catalog maximum velocity, so pick a missile-class template.
  --entity-pair-target-wcid <id>
                        Solid target for the pair run. Default: the same WCID as the mover.
  --entity-pair-separation <m>
                        AC +x separation between pair mover and target. Default: 3. Raise it to
                        run a no-contact control against the same launch.
  --entity-population-wcid <id[,id...]>
                        Spawn a lattice of simulated entities for the population workload run.
                        Pass several WCIDs to interleave target-geometry branches.
  --entity-population-count <n>
                        Entities in the population run. Default: 300
  --spawn-distance <n>  Camera-relative spawn distance. Default: 5
  --spawn-simulated    Attach the spawned entity to the shared host solver instead of pose-only.
  --possession-scenario
                        Possess the simulated --spawn-wcid and prove backward/turn/combined/jump
                        body and playing-motion state through deterministic host ticks.
  --launch-direction <x,y,z>
                        Launch the exact spawned generation using catalog speed/spin.
  --entity-ticks <n>   Advance the entity collection by n explicit harness-controlled ticks.
  --entity-tick-ms <n> Duration of each explicit entity tick. Default: ${1000 / 30}
  --relocate-kind <teleport|reset>
                        Apply one host-resolved correction after explicit entity ticks.
  --relocate-distance <n>
                        Camera-relative correction distance. Default: 10
  --camera-yaw <degrees>    Initial and relocation camera yaw. Default: 0
  --camera-pitch <degrees>  Initial and relocation camera pitch. Default: -45
  --camera-position <x,y,z>
                         Explicit canonical outdoor camera position.
  --camera-sweep-position <x,y,z>
                         After AO setup, capture the start, move here, then return and capture;
                         requires --camera-position and a frozen simulation for image comparison.
  --camera-end-yaw <degrees>
  --camera-end-pitch <degrees>
                         Apply a second orientation after settlement; requires --camera-position.
  --explorer-focus      Apply the Explorer's automatic outdoor camera pose after loading.
  --viewport-width <px> CSS render width. Default: ${DEFAULT_VIEWPORT_WIDTH}
  --viewport-height <px> CSS render height. Default: ${DEFAULT_VIEWPORT_HEIGHT}
  --device-scale-factor <n> Browser device scale factor, which sizes screenshots but no
                        longer sizes the drawing buffer. Default: ${DEFAULT_DEVICE_SCALE_FACTOR}
  --render-scale <n>    Device pixels rendered per CSS pixel, and the only anti-aliasing
                        control. Above one supersamples. Default: renderer default (1)
  --camera-landblock <hex>  Move only the camera after the initial request.
  --relocate-landblock <hex> Replace scene interest and camera at a new landblock.
  --lifecycle           Clear and reload the requested neighborhood before capture.
  --env-cell-camera <hex>
                         Authoritative EnvCell residency for the continuous camera.
  --env-cell-position <x,y,z>
                         Canonical position for the EnvCell camera, or center to derive the
                         contained authored bounds center through the runtime.
  --minimum-portal-footprint-css-pixel-area <px2>
                         Override the production recursive portal-footprint cutoff.
  --minimum-object-footprint-css-pixel-area <px2>
                         Override independently optional object footprint culling.
  --offscreen-animation-sample-interval-ms <ms>
                         Override offscreen visual animation sampling; zero is full cadence.
  --execute-portal
                         Execute the public portal compositor once through production GPU passes.
  --particle-seed <n>   Seed particle emission randomness so runs repeat exactly. Required for any
                         screenshot comparison of a scene containing particles.
  --capture-frame <n>   Freeze runtime time at frame n, so the captured instant is identical no
                         matter when the screenshot lands. Requires --frame-interval-ms.
  --frame-interval-ms <n>
                         Advance runtime time by a fixed step per frame instead of the wall clock.
                         Pair with --particle-seed to make a particle scene reproducible; frame cost
                         is still measured against the real clock, so timing runs are unaffected.
  --time-of-day <0..1>  Resolve region lighting and fog at this day fraction.
  --day-group <index>   Resolve the sky and lighting with an explicit day group instead of the
                         harness default of group 0. Shipped groups run 0-19; 3, 7, 9 and 15-19
                         are Rainy and 12-14 Cloudy.
  --frame-mode <flat|portal>
  --ambient-occlusion   Explicitly enable near-field screen-space ambient occlusion.
  --no-ambient-occlusion
                         Disable the default near-field screen-space ambient occlusion.
                         Change continuous rendering policy without reloading content.
  --ambient-occlusion-coverage
                         Replace AO with harness-only distance categories and report a one-shot
                         full-resolution opaque-depth census. Implies --ambient-occlusion.
  --ambient-occlusion-cycle
                         Exercise on, off, on policy and scratch ownership without reloading.
  --mode-cycle           Exercise portal, flat, portal, flat frames without reloading content.
  --filtering-cycle      Change filtering during loading, then cycle supported modes without reload.
  --gpu                  Render on the real GPU adapter instead of SwiftShader. Required for
                         any timing used as performance evidence.
  --trace-terrain-gl     Assert that the far-terrain program binds no texture state and uploads
                         exactly one terrain palette per activation.
  --vite-port <port>     Vite port to start or reuse. Change it when another worktree is running
                         a harness, or its server will silently serve that worktree's build.
  --color-grade <json>  Override the presentation color grade with these JSON parameters, e.g.
                         '{"temperature":0.6,"tint":0,"saturation":1.4,"curves":{...}}'. Omit it
                         to use whatever FRONTEND_TUNING currently ships.
  --no-static-lights     Disable authored outdoor lamps, for same-scene A/B of their cost.
  --no-weather           Disable authored weather, mirroring retail's player option. Use it to
                         A/B a Rainy day group against the same scene without rain.
  --profile-renderer     Enable opt-in renderer CPU/GPU profiling before capture.
  --texture-filtering <mode>
                         Select nearest, linear, or anisotropic-2x/4x/8x before content settles.
  --fixture <name>      Use the blended, instanced, or portal-scope-atlas fixture.
  --settle-ms <ms>      Wait after requesting scene content. Default: ${DEFAULT_SETTLE_MS}
  --measure-ms <ms>     Reset timings after settling, then measure steady-state frames.
  --screenshot <path>   Persist the captured PNG after the harness exits.
  --relocate-sequence <hex,hex,...>
                         Re-issue scene interest at each landblock in turn, so sustained streaming
                         churn can be measured without the interactive client. Reports per-hop
                         state under relocationSequence.
  --relocate-hop-ms <ms> Settle time between sequence hops. Default: ${DEFAULT_RELOCATE_HOP_MS}
  --follow-flight <hex>  Fly the camera in a straight line to this landblock's centre,
                         re-anchoring scene interest on every crossing — the harness mirror of
                         Explorer follow mode. Reports crossings and flight-window timing.
  --follow-flight-ms <ms> Flight duration. Default: ${DEFAULT_FOLLOW_FLIGHT_MS}
  --cpu-profile <path>  Sample the page's V8 CPU profile across the measurement window and
                         persist it as .cpuprofile JSON for DevTools or speedscope.
  --chrome-path <path>  Chrome executable. Default: ${DEFAULT_CHROME_PATH}
`);
}

/**
 * Lattice offsets in AC axes, camera-relative, spaced so bodies start clear of each other.
 *
 * Rows advance north and columns east; the whole lattice sits ahead of the camera so every body is
 * inside one populated landblock and visible to the renderer.
 */
function populationOffsets(count) {
	const spacing = 2.5;
	const columns = Math.ceil(Math.sqrt(count));
	const offsets = [];
	for (let index = 0; index < count; index += 1) {
		const column = index % columns;
		const row = Math.floor(index / columns);
		offsets.push([
			(column - (columns - 1) / 2) * spacing,
			12 + row * spacing,
			0,
		]);
	}
	return offsets;
}

/**
 * Teardown census view: the same ownership counts the single-spawn lifecycle reports, minus the
 * per-entity list, which is unreadable at population scale.
 */
function summarizeEntityRuntimeState(state) {
	const summary = summarizeEntityLifecycleState(state);
	return {
		currentEntityCount: summary.currentEntities.length,
		visibleDynamicEntityCount: summary.visibleDynamicEntityCount,
		visibleDynamicPartCount: state.metrics?.visibleDynamicPartCount ?? null,
		runtime: summary.runtime,
	};
}

function summarizeDurations(durations) {
	if (durations.length === 0) return null;
	const sorted = [...durations].sort((left, right) => left - right);
	return {
		count: sorted.length,
		p50: sorted[Math.floor(sorted.length * 0.5)],
		p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
		maximum: sorted[sorted.length - 1],
	};
}

function assertPortalScopeAtlasFixture(state) {
	assertPortalScopeAtlasTargetsFixture(state.portalScopeAtlasTargets);
	assertPortalScopeAtlasExecutorFixture(state.portalScopeAtlasExecutor);
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
		metrics.portalPropagationDrawCount !== 0 ||
		metrics.portalFramebufferCount !== 0
	) {
		throw new Error(
			`Portal scope-atlas fixture contaminated flat rendering: ${JSON.stringify(metrics)}.`,
		);
	}
}

function assertPortalScopeAtlasExecutorFixture(fixture) {
	if (!fixture) {
		throw new Error(
			"Portal scope-atlas executor fixture did not publish evidence.",
		);
	}
	for (const field of [
		"deferredCompositionMatchesOracle",
		"exteriorWeatherComposesBehindChildOpaque",
		"frontierMatchesOracle",
		"junctionZeroThicknessTransitMatchesOracle",
		"junctionAbsentEqualDepthIsRejected",
		"nearPlaneStraddleMatchesOracle",
		"nearPlaneStraddleOrdinaryPolicyIsRejected",
		"opaqueOcclusionMatchesOracle",
		"productionPackedHostileSamplerResolveMatchesOracle",
		"productionPackedResolveMatchesOracle",
		"propagatedResolveMatchesOracle",
		"particleMatchesEquivalentTransparency",
		"rootOnlyResolveMatchesOracle",
	]) {
		if (fixture[field] !== true) {
			throw new Error(
				`Portal scope-atlas executor fixture failed ${field}: ${JSON.stringify(fixture)}.`,
			);
		}
	}
}

function assertPortalScopeAtlasTargetsFixture(fixture) {
	if (!fixture) {
		throw new Error(
			"Portal scope-atlas target fixture did not publish evidence.",
		);
	}
	for (const field of [
		"frontierR8uiRoundTripPassed",
		"initialFramebuffersComplete",
		"initialResourcesValid",
		"resizedFramebuffersComplete",
		"resizedResourcesValid",
		"resizedTargetReplaced",
		"sameExtentTargetReused",
	]) {
		if (fixture[field] !== true) {
			throw new Error(`Portal scope-atlas target fixture failed ${field}.`);
		}
	}
	assertScopeAtlasTargetDiagnostics(fixture.initialDiagnostics, {
		activeBytes: 864,
		activeFramebufferCount: 4,
		activeTextureCount: 6,
		allocatedGenerationCount: 1,
		disposedGenerationCount: 0,
		extents: {
			atlas: { height: 8, width: 8 },
			drawingBuffer: { height: 4, width: 4 },
		},
	});
	assertScopeAtlasTargetDiagnostics(fixture.resizedDiagnostics, {
		activeBytes: 1_728,
		activeFramebufferCount: 4,
		activeTextureCount: 6,
		allocatedGenerationCount: 2,
		disposedGenerationCount: 1,
		extents: {
			atlas: { height: 8, width: 16 },
			drawingBuffer: { height: 4, width: 8 },
		},
	});
	assertScopeAtlasTargetDiagnostics(fixture.disposedDiagnostics, {
		activeBytes: 0,
		activeFramebufferCount: 0,
		activeTextureCount: 0,
		allocatedGenerationCount: 2,
		disposedGenerationCount: 2,
		extents: null,
	});
}

function assertScopeAtlasTargetDiagnostics(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`Portal scope-atlas target diagnostics mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
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
						audio: authoredDynamics.audio,
						particles: authoredDynamics.particles,
						physicsScripts: authoredDynamics.physicsScripts,
						skyScripts: authoredDynamics.skyScripts,
						dynamics: authoredDynamics.dynamics,
						presentationCadence: authoredDynamics.presentationCadence,
						effects: authoredDynamics.effects,
						behavior: authoredDynamics.behavior,
						residentCount: authoredDynamics.residents.length,
					},
		glRenderer: result.glRenderer,
		consoleMessages: result.consoleMessages.filter(
			({ level }) => level === "error" || level === "exception",
		),
		entityLifecycle: summarizeEntityLifecycle(result.entityLifecycle),
		possessionScenario: summarizePossessionScenario(result.possessionScenario),
		entityPair: result.entityPair,
		entityPopulation: result.entityPopulation,
		envCellLayers: summarizeEnvCellLayers(staticObjects?.envCellLayers ?? []),
		finalMetrics: result.state.metrics,
		terrainGlTrace: result.state.terrainGlTrace,
		ambientOcclusionCoverageCensus: result.state.ambientOcclusionCoverageCensus,
		frameProfile: result.state.frameProfile,
		tickProfile: result.state.tickProfile,
		frameSettings: result.state.frameSettings,
		portalScopeAtlasExecutorFixture: result.state.portalScopeAtlasExecutor,
		portalExecution: result.portalExecution,
		initialMetrics: result.initialState.metrics,
		initialTerrainWorker: result.initialState.terrainWorker,
		initialCamera: result.initialState.camera,
		modeCycleMetrics: result.modeCycleStates.map((state) => state.metrics),
		ambientOcclusionCycleMetrics: result.ambientOcclusionCycleStates.map(
			(state) => state.metrics,
		),
		filteringCycle: result.filteringCycleStates.map(
			({ frameSettings }) => frameSettings.quality.textureFiltering,
		),
		filteringCapabilities: result.state.textureFilteringCapabilities,
		camera: result.state.camera,
		viewport: result.state.viewport,
		ready: result.state.ready,
		// Audio traces are the proof surface for bounded placement cadence and forced refreshes.
		audioFlyby: result.audioFlyby,
		// Per-hop streaming evidence must survive brief mode: relocation runs exist to
		// produce it, and the full report is too large to diff by hand.
		followFlight: result.followFlight,
		relocationSequence: result.relocationSequence,
		relocationState: result.relocationState,
		sourceBatches: summarizeSourceBatches(result.state.sourceBatches),
		// Compiled-draw occupancy is leak evidence across relocations, and its flush counts
		// explain any recompilation, so brief mode keeps both.
		compiledObjectDraws: result.state.compiledObjectDraws,
		staticResourceCounts:
			staticObjects === null
				? null
				: {
						geometryResourceCount: staticObjects.geometryResourceCount,
						staticObjectNodeCount: staticObjects.staticObjectNodeCount,
						staticObjectOwnerCount: staticObjects.staticObjectOwnerCount,
						outdoorLightScopeCount: staticObjects.outdoorLightScopeCount,
						textureAtlasPageCount: staticObjects.textureAtlasPages.length,
						textureResidentSourceCount:
							staticObjects.texture.residentSourceCount,
					},
		// Atlas workload controls must travel with streaming timings in brief evidence runs.
		texture: staticObjects?.texture ?? null,
		terrainWorker: result.state.terrainWorker,
		timing: result.state.timing,
	};
}

function summarizePossessionScenario(scenario) {
	if (scenario === null) return null;
	const playableBoomTicks = scenario.boom.ticks.filter(
		(tick) => tick.kind === "advanced" || tick.kind === "reseeded",
	);
	const cameraEndpoints = playableBoomTicks.map(
		(tick) => tick.path.legs.at(-1).end.position,
	);
	const cameraVerticalVelocities = adjacentDifferences(
		cameraEndpoints.map((pose) => pose.coords.z),
		scenario.boom.tickMs / 1_000,
	);
	const cameraVerticalAccelerations = adjacentDifferences(
		cameraVerticalVelocities,
		scenario.boom.tickMs / 1_000,
	);
	const renderedReach = playableBoomTicks.map((tick) => tick.renderedReach);
	const repeatedStepTicks = scenario.boom.repeatedStepTickRange
		? playableBoomTicks.slice(
				scenario.boom.repeatedStepTickRange.start,
				scenario.boom.repeatedStepTickRange.end,
			)
		: [];
	const repeatedStepEndpoints = repeatedStepTicks.map(
		(tick) => tick.path.legs.at(-1).end.position,
	);
	const repeatedStepVerticalVelocities = adjacentDifferences(
		repeatedStepEndpoints.map((pose) => pose.coords.z),
		scenario.boom.tickMs / 1_000,
	);
	const repeatedStepVerticalAccelerations = adjacentDifferences(
		repeatedStepVerticalVelocities,
		scenario.boom.tickMs / 1_000,
	);
	return {
		backward: {
			from: entityCoordinates(scenario.initial),
			to: entityCoordinates(scenario.backward.entity),
			motion: scenario.backward.probe,
		},
		combined: {
			from: entityCoordinates(scenario.combinedStart),
			to: entityCoordinates(scenario.combined.entity),
			fromYaw: entityYawRadians(scenario.combinedStart),
			toYaw: entityYawRadians(scenario.combined.entity),
		},
		control: scenario.controlProbe,
		boom: {
			framing: scenario.boom.framing,
			frameState:
				scenario.boom.frameStates.length === 0
					? null
					: {
							cameraEnvCellIds: uniqueCellIds(
								scenario.boom.frameStates
									.map((state) => state.camera?.envCellId)
									.filter((cellId) => cellId != null),
							),
							minimumVisibleEnvCellScopeCount: Math.min(
								...scenario.boom.frameStates
									.filter((state) => state.camera?.envCellId != null)
									.map((state) => state.metrics.visibleEnvCellScopeCount),
							),
							minimumVisibleEnvCellShells: Math.min(
								...scenario.boom.frameStates
									.filter((state) => state.camera?.envCellId != null)
									.map((state) => state.metrics.visibleEnvCellShells),
							),
							sampleCount: scenario.boom.frameStates.length,
						},
			cameraCellIds: uniqueCellIds(
				playableBoomTicks.flatMap((tick) => [
					tick.path.initial.position.landblockId,
					...tick.path.legs.map((leg) => leg.end.position.landblockId),
				]),
			),
			identity: scenario.boom.identity,
			intentReceipts: scenario.boom.intentReceipts,
			pathCount: playableBoomTicks.length,
			reseeds: playableBoomTicks
				.filter((tick) => tick.kind === "reseeded")
				.map((tick) => ({ reason: tick.reason, sequence: tick.sequence })),
			sequence: playableBoomTicks.map((tick) => tick.sequence),
			desiredReach: playableBoomTicks.map((tick) => tick.desiredReach),
			renderedReach: {
				maximum: renderedReach.length ? Math.max(...renderedReach) : null,
				minimum: renderedReach.length ? Math.min(...renderedReach) : null,
				directionReversals: directionReversals(renderedReach),
			},
			targetCellIds: uniqueCellIds(scenario.boom.targetCellIds),
			maximumAbsoluteVerticalVelocity: maximumAbsolute(
				cameraVerticalVelocities,
			),
			maximumAbsoluteVerticalAcceleration: maximumAbsolute(
				cameraVerticalAccelerations,
			),
			maximumLegCount: playableBoomTicks.length
				? Math.max(...playableBoomTicks.map((tick) => tick.path.legs.length))
				: 0,
			maximumDiagnostics: playableBoomTicks.reduce(
				(maximum, tick) => ({
					contactPasses: Math.max(
						maximum.contactPasses,
						tick.diagnostics.contactPasses,
					),
					controlLegs: Math.max(
						maximum.controlLegs,
						tick.diagnostics.controlLegs,
					),
					clearanceSweeps: Math.max(
						maximum.clearanceSweeps,
						tick.diagnostics.clearanceSweeps,
					),
					transitSubsteps: Math.max(
						maximum.transitSubsteps,
						tick.diagnostics.transitSubsteps,
					),
				}),
				{
					contactPasses: 0,
					controlLegs: 0,
					clearanceSweeps: 0,
					transitSubsteps: 0,
				},
			),
			postReleasePublishedBoom:
				scenario.boom.postReleaseEnvelope?.boom !== undefined &&
				scenario.boom.postReleaseEnvelope?.boom !== null,
			releaseCamera: {
				distance: cameraDistance(
					scenario.boom.releaseCamera.before,
					scenario.boom.releaseCamera.after,
				),
				fromEnvCellId: scenario.boom.releaseCamera.before.envCellId,
				toEnvCellId: scenario.boom.releaseCamera.after.envCellId,
			},
			repeatedSteps:
				repeatedStepTicks.length === 0
					? null
					: {
							maximumAbsoluteVerticalAcceleration: maximumAbsolute(
								repeatedStepVerticalAccelerations,
							),
							maximumAbsoluteVerticalVelocity: maximumAbsolute(
								repeatedStepVerticalVelocities,
							),
							pathCount: repeatedStepTicks.length,
							reachDirectionReversals: directionReversals(
								repeatedStepTicks.map((tick) => tick.renderedReach),
							),
						},
			route: compactResidencyRoute(scenario.boom.route),
			stopAfterRelease: scenario.boom.stopAfterRelease,
		},
		jump: {
			begin: scenario.begin,
			chargedMotion: scenario.charged.probe,
			landed: scenario.landed,
			maximumZ: scenario.maximumZ,
			outcomes: scenario.outcomes,
			release: scenario.release,
			sawAirborne: scenario.sawAirborne,
			sawFalling: scenario.sawFalling,
		},
		possession: scenario.possession,
		sidestep: {
			from: entityCoordinates(scenario.sidestepStart),
			motion: scenario.sidestep.probe,
			to: entityCoordinates(scenario.sidestep.entity),
		},
		turn: {
			leftYaw: entityYawRadians(scenario.left.entity),
			rightYaw: entityYawRadians(scenario.right.entity),
			startYaw: entityYawRadians(scenario.turnStart),
		},
	};
}

function adjacentDifferences(values, durationSeconds) {
	return values
		.slice(1)
		.map((value, index) => (value - values[index]) / durationSeconds);
}

function directionReversals(values) {
	let previousDirection = 0;
	let reversals = 0;
	for (let index = 1; index < values.length; index += 1) {
		const delta = values[index] - values[index - 1];
		const direction = Math.abs(delta) <= 1e-5 ? 0 : Math.sign(delta);
		if (direction === 0) continue;
		if (previousDirection !== 0 && direction !== previousDirection)
			reversals += 1;
		previousDirection = direction;
	}
	return reversals;
}

function maximumAbsolute(values) {
	return values.length ? Math.max(...values.map(Math.abs)) : 0;
}

function uniqueCellIds(values) {
	return [...new Set(values)].map(
		(value) => `0x${(value >>> 0).toString(16).padStart(8, "0")}`,
	);
}

function compactResidencyRoute(route) {
	return route
		.filter(
			(step, index) =>
				index === 0 ||
				step.phase !== route[index - 1].phase ||
				step.entityCellId !== route[index - 1].entityCellId,
		)
		.map((step) => ({
			phase: step.phase,
			entityCellId: uniqueCellIds([step.entityCellId])[0],
		}));
}

function assertTerrainGlTrace(state) {
	const trace = state.terrainGlTrace;
	if (trace === null) {
		throw new Error(
			"Terrain GL tracing was requested but produced no snapshot.",
		);
	}
	if (trace.farProgramActivationCount === 0 || trace.farDrawCount === 0) {
		throw new Error(
			`Terrain GL trace did not observe a far-terrain submission: ${JSON.stringify(trace)}.`,
		);
	}
	if (
		trace.farDrawActiveTextureCount !== 0 ||
		trace.farDrawTextureBindCount !== 0 ||
		trace.farDrawSamplerBindCount !== 0
	) {
		throw new Error(
			`Far terrain touched texture state while active: ${JSON.stringify(trace)}.`,
		);
	}
	if (trace.farPaletteUploadCount !== trace.farProgramActivationCount) {
		throw new Error(
			`Far terrain must upload one palette per activation: ${JSON.stringify(trace)}.`,
		);
	}
	if (
		state.metrics.farTerrainDraws > 0 &&
		state.metrics.farTerrainDraws === state.metrics.terrainFrameInputs &&
		trace.nearProgramActivationCount !== 0
	) {
		throw new Error(
			`Far-only terrain activated the near program: ${JSON.stringify(trace)}.`,
		);
	}
}

function summarizeEntityLifecycle(lifecycle) {
	if (lifecycle === null) return null;
	return {
		advances: summarizeEntityAdvances(lifecycle.advances),
		launched:
			lifecycle.launched === null
				? null
				: {
						generation: lifecycle.launched.generation,
						guid: lifecycle.launched.identity.guid,
						placement: lifecycle.launched.placement,
					},
		relocated:
			lifecycle.relocated === null
				? null
				: {
						durationMilliseconds: lifecycle.relocated.batch.durationMs,
						advances: lifecycle.relocated.batch.advances.map(
							({ entity, kind }) => ({
								generation: entity.generation,
								guid: entity.identity.guid,
								kind,
								placement: entity.placement,
							}),
						),
					},
		spawned: {
			generation: lifecycle.spawned.generation,
			identity: lifecycle.spawned.identity,
		},
		spawnedState: summarizeEntityLifecycleState(lifecycle.spawnedState),
		completedState: summarizeEntityLifecycleState(lifecycle.completedState),
		despawnedState: summarizeEntityLifecycleState(lifecycle.despawnedState),
	};
}

function summarizeEntityAdvances(events) {
	const changed = events
		.map((envelope) => envelope?.entityEvent ?? null)
		.filter((event) => event !== null);
	const summarize = (event) =>
		event === undefined
			? null
			: {
					durationMilliseconds: event.batch.durationMs,
					entities: event.batch.advances.map(({ entity, path }) => ({
						generation: entity.generation,
						guid: entity.identity.guid,
						endpoint: entity.placement.pose,
						contact: entity.placement.contact,
						pathLegCount: path.legs.length,
					})),
				};
	return {
		requestedTickCount: events.length,
		changedTickCount: changed.length,
		first: summarize(changed[0]),
		last: summarize(changed.at(-1)),
	};
}

async function runPossessionScenario(
	client,
	spawned,
	requestedTickMs,
	initialCamera,
	captureFrameState,
) {
	const tickMs = Math.min(50, requestedTickMs);
	const invoke = (method, args = []) =>
		evaluate(
			client,
			`globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.${method}`,
			args,
		);
	if (captureFrameState) {
		await invoke("setEnvCellRenderMode", ["portal"]);
		await invoke("probeNextFrameState");
	}
	let settledState = null;
	// The default outdoor camera can seed the fixture several hundred metres above support.
	for (let tick = 0; tick < 480; tick += 1) {
		await invoke("tickExplorerEntities", [tickMs]);
		settledState = await invoke("state");
		if (
			exactHarnessEntity(settledState, spawned).placement.contact === "grounded"
		)
			break;
	}
	if (settledState === null)
		throw new Error("Possession scenario did not execute a settling tick.");
	let current = exactHarnessEntity(settledState, spawned);
	if (current.placement.contact !== "grounded")
		throw new Error(
			`Possession scenario body did not settle onto terrain: ${JSON.stringify(current.placement)}.`,
		);
	const possession = await invoke("possessExplorerEntity", [
		spawned.identity.guid,
	]);
	const boomDirection = await invoke("kinematicBoomDirection");
	const orbitDirection =
		Math.hypot(boomDirection[0], boomDirection[1]) > 1e-6
			? [-boomDirection[1], boomDirection[0], 0]
			: [1, 0, 0];
	const boomIdentity = await invoke("startKinematicBoom", [
		{
			possessionGeneration: possession.possessionGeneration,
			guid: possession.guid,
			entityGeneration: possession.entityGeneration,
			initialReach: 4.5,
			minimumReach: 1.2,
			maximumReach: 32,
			inputSequence: 0,
			viewDirection: boomDirection,
			cumulativeZoomDisplacement: 0,
		},
	]);
	const boomIntentReceipts = [];
	for (const intent of [
		{
			inputSequence: 1,
			viewDirection: orbitDirection,
			cumulativeZoomDisplacement: -0.025,
		},
		{
			inputSequence: 2,
			viewDirection: boomDirection,
			cumulativeZoomDisplacement: 27.5,
		},
		{
			inputSequence: 1,
			viewDirection: [-1, 0, 0],
			cumulativeZoomDisplacement: -0.025,
		},
	]) {
		boomIntentReceipts.push(
			await invoke("setKinematicBoomIntent", [{ ...boomIdentity, ...intent }]),
		);
	}
	const controlProbe = await invoke("probeThirdPersonControls");
	const stance = possession.acceptedStance;
	let revision = 0;
	let sequence = 0;
	const outcomes = [];
	const boomTicks = [];
	const boomTargetCellIds = [];
	const boomFrameStates = [];
	const drive = (longitudinal = null, turn = null, lateral = null) => ({
		gait: "run",
		lateral,
		longitudinal,
		turn,
	});
	const setDrive = async (nextDrive) => {
		revision += 1;
		const result = await invoke("setPossessionIntent", [
			{
				drive: nextDrive,
				possessionGeneration: possession.possessionGeneration,
				revision,
				stance,
			},
		]);
		if (result !== "accepted")
			throw new Error(
				`Possession scenario intent ${revision} returned ${result}.`,
			);
	};
	const advance = async (count, sampleFrameState = false) => {
		for (let index = 0; index < count; index += 1) {
			const response = await invoke("tickPossession", [tickMs]);
			outcomes.push(...response.outcomes);
			if (response.envelope?.boom) boomTicks.push(response.envelope.boom);
			if (captureFrameState && sampleFrameState) {
				boomFrameStates.push(await invoke("probeNextFrameState"));
			}
			const targetAdvance = response.envelope?.entityEvent?.batch.advances.find(
				(advance) => advance.entity.identity.guid === possession.guid,
			);
			if (targetAdvance) {
				boomTargetCellIds.push(
					targetAdvance.path.initial.pose.landblockId,
					...targetAdvance.path.legs.map((leg) => leg.end.pose.landblockId),
				);
			}
			current = latestPossessionEntity(response, current);
		}
		const probe = await invoke("possessionMotionProbe");
		return { entity: current, probe };
	};
	const boomRoute = [];
	let repeatedStepTickRange = null;
	if (initialCamera.envCellId === "0xda550177") {
		await setDrive(drive(null, "left"));
		for (let tick = 0; tick < 40; tick += 1) {
			const advanced = await advance(1, true);
			boomRoute.push({
				phase: "turn-to-exit",
				entityCellId: advanced.entity.placement.pose.landblockId,
			});
			if (entityYawRadians(advanced.entity) >= Math.PI / 2 - 0.1) break;
		}
		await setDrive(drive("forward"));
		for (let tick = 0; tick < 240; tick += 1) {
			const advanced = await advance(1, true);
			const entityCellId = advanced.entity.placement.pose.landblockId;
			boomRoute.push({ phase: "walk-out", entityCellId });
			const selector = entityCellId & 0xffff;
			if (selector < 0x0100 || selector === 0xffff) break;
		}
		await setDrive(drive());
		await advance(1, true);
		await setDrive(drive(null, "right"));
		for (let tick = 0; tick < 40; tick += 1) {
			const advanced = await advance(1, true);
			boomRoute.push({
				phase: "turn-back-inside",
				entityCellId: advanced.entity.placement.pose.landblockId,
			});
			if (entityYawRadians(advanced.entity) <= -Math.PI / 2 + 0.1) break;
		}
		await setDrive(drive("forward"));
		for (let tick = 0; tick < 240; tick += 1) {
			const advanced = await advance(1, true);
			const entityCellId = advanced.entity.placement.pose.landblockId;
			boomRoute.push({ phase: "walk-to-lower-cell", entityCellId });
			if (entityCellId === 0xda550179) break;
		}
		if (current.placement.pose.landblockId !== 0xda550179) {
			throw new Error(
				`Possession boom route did not reach EnvCell 0xda550179; final pose ${JSON.stringify(current.placement.pose)}, route ${JSON.stringify(compactResidencyRoute(boomRoute))}.`,
			);
		}
		await setDrive(drive());
		await advance(8);
		const stepStart = boomTicks.length;
		for (let cycle = 0; cycle < 2; cycle += 1) {
			for (const [longitudinal, targetCell, phase] of [
				["backward", 0xda550177, `step-up-${cycle + 1}`],
				["forward", 0xda550179, `step-down-${cycle + 1}`],
			]) {
				await setDrive(drive(longitudinal));
				for (let tick = 0; tick < 240; tick += 1) {
					const advanced = await advance(1);
					const entityCellId = advanced.entity.placement.pose.landblockId;
					boomRoute.push({ phase, entityCellId });
					if (entityCellId === targetCell) break;
				}
				if (current.placement.pose.landblockId !== targetCell) {
					throw new Error(
						`Possession repeated-step route did not reach 0x${targetCell.toString(16)}; final pose ${JSON.stringify(current.placement.pose)}.`,
					);
				}
				await setDrive(drive());
				await advance(8);
			}
		}
		repeatedStepTickRange = { end: boomTicks.length, start: stepStart };
		await setDrive(drive("backward"));
		for (let tick = 0; tick < 240; tick += 1) {
			const advanced = await advance(1);
			const entityCellId = advanced.entity.placement.pose.landblockId;
			boomRoute.push({ phase: "return-outdoors", entityCellId });
			const selector = entityCellId & 0xffff;
			if (selector < 0x0100 || selector === 0xffff) break;
		}
		const selector = current.placement.pose.landblockId & 0xffff;
		if (selector >= 0x0100 && selector !== 0xffff) {
			throw new Error(
				`Possession repeated-step route did not return outdoors; final pose ${JSON.stringify(current.placement.pose)}.`,
			);
		}
		await setDrive(drive());
		await advance(8);
		await setDrive(drive(null, "left"));
		for (let tick = 0; tick < 40; tick += 1) {
			await advance(1);
			if (entityYawRadians(current) >= -0.1) break;
		}
		await setDrive(drive());
		await advance(8);
	}

	const initial = current;
	await setDrive(drive("backward"));
	let backward = await advance(1);
	for (let tick = 1; tick < 60; tick += 1) {
		const heading = entityYawRadians(initial);
		const from = entityCoordinates(initial);
		const to = entityCoordinates(backward.entity);
		const projection =
			(to.x - from.x) * -Math.sin(heading) +
			(to.y - from.y) * Math.cos(heading);
		if (projection < -0.01) break;
		backward = await advance(1);
	}

	await setDrive(drive());
	await advance(1);
	const turnStart = current;
	await setDrive(drive(null, "left"));
	const left = await advance(4);
	await setDrive(drive(null, "right"));
	const right = await advance(4);

	await setDrive(drive("backward", "left"));
	const combinedStart = current;
	const combined = await advance(4);
	await setDrive(drive(null, "left"));
	const turnOnly = await advance(3);
	await setDrive(drive("backward"));
	const backwardOnly = await advance(3);
	await setDrive(drive(null, null, "right"));
	const sidestepStart = current;
	const sidestep = await advance(4);

	const jumpingDrive = drive("forward");
	revision += 1;
	const begin = await invoke("queuePossessionEvent", [
		{
			drive: jumpingDrive,
			kind: "begin-jump",
			possessionGeneration: possession.possessionGeneration,
			revision,
			sequence: sequence++,
			stance,
		},
	]);
	const charged = await advance(1);
	revision += 1;
	const release = await invoke("queuePossessionEvent", [
		{
			drive: jumpingDrive,
			extent: 0.5,
			kind: "release-jump",
			possessionGeneration: possession.possessionGeneration,
			revision,
			sequence,
			stance,
		},
	]);
	const launchStart = current;
	let sawAirborne = false;
	let sawFalling = false;
	let maximumZ = entityCoordinates(current).z;
	let landed = null;
	for (let index = 0; index < 100; index += 1) {
		const step = await advance(1);
		maximumZ = Math.max(maximumZ, entityCoordinates(step.entity).z);
		if (step.entity.placement.contact === "airborne") sawAirborne = true;
		if (step.probe?.substate.command === 0x40000015) sawFalling = true;
		if (sawAirborne && step.entity.placement.contact === "grounded") {
			landed = step;
			break;
		}
	}
	const restoredStart = current;
	const restored = await advance(3);
	// Playback retains at most an active path and one successor. Wait beyond both endpoints, then
	// require one actual frame so a long renderer task cannot leave final evidence visually stale.
	await delay(tickMs * 5);
	await invoke("probeNextFrameState");
	const framing = await invoke("probeBoomFraming", [possession.guid]);
	const cameraBeforeRelease = (await invoke("state")).camera;
	await invoke("possessExplorerEntity", [null]);
	const postReleaseEnvelope = await invoke("tickExplorerEntities", [tickMs]);
	const stopAfterRelease = await invoke("stopKinematicBoom", [boomIdentity]);
	await delay(tickMs * 2);
	const cameraAfterRelease = (await invoke("state")).camera;

	return {
		backward,
		backwardOnly,
		begin,
		boom: {
			frameStates: boomFrameStates,
			framing,
			identity: boomIdentity,
			intentReceipts: boomIntentReceipts,
			postReleaseEnvelope,
			releaseCamera: { after: cameraAfterRelease, before: cameraBeforeRelease },
			repeatedStepTickRange,
			route: boomRoute,
			stopAfterRelease,
			targetCellIds: boomTargetCellIds,
			tickMs,
			ticks: boomTicks,
		},
		charged,
		combined,
		combinedStart,
		controlProbe,
		initial,
		landed,
		launchStart,
		left,
		maximumZ,
		possession,
		outcomes,
		release,
		restored,
		restoredStart,
		right,
		sawAirborne,
		sawFalling,
		sidestep,
		sidestepStart,
		tickMs,
		turnOnly,
		turnStart,
	};
}

function assertPossessionScenario(scenario) {
	if (scenario === null)
		throw new Error("Possession scenario produced no evidence.");
	const initial = entityCoordinates(scenario.initial);
	const backward = entityCoordinates(scenario.backward.entity);
	const heading = entityYawRadians(scenario.initial);
	const backwardProjection =
		(backward.x - initial.x) * -Math.sin(heading) +
		(backward.y - initial.y) * Math.cos(heading);
	if (!(backwardProjection < 0))
		throw new Error(
			`Possessed S did not displace opposite the starting forward vector: ${JSON.stringify({ initial, backward, heading, backwardProjection, probe: scenario.backward.probe })}`,
		);
	if (!(scenario.backward.probe?.substate.speed < 0))
		throw new Error(
			"Possessed S did not retain a reversed authored clip rate.",
		);
	const playableBoomTicks = scenario.boom.ticks.filter(
		(tick) => tick.kind === "advanced" || tick.kind === "reseeded",
	);
	if (
		JSON.stringify(scenario.boom.intentReceipts) !==
		JSON.stringify(["accepted", "accepted", "ignored-stale"])
	)
		throw new Error(
			`Host kinematic boom intent receipts were not accepted/accepted/stale: ${JSON.stringify(scenario.boom.intentReceipts)}.`,
		);
	if (playableBoomTicks.length === 0)
		throw new Error("Host kinematic boom published no playable path.");
	const failedBoomTick = scenario.boom.ticks.find(
		(tick) => tick.kind === "failed",
	);
	if (failedBoomTick !== undefined)
		throw new Error(
			`Host kinematic boom published terminal failure: ${JSON.stringify(failedBoomTick)}.`,
		);
	const invalidBoomTick = playableBoomTicks.find(
		(tick, index) =>
			tick.boomGeneration !== scenario.boom.identity.boomGeneration ||
			tick.possessionGeneration !==
				scenario.boom.identity.possessionGeneration ||
			tick.guid !== scenario.boom.identity.guid ||
			tick.entityGeneration !== scenario.boom.identity.entityGeneration ||
			tick.sequence !== index + 1 ||
			tick.path.legs.length === 0 ||
			tick.path.legs.at(-1)?.endFraction !== 1,
	);
	if (invalidBoomTick !== undefined)
		throw new Error(
			`Host kinematic boom published an invalid identity, sequence, or path: ${JSON.stringify(invalidBoomTick)}.`,
		);
	if (Math.abs(playableBoomTicks[0].desiredReach - 32) > 1e-5)
		throw new Error(
			`Host kinematic boom lost cumulative zoom input: ${playableBoomTicks[0].desiredReach}.`,
		);
	if (scenario.boom.postReleaseEnvelope?.boom != null)
		throw new Error("Host kinematic boom published after possession release.");
	if (scenario.boom.stopAfterRelease !== false)
		throw new Error("Released host kinematic boom remained stoppable.");
	const releaseCameraDistance = cameraDistance(
		scenario.boom.releaseCamera.before,
		scenario.boom.releaseCamera.after,
	);
	if (releaseCameraDistance > 1e-6)
		throw new Error(
			`Host kinematic boom release moved the camera by ${releaseCameraDistance} m.`,
		);
	if (scenario.boom.framing.planarForwardProjection < -0.01)
		throw new Error(
			`Host kinematic boom placed the camera ahead of its target: ${JSON.stringify(scenario.boom.framing)}.`,
		);
	if (
		scenario.boom.framing.planarCameraToTargetDistance > 0.05 &&
		scenario.boom.framing.planarForwardAlignment < 0.95
	)
		throw new Error(
			`Host kinematic boom lost path-aligned framing: ${JSON.stringify(scenario.boom.framing)}.`,
		);
	if (
		scenario.boom.releaseCamera.before.envCellId !==
		scenario.boom.releaseCamera.after.envCellId
	)
		throw new Error(
			`Host kinematic boom release changed camera residency: ${JSON.stringify(scenario.boom.releaseCamera)}.`,
		);
	const invalidPortalFrame = scenario.boom.frameStates.find(
		(state) =>
			state.camera === null ||
			state.metrics === null ||
			state.envCellRenderMode !== "portal" ||
			state.metrics.envCellRenderMode !== "portal" ||
			state.metrics.viewCount !== 1 ||
			(state.camera.envCellId !== null &&
				(state.metrics.visibleEnvCellScopeCount < 1 ||
					state.metrics.visibleEnvCellShells < 1)),
	);
	if (invalidPortalFrame !== undefined) {
		throw new Error(
			`Portal-mode boom frame lost its camera or base-scene selection state: ${JSON.stringify(invalidPortalFrame)}.`,
		);
	}
	if (
		scenario.boom.route.length > 0 &&
		![0xda550177, 0xda550178, 0xda55002d, 0xda550179].every((cellId) =>
			scenario.boom.targetCellIds.includes(cellId),
		)
	) {
		throw new Error(
			`Possession boom route omitted an authored target residency: ${JSON.stringify(scenario.boom.targetCellIds)}.`,
		);
	}
	if (
		scenario.controlProbe.cameraYawAfterKeyboardTurn !==
			scenario.controlProbe.cameraYawBefore ||
		scenario.controlProbe.cameraYawAfterPointerOrbit ===
			scenario.controlProbe.cameraYawBefore ||
		scenario.controlProbe.characterInputCountAfterKeyboard !== 1 ||
		scenario.controlProbe.characterInputCountAfterPointerAndWheel !== 1 ||
		!Number.isFinite(scenario.controlProbe.boomZoomDisplacement) ||
		scenario.controlProbe.boomZoomDisplacement === 0
	)
		throw new Error(
			`Third-person input ownership probe failed: ${JSON.stringify(scenario.controlProbe)}.`,
		);

	const leftDelta = wrappedAngleDelta(
		entityYawRadians(scenario.turnStart),
		entityYawRadians(scenario.left.entity),
	);
	const rightDelta = wrappedAngleDelta(
		entityYawRadians(scenario.left.entity),
		entityYawRadians(scenario.right.entity),
	);
	if (!(leftDelta * rightDelta < 0))
		throw new Error(
			"Possessed A and D did not produce opposite heading signs.",
		);
	assertPlanarStill(scenario.turnStart, scenario.left.entity, "A turn");
	assertPlanarStill(scenario.left.entity, scenario.right.entity, "D turn");

	if (
		planarDistance(scenario.combinedStart, scenario.combined.entity) <= 0.01 ||
		Math.abs(
			wrappedAngleDelta(
				entityYawRadians(scenario.combinedStart),
				entityYawRadians(scenario.combined.entity),
			),
		) <= 0.001
	) {
		throw new Error(
			"Backward-plus-turn did not change both position and heading.",
		);
	}
	assertPlanarStill(
		scenario.combined.entity,
		scenario.turnOnly.entity,
		"backward release",
	);
	if (
		planarDistance(scenario.turnOnly.entity, scenario.backwardOnly.entity) <=
		0.01
	)
		throw new Error(
			"Turn release did not leave backward displacement effective.",
		);

	if (
		scenario.outcomes.filter(
			(outcome) => outcome.result.kind === "jump-released",
		).length !== 1
	)
		throw new Error("Possession jump did not commit exactly one release.");
	const capability = scenario.possession.stances.find(
		(candidate) => candidate.style === scenario.possession.acceptedStance,
	);
	if (capability === undefined)
		throw new Error("Possession scenario lost its accepted stance capability.");
	const expectsFalling = ["ready-and-falling", "falling-only"].includes(
		capability.jumpPresentation,
	);
	if (
		!scenario.sawAirborne ||
		(expectsFalling && !scenario.sawFalling) ||
		(!expectsFalling && scenario.sawFalling) ||
		scenario.landed === null ||
		!(scenario.maximumZ > entityCoordinates(scenario.launchStart).z)
	)
		throw new Error(
			"Possession jump omitted ascent, Falling, or landing evidence.",
		);
	if (
		planarDistance(scenario.restoredStart, scenario.restored.entity) <= 0.01 &&
		scenario.restored.probe?.substate.command !== 0x44000007
	)
		throw new Error("Retained forward order did not restore after landing.");

	const sidestepDistance = planarDistance(
		scenario.sidestepStart,
		scenario.sidestep.entity,
	);
	if (capability.sidestep !== "target-authored") {
		const expected =
			(1.4976 *
				scenario.sidestepStart.presentation.objectScale *
				4 *
				scenario.tickMs) /
			1000;
		if (Math.abs(sidestepDistance - expected) > 0.04)
			throw new Error(
				`Fallback sidestep measured ${sidestepDistance} m; expected ${expected} m.`,
			);
		const presentsSidestep =
			scenario.sidestep.probe?.substate.command === 0x6500000f;
		if (
			(capability.sidestep === "standard-fallback-with-target-presentation") !==
			presentsSidestep
		)
			throw new Error(
				"Fallback sidestep target-presentation state disagreed with its capability.",
			);
	}
}

function exactHarnessEntity(state, expected) {
	const entity = state.spawnedEntities.find(
		(candidate) =>
			candidate.identity.guid === expected.identity.guid &&
			candidate.generation === expected.generation,
	);
	if (!entity)
		throw new Error("Possession scenario lost its exact entity generation.");
	return entity;
}

function latestPossessionEntity(response, previous) {
	if (response.envelope === null || response.envelope.entityEvent === null)
		return previous;
	const advance = response.envelope.entityEvent.batch.advances.find(
		(candidate) =>
			candidate.entity.identity.guid === previous.identity.guid &&
			candidate.entity.generation === previous.generation,
	);
	return advance?.entity ?? previous;
}

function entityCoordinates(entity) {
	if (entity.placement.kind !== "world")
		throw new Error("Possession scenario entity unexpectedly became attached.");
	return entity.placement.pose.coords;
}

function entityYawRadians(entity) {
	const rotation = entity.placement.pose.rotation;
	return Math.atan2(
		2 * (rotation.w * rotation.z + rotation.x * rotation.y),
		1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z),
	);
}

function wrappedAngleDelta(from, to) {
	return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function planarDistance(first, second) {
	const a = entityCoordinates(first);
	const b = entityCoordinates(second);
	return Math.hypot(b.x - a.x, b.y - a.y);
}

function cameraDistance(first, second) {
	return Math.hypot(
		second.position[0] - first.position[0],
		second.position[1] - first.position[1],
		second.position[2] - first.position[2],
	);
}

function assertPlanarStill(first, second, label) {
	if (planarDistance(first, second) > 0.01)
		throw new Error(`${label} unexpectedly translated the possessed body.`);
}

function assertLaunchedEntityLifecycle(result) {
	const lifecycle = result.entityLifecycle;
	if (lifecycle?.launched === null || lifecycle?.launched === undefined) {
		throw new Error(
			"Launch scenario did not return a current launched entity.",
		);
	}
	const { velocity } = lifecycle.launched.placement;
	if (Math.hypot(velocity.x, velocity.y, velocity.z) <= 0) {
		throw new Error("Launch scenario returned zero current velocity.");
	}
	const advance = lifecycle.advances.find(
		(envelope) => envelope?.entityEvent !== null,
	)?.entityEvent;
	if (advance === undefined || advance === null) {
		throw new Error(
			"Launch scenario produced no changed-entity advance batch.",
		);
	}
	if (
		!advance.batch.advances.some(
			({ entity }) =>
				entity.identity.guid === lifecycle.spawned.identity.guid &&
				entity.generation === lifecycle.spawned.generation,
		)
	) {
		throw new Error("Launch advance omitted the exact spawned generation.");
	}
}

function assertRelocatedEntityLifecycle(result, expectedKind) {
	const event = result.entityLifecycle?.relocated;
	if (event?.kind !== "advanced" || event.batch.durationMs !== 0) {
		throw new Error(
			"Relocation scenario did not produce a zero-duration correction batch.",
		);
	}
	const [advance] = event.batch.advances;
	if (advance?.kind !== expectedKind) {
		throw new Error(
			`Relocation scenario returned ${advance?.kind ?? "no"} correction instead of ${expectedKind}.`,
		);
	}
	const placement = advance.entity.placement;
	if (
		Math.hypot(
			placement.velocity.x,
			placement.velocity.y,
			placement.velocity.z,
			placement.acceleration.x,
			placement.acceleration.y,
			placement.acceleration.z,
			placement.omega.x,
			placement.omega.y,
			placement.omega.z,
		) !== 0
	) {
		throw new Error("Relocation correction did not clear live kinematics.");
	}
}

function summarizeEntityLifecycleState(state) {
	const dynamics = state.authoredDynamics;
	return {
		currentEntities: state.spawnedEntities.map(
			({ generation, identity, placement, presentation }) => ({
				generation,
				identity,
				placement,
				// Appearance cardinality proves resolution reached the frontend without dumping
				// every palette range into the report.
				appearance: {
					paletteDid: presentation?.appearance?.paletteDid ?? null,
					subPalettes: presentation?.appearance?.subPalettes?.length ?? 0,
					textureChanges: presentation?.appearance?.textureChanges?.length ?? 0,
					partChanges: presentation?.appearance?.partChanges?.length ?? 0,
				},
			}),
		),
		visibleDynamicEntityCount: state.metrics?.visibleDynamicEntityCount ?? null,
		runtime:
			dynamics === null
				? null
				: {
						activeAnimationCount: dynamics.animation.activePlaybackCount,
						activeAudioCount: dynamics.audio.activeVoiceCount,
						activeParticleCount: dynamics.particles.particleCount,
						activeParticleEmitterCount: dynamics.particles.emitterCount,
						activePhysicsScriptCount: dynamics.physicsScripts.activeScriptCount,
						activeSkyScriptCount: dynamics.skyScripts.activeCount,
						animationAssetCount:
							dynamics.dynamics.animationResources.assetCount,
						animationReferenceCount:
							dynamics.dynamics.animationResources.referenceCount,
						entityCount: dynamics.dynamics.entityCount,
						residentEffectStateCount: dynamics.effects.residentEffectStateCount,
						templateCount: dynamics.dynamics.templates.templateCount,
					},
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
				"portalAtlasTilePixelCount",
				"portalCompletedCullDepth",
				"portalFrontierRetreatCount",
				"portalProjectionPrimitiveCount",
				"portalPropagationDrawCount",
				"portalSelectedCrossingCount",
				"portalSelectedScopeCount",
				"portalTruncatedViewCount",
			]) {
				if (state.metrics[key] !== 0) {
					throw new Error(
						`Flat mode cycle snapshot ${index} retained portal frame work in ${key}.`,
					);
				}
			}
		}
	}
	const firstPortalTargets = states[0].metrics.portalFramebufferCount;
	const firstPortalTargetBytes = states[0].metrics.portalTargetBytes;
	if (firstPortalTargets <= 0 || firstPortalTargetBytes <= 0) {
		throw new Error(
			"Mode cycle portal frame did not retain scope-atlas targets and bytes.",
		);
	}
	for (const [index, state] of states.entries()) {
		if (
			state.metrics.portalFramebufferCount !== firstPortalTargets ||
			state.metrics.portalTargetBytes !== firstPortalTargetBytes
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

function assertSpawnedEntityLifecycle(result) {
	const lifecycle = result.entityLifecycle;
	if (lifecycle === null) {
		throw new Error("Spawned-entity scenario produced no lifecycle evidence.");
	}
	const initialDynamics = result.initialState.authoredDynamics?.dynamics;
	const spawnedDynamics = lifecycle.spawnedState?.authoredDynamics?.dynamics;
	const despawnedDynamics =
		lifecycle.despawnedState?.authoredDynamics?.dynamics;
	if (!initialDynamics || !spawnedDynamics || !despawnedDynamics) {
		throw new Error("Spawned-entity scenario omitted dynamic runtime state.");
	}
	const worldEntities = lifecycle.spawnedState.spawnedEntities.filter(
		(entity) => entity.placement.kind === "world",
	);
	if (worldEntities.length !== 1) {
		throw new Error(
			"Spawned-entity scenario did not retain exactly one world-placed wearer.",
		);
	}
	if (
		spawnedDynamics.entityCount !==
		initialDynamics.entityCount + lifecycle.spawnedState.spawnedEntities.length
	) {
		throw new Error(
			"Catalog spawn did not realize its complete wearer/child entity group.",
		);
	}
	if (
		(lifecycle.spawnedState.metrics?.visibleDynamicEntityCount ?? 0) <=
		(result.initialState.metrics?.visibleDynamicEntityCount ?? 0)
	) {
		throw new Error("Catalog spawn did not become a visible dynamic entity.");
	}
	if (lifecycle.despawnedState.spawnedEntities.length !== 0) {
		throw new Error(
			"Exact despawn left a current entity in the harness projection.",
		);
	}
	if (despawnedDynamics.entityCount !== initialDynamics.entityCount) {
		throw new Error("Exact despawn retained a shared-runtime dynamic entity.");
	}
	if (
		despawnedDynamics.templates.templateCount !==
		initialDynamics.templates.templateCount
	) {
		throw new Error("Exact despawn retained an immutable visual template.");
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

/**
 * Start, or reuse, a Vite server for this harness run.
 *
 * Reuse is keyed on the port, and a server on the default port may belong to a *different
 * worktree* — which silently serves that worktree's code and its content host, producing
 * results that look like flaky decoding rather than like the wrong build. Pass --vite-port to
 * isolate a run when more than one checkout is active.
 */
async function startViteServer(port) {
	const viteUrl = `http://127.0.0.1:${port}`;
	if (await isUrlReady(`${viteUrl}/harness/browser/`)) {
		process.stderr.write(
			`Reusing Vite server at ${viteUrl}. Pass --vite-port to isolate this run from ` +
				`another worktree.\n`,
		);
		return viteUrl;
	}
	startChild("npx", [
		"vite",
		"--host",
		"127.0.0.1",
		"--port",
		String(port),
		"--strictPort",
	]);
	await waitForUrl(`${viteUrl}/harness/browser/`, 60_000);
	return viteUrl;
}

/** The page's positional scene-interest contract, built once so call sites cannot drift. */
function sceneInterestArgs(options, landblockId, generatedObjectRadius) {
	return [
		landblockId,
		options.terrainRadius ?? options.buildingRadius,
		options.buildingRadius,
		options.envCellRadius,
		options.explicitObjectRadius,
		generatedObjectRadius,
		options.cameraYawDegrees,
		options.cameraPitchDegrees,
	];
}

/** Re-issue interest at one landblock and settle, the unit every relocation path repeats. */
async function hopToLandblock(client, options, landblockId, settleMs) {
	// Timing resets per hop so each crossing reports its own worst frame instead of a running
	// maximum inherited from initial load.
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.resetTiming",
		[],
	);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.requestSceneInterest",
		sceneInterestArgs(options, landblockId, options.generatedObjectRadius),
	);
	await delay(settleMs);
	return evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
		[],
	);
}

async function placeEnvCellCamera(client, options) {
	if (
		options.envCellCameraId === null ||
		options.envCellCameraPosition === null
	) {
		throw new Error(
			"EnvCell camera placement requires a complete option pair.",
		);
	}
	if (options.envCellCameraPosition === "center") {
		return evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.focusExplorerEnvCell",
			[
				options.envCellCameraId,
				options.cameraYawDegrees,
				options.cameraPitchDegrees,
			],
		);
	}
	return evaluate(
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
	const dayGroup =
		options.dayGroup === null
			? ""
			: `&dayGroup=${encodeURIComponent(options.dayGroup)}`;
	const particleSeed =
		options.particleSeed === undefined
			? ""
			: `&particleSeed=${encodeURIComponent(options.particleSeed)}`;
	const frameIntervalMs =
		options.frameIntervalMs === undefined
			? ""
			: `&frameIntervalMs=${encodeURIComponent(options.frameIntervalMs)}`;
	const captureFrame =
		options.captureFrame === undefined
			? ""
			: `&captureFrame=${encodeURIComponent(options.captureFrame)}`;
	const attachmentExclusion = options.excludeSpawnedAttachments
		? "&excludeSpawnedAttachments=true"
		: "";
	const audioTrace =
		options.audioFlybyTarget === null &&
		options.followFlightLandblockId === null
			? ""
			: "&audioTrace=1";
	const terrainGlTrace = options.traceTerrainGl ? "&traceTerrainGl=true" : "";
	const pageUrl = `${viteUrl}/harness/browser/?contentHost=${encodeURIComponent(contentHostUrl)}&cameraHeight=${encodeURIComponent(options.cameraHeight)}&viewportWidth=${encodeURIComponent(options.viewportWidth)}&viewportHeight=${encodeURIComponent(options.viewportHeight)}${dynamicIsolation}${dynamicExclusion}${attachmentExclusion}${fixture}${timeOfDay}${dayGroup}${particleSeed}${frameIntervalMs}${captureFrame}${audioTrace}${terrainGlTrace}`;
	const chrome = startChild(options.chromePath, [
		"--remote-debugging-port=0",
		`--user-data-dir=${userDataDirectory}`,
		"--no-first-run",
		"--disable-background-networking",
		// SwiftShader is the default because it is deterministic and available everywhere, but it
		// is useless for performance attribution. --gpu swaps in the real adapter.
		...(options.gpu
			? [
					"--use-gl=angle",
					"--use-angle=vulkan",
					"--ignore-gpu-blocklist",
					// Without these the loop paces at a fixed rate and frame time stops
					// responding to rendering cost, which makes timing worthless.
					"--disable-gpu-vsync",
					"--disable-frame-rate-limit",
				]
			: [
					"--use-gl=angle",
					"--use-angle=swiftshader",
					"--enable-unsafe-swiftshader",
				]),
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
			sceneInterestArgs(
				options,
				options.landblockId,
				options.generatedObjectRadius,
			),
		);
		if (options.renderScale !== null) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setRenderScale",
				[options.renderScale],
			);
		}
		if (options.minimumPortalFootprintCssPixelArea !== null) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setMinimumPortalFootprintCssPixelArea",
				[options.minimumPortalFootprintCssPixelArea],
			);
		}
		if (options.minimumObjectFootprintCssPixelArea !== null) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setMinimumObjectFootprintCssPixelArea",
				[options.minimumObjectFootprintCssPixelArea],
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
		if (
			options.possessionScenario &&
			options.envCellCameraId !== null &&
			options.envCellCameraPosition !== null
		) {
			await placeEnvCellCamera(client, options);
		}
		const initialState = await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
			[],
		);
		let spawnedEntity = null;
		let launchedEntity = null;
		let relocatedEntity = null;
		const entityAdvanceEvents = [];
		let spawnedEntityState = null;
		let completedEntityState = null;
		let possessionScenario = null;
		if (options.spawnWcid !== null && options.entityShowcaseCount === 0) {
			spawnedEntity = await evaluate(
				client,
				options.spawnSimulated || options.possessionScenario
					? "globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.spawnSimulatedExplorerEntity"
					: "globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.spawnExplorerEntity",
				[options.spawnWcid, options.spawnDistance],
			);
			await delay(500);
			spawnedEntityState = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
				[],
			);
			if (options.possessionScenario) {
				possessionScenario = await runPossessionScenario(
					client,
					spawnedEntity,
					options.entityTickMs,
					initialState.camera,
					options.frameMode === "portal",
				);
			}
			if (options.launchDirection !== null) {
				launchedEntity = await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.launchExplorerEntity",
					[
						spawnedEntity.identity.guid,
						spawnedEntity.generation,
						options.launchDirection,
					],
				);
			}
			for (let tick = 0; tick < options.entityTicks; tick += 1) {
				entityAdvanceEvents.push(
					await evaluate(
						client,
						"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.tickExplorerEntities",
						[options.entityTickMs],
					),
				);
			}
			if (options.relocateKind !== null) {
				relocatedEntity = await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.relocateExplorerEntity",
					[
						spawnedEntity.identity.guid,
						spawnedEntity.generation,
						options.relocateDistance,
						options.relocateKind,
					],
				);
			}
			await delay(500);
			completedEntityState = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
				[],
			);
		}
		let entityShowcase = null;
		if (options.entityShowcaseCount > 0) {
			// Distinct GUIDs in one session, spread laterally in front of the camera: appearance
			// variation between NPCs is a looking-at-it check, and a fresh harness process would
			// otherwise reissue the same first GUID and therefore the same deterministic roll.
			const offsets = [];
			for (let index = 0; index < options.entityShowcaseCount; index += 1) {
				const lateral =
					(index - (options.entityShowcaseCount - 1) / 2) *
					ENTITY_SHOWCASE_SEPARATION;
				offsets.push([lateral, options.spawnDistance, 0]);
			}
			entityShowcase = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.spawnExplorerEntityFleet",
				[options.spawnWcid, offsets, "pose-only"],
			);
			await delay(1000);
		}
		let entityPair = null;
		if (options.entityPairWcid !== null) {
			// Two solid bodies 3 m apart along AC +x. Launching the first along +x drives a real
			// peer contact through the shared solver; the camera body is never a participant.
			const movers = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.spawnExplorerEntityFleet",
				[options.entityPairWcid, [[0, 12, 0]], "simulated"],
			);
			const targets = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.spawnExplorerEntityFleet",
				[
					options.entityPairTargetWcid ?? options.entityPairWcid,
					[[options.entityPairSeparation, 12, 0]],
					"simulated",
				],
			);
			const pair = [...movers, ...targets];
			await delay(300);
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.launchExplorerEntity",
				[pair[0].identity.guid, pair[0].generation, [1, 0, 0]],
			);
			const pairTicks = [];
			for (let tick = 0; tick < options.entityTicks; tick += 1) {
				pairTicks.push(
					await evaluate(
						client,
						"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.tickExplorerEntities",
						[options.entityTickMs],
					),
				);
			}
			await delay(300);
			const contactState = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
				[],
			);
			const retired = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.despawnExplorerEntityFleet",
				[],
			);
			await delay(200);
			entityPair = {
				spawned: pair.map((entity) => ({
					guid: entity.identity.guid,
					generation: entity.generation,
					pose: entity.placement.pose.coords,
				})),
				tickCount: pairTicks.filter((event) => event !== null).length,
				// Final placement of both bodies. The mover starts at x=0 relative to the target's
				// x=+3; a blocking response leaves it short of the target rather than past it.
				finalPlacements: contactState.spawnedEntities.map((entity) => ({
					guid: entity.identity.guid,
					wcid: entity.identity.wcid,
					coords: entity.placement.pose.coords,
					velocity: entity.placement.velocity,
					contact: entity.placement.contact,
					semanticMask: entity.physics.semanticMask,
				})),
				contactState: summarizeEntityRuntimeState(contactState),
				retiredCount: retired,
				teardownState: summarizeEntityRuntimeState(
					await evaluate(
						client,
						"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
						[],
					),
				),
			};
		}
		let entityPopulation = null;
		if (options.entityPopulationWcid !== null) {
			// A comma-separated list interleaves catalog-proven target-geometry branches across the
			// lattice, so one run covers physics-BSP, cylsphere, and sphere targets together.
			const populationWcids = options.entityPopulationWcid.split(",");
			const offsets = populationOffsets(options.entityPopulationCount);
			const populationStart = Date.now();
			const population = [];
			for (const [index, wcid] of populationWcids.entries()) {
				const share = offsets.filter(
					(_, offsetIndex) => offsetIndex % populationWcids.length === index,
				);
				if (share.length === 0) continue;
				population.push(
					...(await evaluate(
						client,
						"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.spawnExplorerEntityFleet",
						[wcid, share, "simulated"],
					)),
				);
			}
			const spawnMs = Date.now() - populationStart;
			await delay(500);
			const populatedState = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
				[],
			);
			const tickDurations = [];
			// Advanced-body count per tick. A settled body leaves the integration scan, so this
			// series falling below the population is the observable proof of quiescent pruning at
			// product scale; it reads a production event rather than adding a runtime counter.
			const advancedPerTick = [];
			for (let tick = 0; tick < options.entityTicks; tick += 1) {
				const started = Date.now();
				const event = await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.tickExplorerEntities",
					[options.entityTickMs],
				);
				tickDurations.push(Date.now() - started);
				advancedPerTick.push(event === null ? 0 : event.batch.advances.length);
			}
			await delay(300);
			const settledState = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
				[],
			);
			const retired = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.despawnExplorerEntityFleet",
				[],
			);
			await delay(400);
			entityPopulation = {
				wcids: populationWcids,
				requestedCount: options.entityPopulationCount,
				spawnedCount: population.length,
				spawnMs,
				populatedState: summarizeEntityRuntimeState(populatedState),
				settledState: summarizeEntityRuntimeState(settledState),
				harnessRoundTripMs: summarizeDurations(tickDurations),
				advancedPerTick: {
					first: advancedPerTick[0] ?? null,
					last: advancedPerTick[advancedPerTick.length - 1] ?? null,
					minimum: advancedPerTick.length ? Math.min(...advancedPerTick) : null,
					maximum: advancedPerTick.length ? Math.max(...advancedPerTick) : null,
				},
				retiredCount: retired,
				teardownState: summarizeEntityRuntimeState(
					await evaluate(
						client,
						"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
						[],
					),
				),
			};
		}
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
			await placeEnvCellCamera(client, options);
		}
		const modeCycleStates = [];
		const ambientOcclusionCycleStates = [];
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
				modeCycleStates.push(await waitForFrameMode(client, mode));
			}
		} else if (options.frameMode !== null) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setEnvCellRenderMode",
				[options.frameMode],
			);
			await delay(250);
		}
		if (options.ambientOcclusionCycle) {
			for (const enabled of [true, false, true]) {
				await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setAmbientOcclusion",
					[enabled],
				);
				await delay(250);
				ambientOcclusionCycleStates.push(
					await evaluate(
						client,
						"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
						[],
					),
				);
			}
		} else if (options.ambientOcclusion !== null) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setAmbientOcclusion",
				[options.ambientOcclusion],
			);
			await delay(250);
		}
		if (options.ambientOcclusionCoverage) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setAmbientOcclusionCoverageVisualization",
				[true],
			);
			await delay(500);
		}
		let audioFlyby = null;
		if (options.audioFlybyTarget !== null) {
			audioFlyby = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.probeAudioFlyby",
				[
					options.landblockId,
					options.cameraPosition,
					options.audioFlybyTarget,
					options.audioFlybySteps,
					options.audioFlybyFramesPerStep,
					options.cameraYawDegrees,
					options.cameraPitchDegrees,
				],
			);
		}
		let cameraSweepScreenshots = null;
		if (options.cameraSweepPosition !== null) {
			const capture = async () =>
				(
					await client.send("Page.captureScreenshot", {
						captureBeyondViewport: false,
						format: "png",
					})
				).data;
			const start = await capture();
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setOutdoorCamera",
				[
					options.landblockId,
					options.cameraSweepPosition,
					options.cameraYawDegrees,
					options.cameraPitchDegrees,
				],
			);
			await delay(250);
			const end = await capture();
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
			await delay(250);
			cameraSweepScreenshots = { end, returned: await capture(), start };
		}
		let portalScreenshot = null;
		let portalExecution = null;
		if (options.executePortal) {
			const args = [
				options.envCellCameraId,
				options.envCellCameraPosition,
				options.cameraYawDegrees,
				options.cameraPitchDegrees,
			];
			if (options.screenshotPath) {
				// The probe is intentionally one-shot. Copy its canvas in the same browser task so the
				// continuous render loop cannot replace the evidence before Page.captureScreenshot.
				const capture = await evaluateExpression(
					client,
					`(() => {
						const execution = globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__
							.probePortalExecution(...${JSON.stringify(args)});
						const canvas = document.querySelector("canvas");
						if (!(canvas instanceof HTMLCanvasElement)) {
							throw new Error("Browser harness renderer canvas is unavailable.");
						}
						return {
							execution,
							screenshot: canvas.toDataURL("image/png").slice("data:image/png;base64,".length),
						};
					})()`,
				);
				portalExecution = capture.execution;
				portalScreenshot = capture.screenshot;
			} else {
				portalExecution = await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.probePortalExecution",
					args,
				);
			}
		}
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
				sceneInterestArgs(
					options,
					options.landblockId,
					options.generatedObjectRadius,
				),
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
			relocationState = await hopToLandblock(
				client,
				options,
				options.relocateLandblockId,
				options.settleMs,
			);
		}
		const relocationSequence = [];
		for (const landblockId of options.relocateSequence) {
			const state = await hopToLandblock(
				client,
				options,
				landblockId,
				options.relocateHopMs,
			);
			relocationSequence.push({
				landblockId,
				// Publication count travels with the timing: frame cost during a crossing scales
				// with how many layer installs land in the window, so timings from runs that
				// published different amounts are not comparable.
				staticLayerPublicationCount:
					state.staticObjects.staticLayerPublicationCount,
				outdoorLightScopeCount: state.staticObjects.outdoorLightScopeCount,
				terrainWorker: state.terrainWorker,
				texture: state.staticObjects.texture,
				timing: state.timing,
			});
		}
		let cpuProfileStarted = false;
		const startCpuProfile = async () => {
			if (!options.cpuProfilePath || cpuProfileStarted) return;
			cpuProfileStarted = true;
			await client.send("Profiler.enable");
			// 100 µs sampling: the 1 ms default would land only ~2 samples in a ~2 ms frame.
			await client.send("Profiler.setSamplingInterval", { interval: 100 });
			await client.send("Profiler.start");
		};
		let followFlight = null;
		if (options.followFlightLandblockId) {
			// Start profiling before the flight so churn spikes land inside the sampled window.
			// The settle keeps profiler warm-up (an unattributed "(program)" blob) from
			// overlapping the flight's first frames.
			await startCpuProfile();
			if (cpuProfileStarted) await delay(1000);
			followFlight = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.runFollowFlight",
				[options.followFlightLandblockId, options.followFlightMs],
			);
		}
		let generatedDisabledState = null;
		if (options.disableGeneratedBeforeCapture) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.requestSceneInterest",
				sceneInterestArgs(
					options,
					options.relocateLandblockId ?? options.landblockId,
					null,
				),
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
		if (options.colorGrade) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setColorGrade",
				[options.colorGrade],
			);
			await delay(50);
		}
		if (!options.staticLights) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setStaticLights",
				[false],
			);
			await delay(50);
		}
		if (!options.weather) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setWeather",
				[false],
			);
			await delay(50);
		}
		for (const layer of options.disabledLayersBeforeCapture) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setLayerVisibility",
				[layer, false],
			);
		}
		if (options.disabledLayersBeforeCapture.length > 0) await delay(50);
		if (options.profileRenderer) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setFrameProfiling",
				[true],
			);
		}
		if (options.traceTerrainGl) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.resetTerrainGlTrace",
				[],
			);
		}
		let cpuProfile = null;
		await startCpuProfile();
		if (options.measureMs > 0) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.resetTiming",
				[],
			);
			await delay(options.measureMs);
		} else if (
			options.profileRenderer ||
			options.cpuProfilePath ||
			options.traceTerrainGl
		) {
			await delay(250);
		}
		if (options.cpuProfilePath) {
			cpuProfile = (await client.send("Profiler.stop")).profile;
		}
		if (options.captureFrame !== undefined) {
			await waitForCaptureFrame(client, options.captureFrame);
		}
		// Recorded so any timing carries proof of which adapter produced it. SwiftShader numbers
		// are not performance evidence.
		const glRenderer = await evaluateExpression(
			client,
			`(() => {
				const canvas = document.createElement("canvas");
				const gl = canvas.getContext("webgl2");
				if (gl === null) return "no-webgl2";
				const info = gl.getExtension("WEBGL_debug_renderer_info");
				return info === null
					? gl.getParameter(gl.RENDERER)
					: gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
			})()`,
		);
		const state = await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
			[],
		);
		const screenshot = portalScreenshot
			? { data: portalScreenshot }
			: await client.send("Page.captureScreenshot", {
					captureBeyondViewport: false,
					format: "png",
				});
		let despawnedEntityState = null;
		if (spawnedEntity !== null) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.despawnExplorerEntity",
				[spawnedEntity.identity.guid, spawnedEntity.generation],
			);
			await delay(100);
			despawnedEntityState = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
				[],
			);
		}
		return {
			cpuProfile,
			ambientOcclusionCycleStates,
			audioFlyby,
			cameraSweepScreenshots,
			glRenderer,
			consoleMessages,
			entityPair,
			entityShowcase,
			entityPopulation,
			entityLifecycle:
				spawnedEntity === null
					? null
					: {
							advances: entityAdvanceEvents,
							completedState: completedEntityState,
							launched: launchedEntity,
							relocated: relocatedEntity,
							spawned: spawnedEntity,
							spawnedState: spawnedEntityState,
							despawnedState: despawnedEntityState,
						},
			generatedDisabledState,
			initialState,
			filteringCycleStates,
			modeCycleStates,
			lifecycleState,
			portalExecution,
			possessionScenario,
			followFlight,
			relocationSequence,
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

/** Wait until a rendered frame, rather than only frontend settings, observes one mode change. */
async function waitForFrameMode(client, expectedMode) {
	const timeoutAt = Date.now() + 30_000;
	while (Date.now() < timeoutAt) {
		const state = await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
			[],
		);
		if (state.error) {
			throw new Error(
				`Browser harness failed while awaiting ${expectedMode} mode: ${state.error}`,
			);
		}
		if (state.metrics?.envCellRenderMode === expectedMode) return state;
		await delay(50);
	}
	throw new Error(
		`Browser harness renderer did not observe ${expectedMode} mode within 30 seconds.`,
	);
}

/** Block until the page has rendered the frame its simulation time is frozen at. */
async function waitForCaptureFrame(client, captureFrame) {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const frames = await evaluateExpression(
			client,
			"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state().frames",
		);
		if (frames >= captureFrame) return;
		await delay(50);
	}
	throw new Error(`Timed out waiting for capture frame ${captureFrame}.`);
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
