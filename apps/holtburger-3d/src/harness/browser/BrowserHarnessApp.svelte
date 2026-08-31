<script lang="ts">
	import { onMount, tick as svelteTick } from "svelte";
	import { resolveExplorerOutdoorFocusPose } from "../../explorer/explorer-camera-framing";
	import { ExplorerCameraInputController } from "../../explorer/explorer-camera-input-controller";
	import { EXPLORER_TUNING } from "../../explorer/explorer-tuning";
	import type { BakedDrawMergeCensus } from "../../lib/game/renderer/baked-draw-merge-census";
	import { MapRenderer } from "../../lib/game/map/map-renderer";
	import { MAP_DEFAULT_VIEW_DIAMETERS } from "../../lib/game/map/map-appearance";
	import {
		type MapAnchor,
		clampMapViewDiameter,
		mapEnvironment,
		mapHeadingFromSceneTransform,
	} from "../../lib/game/map/map-view";
	import {
		createColorGradeParameters,
		type ColorGradeParameters,
	} from "../../lib/game/renderer/color-grade-policy";
	import { HttpLandblockContentSource } from "../../lib/assets/http-landblock-content-source";
	import type {
		HttpLandblockProfileDiagnostic,
		HttpLandblockSourceBatchDiagnostic,
	} from "../../lib/assets/http-landblock-content-source";
	import { CachedLandblockProfileSource } from "../../lib/assets/landblock-profile-source";
	import { StandardCommitPipeline } from "../../lib/game/commit/pipeline";
	import { SyntheticBlendedBuildingPipeline } from "./synthetic-blended-building-pipeline";
	import { SyntheticInstancedObjectPipeline } from "./synthetic-instanced-object-pipeline";
	import {
		DynamicOnlyLandblockSource,
		WithoutAuthoredDynamicsLandblockSource,
	} from "./dynamic-only-landblock-source";
	import type { EnvCellId, LandblockOwnerId } from "../../lib/game/game-types";
	import {
		createLandblockWorldOrigin,
		landblockAtWorldPoint,
		OUTDOOR_LANDBLOCK_WORLD_SIZE,
	} from "../../lib/game/landblocks";
	import {
		createCameraAxesRadians,
		createCameraRotationRadians,
		createEntityFacingCameraYaw,
		resolveCameraLookAtAngles,
	} from "../../lib/game/math/camera-orientation";
	import { sceneVec3, sceneVector3 } from "../../lib/assets/ac-frame";
	import type { Camera } from "../../lib/game/runtime/types";
	import type { SceneInterestRadii } from "../../lib/game/runtime/types";
	import {
		createProjectionClearanceRevision,
		type ProjectionClearanceRevision,
	} from "../../lib/game/camera/projection-clearance";
	import { Vec3 } from "../../lib/game/math/types";
	import {
		WebGL2Device,
		type WebGL2ContextLossPolicyProbe,
	} from "../../lib/game/renderer/webgl2-device";
	import type { WebGL2PortalScopeAtlasTargetsFixtureResult } from "../../lib/game/renderer/webgl2-portal-scope-atlas-targets-fixture";
	import type { WebGL2PortalScopeAtlasExecutorFixtureResult } from "../../lib/game/renderer/webgl2-portal-scope-atlas-executor-fixture";
	import type { WebGL2PssmFixtureResult } from "../../lib/game/renderer/webgl2-pssm-fixture";
	import {
		GamePresentationRuntime,
		type PortalTransitionRuntimeDiagnostics,
		type StaticObjectLayerRuntimeDiagnostics,
		type StaticObjectRuntimeDiagnostics,
	} from "../../lib/game/runtime/game-presentation-runtime";
	import type { ClosedWorkerPoolDiagnostics } from "../../lib/game/workers/closed-worker";
	import { RuntimeTickProfiler } from "../../lib/game/runtime/runtime-tick-profiler";
	import { LandblockLayerKind } from "../../lib/game/runtime/scene-interest";
	import {
		SceneInterestRequestCoordinator,
		type SceneInterestTarget,
	} from "../../lib/game/runtime/scene-target";
	import { ActiveRegionStaticDetailOwner } from "../../lib/game/resolution/active-region-static-detail";
	import {
		type EntityShadowResourceDiagnostics,
		type FrameSelectionMetrics,
		type FrameSettings,
		type RendererFrameProfile,
	} from "../../lib/game/renderer/renderer";
	import { validateRenderScale } from "../../lib/game/renderer/render-scale";
	import {
		createEntityShadowSettings,
		type EntityShadowMode,
		type EntityShadowSettings,
	} from "../../lib/game/renderer/entity-shadow-policy";
	import type { RenderExtent } from "../../lib/game/renderer/render-extent";
	import type {
		PortalExecutionProbeResult,
		WebGL2Renderer,
	} from "../../lib/game/renderer/webgl2-renderer";
	import {
		isTextureFilteringPolicy,
		type TextureFilteringCapabilities,
		type TextureFilteringPolicy,
	} from "../../lib/game/renderer/texture-filtering-policy";
	import { resolveSceneEnvironment } from "../../lib/game/environment/scene-environment";
	import { resolvePhysicalFlyViewDirection } from "../../lib/game/motion/host-physical-fly-path";
	import type { HostCameraPlacement } from "../../lib/game/motion/host-placed-path";
	import {
		decodeHostKinematicBoomUpdateReceipt,
		resolveKinematicBoomDirection,
		type HostKinematicBoomIdentity,
	} from "../../lib/game/motion/host-kinematic-boom-path";
	import { dynamicEntityPlacement } from "../../lib/game/runtime/dynamic-entity-presentation";
	import {
		createExplorerLaunchRequest,
		createExplorerRelocationRequest,
		createExplorerSpawnRequest,
		parseExplorerWcid,
	} from "../../explorer/explorer-entity-commands";
	import type {
		DynamicEntityEvent,
		DynamicEntityView,
	} from "../../lib/game/runtime/dynamic-entity-feed";
	import {
		HttpExplorerEntityHost,
		type HttpKinematicBoomClearanceRequest,
		type HttpKinematicBoomIntentRequest,
		type HttpKinematicBoomStartRequest,
	} from "./http-explorer-entity-host";
	import {
		HostKinematicBoomSession,
		type HostKinematicBoomTransport,
	} from "../../lib/game/camera/host-kinematic-boom-session";
	import { PossessionCameraController } from "../../lib/game/camera/possession-camera-controller";
	import type {
		ExplorerPossession,
		ExplorerPossessionEventRequest,
		ExplorerPossessionIntent,
		PossessionEventQueueReceipt,
		PossessionMotionProbe,
	} from "../../explorer/explorer-entity-possession";
	import type { PossessionTickResponse } from "./http-explorer-entity-host";
	import type { ExplorerFixedTickEnvelope } from "../../explorer/explorer-fixed-tick";
	import {
		installTerrainGlTrace,
		type TerrainGlTrace,
	} from "./terrain-gl-trace";
	import { parseResidenceInput } from "../../explorer/world-input";
	import { loadPortalTransitionAssets } from "../../lib/client/portal-transition-assets";

	const CAMERA_FOV_DEGREES = 90;
	const CAMERA_NEAR = 0.5;
	const CAMERA_FAR = 2_000;
	/**
	 * Deterministic uniform [0, 1) source, so particle emission repeats exactly between runs.
	 *
	 * mulberry32. Only the harness uses it: production randomness stays `Math.random`, and without
	 * a seed two runs differ by more pixels than most rendering changes do, which makes screenshot
	 * comparison useless for anything that emits particles.
	 */
	function seededRoll(seed: number): () => number {
		if (!Number.isFinite(seed)) throw new Error("particleSeed must be finite.");
		let state = seed >>> 0;
		return () => {
			state = (state + 0x6d2b79f5) >>> 0;
			let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
			drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
			return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
		};
	}

	/**
	 * Set the camera and put the listener on it, exactly as the Explorer coordinator does.
	 *
	 * Without this the harness never places the listener, so every trigger reports `inaudible` and
	 * the audio path cannot be exercised at all.
	 */
	function applyHarnessCamera(
		target: GamePresentationRuntime,
		camera: Camera,
		extent?: RenderExtent,
	): void {
		const canvas = canvasElement;
		if (canvas === null) {
			throw new Error("Browser harness camera requires a mounted canvas.");
		}
		target.setPrimaryView({
			camera,
			extent:
				extent ??
				target.resolveViewportExtent(canvas.clientWidth, canvas.clientHeight),
		});
		const { position, rotation, envCellId } = camera.placement;
		target.setAudioListener({
			position: sceneVector3([position.x, position.y, position.z]),
			rotation,
			envCellId,
		});
	}

	const query = new URLSearchParams(window.location.search);
	const TRACE_TERRAIN_GL = query.get("traceTerrainGl") === "true";
	/** Exercise the depth-tested world-marker draw path in renderer screenshots. */
	const WORLD_MARKER = query.get("worldMarker") === "true";
	/** Harness-only loading screen demo; production frontends own this transition policy. */
	const PORTAL_TRANSITION_DEMO = query.get("portalTransitionDemo") === "true";
	let portalTransitionDemoFrames = 0;
	/** Sits above the runtime's conservative ±510 outdoor terrain bound. */
	const cameraHeightSource = query.get("cameraHeight");
	const CAMERA_HEIGHT =
		cameraHeightSource === null ? 600 : Number(cameraHeightSource);
	const INITIAL_VIEWPORT_WIDTH = parsePositiveIntegerQuery(
		query,
		"viewportWidth",
		1_280,
	);
	const INITIAL_VIEWPORT_HEIGHT = parsePositiveIntegerQuery(
		query,
		"viewportHeight",
		720,
	);
	/**
	 * Regional day fraction used to resolve lighting and fog. Absent means the harness keeps
	 * the runtime's unauthored-lighting default instead of resolving the active region.
	 */
	const PARTICLE_SEED = query.get("particleSeed");
	/**
	 * Record every voice the runtime starts and every audio-control placement it receives.
	 *
	 * Replaces the refusing stub device so live-placement evidence exists headlessly: the harness
	 * cannot listen, but a gain/pan series over a camera flyby proves what a listener would hear.
	 */
	const AUDIO_TRACE = query.get("audioTrace") === "1";
	type AuthoredDynamicDiagnostics = ReturnType<
		GamePresentationRuntime["getAuthoredDynamicRuntimeDiagnostics"]
	>;

	interface AudioTraceSample {
		readonly frame: number;
		readonly gain: number;
		readonly pan: number;
		readonly step: number;
	}

	interface AudioTraceVoice {
		readonly soundId: string;
		/** Flyby step active when the voice started; -1 outside a flyby. */
		readonly startedAtStep: number;
		/** Trigger-time placement first, then one sample per `setPlacement`. */
		readonly samples: AudioTraceSample[];
		stopped: boolean;
	}

	interface AudioTraceSnapshot {
		readonly ambient: AuthoredDynamicDiagnostics["ambient"];
		readonly ambientBakes: AuthoredDynamicDiagnostics["ambientBakes"];
		readonly audio: AuthoredDynamicDiagnostics["audio"];
		readonly voices: readonly {
			readonly samples: readonly AudioTraceSample[];
			readonly soundId: string;
			readonly startedAtStep: number;
			readonly stopped: boolean;
		}[];
	}
	const audioTraceVoices: AudioTraceVoice[] = [];
	let audioFlybyStep = -1;
	/**
	 * Whether the active region carried ambient records at all, for diagnosing a silent flyby:
	 * "no sound authored" and "installed but produced nothing" need different investigations.
	 */
	let ambientRegionEvidence: { hasScenes: boolean; hasSound: boolean } | null =
		null;

	/** Always-ready device whose voices record their steering instead of producing sound. */
	function recordingAudioDevice() {
		return {
			playOneShot: (soundId: string, gain: number, pan: number) => {
				const voice: AudioTraceVoice = {
					samples: [{ frame: frames, gain, pan, step: audioFlybyStep }],
					soundId,
					startedAtStep: audioFlybyStep,
					stopped: false,
				};
				audioTraceVoices.push(voice);
				return {
					finished: false,
					setPlacement: (nextGain: number, nextPan: number) => {
						voice.samples.push({
							frame: frames,
							gain: nextGain,
							pan: nextPan,
							step: audioFlybyStep,
						});
					},
					stop: () => {
						voice.stopped = true;
					},
				};
			},
			prepare: async () => {},
		};
	}

	/** Capture only placement samples added since the supplied per-voice offsets. */
	function audioTraceSnapshot(
		sampleOffsets: readonly number[],
	): AudioTraceSnapshot {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		const dynamics = runtime.getAuthoredDynamicRuntimeDiagnostics();
		return {
			ambient: dynamics.ambient,
			ambientBakes: dynamics.ambientBakes,
			audio: dynamics.audio,
			voices: audioTraceVoices.flatMap((voice, index) => {
				const samples = voice.samples.slice(sampleOffsets[index] ?? 0);
				if (samples.length === 0) return [];
				return [
					{
						samples,
						soundId: voice.soundId,
						startedAtStep: voice.startedAtStep,
						stopped: voice.stopped,
					},
				];
			}),
		};
	}
	/**
	 * Fixed milliseconds of runtime time per frame, or null to follow the wall clock.
	 *
	 * The runtime takes its whole notion of time as one argument to `render`, so nothing inside it
	 * changes: this only chooses what the harness passes. With a value set, particle ages, animation
	 * clocks, and script schedules advance identically between runs, which is what makes screenshot
	 * comparison possible. Frame *cost* is still measured against the real clock, so timing runs are
	 * unaffected either way.
	 */
	const FRAME_INTERVAL_MS = query.get("frameIntervalMs");
	/**
	 * Frame at which runtime time stops advancing, or null to keep advancing.
	 *
	 * A fixed interval alone is not reproducible: capture happens after a wall-clock settle, so two
	 * runs screenshot at different frame counts and therefore different simulation times. Freezing
	 * makes the captured instant identical no matter when the screenshot lands.
	 */
	const CAPTURE_FRAME = query.get("captureFrame");
	const TIME_OF_DAY = query.get("timeOfDay");
	const DAY_GROUP = query.get("dayGroup");
	const ISOLATE_AUTHORED_DYNAMICS =
		query.get("isolateAuthoredDynamics") === "true";
	const EXCLUDE_AUTHORED_DYNAMICS =
		query.get("excludeAuthoredDynamics") === "true";
	const EXCLUDE_SPAWNED_ATTACHMENTS =
		query.get("excludeSpawnedAttachments") === "true";
	if (!Number.isFinite(CAMERA_HEIGHT)) {
		throw new Error("Browser harness camera height must be finite.");
	}

	interface BrowserHarnessApi {
		/** Resolve one target and request its exact shared scene-interest policy. */
		readonly requestSceneInterest: (
			landblockId: string,
			terrainRadius: number,
			buildingRadius: number,
			envCellRadius: number | null,
			explicitObjectRadius: number | null,
			generatedObjectRadius: number | null,
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
		) => Promise<void>;
		/**
		 * Fly the outdoor camera in a straight line to the target landblock's centre over the given
		 * duration, replacing outdoor scene interest on every landblock crossing — the harness
		 * mirror of the Explorer's outdoor interest-follows-camera mode. Resolves with the crossing
		 * log, audio trace (when enabled), and the flight window's frame timing.
		 */
		readonly runFollowFlight: (
			targetLandblockId: string,
			durationMs: number,
		) => Promise<BrowserHarnessFollowFlightReport>;
		/** Move only the render-world anchor; current scene interest remains installed. */
		readonly setCameraLandblock: (
			landblockId: string,
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
		) => void;
		/** Place the continuous camera at one explicit outdoor world-space pose. */
		readonly setOutdoorCamera: (
			landblockId: string,
			position: readonly [number, number, number],
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
		) => void;
		/** Apply the Explorer's automatic outdoor focus policy after terrain becomes queryable. */
		readonly focusExplorerOutdoor: (
			landblockId: string,
		) => BrowserHarnessCameraEvidence;
		/** Apply the resolved target's Explorer focus policy, including dungeon default-cell focus. */
		readonly focusExplorerTarget: (
			target: string,
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
		) => BrowserHarnessCameraEvidence;
		/** Place the camera at the contained bounds center of one authored EnvCell. */
		readonly focusExplorerEnvCell: (
			envCellId: string,
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
		) => BrowserHarnessCameraEvidence;
		/** Place the continuous camera at one authoritative EnvCell pose. */
		readonly setEnvCellCamera: (
			envCellId: string,
			position: readonly [number, number, number],
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
		) => void;
		/** Change EnvCell rendering policy without changing camera placement or scene interest. */
		readonly setEnvCellRenderMode: (
			envCellRenderMode: "flat" | "portal",
		) => void;
		/** Toggle one existing production layer solely for workload isolation. */
		readonly setLayerVisibility: (
			layer: keyof FrameSettings["layerVisibility"],
			visible: boolean,
		) => void;
		/** Change filterable texture quality without changing content or resources. */
		readonly setTextureFiltering: (policy: string) => void;
		/** Change the generic portal-footprint cutoff without rebuilding content. */
		readonly setMinimumPortalFootprintCssPixelArea: (pixelArea: number) => void;
		/** Change shared object-footprint policy without rebuilding content. */
		readonly setMinimumObjectFootprintCssPixelArea: (pixelArea: number) => void;
		/** Change device pixels per CSS pixel, which is also the only anti-aliasing control. */
		readonly setRenderScale: (renderScale: number) => void;
		/** Replace the complete validated entity-shadow policy without rebuilding content. */
		readonly setEntityShadowSettings: (settings: EntityShadowSettings) => void;
		/** Select one exhaustive shadow mode while retaining inactive appearance parameters. */
		readonly setEntityShadowMode: (mode: EntityShadowMode) => void;
		/** Change offscreen visual animation cadence without changing semantic advancement. */
		readonly setOffscreenAnimationSampleIntervalSeconds: (
			intervalSeconds: number,
		) => void;
		/** Reset steady-state frame timing after asynchronous content publication settles. */
		readonly resetTiming: () => void;
		/** Reset harness-only terrain GL counters after the requested scene is configured. */
		readonly resetTerrainGlTrace: () => void;
		/** Explicitly enable or tear down renderer CPU/GPU profiling. */
		readonly setFrameProfiling: (enabled: boolean) => void;
		/** Size how far the next frame's baked object draws could merge. */
		readonly captureBakedDrawMergeCensus: () => Promise<BakedDrawMergeCensus>;
		/** Toggle near-field ambient occlusion without rebuilding content. */
		readonly setAmbientOcclusion: (enabled: boolean) => void;
		/** Toggle the harness-only AO distance-category view and one-shot depth census. */
		readonly setAmbientOcclusionCoverageVisualization: (
			enabled: boolean,
		) => void;
		/** Apply one authored presentation grade, or `null` to present ungraded. */
		readonly setColorGrade: (parameters: ColorGradeParameters | null) => void;
		/** Toggle authored outdoor lamps, to measure their cost against an identical scene. */
		readonly setStaticLights: (enabled: boolean) => void;
		/** Toggle degradation-hidden geometry without rebuilding loaded scene content. */
		readonly setShowRetailHiddenGeometry: (visible: boolean) => void;
		/** Toggle authored weather, mirroring retail's `DisableMostWeatherEffects` player option. */
		readonly setWeather: (enabled: boolean) => void;
		/** Withdraw every requested scene layer while retaining the harness runtime. */
		readonly clearSceneInterest: () => void;
		/**
		 * Draw one overhead-map frame onto a harness-owned canvas and report what it drew.
		 *
		 * Pass `visible: false` to retire the canvas without tearing the map down. Centre defaults
		 * to the current camera position; heading is explicit rather than derived from camera yaw,
		 * because the map's bearing convention is not settled until the compass panel exists.
		 */
		readonly configureMap: (request: {
			readonly size?: number;
			readonly visible?: boolean;
			readonly centerX?: number;
			readonly centerY?: number;
			readonly centerZ?: number;
			readonly viewDiameter?: number;
			readonly headingRadians?: number;
		}) => BrowserHarnessMapEvidence;
		/** Spawn one real catalog-backed entity through the app-local host and shared runtime. */
		readonly spawnExplorerEntity: (
			wcid: string,
			distance: number,
		) => Promise<DynamicEntityView>;
		/** Spawn one simulated body for deterministic host-solver scenarios. */
		readonly spawnSimulatedExplorerEntity: (
			wcid: string,
			distance: number,
		) => Promise<DynamicEntityView>;
		/** Spawn many entities at exact camera-relative AC-axis offsets for pair/population runs. */
		readonly spawnExplorerEntityFleet: (
			wcid: string,
			offsets: readonly (readonly [number, number, number])[],
			physicalMode: "pose-only" | "integrated",
		) => Promise<readonly DynamicEntityView[]>;
		/** Retire every live harness-spawned generation through the same host lifecycle. */
		readonly despawnExplorerEntityFleet: () => Promise<number>;
		/** Apply catalog-authored launch speed/spin to one exact generation. */
		readonly launchExplorerEntity: (
			guid: number,
			generation: number,
			direction: readonly [number, number, number],
		) => Promise<DynamicEntityView>;
		/** Advance the host collection by one explicit deterministic duration. */
		readonly tickExplorerEntities: (
			durationMilliseconds: number,
		) => Promise<ExplorerFixedTickEnvelope | null>;
		/** Acquire or release exact host possession without browser input synthesis. */
		readonly possessExplorerEntity: (
			guid: number | null,
		) => Promise<ExplorerPossession>;
		/** Replace one generation-bound semantic possession snapshot. */
		readonly setPossessionIntent: (
			request: ExplorerPossessionIntent,
		) => Promise<string>;
		/** Queue one ordered jump/reset edge with its complete contemporaneous snapshot. */
		readonly queuePossessionEvent: (
			request: ExplorerPossessionEventRequest,
		) => Promise<PossessionEventQueueReceipt>;
		/** Advance and project one deterministic possession tick plus lifecycle outcomes. */
		readonly tickPossession: (
			durationMilliseconds: number,
		) => Promise<PossessionTickResponse>;
		/** Read the host's exact active stance/substate/modifier/clip projection. */
		readonly possessionMotionProbe: () => Promise<PossessionMotionProbe | null>;
		/** Register one exact boom generation through the production-shaped host adapter. */
		readonly startKinematicBoom: (
			request: Omit<
				HttpKinematicBoomStartRequest,
				"clearanceRadius" | "projectionRevision"
			>,
		) => Promise<HostKinematicBoomIdentity>;
		/** Replace semantic boom intent while retaining cumulative wheel displacement. */
		readonly setKinematicBoomIntent: (
			request: HttpKinematicBoomIntentRequest,
		) => Promise<"accepted" | "ignored-stale">;
		/** Resize the canvas and request the matching runtime-FOV projection from the active boom. */
		readonly reprojectKinematicBoom: (
			width: number,
			height: number,
			fov: number,
		) => Promise<ProjectionClearanceRevision>;
		/** Stop one exact boom generation without affecting a replacement generation. */
		readonly stopKinematicBoom: (
			identity: HostKinematicBoomIdentity,
		) => Promise<boolean>;
		/** Read the production pivot-to-camera direction for the current harness view. */
		readonly kinematicBoomDirection: () => readonly [number, number, number];
		/** Measure whether one possessed target is in front of the presented boom camera. */
		readonly probeBoomFraming: (guid: number) => {
			readonly planarCameraToTargetDistance: number;
			readonly planarForwardAlignment: number;
			readonly planarForwardProjection: number;
		};
		/** Wait for presentation and return camera plus renderer selection state. */
		readonly probeNextFrameState: () => Promise<{
			readonly boomProjection: {
				readonly active: ProjectionClearanceRevision | null;
				readonly requested: ProjectionClearanceRevision | null;
			};
			readonly camera: BrowserHarnessCameraEvidence | null;
			readonly envCellRenderMode: "flat" | "portal";
			readonly metrics: FrameSelectionMetrics | null;
		}>;
		/** Exercise the compiled shared third-person router/look/boom ownership in-browser. */
		readonly probeThirdPersonControls: () => Promise<{
			readonly boomZoomDisplacement: number;
			readonly cameraYawAfterKeyboardTurn: number;
			readonly cameraYawBefore: number;
			readonly characterInputCountAfterKeyboard: number;
			readonly characterInputCountAfterPointerAndWheel: number;
			readonly possessionOrbitDelta: readonly [number, number] | null;
			readonly recenterAfterYaw: number;
			readonly recenterBeforeYaw: number;
			readonly recenterMidYaw: number;
			readonly recenterPitch: number;
			readonly recenterTrackingYaw: number;
		}>;
		/** Apply a host-resolved discontinuity and synchronously snap frontend placement. */
		readonly relocateExplorerEntity: (
			guid: number,
			generation: number,
			distance: number,
			kind: "teleport" | "reset",
		) => Promise<DynamicEntityEvent>;
		/** Retire one exact harness-spawned generation through the same host lifecycle. */
		readonly despawnExplorerEntity: (
			guid: number,
			generation: number,
		) => Promise<void>;
		/** Exercise the public portal compositor without changing continuous frame settings. */
		readonly probePortalExecution: (
			envCellId: string,
			position: readonly [number, number, number],
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
		) => PortalExecutionProbeResult;
		/** Sweep the camera past an audio emitter over discrete steps and record voice gains/pans. */
		readonly probeAudioFlyby: (
			rawLandblockId: string,
			from: readonly [number, number, number],
			to: readonly [number, number, number],
			steps: number,
			framesPerStep: number,
			cameraYawDegrees: number,
			cameraPitchDegrees: number,
		) => Promise<{
			readonly ambientRegion: unknown;
			readonly ambientBakes: unknown;
			readonly ambient: unknown;
			readonly audio: unknown;
			readonly steps: number;
			readonly voices: readonly {
				readonly samples: readonly {
					readonly gain: number;
					readonly pan: number;
					readonly step: number;
				}[];
				readonly soundId: string;
				readonly startedAtStep: number;
				readonly stopped: boolean;
			}[];
		}>;
		/** Snapshot lifecycle evidence without exposing runtime ownership. */
		readonly state: () => BrowserHarnessState;
	}

	interface BrowserHarnessState {
		/** Last harness-authored camera pose, retained to prove benchmark parity. */
		readonly camera: BrowserHarnessCameraEvidence | null;
		readonly error: string | null;
		readonly frames: number;
		readonly metrics: FrameSelectionMetrics | null;
		readonly ambientOcclusionCoverageCensus: ReturnType<
			WebGL2Renderer["getAmbientOcclusionCoverageCensus"]
		>;
		/** Latest explicit renderer profile, or null while profiling is disabled. */
		readonly frameProfile: RendererFrameProfile | null;
		readonly tickProfile: ReturnType<
			GamePresentationRuntime["getTickProfile"]
		> | null;
		readonly authoredDynamics: AuthoredDynamicDiagnostics | null;
		/** Required authored portal closure and transition cursor/resource evidence. */
		readonly portalTransition: PortalTransitionRuntimeDiagnostics | null;
		readonly frameSettings: FrameSettings;
		/** Cold shadow-target ownership used by same-runtime toggle and resize fixtures. */
		readonly entityShadowResources: EntityShadowResourceDiagnostics | null;
		readonly textureFilteringCapabilities: TextureFilteringCapabilities | null;
		/** Browser main-thread timing facts accumulated during this harness session. */
		readonly timing: BrowserHarnessTiming;
		readonly staticObjects: StaticObjectRuntimeDiagnostics | null;
		/** Dedicated terrain generation queue and transfer facts. */
		readonly terrainWorker: ClosedWorkerPoolDiagnostics | null;
		/** Harness-only calls observed while the far terrain program was active. */
		readonly terrainGlTrace: TerrainGlTrace | null;
		/** Layer-separated static diagnostics prove outdoor-static lifetimes stay distinct. */
		readonly staticObjectLayers: {
			readonly buildings: readonly StaticObjectLayerRuntimeDiagnostics[];
			readonly generated: readonly StaticObjectLayerRuntimeDiagnostics[];
			readonly objects: readonly StaticObjectLayerRuntimeDiagnostics[];
		};
		/** Whole-device invalidation proof from an isolated browser context. */
		readonly portalContextLossPolicy: WebGL2ContextLossPolicyProbe | null;
		/** Browser allocation evidence for the selected scope-atlas target generation. */
		readonly portalScopeAtlasTargets: WebGL2PortalScopeAtlasTargetsFixtureResult | null;
		/** Numeric real-GPU evidence for the scope-atlas shader executor. */
		readonly portalScopeAtlasExecutor: WebGL2PortalScopeAtlasExecutorFixtureResult | null;
		/** Real-browser depth-array and caster-program evidence for outdoor PSSM. */
		readonly outdoorPssm: WebGL2PssmFixtureResult | null;
		/** One read-only observation for every host source-batch response received by this harness. */
		readonly sourceBatches: readonly HttpLandblockSourceBatchDiagnostic[];
		/** One read-only observation for every profile transport request. */
		readonly profiles: readonly HttpLandblockProfileDiagnostic[];
		/** Complete static demand selected by the current scene target. */
		readonly sceneInterest: BrowserHarnessSceneInterestEvidence | null;
		/** Current harness-only projection of the app-local host registry. */
		readonly spawnedEntities: readonly DynamicEntityView[];
		readonly ready: boolean;
		/** CSS and physical viewport dimensions that determine visible work. */
		readonly viewport: BrowserHarnessViewportEvidence;
	}

	interface BrowserHarnessSceneInterestEvidence {
		readonly interest: readonly BrowserHarnessSceneInterestEntry[];
		readonly resolvedTarget: ReturnType<
			GamePresentationRuntime["sceneInterestState"]
		>["resolvedTarget"];
	}

	interface BrowserHarnessSceneInterestEntry {
		readonly landblockId: LandblockOwnerId;
		readonly layers: readonly LandblockLayerKind[];
	}

	/** One scripted follow-mode flight's evidence: crossings, publications, and timing. */
	interface BrowserHarnessFollowFlightReport {
		/** Audio admissions and bounded placement updates observed during the flight. */
		readonly audioTrace: AudioTraceSnapshot | null;
		/** Outdoor-interest crossings in flight order, stamped with elapsed flight time. */
		readonly crossings: readonly {
			readonly elapsedMs: number;
			readonly landblockId: LandblockOwnerId;
		}[];
		readonly durationMs: number;
		/** Outdoor static layer publications that landed during the flight window. */
		readonly staticLayerPublicationCount: number;
		/** Cumulative dedicated terrain-worker facts at flight completion. */
		readonly terrainWorker: ClosedWorkerPoolDiagnostics;
		/** Frame timing accumulated across the flight; reset when the flight starts. */
		readonly timing: BrowserHarnessTiming;
	}

	/** In-progress scripted flight, advanced by the frame loop until its duration elapses. */
	interface FollowFlightState {
		/** The destination pose is installed and the promise should resolve after this render. */
		completionPending: boolean;
		/** Latest profile-aware scene-interest transition started during this flight. */
		sceneInterestReady: Promise<void> | null;
		readonly crossings: { elapsedMs: number; landblockId: LandblockOwnerId }[];
		readonly durationMs: number;
		readonly from: Vec3;
		readonly pitchDegrees: number;
		/** Active projection retained while scripted movement changes only the outdoor pose. */
		readonly projection: Pick<Camera, "far" | "fov" | "near">;
		readonly radii: SceneInterestRadii;
		readonly reject: (cause: Error) => void;
		readonly resolve: (report: BrowserHarnessFollowFlightReport) => void;
		readonly startAudioSampleCounts: readonly number[];
		readonly startPublicationCount: number;
		readonly startedAt: number;
		readonly to: Vec3;
		readonly yawDegrees: number;
	}

	interface BrowserHarnessCameraEvidence {
		/** Authoritative indoor residency, or null for an outdoor camera. */
		readonly envCellId: EnvCellId | null;
		readonly far: number;
		readonly fov: number;
		readonly landblockId: LandblockOwnerId;
		readonly near: number;
		readonly pitchDegrees: number;
		readonly policy:
			| "explicit-env-cell"
			| "explicit-outdoor"
			| "explorer-outdoor-focus"
			| "host-boom";
		readonly position: readonly [number, number, number];
		readonly yawDegrees: number;
	}

	/** One overhead-map draw, reported so a screenshot can be judged against known state. */
	interface BrowserHarnessMapEvidence {
		/** False once the map's own WebGL2 context is lost. */
		readonly available: boolean;
		/** Whether the draw produced pixels; outdoors waits for the region palette. */
		readonly drew: boolean;
		/** Landblocks resident on the map's context after syncing. */
		readonly residentLandblockCount: number;
		/** Terrain installation revision the map last synced against. */
		readonly terrainInstallationRevision: number;
		readonly paletteReady: boolean;
		readonly centerX: number;
		readonly centerZ: number;
		readonly viewDiameter: number;
		/** Authored height span across resident terrain, proving relief reaches the map at all. */
		readonly heightRange: readonly [number, number];
		/** Distinct authored terrain codes resident, proving the palette has something to vary. */
		readonly distinctTerrainCodes: readonly number[];
		/** Vertices carrying a road classification. */
		readonly roadVertexCount: number;
		/** Which mode the anchor's residency selected. */
		readonly mode: "outdoor" | "indoor";
		/**
		 * Entities the map would draw, read from the scene rather than any published snapshot.
		 *
		 * Sampled here so a probe can prove the position moves between ticks: the diagnostics
		 * snapshot deliberately does not republish on ordinary advances, and the map must not
		 * depend on it.
		 */
		readonly presentedEntities: {
			readonly count: number;
			readonly firstWorldX: number | null;
			readonly firstWorldZ: number | null;
			/** Extracted facing of the first entity, in degrees clockwise from north. */
			readonly firstHeadingDegrees: number | null;
		};
		/** Derived map geometry resident in the runtime store. */
		readonly geometry: {
			readonly revision: number;
			readonly blockerLandblockCount: number;
			readonly blockerInstanceCount: number;
			readonly interiorLandblockCount: number;
			readonly floorInstanceCount: number;
			readonly crossingCount: number;
		};
	}

	interface BrowserHarnessViewportEvidence {
		readonly cssHeight: number;
		readonly cssWidth: number;
		readonly devicePixelRatio: number;
		readonly pixelHeight: number;
		readonly pixelWidth: number;
	}

	interface BrowserHarnessTiming {
		readonly sampleCount: number;
		readonly averageTickMs: number;
		readonly averageRenderMs: number;
		readonly averageFrameWorkMs: number;
		readonly longestTickMs: number;
		readonly longestRenderMs: number;
		readonly longestFrameWorkMs: number;
		/** Largest requestAnimationFrame gap after the harness began drawing. */
		readonly longestFrameGapMs: number;
		/** Long Task API events observed while this harness was mounted. */
		readonly longTaskCount: number;
		/** Largest Long Task API event duration. */
		readonly longestLongTaskMs: number;
	}

	interface BrowserHarnessTimingAccumulator {
		sampleCount: number;
		totalTickMs: number;
		totalRenderMs: number;
		longestTickMs: number;
		longestRenderMs: number;
		longestFrameWorkMs: number;
		longestFrameGapMs: number;
		longTaskCount: number;
		longestLongTaskMs: number;
	}

	interface HarnessGlobal {
		__HOLTBURGER_3D_BROWSER_HARNESS__?: BrowserHarnessApi;
	}

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let mapCanvasElement: HTMLCanvasElement | null = $state(null);
	let mapCanvasSize = $state(0);
	let mapRenderer: MapRenderer | null = null;
	let error: string | null = $state(null);
	let frames = 0;
	let lastFrameAt: number | undefined;
	let timing: BrowserHarnessTimingAccumulator = {
		sampleCount: 0,
		totalTickMs: 0,
		totalRenderMs: 0,
		longestTickMs: 0,
		longestRenderMs: 0,
		longestFrameWorkMs: 0,
		longestFrameGapMs: 0,
		longTaskCount: 0,
		longestLongTaskMs: 0,
	};
	let contentSource: HttpLandblockContentSource | undefined;
	let landblockProfileSource: CachedLandblockProfileSource | undefined;
	let sceneInterestCoordinator: SceneInterestRequestCoordinator | undefined;
	let entityHost: HttpExplorerEntityHost | undefined;
	let boomCameraSession: HostKinematicBoomSession | undefined;
	let boomInputSequence = 0;
	let boomCumulativeZoomDisplacement = 0;
	let boomStopResult = false;
	let boomProjectionRevision = 0;
	let requestedBoomProjection: ProjectionClearanceRevision | null = null;
	let activeBoomProjection: ProjectionClearanceRevision | null = null;
	let viewportWidth = $state(INITIAL_VIEWPORT_WIDTH);
	let viewportHeight = $state(INITIAL_VIEWPORT_HEIGHT);
	let spawnedEntities: readonly DynamicEntityView[] = [];
	let runtime: GamePresentationRuntime | undefined;
	let renderer: WebGL2Renderer | undefined;
	let textureFilteringCapabilities: TextureFilteringCapabilities | null = null;
	let cameraEvidence: BrowserHarnessCameraEvidence | null = null;
	/** Owner and radii of the most recent interest request, reused by outdoor follow flights. */
	let lastInterestLandblockId: LandblockOwnerId | null = null;
	let lastInterestRadii: SceneInterestRadii | null = null;
	let followFlight: FollowFlightState | null = null;
	let frameSettings: FrameSettings = {
		...EXPLORER_TUNING.frameSettings,
		envCellRenderMode: "flat",
	};
	let portalContextLossPolicy: WebGL2ContextLossPolicyProbe | null = null;
	let portalScopeAtlasTargets: WebGL2PortalScopeAtlasTargetsFixtureResult | null =
		null;
	let portalScopeAtlasExecutor: WebGL2PortalScopeAtlasExecutorFixtureResult | null =
		null;
	let outdoorPssm: WebGL2PssmFixtureResult | null = null;
	let ready = false;
	const fixture = query.get("fixture");

	function parseOutdoorLandblockId(value: string): LandblockOwnerId {
		const match = /^(?:0x)?([0-9a-f]{4})(?:[0-9a-f]{4})?$/i.exec(value.trim());
		if (!match) {
			throw new Error(
				"Browser harness landblock id must contain four or eight hexadecimal digits.",
			);
		}
		return `0x${match[1]!.toLowerCase()}ffff`;
	}

	function sceneInterestEvidence(): BrowserHarnessSceneInterestEvidence | null {
		const state = runtime?.sceneInterestState();
		if (state === undefined) return null;
		const entries = (
			interest: ReturnType<
				GamePresentationRuntime["sceneInterestState"]
			>["interest"],
		): readonly BrowserHarnessSceneInterestEntry[] =>
			[...interest.entries()].map(([landblockId, layers]) => ({
				landblockId,
				layers: [...layers],
			}));
		return {
			interest: entries(state.interest),
			resolvedTarget: state.resolvedTarget,
		};
	}

	async function requestSceneInterest(
		rawLandblockId: string,
		terrainRadius: number,
		buildingRadius: number,
		envCellRadius: number | null,
		explicitObjectRadius: number | null,
		generatedObjectRadius: number | null,
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
	): Promise<void> {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		if (!Number.isInteger(terrainRadius) || terrainRadius < 0) {
			throw new Error(
				"Browser harness terrain radius must be a non-negative integer.",
			);
		}
		if (
			!Number.isInteger(buildingRadius) ||
			buildingRadius < 0 ||
			buildingRadius > terrainRadius
		) {
			throw new Error(
				"Browser harness building radius must be a non-negative integer no greater than terrain radius.",
			);
		}
		if (
			envCellRadius !== null &&
			(!Number.isInteger(envCellRadius) ||
				envCellRadius < 0 ||
				envCellRadius > buildingRadius)
		) {
			throw new Error(
				"Browser harness EnvCell radius must be a non-negative integer no greater than building radius.",
			);
		}
		if (
			explicitObjectRadius !== null &&
			(!Number.isInteger(explicitObjectRadius) ||
				explicitObjectRadius < 0 ||
				explicitObjectRadius > buildingRadius)
		) {
			throw new Error(
				"Browser harness explicit-object radius must be a non-negative integer no greater than building radius.",
			);
		}
		if (
			generatedObjectRadius !== null &&
			(!Number.isInteger(generatedObjectRadius) ||
				generatedObjectRadius < 0 ||
				generatedObjectRadius > buildingRadius)
		) {
			throw new Error(
				"Browser harness generated-object radius must be a non-negative integer no greater than building radius.",
			);
		}
		if (![cameraYawDegrees, cameraPitchDegrees].every(Number.isFinite)) {
			throw new Error("Browser harness camera orientation must be finite.");
		}
		const parsed = parseResidenceInput(rawLandblockId);
		if (parsed === null) {
			throw new Error(`Browser harness target is invalid: ${rawLandblockId}.`);
		}
		const requestCoordinator = sceneInterestCoordinator;
		if (!requestCoordinator) {
			throw new Error(
				"Browser harness scene-interest coordinator is not ready.",
			);
		}
		const usesGeneratedFixture = fixture === "instanced";
		const requestedRadii: SceneInterestRadii = {
			buildingRadius: usesGeneratedFixture ? null : buildingRadius,
			envCellRadius,
			explicitObjectRadius,
			generatedObjectRadius: usesGeneratedFixture
				? buildingRadius
				: generatedObjectRadius,
			terrainRadius,
		};
		const request = requestCoordinator.request(parsed.target, requestedRadii);
		const resolved = await request.promise;
		if (!requestCoordinator.isCurrent(request.revision)) return;
		const landblockId = parsed.residency.landblockId;
		if (!entityHost) {
			throw new Error("Browser harness simulation-interest host is not ready.");
		}
		await entityHost.ensureSimulationInterest(landblockId);
		runtime.updateSceneInterest(resolved);
		lastInterestLandblockId = landblockId;
		lastInterestRadii = requestedRadii;
		setCameraLandblock(landblockId, cameraYawDegrees, cameraPitchDegrees);
	}

	function setCameraLandblock(
		rawLandblockId: string,
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
	): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		const landblockId = parseOutdoorLandblockId(rawLandblockId);
		const origin = createLandblockWorldOrigin(landblockId);
		const position = new Vec3(
			origin.x + OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
			CAMERA_HEIGHT,
			origin.z - OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
		);
		setOutdoorCamera(
			landblockId,
			[position.x, position.y, position.z],
			cameraYawDegrees,
			cameraPitchDegrees,
		);
	}

	function setOutdoorCamera(
		rawLandblockId: string,
		position: readonly [number, number, number],
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
	): void {
		setOutdoorCameraProjection(
			rawLandblockId,
			position,
			cameraYawDegrees,
			cameraPitchDegrees,
			{ far: CAMERA_FAR, fov: CAMERA_FOV_DEGREES, near: CAMERA_NEAR },
		);
	}

	/** Place an outdoor camera without changing the projection owned by its calling policy. */
	function setOutdoorCameraProjection(
		rawLandblockId: string,
		position: readonly [number, number, number],
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
		projection: Pick<Camera, "far" | "fov" | "near">,
	): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		if (
			position.length !== 3 ||
			!position.every(Number.isFinite) ||
			![cameraYawDegrees, cameraPitchDegrees].every(Number.isFinite)
		) {
			throw new Error(
				"Browser harness outdoor camera requires a finite position and orientation.",
			);
		}
		const landblockId = parseOutdoorLandblockId(rawLandblockId);
		const cameraPosition = new Vec3(...position);
		applyHarnessCamera(runtime, {
			...projection,
			placement: {
				envCellId: null,
				landblockId,
				position: sceneVec3(cameraPosition),
				rotation: cameraRotation(cameraYawDegrees, cameraPitchDegrees),
			},
		});
		installWorldIndicatorFixture(
			cameraPosition,
			cameraYawDegrees,
			cameraPitchDegrees,
			"outdoor",
		);
		cameraEvidence = {
			...projection,
			envCellId: null,
			landblockId,
			pitchDegrees: cameraPitchDegrees,
			policy: "explicit-outdoor",
			position,
			yawDegrees: cameraYawDegrees,
		};
	}

	/** Begin a scripted outdoor follow-mode flight; see the BrowserHarnessApi entry for semantics. */
	async function runFollowFlight(
		rawTargetLandblockId: string,
		durationMs: number,
	): Promise<BrowserHarnessFollowFlightReport> {
		const activeRuntime = runtime;
		if (!activeRuntime)
			throw new Error("Browser harness runtime is not ready.");
		if (!Number.isFinite(durationMs) || durationMs <= 0) {
			throw new Error(
				"Browser harness follow flight duration must be a positive number of milliseconds.",
			);
		}
		if (followFlight !== null) {
			throw new Error("Browser harness follow flight is already running.");
		}
		const radii = lastInterestRadii;
		if (radii === null) {
			throw new Error(
				"Browser harness follow flight requires a prior scene-interest request.",
			);
		}
		const evidence = cameraEvidence;
		if (evidence === null || evidence.envCellId !== null) {
			throw new Error(
				"Browser harness follow flight requires a current outdoor camera.",
			);
		}
		const targetLandblockId = parseOutdoorLandblockId(rawTargetLandblockId);
		const origin = createLandblockWorldOrigin(targetLandblockId);
		// Fly level at the current camera height to the target landblock's centre.
		const to = new Vec3(
			origin.x + OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
			evidence.position[1],
			origin.z - OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
		);
		const from = new Vec3(...evidence.position);
		const startPublicationCount =
			activeRuntime.getStaticObjectRuntimeDiagnostics()
				.staticLayerPublicationCount;
		resetTiming();
		return new Promise<BrowserHarnessFollowFlightReport>((resolve, reject) => {
			followFlight = {
				completionPending: false,
				crossings: [],
				durationMs,
				from,
				pitchDegrees: evidence.pitchDegrees,
				projection: {
					far: evidence.far,
					fov: evidence.fov,
					near: evidence.near,
				},
				radii,
				reject,
				resolve,
				sceneInterestReady: null,
				startAudioSampleCounts: audioTraceVoices.map(
					(voice) => voice.samples.length,
				),
				startPublicationCount,
				startedAt: performance.now(),
				to,
				yawDegrees: evidence.yawDegrees,
			};
		});
	}

	/**
	 * Advance the scripted outdoor flight one frame: move the camera along the line and, on a
	 * landblock crossing, replace scene interest with the outdoor radii centered there.
	 */
	function advanceFollowFlight(now: number): void {
		const flight = followFlight;
		const activeRuntime = runtime;
		if (flight === null || !activeRuntime) return;
		const fraction = Math.min(1, (now - flight.startedAt) / flight.durationMs);
		const position = new Vec3(
			flight.from.x + (flight.to.x - flight.from.x) * fraction,
			flight.from.y + (flight.to.y - flight.from.y) * fraction,
			flight.from.z + (flight.to.z - flight.from.z) * fraction,
		);
		const landblockId = landblockAtWorldPoint(position);
		if (landblockId === null) {
			followFlight = null;
			flight.reject(
				new Error("Browser harness follow flight left canonical world bounds."),
			);
			return;
		}
		if (landblockId !== lastInterestLandblockId) {
			lastInterestLandblockId = landblockId;
			const requestCoordinator = sceneInterestCoordinator;
			if (!requestCoordinator) {
				followFlight = null;
				flight.reject(
					new Error("Browser harness scene-interest coordinator is not ready."),
				);
				return;
			}
			const request = requestCoordinator.request(
				{ kind: "outdoor", landblockId },
				flight.radii,
			);
			flight.sceneInterestReady = request.promise
				.then((resolved) => {
					if (
						followFlight !== flight ||
						!requestCoordinator.isCurrent(request.revision)
					)
						return;
					activeRuntime.updateSceneInterest(resolved);
				})
				.catch((error: unknown) => {
					if (
						followFlight === flight &&
						requestCoordinator.isCurrent(request.revision)
					) {
						followFlight = null;
						flight.reject(
							error instanceof Error ? error : new Error(String(error)),
						);
					}
				});
			flight.crossings.push({
				elapsedMs: now - flight.startedAt,
				landblockId,
			});
		}
		setOutdoorCameraProjection(
			landblockId,
			[position.x, position.y, position.z],
			flight.yawDegrees,
			flight.pitchDegrees,
			flight.projection,
		);
		if (fraction < 1) return;
		flight.completionPending = true;
	}

	/** Resolve a completed flight only after its destination pose has rendered and updated audio. */
	function completeFollowFlight(): void {
		const flight = followFlight;
		if (flight === null || !flight.completionPending || !runtime) return;
		if (flight.sceneInterestReady !== null) {
			const sceneInterestReady = flight.sceneInterestReady;
			flight.sceneInterestReady = null;
			void sceneInterestReady.then(() => completeFollowFlight());
			return;
		}
		followFlight = null;
		flight.resolve({
			audioTrace: AUDIO_TRACE
				? audioTraceSnapshot(flight.startAudioSampleCounts)
				: null,
			crossings: flight.crossings,
			durationMs: flight.durationMs,
			staticLayerPublicationCount:
				runtime.getStaticObjectRuntimeDiagnostics()
					.staticLayerPublicationCount - flight.startPublicationCount,
			terrainWorker: runtime.getTerrainWorkerDiagnostics(),
			timing: timingSnapshot(),
		});
	}

	function focusExplorerOutdoor(
		rawLandblockId: string,
	): BrowserHarnessCameraEvidence {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		const landblockId = parseOutdoorLandblockId(rawLandblockId);
		const pose = resolveExplorerOutdoorFocusPose(runtime, landblockId);
		if (!pose) {
			throw new Error(
				`Browser harness cannot apply Explorer focus before terrain ${landblockId} is queryable.`,
			);
		}
		applyHarnessCamera(runtime, {
			...EXPLORER_TUNING.camera.framing,
			placement: {
				envCellId: null,
				landblockId,
				position: sceneVec3(pose.position),
				rotation: createCameraRotationRadians(
					pose.yawRadians,
					pose.pitchRadians,
				),
			},
		});
		cameraEvidence = {
			...EXPLORER_TUNING.camera.framing,
			envCellId: null,
			landblockId,
			pitchDegrees: (pose.pitchRadians * 180) / Math.PI,
			policy: "explorer-outdoor-focus",
			position: [pose.position.x, pose.position.y, pose.position.z],
			yawDegrees: (pose.yawRadians * 180) / Math.PI,
		};
		return cameraEvidence;
	}

	function setEnvCellCamera(
		rawEnvCellId: string,
		position: readonly [number, number, number],
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
	): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		if (
			position.length !== 3 ||
			!position.every(Number.isFinite) ||
			![cameraYawDegrees, cameraPitchDegrees].every(Number.isFinite)
		) {
			throw new Error(
				"Browser harness portal frame requires a finite position and orientation.",
			);
		}
		const envCellId = parseEnvCellId(rawEnvCellId, "portal frame");
		const landblockId = `${envCellId.slice(0, 6)}ffff` as LandblockOwnerId;
		const cameraPosition = new Vec3(...position);
		applyHarnessCamera(runtime, {
			far: CAMERA_FAR,
			fov: CAMERA_FOV_DEGREES,
			near: CAMERA_NEAR,
			placement: {
				envCellId,
				landblockId,
				position: sceneVec3(cameraPosition),
				rotation: cameraRotation(cameraYawDegrees, cameraPitchDegrees),
			},
		});
		installWorldIndicatorFixture(
			cameraPosition,
			cameraYawDegrees,
			cameraPitchDegrees,
			envCellId,
		);
		cameraEvidence = {
			envCellId,
			far: CAMERA_FAR,
			fov: CAMERA_FOV_DEGREES,
			landblockId,
			near: CAMERA_NEAR,
			pitchDegrees: cameraPitchDegrees,
			policy: "explicit-env-cell",
			position,
			yawDegrees: cameraYawDegrees,
		};
	}

	/** Installs one synthetic semantic curve through the production world-indicator seam. */
	function installWorldIndicatorFixture(
		cameraPosition: Vec3,
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
		renderScopeKey: string,
	): void {
		if (!WORLD_MARKER || !runtime) return;
		const axes = createCameraAxesRadians(
			(cameraYawDegrees * Math.PI) / 180,
			(cameraPitchDegrees * Math.PI) / 180,
		);
		const durationSeconds = 1.5;
		const velocity = new Vec3(axes.forward.x * 8, 9, axes.forward.z * 8);
		const acceleration = new Vec3(0, -9.8, 0);
		const halfDurationSquared = 0.5 * durationSeconds * durationSeconds;
		const markerPosition = cameraPosition.add(
			new Vec3(
				velocity.x * durationSeconds + acceleration.x * halfDurationSquared,
				velocity.y * durationSeconds + acceleration.y * halfDurationSquared,
				velocity.z * durationSeconds + acceleration.z * halfDurationSquared,
			),
		);
		runtime.setWorldIndicator({
			marker: {
				color: [0.08, 0.48, 1, 0.9],
				normal: sceneVector3([0, 1, 0]),
				position: sceneVec3(markerPosition),
				radius: 0.65,
				renderScopeKey,
			},
			trajectory: {
				revision: 1,
				color: [0.08, 0.48, 1, 0.9],
				origin: sceneVec3(cameraPosition),
				velocity: [velocity.x, velocity.y, velocity.z],
				acceleration: [acceleration.x, acceleration.y, acceleration.z],
				durationSeconds,
				placements: [{ startFraction: 0, endFraction: 1, renderScopeKey }],
			},
		});
	}

	function focusExplorerEnvCell(
		rawEnvCellId: string,
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
	): BrowserHarnessCameraEvidence {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		const envCellId = parseEnvCellId(rawEnvCellId, "EnvCell focus");
		const landblockId = `${envCellId.slice(0, 6)}ffff` as LandblockOwnerId;
		const residency = { envCellId, landblockId };
		const bounds = runtime.queryEnvCellBounds(residency);
		if (bounds === null) {
			throw new Error(`EnvCell focus cannot find bounds for ${envCellId}.`);
		}
		const position = new Vec3(
			(bounds.min.x + bounds.max.x) * 0.5,
			(bounds.min.y + bounds.max.y) * 0.5,
			(bounds.min.z + bounds.max.z) * 0.5,
		);
		if (runtime.queryEnvCellPointContainment(residency, position) !== true) {
			throw new Error(
				`EnvCell focus bounds center is not contained by ${envCellId}.`,
			);
		}
		setEnvCellCamera(
			envCellId,
			[position.x, position.y, position.z],
			cameraYawDegrees,
			cameraPitchDegrees,
		);
		if (cameraEvidence === null) {
			throw new Error("EnvCell focus did not retain camera evidence.");
		}
		return cameraEvidence;
	}

	function focusExplorerTarget(
		rawTarget: string,
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
	): BrowserHarnessCameraEvidence {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		const parsed = parseResidenceInput(rawTarget);
		if (parsed === null) throw new Error(`Target is invalid: ${rawTarget}.`);
		const resolved = runtime.sceneInterestState().resolvedTarget;
		if (resolved === null) {
			throw new Error(
				"Explorer target focus requires resolved scene interest.",
			);
		}
		if (resolved.kind === "dungeon") {
			const envCellId =
				parsed.target.kind === "env-cell"
					? parsed.target.envCellId
					: (`${parsed.target.landblockId.slice(0, 6)}0100` as EnvCellId);
			return focusExplorerEnvCell(
				envCellId,
				cameraYawDegrees,
				cameraPitchDegrees,
			);
		}
		if (parsed.target.kind === "env-cell") {
			return focusExplorerEnvCell(
				parsed.target.envCellId,
				cameraYawDegrees,
				cameraPitchDegrees,
			);
		}
		return focusExplorerOutdoor(parsed.target.landblockId);
	}

	function setEnvCellRenderMode(envCellRenderMode: "flat" | "portal"): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		frameSettings = { ...frameSettings, envCellRenderMode };
		runtime.setFrameSettings(frameSettings);
	}

	async function spawnExplorerEntity(
		rawWcid: string,
		distance: number,
	): Promise<DynamicEntityView> {
		return spawnExplorerEntityWithMode(rawWcid, distance, "pose-only");
	}

	async function spawnSimulatedExplorerEntity(
		rawWcid: string,
		distance: number,
	): Promise<DynamicEntityView> {
		return spawnExplorerEntityWithMode(rawWcid, distance, "integrated");
	}

	async function spawnExplorerEntityWithMode(
		rawWcid: string,
		distance: number,
		physicalMode: "pose-only" | "integrated",
	): Promise<DynamicEntityView> {
		if (!runtime || !entityHost)
			throw new Error(
				"Browser harness entity spawn requires a current camera and runtime.",
			);
		const { direction, placement } = entityScenarioAnchor();
		await entityHost.ensureSimulationInterest(placement.residency.landblockId);
		const request = createExplorerSpawnRequest(
			parseExplorerWcid(rawWcid),
			placement,
			direction,
			distance,
			physicalMode,
		);
		const previousGuids = new Set(
			spawnedEntities.map((entity) => entity.identity.guid),
		);
		const event = await entityHost.spawn(request);
		await applyDynamicEntitySnapshotEvent(event);
		const entity = spawnedEntities.find(
			(current) =>
				!previousGuids.has(current.identity.guid) &&
				current.identity.wcid === request.wcid &&
				current.placement.kind === "world",
		);
		if (!entity)
			throw new Error("Explorer spawn snapshot omitted its new world entity.");
		return entity;
	}

	function entityScenarioAnchor(): {
		readonly placement: HostCameraPlacement;
		readonly direction: readonly [number, number, number];
	} {
		if (cameraEvidence === null)
			throw new Error("Entity scenario requires a current camera.");
		const yaw = (cameraEvidence.yawDegrees * Math.PI) / 180;
		const pitch = (cameraEvidence.pitchDegrees * Math.PI) / 180;
		const axes = createCameraAxesRadians(yaw, pitch);
		return {
			placement: {
				position: sceneVec3(new Vec3(...cameraEvidence.position)),
				residency: {
					envCellId: cameraEvidence.envCellId,
					landblockId: cameraEvidence.landblockId,
				},
			},
			direction: resolvePhysicalFlyViewDirection({
				forward: [axes.forward.x, axes.forward.y, axes.forward.z],
				right: [axes.right.x, axes.right.y, axes.right.z],
				up: [axes.up.x, axes.up.y, axes.up.z],
			}),
		};
	}

	function kinematicBoomDirection(): readonly [number, number, number] {
		return resolveKinematicBoomDirection(entityScenarioAnchor().direction);
	}

	function probeBoomFraming(guid: number): {
		readonly planarCameraToTargetDistance: number;
		readonly planarForwardAlignment: number;
		readonly planarForwardProjection: number;
	} {
		const camera = cameraEvidence;
		if (camera === null)
			throw new Error("Boom framing probe requires a presented camera.");
		const entity = spawnedEntities.find(
			(candidate) => candidate.identity.guid === guid,
		);
		if (entity === undefined)
			throw new Error(`Boom framing probe could not find entity ${guid}.`);
		const placement = dynamicEntityPlacement(entity);
		const owner = createLandblockWorldOrigin(placement.landblockId);
		const target = new Vec3(
			owner.x + placement.localTransform.m41,
			placement.localTransform.m42,
			owner.z + placement.localTransform.m43,
		);
		const cameraToTarget = new Vec3(
			target.x - camera.position[0],
			0,
			target.z - camera.position[2],
		);
		const distance = Math.hypot(cameraToTarget.x, cameraToTarget.z);
		const axes = createCameraAxesRadians(
			(camera.yawDegrees * Math.PI) / 180,
			(camera.pitchDegrees * Math.PI) / 180,
		);
		const horizontalForwardLength = Math.hypot(axes.forward.x, axes.forward.z);
		const forwardProjection =
			horizontalForwardLength === 0
				? 0
				: (cameraToTarget.x * axes.forward.x +
						cameraToTarget.z * axes.forward.z) /
					horizontalForwardLength;
		return {
			planarCameraToTargetDistance: distance,
			planarForwardAlignment: distance === 0 ? 0 : forwardProjection / distance,
			planarForwardProjection: forwardProjection,
		};
	}

	/**
	 * Spawn many entities at exact camera-relative offsets in AC world axes.
	 *
	 * The host resolves a candidate as `camera + normalize(direction) * distance`, so passing the
	 * desired offset as the direction and its length as the distance places each entity exactly.
	 * Pair and population scenarios need deterministic separation; the single-spawn path's shared
	 * view direction would stack every entity on one point.
	 */
	async function spawnExplorerEntityFleet(
		rawWcid: string,
		offsets: readonly (readonly [number, number, number])[],
		physicalMode: "pose-only" | "integrated",
	): Promise<readonly DynamicEntityView[]> {
		if (!runtime || !entityHost)
			throw new Error(
				"Browser harness entity fleet requires a current camera and runtime.",
			);
		if (offsets.length === 0)
			throw new Error("Entity fleet requires at least one offset.");
		const { placement } = entityScenarioAnchor();
		await entityHost.ensureSimulationInterest(placement.residency.landblockId);
		const wcid = parseExplorerWcid(rawWcid);
		const spawned: DynamicEntityView[] = [];
		for (const offset of offsets) {
			const distance = Math.hypot(...offset);
			if (!Number.isFinite(distance) || distance <= 0)
				throw new Error("Each entity fleet offset must be finite and nonzero.");
			const previousGuids = new Set(
				spawnedEntities.map((entity) => entity.identity.guid),
			);
			const event = await entityHost.spawn(
				createExplorerSpawnRequest(
					wcid,
					placement,
					offset,
					distance,
					physicalMode,
				),
			);
			await applyDynamicEntitySnapshotEvent(event);
			const entity = spawnedEntities.find(
				(current) =>
					!previousGuids.has(current.identity.guid) &&
					current.identity.wcid === wcid &&
					current.placement.kind === "world",
			);
			if (!entity)
				throw new Error(
					"Explorer fleet snapshot omitted its new world entity.",
				);
			spawned.push(entity);
		}
		return spawned;
	}

	async function launchExplorerEntity(
		guid: number,
		generation: number,
		direction: readonly [number, number, number],
	): Promise<DynamicEntityView> {
		if (!runtime || !entityHost)
			throw new Error(
				"Browser harness entity launch requires an active runtime.",
			);
		const entity = await entityHost.launch(
			createExplorerLaunchRequest(guid, generation, direction),
		);
		spawnedEntities = spawnedEntities.map((current) =>
			current.identity.guid === guid && current.generation === generation
				? entity
				: current,
		);
		await runtime.upsertDynamicEntity(entity);
		return entity;
	}

	async function tickExplorerEntities(
		durationMilliseconds: number,
	): Promise<ExplorerFixedTickEnvelope | null> {
		if (!runtime || !entityHost)
			throw new Error(
				"Browser harness entity tick requires an active runtime.",
			);
		if (!Number.isFinite(durationMilliseconds) || durationMilliseconds <= 0)
			throw new Error("Entity tick duration must be positive and finite.");
		const envelope = await entityHost.tick(durationMilliseconds);
		if (envelope?.entityEvent) {
			applyDynamicEntityTickEvent(envelope.entityEvent);
		}
		return envelope;
	}

	async function possessExplorerEntity(
		guid: number | null,
	): Promise<ExplorerPossession> {
		if (!entityHost)
			throw new Error("Browser harness possession requires an active host.");
		return entityHost.possess(guid);
	}

	async function setPossessionIntent(
		request: ExplorerPossessionIntent,
	): Promise<string> {
		if (!entityHost)
			throw new Error("Browser harness possession requires an active host.");
		return entityHost.setPossessionIntent(request);
	}

	async function queuePossessionEvent(
		request: ExplorerPossessionEventRequest,
	): Promise<PossessionEventQueueReceipt> {
		if (!entityHost)
			throw new Error("Browser harness possession requires an active host.");
		return entityHost.queuePossessionEvent(request);
	}

	async function tickPossession(
		durationMilliseconds: number,
	): Promise<PossessionTickResponse> {
		if (!runtime || !entityHost)
			throw new Error("Browser harness possession requires an active runtime.");
		if (!Number.isFinite(durationMilliseconds) || durationMilliseconds <= 0)
			throw new Error("Possession tick duration must be positive and finite.");
		const response = await entityHost.tickPossession(durationMilliseconds);
		const receivedAtMs = performance.now();
		if (response.envelope?.entityEvent) {
			applyDynamicEntityTickEvent(response.envelope.entityEvent);
		}
		if (response.envelope?.boom) {
			boomCameraSession?.receive(
				response.envelope.boom,
				response.envelope.durationMs,
				receivedAtMs,
			);
		}
		return response;
	}

	async function possessionMotionProbe(): Promise<PossessionMotionProbe | null> {
		if (!entityHost)
			throw new Error("Browser harness possession requires an active host.");
		return entityHost.possessionMotionProbe();
	}

	async function startKinematicBoom(
		request: Omit<
			HttpKinematicBoomStartRequest,
			"clearanceRadius" | "projectionRevision"
		>,
	): Promise<HostKinematicBoomIdentity> {
		if (!entityHost)
			throw new Error(
				"Browser harness kinematic boom requires an active host.",
			);
		if (
			request.inputSequence !== 0 ||
			request.cumulativeZoomDisplacement !== 0
		) {
			throw new Error(
				"Browser harness frontend boom must start at input sequence and cumulative zoom zero.",
			);
		}
		const session = new HostKinematicBoomSession(boomTransport(entityHost));
		const activeRuntime = runtime;
		const canvas = canvasElement;
		const evidence = cameraEvidence;
		if (activeRuntime === undefined || canvas === null || evidence === null) {
			throw new Error(
				"Browser harness boom requires an active camera viewport.",
			);
		}
		await entityHost.ensureSimulationInterest(evidence.landblockId);
		if (
			cameraEvidence?.landblockId !== evidence.landblockId ||
			cameraEvidence?.envCellId !== evidence.envCellId ||
			cameraEvidence?.position.some(
				(value, index) => value !== evidence.position[index],
			) === true
		) {
			throw new Error(
				"Browser harness camera placement changed while collision interest loaded.",
			);
		}
		const revision = ++boomProjectionRevision;
		if (!Number.isSafeInteger(revision)) {
			throw new Error("Browser harness boom projection revision exhausted.");
		}
		const projection = createProjectionClearanceRevision(
			revision,
			{ fov: evidence.fov, near: evidence.near },
			activeRuntime.resolveViewportExtent(
				canvas.clientWidth,
				canvas.clientHeight,
			),
		);
		requestedBoomProjection = projection;
		await session.start(
			{
				possessionGeneration: request.possessionGeneration,
				guid: request.guid,
				entityGeneration: request.entityGeneration,
			},
			{
				initial: request.initialReach,
				minimum: request.minimumReach,
				maximum: request.maximumReach,
			},
			request.viewDirection,
			projection,
		);
		const status = session.status();
		if (status.kind !== "awaiting-first-path") {
			throw new Error("Browser harness boom did not retain its registration.");
		}
		boomCameraSession = session;
		boomInputSequence = 0;
		boomCumulativeZoomDisplacement = 0;
		return status.identity;
	}

	async function reprojectKinematicBoom(
		width: number,
		height: number,
		fov: number,
	): Promise<ProjectionClearanceRevision> {
		if (
			!Number.isSafeInteger(width) ||
			width <= 0 ||
			!Number.isSafeInteger(height) ||
			height <= 0
		) {
			throw new Error(
				"Browser harness viewport extent must be positive integers.",
			);
		}
		const session = boomCameraSession;
		const activeRuntime = runtime;
		const canvas = canvasElement;
		const evidence = cameraEvidence;
		if (
			session === undefined ||
			activeRuntime === undefined ||
			canvas === null ||
			evidence === null
		) {
			throw new Error(
				"Browser harness reproject requires an active boom viewport.",
			);
		}
		viewportWidth = width;
		viewportHeight = height;
		await svelteTick();
		const revision = ++boomProjectionRevision;
		if (!Number.isSafeInteger(revision)) {
			throw new Error("Browser harness boom projection revision exhausted.");
		}
		const projection = createProjectionClearanceRevision(
			revision,
			{ fov, near: evidence.near },
			activeRuntime.resolveViewportExtent(
				canvas.clientWidth,
				canvas.clientHeight,
			),
		);
		requestedBoomProjection = projection;
		await session.setClearance(projection);
		return projection;
	}

	async function setKinematicBoomIntent(
		request: HttpKinematicBoomIntentRequest,
	): Promise<"accepted" | "ignored-stale"> {
		if (!entityHost)
			throw new Error(
				"Browser harness kinematic boom requires an active host.",
			);
		const session = boomCameraSession;
		if (session === undefined) {
			throw new Error("Browser harness frontend boom is not registered.");
		}
		if (request.inputSequence <= boomInputSequence) {
			return decodeHostKinematicBoomUpdateReceipt(
				await entityHost.setKinematicBoomIntent(request),
			);
		}
		if (request.inputSequence !== boomInputSequence + 1) {
			throw new Error(
				"Browser harness boom input sequence must be contiguous.",
			);
		}
		await session.setIntent(
			request.viewDirection,
			request.cumulativeZoomDisplacement - boomCumulativeZoomDisplacement,
		);
		boomInputSequence = request.inputSequence;
		boomCumulativeZoomDisplacement = request.cumulativeZoomDisplacement;
		return "accepted";
	}

	async function stopKinematicBoom(
		identity: HostKinematicBoomIdentity,
	): Promise<boolean> {
		if (!entityHost)
			throw new Error(
				"Browser harness kinematic boom requires an active host.",
			);
		const session = boomCameraSession;
		if (session === undefined) return entityHost.stopKinematicBoom(identity);
		await session.stop();
		boomCameraSession = undefined;
		requestedBoomProjection = null;
		activeBoomProjection = null;
		return boomStopResult;
	}

	function boomTransport(
		host: HttpExplorerEntityHost,
	): HostKinematicBoomTransport {
		return {
			invoke: async (command, args) => {
				const request = args?.request;
				if (command === "start_kinematic_boom") {
					return host.startKinematicBoom(
						request as HttpKinematicBoomStartRequest,
					);
				}
				if (command === "set_kinematic_boom_intent") {
					return host.setKinematicBoomIntent(
						request as HttpKinematicBoomIntentRequest,
					);
				}
				if (command === "set_kinematic_boom_clearance") {
					return host.setKinematicBoomClearance(
						request as HttpKinematicBoomClearanceRequest,
					);
				}
				if (command === "stop_kinematic_boom") {
					boomStopResult = await host.stopKinematicBoom(
						request as HostKinematicBoomIdentity,
					);
					return boomStopResult;
				}
				throw new Error(`Unknown browser boom command ${command}.`);
			},
		};
	}

	function syncHarnessBoomCamera(nowMs: number): void {
		const activeRuntime = runtime;
		const evidence = cameraEvidence;
		const session = boomCameraSession;
		const presentation = session?.presentation(nowMs);
		const projection = session?.acknowledgedProjection(nowMs) ?? null;
		if (
			activeRuntime === undefined ||
			evidence === null ||
			presentation == null ||
			projection === null
		)
			return;
		activeBoomProjection = projection;
		const { placement, visualPivot } = presentation;
		// A reseed instant carries no look direction, and the harness has no desired orbit to fall
		// back on, so it holds its last applied camera rather than inventing one.
		const orientation = resolveCameraLookAtAngles(
			placement.position,
			visualPivot,
		);
		if (orientation === null) return;
		const rotation = createCameraRotationRadians(
			orientation.yawRadians,
			orientation.pitchRadians,
		);
		applyHarnessCamera(
			activeRuntime,
			{
				far: evidence.far,
				fov: projection.fov,
				near: projection.near,
				placement: {
					envCellId: placement.residency.envCellId,
					landblockId: placement.residency.landblockId,
					position: placement.position,
					rotation,
				},
			},
			projection.extent,
		);
		cameraEvidence = {
			...evidence,
			fov: projection.fov,
			near: projection.near,
			envCellId: placement.residency.envCellId,
			landblockId: placement.residency.landblockId,
			policy: "host-boom",
			pitchDegrees: (orientation.pitchRadians * 180) / Math.PI,
			position: [
				placement.position.x,
				placement.position.y,
				placement.position.z,
			],
			yawDegrees: (orientation.yawRadians * 180) / Math.PI,
		};
	}

	async function probeNextFrameState(): Promise<{
		readonly boomProjection: {
			readonly active: ProjectionClearanceRevision | null;
			readonly requested: ProjectionClearanceRevision | null;
		};
		readonly camera: BrowserHarnessCameraEvidence | null;
		readonly envCellRenderMode: "flat" | "portal";
		readonly metrics: FrameSelectionMetrics | null;
	}> {
		await new Promise<void>((resolve) =>
			window.requestAnimationFrame(() => resolve()),
		);
		return {
			boomProjection: {
				active: activeBoomProjection,
				requested: requestedBoomProjection,
			},
			camera: cameraEvidence,
			envCellRenderMode: frameSettings.envCellRenderMode,
			metrics: runtime?.getRendererFrameDiagnostics()?.selectionMetrics ?? null,
		};
	}

	async function probeThirdPersonControls(): Promise<
		Awaited<ReturnType<BrowserHarnessApi["probeThirdPersonControls"]>>
	> {
		const listeners = new Map<string, EventListener>();
		const routedCharacterInput: unknown[] = [];
		let possessionOrbitDelta: readonly [number, number] | null = null;
		let wheelDistance = 0;
		const canvas = {
			addEventListener(
				type: string,
				listener: EventListenerOrEventListenerObject,
			) {
				if (typeof listener === "function") listeners.set(type, listener);
			},
			focus() {},
			hasPointerCapture: () => false,
			releasePointerCapture() {},
			removeEventListener() {},
			setPointerCapture() {},
		} as unknown as HTMLCanvasElement;
		const dispatch = (type: string, event: object) =>
			listeners.get(type)?.({
				preventDefault() {},
				...event,
			} as Event);
		const controller = new ExplorerCameraInputController({
			canvas,
			onChange() {},
			onCharacterInput: (input) => routedCharacterInput.push(input),
			onPhysicalWheel: (distance) => (wheelDistance = distance),
			onPossessionOrbit: (deltaX, deltaY) =>
				(possessionOrbitDelta = [deltaX, deltaY]),
			onPossessionWheel: (distance) => (wheelDistance = distance),
			requestAnimationFrame: () => 1,
			cancelAnimationFrame() {},
		});
		controller.setControlScheme({ kind: "possessed-character" });
		const cameraYawBefore = controller.snapshotState().yawRadians;
		dispatch("keydown", { key: "a", repeat: false, shiftKey: false });
		const cameraYawAfterKeyboardTurn = controller.snapshotState().yawRadians;
		const characterInputCountAfterKeyboard = routedCharacterInput.length;
		dispatch("pointerdown", {
			button: 0,
			clientX: 0,
			clientY: 0,
			pointerId: 1,
		});
		dispatch("pointermove", {
			clientX: 20,
			clientY: 5,
			pointerId: 1,
			shiftKey: false,
		});
		dispatch("wheel", { deltaX: 0, deltaY: 100, shiftKey: false });
		const characterInputCountAfterPointerAndWheel = routedCharacterInput.length;
		controller.dispose();
		const projection = createProjectionClearanceRevision(
			1,
			{ fov: CAMERA_FOV_DEGREES, near: CAMERA_NEAR },
			{ height: 720, width: 1_280 },
		);
		const transport: HostKinematicBoomTransport = {
			async invoke(command) {
				if (command === "start_kinematic_boom") {
					return {
						boomGeneration: 1,
						entityGeneration: 1,
						guid: 1,
						possessionGeneration: 1,
					};
				}
				if (
					command === "set_kinematic_boom_intent" ||
					command === "set_kinematic_boom_clearance"
				)
					return "accepted";
				if (command === "stop_kinematic_boom") return true;
				throw new Error(`Unexpected third-person probe command ${command}.`);
			},
		};
		const recenter = new PossessionCameraController({
			initialLook: { pitchRadians: -0.4, yawRadians: 0 },
			orbit: {
				maximumPitchRadians: 1,
				pitchRadiansPerPixel: 0.01,
				yawRadiansPerPixel: 0.01,
			},
			recenter: {
				delayMs: EXPLORER_TUNING.camera.boom.recenterDelayMs,
				durationMs: EXPLORER_TUNING.camera.boom.recenterDurationMs,
			},
			transport,
		});
		await recenter.start(
			{ possessionGeneration: 1, guid: 1, entityGeneration: 1 },
			{ initial: 4.5, minimum: 1.2, maximum: 32 },
			projection,
		);
		const targetYaw = createEntityFacingCameraYaw({
			w: Math.SQRT1_2,
			x: 0,
			y: 0,
			z: Math.SQRT1_2,
		});
		const recenterDelayMs = EXPLORER_TUNING.camera.boom.recenterDelayMs;
		const recenterDurationMs = EXPLORER_TUNING.camera.boom.recenterDurationMs;
		recenter.setTranslationIntent(true, 0);
		await recenter.synchronize(projection, recenterDelayMs - 1, targetYaw);
		const recenterBefore = recenter.desiredLook();
		await recenter.synchronize(
			projection,
			recenterDelayMs + recenterDurationMs / 2,
			targetYaw,
		);
		const recenterMid = recenter.desiredLook();
		await recenter.synchronize(
			projection,
			recenterDelayMs + recenterDurationMs,
			targetYaw,
		);
		const recenterAfter = recenter.desiredLook();
		const trackingTargetYaw = targetYaw + 0.4;
		recenter.setTranslationIntent(false, recenterDelayMs + recenterDurationMs);
		await recenter.synchronize(
			projection,
			recenterDelayMs + recenterDurationMs + 1,
			trackingTargetYaw,
		);
		const recenterTracking = recenter.desiredLook();
		await recenter.stop();
		return {
			boomZoomDisplacement:
				-wheelDistance * EXPLORER_TUNING.camera.boom.zoomDistanceMultiplier,
			cameraYawAfterKeyboardTurn,
			cameraYawBefore,
			characterInputCountAfterKeyboard,
			characterInputCountAfterPointerAndWheel,
			possessionOrbitDelta,
			recenterAfterYaw: recenterAfter.yawRadians,
			recenterBeforeYaw: recenterBefore.yawRadians,
			recenterMidYaw: recenterMid.yawRadians,
			recenterPitch: recenterAfter.pitchRadians,
			recenterTrackingYaw: recenterTracking.yawRadians,
		};
	}

	async function relocateExplorerEntity(
		guid: number,
		generation: number,
		distance: number,
		kind: "teleport" | "reset",
	): Promise<DynamicEntityEvent> {
		if (!runtime || !entityHost)
			throw new Error(
				"Browser harness entity relocation requires an active runtime.",
			);
		const { direction, placement } = entityScenarioAnchor();
		await entityHost.ensureSimulationInterest(placement.residency.landblockId);
		const event = await entityHost.relocate(
			createExplorerRelocationRequest(
				guid,
				generation,
				placement,
				direction,
				distance,
				kind,
			),
		);
		applyDynamicEntityTickEvent(event);
		return event;
	}

	function applyDynamicEntityTickEvent(event: DynamicEntityEvent): void {
		if (!runtime)
			throw new Error("Dynamic-entity tick requires an active runtime.");
		if (event.kind !== "ticked")
			throw new Error(
				`Dynamic-entity operation returned unexpected ${event.kind} event.`,
			);
		for (const advance of event.batch.advances) {
			const current = spawnedEntities.find(
				(entity) => entity.identity.guid === advance.entity.identity.guid,
			);
			if (current?.generation !== advance.entity.generation)
				throw new Error(
					`Dynamic-entity operation returned unknown generation ${advance.entity.generation} for 0x${advance.entity.identity.guid.toString(16)}.`,
				);
		}
		runtime.applyDynamicEntityTick(event.batch, performance.now());
		const advanced = new Map(
			event.batch.advances.map((advance) => [
				advance.entity.identity.guid,
				advance.entity,
			]),
		);
		spawnedEntities = spawnedEntities.map(
			(entity) => advanced.get(entity.identity.guid) ?? entity,
		);
	}

	async function applyDynamicEntitySnapshotEvent(
		event: DynamicEntityEvent,
	): Promise<void> {
		if (!runtime)
			throw new Error("Dynamic-entity snapshot requires an active runtime.");
		if (event.kind !== "snapshot")
			throw new Error(
				`Dynamic-entity lifecycle returned unexpected ${event.kind} event.`,
			);
		spawnedEntities = EXCLUDE_SPAWNED_ATTACHMENTS
			? event.snapshot.entities.filter(
					(entity) => entity.placement.kind === "world",
				)
			: event.snapshot.entities;
		await runtime.replaceDynamicEntitySnapshot(spawnedEntities);
	}

	async function despawnExplorerEntity(
		guid: number,
		generation: number,
	): Promise<void> {
		if (!runtime || !entityHost)
			throw new Error(
				"Browser harness entity despawn requires an active runtime.",
			);
		await applyDynamicEntitySnapshotEvent(
			await entityHost.despawn(guid, generation),
		);
	}

	/** Retire every live harness-spawned generation, so teardown census has one exact call. */
	async function despawnExplorerEntityFleet(): Promise<number> {
		if (!runtime || !entityHost)
			throw new Error(
				"Browser harness entity despawn requires an active runtime.",
			);
		const retiring = spawnedEntities.filter(
			(entity) => entity.placement.kind === "world",
		);
		for (const entity of retiring)
			await applyDynamicEntitySnapshotEvent(
				await entityHost.despawn(entity.identity.guid, entity.generation),
			);
		return retiring.length;
	}

	function setLayerVisibility(
		layer: keyof FrameSettings["layerVisibility"],
		visible: boolean,
	): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		if (!(layer in frameSettings.layerVisibility)) {
			throw new Error(`Unknown browser harness render layer ${layer}.`);
		}
		frameSettings = {
			...frameSettings,
			layerVisibility: { ...frameSettings.layerVisibility, [layer]: visible },
		};
		runtime.setFrameSettings(frameSettings);
	}

	function setTextureFiltering(rawPolicy: string): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		if (!isTextureFilteringPolicy(rawPolicy)) {
			throw new Error(`Unknown texture filtering policy ${rawPolicy}.`);
		}
		const policy: TextureFilteringPolicy = rawPolicy;
		frameSettings = {
			...frameSettings,
			quality: { ...frameSettings.quality, textureFiltering: policy },
		};
		runtime.setFrameSettings(frameSettings);
	}

	function setMinimumPortalFootprintCssPixelArea(pixelArea: number): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		if (!Number.isFinite(pixelArea) || pixelArea < 0) {
			throw new Error(
				"Minimum portal footprint CSS pixel area must be non-negative and finite.",
			);
		}
		frameSettings = {
			...frameSettings,
			quality: {
				...frameSettings.quality,
				minimumPortalFootprintCssPixelArea: pixelArea,
			},
		};
		runtime.setFrameSettings(frameSettings);
	}

	function setMinimumObjectFootprintCssPixelArea(pixelArea: number): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		if (!Number.isFinite(pixelArea) || pixelArea < 0) {
			throw new Error(
				"Minimum object-footprint CSS pixel area must be non-negative and finite.",
			);
		}
		frameSettings = {
			...frameSettings,
			quality: {
				...frameSettings.quality,
				minimumObjectFootprintCssPixelArea: pixelArea,
			},
		};
		runtime.setFrameSettings(frameSettings);
	}

	/** Drive sampling density explicitly; the renderer no longer reads `devicePixelRatio`. */
	function setRenderScale(renderScale: number): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		validateRenderScale(renderScale, "Browser harness");
		frameSettings = {
			...frameSettings,
			quality: { ...frameSettings.quality, renderScale },
		};
		runtime.setFrameSettings(frameSettings);
	}

	function setEntityShadowSettings(settings: EntityShadowSettings): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		frameSettings = {
			...frameSettings,
			entityShadows: createEntityShadowSettings(settings),
		};
		runtime.setFrameSettings(frameSettings);
	}

	function setEntityShadowMode(mode: EntityShadowMode): void {
		setEntityShadowSettings({ ...frameSettings.entityShadows, mode });
	}

	function setOffscreenAnimationSampleIntervalSeconds(
		intervalSeconds: number,
	): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		runtime.setOffscreenAnimationSampleIntervalSeconds(intervalSeconds);
	}

	function setFrameProfiling(enabled: boolean): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		runtime.setRendererFrameProfilingEnabled(enabled);
	}

	function captureBakedDrawMergeCensus(): Promise<BakedDrawMergeCensus> {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		return runtime.captureBakedDrawMergeCensus();
	}

	function setAmbientOcclusion(enabled: boolean): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		frameSettings = {
			...frameSettings,
			ambientOcclusion: { ...frameSettings.ambientOcclusion, enabled },
		};
		runtime.setFrameSettings(frameSettings);
	}

	function setAmbientOcclusionCoverageVisualization(enabled: boolean): void {
		if (!renderer) throw new Error("Browser harness renderer is not ready.");
		renderer.setAmbientOcclusionCoverageVisualizationEnabled(enabled);
	}

	/** Apply one authored grade, or `null` to present ungraded. */
	function setColorGrade(parameters: ColorGradeParameters | null): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		frameSettings = {
			...frameSettings,
			colorGrade: parameters
				? { enabled: true, parameters: createColorGradeParameters(parameters) }
				: { ...frameSettings.colorGrade, enabled: false },
		};
		runtime.setFrameSettings(frameSettings);
	}

	function setStaticLights(enabled: boolean): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		frameSettings = { ...frameSettings, staticLightsEnabled: enabled };
		runtime.setFrameSettings(frameSettings);
	}

	function setShowRetailHiddenGeometry(visible: boolean): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		frameSettings = { ...frameSettings, showRetailHiddenGeometry: visible };
		runtime.setFrameSettings(frameSettings);
	}

	function setWeather(enabled: boolean): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		frameSettings = { ...frameSettings, weatherEnabled: enabled };
		runtime.setFrameSettings(frameSettings);
	}

	function clearSceneInterest(): void {
		if (!runtime) throw new Error("Browser harness runtime is not ready.");
		runtime.clearSceneInterest();
		lastInterestLandblockId = null;
		lastInterestRadii = null;
	}

	function resetTiming(): void {
		timing = {
			sampleCount: 0,
			totalTickMs: 0,
			totalRenderMs: 0,
			longestTickMs: 0,
			longestRenderMs: 0,
			longestFrameWorkMs: 0,
			longestFrameGapMs: 0,
			longTaskCount: 0,
			longestLongTaskMs: 0,
		};
		lastFrameAt = undefined;
		// One reset delimits both aggregates, so a --measure-ms window governs the renderer profile
		// mean as well as the harness frame timing rather than leaving it a rolling tail.
		runtime?.resetRendererFrameProfile();
	}

	function timingSnapshot(): BrowserHarnessTiming {
		const divisor = Math.max(1, timing.sampleCount);
		return {
			averageFrameWorkMs: (timing.totalTickMs + timing.totalRenderMs) / divisor,
			averageRenderMs: timing.totalRenderMs / divisor,
			averageTickMs: timing.totalTickMs / divisor,
			longestFrameGapMs: timing.longestFrameGapMs,
			longestFrameWorkMs: timing.longestFrameWorkMs,
			longestLongTaskMs: timing.longestLongTaskMs,
			longestRenderMs: timing.longestRenderMs,
			longestTickMs: timing.longestTickMs,
			longTaskCount: timing.longTaskCount,
			sampleCount: timing.sampleCount,
		};
	}

	function probePortalExecution(
		rawEnvCellId: string,
		position: readonly [number, number, number],
		cameraYawDegrees: number,
		cameraPitchDegrees: number,
	): PortalExecutionProbeResult {
		const activeRuntime = runtime;
		const canvas = canvasElement;
		if (!renderer || activeRuntime === undefined || canvas === null) {
			throw new Error("Browser harness renderer and viewport are not ready.");
		}
		if (
			position.length !== 3 ||
			!position.every(Number.isFinite) ||
			![cameraYawDegrees, cameraPitchDegrees].every(Number.isFinite)
		) {
			throw new Error(
				"Browser harness portal execution probe requires a finite position and orientation.",
			);
		}
		const envCellId = parseEnvCellId(rawEnvCellId, "portal execution");
		const landblockId = `${envCellId.slice(0, 6)}ffff` as LandblockOwnerId;
		return renderer.probePortalExecution(
			landblockId,
			{
				cameraInsideSealedCell: false,
				camera: {
					far: CAMERA_FAR,
					fov: CAMERA_FOV_DEGREES,
					near: CAMERA_NEAR,
					placement: {
						envCellId,
						landblockId,
						position: sceneVec3(new Vec3(...position)),
						rotation: cameraRotation(cameraYawDegrees, cameraPitchDegrees),
					},
				},
			},
			{ envCellId, kind: "env-cell", landblockId },
			activeRuntime.resolveViewportExtent(
				canvas.clientWidth,
				canvas.clientHeight,
			),
			frameSettings,
		);
	}

	function parseEnvCellId(rawEnvCellId: string, operation: string): EnvCellId {
		const match = /^(?:0x)?([0-9a-f]{8})$/i.exec(rawEnvCellId.trim());
		if (!match) {
			throw new Error(
				`Browser harness ${operation} EnvCell id must contain eight hexadecimal digits.`,
			);
		}
		return `0x${match[1]!.toLowerCase()}`;
	}

	function cameraRotation(yawDegrees: number, pitchDegrees: number) {
		const yaw = (yawDegrees * Math.PI) / 180;
		const pitch = (pitchDegrees * Math.PI) / 180;
		return createCameraRotationRadians(yaw, pitch);
	}

	function parsePositiveIntegerQuery(
		parameters: URLSearchParams,
		name: string,
		fallback: number,
	): number {
		const rawValue = parameters.get(name);
		if (rawValue === null) return fallback;
		const value = Number(rawValue);
		if (!Number.isInteger(value) || value <= 0) {
			throw new Error(`Browser harness ${name} must be a positive integer.`);
		}
		return value;
	}

	onMount(() => {
		if (!canvasElement) {
			error = "Browser harness canvas was not mounted.";
			return;
		}
		const hostUrl = query.get("contentHost");
		if (!hostUrl) {
			error = "Browser harness requires a contentHost query parameter.";
			return;
		}

		let destroyed = false;
		let frameHandle: number | undefined;
		let longTaskObserver: PerformanceObserver | undefined;
		let pipeline:
			| StandardCommitPipeline
			| SyntheticBlendedBuildingPipeline
			| SyntheticInstancedObjectPipeline
			| undefined;
		let device: WebGL2Device | undefined;
		let staticDetailOwner: ActiveRegionStaticDetailOwner | undefined;
		const terrainGlTrace = TRACE_TERRAIN_GL ? installTerrainGlTrace() : null;
		const hostGlobal = globalThis as typeof globalThis & HarnessGlobal;
		const start = async (): Promise<void> => {
			try {
				contentSource = await HttpLandblockContentSource.build(hostUrl);
				landblockProfileSource = new CachedLandblockProfileSource(
					contentSource,
				);
				sceneInterestCoordinator = new SceneInterestRequestCoordinator(
					landblockProfileSource,
				);
				entityHost = new HttpExplorerEntityHost(hostUrl);
				const landblockSource = ISOLATE_AUTHORED_DYNAMICS
					? new DynamicOnlyLandblockSource(contentSource)
					: EXCLUDE_AUTHORED_DYNAMICS
						? new WithoutAuthoredDynamicsLandblockSource(contentSource)
						: contentSource;
				device = await WebGL2Device.build(canvasElement!);
				textureFilteringCapabilities = device.getTextureFilteringCapabilities();
				if (fixture === "portal-scope-atlas") {
					portalScopeAtlasTargets = device.probePortalScopeAtlasTargets();
					portalScopeAtlasExecutor = device.probePortalScopeAtlasExecutor();
					portalContextLossPolicy = await WebGL2Device.probeContextLossPolicy();
				}
				if (fixture === "outdoor-pssm") {
					outdoorPssm = device.probeOutdoorPssm();
				}
				pipeline =
					fixture === "blended"
						? new SyntheticBlendedBuildingPipeline()
						: fixture === "instanced"
							? new SyntheticInstancedObjectPipeline()
							: await StandardCommitPipeline.build({
									sourceBatch: landblockSource,
								});
				runtime = await GamePresentationRuntime.build(
					{
						buildRenderer: async (world) => {
							renderer = await device!.buildRenderer(world);
							return renderer;
						},
						resources: device.resources,
					},
					pipeline,
					contentSource,
					contentSource,
					contentSource,
					// The harness renders headlessly; authored audio has no observable output here,
					// so by default a refusing device keeps the runtime honest without a context.
					// Under `audioTrace=1` a recording device stands in, so live placement leaves
					// machine-readable evidence instead of silence.
					AUDIO_TRACE
						? recordingAudioDevice()
						: { playOneShot: () => null, prepare: async () => {} },
					contentSource,
					contentSource,
					contentSource,
					contentSource,
					EXPLORER_TUNING.frameSettings,
					PARTICLE_SEED === null
						? undefined
						: seededRoll(Number(PARTICLE_SEED)),
					// The harness is a measurement surface, so it always wants tick timing.
					new RuntimeTickProfiler(),
				);
				if (PORTAL_TRANSITION_DEMO) {
					await runtime.installPortalTransitionAssets(
						await loadPortalTransitionAssets({
							audio: {
								playOneShot: () => null,
								prepare: async () => {},
							},
							animation: contentSource,
							setupVisual: contentSource,
							soundTable: contentSource,
						}),
					);
				}
				// Harness comparisons select their render policy explicitly and start from flat.
				runtime.setFrameSettings(frameSettings);
				staticDetailOwner = new ActiveRegionStaticDetailOwner(contentSource);
				runtime.installActiveRegionStaticDetails(
					await staticDetailOwner.install(contentSource.activeRegion),
				);
				const ambientRegion = contentSource.activeRegion.data;
				ambientRegionEvidence = {
					hasScenes: Boolean(ambientRegion.scenes),
					hasSound: Boolean(ambientRegion.sound),
				};
				if (ambientRegion.sound && ambientRegion.scenes) {
					await runtime.installAmbientRegion({
						sceneTypes: ambientRegion.scenes.types.map((type) => ({
							soundTableIndex: type.soundTableIndex,
						})),
						tables: ambientRegion.sound.tables.map((table) => ({
							soundTableId: table.soundTableId,
							sounds: table.sounds,
						})),
						terrainTypes:
							ambientRegion.terrain?.types.map((type) => ({
								sceneTypes: type.sceneTypes,
							})) ?? [],
					});
				}
				await runtime.installSky(await contentSource.loadSkySource());
				if (TIME_OF_DAY !== null) {
					const timeOfDay = Number(TIME_OF_DAY);
					if (!Number.isFinite(timeOfDay) || timeOfDay < 0 || timeOfDay >= 1) {
						throw new Error("timeOfDay must be normalized to [0, 1).");
					}
					runtime.setSceneEnvironment(
						resolveSceneEnvironment(contentSource.activeRegion, {
							dayIndex: 0,
							dayGroupOverride: DAY_GROUP === null ? 0 : Number(DAY_GROUP),
							timeOfDay,
						}),
					);
				}
				if (destroyed) return;
				ready = true;
				if ("PerformanceObserver" in window) {
					longTaskObserver = new PerformanceObserver((entries) => {
						for (const entry of entries.getEntries()) {
							timing = {
								...timing,
								longTaskCount: timing.longTaskCount + 1,
								longestLongTaskMs: Math.max(
									timing.longestLongTaskMs,
									entry.duration,
								),
							};
						}
					});
					longTaskObserver.observe({ buffered: true, type: "longtask" });
				}
				/**
				 * Fly the camera (and with it the listener) through interpolated positions, pumping
				 * real frames at each step, and return every voice's placement series.
				 *
				 * The flyby is the runtime-verification probe for live spatial audio: a `"world"`
				 * voice's gain must rise and fall with distance and its pan sweep through zero as
				 * the camera passes it; a bed must hold zero pan while its gain follows share.
				 */
				async function probeAudioFlyby(
					rawLandblockId: string,
					from: readonly [number, number, number],
					to: readonly [number, number, number],
					steps: number,
					framesPerStep: number,
					cameraYawDegrees: number,
					cameraPitchDegrees: number,
				) {
					if (!AUDIO_TRACE) {
						throw new Error("probeAudioFlyby requires audioTrace=1.");
					}
					if (!Number.isInteger(steps) || steps < 2) {
						throw new Error("Audio flyby needs at least two steps.");
					}
					const startAudioSampleCounts = audioTraceVoices.map(
						(voice) => voice.samples.length,
					);
					const nextFrame = () =>
						new Promise<void>((resolve) => {
							window.requestAnimationFrame(() => resolve());
						});
					for (let step = 0; step < steps; step += 1) {
						audioFlybyStep = step;
						const t = step / (steps - 1);
						setOutdoorCamera(
							rawLandblockId,
							[
								from[0] + (to[0] - from[0]) * t,
								from[1] + (to[1] - from[1]) * t,
								from[2] + (to[2] - from[2]) * t,
							],
							cameraYawDegrees,
							cameraPitchDegrees,
						);
						for (let frame = 0; frame < framesPerStep; frame += 1) {
							await nextFrame();
						}
					}
					audioFlybyStep = -1;
					const trace = audioTraceSnapshot(startAudioSampleCounts);
					return {
						ambientRegion: ambientRegionEvidence,
						ambientBakes: trace.ambientBakes,
						ambient: trace.ambient,
						audio: trace.audio,
						steps,
						voices: trace.voices,
					};
				}
				/**
				 * Draw one overhead-map frame onto the harness map canvas.
				 *
				 * The draw is synchronous so a screenshot taken immediately after this returns shows
				 * exactly the reported state.
				 */
				function configureMap(request: {
					readonly size?: number;
					readonly visible?: boolean;
					readonly centerX?: number;
					readonly centerY?: number;
					readonly centerZ?: number;
					readonly viewDiameter?: number;
					readonly headingRadians?: number;
				}): BrowserHarnessMapEvidence {
					if (!runtime)
						throw new Error("Browser harness runtime is not ready.");
					if (request.visible === false) {
						mapCanvasSize = 0;
						return {
							available: mapRenderer?.available ?? false,
							centerX: 0,
							centerZ: 0,
							distinctTerrainCodes: [],
							drew: false,
							geometry: {
								blockerInstanceCount: 0,
								blockerLandblockCount: 0,
								crossingCount: 0,
								floorInstanceCount: 0,
								interiorLandblockCount: 0,
								revision: runtime.mapGeometry.revision,
							},
							heightRange: [0, 0],
							mode: "outdoor",
							presentedEntities: {
								count: 0,
								firstHeadingDegrees: null,
								firstWorldX: null,
								firstWorldZ: null,
							},
							roadVertexCount: 0,
							paletteReady: runtime.terrainColorPalette() !== null,
							residentLandblockCount: mapRenderer?.residentLandblockCount ?? 0,
							terrainInstallationRevision: runtime.terrainInstallationRevision,
							viewDiameter: 0,
						};
					}
					mapCanvasSize = Math.max(1, Math.floor(request.size ?? 512));
					const canvas = mapCanvasElement;
					if (!canvas) {
						throw new Error("Browser harness map canvas is not mounted.");
					}
					canvas.width = mapCanvasSize;
					canvas.height = mapCanvasSize;
					mapRenderer ??= new MapRenderer(canvas, runtime);
					const camera = cameraEvidence?.position ?? ([0, 0, 0] as const);
					const centerX = request.centerX ?? camera[0];
					const centerZ = request.centerZ ?? camera[2];
					const anchor: MapAnchor = {
						headingRadians: request.headingRadians ?? 0,
						residency: cameraEvidence
							? {
									envCellId: cameraEvidence.envCellId,
									landblockId: cameraEvidence.landblockId,
								}
							: null,
						worldX: centerX,
						worldY: request.centerY ?? camera[1],
						worldZ: centerZ,
					};
					const defaultViewDiameter =
						mapEnvironment(anchor) === "indoor"
							? MAP_DEFAULT_VIEW_DIAMETERS.indoor
							: MAP_DEFAULT_VIEW_DIAMETERS.outdoor;
					const viewDiameter = clampMapViewDiameter(
						request.viewDiameter ?? defaultViewDiameter,
					);
					let minimumHeight = Number.POSITIVE_INFINITY;
					let maximumHeight = Number.NEGATIVE_INFINITY;
					const distinctTerrainCodes = new Set<number>();
					let roadVertexCount = 0;
					for (const { generation } of runtime.listInstalledTerrain()) {
						for (const height of generation.heights) {
							minimumHeight = Math.min(minimumHeight, height);
							maximumHeight = Math.max(maximumHeight, height);
						}
						for (const authored of generation.terrainSamples) {
							distinctTerrainCodes.add((authored >>> 2) & 0x1f);
							if ((authored & 0x03) !== 0) roadVertexCount += 1;
						}
					}
					let blockerInstanceCount = 0;
					let blockerLandblockCount = 0;
					for (const [, instances] of runtime.mapGeometry.listBlockers()) {
						blockerLandblockCount += 1;
						blockerInstanceCount += instances.length;
					}
					let interiorLandblockCount = 0;
					let floorInstanceCount = 0;
					let crossingCount = 0;
					for (const [, resident] of runtime.mapGeometry.listInteriors()) {
						interiorLandblockCount += 1;
						floorInstanceCount += resident.floors.length;
						crossingCount += resident.crossings.length;
					}
					// Residency comes from the harness camera: an EnvCell camera puts the map indoors,
					// which is the same rule the app shell will apply to a possessed entity.
					let presentedCount = 0;
					let firstWorldX: number | null = null;
					let firstWorldZ: number | null = null;
					let firstHeadingDegrees: number | null = null;
					for (const { placement } of runtime.listPresentedSpawnedEntities()) {
						presentedCount += 1;
						if (firstWorldX !== null) continue;
						const entityOrigin = createLandblockWorldOrigin(
							placement.landblockId,
						);
						firstWorldX = entityOrigin.x + placement.localTransform.m41;
						firstWorldZ = entityOrigin.z + placement.localTransform.m43;
						firstHeadingDegrees =
							(mapHeadingFromSceneTransform(placement.localTransform) * 180) /
							Math.PI;
					}
					const drew = mapRenderer.render({ anchor, viewDiameter });
					return {
						available: mapRenderer.available,
						centerX,
						centerZ,
						distinctTerrainCodes: [...distinctTerrainCodes].sort(
							(a, b) => a - b,
						),
						drew,
						geometry: {
							blockerInstanceCount,
							blockerLandblockCount,
							crossingCount,
							floorInstanceCount,
							interiorLandblockCount,
							revision: runtime.mapGeometry.revision,
						},
						heightRange: [minimumHeight, maximumHeight],
						presentedEntities: {
							count: presentedCount,
							firstHeadingDegrees,
							firstWorldX,
							firstWorldZ,
						},
						mode: anchor.residency?.envCellId == null ? "outdoor" : "indoor",
						roadVertexCount,
						paletteReady: runtime.terrainColorPalette() !== null,
						residentLandblockCount: mapRenderer.residentLandblockCount,
						terrainInstallationRevision: runtime.terrainInstallationRevision,
						viewDiameter,
					};
				}
				hostGlobal.__HOLTBURGER_3D_BROWSER_HARNESS__ = {
					clearSceneInterest,
					configureMap,
					despawnExplorerEntity,
					focusExplorerEnvCell,
					focusExplorerOutdoor,
					focusExplorerTarget,
					launchExplorerEntity,
					probeAudioFlyby,
					probeNextFrameState,
					probeBoomFraming,
					probePortalExecution,
					relocateExplorerEntity,
					requestSceneInterest,
					runFollowFlight,
					setCameraLandblock,
					setEnvCellCamera,
					setEnvCellRenderMode,
					setLayerVisibility,
					setOutdoorCamera,
					setAmbientOcclusion,
					setAmbientOcclusionCoverageVisualization,
					setColorGrade,
					setFrameProfiling,
					captureBakedDrawMergeCensus,
					setStaticLights,
					setShowRetailHiddenGeometry,
					setWeather,
					setMinimumObjectFootprintCssPixelArea,
					setMinimumPortalFootprintCssPixelArea,
					setRenderScale,
					setEntityShadowSettings,
					setEntityShadowMode,
					setOffscreenAnimationSampleIntervalSeconds,
					setTextureFiltering,
					resetTiming,
					resetTerrainGlTrace: () => terrainGlTrace?.reset(),
					spawnExplorerEntity,
					spawnExplorerEntityFleet,
					despawnExplorerEntityFleet,
					spawnSimulatedExplorerEntity,
					possessExplorerEntity,
					possessionMotionProbe,
					probeThirdPersonControls,
					queuePossessionEvent,
					setPossessionIntent,
					setKinematicBoomIntent,
					reprojectKinematicBoom,
					startKinematicBoom,
					stopKinematicBoom,
					kinematicBoomDirection,
					tickExplorerEntities,
					tickPossession,
					state: () => {
						const staticObjects =
							runtime?.getStaticObjectRuntimeDiagnostics() ?? null;
						const frameDiagnostics =
							runtime?.getRendererFrameDiagnostics() ?? null;
						return {
							boomProjection: {
								active: activeBoomProjection,
								requested: requestedBoomProjection,
							},
							ambientOcclusionCoverageCensus:
								renderer?.getAmbientOcclusionCoverageCensus() ?? null,
							authoredDynamics:
								runtime?.getAuthoredDynamicRuntimeDiagnostics() ?? null,
							portalTransition:
								runtime?.getPortalTransitionDiagnostics() ?? null,
							tickProfile: runtime?.getTickProfile() ?? null,
							camera: cameraEvidence,
							error,
							frameSettings,
							entityShadowResources: frameDiagnostics?.entityShadows ?? null,
							compiledObjectDraws:
								frameDiagnostics?.compiledObjectDraws ?? null,
							frameProfile: frameDiagnostics?.profile ?? null,
							frames,
							metrics: frameDiagnostics?.selectionMetrics ?? null,
							portalContextLossPolicy,
							portalScopeAtlasExecutor,
							portalScopeAtlasTargets,
							outdoorPssm,
							ready,
							staticObjectLayers: {
								buildings:
									staticObjects?.layers.filter(
										(layer) => layer.layer === LandblockLayerKind.Buildings,
									) ?? [],
								generated:
									staticObjects?.layers.filter(
										(layer) => layer.layer === LandblockLayerKind.Generated,
									) ?? [],
								objects:
									staticObjects?.layers.filter(
										(layer) => layer.layer === LandblockLayerKind.Objects,
									) ?? [],
							},
							staticObjects,
							terrainWorker: runtime?.getTerrainWorkerDiagnostics() ?? null,
							terrainGlTrace: terrainGlTrace?.snapshot() ?? null,
							sourceBatches:
								contentSource?.getLandblockSourceBatchDiagnostics() ?? [],
							profiles: contentSource?.getLandblockProfileDiagnostics() ?? [],
							sceneInterest: sceneInterestEvidence(),
							spawnedEntities,
							timing: timingSnapshot(),
							textureFilteringCapabilities,
							viewport: {
								cssHeight: canvasElement!.clientHeight,
								cssWidth: canvasElement!.clientWidth,
								devicePixelRatio: window.devicePixelRatio,
								pixelHeight: canvasElement!.height,
								pixelWidth: canvasElement!.width,
							},
						};
					},
				};
				const frame = (): void => {
					if (!runtime || destroyed) return;
					// The driving script authors the first camera together with scene interest.
					// Keep the render loop dormant until that complete primary view exists.
					if (cameraEvidence === null) {
						frameHandle = window.requestAnimationFrame(frame);
						return;
					}
					const now = performance.now();
					if (lastFrameAt !== undefined) {
						timing = {
							...timing,
							longestFrameGapMs: Math.max(
								timing.longestFrameGapMs,
								now - lastFrameAt,
							),
						};
					}
					lastFrameAt = now;
					advanceFollowFlight(now);
					syncHarnessBoomCamera(now);
					if (PORTAL_TRANSITION_DEMO && portalTransitionDemoFrames >= 2) {
						runtime.setPortalTransition({
							generation: 1,
							phase: "waiting",
							progress: 0,
							outgoingAvailable: true,
						});
					}
					if (PORTAL_TRANSITION_DEMO) portalTransitionDemoFrames += 1;
					const tickStartedAt = performance.now();
					runtime.tick();
					const renderStartedAt = performance.now();
					runtime.render(
						FRAME_INTERVAL_MS === null
							? renderStartedAt / 1_000
							: (Math.min(
									frames,
									CAPTURE_FRAME === null
										? Number.POSITIVE_INFINITY
										: Number(CAPTURE_FRAME),
								) *
									Number(FRAME_INTERVAL_MS)) /
									1_000,
					);
					const frameFinishedAt = performance.now();
					const tickMs = renderStartedAt - tickStartedAt;
					const renderMs = frameFinishedAt - renderStartedAt;
					timing = {
						...timing,
						longestFrameWorkMs: Math.max(
							timing.longestFrameWorkMs,
							frameFinishedAt - tickStartedAt,
						),
						longestRenderMs: Math.max(timing.longestRenderMs, renderMs),
						longestTickMs: Math.max(timing.longestTickMs, tickMs),
						sampleCount: timing.sampleCount + 1,
						totalRenderMs: timing.totalRenderMs + renderMs,
						totalTickMs: timing.totalTickMs + tickMs,
					};
					frames += 1;
					completeFollowFlight();
					frameHandle = window.requestAnimationFrame(frame);
				};
				frameHandle = window.requestAnimationFrame(frame);
			} catch (cause) {
				error = cause instanceof Error ? cause.message : String(cause);
				// The harness API is never published when startup throws, so record the reason
				// somewhere the driving script can read after it gives up waiting.
				(
					globalThis as { __HOLTBURGER_3D_HARNESS_STARTUP_ERROR__?: string }
				).__HOLTBURGER_3D_HARNESS_STARTUP_ERROR__ = error;
			}
		};
		void start();

		return () => {
			destroyed = true;
			if (frameHandle !== undefined) window.cancelAnimationFrame(frameHandle);
			longTaskObserver?.disconnect();
			terrainGlTrace?.destroy();
			mapRenderer?.destroy();
			sceneInterestCoordinator?.invalidate();
			landblockProfileSource?.destroy();
			delete hostGlobal.__HOLTBURGER_3D_BROWSER_HARNESS__;
			staticDetailOwner?.teardown();
			void runtime?.destroy().finally(async () => {
				await pipeline?.destroy();
				await device?.destroy();
			});
		};
	});
</script>

<canvas
	bind:this={canvasElement}
	aria-label="Browser harness render viewport"
	style:height={`${viewportHeight}px`}
	style:width={`${viewportWidth}px`}
></canvas>

<canvas
	bind:this={mapCanvasElement}
	class="map"
	aria-label="Browser harness overhead map"
	style:display={mapCanvasSize > 0 ? "block" : "none"}
	style:height={`${mapCanvasSize}px`}
	style:width={`${mapCanvasSize}px`}
></canvas>

<style>
	:global(body) {
		margin: 0;
		overflow: hidden;
	}

	canvas {
		display: block;
	}

	canvas.map {
		position: absolute;
		top: 0;
		left: 0;
	}
</style>
