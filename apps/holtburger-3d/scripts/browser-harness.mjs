#!/usr/bin/env node
import { probePreciseJumpCamera } from "./client-precise-camera-probe.mjs";
import { probeBindingControls } from "./client-binding-controls-probe.mjs";
import { probeVendor } from "./client-vendor-probe.mjs";
import {
	probeCharacterSheet,
	probeClientHud,
	probeClientSettingsTabs,
} from "./client-hud-probe.mjs";
import { probeObjectInspection } from "./client-object-inspection-probe.mjs";
import { probeKeyboardPolicy } from "./keyboard-policy-probe.mjs";
import { probeTrade } from "./client-trade-probe.mjs";
import { probeClientBook } from "./client-book-probe.mjs";
import { probeLoadouts } from "./client-loadout-probe.mjs";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { decode } from "@msgpack/msgpack";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { findAvailablePort, parseVitePort } from "./dev-port.mjs";
import { probeUiTheme } from "./ui-theme-probe.mjs";

const DEFAULT_CHROME_PATH = "/opt/google/chrome/chrome";
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
/** Settle policy changes before each timed shadow benchmark window. */
const ENTITY_SHADOW_BENCHMARK_WARMUP_MS = 500;
/** Let the direct preview renderer and world profile reach steady state. */
const OBJECT_PREVIEW_BENCHMARK_WARMUP_MS = 1_000;
/** Settle the cold nameplate setting before each paired timing window. */
const NAMEPLATE_BENCHMARK_WARMUP_MS = 500;
/** Test-owned enabled ceiling held constant across nameplate benchmark runs. */
const NAMEPLATE_BENCHMARK_VISIBLE_LIMIT = 50;
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
	if (options.worldMap) {
		const cacheRoot = await mkdtemp(
			join(tmpdir(), "holtburger-world-map-cache-"),
		);
		tempDirectories.push(cacheRoot);
		childEnvironment.HOLTBURGER_WORLD_MAP_CACHE = cacheRoot;
	}
	const contentHostUrl =
		options.clientHud || options.characterSheet
			? null
			: await startContentHost();
	const viteUrl = await startViteServer(options.vitePort);
	const result =
		options.clientHud || options.characterSheet
			? await runClientHudHarness({ viteUrl })
			: await runHarness({ contentHostUrl, viteUrl });
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
	let report;
	if (options.clientPartyScreenshotDirectory !== null) {
		report = {
			suite: "party-hud-screenshots",
			screenshots: result.partyHudScreenshots,
			browserErrors,
		};
	} else if (options.clientVitals) {
		report = {
			suite: "client-vitals",
			evidence: result.clientVitals,
			browserErrors,
		};
	} else if (options.clientEnvironment) {
		report = {
			suite: "client-environment",
			evidence: result.clientEnvironment,
			browserErrors,
		};
	} else if (options.clientSettingsTabs) {
		report = {
			suite: "client-settings-tabs",
			passed: true,
			evidence: result.clientSettingsTabs,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientHousing) {
		report = {
			suite: "client-housing",
			passed: true,
			evidence: result.housing,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientWorldMap) {
		report = {
			suite: "client-world-map",
			passed: true,
			evidence: result.worldMapPanel,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.worldMap) {
		report = {
			suite: "world-map",
			passed: true,
			hardware: result.hardware,
			memory: result.memory,
			contention: result.contention,
			partial: result.partial,
			markerProjection: result.markerProjection,
			controls: result.controls,
			settlements: result.settlements,
			teleport: result.teleport,
			initial: result.initial,
			wholeWorld: result.wholeWorld,
			closeUp: result.closeUp,
			zoomLatency: result.zoomLatency,
			reopened: result.reopened,
			lost: result.lost,
			failed: result.failed,
			retried: result.retried,
			disposed: result.disposed,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.uiTheme) {
		report = {
			uiTheme: result.uiTheme.evidence,
			glRenderer: result.glRenderer,
			viewport: result.state.viewport,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.characterSheet) {
		report = {
			suite: "character-sheet",
			passed: true,
			characterSheet: result.characterSheet,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientTrade) {
		report = {
			suite: "client-trade",
			passed: true,
			trade: result.clientTrade,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientAudio) {
		report = { clientAudio: result.clientAudio, browserErrors };
	} else if (options.clientKeyboard) {
		report = {
			suite: "client-keyboard",
			passed: true,
			evidence: result.clientKeyboard,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientInspection) {
		report = {
			suite: "client-inspection",
			passed: true,
			evidence: result.clientInspection,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientAllegiance) {
		report = {
			suite: "client-allegiance",
			...result.clientAllegiance,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientSquelch) {
		report = {
			suite: "client-squelch",
			...result.clientSquelch,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientBindingControls) {
		report = {
			suite: "client-binding-controls",
			...result.clientBindingControls,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientBindings) {
		report = {
			suite: "client-bindings",
			...result.clientBindings,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientSelectedActions) {
		report = {
			suite: "client-selected-actions",
			...result.clientSelectedActions,
			actionFeedback: result.clientActionFeedback,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientContracts) {
		report = {
			suite: "client-contracts",
			...result.clientContracts,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientFriends) {
		report = {
			suite: "client-friends",
			...result.clientFriends,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientParty) {
		report = {
			suite: "client-party",
			...result.clientParty,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientBook) {
		report = {
			clientBook: result.clientBook,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientConnection) {
		report = {
			suite: "client-connection",
			passed: true,
			connectionBadge: result.connectionBadge,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientLoadouts) {
		report = { clientLoadouts: result.clientLoadouts, browserErrors };
	} else if (options.clientPreciseJump) {
		report = {
			suite: "client-precise-jump",
			...result.clientPreciseJump,
			consoleMessages: result.consoleMessages,
		};
	} else if (options.clientHud) {
		const evidence = {
			clientHud: result.clientHud,
			connectionBadge: result.connectionBadge,
			clientInspection: result.clientInspection,
			clientTargeting: result.clientTargeting,
			clientPreciseJump: result.clientPreciseJump,
			clientTheme: result.clientTheme,
			clientInventory: result.clientInventory,
			keyboardPolicy: result.keyboardPolicy,
		};
		report =
			options.reportMode === "full"
				? {
						...evidence,
						consoleMessages: result.consoleMessages,
						viewport: result.state.viewport,
					}
				: {
						suite: "client-hud",
						passed: true,
						checks: Object.keys(evidence),
						warnings: result.consoleMessages.filter(
							({ level }) => level === "warning",
						).length,
						viewport: result.state.viewport,
					};
	} else if (options.reportMode === "particle-sao") {
		report = particleSaoHarnessReport(result);
	} else if (options.reportMode === "nameplate") {
		report = nameplateHarnessReport(result);
	} else if (options.reportMode === "object-preview") {
		report = {
			objectPreviewBenchmark: summarizeObjectPreviewBenchmark(
				result.objectPreviewBenchmark,
			),
			objectPreview: result.objectPreview,
			glRenderer: result.glRenderer,
			consoleMessages: result.consoleMessages.filter(
				({ level }) => level === "error" || level === "exception",
			),
		};
	} else if (options.reportMode === "brief") {
		report = briefHarnessReport(result);
	} else {
		report = {
			glRenderer: result.glRenderer,
			clientHud: result.clientHud,
			clientTargeting: result.clientTargeting,
			clientPreciseJump: result.clientPreciseJump,
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
			nameplates: result.state.nameplates,
			nameplateWorkload: result.nameplateWorkload,
			nameplateLifecycle: result.nameplateLifecycle,
			appearanceReplacement: result.appearanceReplacement,

			measuredFrameThroughput: result.measuredFrameThroughput,
			portalTraversalSurvey: result.portalTraversalSurvey,
			portalTraversalInvestigation: result.portalTraversalInvestigation,
			materialTableProbe: result.materialTableProbe,
			nameplateBenchmark: result.nameplateBenchmark,
			objectPreviewBenchmark: result.objectPreviewBenchmark,
			ambientOcclusionCoverageCensus:
				result.state.ambientOcclusionCoverageCensus,
			textureFiltering: options.textureFiltering,
			filteringCycleStates: result.filteringCycleStates,
			entityShadowCycleStates: result.entityShadowCycleStates,
			entityShadowBenchmark: result.entityShadowBenchmark,
			modeCycleStates: result.modeCycleStates,
			portalExecution: result.portalExecution,
			portalTransitionCompositorDiagnostic:
				options.portalTransitionCompositorDiagnostic,
			portalTransitionLifecycleFixture: result.portalTransitionLifecycle,
			portalContextLossPolicy: result.state.portalContextLossPolicy,
			portalScopeAtlasTargets: result.state.portalScopeAtlasTargets,
			outdoorPssm: result.state.outdoorPssm,
			consoleMessages: result.consoleMessages,
			generatedDisabledState: result.generatedDisabledState,
			fixture: options.fixture,
			frames: result.state.frames,
			initialState: result.initialState,
			landblockId: options.landblockId,
			lifecycleState: result.lifecycleState,
			entityLifecycle: result.entityLifecycle,
			spawnedSelection: result.spawnedSelection,
			objectPreview: result.objectPreview,
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
		};
	}
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
	if (options.nameplateWorkload !== null) {
		const assertionState = options.nameplateLifecycle
			? result.initialState
			: result.state;
		assertNameplateWorkload(
			assertionState.nameplates,
			options.nameplateWorkload,
			options.envCellCameraId !== null,
			assertionState.frameSettings.nameplates.maximumVisible,
			assertionState.frameSettings.envCellRenderMode,
		);
	}
	if (options.nameplateLifecycle)
		assertNameplateLifecycle(result.nameplateLifecycle);
	if (options.traceTerrainGl) {
		assertTerrainGlTrace(result.state);
	}
	if (options.modeCycle) {
		assertModeCycle(result.modeCycleInitialState, result.modeCycleStates);
	}
	if (options.filteringCycle) {
		assertFilteringCycle(result.initialState, result.filteringCycleStates);
	}
	if (options.entityShadowCycle) {
		assertEntityShadowCycle(
			result.entityShadowCycleInitialState,
			result.entityShadowCycleStates,
		);
	}
	if (options.worldMarker !== null)
		report.worldIndicatorProof = result.state.worldIndicatorProof;
	if (options.worldMarker === "settled") {
		const proof = result.state.worldIndicatorProof;
		if (
			proof?.desiredKind !== "curve" ||
			proof?.actualKind !== "polyline" ||
			proof?.markerShapes?.join(",") !== "target,miss"
		)
			throw new Error(
				"Manual jump renderer fixture did not install both paths and endpoint glyphs.",
			);
	}
	if (options.fixture === "portal-scope-atlas") {
		assertPortalScopeAtlasFixture(result.state);
	}
	if (options.fixture === "outdoor-pssm") {
		assertOutdoorPssmFixture(result.state.outdoorPssm);
	}
	if (options.fixture === "combat-effects") {
		const runtimeProof = result.state.combatEffectsRuntime;
		if (
			!runtimeProof ||
			!runtimeProof.retainedPlacement ||
			!runtimeProof.missingTargetUnplaced ||
			!runtimeProof.criticalProfile ||
			!runtimeProof.resistProfile ||
			!runtimeProof.resetCleared ||
			!runtimeProof.hiddenExpired ||
			runtimeProof.leaseCount !== 1
		) {
			throw new Error(
				`Combat runtime fixture failed: ${JSON.stringify(runtimeProof)}`,
			);
		}
		const proof = result.state.combatEffects;
		if (
			!proof ||
			proof.worldPixels <= 0 ||
			!proof.colorUpdateReusedAtlas ||
			!proof.typographyUpdateReusedResources ||
			!proof.liveAppearancePreserved ||
			proof.worldDraws !== 1 ||
			proof.laneDraws !== 1 ||
			proof.criticalGlyphCount !== 3 ||
			!proof.lazyAllocation ||
			!proof.sharedAtlas ||
			proof.rebasedPixels !== proof.worldPixels ||
			proof.criticalPixels <= proof.worldPixels ||
			proof.resistWorldPixels <= 0 ||
			proof.resistLanePixels <= 0 ||
			proof.resistGlyphCount !== 1 ||
			!proof.resistSharedAtlas ||
			proof.portalVisiblePixels !== proof.worldPixels ||
			proof.lanePixels <= 0 ||
			proof.criticalLanePixels <= 0 ||
			!proof.repeatedLifecycleReleased ||
			!proof.programFailureCleaned ||
			proof.hiddenScopePixels !== 0 ||
			proof.portalOccludedPixels !== 0 ||
			proof.expiredPixels !== 0 ||
			proof.resetPixels !== 0 ||
			!proof.resourcesReleased ||
			!proof.allocationFailureCleaned
		) {
			throw new Error(
				`Combat effects fixture failed: ${JSON.stringify(proof)}`,
			);
		}
	}
	if (options.fixture === "entity-selection") {
		assertEntitySelectionFixture(result.state.entitySelection);
	}
	// The focused preview probe owns its catalog realization/rendering assertions. The generic
	// lifecycle assertion samples an earlier post-spawn state and can reject a slower catalog
	// realization even when the preview subsequently installs and renders the requested visual.
	if (
		options.spawnWcid !== null &&
		options.entityShowcaseCount === 0 &&
		!options.objectPreviewProbe
	) {
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
	if (options.spawnedSelectionProbe) {
		assertSpawnedSelectionProbe(
			result.spawnedSelection,
			options.spawnSimulated,
		);
	}
	// Publish success evidence only after every requested assertion has passed.
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
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
		worldMap: false,
		clientWorldMap: false,
		clientHousing: false,
		clientHud: false,
		clientLoadouts: false,
		clientPreciseJump: false,
		clientSettingsTabs: false,
		clientEnvironment: false,
		clientVitals: false,
		clientPartyScreenshotDirectory: null,
		clientKeyboard: false,
		clientConnection: false,
		clientAudio: false,
		characterSheet: false,
		clientParty: false,
		clientFriends: false,
		clientContracts: false,
		clientSelectedActions: false,
		clientBindings: false,
		clientBindingControls: false,
		clientSquelch: false,
		clientAllegiance: false,
		clientInspection: false,
		clientBook: false,
		clientTrade: false,
		uiTheme: false,
		reportMode: null,
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
		spawnedSelectionProbe: false,
		objectPreviewProbe: false,
		objectPreviewBenchmarkPairs: 0,
		spawnWcid: null,
		deathMotionFixture: null,
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
		portalTransitionCompositorDiagnostic: false,
		portalTransitionLifecycleFixture: false,
		portalTransitionComposition: "tunnel-only",
		portalTransitionProgress: 0,
		frameMode: null,
		timeOfDay: null,
		dayGroup: null,
		modeCycle: false,
		filteringCycle: false,
		gpu: false,
		ambientOcclusion: null,
		ambientOcclusionCycle: false,
		ambientOcclusionCoverage: false,
		entityShadows: null,
		entityShadowSelectedRoots: null,
		entityShadowMappedRoots: null,
		entityShadowCycle: false,
		entityShadowBenchmarkPairs: 0,
		traceTerrainGl: false,
		worldMarker: null,
		vitePort: null,
		colorGrade: null,
		staticLights: true,
		showRetailHiddenGeometry: true,
		weather: true,
		profileRenderer: false,
		mergeCensus: false,
		terrainRadius: null,
		textureFiltering: null,
		lifecycle: false,
		fixture: null,
		nameplateWorkload: null,
		nameplateLifecycle: false,
		appearanceReplacement: false,
		dynamicViews: false,
		dynamicBlendFlags: false,
		dynamicDomains: false,
		nameplateBenchmarkPairs: 0,
		nameplatesDisabled: false,
		screenshotPath: null,
		map: false,
		mapSize: 512,
		mapViewDiameter: null,
		mapCenter: null,
		mapCenterHeight: null,
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
			case "--client-party-screenshots":
				parsed.clientHud = true;
				parsed.clientPartyScreenshotDirectory = resolve(
					requireValue(args, ++index, arg),
				);
				break;
			case "--client-vitals":
				parsed.clientHud = true;
				parsed.clientVitals = true;
				break;
			case "--client-environment":
				parsed.clientHud = true;
				parsed.clientEnvironment = true;
				break;
			case "--client-audio":
				parsed.clientHud = true;
				parsed.clientAudio = true;
				break;
			case "--client-connection":
				parsed.clientHud = true;
				parsed.clientConnection = true;
				break;
			case "--world-map":
				parsed.worldMap = true;
				break;
			case "--client-world-map":
				parsed.clientHud = true;
				parsed.clientWorldMap = true;
				break;
			case "--client-housing":
				parsed.clientHud = true;
				parsed.clientHousing = true;
				break;
			case "--client-settings-tabs":
				parsed.clientHud = true;
				parsed.clientSettingsTabs = true;
				break;
			case "--client-keyboard":
				parsed.clientHud = true;
				parsed.clientKeyboard = true;
				break;
			case "--client-precise-jump":
				parsed.clientHud = true;
				parsed.clientPreciseJump = true;
				break;
			case "--client-hud":
				parsed.clientHud = true;
				break;
			case "--client-loadouts":
				parsed.clientHud = true;
				parsed.clientLoadouts = true;
				break;
			case "--character-sheet":
				parsed.characterSheet = true;
				break;
			case "--client-trade":
				parsed.clientHud = true;
				parsed.clientTrade = true;
				break;
			case "--client-inspection":
				parsed.clientHud = true;
				parsed.clientInspection = true;
				break;
			case "--client-allegiance":
				parsed.clientHud = true;
				parsed.clientAllegiance = true;
				break;
			case "--client-squelch":
				parsed.clientHud = true;
				parsed.clientSquelch = true;
				break;
			case "--client-binding-controls":
				parsed.clientHud = true;
				parsed.clientBindingControls = true;
				break;
			case "--client-bindings":
				parsed.clientHud = true;
				parsed.clientBindings = true;
				break;
			case "--client-selected-actions":
				parsed.clientHud = true;
				parsed.clientSelectedActions = true;
				break;
			case "--client-contracts":
				parsed.clientHud = true;
				parsed.clientContracts = true;
				break;
			case "--client-friends":
				parsed.clientHud = true;
				parsed.clientFriends = true;
				break;
			case "--client-party":
				parsed.clientHud = true;
				parsed.clientParty = true;
				break;
			case "--client-book":
				parsed.clientHud = true;
				parsed.clientBook = true;
				break;
			case "--ui-theme":
				parsed.uiTheme = true;
				break;
			case "--full-report":
				parsed.reportMode = "full";
				break;
			case "--brief":
				parsed.reportMode = "brief";
				break;
			case "--particle-sao-report-only":
				parsed.reportMode = "particle-sao";
				break;
			case "--nameplate-report-only":
				parsed.reportMode = "nameplate";
				break;
			case "--object-preview-report-only":
				parsed.reportMode = "object-preview";
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
			case "--death-motion-fixture":
				parsed.deathMotionFixture = requireValue(args, ++index, arg);
				break;
			case "--spawned-selection-probe":
				parsed.spawnedSelectionProbe = true;
				break;
			case "--object-preview-probe":
				parsed.objectPreviewProbe = true;
				break;
			case "--object-preview-benchmark-pairs":
				parsed.objectPreviewBenchmarkPairs = parsePositiveInteger(
					requireValue(args, ++index, arg),
					arg,
				);
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
			case "--portal-transition-compositor-diagnostic":
				parsed.portalTransitionCompositorDiagnostic = true;
				break;
			case "--portal-transition-lifecycle-fixture":
				parsed.portalTransitionLifecycleFixture = true;
				break;
			case "--portal-transition-composition": {
				const value = requireValue(args, ++index, arg);
				if (
					![
						"origin-to-tunnel",
						"tunnel-only",
						"tunnel-to-destination",
					].includes(value)
				) {
					throw new Error(
						"--portal-transition-composition must be origin-to-tunnel, tunnel-only, or tunnel-to-destination.",
					);
				}
				parsed.portalTransitionComposition = value;
				break;
			}
			case "--portal-transition-progress": {
				const value = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(value) || value < 0 || value > 1) {
					throw new Error(
						"--portal-transition-progress must be within [0, 1].",
					);
				}
				parsed.portalTransitionProgress = value;
				break;
			}
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
			case "--world-marker":
				parsed.worldMarker = "settled";
				break;
			case "--world-marker-pending":
				parsed.worldMarker = "pending";
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
			case "--entity-shadows": {
				const source = requireValue(args, ++index, arg);
				try {
					parsed.entityShadows = JSON.parse(source);
				} catch (cause) {
					throw new Error(
						"--entity-shadows must be a complete JSON entity-shadow policy.",
						{ cause },
					);
				}
				break;
			}
			case "--entity-shadow-cycle":
				parsed.entityShadowCycle = true;
				break;
			case "--entity-shadow-selected-roots":
				parsed.entityShadowSelectedRoots = parsePositiveInteger(
					requireValue(args, ++index, arg),
					arg,
				);
				break;
			case "--entity-shadow-mapped-roots": {
				const value = Number(requireValue(args, ++index, arg));
				if (!Number.isInteger(value) || value < 0) {
					throw new Error(`${arg} must be a non-negative integer.`);
				}
				parsed.entityShadowMappedRoots = value;
				break;
			}
			case "--entity-shadow-benchmark-pairs":
				parsed.entityShadowBenchmarkPairs = Number(
					requireValue(args, ++index, arg),
				);
				if (
					!Number.isInteger(parsed.entityShadowBenchmarkPairs) ||
					parsed.entityShadowBenchmarkPairs <= 0
				) {
					throw new Error(
						"--entity-shadow-benchmark-pairs must be a positive integer.",
					);
				}
				break;
			case "--vite-port":
				parsed.vitePort = parseVitePort(requireValue(args, ++index, arg), arg);
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
			case "--hide-retail-hidden-geometry":
				parsed.showRetailHiddenGeometry = false;
				break;
			case "--no-weather":
				parsed.weather = false;
				break;
			case "--profile-renderer":
				parsed.profileRenderer = true;
				break;
			case "--merge-census":
				parsed.mergeCensus = true;
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
						"entity-selection",
						"combat-effects",
						"instanced",
						"outdoor-pssm",
						"portal-scope-atlas",
					].includes(parsed.fixture)
				) {
					throw new Error(
						"--fixture must be blended, combat-effects, entity-selection, instanced, outdoor-pssm, or portal-scope-atlas.",
					);
				}
				break;
			case "--nameplate-workload":
				parsed.nameplateWorkload = requireValue(args, ++index, arg);
				if (
					![
						"repeated-100",
						"svg-icon",
						"svg-icon-level",
						"svg-icons",
						"unique-100",
						"ordered-500",
						"shadow-crowd-112x61",
						"occlusion-open",
						"occlusion-wall",
						"portal-open",
						"portal-wall",
						"portal-plural",
					].includes(parsed.nameplateWorkload)
				) {
					throw new Error(
						"--nameplate-workload must name a supported synthetic nameplate fixture.",
					);
				}
				break;
			case "--nameplate-lifecycle":
				parsed.nameplateLifecycle = true;
				break;
			case "--probe-dynamic-appearance":
				parsed.appearanceReplacement = true;
				break;
			case "--probe-dynamic-views":
				parsed.dynamicViews = true;
				break;
			case "--probe-dynamic-blend-flags":
				parsed.dynamicBlendFlags = true;
				break;
			case "--probe-dynamic-domains":
				parsed.dynamicDomains = true;
				break;
			case "--disable-nameplates":
				parsed.nameplatesDisabled = true;
				break;
			case "--nameplate-benchmark-pairs":
				parsed.nameplateBenchmarkPairs = Number(
					requireValue(args, ++index, arg),
				);
				if (
					!Number.isInteger(parsed.nameplateBenchmarkPairs) ||
					parsed.nameplateBenchmarkPairs <= 0
				) {
					throw new Error(
						"--nameplate-benchmark-pairs must be a positive integer.",
					);
				}
				break;
			case "--screenshot":
				parsed.screenshotPath = requireValue(args, ++index, arg);
				break;
			case "--map":
				parsed.map = true;
				break;
			case "--map-size":
				parsed.map = true;
				parsed.mapSize = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(parsed.mapSize) || parsed.mapSize <= 0) {
					throw new Error("--map-size must be a positive number of pixels.");
				}
				break;
			case "--map-view-diameter":
				parsed.map = true;
				parsed.mapViewDiameter = Number(requireValue(args, ++index, arg));
				if (
					!Number.isFinite(parsed.mapViewDiameter) ||
					parsed.mapViewDiameter <= 0
				) {
					throw new Error("--map-view-diameter must be a positive metre span.");
				}
				break;
			case "--map-center-height":
				parsed.map = true;
				parsed.mapCenterHeight = Number(requireValue(args, ++index, arg));
				if (!Number.isFinite(parsed.mapCenterHeight)) {
					throw new Error("--map-center-height must be a finite height.");
				}
				break;
			case "--map-center": {
				parsed.map = true;
				const parts = requireValue(args, ++index, arg)
					.split(",")
					.map((entry) => Number(entry.trim()));
				if (
					parts.length !== 2 ||
					parts.some((value) => !Number.isFinite(value))
				) {
					throw new Error("--map-center must be <worldX>,<worldZ>.");
				}
				parsed.mapCenter = { worldX: parts[0], worldZ: parts[1] };
				break;
			}
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
			"--follow-flight and relocation options cannot be combined; the flight replaces outdoor interest by itself.",
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
		[
			parsed.worldMap,
			parsed.uiTheme,
			parsed.clientHud,
			parsed.characterSheet,
		].filter(Boolean).length > 1
	)
		throw new Error(
			"Choose one of --world-map, --ui-theme, --client-hud, or --character-sheet.",
		);
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
	if (
		parsed.deathMotionFixture !== null &&
		(Number(parsed.spawnWcid) !== 192 ||
			parsed.entityShowcaseCount !== 0 ||
			parsed.screenshotPath === null)
	) {
		throw new Error(
			"--death-motion-fixture requires --spawn-wcid 192, --screenshot, and no entity showcase.",
		);
	}
	if (parsed.possessionScenario && parsed.spawnWcid === null) {
		throw new Error("--possession-scenario requires --spawn-wcid.");
	}
	if (parsed.excludeSpawnedAttachments && parsed.spawnWcid === null) {
		throw new Error("--exclude-spawned-attachments requires --spawn-wcid.");
	}
	if (parsed.spawnedSelectionProbe && parsed.spawnWcid === null) {
		throw new Error("--spawned-selection-probe requires --spawn-wcid.");
	}
	if (parsed.objectPreviewProbe && parsed.spawnWcid === null) {
		throw new Error("--object-preview-probe requires --spawn-wcid.");
	}
	if (parsed.objectPreviewBenchmarkPairs > 0) {
		if (parsed.spawnWcid === null) {
			throw new Error(
				"--object-preview-benchmark-pairs requires --spawn-wcid.",
			);
		}
		if (!parsed.gpu) {
			throw new Error("--object-preview-benchmark-pairs requires --gpu.");
		}
		if (!parsed.profileRenderer) {
			throw new Error(
				"--object-preview-benchmark-pairs requires --profile-renderer.",
			);
		}
		if (parsed.measureMs <= 0) {
			throw new Error(
				"--object-preview-benchmark-pairs requires a positive --measure-ms.",
			);
		}
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
	if (parsed.entityShadowBenchmarkPairs > 0) {
		if (!parsed.gpu) {
			throw new Error("--entity-shadow-benchmark-pairs requires --gpu.");
		}
		if (parsed.measureMs <= 0) {
			throw new Error(
				"--entity-shadow-benchmark-pairs requires a positive --measure-ms.",
			);
		}
	}
	if (parsed.nameplateBenchmarkPairs > 0) {
		if (!parsed.gpu) {
			throw new Error("--nameplate-benchmark-pairs requires --gpu.");
		}
		if (parsed.nameplateWorkload === null) {
			throw new Error(
				"--nameplate-benchmark-pairs requires --nameplate-workload.",
			);
		}
		if (parsed.measureMs <= 0) {
			throw new Error(
				"--nameplate-benchmark-pairs requires a positive --measure-ms.",
			);
		}
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
  --brief               Print summary evidence (the default for --client-hud).
  --client-contracts    Exercise Journal and outdoor contract map markers, tooltips, timers, and removal.
  --client-book         Exercise the book reader through the client HUD fixture.
  --full-report         Print complete diagnostic evidence, including HUD snapshots.
  --particle-sao-report-only
                        Print only workload identity, particle/SAO metrics, timings, and errors.
  --nameplate-report-only
                        Print only renderer identity, errors, profiling, and nameplate evidence.
  --object-preview-report-only
                        Print only renderer identity, errors, and object-preview evidence.
  --world-marker        Draw the depth-tested world marker and trajectory fixture.
  --world-marker-pending Draw the rotating pending world marker without a trajectory.
  --map                 Draw the overhead map onto a harness canvas before the screenshot.
  --map-size <px>       Square pixel size of the map canvas (default 512).
  --map-view-diameter <m> World metres across the map's visible circle.
  --map-center <x,z>    World centre for the map; defaults to the camera position.
  --map-center-height <y>
                        Anchor height the interior ramp measures floors against. Overriding it is
                        how the above-the-anchor end of the ramp gets exercised without hunting for
                        a dungeon that happens to rise.

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
  --death-motion-fixture <path>
                        Replay death_motion_fixture MessagePack on --spawn-wcid 192; requires
                        --screenshot and writes one adjacent screenshot per lifecycle sample.
  --spawned-selection-probe
                        Select every entity produced by --spawn-wcid through the production runtime.
                        With --spawn-simulated, first activate a short authored locomotion clip.
  --object-preview-probe
                        Open, close, and reopen --spawn-wcid through the production preview path;
                        fail on GL errors or a uniform background-only frame.
  --object-preview-benchmark-pairs <n>
                        Measure alternating closed/open preview windows in one settled hardware
                        session. Requires --spawn-wcid, --gpu, --profile-renderer, and --measure-ms.
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
  --portal-transition-compositor-diagnostic
                         Load the authored transition closure and freeze one compositor input for
                         a screenshot. This does not exercise the production lifecycle.
  --portal-transition-lifecycle-fixture
                         Drive real controller plans through the runtime and renderer, asserting
                         supersession, resize, handoff, inactive, and black cleanup resources.
  --portal-transition-composition <origin-to-tunnel|tunnel-only|tunnel-to-destination>
                         Select the fixed compositor input used by the diagnostic.
  --portal-transition-progress <0..1>
                         Freeze timed entry or exit at one normalized progress sample.
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
  --entity-shadows <json>
                         Replace the complete entity-shadow policy. Copy frameSettings.entityShadows
                         from harness output, then edit values for a reproducible capture.
  --entity-shadow-cycle Exercise none, simple, shadow-maps, and target resize without reloading.
  --entity-shadow-selected-roots <n>
                         Override the per-view selected-root budget (N).
  --entity-shadow-mapped-roots <n>
                         Override the per-view mapped-root budget (M); requires selected roots.
  --entity-shadow-benchmark-pairs <n>
                         Measure alternating none/shadow-maps windows in one settled session.
                         Requires --gpu and positive --measure-ms; add --profile-renderer for
                         attributed CPU/GPU samples or omit it to measure profiler overhead.
  --mode-cycle           Exercise portal, flat, portal, flat frames without reloading content.
  --filtering-cycle      Change filtering during loading, then cycle supported modes without reload.
  --gpu                  Render on the real GPU adapter instead of SwiftShader. Required for
                         any timing used as performance evidence.
  --trace-terrain-gl     Assert that the far-terrain program binds no texture state and uploads
                         exactly one terrain palette per activation.
  --vite-port <port>     Vite port to start or reuse. Default: a random free port. Change it when
                         another worktree is running a harness, or its server will silently serve
                         that worktree's build.
  --color-grade <json>  Override the presentation color grade with these JSON parameters, e.g.
                         '{"temperature":0.6,"tint":0,"saturation":1.4,"curves":{...}}'. Omit it
                         to use whatever Explorer tuning currently ships.
  --no-static-lights     Disable authored outdoor lamps, for same-scene A/B of their cost.
  --hide-retail-hidden-geometry
                         Hide GfxObjs suppressed by retail degradation without reloading content.
  --no-weather           Disable authored weather, mirroring retail's player option. Use it to
                         A/B a Rainy day group against the same scene without rain.
  --profile-renderer     Enable opt-in renderer CPU/GPU profiling before capture.
  --merge-census         Report how far the frame's baked object draws could merge.
  --texture-filtering <mode>
                         Select nearest, linear, or anisotropic-2x/4x/8x before content settles.
  --fixture <name>      Use the blended, instanced, outdoor-pssm, or portal-scope-atlas fixture.
  --nameplate-workload <name>
                        Install repeated-100, svg-icon/svg-icon-level/svg-icons, unique-100,
                        ordered-500, shadow-crowd-112x61,
                        occlusion-open/wall, or portal-open/wall/plural synthetic dynamic
                         entities through the shared runtime without requiring a catalog record.
  --probe-dynamic-appearance
                         Replace the occlusion-open entity appearance without moving it; save
                         before/after images and verify bounds. Requires --screenshot.
  --probe-dynamic-views Compare frozen single and simultaneous renderer views. Requires --screenshot.
  --probe-dynamic-blend-flags
                         Check cutout/blend pixels, or mixed ordering with --fixture blended.
                         Requires --nameplate-workload occlusion-open and --screenshot.
  --probe-dynamic-domains
                         Compare portal-plural material draws with single-domain controls.
                         Requires --frame-mode portal and --screenshot.
  --nameplate-lifecycle Move one unchanged same-generation target, then retire the workload and
                         assert stable rasterization plus complete texture release. Requires
                         --nameplate-workload.
  --nameplate-benchmark-pairs <n>
                         Measure n paired enabled/disabled windows in one hardware-GPU session.
                         Requires --nameplate-workload, --gpu, and positive --measure-ms.
  --disable-nameplates   Set the nameplate budget to zero before installing the workload.
  --settle-ms <ms>      Wait after requesting scene content. Default: ${DEFAULT_SETTLE_MS}
  --measure-ms <ms>     Reset timings after settling, then measure steady-state frames.
  --ui-theme           Review CSS themes over the live world, bright/dark backdrops, override
                       removal, filter fallback, and a replacement fixture; verify contrast and input.
                       With --screenshot, also writes <path>.<variant>.png.
  --client-party-screenshots <dir> Capture the real party HUD at one through four columns.
  --screenshot <path>   Persist the captured PNG after the harness exits.
  --character-sheet     Exercise the Character panel with synthetic quotes in the client HUD.
  --client-keyboard     Verify pointer controls, editor ownership, native navigation, and game routing.
  --client-trade        Exercise selected-player initiation and trade HUD controls with pointer drops.
  --client-connection   Verify connection health, traffic activity, recovery, and keyboard details.
  --client-world-map    Exercise the World dock shortcut and retained World-panel switching.
  --client-housing      Exercise crystal ownership profiles, requirement drops, row auto-fill, and dismissal.
  --world-map           Exercise the retained World map with an isolated cache and real content.
  --client-audio        Exercise audio settings and real browser output gain with synthetic PCM.
  --client-vitals      Verify vital priority, pulse, reduced motion, recovery, and input passthrough.
  --client-environment Verify true minimap time/weather, local overrides, and footer placement.
  --client-settings-tabs Exercise Settings tab selection, focus, wrapping, and native traversal.
  --client-inspection   Exercise entity inspection windows, disclosed facts, and preview lifetimes.
  --client-binding-controls Verify indexed remapping, casts, and contextual vendor Examine.
  --client-bindings   Verify Settings remapping, shortcut hints, and feature dispatch.
  --client-selected-actions Exercise selected HUD action eligibility, dispatch, and menu dismissal.
  --client-precise-jump Verify phased aim feedback, cadence, stale progress, and first-success activation.
  --client-hud          Exercise runtime/layout HUD visibility, centered drag anchoring, and
                         constrained viewport restoration using the deterministic client fixture.
  --client-loadouts     Exercise loadout capture, exclusions, shortcut placement, and warning feedback.
  --relocate-sequence <hex,hex,...>
                         Re-issue scene interest at each landblock in turn, so sustained streaming
                         churn can be measured without the interactive client. Reports per-hop
                         state under relocationSequence.
  --relocate-hop-ms <ms> Settle time between sequence hops. Default: ${DEFAULT_RELOCATE_HOP_MS}
  --follow-flight <hex>  Fly the outdoor camera in a straight line to this landblock's centre,
                         replacing outdoor scene interest on every crossing — the harness mirror
                         of Explorer's outdoor follow mode. Reports crossings and timing.
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
		visibleDynamicSourceRangeCount:
			state.metrics?.visibleDynamicSourceRangeCount ?? null,
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
		"materialBearingCoplanarSurfaceOccludesMask",
		"materialBearingOpeningRetainsBoundaryPixels",
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

function assertOutdoorPssmFixture(fixture) {
	if (!fixture) {
		throw new Error("Outdoor PSSM fixture did not publish evidence.");
	}
	for (const field of [
		"casterProgramLinked",
		"groundingProgramsLinked",
		"receiverProgramsLinked",
		"initialLayersComplete",
		"initialResourcesValid",
		"resizedLayersComplete",
		"resizedResourcesValid",
		"resizedTargetReplaced",
		"sameConfigurationReused",
	]) {
		if (fixture[field] !== true) {
			throw new Error(
				`Outdoor PSSM fixture failed ${field}: ${JSON.stringify(fixture)}.`,
			);
		}
	}
	assertOutdoorPssmDiagnostics(fixture.initialDiagnostics, {
		activeBytes: 262_144,
		activeFramebufferCount: 1,
		activeTextureCount: 1,
		allocatedGenerationCount: 1,
		cascadeCount: 1,
		disposedGenerationCount: 0,
		resolution: 256,
	});
	assertOutdoorPssmDiagnostics(fixture.resizedDiagnostics, {
		activeBytes: 2_097_152,
		activeFramebufferCount: 1,
		activeTextureCount: 1,
		allocatedGenerationCount: 2,
		cascadeCount: 2,
		disposedGenerationCount: 1,
		resolution: 512,
	});
	assertOutdoorPssmDiagnostics(fixture.disposedDiagnostics, {
		activeBytes: 0,
		activeFramebufferCount: 0,
		activeTextureCount: 0,
		allocatedGenerationCount: 2,
		cascadeCount: null,
		disposedGenerationCount: 2,
		resolution: null,
	});
}

function assertEntitySelectionFixture(fixture) {
	if (!fixture) {
		throw new Error("Entity selection fixture did not publish evidence.");
	}
	for (const field of [
		"currentTransformFollowed",
		"interiorPreserved",
		"sphereProxyWorkExact",
		"resizedTargetReplaced",
		"sameSizeTargetReused",
		"targetInvalidAfterDestroy",
	]) {
		if (fixture[field] !== true) {
			throw new Error(
				`Entity selection fixture failed ${field}: ${JSON.stringify(fixture)}.`,
			);
		}
	}
	if (
		fixture.depthIndependentMaskPixel !== 255 ||
		fixture.sphereProxyMaskPixel !== 255 ||
		fixture.initialActiveMaskBytes !== 64 * 64 ||
		fixture.resizedActiveMaskBytes !== 32 * 32 ||
		fixture.outlinePixelCount <= 0 ||
		fixture.portalWarpOutlinePixelCount <= 0 ||
		fixture.targetGenerationsAllocated !== 2 ||
		fixture.targetGenerationsDisposedAfterDestroy !== 2
	) {
		throw new Error(
			`Entity selection fixture reported invalid GPU evidence: ${JSON.stringify(fixture)}.`,
		);
	}
}

function assertOutdoorPssmDiagnostics(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`Outdoor PSSM target diagnostics mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
		);
	}
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
		combatEffects: result.state.combatEffects,
		combatEffectsRuntime: result.state.combatEffectsRuntime,
		objectPreviewBenchmark: result.objectPreviewBenchmark,
		measuredFrameThroughput: result.measuredFrameThroughput,
		portalTraversalSurvey: result.portalTraversalSurvey,
		portalTraversalInvestigation: result.portalTraversalInvestigation,
		materialTableProbe: result.materialTableProbe,
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
		bakedDrawMergeCensus: result.bakedDrawMergeCensus,
		glRenderer: result.glRenderer,
		map: result.map,
		consoleMessages: result.consoleMessages.filter(
			({ level }) => level === "error" || level === "exception",
		),
		entityLifecycle: summarizeEntityLifecycle(result.entityLifecycle),
		spawnedSelection: result.spawnedSelection,
		objectPreview: result.objectPreview,
		possessionScenario: summarizePossessionScenario(result.possessionScenario),
		entityPair: result.entityPair,
		entityPopulation: result.entityPopulation,
		envCellLayers: summarizeEnvCellLayers(staticObjects?.envCellLayers ?? []),
		finalMetrics: result.state.metrics,
		portalTransition: result.state.portalTransition,
		portalTransitionCompositorDiagnostic:
			options.portalTransitionCompositorDiagnostic,
		portalTransitionLifecycleFixture: result.portalTransitionLifecycle,
		portalTransitionPresentationFixture:
			result.state.portalTransitionPresentationFixture,
		terrainGlTrace: result.state.terrainGlTrace,
		ambientOcclusionCoverageCensus: result.state.ambientOcclusionCoverageCensus,
		frameProfile: result.state.frameProfile,
		nameplates: result.state.nameplates,
		nameplateWorkload: result.nameplateWorkload,
		nameplateLifecycle: result.nameplateLifecycle,
		tickProfile: result.state.tickProfile,
		frameSettings: result.state.frameSettings,
		entityShadowResources: result.state.entityShadowResources,
		portalScopeAtlasExecutorFixture: result.state.portalScopeAtlasExecutor,
		portalExecution: result.portalExecution,
		initialMetrics: result.initialState.metrics,
		initialTerrainWorker: result.initialState.terrainWorker,
		initialCamera: result.initialState.camera,
		modeCycleMetrics: result.modeCycleStates.map((state) => state.metrics),
		ambientOcclusionCycleMetrics: result.ambientOcclusionCycleStates.map(
			(state) => state.metrics,
		),
		entityShadowCycle: result.entityShadowCycleStates.map((state) => ({
			mode: state.frameSettings.entityShadows.mode,
			resources: state.entityShadowResources,
		})),
		entityShadowBenchmark: result.entityShadowBenchmark,
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
		profiles: result.state.profiles,
		sceneInterest: result.state.sceneInterest,
		// Compiled-draw occupancy is leak evidence across relocations, and its flush counts
		// explain any recompilation, so brief mode keeps both.
		compiledObjectDraws: result.state.compiledObjectDraws,
		dynamicViews: result.dynamicViews,
		dynamicBlendFlags: result.dynamicBlendFlags,
		dynamicDomains: result.dynamicDomains,
		dynamicResources: result.state.dynamicResources,
		staticResourceCounts:
			staticObjects === null
				? null
				: {
						geometryResourceCount: staticObjects.geometryResourceCount,
						geometryResourceBytes: staticObjects.geometryResourceBytes,
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

function summarizeObjectPreviewBenchmark(benchmark) {
	if (benchmark === null) return null;
	const summarize = (samples) => ({
		frameWork: summarizeNumbers(
			samples.map((sample) => sample.timing.averageFrameWorkMs),
		),
		rendererCpu: summarizeNumbers(
			samples.map((sample) => sample.rendererCpu.meanTotalMs),
		),
		gpu: samples.every((sample) => sample.gpu.kind === "available")
			? summarizeNumbers(samples.map((sample) => sample.gpu.meanTotalMs))
			: { kind: "unavailable" },
		worstFrameWork: summarizeNumbers(
			samples.map((sample) => sample.timing.longestFrameWorkMs),
		),
		previewFramesPerSecond: summarizeNumbers(
			samples
				.map((sample) => sample.previewFramesPerSecond)
				.filter((value) => value !== null),
		),
		previewParticleCount: summarizeNumbers(
			samples
				.map(
					(sample) =>
						sample.previewDiagnostics?.particle.drawnParticleCount ?? null,
				)
				.filter((value) => value !== null),
		),
	});
	return {
		measureMs: benchmark.measureMs,
		pairCount: benchmark.pairCount,
		warmupMs: benchmark.warmupMs,
		closed: summarize(benchmark.samples.filter((sample) => !sample.visible)),
		open: summarize(benchmark.samples.filter((sample) => sample.visible)),
	};
}

function summarizeNumbers(values) {
	if (values.length === 0) return null;
	return {
		maximum: Math.max(...values),
		mean: values.reduce((total, value) => total + value, 0) / values.length,
		minimum: Math.min(...values),
	};
}

function nameplateHarnessReport(result) {
	return {
		glRenderer: result.glRenderer,
		consoleMessages: result.consoleMessages.filter(
			({ level }) => level === "error" || level === "exception",
		),
		frameProfile: result.state.frameProfile,
		nameplates: result.state.nameplates,
		nameplateWorkload: result.nameplateWorkload,
		nameplateLifecycle: result.nameplateLifecycle,
		nameplateBenchmark: result.nameplateBenchmark,
	};
}

/** Compact evidence surface for the particle/SAO optimization plan's repeated hardware runs. */
function particleSaoHarnessReport(result) {
	const metrics = result.state.metrics;
	return {
		ambientOcclusionCoverageCensus: result.state.ambientOcclusionCoverageCensus,
		camera: result.state.camera,
		configuration: {
			buildingRadius: options.buildingRadius,
			captureFrame: options.captureFrame ?? null,
			envCellRadius: options.envCellRadius,
			explicitObjectRadius: options.explicitObjectRadius,
			frameIntervalMs: options.frameIntervalMs ?? null,
			frameMode: options.frameMode,
			generatedObjectRadius: options.generatedObjectRadius,
			landblockId: options.landblockId,
			measureMs: options.measureMs,
			particleSeed: options.particleSeed ?? null,
			renderScale: result.state.frameSettings.quality.renderScale,
			settleMs: options.settleMs,
			terrainRadius: options.terrainRadius,
		},
		consoleMessages: result.consoleMessages.filter(
			({ level }) => level === "error" || level === "exception",
		),
		frameProfile: result.state.frameProfile,
		glRenderer: result.glRenderer,
		metrics:
			metrics === null
				? null
				: {
						ambientOcclusion: metrics.ambientOcclusion,
						portalAtlasTilePixelCount: metrics.portalAtlasTilePixelCount,
						submittedParticleBatchCount: metrics.submittedParticleBatchCount,
						submittedParticleInstanceCount:
							metrics.submittedParticleInstanceCount,
						unresolvedParticleBatchCount: metrics.unresolvedParticleBatchCount,
						uploadedParticleRecordRowCount:
							metrics.uploadedParticleRecordRowCount,
						visibleDynamicEntityCount: metrics.visibleDynamicEntityCount,
						visibleDynamicSourceRangeCount:
							metrics.visibleDynamicSourceRangeCount,
					},
		particles: result.state.authoredDynamics?.particles ?? null,
		tickProfile: result.state.tickProfile,
		timing: result.state.timing,
		viewport: result.state.viewport,
	};
}

function assertNameplateWorkload(
	diagnostics,
	workload,
	hasEnvCellCamera,
	maximumVisible,
	frameMode,
) {
	if (diagnostics === null || diagnostics === undefined) {
		throw new Error(
			"Synthetic nameplate workload published no renderer diagnostics.",
		);
	}
	const eligibleCandidateCount =
		workload === "ordered-500"
			? 500
			: workload === "shadow-crowd-112x61"
				? 112
				: workload === "repeated-100" || workload === "unique-100"
					? 100
					: 1;
	const submittedCandidateCount = Math.min(
		eligibleCandidateCount,
		maximumVisible,
	);
	// Deferred nameplates carry a draw-constant domain uniform; plural portal scopes split draws.
	const scopeCount =
		workload === "portal-plural" && hasEnvCellCamera && frameMode === "portal"
			? 2
			: 1;
	const expected =
		submittedCandidateCount === 0
			? {
					budgetRejectedCandidateCount: 0,
					eligibleCandidateCount: 0,
					liveEntryCount: 0,
					submittedDrawCount: 0,
					submittedInstanceCount: 0,
				}
			: {
					budgetRejectedCandidateCount:
						eligibleCandidateCount - submittedCandidateCount,
					eligibleCandidateCount,
					liveEntryCount:
						workload === "unique-100" ? submittedCandidateCount : 1,
					submittedDrawCount:
						workload === "unique-100" ? submittedCandidateCount : scopeCount,
					submittedInstanceCount: submittedCandidateCount * scopeCount,
				};
	const actual = {
		budgetRejectedCandidateCount: diagnostics.budgetRejectedCandidateCount,
		eligibleCandidateCount: diagnostics.eligibleCandidateCount,
		liveEntryCount: diagnostics.cache.liveEntryCount,
		submittedDrawCount: diagnostics.submittedDrawCount,
		submittedInstanceCount: diagnostics.submittedInstanceCount,
	};
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`Synthetic ${workload} nameplate evidence mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
		);
	}
	if (
		workload.startsWith("svg-") &&
		(diagnostics.icons.readyCount !== 1 ||
			diagnostics.icons.loadingCount !== 0 ||
			diagnostics.icons.failedCount !== 0 ||
			diagnostics.icons.preparationCount !== 1 ||
			diagnostics.cache.rasterizationCount < 2 ||
			diagnostics.cache.releaseCount < 1)
	) {
		throw new Error(
			`Synthetic SVG nameplate did not settle and replace its placeholder raster: ${JSON.stringify(diagnostics)}.`,
		);
	}
}

function assertNameplateLifecycle(lifecycle) {
	if (lifecycle === null)
		throw new Error("Synthetic nameplate lifecycle published no evidence.");
	if (lifecycle.movedY === lifecycle.previousY) {
		throw new Error("Synthetic nameplate lifecycle did not move its target.");
	}
	if (
		lifecycle.moved.cache.rasterizationCount !==
		lifecycle.before.cache.rasterizationCount
	) {
		throw new Error(
			"Moving unchanged nameplate content caused a second rasterization.",
		);
	}
	if (
		lifecycle.cleared.cache.liveEntryCount !== 0 ||
		lifecycle.cleared.cache.byteCount !== 0
	) {
		throw new Error(
			`Cleared nameplate workload retained cache residency: ${JSON.stringify(lifecycle.cleared.cache)}.`,
		);
	}
	const expectedReleases =
		lifecycle.before.cache.releaseCount + lifecycle.before.cache.liveEntryCount;
	if (lifecycle.cleared.cache.releaseCount !== expectedReleases) {
		throw new Error(
			`Cleared nameplate workload expected ${expectedReleases} releases, received ${lifecycle.cleared.cache.releaseCount}.`,
		);
	}
}

function summarizePossessionScenario(scenario) {
	if (scenario === null) return null;
	const playableBoomTicks = scenario.boom.ticks;
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
	const renderedReach = playableBoomTicks
		.filter((tick) => tick.kind !== "fallback")
		.map((tick) => tick.renderedReach);
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
			holds: playableBoomTicks
				.filter((tick) => tick.kind === "held")
				.map((tick) => ({ reason: tick.reason, sequence: tick.sequence })),
			fallbacks: playableBoomTicks
				.filter((tick) => tick.kind === "fallback")
				.map((tick) => ({ reason: tick.reason, sequence: tick.sequence })),
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
					continuitySweeps: Math.max(
						maximum.continuitySweeps,
						tick.diagnostics.continuitySweeps,
					),
				}),
				{
					contactPasses: 0,
					controlLegs: 0,
					clearanceSweeps: 0,
					continuitySweeps: 0,
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
								repeatedStepTicks
									.filter((tick) => tick.kind !== "fallback")
									.map((tick) => tick.renderedReach),
							),
						},
			route: compactResidencyRoute(scenario.boom.route),
			stopAfterRelease: scenario.boom.stopAfterRelease,
		},
		jump: {
			begin: scenario.begin,
			chargedMotion: scenario.charged.probe,
			chargedAtMaximumMotion: scenario.chargedAtMaximum.probe,
			landed: scenario.landed,
			maximumZ: scenario.maximumZ,
			outcomes: scenario.outcomes,
			release: scenario.release,
			releaseRunRate: scenario.releaseRunRate,
			postReleaseMotion: scenario.postReleaseRateChange?.probe ?? null,
			sawAirborne: scenario.sawAirborne,
			sawFalling: scenario.sawFalling,
		},
		possession: scenario.possession,
		replacement: {
			initialRunRate: scenario.replacement.initialRunRate,
			maximumRunRate: scenario.replacement.maximumRunRate,
			possession: scenario.replacement.possession,
			probeAtMaximum: scenario.replacement.probeAtMaximum,
			probeBeforeIntent: scenario.replacement.probeBeforeIntent,
			initialTick: scenario.replacement.initialTick,
		},
		runRate: scenario.runRate,
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

/** Activate only enough host motion to exercise current-pose selection, then sample every spawn. */
async function runSpawnedSelectionProbe(client, spawned, activateAnimation) {
	const invoke = (method, args = []) =>
		evaluate(
			client,
			`globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.${method}`,
			args,
		);
	let motion = null;
	if (activateAnimation) {
		// The outdoor camera can spawn a body above support. Continue the host clock through
		// falling/landing before asking the renderer to prove an advancing ground cycle.
		let grounded = false;
		for (let tick = 0; tick < 480; tick += 1) {
			await invoke("tickExplorerEntities", [1000 / 30]);
			const entity = exactHarnessEntity(await invoke("state"), spawned);
			if (entity.placement.contact === "grounded") {
				grounded = true;
				break;
			}
		}
		if (!grounded)
			throw new Error("Selection fixture did not reach grounded support.");
		const possession = await invoke("possessExplorerEntity", [
			spawned.identity.guid,
		]);
		const result = await invoke("setPossessionIntent", [
			{
				drive: {
					gait: "run",
					lateral: null,
					longitudinal: "forward",
					turn: null,
				},
				possessionGeneration: possession.possessionGeneration,
				revision: 1,
				runRateScalar: possession.runRateCapability.initial,
				stance: possession.acceptedStance,
			},
		]);
		if (result !== "accepted") {
			throw new Error(`Selection animation intent returned ${result}.`);
		}
		for (let tick = 0; tick < 120; tick += 1) {
			await invoke("tickPossession", [1000 / 30]);
			motion = await invoke("possessionMotionProbe");
			if (
				motion?.motion?.activity === "locomotion" &&
				motion.motion.locomotion?.clip.completion === "loop"
			)
				break;
		}
		if (motion?.motion?.activity !== "locomotion")
			throw new Error(
				`Selection fixture retained explicit motion: ${JSON.stringify(motion)}.`,
			);
	}
	const state = await invoke("state");
	const targets = [];
	for (const entity of state.spawnedEntities) {
		targets.push({
			evidence: await invoke("probeSpawnedEntitySelection", [
				entity.identity.guid,
				150,
			]),
			generation: entity.generation,
			guid: entity.identity.guid,
			placementKind: entity.placement.kind,
			wcid: entity.identity.wcid,
		});
	}
	return { motion, targets };
}

function assertSpawnedSelectionProbe(probe, expectsAnimation) {
	if (probe === null || probe.targets.length === 0) {
		throw new Error("Spawned selection probe produced no targets.");
	}
	for (const target of probe.targets) {
		for (const sample of [target.evidence.first, target.evidence.second]) {
			if (
				sample.exactHit.selectedGuid !== target.guid ||
				sample.exactHit.distance === null ||
				sample.geometry.guid !== target.guid ||
				sample.geometry.partCount <= 0 ||
				sample.geometry.triangleCount <= 0 ||
				sample.mask.activeMaskBytes <= 0 ||
				sample.mask.maskDrawCount <= 0 ||
				sample.mask.compositeDrawCount !== 1 ||
				sample.mask.skippedReason !== null
			) {
				throw new Error(
					`Spawned selection target did not reach exact geometry and mask rendering: ${JSON.stringify(target)}.`,
				);
			}
		}
	}
	if (expectsAnimation) {
		const root = probe.targets.find(
			(target) => target.placementKind === "world",
		);
		if (
			![probe.motion?.motion?.ordinary, probe.motion?.motion?.locomotion].some(
				(layer) => layer?.clip.kind === "playing",
			) ||
			root === undefined ||
			Math.abs(
				root.evidence.second.geometry.transformChecksum -
					root.evidence.first.geometry.transformChecksum,
			) <= 1e-6
		) {
			throw new Error(
				`Spawned selection probe did not follow an authored animation: ${JSON.stringify(probe)}.`,
			);
		}
	}
}

async function runPossessionScenario(
	client,
	spawned,
	requestedTickMs,
	initialCamera,
	captureFrameState,
) {
	const tickMs = Math.min(50, requestedTickMs);
	const transitionTimeoutTicks = Math.ceil(4_000 / tickMs);
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
	let previousSettlingEntity = null;
	let stationaryGroundedTicks = 0;
	// The default outdoor camera can seed the fixture several hundred metres above support.
	for (let tick = 0; tick < 480; tick += 1) {
		await invoke("tickExplorerEntities", [tickMs]);
		settledState = await invoke("state");
		const settlingEntity = exactHarnessEntity(settledState, spawned);
		stationaryGroundedTicks =
			settlingEntity.placement.contact === "grounded" &&
			previousSettlingEntity !== null &&
			planarDistance(previousSettlingEntity, settlingEntity) <= 1e-6
				? stationaryGroundedTicks + 1
				: 0;
		previousSettlingEntity = settlingEntity;
		if (stationaryGroundedTicks >= 3) break;
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
	const initialRunRate = possession.runRateCapability.initial;
	const maximumRunRate = possession.runRateCapability.maximum;
	let runRateScalar = initialRunRate;
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
	const drive = (
		longitudinal = null,
		turn = null,
		lateral = null,
		gait = "run",
	) => ({
		gait,
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
				runRateScalar,
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
	const boomProjectionRequests = [];
	await advance(2, true);
	// Change the scalar while stationary first. The idle clip and physical body must remain
	// stationary even though the host has accepted the new complete snapshot.
	const idleInitial = await advance(1);
	runRateScalar = maximumRunRate;
	await setDrive(drive());
	const idleMaximum = await advance(1);
	await setDrive(drive("forward"));
	const maximumRate = await advance(1);
	runRateScalar = initialRunRate;
	await setDrive(drive());
	await advance(2);
	// Walking is a separate retail command family. Exercise the same slider transition at both
	// ends of the range and retain the displacement pair as environment-sensitive evidence.
	const walkingStart = current;
	runRateScalar = maximumRunRate;
	await setDrive(drive("forward", null, null, "walk"));
	const walkingMaximum = await advance(15);
	const walkingMaximumDistance = planarDistance(
		walkingStart,
		walkingMaximum.entity,
	);
	const walkingRateOneStart = walkingMaximum.entity;
	runRateScalar = initialRunRate;
	await setDrive(drive("forward", null, null, "walk"));
	const walkingInitial = await advance(15);
	const walkingInitialDistance = planarDistance(
		walkingRateOneStart,
		walkingInitial.entity,
	);
	runRateScalar = initialRunRate;
	await setDrive(drive());
	await advance(2);
	// Preserve the authored interior portal-route seed. The outdoor case supplies overlapping
	// walking evidence; the interior case isolates resize/orbit/zoom against nearby geometry before
	// executing its established traversal.
	await setDrive(initialCamera.envCellId === null ? drive("forward") : drive());
	for (const [width, height, fov] of [
		[1600, 720, 110],
		[800, 900, 65],
	]) {
		const requested = await invoke("reprojectKinematicBoom", [
			width,
			height,
			fov,
		]);
		let projectionState = null;
		let settleTickCount = 0;
		while (settleTickCount < 120) {
			await advance(1, true);
			settleTickCount += 1;
			projectionState = (await invoke("state")).boomProjection;
			if (
				projectionState.active?.revision === requested.revision &&
				projectionState.requested?.revision === requested.revision
			) {
				break;
			}
		}
		boomProjectionRequests.push({
			requested,
			settleTickCount,
			state: projectionState,
		});
	}
	await setDrive(drive());
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

	await setDrive(drive("backward"));
	let backwardEntry = await advance(1);
	for (let tick = 1; tick < transitionTimeoutTicks; tick += 1) {
		if (
			backwardEntry.probe?.motion?.ordinary?.clip.kind === "playing" &&
			backwardEntry.probe.motion.ordinary.clip.completion === "loop"
		)
			break;
		backwardEntry = await advance(1);
	}
	if (
		backwardEntry.probe?.motion?.ordinary?.clip.kind !== "playing" ||
		backwardEntry.probe.motion.ordinary.clip.completion !== "loop"
	) {
		throw new Error(
			`Possessed S did not reach its reversed cyclic motion: ${JSON.stringify(backwardEntry.probe)}.`,
		);
	}
	// A table may author a one-shot transition whose root travels differently from the selected
	// locomotion cycle. Measure signed movement only after that transition has completed.
	const initial = backwardEntry.entity;
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
	// A released motor brakes over time. Measure pure turning only after that
	// physical continuation has stopped, rather than attributing it to turn input.
	let stopped = await advance(1);
	for (let tick = 1; tick < transitionTimeoutTicks; tick += 1) {
		if (stopped.probe?.effectivePlanarSpeed === 0) break;
		stopped = await advance(1);
	}
	if (stopped.probe?.effectivePlanarSpeed !== 0)
		throw new Error("Released possession movement did not brake to rest.");
	const turnStart = current;
	await setDrive(drive(null, "left"));
	const left = await advance(4);
	await setDrive(drive(null, "right"));
	const right = await advance(4);

	await setDrive(drive("backward", "left"));
	boomIntentReceipts.push(
		await invoke("setKinematicBoomIntent", [
			{
				...boomIdentity,
				inputSequence: 3,
				viewDirection: orbitDirection,
				cumulativeZoomDisplacement: 27.5,
			},
		]),
	);
	const combinedStart = current;
	const combined = await advance(4);
	boomIntentReceipts.push(
		await invoke("setKinematicBoomIntent", [
			{
				...boomIdentity,
				inputSequence: 4,
				viewDirection: boomDirection,
				cumulativeZoomDisplacement: 27.5,
			},
		]),
	);
	await setDrive(drive(null, "left"));
	const turnOnly = await advance(3);
	await setDrive(drive("backward"));
	const backwardOnly = await advance(3);
	await setDrive(drive(null, null, "right"));
	const sidestepStart = current;
	const sidestep = await advance(4);

	const jumpingDrive = drive("forward");
	const jumpChargeInitialRate = runRateScalar;
	revision += 1;
	const begin = await invoke("queuePossessionEvent", [
		{
			drive: jumpingDrive,
			kind: "begin-jump",
			possessionGeneration: possession.possessionGeneration,
			revision,
			runRateScalar,
			sequence: sequence++,
			stance,
		},
	]);
	const charged = await advance(1);
	// Change the scalar while the charge is live, then release with that captured maximum-rate
	// snapshot. The follow-up change after the release must not rewrite its queued launch physics.
	runRateScalar = maximumRunRate;
	await setDrive(jumpingDrive);
	const chargedAtMaximum = await advance(1);
	const releaseRunRate = runRateScalar;
	revision += 1;
	const release = await invoke("queuePossessionEvent", [
		{
			drive: jumpingDrive,
			extent: 0.5,
			kind: "release-jump",
			possessionGeneration: possession.possessionGeneration,
			revision,
			runRateScalar,
			sequence,
			stance,
		},
	]);
	const launchStart = current;
	let sawAirborne = false;
	let sawFalling = false;
	let maximumZ = entityCoordinates(current).z;
	let landed = null;
	let postReleaseRateChange = null;
	for (let index = 0; index < 100; index += 1) {
		const step = await advance(1);
		maximumZ = Math.max(maximumZ, entityCoordinates(step.entity).z);
		if (step.entity.placement.contact === "airborne") sawAirborne = true;
		if (step.probe?.substate.command === 0x40000015) sawFalling = true;
		if (sawAirborne && postReleaseRateChange === null) {
			runRateScalar = initialRunRate;
			await setDrive(jumpingDrive);
			postReleaseRateChange = await advance(1);
		}
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
	// Re-acquiring the same entity creates a fresh host possession generation. Its capability
	// receipt must reset the selected scalar to the host's initial value rather than leaking the
	// previous generation's last slider setting.
	const replacementPossession = await invoke("possessExplorerEntity", [
		spawned.identity.guid,
	]);
	const replacementInitialTick = await invoke("tickPossession", [tickMs]);
	const replacementProbeBeforeIntent = await invoke("possessionMotionProbe");
	const replacementIntentResult = await invoke("setPossessionIntent", [
		{
			drive: drive(),
			possessionGeneration: replacementPossession.possessionGeneration,
			revision: 1,
			runRateScalar: maximumRunRate,
			stance: replacementPossession.acceptedStance,
		},
	]);
	if (replacementIntentResult !== "accepted")
		throw new Error(
			`Replacement possession intent returned ${replacementIntentResult}.`,
		);
	const replacementTick = await invoke("tickPossession", [tickMs]);
	const replacementProbeAtMaximum = await invoke("possessionMotionProbe");
	await invoke("possessExplorerEntity", [null]);

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
			projectionRequests: boomProjectionRequests,
			releaseCamera: { after: cameraAfterRelease, before: cameraBeforeRelease },
			repeatedStepTickRange,
			route: boomRoute,
			stopAfterRelease,
			targetCellIds: boomTargetCellIds,
			tickMs,
			ticks: boomTicks,
		},
		charged,
		chargedAtMaximum,
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
		releaseRunRate,
		postReleaseRateChange,
		replacement: {
			initialRunRate: replacementPossession.runRateCapability.initial,
			maximumRunRate: replacementPossession.runRateCapability.maximum,
			possession: replacementPossession,
			probeAtMaximum: replacementProbeAtMaximum,
			probeBeforeIntent: replacementProbeBeforeIntent,
			tick: replacementTick,
			initialTick: replacementInitialTick,
		},
		restored,
		restoredStart,
		runRate: {
			initial: initialRunRate,
			maximum: maximumRunRate,
			maximumRateProbe: maximumRate.probe,
			idleInitialProbe: idleInitial.probe,
			idleMaximumProbe: idleMaximum.probe,
			walkingInitialDistance,
			walkingInitialProbe: walkingInitial.probe,
			walkingMaximumDistance,
			walkingMaximumProbe: walkingMaximum.probe,
			jumpChargeInitialRate,
			jumpChargeInitialProbe: charged.probe,
			jumpChargeMaximumProbe: chargedAtMaximum.probe,
			postReleaseProbe: postReleaseRateChange?.probe ?? null,
		},
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
	if (
		scenario.runRate.initial !== 1 ||
		scenario.runRate.maximum !== 10 ||
		scenario.runRate.maximumRateProbe?.requestedRunRate !== 10 ||
		scenario.runRate.idleInitialProbe?.requestedRunRate !== 1 ||
		scenario.runRate.idleMaximumProbe?.requestedRunRate !== 10 ||
		scenario.runRate.walkingInitialProbe?.requestedRunRate !== 1 ||
		scenario.runRate.walkingMaximumProbe?.requestedRunRate !== 10 ||
		scenario.runRate.jumpChargeInitialRate !== 1 ||
		scenario.runRate.jumpChargeInitialProbe?.requestedRunRate !== 1 ||
		scenario.runRate.jumpChargeMaximumProbe?.requestedRunRate !== 10 ||
		scenario.runRate.postReleaseProbe?.requestedRunRate !== 1 ||
		scenario.releaseRunRate !== 10
	)
		throw new Error(
			`Possession run-rate transitions did not apply their complete snapshots: ${JSON.stringify(scenario.runRate)}.`,
		);
	if (
		scenario.replacement.possession.runRateCapability.initial !== 1 ||
		scenario.replacement.possession.runRateCapability.maximum !== 10 ||
		scenario.replacement.probeBeforeIntent?.requestedRunRate !== 1 ||
		scenario.replacement.probeAtMaximum?.requestedRunRate !== 10 ||
		scenario.replacement.possession.possessionGeneration ===
			scenario.possession.possessionGeneration
	)
		throw new Error(
			`Possession replacement did not reset and reapply the host run-rate contract: ${JSON.stringify(scenario.replacement)}.`,
		);
	if (
		scenario.runRate.walkingInitialProbe?.substate.speed !== 1 ||
		scenario.runRate.walkingMaximumProbe?.substate.speed !== 1
	)
		throw new Error(
			`Walking command rate changed with run rate: ${JSON.stringify(scenario.runRate)}.`,
		);
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
	const playableBoomTicks = scenario.boom.ticks;
	if (
		JSON.stringify(scenario.boom.intentReceipts) !==
		JSON.stringify([
			"accepted",
			"accepted",
			"ignored-stale",
			"accepted",
			"accepted",
		])
	)
		throw new Error(
			`Host kinematic boom intent receipts were not accepted/accepted/stale: ${JSON.stringify(scenario.boom.intentReceipts)}.`,
		);
	if (playableBoomTicks.length === 0)
		throw new Error("Host kinematic boom published no playable path.");
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
	for (const evidence of scenario.boom.projectionRequests) {
		if (
			evidence.state.active?.revision !== evidence.requested.revision ||
			evidence.state.requested?.revision !== evidence.requested.revision
		) {
			throw new Error(
				`Boom projection did not converge to its latest resize/FOV request: ${JSON.stringify(evidence)}.`,
			);
		}
	}
	const acknowledgedRevisions = new Set(
		scenario.boom.ticks
			.map((tick) =>
				tick.kind === "fallback"
					? undefined
					: tick.clearance.projectionRevision,
			)
			.filter((revision) => revision !== undefined),
	);
	const invalidProjectionFrame = scenario.boom.frameStates.find((state) => {
		const active = state.boomProjection.active;
		return (
			active !== null &&
			(!acknowledgedRevisions.has(active.revision) ||
				state.camera?.fov !== active.fov ||
				state.camera?.near !== active.near)
		);
	});
	if (invalidProjectionFrame !== undefined) {
		throw new Error(
			`Rendered boom projection lacks matching host clearance evidence: ${JSON.stringify(invalidProjectionFrame)}.`,
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
		!Array.isArray(scenario.controlProbe.possessionOrbitDelta) ||
		scenario.controlProbe.possessionOrbitDelta[0] === 0 ||
		scenario.controlProbe.characterInputCountAfterKeyboard !== 1 ||
		scenario.controlProbe.characterInputCountAfterPointerAndWheel !== 1 ||
		!Number.isFinite(scenario.controlProbe.boomZoomDisplacement) ||
		scenario.controlProbe.boomZoomDisplacement === 0 ||
		Math.abs(scenario.controlProbe.recenterBeforeYaw) > 1e-6 ||
		Math.abs(scenario.controlProbe.recenterMidYaw + Math.PI / 4) > 1e-6 ||
		Math.abs(scenario.controlProbe.recenterAfterYaw + Math.PI / 2) > 1e-6 ||
		Math.abs(scenario.controlProbe.recenterTrackingYaw + Math.PI / 2 - 0.4) >
			1e-6 ||
		Math.abs(scenario.controlProbe.recenterPitch + 0.4) > 1e-6
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
	const leftTravel = planarDistance(scenario.turnStart, scenario.left.entity);
	const rightTravel = planarDistance(
		scenario.left.entity,
		scenario.right.entity,
	);
	if (leftTravel > 0.01 || rightTravel > 0.01) {
		throw new Error(
			`Pure turns translated the possessed body: ${JSON.stringify({ leftTravel, leftProbe: scenario.left.probe, rightTravel, rightProbe: scenario.right.probe })}.`,
		);
	}

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
	const distance = planarDistance(first, second);
	if (distance > 0.01) {
		throw new Error(
			`${label} unexpectedly translated the possessed body by ${distance} m from ${JSON.stringify(entityCoordinates(first))} to ${JSON.stringify(entityCoordinates(second))}.`,
		);
	}
}

function assertLaunchedEntityLifecycle(result) {
	const lifecycle = result.entityLifecycle;
	if (lifecycle?.launched === null || lifecycle?.launched === undefined) {
		throw new Error(
			"Launch scenario did not return a current launched entity.",
		);
	}
	const advance = lifecycle.advances.find(
		(envelope) => envelope?.entityEvent !== null,
	)?.entityEvent;
	if (advance === undefined || advance === null) {
		throw new Error("Launch scenario produced no changed-entity tick batch.");
	}
	const launchedAdvance = advance.batch.advances.find(
		({ entity }) =>
			entity.identity.guid === lifecycle.spawned.identity.guid &&
			entity.generation === lifecycle.spawned.generation,
	);
	if (launchedAdvance === undefined) {
		throw new Error("Launch advance omitted the exact spawned generation.");
	}
	const initial = launchedAdvance.path.initial.pose.coords;
	const final = launchedAdvance.path.legs.at(-1)?.end.pose.coords;
	if (
		final === undefined ||
		Math.hypot(final.x - initial.x, final.y - initial.y, final.z - initial.z) <=
			0
	) {
		throw new Error("Launch advance accepted no displacement.");
	}
}

function assertRelocatedEntityLifecycle(result, expectedKind) {
	const event = result.entityLifecycle?.relocated;
	if (event?.kind !== "ticked" || event.batch.durationMs !== 0) {
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
	if (initialState === null)
		throw new Error("Mode cycle did not capture its resource baseline.");
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

function assertEntityShadowCycle(initialState, states) {
	if (initialState === null)
		throw new Error(
			"Entity-shadow cycle did not capture its resource baseline.",
		);
	if (states.length !== 5) {
		throw new Error(
			`Entity-shadow cycle produced ${states.length} snapshots, expected 5.`,
		);
	}
	const initial = initialState.entityShadowResources?.outdoorTargets;
	const disabled = states[0]?.entityShadowResources?.outdoorTargets;
	const simple = states[1]?.entityShadowResources?.outdoorTargets;
	const enabled = states[2]?.entityShadowResources?.outdoorTargets;
	const reconfigured = states[3]?.entityShadowResources?.outdoorTargets;
	const restored = states[4]?.entityShadowResources?.outdoorTargets;
	if (
		!initial ||
		!disabled ||
		!simple ||
		!enabled ||
		!reconfigured ||
		!restored
	) {
		throw new Error("Entity-shadow cycle did not publish target diagnostics.");
	}
	if (states[0].frameSettings.entityShadows.mode !== "none") {
		throw new Error("Entity-shadow disable step retained a non-none policy.");
	}
	if (
		disabled.activeBytes !== 0 ||
		disabled.activeFramebufferCount !== 0 ||
		disabled.activeTextureCount !== 0
	) {
		throw new Error(
			`Entity-shadow disable step retained GPU targets: ${JSON.stringify(disabled)}.`,
		);
	}
	if (
		states[1].frameSettings.entityShadows.mode !== "simple" ||
		simple.activeBytes !== 0 ||
		simple.activeFramebufferCount !== 0 ||
		simple.activeTextureCount !== 0
	) {
		throw new Error(
			`Entity-shadow simple step retained PSSM targets: ${JSON.stringify(simple)}.`,
		);
	}
	if (states[2].frameSettings.entityShadows.mode !== "shadow-maps") {
		throw new Error("Entity-shadow hybrid step did not select shadow-maps.");
	}
	if (
		initial.activeBytes > 0 &&
		disabled.disposedGenerationCount <= initial.disposedGenerationCount
	) {
		throw new Error(
			"Entity-shadow disable step did not dispose its active generation.",
		);
	}
	if (
		enabled.activeBytes <= 0 ||
		enabled.allocatedGenerationCount <= disabled.allocatedGenerationCount
	) {
		throw new Error(
			"Entity-shadow re-enable step did not allocate one active generation.",
		);
	}
	if (
		reconfigured.resolution === enabled.resolution ||
		reconfigured.allocatedGenerationCount <= enabled.allocatedGenerationCount ||
		reconfigured.disposedGenerationCount <= enabled.disposedGenerationCount
	) {
		throw new Error(
			"Entity-shadow resize step did not replace its target generation.",
		);
	}
	if (
		restored.resolution !==
			initialState.frameSettings.entityShadows.pssm.mapResolution ||
		restored.allocatedGenerationCount <=
			reconfigured.allocatedGenerationCount ||
		restored.disposedGenerationCount <= reconfigured.disposedGenerationCount
	) {
		throw new Error(
			"Entity-shadow restore step did not replace the resized generation.",
		);
	}
}

function assertSpawnedEntityLifecycle(result) {
	const lifecycle = result.entityLifecycle;
	if (lifecycle === null) {
		throw new Error("Spawned-entity scenario produced no lifecycle evidence.");
	}
	const initialDynamics = result.initialState.authoredDynamics?.dynamics;
	const postSpawnDynamics = lifecycle.spawnedState?.authoredDynamics?.dynamics;
	const postDespawnDynamics =
		lifecycle.despawnedState?.authoredDynamics?.dynamics;
	if (!initialDynamics || !postSpawnDynamics || !postDespawnDynamics) {
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
		postSpawnDynamics.entityCount !==
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
	if (postDespawnDynamics.entityCount !== initialDynamics.entityCount) {
		throw new Error("Exact despawn retained a shared-runtime dynamic entity.");
	}
	if (
		postDespawnDynamics.templates.templateCount !==
		initialDynamics.templates.templateCount
	) {
		throw new Error("Exact despawn retained an immutable visual template.");
	}
}

async function startContentHost() {
	const child = startChild("cargo", [
		"run",
		"-p",
		"holtburger-3d-host",
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
	const reuseRequestedPort = port !== null && port !== 0;
	const resolvedPort = reuseRequestedPort ? port : await findAvailablePort();
	const viteUrl = `http://127.0.0.1:${resolvedPort}`;
	if (reuseRequestedPort && (await isUrlReady(`${viteUrl}/harness/browser/`))) {
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
		String(resolvedPort),
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
	await waitForRequiredEnvCellPublication(client);
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

/** Launch the client HUD fixture without starting a content host or gameplay runtime. */
async function runClientHudHarness({ viteUrl }) {
	const userDataDirectory = await mkdtemp(
		join(tmpdir(), "holtburger-3d-client-hud-harness-"),
	);
	tempDirectories.push(userDataDirectory);
	const pageUrl = `${viteUrl}/harness/browser/?client-hud=1`;
	const chrome = startChild(options.chromePath, [
		"--remote-debugging-port=0",
		`--user-data-dir=${userDataDirectory}`,
		"--no-first-run",
		"--disable-background-networking",
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
		await waitForClientHudHarnessApi(client);
		if (options.clientPartyScreenshotDirectory !== null) {
			await mkdir(options.clientPartyScreenshotDirectory, { recursive: true });
			// Isolate the real party surface for crops; its production styling remains untouched.
			await evaluateExpression(
				client,
				`(() => {
				const style = document.createElement("style");
				style.textContent = '.hud-panel:not([aria-label="Party HUD"]), .minimap { visibility: hidden !important; }';
				document.head.append(style);
			})()`,
			);
			const screenshots = [];
			for (const columns of [1, 2, 3, 4]) {
				const clip = await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.showPartyHud",
					[columns],
				);
				const capture = await client.send("Page.captureScreenshot", {
					format: "png",
					captureBeyondViewport: false,
					clip,
				});
				const path = join(
					options.clientPartyScreenshotDirectory,
					`party-${columns}-columns.png`,
				);
				await writeFile(path, Buffer.from(capture.data, "base64"));
				screenshots.push({ columns, path });
			}
			return {
				partyHudScreenshots: screenshots,
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientVitals) {
			const probes = [];
			for (const value of ["no-preference", "reduce"]) {
				await client.send("Emulation.setEmulatedMedia", {
					features: [{ name: "prefers-reduced-motion", value }],
				});
				probes.push(
					await evaluate(
						client,
						"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeVitalWarnings",
						[],
					),
				);
			}
			probes.push(
				await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probePartyHud",
					[],
				),
			);
			return {
				clientVitals: probes,
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientEnvironment) {
			await client.send("Browser.grantPermissions", {
				origin: new URL(pageUrl).origin,
				permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
			});
			const probe = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeEnvironment",
				[],
			);
			if (!probe?.passed)
				throw new Error("Client environment probe did not pass.");
			return {
				clientEnvironment: probe,
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientKeyboard)
			return {
				clientKeyboard: await probeKeyboardPolicy(client, evaluateExpression),
				consoleMessages,
				state: { error: null, ready: true },
			};

		if (options.clientSettingsTabs)
			return {
				clientSettingsTabs: await probeClientSettingsTabs(
					client,
					evaluateExpression,
					delay,
				),
				consoleMessages,
				state: { error: null, ready: true },
			};
		if (options.clientHousing)
			return {
				housing: await probeClientHousing(client),
				state: { error: null, ready: true },
				consoleMessages,
			};
		if (options.clientWorldMap)
			return {
				worldMapPanel: await probeClientWorldMap(client),
				state: { error: null, ready: true },
				consoleMessages,
			};
		if (options.characterSheet) {
			return {
				characterSheet: await probeCharacterSheet(
					client,
					evaluateExpression,
					delay,
				),
				state: {
					viewport: {
						width: options.viewportWidth,
						height: options.viewportHeight,
					},
				},
				consoleMessages,
			};
		}
		if (options.clientAudio) {
			// Live AudioContext activation requires a browser-recognized user gesture.
			const audio = await client.send("Runtime.evaluate", {
				expression:
					"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeAudio()",
				userGesture: true,
				awaitPromise: true,
				returnByValue: true,
			});
			if (audio.exceptionDetails)
				throw new Error(
					audio.exceptionDetails.exception?.description ??
						audio.exceptionDetails.text,
				);
			return {
				clientAudio: audio.result.value,
				consoleMessages,
				state: { error: null, ready: true },
			};
		}

		if (options.clientConnection) {
			return {
				connectionBadge: await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeConnectionBadge",
					[],
				),
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientTrade) {
			return {
				clientTrade: await probeTrade(client, evaluateExpression),
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientInspection) {
			// Inspection verifies coexistence with the container fixture established by the full HUD suite.
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeWorldContainer",
				[],
			);
			return {
				clientInspection: await probeObjectInspection(
					client,
					evaluateExpression,
					null,
				),
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientAllegiance) {
			return {
				clientAllegiance: await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeAllegiance",
					[],
				),
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientSquelch) {
			return {
				clientSquelch: await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeSquelch",
					[],
				),
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientBindingControls) {
			// Settings composition also establishes the accepted inventory facts used by the caster scenario.
			const bindings = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeBindings",
				[],
			);
			const controls = await probeBindingControls(client, evaluateExpression);
			const vendor = await probeVendor(client, evaluateExpression, null);
			return {
				clientBindingControls: { ...controls, bindings, vendor },
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientBindings) {
			return {
				clientBindings: await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeBindings",
					[],
				),
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientSelectedActions) {
			return {
				clientSelectedActions: await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeSelectedActions",
					[],
				),
				clientActionFeedback: await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeActionFeedback",
					[],
				),
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientContracts) {
			const map = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeContractMap",
				[],
			);
			const result = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeContracts",
				[],
			);
			await evaluateExpression(
				client,
				`document.querySelector('nav[aria-label="Game shortcuts"] button[aria-label="World"]').click()`,
			);
			await delay(50);
			const toggleSelector =
				'section.hud-window[aria-label="World"] button[aria-label="Show contracts"]';
			await evaluateExpression(
				client,
				`document.querySelector(${JSON.stringify(toggleSelector)}).focus()`,
			);
			for (const type of ["keyDown", "keyUp"])
				await client.send("Input.dispatchKeyEvent", {
					type,
					key: "Enter",
					code: "Enter",
					windowsVirtualKeyCode: 13,
					text: type === "keyDown" ? "\r" : undefined,
				});
			await delay(50);
			if (
				(await evaluateExpression(
					client,
					`document.querySelector(${JSON.stringify(toggleSelector)}).getAttribute('aria-pressed')`,
				)) !== "false"
			)
				throw new Error("Contracts map toggle did not respond to native Enter");
			map.keyboardToggle = true;
			await evaluateExpression(
				client,
				`document.querySelector('section.hud-window[aria-label="World"] button[aria-label="Close World"]').click()`,
			);
			await evaluateExpression(
				client,
				`document.querySelector('nav[aria-label="Game shortcuts"] button[aria-label="Journal"]').click()`,
			);
			await delay(50);
			const selector = 'section.hud-window[aria-label="Journal"] details';
			await evaluateExpression(
				client,
				`(() => {
                    const summary = document.querySelector(${JSON.stringify(selector + " summary")});
                    globalThis.__journalKeyboardEvidence = [];
                    for (const name of ["keydown", "keyup", "click"]) summary.addEventListener(name, event => globalThis.__journalKeyboardEvidence.push({ name, key: event.key, prevented: event.defaultPrevented }));
                    summary.focus();
                    return document.activeElement.tagName;
                })()`,
			);
			for (const type of ["keyDown", "keyUp"]) {
				await client.send("Input.dispatchKeyEvent", {
					type,
					key: "Enter",
					code: "Enter",
					windowsVirtualKeyCode: 13,
					text: type === "keyDown" ? "\r" : undefined,
				});
			}
			await delay(50);
			if (
				!(await evaluateExpression(
					client,
					`document.querySelector(${JSON.stringify(selector)}).open`,
				))
			)
				throw new Error(
					`Journal disclosure did not respond to native Enter activation: ${JSON.stringify(await evaluateExpression(client, `({ active: document.activeElement.tagName, evidence: globalThis.__journalKeyboardEvidence, open: document.querySelector(${JSON.stringify(selector)}).open })`))}`,
				);
			return {
				clientContracts: { ...result, keyboardDisclosure: true, map },
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientFriends) {
			return {
				clientFriends: await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeFriends",
					[],
				),
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientParty) {
			return {
				clientParty: await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeParty",
					[],
				),
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientLoadouts) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeInventory",
				[],
			);
			return {
				clientLoadouts: await probeLoadouts(client, evaluateExpression),
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientBook) {
			return {
				clientBook: await probeClientBook(client, evaluateExpression, delay),
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		if (options.clientPreciseJump) {
			const preciseJump = await evaluateExpression(
				client,
				`(async () => (await import('/src/harness/browser/client-precise-jump-probe.ts')).probeClientPreciseJump())()`,
			);
			if (!preciseJump?.passed)
				throw new Error("Client precise-jump probe did not pass.");
			const jumpHud = await evaluateExpression(
				client,
				`(async () => (await import('/src/harness/browser/client-jump-hud-probe.ts')).probeClientJumpHud())()`,
			);
			if (!jumpHud?.passed)
				throw new Error("Jump HUD theme/icon probe did not pass.");
			const wheel = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probePreciseJumpWheel",
				[],
			);
			if (!wheel?.passed)
				throw new Error("Precise wheel routing probe failed.");
			return {
				clientPreciseJump: {
					...preciseJump,
					jumpHud,
					wheel,
					camera: await probePreciseJumpCamera(
						client,
						evaluate,
						evaluateExpression,
					),
				},
				consoleMessages,
				state: { error: null, ready: true },
			};
		}
		return {
			...(await probeClientHud(client, {
				options,
				viteUrl,
				evaluate,
				evaluateExpression,
				delay,
			})),
			consoleMessages,
		};
	} finally {
		client.close();
	}
}

async function runHarness({ contentHostUrl, viteUrl }) {
	const userDataDirectory = await mkdtemp(
		join(tmpdir(), "holtburger-3d-browser-harness-"),
	);
	tempDirectories.push(userDataDirectory);
	const fixture = options.fixture
		? `&fixture=${encodeURIComponent(options.fixture)}`
		: "";
	const portalTransitionCompositorDiagnostic =
		options.portalTransitionCompositorDiagnostic
			? `&portalTransitionCompositorDiagnostic=true&portalTransitionComposition=${options.portalTransitionComposition}&portalTransitionProgress=${options.portalTransitionProgress}`
			: "";
	const portalTransitionLifecycleFixture =
		options.portalTransitionLifecycleFixture
			? "&portalTransitionLifecycleFixture=true"
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
	const worldMarker =
		options.worldMarker === null ? "" : `&worldMarker=${options.worldMarker}`;
	const pageUrl = `${viteUrl}/harness/browser/?contentHost=${encodeURIComponent(contentHostUrl)}&cameraHeight=${encodeURIComponent(options.cameraHeight)}&viewportWidth=${encodeURIComponent(options.viewportWidth)}&viewportHeight=${encodeURIComponent(options.viewportHeight)}${dynamicIsolation}${dynamicExclusion}${attachmentExclusion}${fixture}${portalTransitionCompositorDiagnostic}${portalTransitionLifecycleFixture}${timeOfDay}${dayGroup}${particleSeed}${frameIntervalMs}${captureFrame}${audioTrace}${terrainGlTrace}${worldMarker}${options.uiTheme ? "&ui-theme=1" : ""}${options.worldMap ? "&world-map=1" : ""}`;
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
		if (options.worldMap)
			return await probeWorldMap(client, consoleMessages, browserWebSocketUrl);
		await waitForHarnessApi(client);

		if (process.env.HOLTBURGER_PROBE_PORTAL_TRAVERSAL === "1") {
			await evaluateExpression(
				client,
				`import('/src/harness/browser/portal-traversal-investigation.ts').then(module => module.installPortalTraversalInvestigation())`,
			);
		}
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
		if (options.entityShadows !== null) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setEntityShadowSettings",
				[options.entityShadows],
			);
		}
		if (
			options.entityShadowSelectedRoots !== null ||
			options.entityShadowMappedRoots !== null
		) {
			if (
				options.entityShadowSelectedRoots === null ||
				options.entityShadowMappedRoots === null
			) {
				throw new Error(
					"Caster-budget tuning requires both --entity-shadow-selected-roots and --entity-shadow-mapped-roots.",
				);
			}
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setEntityShadowCasterBudget",
				[options.entityShadowSelectedRoots, options.entityShadowMappedRoots],
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
		await waitForRequiredEnvCellPublication(client);
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
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.focusExplorerTarget",
				[
					options.landblockId,
					options.cameraYawDegrees,
					options.cameraPitchDegrees,
				],
			);
			await delay(250);
		}
		if (
			options.envCellCameraId !== null &&
			options.envCellCameraPosition !== null
		) {
			await placeEnvCellCamera(client, options);
		}
		if (options.nameplatesDisabled) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setNameplateMaximumVisible",
				[0],
			);
		}
		// Establish the requested mode before any probe captures evidence, not just final reporting.
		if (!options.modeCycle && options.frameMode !== null) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setEnvCellRenderMode",
				[options.frameMode],
			);
			await waitForFrameMode(client, options.frameMode);
		}
		if (options.fixture === "combat-effects") {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.probeRuntimeCombatEffects",
				[],
			);
		}
		let nameplateWorkload = null;
		if (options.nameplateWorkload !== null) {
			if (
				[
					"repeated-100",
					"unique-100",
					"ordered-500",
					"shadow-crowd-112x61",
				].includes(options.nameplateWorkload)
			) {
				// These fixtures isolate cache and budget behavior. Keep their deliberately deep rows
				// eligible so a presentation cutoff does not silently weaken the workload under test.
				await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setNameplateMinimumLegiblePixels",
					[0.1],
				);
			}
			const entities = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.installSyntheticNameplateWorkload",
				[options.nameplateWorkload],
			);
			nameplateWorkload = {
				entityCount: entities.length,
				kind: options.nameplateWorkload,
			};
			await delay(500);
		}
		const initialState = await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
			[],
		);
		let dynamicDomains = null;
		if (options.dynamicDomains) {
			if (
				options.nameplateWorkload !== "portal-plural" ||
				options.frameMode !== "portal" ||
				options.screenshotPath === null
			)
				throw new Error(
					"--probe-dynamic-domains requires portal-plural, --frame-mode portal, and --screenshot.",
				);
			const evidence = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.probeDynamicDomains",
				[],
			);
			const results = [];
			for (const { image, ...sample } of evidence.results) {
				const path = `${options.screenshotPath}.domain-${sample.flags}.png`;
				await writeFile(path, Buffer.from(image.split(",")[1], "base64"));
				results.push({ ...sample, path });
			}
			dynamicDomains = { results };
		}
		let appearanceReplacement = null;
		let dynamicBlendFlags = null;
		if (options.dynamicBlendFlags) {
			if (
				options.nameplateWorkload !== "occlusion-open" ||
				options.screenshotPath === null
			)
				throw new Error(
					"--probe-dynamic-blend-flags requires --nameplate-workload occlusion-open and --screenshot.",
				);
			const evidence = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.probeDynamicBlendFlags",
				[],
			);
			const results = [];
			for (const { image, ...sample } of evidence.results) {
				const path = `${options.screenshotPath}.blend-${options.fixture === "blended" ? sample.y : sample.flags}.png`;
				await writeFile(path, Buffer.from(image.split(",")[1], "base64"));
				results.push({ ...sample, path });
			}
			dynamicBlendFlags = { ...evidence, results };
			if (options.fixture !== "blended") {
				const { image, referenceImage, ...cutout } = evidence.cutout;
				const path = `${options.screenshotPath}.cutout.png`;
				const referencePath = `${options.screenshotPath}.cutout-reference.png`;
				await writeFile(path, Buffer.from(image.split(",")[1], "base64"));
				await writeFile(
					referencePath,
					Buffer.from(referenceImage.split(",")[1], "base64"),
				);
				dynamicBlendFlags = {
					...evidence,
					results,
					cutout: { ...cutout, path, referencePath },
				};
			}
		}
		let dynamicViews = null;
		if (options.dynamicViews) {
			if (options.screenshotPath === null)
				throw new Error("--probe-dynamic-views requires --screenshot.");
			const samples = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.probeDynamicViews",
				[],
			);
			dynamicViews = [];
			for (const sample of samples) {
				const report = { mode: sample.mode };
				for (const key of ["a", "b", "ab", "ba", "aa"]) {
					const { image, ...facts } = sample[key];
					const path = `${options.screenshotPath}.${sample.mode}-${key}.png`;
					await writeFile(path, Buffer.from(image.split(",")[1], "base64"));
					report[key] = { ...facts, path };
				}
				dynamicViews.push(report);
			}
		}
		if (options.appearanceReplacement) {
			if (
				options.nameplateWorkload !== "occlusion-open" ||
				options.screenshotPath === null
			)
				throw new Error(
					"--probe-dynamic-appearance requires --nameplate-workload occlusion-open and --screenshot.",
				);
			const evidence = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.probeSyntheticAppearanceReplacement",
				[],
			);
			const beforePath = `${options.screenshotPath}.appearance-before.png`;
			const afterPath = `${options.screenshotPath}.appearance-after.png`;
			await writeFile(
				beforePath,
				Buffer.from(evidence.beforeDataUrl.split(",")[1], "base64"),
			);
			await writeFile(
				afterPath,
				Buffer.from(evidence.afterDataUrl.split(",")[1], "base64"),
			);
			if (
				!evidence.placementUnchanged ||
				evidence.replacementBoundsWidth !== 2 ||
				evidence.beforeDataUrl === evidence.afterDataUrl
			)
				throw new Error(
					"Dynamic appearance replacement did not preserve placement and change rendered geometry.",
				);
			appearanceReplacement = {
				opacityCycle: await Promise.all(
					evidence.opacityCycle.map(async ({ dataUrl, ...sample }, index) => {
						const path = `${options.screenshotPath}.opacity-${index}.png`;
						await writeFile(path, Buffer.from(dataUrl.split(",")[1], "base64"));
						return { ...sample, path };
					}),
				),
				beforePath,
				afterPath,
				placementUnchanged: evidence.placementUnchanged,
				replacementBoundsWidth: evidence.replacementBoundsWidth,
			};
		}
		let nameplateLifecycle = null;
		if (options.nameplateLifecycle) {
			if (options.nameplateWorkload === null)
				throw new Error("--nameplate-lifecycle requires --nameplate-workload.");
			nameplateLifecycle = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.probeSyntheticNameplateLifecycle",
				[],
			);
		}
		let spawnedEntity = null;
		let launchedEntity = null;
		let relocatedEntity = null;
		const entityAdvanceEvents = [];
		let spawnedEntityState = null;
		let completedEntityState = null;
		let possessionScenario = null;
		let spawnedSelection = null;
		let objectPreview = null;
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
			if (options.deathMotionFixture !== null) {
				if (options.screenshotPath === null)
					throw new Error("--death-motion-fixture requires --screenshot.");
				const samples = decode(await readFile(options.deathMotionFixture));
				for (const sample of samples) {
					const firstFrame = await evaluate(
						client,
						"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.applyDeathMotionSample",
						[sample],
					);
					await writeFile(
						`${options.screenshotPath}.${sample.label}.first.png`,
						Buffer.from(firstFrame, "base64"),
					);
					await delay(sample.wait_ms);
					const capture = await client.send("Page.captureScreenshot", {
						format: "png",
					});
					await writeFile(
						`${options.screenshotPath}.${sample.label}.png`,
						Buffer.from(capture.data, "base64"),
					);
				}
				await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.applyDeathMotionSample",
					[null],
				);
			}
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
			if (options.spawnedSelectionProbe) {
				spawnedSelection = await runSpawnedSelectionProbe(
					client,
					spawnedEntity,
					options.spawnSimulated,
				);
			}
			if (options.objectPreviewProbe) {
				objectPreview = await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.probeObjectPreviewLifecycle",
					[spawnedEntity.identity.guid],
				);
				for (const [label, sample] of Object.entries(objectPreview)) {
					if (label === "contextLoss" || label === "suspension") continue;
					if (sample.backgroundAlpha !== 0)
						throw new Error(
							`Object preview ${label} background alpha was ${sample.backgroundAlpha}, expected 0.`,
						);
					if (sample.glErrors.length > 0)
						throw new Error(
							`Object preview ${label} reported GL errors ${sample.glErrors.join(", ")}.`,
						);
					if (sample.visiblePixelCount === 0)
						throw new Error(
							`Object preview ${label} rendered only its uniform background.`,
						);
					if (sample.emissiveTransparentPixelCount !== 0)
						throw new Error(
							`Object preview ${label} emitted ${sample.emissiveTransparentPixelCount} RGB pixels without alpha coverage.`,
						);
				}
				if (
					objectPreview.contextLoss.supported &&
					(!objectPreview.contextLoss.previewContextLost ||
						objectPreview.contextLoss.worldContextLost)
				)
					throw new Error(
						`Object preview context-loss isolation failed: ${JSON.stringify(objectPreview.contextLoss)}.`,
					);
			}
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
				[options.entityPairWcid, [[0, 12, 0]], "integrated"],
			);
			const targets = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.spawnExplorerEntityFleet",
				[
					options.entityPairTargetWcid ?? options.entityPairWcid,
					[[options.entityPairSeparation, 12, 0]],
					"integrated",
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
				finalPlacements: contactState.spawnedEntities
					.filter((entity) => entity.placement.kind === "world")
					.map((entity) => ({
						guid: entity.identity.guid,
						wcid: entity.identity.wcid,
						coords: entity.placement.pose.coords,
						contact: entity.placement.contact,
						motion: entity.motion,
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
						[wcid, share, "integrated"],
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
				// The fleet remains installed through policy cycles, profiling, and capture so those
				// diagnostics measure the requested population rather than its empty teardown state.
				retiredCount: null,
				teardownState: null,
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
			(options.frameMode !== null || options.modeCycle || options.map) &&
			options.envCellCameraId !== null
		) {
			await placeEnvCellCamera(client, options);
		}
		const modeCycleStates = [];
		// Spawns and other explicit fixture setup precede this cycle, not its ownership baseline.
		let modeCycleInitialState = null;
		const ambientOcclusionCycleStates = [];
		const entityShadowCycleStates = [];
		// Explicit fixture setup may introduce the first mapped actor after initial scene capture.
		let entityShadowCycleInitialState = null;
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
			modeCycleInitialState = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
				[],
			);
			for (const mode of ["portal", "flat", "portal", "flat"]) {
				await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setEnvCellRenderMode",
					[mode],
				);
				modeCycleStates.push(await waitForFrameMode(client, mode));
			}
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
		if (options.entityShadowCycle) {
			entityShadowCycleInitialState = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
				[],
			);
			const initialOutdoorTargets =
				entityShadowCycleInitialState.entityShadowResources?.outdoorTargets;
			if (!initialOutdoorTargets || initialOutdoorTargets.activeBytes <= 0) {
				throw new Error(
					"Entity-shadow cycle requires an initial frame with active outdoor shadow targets.",
				);
			}
			for (const mode of ["none", "simple"]) {
				await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setEntityShadowMode",
					[mode],
				);
				entityShadowCycleStates.push(
					await waitForEntityShadowTargets(client, {
						active: false,
						description: `${mode} mode`,
						mode,
					}),
				);
			}
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setEntityShadowMode",
				["shadow-maps"],
			);
			entityShadowCycleStates.push(
				await waitForEntityShadowTargets(client, {
					active: true,
					description: "shadow-map re-enable",
					minimumAllocatedGenerationCount:
						initialOutdoorTargets.allocatedGenerationCount + 1,
					mode: "shadow-maps",
					resolution: initialOutdoorTargets.resolution,
				}),
			);
			const enabledState = entityShadowCycleStates[2];
			const originalSettings = enabledState.frameSettings.entityShadows;
			const alternateResolution =
				originalSettings.pssm.mapResolution === 256 ? 512 : 256;
			for (const [description, settings] of [
				[
					"shadow-map resize",
					{
						...originalSettings,
						pssm: {
							...originalSettings.pssm,
							mapResolution: alternateResolution,
						},
					},
				],
				["shadow-map restore", originalSettings],
			]) {
				const previousTargets =
					entityShadowCycleStates.at(-1).entityShadowResources.outdoorTargets;
				await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setEntityShadowSettings",
					[settings],
				);
				entityShadowCycleStates.push(
					await waitForEntityShadowTargets(client, {
						active: true,
						description,
						minimumAllocatedGenerationCount:
							previousTargets.allocatedGenerationCount + 1,
						mode: "shadow-maps",
						resolution: settings.pssm.mapResolution,
					}),
				);
			}
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
		let portalTransitionLifecycle = null;
		if (options.portalTransitionLifecycleFixture) {
			portalTransitionLifecycle = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.probePortalTransitionLifecycle",
				[],
			);
		}
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
				profiles: state.profiles,
				sceneInterest: state.sceneInterest,
				sourceBatches: summarizeSourceBatches(state.sourceBatches),
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
		if (!options.showRetailHiddenGeometry) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setShowRetailHiddenGeometry",
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
		const entityShadowBenchmark =
			options.entityShadowBenchmarkPairs > 0
				? await runEntityShadowBenchmark(
						client,
						options.entityShadowBenchmarkPairs,
						options.measureMs,
					)
				: null;
		const nameplateBenchmark =
			options.nameplateBenchmarkPairs > 0
				? await runNameplateBenchmark(
						client,
						options.nameplateBenchmarkPairs,
						options.measureMs,
					)
				: null;
		const objectPreviewBenchmark =
			options.objectPreviewBenchmarkPairs > 0
				? await runObjectPreviewBenchmark(
						client,
						options.objectPreviewBenchmarkPairs,
						options.measureMs,
						spawnedEntity?.identity.guid ?? null,
					)
				: null;
		if (options.traceTerrainGl) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.resetTerrainGlTrace",
				[],
			);
		}
		let portalTraversalSurvey = null;
		if (process.env.HOLTBURGER_PROBE_PORTAL_SURVEY === "1") {
			if (
				process.env.HOLTBURGER_PROBE_PORTAL_TRAVERSAL !== "1" ||
				options.envCellCameraId === null
			)
				throw new Error(
					"Portal survey requires the traversal probe and an EnvCell camera.",
				);
			const surveyCamera = await evaluateExpression(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state().camera",
			);
			const surveyInput = {
				cell: options.envCellCameraId,
				position: surveyCamera.position,
				yaw: options.cameraYawDegrees,
				pitch: options.cameraPitchDegrees,
			};
			portalTraversalSurvey = await evaluateExpression(
				client,
				`(async () => {
				const input = ${JSON.stringify(surveyInput)};
				const api = globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__;
				const module = await import('/src/harness/browser/portal-traversal-investigation.ts');
				const segments = module.portalTransitionProbeSegments();
				const poses = [];
				for (const pitch of [-30, 0, 30])
					for (let angle = 0; angle < 360; angle += pitch === 0 ? 5 : 15)
						poses.push({position: input.position, yaw: input.yaw + angle, pitch});
				for (const dx of [-0.15, 0, 0.15])
					for (const dz of [-0.15, 0, 0.15]) {
						if (dx === 0 && dz === 0) continue;
						for (const yaw of [input.yaw, input.yaw + 90])
							poses.push({position: [input.position[0] + dx, input.position[1], input.position[2] + dz], yaw, pitch: 0});
					}
				const skippedTransitions = [];
				for (const segment of segments) {
					const steps = Array.from({length: 9}, (_,i) => {
						const distance = (4-i)*0.025;
						return {cell: i <= 4 ? segment.source : segment.target, position: segment.center.map((value,axis)=>value+segment.normal[axis]*distance), yaw: input.yaw, pitch: 0};
					});
					if (steps.every(pose=>api.portalProbeContainsPoint(pose.cell,pose.position) === true)) poses.push(...steps);
					else skippedTransitions.push(segment);
				}
				const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
				const reports = [];
				try {
					for (const pose of poses) {
						api.setEnvCellCamera(pose.cell ?? input.cell, pose.position, pose.yaw, pose.pitch);
						await settle();
						const report = module.runPortalTraversalInvestigation();
						const metrics = api.state().metrics;
						if (metrics === null) throw new Error('Portal survey has no renderer metrics.');
						reports.push({pose, ...report, gpuFrontierRetreatCount: metrics.portalFrontierRetreatCount, renderedTruncatedViewCount: metrics.portalTruncatedViewCount});
					}
				} finally {
					api.setEnvCellCamera(input.cell, input.position, input.yaw, input.pitch);
					await settle();
				}
				return {reports, skippedTransitions};
			})()`,
			);
		}
		let cpuProfile = null;
		let measuredFrameThroughput = null;
		await startCpuProfile();
		if (options.measureMs > 0) {
			const measurementStart = await evaluateExpression(
				client,
				`(() => {
				globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.resetTiming();
				return performance.now();
			})()`,
			);
			await delay(options.measureMs);
			measuredFrameThroughput = await evaluateExpression(
				client,
				`(() => {
				const elapsedMs = performance.now() - ${measurementStart};
				const frames = globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state().timing.sampleCount;
				return {elapsedMs, frames, framesPerSecond: frames * 1000 / elapsedMs};
			})()`,
			);
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

		const portalTraversalInvestigation =
			process.env.HOLTBURGER_PROBE_PORTAL_TRAVERSAL === "1"
				? await evaluateExpression(
						client,
						`import('/src/harness/browser/portal-traversal-investigation.ts').then(module => module.runPortalTraversalInvestigation())`,
					)
				: null;
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
		const bakedDrawMergeCensus = options.mergeCensus
			? await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.captureBakedDrawMergeCensus",
					[],
				)
			: null;
		const state = await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
			[],
		);
		// Drawn after the scene settles and immediately before capture, so the screenshot and the
		// reported map state describe the same moment.
		const mapEvidence = options.map
			? await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.configureMap",
					[
						{
							centerX: options.mapCenter?.worldX,
							centerY: options.mapCenterHeight ?? undefined,
							centerZ: options.mapCenter?.worldZ,
							size: options.mapSize,
							viewDiameter: options.mapViewDiameter ?? undefined,
						},
					],
				)
			: null;
		const uiTheme = options.uiTheme
			? await probeUiTheme(client, evaluateExpression, async (name, png) => {
					if (options.screenshotPath)
						await writeFile(
							`${options.screenshotPath}.${name}.png`,
							Buffer.from(png, "base64"),
						);
				})
			: null;
		const screenshot = portalScreenshot
			? { data: portalScreenshot }
			: await client.send("Page.captureScreenshot", {
					captureBeyondViewport: false,
					format: "png",
				});
		if (entityPopulation !== null) {
			entityPopulation.retiredCount = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.despawnExplorerEntityFleet",
				[],
			);
			await delay(400);
			entityPopulation.teardownState = summarizeEntityRuntimeState(
				await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
					[],
				),
			);
		}
		let despawnedEntityState = null;
		if (spawnedEntity !== null) {
			const stillLive = state.spawnedEntities.some(
				(entity) =>
					entity.identity.guid === spawnedEntity.identity.guid &&
					entity.generation === spawnedEntity.generation,
			);
			if (stillLive) {
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
			} else {
				despawnedEntityState = state;
			}
		}
		return {
			bakedDrawMergeCensus,
			cpuProfile,
			ambientOcclusionCycleStates,
			entityShadowCycleStates,
			entityShadowCycleInitialState,
			entityShadowBenchmark,
			nameplateBenchmark,
			objectPreviewBenchmark,
			audioFlyby,
			cameraSweepScreenshots,
			map: mapEvidence,
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
			spawnedSelection,
			objectPreview,
			generatedDisabledState,
			initialState,
			nameplateWorkload,
			nameplateLifecycle,
			appearanceReplacement,
			dynamicViews,
			dynamicBlendFlags,
			dynamicDomains,

			measuredFrameThroughput,
			portalTraversalSurvey,
			portalTraversalInvestigation,
			materialTableProbe:
				process.env.HOLTBURGER_PROBE_MATERIAL_TABLES === "1"
					? await evaluate(
							client,
							`async () => (await import('/src/harness/browser/dynamic-material-table-probe.ts')).probeDynamicMaterialTables()`,
							[],
						)
					: null,
			filteringCycleStates,
			modeCycleStates,
			modeCycleInitialState,
			lifecycleState,
			portalExecution,
			portalTransitionLifecycle,
			possessionScenario,
			followFlight,
			relocationSequence,
			relocationState,
			uiTheme,
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

/**
 * Preserve only the evidence needed to compare paired shadow windows.
 *
 * Keeping this diagnostic compact matters because a complete harness state contains the authored
 * resident census and static layer payloads, which obscure timing results without strengthening
 * the workload proof.
 */
function entityShadowBenchmarkSample(state, pairIndex, orderIndex, mode) {
	return {
		pairIndex,
		orderIndex,
		mode,
		timing: state.timing,
		frameProfile: state.frameProfile,
		tickProfile: state.tickProfile,
		effectiveSettings: state.frameSettings.entityShadows,
		resources: state.entityShadowResources,
		outdoorPssm: state.outdoorPssm,
		selectionMetrics: state.metrics,
		workload: {
			authoredDynamicResidentCount:
				state.authoredDynamics?.residents.length ?? null,
			spawnedEntityCount: state.spawnedEntities?.length ?? null,
			staticObjectNodeCount: state.staticObjects?.staticObjectNodeCount ?? null,
			geometryResourceCount: state.staticObjects?.geometryResourceCount ?? null,
		},
	};
}

/** Measure paired policies inside one settled browser session, reversing order every pair. */
async function runEntityShadowBenchmark(client, pairCount, measureMs) {
	const samples = [];
	for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
		const modes =
			pairIndex % 2 === 0 ? ["none", "shadow-maps"] : ["shadow-maps", "none"];
		for (let orderIndex = 0; orderIndex < modes.length; orderIndex += 1) {
			const mode = modes[orderIndex];
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setEntityShadowMode",
				[mode],
			);
			await delay(ENTITY_SHADOW_BENCHMARK_WARMUP_MS);
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.resetTiming",
				[],
			);
			await delay(measureMs);
			const state = await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
				[],
			);
			samples.push(
				entityShadowBenchmarkSample(state, pairIndex, orderIndex, mode),
			);
		}
	}

	// The existing final measurement window owns native CPU profiling. Leave it in the policy whose
	// cost is under investigation so --cpu-profile produces directly relevant evidence.
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setEntityShadowMode",
		["shadow-maps"],
	);
	await delay(ENTITY_SHADOW_BENCHMARK_WARMUP_MS);
	return {
		measureMs,
		pairCount,
		warmupMs: ENTITY_SHADOW_BENCHMARK_WARMUP_MS,
		samples,
	};
}

/** Measure paired closed/open preview windows while keeping scene/content identity fixed. */
async function runObjectPreviewBenchmark(client, pairCount, measureMs, guid) {
	if (guid === null)
		throw new Error("Object preview benchmark has no spawned entity GUID.");
	const samples = [];
	try {
		for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
			const visibilityOrder =
				pairIndex % 2 === 0 ? [false, true] : [true, false];
			for (
				let orderIndex = 0;
				orderIndex < visibilityOrder.length;
				orderIndex += 1
			) {
				const visible = visibilityOrder[orderIndex];
				await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setObjectPreviewBenchmarkVisible",
					[guid, visible],
				);
				await delay(OBJECT_PREVIEW_BENCHMARK_WARMUP_MS);
				await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.resetTiming",
					[],
				);
				const previewBefore = await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.objectPreviewDiagnostics",
					[],
				);
				await delay(measureMs);
				const previewAfter = await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.objectPreviewDiagnostics",
					[],
				);
				const state = await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
					[],
				);
				const cpuProfile = state.frameProfile?.cpu ?? null;
				const gpuProfile = state.frameProfile?.gpu ?? null;
				samples.push({
					pairIndex,
					orderIndex,
					visible,
					previewFramesPerSecond:
						previewBefore === null || previewAfter === null
							? null
							: ((previewAfter.frameCount - previewBefore.frameCount) * 1000) /
								measureMs,
					previewDiagnostics: previewAfter,
					timing: state.timing,
					rendererCpu: {
						meanTotalMs: cpuProfile?.mean.totalMs ?? null,
						p95RecentTotalMs: cpuProfile?.p95RecentTotalMs ?? null,
						sampleCount: cpuProfile?.sampleCount ?? 0,
					},
					gpu: {
						kind: gpuProfile?.kind ?? "unavailable",
						meanTotalMs: gpuProfile?.mean?.totalMs ?? null,
						meanPresentationMs: gpuProfile?.mean?.presentationMs ?? null,
						sampleCount: gpuProfile?.sampleCount ?? 0,
					},
					metrics: objectPreviewBenchmarkMetrics(state.metrics),
				});
			}
		}
	} finally {
		await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setObjectPreviewBenchmarkVisible",
			[guid, false],
		);
		await delay(OBJECT_PREVIEW_BENCHMARK_WARMUP_MS);
	}
	return {
		measureMs,
		pairCount,
		warmupMs: OBJECT_PREVIEW_BENCHMARK_WARMUP_MS,
		samples,
	};
}

/** Keep only per-frame draw/upload and preview-target facts needed by the paired comparison. */
function objectPreviewBenchmarkMetrics(metrics) {
	if (metrics === null) return null;
	return {
		flatSceneFramebufferCount: metrics.flatSceneFramebufferCount,
		flatSceneTargetBytes: metrics.flatSceneTargetBytes,
		objectDrawCalls: metrics.objectDrawCalls,
		objectLightingBinds: metrics.objectLightingBinds,
		objectProgramChanges: metrics.objectProgramChanges,
		objectSuppressedUniformUploads: metrics.objectSuppressedUniformUploads,
		objectTextureBinds: metrics.objectTextureBinds,
		objectUniformUploads: metrics.objectUniformUploads,
		submittedDynamicDrawCount: metrics.submittedDynamicDrawCount,
		submittedParticleBatchCount: metrics.submittedParticleBatchCount,
		submittedParticleInstanceCount: metrics.submittedParticleInstanceCount,
		submittedTransparentObjectDrawCount:
			metrics.submittedTransparentObjectDrawCount,
		unresolvedParticleBatchCount: metrics.unresolvedParticleBatchCount,
		uploadedParticleRecordRowCount: metrics.uploadedParticleRecordRowCount,
	};
}

/** Measure paired nameplate budgets inside one settled browser session, reversing order by pair. */
async function runNameplateBenchmark(client, pairCount, measureMs) {
	const samples = [];
	const initialState = await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
		[],
	);
	const previousMaximumVisible =
		initialState.frameSettings.nameplates.maximumVisible;
	try {
		for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
			const maximumVisibleValues =
				pairIndex % 2 === 0
					? [0, NAMEPLATE_BENCHMARK_VISIBLE_LIMIT]
					: [NAMEPLATE_BENCHMARK_VISIBLE_LIMIT, 0];
			for (
				let orderIndex = 0;
				orderIndex < maximumVisibleValues.length;
				orderIndex += 1
			) {
				const maximumVisible = maximumVisibleValues[orderIndex];
				await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setNameplateMaximumVisible",
					[maximumVisible],
				);
				await delay(NAMEPLATE_BENCHMARK_WARMUP_MS);
				await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.resetTiming",
					[],
				);
				await delay(measureMs);
				const state = await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
					[],
				);
				const cpuProfile = state.frameProfile?.cpu ?? null;
				const gpuProfile = state.frameProfile?.gpu ?? null;
				samples.push({
					pairIndex,
					orderIndex,
					maximumVisible,
					timing: {
						averageRenderMs: state.timing.averageRenderMs,
						longestRenderMs: state.timing.longestRenderMs,
						sampleCount: state.timing.sampleCount,
					},
					rendererCpu: {
						meanTotalMs: cpuProfile?.mean.totalMs ?? null,
						p95RecentTotalMs: cpuProfile?.p95RecentTotalMs ?? null,
						meanSceneContributionResolutionMs:
							cpuProfile?.mean.sceneContributionResolutionMs ?? null,
						meanOtherMs: cpuProfile?.mean.otherMs ?? null,
						sampleCount: cpuProfile?.sampleCount ?? 0,
					},
					gpu: {
						kind: gpuProfile?.kind ?? "unavailable",
						meanTotalMs: gpuProfile?.mean?.totalMs ?? null,
						meanPresentationMs: gpuProfile?.mean?.presentationMs ?? null,
						sampleCount: gpuProfile?.sampleCount ?? 0,
					},
					nameplates: state.nameplates,
				});
			}
		}
	} finally {
		await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.setNameplateMaximumVisible",
			[previousMaximumVisible],
		);
		await delay(NAMEPLATE_BENCHMARK_WARMUP_MS);
	}
	return {
		measureMs,
		pairCount,
		warmupMs: NAMEPLATE_BENCHMARK_WARMUP_MS,
		samples,
	};
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

async function waitForClientHudHarnessApi(client) {
	const startedAt = Date.now();
	for (;;) {
		if (
			await evaluateExpression(
				client,
				"Boolean(globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__)",
			)
		)
			return;
		if (Date.now() - startedAt >= 60_000) {
			throw new Error(
				`Timed out waiting for client HUD harness API: ${JSON.stringify(await evaluateExpression(client, "({ text: document.body.innerText, title: document.title })"))}`,
			);
		}
		await delay(100);
	}
}

/** Wait only when the resolved demand actually contains EnvCells (including cold dungeons). */
async function waitForRequiredEnvCellPublication(client) {
	const state = await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
		[],
	);
	const requiredLandblockIds =
		state.sceneInterest?.interest
			?.filter(({ layers }) => layers.includes("env-cells"))
			.map(({ landblockId }) => landblockId.toLowerCase()) ?? [];
	if (requiredLandblockIds.length === 0) return;
	await waitForEnvCellPublications(client, requiredLandblockIds);
}

async function waitForEnvCellPublications(client, requiredLandblockIds) {
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
		const residentLandblockIds = new Set(
			state.staticObjects?.envCellLayers.map(({ landblockId }) =>
				landblockId.toLowerCase(),
			) ?? [],
		);
		if (
			requiredLandblockIds.every((landblockId) =>
				residentLandblockIds.has(landblockId),
			)
		)
			return;
		await delay(100);
	}
	throw new Error(
		`Timed out awaiting EnvCell publication for required owners ${requiredLandblockIds.join(", ")}.`,
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

/** Wait until a rendered frame, rather than only frontend settings, realizes shadow ownership. */
async function waitForEntityShadowTargets(
	client,
	{
		active,
		description,
		minimumAllocatedGenerationCount = 0,
		mode,
		resolution = null,
	},
) {
	const timeoutAt = Date.now() + 30_000;
	while (Date.now() < timeoutAt) {
		const state = await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_BROWSER_HARNESS__.state",
			[],
		);
		if (state.error) {
			throw new Error(
				`Browser harness failed while awaiting ${description}: ${state.error}`,
			);
		}
		const targets = state.entityShadowResources?.outdoorTargets;
		const hasExpectedActivity = active
			? targets?.activeBytes > 0 &&
				targets.activeFramebufferCount === 1 &&
				targets.activeTextureCount === 1
			: targets?.activeBytes === 0 &&
				targets.activeFramebufferCount === 0 &&
				targets.activeTextureCount === 0;
		if (
			state.frameSettings?.entityShadows?.mode === mode &&
			hasExpectedActivity &&
			targets.allocatedGenerationCount >= minimumAllocatedGenerationCount &&
			(resolution === null || targets.resolution === resolution)
		)
			return state;
		await delay(50);
	}
	throw new Error(
		`Browser harness renderer did not realize ${description} within 30 seconds.`,
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

/** Production image decoding, Canvas2D rendering, retained-window ownership, and failure outcomes. */
async function probeWorldMap(client, consoleMessages, browserWebSocketUrl) {
	const browser = await createCdpClient(browserWebSocketUrl);
	let hardware;
	try {
		hardware = (await browser.send("SystemInfo.getInfo")).gpu.devices;
	} finally {
		browser.close();
	}
	const measureMemory = async () => {
		const browser = await createCdpClient(browserWebSocketUrl);
		try {
			const { processInfo } = await browser.send("SystemInfo.getProcessInfo");
			if (process.platform !== "linux")
				return { platform: process.platform, processes: processInfo };
			const processes = await Promise.all(
				processInfo.map(async (info) => {
					const status = await readFile(`/proc/${info.id}/status`, "utf8");
					const rss = status.match(/^VmRSS:\s+(\d+) kB$/m);
					if (!rss)
						throw new Error(`Chrome process ${info.id} has no RSS status.`);
					return { id: info.id, type: info.type, rssKiB: Number(rss[1]) };
				}),
			);
			return { platform: process.platform, processes };
		} finally {
			browser.close();
		}
	};
	const openingMemory = await measureMemory();
	const api = "globalThis.__HOLTBURGER_WORLD_MAP_HARNESS__";
	const until = async (kind) => {
		const deadline = Date.now() + 120000;
		while (Date.now() < deadline) {
			const value = await evaluateExpression(client, `${api}?.read()`);
			if (value?.kind === kind) return value;
			if (value?.kind === "unavailable" || value?.kind === "load-failed")
				throw new Error(JSON.stringify(value));
			await delay(100);
		}
		throw new Error(`World map never reached ${kind}.`);
	};
	const partialDeadline = Date.now() + 120000;
	let partial;
	while (Date.now() < partialDeadline) {
		partial = await evaluateExpression(client, `${api}?.read()`);
		if (partial?.image?.appliedTiles > 0) break;
		if (partial?.diagnostic) throw new Error(JSON.stringify(partial));
		await delay(20);
	}
	if (partial?.kind !== "streaming" || partial.image.appliedTiles >= 256)
		throw new Error("Cold image did not become usable progressively.");
	const streamingSettlements = await evaluateExpression(
		client,
		`${api}.settlementProbe()`,
	);
	if (streamingSettlements.kind !== "streaming")
		throw new Error(
			"Settlement overlay was not exercised during tile streaming.",
		);
	const coldContent = await evaluateExpression(client, `${api}.contentProbe()`);
	const streamingTeleport = await evaluateExpression(
		client,
		`${api}.teleportProbe()`,
	);
	if (streamingTeleport.kind !== "streaming")
		throw new Error("Map click was not exercised during streaming.");
	await evaluateExpression(client, `${api}.pan()`);
	const partialScreenshot = (
		await client.send("Page.captureScreenshot", { format: "png" })
	).data;
	const initial = await until("ready");
	const controls = await evaluateExpression(client, `${api}.controlsProbe()`);
	const readyTeleport = await evaluateExpression(
		client,
		`${api}.teleportProbe()`,
	);
	const readySettlements = await evaluateExpression(
		client,
		`${api}.settlementProbe()`,
	);
	const markerProjection = await evaluateExpression(
		client,
		`${api}.markerProjectionProbe()`,
	);
	await evaluateExpression(client, `${api}.fit()`);
	const fitted = await evaluateExpression(client, `${api}.read()`);
	const readyMemory = await measureMemory();
	const warmContent = await evaluateExpression(client, `${api}.contentProbe()`);
	if (
		initial.image.appliedTiles !== 256 ||
		initial.transferredBytes !== 2048 ** 2 * 4
	)
		throw new Error("World-map stream did not install the complete image.");
	// Check focus release and fit-view preservation before switching to a closer projection.
	await evaluateExpression(
		client,
		`document.querySelector('section.hud-window[aria-label="World"] button').focus(); true`,
	);
	await evaluateExpression(client, `${api}.visibility(false)`);
	await delay(100);
	const hiddenFit = await evaluateExpression(client, `${api}.read()`);
	const retainedFocus = await evaluateExpression(
		client,
		`document.querySelector('section.hud-window[aria-label="World"]').contains(document.activeElement)`,
	);
	if (
		retainedFocus ||
		JSON.stringify(hiddenFit.view) !== JSON.stringify(fitted.view)
	)
		throw new Error(
			"Hiding the World window retained focus or changed its view.",
		);
	await evaluateExpression(client, `${api}.visibility(true)`);

	const wholeWorld = await evaluateExpression(
		client,
		`${api}.benchmark(${initial.view.spanMeters})`,
	);
	const overview = (
		await client.send("Page.captureScreenshot", { format: "png" })
	).data;
	const zoomLatency = await evaluateExpression(
		client,
		`${api}.benchmarkZoomLatency()`,
	);
	const closeUp = await evaluateExpression(client, `${api}.benchmark(768)`);
	await evaluateExpression(client, `${api}.pan()`);
	const canvasIdentity = await evaluateExpression(
		client,
		`globalThis.__retainedMapCanvas = document.querySelector('canvas[aria-label="World terrain map"]'); true`,
	);
	if (!canvasIdentity) throw new Error("Map canvas missing.");
	await evaluateExpression(client, `${api}.visibility(false)`);
	await client.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Escape",
		code: "Escape",
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Escape",
		code: "Escape",
	});
	const hidden = await evaluateExpression(client, `${api}.read()`);
	if (hidden.closeCount !== 0 || hidden.visible)
		throw new Error("Hidden World window participated in Escape.");
	await evaluateExpression(client, `${api}.visibility(true)`);
	const retained = await evaluateExpression(
		client,
		`globalThis.__retainedMapCanvas === document.querySelector('canvas[aria-label="World terrain map"]')`,
	);
	const reopened = await evaluateExpression(client, `${api}.read()`);
	if (
		!retained ||
		reopened.opens !== initial.opens ||
		reopened.tileReads !== initial.tileReads
	)
		throw new Error("Map reopening requested data or replaced its canvas.");
	await client.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Escape",
		code: "Escape",
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Escape",
		code: "Escape",
	});
	await delay(100);
	const escaped = await evaluateExpression(client, `${api}.read()`);
	if (escaped.visible || escaped.closeCount !== 1)
		throw new Error("Visible World window did not close with Escape.");
	await evaluateExpression(client, `${api}.visibility(true)`);
	const screenshot = (
		await client.send("Page.captureScreenshot", { format: "png" })
	).data;
	await evaluateExpression(client, `${api}.loseContext()`);
	await delay(100);
	const lost = await evaluateExpression(client, `${api}.read()`);
	if (lost.kind !== "load-failed")
		throw new Error("Canvas contents loss was not retryable.");
	await evaluateExpression(client, `${api}.retry()`);
	await until("ready");
	await evaluateExpression(client, `${api}.retryFixture()`);
	const failed = await evaluateExpression(client, `${api}.read()`);
	if (failed.kind !== "load-failed")
		throw new Error("Injected load failure was not retryable.");
	await evaluateExpression(client, `${api}.retry()`);
	const retried = await until("ready");
	const disposed = await evaluateExpression(client, `${api}.dispose()`);
	if (disposed !== "disposed")
		throw new Error("Owner teardown did not dispose resources.");
	return {
		state: {
			error: null,
			ready: true,
			viewport: {
				width: options.viewportWidth,
				height: options.viewportHeight,
			},
		},
		cameraSweepScreenshots: {
			"whole-world": overview,
			partial: partialScreenshot,
		},
		partial,
		markerProjection,
		controls,
		settlements: { streaming: streamingSettlements, ready: readySettlements },
		teleport: { streaming: streamingTeleport, ready: readyTeleport },
		hardware,
		memory: { opening: openingMemory, ready: readyMemory },
		contention: { duringGeneration: coldContent, afterGeneration: warmContent },
		initial,
		wholeWorld,
		closeUp,
		zoomLatency,
		reopened,
		lost,
		failed,
		retried,
		disposed,
		screenshot,
		consoleMessages,
	};
}

/** The actual client shell owns first activation, panel switching, and retained placement. */
async function probeClientHousing(client) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.housingProbe";
	const read = (expression) => evaluateExpression(client, expression);
	const settle = () => read(`${api}.settle()`);
	const windowSelector = 'section.hud-window[aria-label="Cottage crystal"]';
	const verifyPaymentFooter = async () => {
		if (
			!(await read(`(() => {
			const panel = document.querySelector('${windowSelector} .house-crystal-panel');
			const button = panel.querySelector('footer .housing-pay');
			if (!button || !['Buy house', 'Pay maintenance'].includes(button.textContent.trim())) return false;
			const bounds = panel.getBoundingClientRect();
			const action = button.getBoundingClientRect();
			const style = getComputedStyle(panel);
			return Math.abs(bounds.right - parseFloat(style.paddingRight) - action.right) < 1
				&& Math.abs(bounds.bottom - parseFloat(style.paddingBottom) - action.bottom) < 1
				&& !panel.textContent.includes('Checking payment');
		})()`))
		)
			throw new Error(
				"Housing payment action is not anchored at the lower right.",
			);
	};
	const verifyPaymentArtwork = async () => {
		const contained = await read(`(() => {
			const rows = [...document.querySelectorAll('${windowSelector} .housing-requirement-row')];
			return rows.length > 0 && rows.every(row => {
				const cell = row.querySelector('.item-grid-cell');
				const image = cell?.querySelector('img.ui-icon');
				if (!cell) return false;
				const bounds = cell.getBoundingClientRect();
				if (bounds.width <= 0 || bounds.height <= 0) return false;
				if (cell.dataset.empty === 'true') {
					if (!image) return cell.childElementCount === 0;
					const style = getComputedStyle(cell.querySelector('.item-cell-art'));
					if (style.filter !== 'grayscale(1)' || parseFloat(style.opacity) >= 1) return false;
				}
				if (!image) return false;
				const art = image.getBoundingClientRect();
				return bounds.width > 0 && bounds.height > 0 && art.width > 0 && art.height > 0
					&& art.left >= bounds.left - 1 && art.top >= bounds.top - 1
					&& art.right <= bounds.right + 1 && art.bottom <= bounds.bottom + 1;
			});
		})()`);
		if (!contained)
			throw new Error(
				"Housing payment artwork escaped its inventory item cell.",
			);
	};
	await read(`${api}.begin("empty")`);
	await settle();
	await read(`${api}.reply()`);
	await settle();
	const verifyUnownedPaymentHints = async (count) => {
		if (
			!(await read(
				`document.querySelectorAll('${windowSelector} .item-grid-cell[data-empty="true"] img.ui-icon').length === ${count}`,
			))
		)
			throw new Error(
				"Unowned Pyreal/Writ requirements have no reference artwork.",
			);
		await verifyPaymentArtwork();
	};
	await verifyUnownedPaymentHints(2);
	await read(`${api}.profile('other',false,false,true)`);
	await settle();
	await read(`${api}.reply()`);
	await settle();
	await verifyUnownedPaymentHints(1);
	await read(`${api}.begin("single")`);
	await settle();
	await read(`${api}.reply()`);
	await settle();
	if (
		!(await read(
			`document.querySelector('${windowSelector}')?.textContent.replace(/\\s+/g, " ").includes('Available for purchase')`,
		))
	)
		throw new Error(
			"Ordinary housing profile did not open the purchase HUD: " +
				JSON.stringify(
					await read(
						`({window: document.querySelector('${windowSelector}')?.textContent, panels: [...document.querySelectorAll('section.hud-window')].map(panel => panel.getAttribute('aria-label'))})`,
					),
				),
		);
	await verifyPaymentFooter();
	if (
		!(await read(
			`document.querySelector('${windowSelector} .ui-tabs .ui-tab[aria-selected="true"]') !== null && document.querySelector('${windowSelector} .housing-requirement-cell .item-grid-cell[data-empty="true"] img.ui-icon') !== null`,
		))
	)
		throw new Error(
			"The empty payment row did not use shared tabs and desired-item artwork.",
		);
	if (
		!(await read(`(() => {
		const cell = document.querySelector('${windowSelector} .item-grid-cell[data-empty="true"]');
		const style = getComputedStyle(cell);
		const artStyle = getComputedStyle(cell.querySelector('.item-cell-art'));
		return artStyle.filter === 'grayscale(1)' && parseFloat(artStyle.opacity) > 0
			&& parseFloat(artStyle.opacity) < 1 && cell.disabled
			&& parseFloat(style.borderTopWidth) > 0 && style.boxShadow.includes('inset')
			&& style.backgroundColor !== 'rgba(0, 0, 0, 0)';
	})()`))
	)
		throw new Error(
			"Empty payment cell lacks the shared recessed slot styling.",
		);

	await read(
		`document.querySelector('button[aria-label="Inventory"]').click()`,
	);
	await settle();
	const dragPoints = async (points) => {
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			...points.source,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...points.source,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: points.source.x + 20,
			y: points.source.y,
			button: "left",
			buttons: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			...points.target,
			button: "left",
			buttons: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			...points.target,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
	};
	const dragPayment = async (item = "coins", wcid = 273) => {
		const points = await read(`(() => {
		const source=document.querySelector('.contents-scroll .item-grid-cell[data-item-guid="'+${api}[${JSON.stringify(item)}]+'"]');
		const target=document.querySelector('[data-housing-payment][data-housing-wcid="${wcid}"]');
		if (!source || !target) throw new Error('Missing housing drag surfaces');
		source.scrollIntoView({block:'nearest'}); target.scrollIntoView({block:'nearest'});
		const center=node=>{const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};};
		return {source:center(source),target:center(target)};
	})()`);
		await dragPoints(points);
	};
	await dragPayment();
	await settle();
	const manual = await read(`${api}.pending()`);
	if (
		manual.operation.kind !== "add" ||
		manual.operation.wcid !== 273 ||
		manual.operation.item !== (await read(`${api}.coins`)) ||
		manual.draft.items.length !== 0
	)
		throw new Error(
			"Housing drop did not preview the selected physical source.",
		);
	await read(`${api}.reply()`);
	await settle();
	if (
		!(await read(
			`document.querySelector('${windowSelector} [data-housing-progress]').textContent.replace(/\\s+/g, ' ').trim() === '3 / 13'`,
		))
	)
		throw new Error(
			"Manual housing contribution was not displayed from the quote.",
		);
	await verifyPaymentArtwork();
	await read(
		`document.querySelector('${windowSelector} button[aria-label="Auto-fill Pyreal"]').click()`,
	);
	const automatic = await read(`${api}.pending()`);
	if (
		automatic.operation.kind !== "fill" ||
		automatic.operation.wcid !== 273 ||
		JSON.stringify(automatic.draft.items) !==
			JSON.stringify([manual.operation.item])
	)
		throw new Error(
			"Auto-fill lost the manual draft or did not request candidate selection.",
		);
	await read(`${api}.reply()`);
	await settle();
	if (
		!(await read(
			`document.querySelector('${windowSelector} [data-housing-progress]').textContent.replace(/\\s+/g, ' ').trim() === '13 / 13'`,
		))
	)
		throw new Error(
			"Auto-filled sources did not display the complete shared quote.",
		);
	await verifyPaymentArtwork();
	const harness = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const inputSettings = await read(`${harness}.bindingSettings.read()`);
	await read(
		`${harness}.bindingSettings.replace({...${JSON.stringify(inputSettings)}, client: {...${JSON.stringify(inputSettings.client)}, examine: [{key: "F8"}]}})`,
	);
	await read(`${harness}.selectInventoryItem(${api}.note)`);
	await read(
		`document.querySelector('${windowSelector} [data-housing-requirement="273"] button').focus()`,
	);
	for (const type of ["keyDown", "keyUp"])
		await client.send("Input.dispatchKeyEvent", {
			type,
			key: "F8",
			code: "F8",
			windowsVirtualKeyCode: 119,
		});
	const contextualExamine = await read(
		`${harness}.inventoryDragCommands().findLast(entry => entry.command === 'examine_client_entity')`,
	);
	if (contextualExamine?.args?.guid !== manual.operation.item)
		throw new Error("Housing Examine did not capture its requirement source");
	await read(`${harness}.objectInspectionProbe().end()`);
	await read(
		`${harness}.bindingSettings.replace(${JSON.stringify(inputSettings)})`,
	);

	await read(
		`document.querySelector('${windowSelector} [role="tab"][id^="housing-details-"]').click()`,
	);
	await read(`${api}.retained()`);
	await settle();
	if (
		!(await read(
			`document.querySelector('${windowSelector} [role="tab"][id^="housing-details-"]').getAttribute('aria-selected') === 'true'`,
		))
	)
		throw new Error("Retained profile reset the Details selection.");
	if (
		!(await read(`(() => {
		const panel = document.querySelector('${windowSelector} [role="tabpanel"]');
		return panel.querySelector('[aria-label="Eligibility"] dl') !== null
			&& ['Purchase', 'Maintenance'].every(name => {
				const table = panel.querySelector('[aria-label="' + name + ' requirements"] table');
				return table?.querySelector('thead').textContent.includes('Paid / required')
					&& table.querySelector('tbody td').textContent.trim() === '0 / 13';
			});
	})()`))
	)
		throw new Error(
			"Housing Details did not group eligibility and authoritative payment progress.",
		);
	await read(
		`document.querySelector('${windowSelector} [role="tab"][id^="housing-action-"]').click()`,
	);
	await settle();
	const dragRow = async (destination) => {
		const points = await read(`(() => {
            const source = document.querySelector('${windowSelector} [data-housing-payment] .item-grid-cell');
            const target = ${JSON.stringify(destination)} === 'inside' ? source
                : ${JSON.stringify(destination)} === 'inventory'
                    ? document.querySelector('.contents-scroll .item-grid-cell[data-item-guid="'+${api}.coins+'"]')
                    : ${JSON.stringify(destination)} === 'other' ? document.querySelector('[data-housing-wcid="42"] .item-grid-cell')
                    : document.querySelector('.client-canvas');
            if (!source || !target) throw new Error('Missing row drag surfaces');
            source.scrollIntoView({block:'nearest'});
            if (${JSON.stringify(destination)} === 'inventory') target.scrollIntoView({block:'nearest'});
            const center = node => { const r=node.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; };
            return {source:center(source), target:${JSON.stringify(destination)} === 'world'
                ? {x:target.getBoundingClientRect().right-20,y:target.getBoundingClientRect().top+20}
                : center(target)};
        })()`);
		await dragPoints(points);
		await settle();
	};
	const beforeCancel = await read(`${api}.pending()`);
	await dragRow("inside");
	if ((await read(`${api}.pending()`)).sequence !== beforeCancel.sequence)
		throw new Error("Releasing inside a requirement cell changed the draft.");
	for (const destination of ["inventory", "world"]) {
		await dragRow(destination);
		const cleared = await read(`${api}.pending()`);
		if (cleared.operation.kind !== "quote" || cleared.draft.items.length !== 0)
			throw new Error(
				`Dragging a row to ${destination} did not clear only its draft.`,
			);
		await read(`${api}.reply()`);
		await settle();
		await read(
			`document.querySelector('${windowSelector} button[aria-label="Auto-fill Pyreal"]').click()`,
		);
		await read(`${api}.reply()`);
		await settle();
	}

	const commands = await read(`${api}.commands()`);
	if (commands.some((entry) => entry.command.startsWith("submit_")))
		throw new Error(
			"Preparing housing payment dispatched an inventory transfer or payment.",
		);
	await read(
		`[...document.querySelectorAll('${windowSelector} button')].find(button=>button.textContent.trim()==='Buy house').click()`,
	);
	await settle();
	const submitted = await read(`${api}.submitted()`);
	if (
		JSON.stringify(submitted.draft.items) !==
			JSON.stringify([await read(`${api}.coins`), await read(`${api}.note`)]) ||
		!submitted.quote.complete
	)
		throw new Error(
			"Submission did not preserve current source identities and consumption.",
		);
	await read(`${api}.accept()`);
	await settle();
	if (
		!(await read(
			`document.querySelector('${windowSelector}').textContent.replace(/\\s+/g, " ").includes('Waiting for housing payment') && [...document.querySelectorAll('${windowSelector} .housing-payment-actions button')].every(button=>button.disabled)`,
		))
	)
		throw new Error(
			"Submitted housing payment did not block another draft or payment.",
		);
	await read(
		`document.querySelector('${windowSelector} button[aria-label="Close Cottage crystal"]').click()`,
	);
	await settle();
	await read(`${api}.retained()`);
	await settle();
	if (await read(`Boolean(document.querySelector('${windowSelector}'))`))
		throw new Error(
			"Retained housing facts reopened a dismissed crystal window.",
		);
	await read(`${api}.finish('unresolved')`);
	await settle();
	if (
		!(await read(
			`[...document.querySelectorAll('.client-toast')].some(node=>node.textContent.replace(/\\s+/g, " ").includes('Housing payment could not be confirmed'))`,
		))
	)
		throw new Error(
			"Dismissed housing execution did not surface its uncertainty through a toast.",
		);
	const paymentCommands = await read(`${api}.commands()`);
	if (
		paymentCommands.filter(
			(entry) => entry.command === "submit_client_housing_payment",
		).length !== 1 ||
		paymentCommands.some((entry) => entry.command === "submit_client_inventory")
	)
		throw new Error(
			"Housing confirmation sent duplicate payment or a premature inventory transfer.",
		);
	const variants = [];
	for (const [ownership, free, paid, active, expected] of [
		["character", false, false, true, "Owned by you"],
		["account", false, false, true, "Owned by your account"],
		["other", true, false, true, "Maintenance is free this period."],
		["other", false, true, true, "Maintenance is paid."],
		["available", false, false, false, "This dwelling is disabled."],
	]) {
		await read(
			`${api}.profile(${JSON.stringify(ownership)},${free},${paid},${active})`,
		);
		await settle();
		const text = await read(
			`document.querySelector('${windowSelector}').textContent`,
		);
		if (!text.replace(/\s+/g, " ").includes(expected))
			throw new Error(`Missing crystal variant: ${expected}`);
		variants.push(expected);
	}
	await read(`${api}.profile('other',false,false,true)`);
	await settle();
	await read(`${api}.reply()`);
	await settle();
	await dragPayment();
	await settle();
	await read(`${api}.reply()`);
	await settle();
	await read(
		`[...document.querySelectorAll('${windowSelector} button')].find(button=>button.textContent.trim()==='Pay maintenance').click()`,
	);
	await settle();
	const maintenance = await read(`${api}.submitted()`);
	await verifyPaymentFooter();
	if (
		maintenance.draft.purpose !== "maintenance" ||
		maintenance.quote.complete ||
		!maintenance.quote.contributes
	)
		throw new Error(
			"Partial maintenance submission was blocked or replaced by full payment.",
		);
	await read(`${api}.finish('completed')`);
	await settle();
	if (
		!(await read(
			`document.querySelector('${windowSelector}').querySelectorAll('.housing-requirement-row .item-grid-cell[data-empty="true"] img.ui-icon').length === 1 && !document.querySelector('${windowSelector}').textContent.replace(/\\s+/g, " ").includes('Maintenance is paid.')`,
		))
	)
		throw new Error(
			"Completed contribution did not retire the draft while retaining unpaid maintenance.",
		);
	await read(`${api}.begin("multiple")`);
	await settle();
	await read(`${api}.reply()`);
	await settle();
	if (
		!(await read(
			`document.querySelector('.contents-scroll .item-grid-cell[data-item-guid="'+${api}.coins+'"]') !== null`,
		))
	)
		await read(
			`document.querySelector('button[aria-label="Inventory"]').click()`,
		);
	await settle();
	await dragPayment("coins", 273);
	await read(`${api}.reply()`);
	await settle();
	await dragPayment("writSmall", 42);
	await read(`${api}.reply()`);
	await settle();
	await read(
		`document.querySelector('${windowSelector} button[aria-label="Auto-fill Writ"]').click()`,
	);
	await read(`${api}.reply()`);
	await settle();
	const isolated = await read(`(() => {
        const rows = [...document.querySelectorAll('${windowSelector} .housing-requirement-row')];
        return rows.map(row => ({wcid:Number(row.dataset.housingRequirement), text:row.textContent.replace(/\\s+/g,' '), progress:Number(row.querySelector('[data-housing-progress]').dataset.housingProgress), prepared:Number(row.querySelector('[data-housing-progress]').dataset.housingPrepared)}));
    })()`);
	if (
		isolated.length !== 2 ||
		isolated[0].progress !== 3 ||
		isolated[1].progress !== 4 ||
		isolated[0].prepared !== 3 ||
		isolated[1].prepared !== 3
	)
		throw new Error(
			"Requirement auto-fill changed another row or lost combined stack selection.",
		);
	await dragPayment("coins", 42);
	await read(`${api}.reply()`);
	await settle();
	if (
		!(await read(
			`[...document.querySelectorAll('.client-toast')].some(node => node.textContent.includes('That item does not match'))`,
		))
	)
		throw new Error(
			"Mismatched requirement drop did not surface its rejection toast.",
		);
	const mutationsBeforeRowRemoval = await read(
		`${api}.commands().filter(entry => entry.command.startsWith('submit_')).length`,
	);
	await dragRow("inventory");
	const retainedOtherRow = await read(`${api}.pending()`);
	if (
		retainedOtherRow.operation.kind !== "quote" ||
		JSON.stringify(retainedOtherRow.draft.items) !==
			JSON.stringify([
				await read(`${api}.writSmall`),
				await read(`${api}.writLarge`),
			])
	)
		throw new Error("Clearing one requirement removed another row selection.");
	await read(`${api}.reply()`);
	await settle();
	await dragPayment("note", 273);
	await read(`${api}.reply()`);
	await settle();
	if (
		!(await read(
			`document.querySelector('${windowSelector} [data-housing-requirement="273"]').textContent.replace(/\\s+/g,' ').includes('+7 excess')`,
		))
	)
		throw new Error(
			"Rounded note excess was not disclosed beside its requirement.",
		);
	await dragRow("other");
	if (
		(await read(`${api}.pending()`)).operation.kind !== "quote" ||
		(await read(
			`${api}.commands().filter(entry => entry.command.startsWith('submit_')).length`,
		)) !== mutationsBeforeRowRemoval
	)
		throw new Error(
			"A draft row release over another row dispatched a real mutation.",
		);
	await read(`${api}.reply()`);
	await settle();

	await verifyPaymentArtwork();

	await read(
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.replaceHousingCharacter(2)",
	);
	await settle();
	if (await read(`Boolean(document.querySelector('${windowSelector}'))`))
		throw new Error("Character replacement retained the outgoing crystal HUD.");
	await read(`${api}.retained()`);
	await settle();
	if (await read(`Boolean(document.querySelector('${windowSelector}'))`))
		throw new Error(
			"Retained profile reopened a crystal after character replacement.",
		);

	return {
		contextualExamine,
		manual,
		automatic,
		requirementRows: isolated,
		retainedOtherRow,
		commands: commands.map((entry) => entry.command),
		submitted,
		maintenance,
		paymentCommands: paymentCommands.map((entry) => entry.command),
		variants,
		dismissedSnapshotStayedClosed: true,
		characterReplacementStayedClosed: true,
	};
}

async function probeClientWorldMap(client) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const read = (expression) => evaluateExpression(client, expression);
	const click = async (label) => {
		await read(
			`document.querySelector('button[aria-label="${label}"]').click()`,
		);
		await delay(100);
	};
	const initial = await read(`${api}.readWorldMapFixture()`);
	if (initial.opens !== 0)
		throw new Error("World map loaded before dock activation.");
	await read(`${api}.holdWorldMapPreparation()`);
	await click("World");
	const readProgress = () =>
		read(
			`(() => { const status=document.querySelector('section.hud-window[aria-label="World"] .world-map-page [role="status"]'); const bar=status?.querySelector('progress'); return {label:status?.textContent.trim(), value:bar?.value, max:bar?.max}; })()`,
		);
	const startedProgress = await readProgress();
	if (
		!startedProgress.label?.startsWith("World map:") ||
		startedProgress.value !== 1 ||
		!(startedProgress.max > 0)
	)
		throw new Error("World panel did not display initial generation progress.");
	const settlementPoint = await read(
		`(() => { const node = [...document.querySelectorAll('section.hud-window[aria-label="World"] .world-settlements g[data-settlement]')].find(node => node.dataset.settlement === 'Holtburg'); const rect = node.querySelector('circle').getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`,
	);
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		...settlementPoint,
	});
	const settlementTooltip = await read(
		`document.querySelector('section.hud-window[aria-label="World"] .world-map-tooltip').textContent`,
	);
	if (settlementTooltip !== "Holtburg · 42.0N, 33.5E")
		throw new Error(
			"Client map pointer input did not show its settlement anchor.",
		);
	const partialBefore = await read(`${api}.readWorldMapFixture()`);
	const partialPoint = await read(
		`(() => {const rect=document.querySelector('canvas[aria-label="World terrain map"]').getBoundingClientRect(); return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()`,
	);
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseWheel",
		...partialPoint,
		deltaX: 0,
		deltaY: -400,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		...partialPoint,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: partialPoint.x + 30,
		y: partialPoint.y + 20,
		button: "left",
		buttons: 1,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: partialPoint.x + 30,
		y: partialPoint.y + 20,
		button: "left",
		buttons: 0,
		clickCount: 1,
	});

	await delay(50);

	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: partialPoint.x,
		y: partialPoint.y,
	});
	const hoverPosition = await read(
		`(() => { const tip = document.querySelector('section.hud-window[aria-label="World"] .world-map-tooltip'); return { hidden: tip.hidden, text: tip.textContent }; })()`,
	);
	if (
		hoverPosition.hidden ||
		!/\d+\.\d+[NS], \d+\.\d+[EW]/.test(hoverPosition.text)
	)
		throw new Error(
			"Real map pointer input did not display outdoor coordinates.",
		);
	const partialAfter = await read(`${api}.readWorldMapFixture()`);
	// Exercise browser pointer delivery through the real panel and session transport boundary.
	const mapClick = async () => {
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...partialPoint,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			...partialPoint,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
		await delay(20);
	};
	await mapClick();
	if ((await read(`${api}.readMapTeleports()`)).length !== 0)
		throw new Error("Ordinary map click dispatched teleport.");
	await read(`${api}.setMapTeleportPermission(true)`);
	await delay(20);
	await mapClick();
	const mapRequests = await read(`${api}.readMapTeleports()`);
	if (
		mapRequests.length !== 1 ||
		!Number.isFinite(mapRequests[0].args?.position?.x) ||
		!Number.isFinite(mapRequests[0].args?.position?.z)
	)
		throw new Error(
			"Privileged click did not reach the session with map coordinates.",
		);
	await read(`${api}.setMapTeleportPermission(false)`);
	await delay(20);
	await mapClick();
	if ((await read(`${api}.readMapTeleports()`)).length !== 1)
		throw new Error("Revoked map permission still dispatched.");
	if (JSON.stringify(partialBefore) !== JSON.stringify(partialAfter))
		throw new Error(
			"Partial map gestures requested content or changed the game camera.",
		);
	if (
		await read(
			`document.querySelector('section.hud-window[aria-label="World"] button[aria-label="Reset view"]').disabled`,
		)
	)
		throw new Error("Partial image controls were disabled.");
	const beforeHousing = await read(`${api}.readWorldMapFixture()`);
	await read(
		`globalThis.__tabMapCanvas = document.querySelector('canvas[aria-label="World terrain map"]'); document.querySelector('[role="tab"][aria-controls$="-housing"]').click()`,
	);
	await delay(50);
	if (
		!(await read(
			`document.querySelector('canvas[aria-label="World terrain map"]').closest('[role="tabpanel"]').hidden && [...document.querySelectorAll('[role="tabpanel"]')].some(panel => !panel.hidden && panel.textContent.includes('Housing information unavailable.'))`,
		))
	)
		throw new Error(
			"Housing tab did not hide the retained map and show its unqueried state.",
		);
	await read(
		`document.querySelector('[role="tab"][aria-controls$="-world"]').click()`,
	);
	await delay(50);
	if (
		!(await read(
			`globalThis.__tabMapCanvas === document.querySelector('canvas[aria-label="World terrain map"]')`,
		)) ||
		JSON.stringify(beforeHousing) !==
			JSON.stringify(await read(`${api}.readWorldMapFixture()`))
	)
		throw new Error(
			"Tab switching replaced the canvas or requested more map content.",
		);
	await read(`${api}.advanceWorldMapPreparation()`);
	await delay(50);
	const advancedProgress = await readProgress();
	if (
		advancedProgress.value !== Math.floor(advancedProgress.max / 2) ||
		advancedProgress.label === startedProgress.label
	)
		throw new Error("World panel generation progress did not advance.");
	await read(`${api}.releaseWorldMapPreparation()`);
	const deadline = Date.now() + 30000;
	while (
		await read(
			`Boolean(document.querySelector('section.hud-window[aria-label="World"] .world-map-page [role="status"]'))`,
		)
	) {
		if (Date.now() > deadline)
			throw new Error("Client World panel did not become ready.");
		await delay(100);
	}
	const loaded = await read(`${api}.readWorldMapFixture()`);
	if (loaded.opens !== 1 || loaded.deliveredTiles !== loaded.expectedTiles)
		throw new Error("Dock did not eagerly load exactly one image.");
	await read(
		`globalThis.__clientWorldCanvas = document.querySelector('canvas[aria-label="World terrain map"]'); true`,
	);
	const mapPoint = await read(
		`(() => {const rect=document.querySelector('canvas[aria-label="World terrain map"]').getBoundingClientRect(); return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()`,
	);
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseWheel",
		...mapPoint,
		deltaX: 0,
		deltaY: -400,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		...mapPoint,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: mapPoint.x + 30,
		y: mapPoint.y + 20,
		button: "left",
		buttons: 1,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: mapPoint.x + 30,
		y: mapPoint.y + 20,
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
	await delay(100);
	const gestured = await read(`${api}.readWorldMapFixture()`);
	if (JSON.stringify(loaded) !== JSON.stringify(gestured))
		throw new Error(
			"Map gestures requested content or changed the game camera.",
		);
	await click("Inventory");
	if (
		!(await read(
			`document.querySelector('section.hud-window[aria-label="World"]').hidden && Boolean(document.querySelector('section.hud-window[aria-label="Inventory"]'))`,
		))
	)
		throw new Error("Panel switching did not retain a hidden World window.");
	await client.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Escape",
		code: "Escape",
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Escape",
		code: "Escape",
	});
	await delay(100);
	if (
		await read(
			`Boolean(document.querySelector('section.hud-window[aria-label="Inventory"]'))`,
		)
	)
		throw new Error("Hidden World window intercepted Inventory Escape.");
	await click("World");
	const retained = await read(
		`globalThis.__clientWorldCanvas === document.querySelector('canvas[aria-label="World terrain map"]') && !document.querySelector('section.hud-window[aria-label="World"]').hidden`,
	);
	const reopened = await read(`${api}.readWorldMapFixture()`);
	if (!retained || JSON.stringify(loaded) !== JSON.stringify(reopened))
		throw new Error("Reopen replaced the canvas or reloaded the dataset.");
	const landscapeHome = {
		home: {
			kind: "owned",
			home: {
				houseType: 1,
				boughtAt: 100,
				maintenanceFree: false,
				buy: [],
				rent: [
					{
						wcid: 273,
						name: "Pyreal",
						pluralName: "Pyreals",
						required: 100,
						paid: 30,
						remaining: 70,
					},
				],
				maintenancePaid: false,
				period: { start: 200, end: 300, nextDue: 300 },
				position: {
					landblockId: 0xa9b40001,
					coords: { x: 80, y: 90, z: 0 },
					rotation: { w: 1, x: 0, y: 0, z: 0 },
				},
			},
		},
		refreshing: false,
		crystal: null,
		pendingPayment: null,
		pendingManagement: null,
		access: { generation: 0, records: null, refreshing: false },
		search: { results: null, pendingType: null },
	};
	await read(`${api}.setHousing(${JSON.stringify(landscapeHome)})`);
	await read(
		`document.querySelector('[role="tab"][aria-controls$="-housing"]').click()`,
	);
	await delay(50);
	if (
		!(await read(
			`(() => { const panel=document.querySelector('.housing-tab'); return panel.querySelector('.housing-type').textContent.trim() === 'Cottage' && panel.querySelector('.housing-table td').textContent.trim() === '30 / 100' && panel.querySelector('.housing-summary').querySelectorAll('.housing-maintenance-deadline').length === 1 && panel.querySelector('.housing-maintenance-deadline').textContent.trim() === 'Payment deadline' && ${api}.readHousingRefreshes() === 0; })()`,
		))
	)
		throw new Error(
			"Housing tab did not consume retained home facts without querying.",
		);
	if (
		!(await read(`(() => {
		const tab = document.querySelector('.housing-tab');
		const page = tab.closest('[role="tabpanel"]');
		const bounds = page.getBoundingClientRect();
		const content = tab.getBoundingClientRect();
		return Math.abs(bounds.left-content.left) < 1 && Math.abs(bounds.top-content.top) < 1
			&& Math.abs(bounds.width-content.width) < 1 && Math.abs(bounds.height-content.height) < 1;
	})()`))
	)
		throw new Error(
			"Housing tab does not fill its page; placeholder spacing remains.",
		);

	if (
		!(await read(`(() => {
		const disclosures = [...document.querySelectorAll('.housing-tab details.ui-disclosure')];
		return disclosures.length >= 5 && disclosures.filter(section => section.open).length === 1
			&& disclosures.find(section => section.open).querySelector('summary').textContent === 'Maintenance';
	})()`))
	)
		throw new Error(
			"Housing tab did not default to a compact collapsible layout.",
		);
	if (
		!(await read(`(() => {
		const panel = document.querySelector('.housing-tab');
		const location = panel.querySelector('.housing-summary > .housing-location');
		return location?.getBoundingClientRect().height > 0 && location.previousElementSibling.textContent.trim() === 'Location'
			&& ![...panel.querySelectorAll('button')].some(button => ['Refresh', 'Show on map'].includes(button.textContent.trim()));
	})()`))
	)
		throw new Error(
			"Housing summary did not expose coordinates without redundant controls.",
		);
	await read(
		`document.querySelector('[role="tab"][aria-controls$="-world"]').click()`,
	);
	await delay(200);
	const homeMarker = await read(`(() => {
		const marker = document.querySelector('.world-home-target');
		const matrix = marker.transform.baseVal.consolidate()?.matrix;
		return { visible: marker.style.display !== 'none', x: matrix?.e, y: matrix?.f };
	})()`);
	if (
		!homeMarker.visible ||
		!Number.isFinite(homeMarker.x) ||
		!Number.isFinite(homeMarker.y)
	)
		throw new Error("Retained home location did not populate the map marker.");
	const apartmentHome = structuredClone(landscapeHome);
	apartmentHome.home.home.houseType = 4;
	apartmentHome.home.home.boughtAt = null;
	await read(`${api}.setHousing(${JSON.stringify(apartmentHome)})`);
	await delay(200);
	if (
		!(await read(
			`document.querySelector('.world-home-target').style.display === 'none'`,
		))
	)
		throw new Error("Apartment replacement retained a landscape marker.");
	await read(
		`document.querySelector('[role="tab"][aria-controls$="-housing"]').click()`,
	);
	await delay(50);
	if (
		!(await read(
			`(() => { const panel=document.querySelector('.housing-tab'); return panel.textContent.includes('Apartment') && panel.textContent.includes('Date unavailable') && ![...panel.querySelectorAll('button')].some(button => button.textContent.trim() === 'Show on map'); })()`,
		))
	)
		throw new Error(
			"Apartment home exposed a map action or invented purchase date.",
		);

	const manage = '[aria-label="Manage housing"]';
	const manageClick = async (label) => {
		await read(
			`(() => { const button=[...document.querySelectorAll('${manage} button')].find(node => node.textContent.trim() === ${JSON.stringify(label)}); if(!button) throw new Error('Missing management button '+${JSON.stringify(label)}); button.click(); })()`,
		);
		await delay(300);
	};
	await read(
		`document.querySelector('${manage} details[aria-label="Access permissions"]').open = true`,
	);
	await delay(300);
	let managementCommands = await read(`${api}.readHousingManagementCommands()`);
	if (
		managementCommands.filter(
			(entry) => entry.command === "query_client_housing_access",
		).length !== 0
	)
		throw new Error(
			"Disclosure expansion dispatched a permission query instead of consuming core facts.",
		);
	const managementHome = structuredClone(apartmentHome);
	managementHome.access = {
		generation: 0,
		refreshing: false,
		records: {
			publicEntry: false,
			guests: [{ character: 2, name: "Fixture guest", storageAllowed: false }],
			allegiance: null,
			roommates: null,
		},
	};
	await read(`${api}.setHousing(${JSON.stringify(managementHome)})`);
	await delay(300);
	if (
		!(await read(
			`document.querySelector('${manage}').textContent.includes('Fixture guest')`,
		))
	)
		throw new Error(
			"Management did not show named permissions or preserve unknown allegiance facts.",
		);
	if (
		!(await read(`(() => {
        const root = document.querySelector('${manage}');
        return !root.querySelector('select') && ['Allegiance entry', 'Allegiance storage'].every(label => {
            const input = root.querySelector('input[aria-label="' + label + '"]');
            return !input.indeterminate && !input.checked;
        });
    })()`))
	)
		throw new Error(
			"Undisclosed binary settings did not default to unchecked.",
		);
	await read(
		`document.querySelector('${manage} input[type="checkbox"]').click()`,
	);
	await delay(300);
	managementCommands = await read(`${api}.readHousingManagementCommands()`);
	const publicRequest = managementCommands.findLast(
		(entry) => entry.command === "submit_client_housing_management",
	)?.args?.request;
	if (
		publicRequest?.action.kind !== "publicEntry" ||
		publicRequest.action.enabled !== true
	)
		throw new Error(
			"Public-entry control did not submit its explicit desired state.",
		);
	if (!(await read(`document.querySelector('${manage} fieldset').disabled`)))
		throw new Error(
			"Submitted administration did not block competing controls.",
		);
	await read(
		`${api}.finishHousingManagement(${JSON.stringify({ sequence: publicRequest.sequence, generation: publicRequest.generation, outcome: { kind: "requested" } })})`,
	);
	await delay(300);
	if (
		!(await read(
			`document.querySelector('${manage} input[type="checkbox"]').checked`,
		))
	)
		throw new Error("Requested checkbox value snapped back after dispatch.");
	managementHome.access.refreshing = true;
	await read(`${api}.setHousing(${JSON.stringify(managementHome)})`);
	await delay(300);
	if (
		!(await read(
			`document.querySelector('${manage} input[type="checkbox"]').checked && !document.querySelector('${manage} fieldset').disabled`,
		))
	)
		throw new Error(
			"Stale background facts replaced the intention or blocked unrelated controls.",
		);
	if (!(await read(`${api}.probeHousingManagementRemount()`)))
		throw new Error(
			"Remounting housing controls lost the requested checkbox value or dispatched another command.",
		);
	managementHome.access.refreshing = false;
	managementHome.access.records.publicEntry = true;
	await read(`${api}.setHousing(${JSON.stringify(managementHome)})`);
	await delay(300);
	if (
		!(await read(
			`document.querySelector('${manage} input[type="checkbox"]').checked`,
		))
	)
		throw new Error(
			"Refreshed facts did not update the checkbox independently of the dispatch receipt.",
		);
	await read(`(() => {
		const section = document.querySelector('${manage} details[aria-label="Decorations"]');
		section.open = true;
		[...section.querySelectorAll('button')].find(button => button.textContent.trim() === 'Show empty hooks').click();
	})()`);
	await delay(300);
	managementCommands = await read(`${api}.readHousingManagementCommands()`);
	const hooksRequest = managementCommands.findLast(
		(entry) => entry.command === "submit_client_housing_management",
	)?.args?.request;
	if (
		hooksRequest?.action.kind !== "hooks" ||
		hooksRequest.action.enabled !== true
	)
		throw new Error(
			"Empty-hook control did not submit an explicit show request.",
		);
	await read(
		`${api}.finishHousingManagement(${JSON.stringify({ sequence: hooksRequest.sequence, generation: hooksRequest.generation, outcome: { kind: "requested" } })})`,
	);
	await delay(300);
	await manageClick("Hide empty hooks");
	await delay(300);
	const hideHooksRequest = await read(
		`${api}.readHousingManagementCommands().findLast(entry => entry.command === 'submit_client_housing_management').args.request`,
	);
	if (
		hideHooksRequest.action.kind !== "hooks" ||
		hideHooksRequest.action.enabled !== false
	)
		throw new Error(
			"Hide hooks button did not submit an explicit hide command.",
		);
	await read(
		`${api}.finishHousingManagement(${JSON.stringify({ sequence: hideHooksRequest.sequence, generation: hideHooksRequest.generation, outcome: { kind: "requested" } })})`,
	);
	await delay(300);

	await read(
		`document.querySelector('${manage} details[aria-label="Access permissions"]').open = true`,
	);
	await manageClick("Revoke all storage access");
	const revokeStorage = await read(
		`${api}.readHousingManagementCommands().findLast(entry => entry.command === 'submit_client_housing_management').args.request`,
	);
	if (
		revokeStorage.action.kind !== "removeAllStorage" ||
		!(await read(
			`[...document.querySelectorAll('${manage} details[aria-label="Access permissions"] button')].some(button => button.textContent.trim() === 'Revoke all storage access')`,
		))
	)
		throw new Error("Revoke storage did not dispatch from Access & guests.");
	await read(
		`${api}.finishHousingManagement(${JSON.stringify({ sequence: revokeStorage.sequence, generation: revokeStorage.generation, outcome: { kind: "requested" } })})`,
	);
	await delay(300);
	await manageClick("Remove all guests");
	const removeGuests = await read(
		`${api}.readHousingManagementCommands().findLast(entry => entry.command === 'submit_client_housing_management').args.request`,
	);
	if (
		removeGuests.action.kind !== "removeAllGuests" ||
		!(await read(
			`[...document.querySelectorAll('${manage} .housing-guest-access button')].some(button => button.textContent.trim() === 'Remove all guests')`,
		))
	)
		throw new Error(
			"Remove all guests did not dispatch from the guest access group.",
		);
	await read(
		`${api}.finishHousingManagement(${JSON.stringify({ sequence: removeGuests.sequence, generation: removeGuests.generation, outcome: { kind: "requested" } })})`,
	);
	await delay(300);
	const submitHousingName = async (label, value) => {
		await read(
			`(() => { const input = document.querySelector('${manage} input[aria-label="${label}"]'); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); })()`,
		);
		await delay(30);
		await client.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Enter",
			text: "\r",
			code: "Enter",
			windowsVirtualKeyCode: 13,
		});
		await client.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
		});
		await delay(300);
	};
	for (const [label, name, kind] of [
		["Guest character name", "New guest", "addGuest"],
		["Occupant character name", "Named occupant", "bootGuest"],
	]) {
		const before = await read(
			`${api}.readHousingManagementCommands().filter(entry => entry.command === 'submit_client_housing_management').length`,
		);
		await submitHousingName(label, name);
		const commands = await read(
			`${api}.readHousingManagementCommands().filter(entry => entry.command === 'submit_client_housing_management')`,
		);
		const request = commands.at(-1)?.args.request;
		if (
			commands.length !== before + 1 ||
			request?.action.kind !== kind ||
			request.action.name !== name
		)
			throw new Error(
				`Enter did not submit exactly one ${kind} action: ${JSON.stringify({ before, commands, active: await read("document.activeElement.outerHTML") })}`,
			);
		await read(
			`${api}.finishHousingManagement(${JSON.stringify({ sequence: request.sequence, generation: request.generation, outcome: { kind: "requested" } })})`,
		);
		await delay(300);
	}
	await read(
		`(() => { const input = document.querySelector('${manage} input[aria-label="Occupant character name"]'); input.value = '   '; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
	);
	await delay(30);
	await manageClick("Boot all");
	const bootRequest = await read(
		`${api}.readHousingManagementCommands().findLast(entry => entry.command === 'submit_client_housing_management').args.request`,
	);
	if (
		bootRequest.action.kind !== "bootEveryone" ||
		!(await read(
			`[...document.querySelectorAll('${manage} [aria-label="Access permissions"] button')].some(button => button.textContent.trim() === 'Boot all') && !document.querySelector('dialog.client-message-dialog')`,
		))
	)
		throw new Error(
			"Boot action did not submit directly from access controls.",
		);
	await read(
		`${api}.finishHousingManagement(${JSON.stringify({ sequence: bootRequest.sequence, generation: bootRequest.generation, outcome: { kind: "requested" } })})`,
	);
	await delay(300);
	managementCommands = await read(`${api}.readHousingManagementCommands()`);
	const beforeAbandon = managementCommands.filter(
		(entry) => entry.command === "submit_client_housing_management",
	).length;
	await read(
		`document.querySelector('${manage} details[aria-label="Advanced housing actions"]').open = true`,
	);
	await manageClick("Abandon home…");
	if (
		!(await read(
			`document.querySelector('dialog.client-message-dialog').textContent.includes('remove its deed')`,
		))
	)
		throw new Error(
			"Abandonment confirmation omitted owning-character requirement.",
		);
	const typeAbandonment = async (value) => {
		await read(
			`(() => { const input = document.querySelector('dialog.client-message-dialog input'); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
		);
		await delay(30);
	};
	const acceptDisabled = () =>
		read(
			`document.querySelector('dialog.client-message-dialog .client-message-actions button:last-child').disabled`,
		);
	if (!(await acceptDisabled()))
		throw new Error("Empty abandonment input allowed confirmation.");
	await typeAbandonment("Abandon");
	if (!(await acceptDisabled()))
		throw new Error("Abandonment accepted a nonmatching word.");
	await typeAbandonment("abandon");
	if (await acceptDisabled())
		throw new Error("Matching abandonment input did not enable confirmation.");
	const clickDialogPoint = async (point) => {
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...point,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			...point,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
		await delay(50);
	};
	await clickDialogPoint(
		await read(
			`(() => { const bounds = document.querySelector('dialog.client-message-dialog').getBoundingClientRect(); return { x: bounds.left + 8, y: bounds.top + 8 }; })()`,
		),
	);
	if (
		!(await read(
			`Boolean(document.querySelector('dialog.client-message-dialog'))`,
		))
	)
		throw new Error("Inside modal click canceled abandonment.");
	await clickDialogPoint({ x: 2, y: 2 });
	if (
		await read(
			`Boolean(document.querySelector('dialog.client-message-dialog'))`,
		)
	)
		throw new Error("Backdrop click did not cancel abandonment.");
	await delay(300);
	await manageClick("Abandon home…");
	if (!(await acceptDisabled()))
		throw new Error("Reopened abandonment inherited the previous input.");
	await typeAbandonment("abandon");
	managementHome.access.generation += 1;
	await read(`${api}.setHousing(${JSON.stringify(managementHome)})`);
	await delay(300);
	if (
		await read(
			`Boolean(document.querySelector('dialog.client-message-dialog'))`,
		)
	)
		throw new Error("Home replacement retained stale management confirmation.");
	await read(
		`document.querySelector('${manage} details[aria-label="Advanced housing actions"]').open = true`,
	);
	await manageClick("Abandon home…");
	managementCommands = await read(`${api}.readHousingManagementCommands()`);
	if (
		managementCommands.filter(
			(entry) => entry.command === "submit_client_housing_management",
		).length !== beforeAbandon
	)
		throw new Error("Abandonment dispatched before confirmation.");
	if (!(await acceptDisabled()))
		throw new Error("Home replacement inherited abandonment input.");
	await typeAbandonment("abandon");
	await read(
		`document.querySelector('dialog.client-message-dialog .client-message-actions button:last-child').click()`,
	);
	await delay(300);
	managementCommands = await read(`${api}.readHousingManagementCommands()`);
	const abandonRequest = managementCommands.findLast(
		(entry) => entry.command === "submit_client_housing_management",
	)?.args?.request;
	if (
		abandonRequest?.action.kind !== "abandon" ||
		abandonRequest.generation !== managementHome.access.generation
	)
		throw new Error("Confirmed abandonment lost the reviewed home epoch.");
	await read(
		`${api}.finishHousingManagement(${JSON.stringify({ sequence: abandonRequest.sequence, generation: abandonRequest.generation, outcome: { kind: "rejected", reason: "Only the owner can do this" } })})`,
	);
	await delay(300);
	if (
		!(await read(
			`!document.querySelector('${manage} fieldset').disabled && document.querySelector('${manage}').getAttribute('aria-busy') === 'false'`,
		))
	)
		throw new Error(
			"Owner-only rejection did not retire management admission.",
		);
	const searchSnapshot = structuredClone(apartmentHome);
	searchSnapshot.home = { kind: "none" };
	searchSnapshot.search = {
		results: { houseType: 4, areas: [0xa9b40001], totalAvailable: 3 },
		pendingType: null,
	};
	await read(`${api}.setHousing(${JSON.stringify(searchSnapshot)})`);
	await delay(50);
	await read(
		`document.querySelector('[role="tab"][aria-controls$="-world"]').click()`,
	);
	await delay(50);
	const chooseHousing = async (type) => {
		await read(
			`(() => { const select=document.querySelector('[aria-label="Housing search"]'); select.value='${type}'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`,
		);
		await delay(50);
	};
	const markerCount = () =>
		read(`document.querySelectorAll('[data-housing-search-areas]').length`);
	if (
		!(await read(
			`(() => {const select=document.querySelector('[aria-label="Housing search"]');return select.value==='0' && [...select.options].every(option=>option.value!=='4') && ${api}.readHousingSearches().length===0;})()`,
		))
	)
		throw new Error(
			"Map housing search did not start hidden without apartment options or implicit requests.",
		);
	await chooseHousing(2);
	const housingSearches = await read(`${api}.readHousingSearches()`);
	if (
		JSON.stringify(housingSearches) !== JSON.stringify([2]) ||
		(await markerCount()) !== 0
	)
		throw new Error(
			"Map search did not dispatch once or exposed mismatched apartment areas.",
		);
	if (
		!(await read(
			`(() => {const select=document.querySelector('[aria-label="Housing search"]');return select.getAttribute('aria-busy')==='true' && !select.options[0].disabled && [...select.options].slice(1).every(option=>option.disabled);})()`,
		))
	)
		throw new Error(
			"Pending map search admission disabled None or enabled another type.",
		);
	await chooseHousing(0);
	searchSnapshot.search = {
		results: {
			houseType: 2,
			areas: [0xa9b40001, 0xaab40001],
			totalAvailable: 3,
		},
		pendingType: null,
	};
	await read(`${api}.setHousing(${JSON.stringify(searchSnapshot)})`);
	await delay(50);
	if ((await markerCount()) !== 0)
		throw new Error("Late map search reply re-enabled a hidden filter.");
	await chooseHousing(2);
	if ((await markerCount()) === 0)
		throw new Error("Matching retained map search areas did not render.");
	await read(`${api}.timeoutHousingSearch()`);
	await delay(100);
	if (
		!(await read(
			`document.querySelector('.client-toast[role="alert"]').textContent.includes('Housing search timed out') && !document.querySelector('[aria-label="Housing search"] option[value="1"]').disabled`,
		)) ||
		(await read(`${api}.readHousingSearches()`)).length !== 2
	)
		throw new Error(
			"Timeout failed to restore map admission with a toast or resent search.",
		);
	const denseAreas = Array.from(
		{ length: 25 },
		(_, index) =>
			(((0xa9 + (index % 5)) << 24) |
				((0xb4 + Math.floor(index / 5)) << 16) |
				1) >>>
			0,
	);
	searchSnapshot.search.results.areas = denseAreas;
	await read(`${api}.setHousing(${JSON.stringify(searchSnapshot)})`);
	await read(`document.querySelector('.world-map-reset').click()`);
	await delay(100);
	const clusteredCount = await markerCount();
	if (clusteredCount === 0 || clusteredCount >= denseAreas.length)
		throw new Error("Dense world-fit areas were not clustered.");
	const markerPoint = await read(
		`(() => {const rect=document.querySelector('[data-housing-search-areas] circle').getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`,
	);
	const mapCenter = await read(
		`(() => {const rect=document.querySelector('[aria-label="World terrain map"]').getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`,
	);
	await client.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		...markerPoint,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		...mapCenter,
		button: "left",
		buttons: 1,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		...mapCenter,
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
	await delay(50);
	let separated = false;
	for (let step = 0; step < 8; step++) {
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseWheel",
			...mapCenter,
			deltaX: 0,
			deltaY: -400,
		});
		await delay(40);
		// Zoom is center-based. Keep the fixture areas in view before zooming again.
		const visibleMarker = await read(
			`(() => {const node=document.querySelector('[data-housing-search-areas] circle');if(!node)return null;const rect=node.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`,
		);
		if (visibleMarker) {
			await client.send("Input.dispatchMouseEvent", {
				type: "mousePressed",
				...visibleMarker,
				button: "left",
				buttons: 1,
				clickCount: 1,
			});
			await client.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				...mapCenter,
				button: "left",
				buttons: 1,
			});
			await client.send("Input.dispatchMouseEvent", {
				type: "mouseReleased",
				...mapCenter,
				button: "left",
				buttons: 0,
				clickCount: 1,
			});
			await delay(40);
		}
		if ((await markerCount()) > clusteredCount) {
			separated = true;
			break;
		}
	}
	if (!separated)
		throw new Error("Housing clusters did not separate with real map zoom.");
	const clusterPositions = () =>
		read(
			`Array.from(document.querySelectorAll('[data-housing-search-areas]'), node => ({areas:node.dataset.housingSearchAreas, x:node.transform.baseVal.getItem(0).matrix.e, y:node.transform.baseVal.getItem(0).matrix.f}))`,
		);
	const beforePan = await clusterPositions();
	const mapCursor = () =>
		read(
			`getComputedStyle(document.querySelector('[aria-label="World terrain map"]')).cursor`,
		);
	if ((await mapCursor()) !== "grab")
		throw new Error("Idle world map did not expose the pan hand cursor.");
	await client.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		...mapCenter,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: mapCenter.x + 10,
		y: mapCenter.y + 7,
		button: "left",
		buttons: 1,
	});
	if ((await mapCursor()) !== "grabbing")
		throw new Error(
			"Dragging world map did not expose the closed hand cursor.",
		);
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: mapCenter.x + 10,
		y: mapCenter.y + 7,
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
	if ((await mapCursor()) !== "grab")
		throw new Error("World map cursor did not recover after pointer release.");
	await delay(50);
	const afterPan = await clusterPositions();
	const stablePan =
		beforePan.length > 0 &&
		beforePan.every((before) => {
			const after = afterPan.find(
				(candidate) => candidate.areas === before.areas,
			);
			return (
				after &&
				Math.abs(after.x - before.x - 10) < 0.1 &&
				Math.abs(after.y - before.y - 7) < 0.1
			);
		});
	if (!stablePan)
		throw new Error(
			"Map pan changed housing cluster membership or centroid motion.",
		);
	await read(`document.querySelector('.world-map-reset').click()`);
	await delay(50);
	const beforeResize = await read(
		`document.querySelector('.world-housing-search').innerHTML`,
	);
	await read(`document.querySelector('.world-map-surface').style.width='75%'`);
	await delay(100);
	if (
		(await markerCount()) === 0 ||
		(await read(
			`document.querySelector('.world-housing-search').innerHTML`,
		)) === beforeResize
	)
		throw new Error("Map resize did not reproject housing areas.");
	await read(`document.querySelector('.world-map-surface').style.width=''`);
	await delay(100);
	await click("Close World");
	await click("World");
	await delay(50);
	if (
		!(await read(
			`document.querySelector('[aria-label="Housing search"]').value==='2' && ${api}.readHousingSearches().length===2`,
		))
	)
		throw new Error("Panel hiding lost the filter or resent the request.");
	searchSnapshot.search.pendingType = null;
	await read(`${api}.setHousing(${JSON.stringify(searchSnapshot)})`);
	await delay(50);
	await read(
		`document.querySelector('[role="tab"][aria-controls$="-housing"]').click()`,
	);
	await read(
		`document.querySelector('[role="tab"][aria-controls$="-world"]').click()`,
	);
	await delay(50);
	if ((await read(`${api}.readHousingSearches()`)).length !== 2)
		throw new Error("Tab focus resent map search.");
	searchSnapshot.search = {
		results: { houseType: 2, areas: [], totalAvailable: 0 },
		pendingType: null,
	};
	await read(`${api}.setHousing(${JSON.stringify(searchSnapshot)})`);
	await delay(50);
	if (
		(await markerCount()) !== 0 ||
		!(await read(
			`document.querySelector('[aria-label="Housing search"] option:checked').textContent.includes('(0)')`,
		))
	)
		throw new Error("Empty map search was not indicated in the selector.");
	await read(
		`document.querySelector('[role="tab"][aria-controls$="-housing"]').click()`,
	);
	await read(`${api}.setHousing(${JSON.stringify(managementHome)})`);
	await delay(300);

	await read(
		`document.querySelector('${manage} details[aria-label="Advanced housing actions"]').open = true`,
	);
	await manageClick("Abandon home…");
	const beforeCharacterReplacement = await read(
		`${api}.readHousingManagementCommands().length`,
	);
	await read(`${api}.replaceHousingCharacter(2)`);
	await delay(300);
	if (
		!(await read(`(() => {
		const panel = document.querySelector('.housing-tab');
		return panel.textContent.includes('Housing information unavailable')
			&& !panel.textContent.includes('Fixture guest')
			&& !document.querySelector('dialog.client-message-dialog')
			&& ${api}.readHousingManagementCommands().length === ${beforeCharacterReplacement};
	})()`))
	)
		throw new Error(
			"Character replacement retained old home, permissions, or management review.",
		);
	if (
		!(await read(
			`document.querySelector('[aria-label="Housing search"]').value === '0' && document.querySelectorAll('[data-housing-search-areas]').length === 0`,
		))
	)
		throw new Error(
			"Character replacement retained the old map search filter.",
		);
	await read(`document.querySelector('.housing-tab button').click()`);
	if ((await read(`${api}.readHousingRefreshes()`)) !== 1)
		throw new Error(
			"Unavailable housing Retry did not request information once.",
		);
	await read(`${api}.setHousing(${JSON.stringify(landscapeHome)})`);
	await delay(300);
	if (
		!(await read(
			`document.querySelector('.housing-tab').textContent.includes('Cottage') && ${api}.readHousingRefreshes() === 1`,
		))
	)
		throw new Error(
			"Replacement home did not populate without an implicit focus query.",
		);
	await click("Close World");
	if (
		!(await read(
			`document.querySelector('section.hud-window[aria-label="World"]').hidden`,
		))
	)
		throw new Error("World close did not hide its retained window.");
	return {
		initial,
		loaded,
		reopened,
		retained,
		startedProgress,
		advancedProgress,
		homeMarker,
		housingRefreshes: await read(`${api}.readHousingRefreshes()`),
		housingSearches: await read(`${api}.readHousingSearches()`),
		housingClustering: { clusteredCount, separated, stablePan },
		characterReplacementClearedHousing: true,
		managementActions: managementCommands
			.filter((entry) => entry.command === "submit_client_housing_management")
			.map((entry) => entry.args.request.action),
	};
}
