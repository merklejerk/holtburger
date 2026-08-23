<script lang="ts">
	import { onMount } from "svelte";
	import { TauriAnimationAssetSource } from "../lib/assets/tauri-animation-asset-source";
	import { TauriPhysicsScriptSource } from "../lib/assets/tauri-physics-script-source";
	import { TauriAudioSource } from "../lib/assets/tauri-audio-source";
	import { WebAudioDevice } from "../lib/assets/web-audio-device";
	import { TauriParticleEmitterSource } from "../lib/assets/tauri-particle-emitter-source";
	import { TauriSoundTableSource } from "../lib/assets/tauri-sound-table-source";
	import { TauriParticleMeshSource } from "../lib/assets/tauri-particle-mesh-source";
	import { TauriDynamicEntityVisualSource } from "../lib/assets/tauri-dynamic-entity-visual-source";
	import FrameMetricsOverlay, {
		type FrameMetrics,
	} from "../app/FrameMetricsOverlay.svelte";
	import ExplorerTools from "./ExplorerTools.svelte";
	import ExplorerCameraLocation from "./ExplorerCameraLocation.svelte";
	import {
		GameRuntime,
		type StaticObjectRuntimeDiagnostics,
	} from "../lib/game/runtime/game-runtime";
	import { RuntimeTickProfiler } from "../lib/game/runtime/runtime-tick-profiler";
	import { StandardCommitPipeline } from "../lib/game/commit/pipeline";
	import { WebGL2Device } from "../lib/game/renderer/webgl2-device";
	import { TauriActiveRegionSource } from "../lib/assets/tauri-active-region-source";
	import { TauriSkySource } from "../lib/assets/tauri-sky-source";
	import { TauriLandblockSourceBatch } from "../lib/assets/tauri-landblock-source-batch";
	import { TauriTexturePixelSource } from "../lib/assets/tauri-texture-pixel-source";
	import type { SceneInterestRadii } from "../lib/game/runtime/types";
	import { LandblockLayerKind } from "../lib/game/runtime/scene-interest";
	import type { LandblockId } from "../lib/game/game-types";
	import type { SceneResidency } from "../lib/game/scene";
	import {
		DEFAULT_FRAME_SETTINGS,
		type FrameSettings,
		type EnvCellRenderMode,
		type RendererFrameDiagnosticsSnapshot,
	} from "../lib/game/renderer/renderer";
	import type { AmbientOcclusionSettings } from "../lib/game/renderer/ambient-occlusion-policy";
	import type { ColorGradeSettings } from "../lib/game/renderer/color-grade-policy";
	import {
		ExplorerCameraCoordinator,
		type ExplorerCameraFocusStatus,
		type ExplorerCameraResidencySync,
	} from "./explorer-camera-coordinator";
	import {
		FrontendCameraController,
		type CharacterKeyInput,
		type FrontendControlScheme,
	} from "../lib/game/controls/frontend-camera-controller";
	import {
		resolvePhysicalFlyViewDirection,
		resolvePhysicalFlyVelocity,
		resolvePhysicalFlyWheelDisplacement,
		type ExplorerCameraMode,
		type PhysicalFlyLocalMovement,
	} from "../lib/game/motion/host-physical-fly-path";
	import type { HostCameraPlacement } from "../lib/game/motion/host-placed-path";
	import {
		CharacterInputController,
		type CharacterDrive,
		type CharacterInputEdge,
	} from "../lib/game/controls/character-input-controller";
	import {
		MOTION_STYLE,
		possessionStance,
		type ExplorerPossession,
		type MotionStyleName,
		type PossessionEventOutcome,
	} from "./explorer-entity-possession";
	import {
		HostKinematicBoomSession,
		tauriHostKinematicBoomTransport,
		type HostKinematicBoomStatus,
	} from "./host-kinematic-boom-session";
	import { resolveKinematicBoomDirection } from "../lib/game/motion/host-kinematic-boom-path";
	import { createCameraLookAtAngles } from "../lib/game/math/camera-orientation";
	import {
		PhysicalFlySession,
		type PhysicalFlyStatus,
	} from "./physical-fly-session";
	import { tauriPhysicalFlyTransport } from "./physical-fly-transport";
	import { SimulationInterestController } from "./simulation-interest";
	import { tauriSimulationInterestTransport } from "./simulation-interest-transport";
	import {
		ExplorerDynamicEntitySession,
		tauriExplorerDynamicEntityTransport,
		type ExplorerFixedTickReceipt,
	} from "./explorer-dynamic-entity-session";
	import {
		createExplorerSpawnRequest,
		parseExplorerWcid,
		type ExplorerCatalogCapability,
	} from "./explorer-entity-commands";
	import type {
		DynamicEntityEvent,
		DynamicEntityView,
	} from "../lib/game/runtime/dynamic-entity-feed";
	import { Vec3 } from "../lib/game/math/types";
	import { FRONTEND_TUNING } from "../lib/frontend-tuning";
	import {
		resolveSceneEnvironment,
		type ExplorerEnvironmentSelection,
	} from "../lib/game/environment/scene-environment";
	import { resolveDayFraction } from "../lib/game/environment/game-clock";
	import type { ActiveRegionSource } from "../lib/assets/active-region-source";
	import { ActiveRegionStaticDetailOwner } from "../lib/game/resolution/active-region-static-detail";
	import type { Texture2DReadback } from "../lib/game/renderer/webgl2-device";
	import type { TexturePageId } from "../lib/game/textures/texture-manager";
	import type { ExplorerCameraLocation as ExplorerCameraLocationState } from "./explorer-camera-location";
	import {
		resolveTextureFilteringPolicy,
		supportedTextureFilteringPolicies,
		type TextureFilteringCapabilities,
		type TextureFilteringPolicy,
	} from "../lib/game/renderer/texture-filtering-policy";
	import { isRenderScale } from "../lib/game/renderer/render-scale";
	import {
		createExplorerFrameDiagnosticReport,
		type ExplorerFrameDiagnosticReport,
	} from "./explorer-frame-diagnostic-report";

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let frameHandle: number | null = null;
	let gameRuntime: GameRuntime | undefined;
	let commitPipeline: StandardCommitPipeline | undefined;
	let webglDevice: WebGL2Device | undefined;
	let activeRegionSource: TauriActiveRegionSource | undefined;
	let skySource: TauriSkySource | undefined;
	let staticDetailOwner: ActiveRegionStaticDetailOwner | undefined;
	let cameraController: FrontendCameraController | undefined;
	let cameraCoordinator: ExplorerCameraCoordinator | undefined;
	let physicalCameraSession: PhysicalFlySession | undefined;
	let explorerPossession = $state<ExplorerPossession | null>(null);
	let possessedStance = $state<MotionStyleName>("nonCombat");
	let simulationInterestController: SimulationInterestController | undefined;
	let dynamicEntitySession: ExplorerDynamicEntitySession | undefined;
	let unsubscribeDynamicEntities: (() => void) | undefined;
	let unsubscribeFixedTicks: (() => void) | undefined;
	let unsubscribePossessionOutcomes: (() => void) | undefined;
	let dynamicEntityReconciliation: Promise<void> = Promise.resolve();
	let dynamicEntityReconciliationRevision = 0;
	let entityCatalog = $state<ExplorerCatalogCapability | null>(null);
	let spawnedEntities = $state<readonly DynamicEntityView[]>([]);
	let spawnedEntityPresentationError = $state<string | null>(null);
	let physicalSimulationAnchor: string | null = null;
	let cameraMode = $state<ExplorerCameraMode>("free-fly");
	let cameraModePending = $state(false);
	let physicalCameraStatus = $state<PhysicalFlyStatus | null>(null);
	let physicalCameraError = $state<string | null>(null);
	let frameMetrics: FrameMetrics | null = $state(null);
	let rendererFrameDiagnostics: RendererFrameDiagnosticsSnapshot | null =
		$state(null);
	let authoredDynamicRuntimeDiagnostics: ReturnType<
		GameRuntime["getAuthoredDynamicRuntimeDiagnostics"]
	> | null = $state(null);
	let lastFrameSelectionSampleAt = 0;
	let startupError: string | null = $state(null);
	let runtimeReady = $state(false);
	let cameraFocusStatus = $state<ExplorerCameraFocusStatus>(
		"No camera focus requested.",
	);
	let cameraLocation = $state<ExplorerCameraLocationState | null>(null);
	let activeRegion = $state<ActiveRegionSource | undefined>(undefined);
	/** Fast enough that a tick boundary is never visibly late; resolution is tick-quantized. */
	const CLOCK_SAMPLE_INTERVAL_MS = 250;

	let textureFilteringCapabilities =
		$state<TextureFilteringCapabilities | null>(null);
	let environmentSelection = $state<ExplorerEnvironmentSelection>({
		dayIndex: FRONTEND_TUNING.explorer.environment.defaultDayIndex,
		timeOfDay: FRONTEND_TUNING.explorer.environment.defaultTimeOfDay,
		dayGroupOverride:
			FRONTEND_TUNING.explorer.environment.defaultDayGroupOverride,
	});
	/** Explorer-local dynamic display choices; they do not alter resolved regional data. */
	let frameSettings = $state<FrameSettings>({ ...DEFAULT_FRAME_SETTINGS });
	const supportedTextureFiltering = $derived(
		textureFilteringCapabilities === null
			? []
			: supportedTextureFilteringPolicies(textureFilteringCapabilities),
	);
	const effectiveTextureFiltering = $derived(
		textureFilteringCapabilities === null
			? frameSettings.quality.textureFiltering
			: resolveTextureFilteringPolicy(
					frameSettings.quality.textureFiltering,
					textureFilteringCapabilities,
				),
	);

	function errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	function updateEnvironment(selection: ExplorerEnvironmentSelection): void {
		environmentSelection = selection;
		applyEnvironment();
	}

	/**
	 * Follow the regional clock instead of the explicit time-of-day slider.
	 *
	 * Retail always runs the clock; the slider is this app's equivalent of the `/day` override
	 * (`LScape::SetDay`, acclient.c:295885), so the two are one path with a selector rather than
	 * two ways to reach the same resolution.
	 */
	let clockFollowing = $state(false);
	/** Follow mode: re-anchor scene interest to the camera's landblock on boundary crossings. */
	let interestFollowsCamera = $state(false);
	/** Mirrors the camera coordinator's default so the switch reflects reality on first paint. */
	let audioFollowsCamera = $state(true);

	/** Mirror `AudioSystem`'s own defaults, which are full volume in every category. */
	let effectVolume = $state(1);
	let ambientVolume = $state(1);

	function updateEffectVolume(volume: number): void {
		effectVolume = volume;
		gameRuntime?.setAudioSettings({ ambientVolume, effectVolume: volume });
	}

	function updateAmbientVolume(volume: number): void {
		ambientVolume = volume;
		gameRuntime?.setAudioSettings({ ambientVolume: volume, effectVolume });
	}

	function updateAudioFollowsCamera(enabled: boolean): void {
		audioFollowsCamera = enabled;
		cameraCoordinator?.setAudioFollowsCamera(enabled);
	}

	function updateInterestFollowsCamera(enabled: boolean): void {
		interestFollowsCamera = enabled;
	}

	/**
	 * Carry follow-mode re-anchoring into simulation interest, which the coordinator does not own.
	 *
	 * The coordinator holds the anchor of record and decides whether the camera's residency is a
	 * crossing worth following, so this only mirrors a move it already made.
	 */
	function followCameraSceneInterest(residency: SceneResidency): void {
		if (cameraCoordinator?.followCameraResidency(residency) !== true) return;
		void requestSimulationInterest(residency.landblockId).catch(
			(error: unknown) => {
				physicalCameraError = errorMessage(error);
			},
		);
	}
	let clockStartedAtMs = 0;
	let clockTimer: ReturnType<typeof setInterval> | undefined;

	function updateClockFollowing(enabled: boolean): void {
		clockFollowing = enabled;
		clearInterval(clockTimer);
		clockTimer = undefined;
		if (!enabled) {
			applyEnvironment();
			return;
		}
		clockStartedAtMs = performance.now();
		applyEnvironment();
		// Sampling faster than the authored ticks costs nothing: the environment layer quantizes
		// each domain's fraction, so extra samples resolve to the identical environment.
		clockTimer = setInterval(applyEnvironment, CLOCK_SAMPLE_INTERVAL_MS);
	}

	function updateDistanceFog(enabled: boolean): void {
		frameSettings = { ...frameSettings, distanceFogEnabled: enabled };
		applyFrameSettings();
	}

	function updateAmbientOcclusionSettings(
		ambientOcclusion: AmbientOcclusionSettings,
	): void {
		frameSettings = { ...frameSettings, ambientOcclusion };
		applyFrameSettings();
	}

	function updateColorGradeSettings(colorGrade: ColorGradeSettings): void {
		frameSettings = { ...frameSettings, colorGrade };
		applyFrameSettings();
	}

	function updateViewerLight(enabled: boolean): void {
		frameSettings = { ...frameSettings, viewerLightEnabled: enabled };
		applyFrameSettings();
	}

	function updateWeather(enabled: boolean): void {
		frameSettings = { ...frameSettings, weatherEnabled: enabled };
		applyFrameSettings();
	}

	function updateEnvCellRenderMode(mode: EnvCellRenderMode): void {
		frameSettings = { ...frameSettings, envCellRenderMode: mode };
		applyFrameSettings();
	}

	function updateLayerVisibility(
		layer: LandblockLayerKind,
		visible: boolean,
	): void {
		frameSettings = {
			...frameSettings,
			layerVisibility: { ...frameSettings.layerVisibility, [layer]: visible },
		};
		applyFrameSettings();
	}

	/**
	 * Sampling density presets.
	 *
	 * Explorer-local UX: the renderer accepts any density within its bounds, and which handful to
	 * put in front of a viewer is a frontend choice. One is native CSS resolution; above it buys
	 * supersampled edges for the square of the cost. Filtered against the renderer's own bounds so
	 * tightening them can never leave a preset here that the next frame throws on.
	 */
	const RENDER_SCALE_OPTIONS = [0.5, 0.75, 1, 1.5, 2].filter(isRenderScale);

	function updateRenderScale(renderScale: number): void {
		frameSettings = {
			...frameSettings,
			quality: { ...frameSettings.quality, renderScale },
		};
		applyFrameSettings();
	}

	function updateTextureFiltering(
		textureFiltering: TextureFilteringPolicy,
	): void {
		frameSettings = {
			...frameSettings,
			quality: { ...frameSettings.quality, textureFiltering },
		};
		applyFrameSettings();
	}

	function readStaticObjectRuntimeDiagnostics(): StaticObjectRuntimeDiagnostics | null {
		return gameRuntime?.getStaticObjectRuntimeDiagnostics() ?? null;
	}

	function updateRendererFrameProfiling(enabled: boolean): void {
		if (!gameRuntime)
			throw new Error("Renderer profiling requires an active runtime.");
		gameRuntime.setRendererFrameProfilingEnabled(enabled);
		rendererFrameDiagnostics = gameRuntime.getRendererFrameDiagnostics();
	}

	function captureFrameDiagnosticReport(): ExplorerFrameDiagnosticReport | null {
		if (!gameRuntime || !webglDevice || !canvasElement) return null;
		const frame = gameRuntime.getRendererFrameDiagnostics();
		if (!frame) return null;
		const viewport = canvasElement.getBoundingClientRect();
		return createExplorerFrameDiagnosticReport({
			applicationFrame: frameMetrics,
			browser: {
				userAgent: navigator.userAgent,
				webgl: webglDevice.getDiagnosticIdentity(),
			},
			camera: cameraController?.snapshotState() ?? null,
			cameraLocation,
			capturedAt: new Date().toISOString(),
			environment: environmentSelection,
			frame,
			frameSettings,
			sceneInterest: cameraCoordinator?.sceneInterest() ?? null,
			viewport: {
				cssHeight: viewport.height,
				cssWidth: viewport.width,
				devicePixelRatio: window.devicePixelRatio,
				drawingBufferHeight: canvasElement.height,
				drawingBufferWidth: canvasElement.width,
			},
		});
	}

	function applyEnvironment(): void {
		if (!activeRegion) return;
		const environment = resolveSceneEnvironment(activeRegion, {
			...environmentSelection,
			timeOfDay: clockFollowing
				? resolveDayFraction(
						(performance.now() - clockStartedAtMs) / 1_000,
						activeRegion.data.calendar.dayLength,
					)
				: environmentSelection.timeOfDay,
		});
		gameRuntime?.setSceneEnvironment(environment);
	}

	function applyFrameSettings(): void {
		gameRuntime?.setFrameSettings(frameSettings);
	}

	function requestSceneInterest(
		residency: SceneResidency,
		radii: SceneInterestRadii,
	): void {
		// Automatic focus is an explicit teleport. Return position authority to free fly before the
		// coordinator applies it instead of letting the host overwrite the new pose next frame.
		if (physicalCameraSession) void leavePhysicalCamera(false);
		void requestSimulationInterest(residency.landblockId).catch(
			(error: unknown) => {
				physicalCameraError = errorMessage(error);
			},
		);
		cameraCoordinator?.requestSceneInterest(residency, radii);
	}

	async function requestSimulationInterest(
		anchorLandblockId: string,
	): Promise<void> {
		const controller = simulationInterestController;
		if (!controller) {
			throw new Error("Simulation-interest policy is not initialized.");
		}
		const receipt = await controller.request(anchorLandblockId);
		// A newer application anchor superseding this request is ordinary asynchronous currentness.
		if (!receipt.committed) return;
		if (
			receipt.unavailableLandblockIds.some(
				(owner) => owner.toLowerCase() === anchorLandblockId.toLowerCase(),
			)
		) {
			throw new Error(
				`Collision content is unavailable for ${anchorLandblockId}.`,
			);
		}
	}

	function followPhysicalSimulationInterest(anchorLandblockId: string): void {
		if (physicalSimulationAnchor === anchorLandblockId) return;
		physicalSimulationAnchor = anchorLandblockId;
		void requestSimulationInterest(anchorLandblockId).catch(
			(error: unknown) => {
				if (physicalSimulationAnchor === anchorLandblockId) {
					physicalSimulationAnchor = null;
				}
				physicalCameraError = errorMessage(error);
			},
		);
	}

	function physicalCameraInput(controller: FrontendCameraController): {
		readonly basis: {
			readonly forward: [number, number, number];
			readonly right: [number, number, number];
			readonly up: [number, number, number];
		};
		readonly viewDirection: [number, number, number];
		readonly worldVelocity: [number, number, number];
	} {
		const { basis, movement, precision } = controller.physicalFlyInput();
		const tuple = (vector: Vec3): [number, number, number] => [
			vector.x,
			vector.y,
			vector.z,
		];
		const cameraBasis = {
			forward: tuple(basis.forward),
			right: tuple(basis.right),
			up: tuple(basis.up),
		};
		const worldVelocity = resolvePhysicalFlyVelocity(
			movement as PhysicalFlyLocalMovement,
			cameraBasis,
			FRONTEND_TUNING.explorer.camera.controls.moveSpeed *
				(precision
					? FRONTEND_TUNING.explorer.camera.controls.shiftSlowMultiplier
					: 1),
		);
		return {
			basis: cameraBasis,
			viewDirection: resolvePhysicalFlyViewDirection(cameraBasis),
			worldVelocity,
		};
	}

	function sendPhysicalCameraIntent(): void {
		const session = physicalCameraSession;
		const controller = cameraController;
		if (!session?.running || !controller) return;
		const input = physicalCameraInput(controller);
		void session.setIntent(input.worldVelocity).catch((error: unknown) => {
			if (physicalCameraSession !== session) return;
			physicalCameraError = errorMessage(error);
		});
	}

	function sendPhysicalCameraWheel(localUpDistance: number): void {
		if (boomCameraSession) {
			// While possessed the wheel zooms the boom rather than lifting a free camera.
			pendingBoomZoom -=
				localUpDistance *
				FRONTEND_TUNING.explorer.camera.boom.zoomDistanceMultiplier;
			return;
		}
		const session = physicalCameraSession;
		const controller = cameraController;
		if (!session?.running || !controller) return;
		const input = physicalCameraInput(controller);
		void session
			.addDisplacement(
				resolvePhysicalFlyWheelDisplacement(input.basis, localUpDistance),
				input.worldVelocity,
			)
			.catch((error: unknown) => {
				if (physicalCameraSession !== session) return;
				physicalCameraError = errorMessage(error);
			});
	}

	function handleCameraCharacterInput(input: CharacterKeyInput): void {
		const owner = possessionInput;
		if (owner === undefined) return;
		if (input.kind === "reset") {
			owner.reset();
			return;
		}
		owner.applyKey(input.key, input.pressed, input.repeat);
	}

	function controlSchemeForCameraMode(
		mode: ExplorerCameraMode,
	): FrontendControlScheme {
		if (mode === "free-fly") return { kind: "free-fly" };
		return { kind: "physical-fly" };
	}

	function restoreCameraControlScheme(): void {
		const controller = cameraController;
		if (controller === undefined) return;
		if (possessionInput !== undefined) {
			controller.setControlScheme({ kind: "possessed-character" });
			return;
		}
		if (physicalCameraSession !== undefined) {
			controller.setControlScheme(controlSchemeForCameraMode(cameraMode));
			return;
		}
		controller.setControlScheme({ kind: "free-fly" });
	}

	function nonPossessionCameraControlScheme(): FrontendControlScheme {
		return physicalCameraSession === undefined
			? { kind: "free-fly" }
			: controlSchemeForCameraMode(cameraMode);
	}

	async function enterPhysicalCamera(): Promise<void> {
		const controller = cameraController;
		if (!controller || physicalCameraSession || cameraModePending) return;
		const placement = cameraCoordinator?.presentedPlacement() ?? null;
		if (placement === null) {
			physicalCameraError =
				"Physical camera requires a currently rendered camera placement.";
			return;
		}
		cameraModePending = true;
		physicalCameraError = null;
		controller.setControlScheme(
			possessionInput === undefined
				? controlSchemeForCameraMode("physical-fly")
				: { kind: "possessed-character" },
		);
		const session = new PhysicalFlySession(tauriPhysicalFlyTransport());
		try {
			await session.start(placement);
			if (cameraController !== controller || !runtimeReady) {
				await session.stop();
				cameraMode = "free-fly";
				restoreCameraControlScheme();
				return;
			}
			physicalCameraSession = session;
			cameraMode = "physical-fly";
			restoreCameraControlScheme();
			sendPhysicalCameraIntent();
		} catch (error) {
			restoreCameraControlScheme();
			physicalCameraError = errorMessage(error);
		} finally {
			cameraModePending = false;
		}
	}

	async function leavePhysicalCamera(
		preserveResidency: boolean,
	): Promise<void> {
		const session = physicalCameraSession;
		const controller = cameraController;
		if (!session || !controller) return;
		const lastHostResidency =
			cameraCoordinator?.presentedPlacement()?.residency ??
			session.placement()?.residency ??
			null;
		// Detach presentation first: no late segment can move the frontend pose after handoff.
		controller.setControlScheme(
			possessionInput === undefined
				? { kind: "free-fly" }
				: { kind: "possessed-character" },
		);
		physicalCameraSession = undefined;
		const presented = controller.snapshotState();
		controller.adoptPresentedPose(presented);
		if (preserveResidency && lastHostResidency !== null) {
			cameraCoordinator?.seedFreeFlyResidency(lastHostResidency);
		}
		cameraMode = "free-fly";
		restoreCameraControlScheme();
		physicalCameraStatus = null;
		try {
			await session.stop();
		} catch (error) {
			physicalCameraError = errorMessage(error);
		}
	}

	function updateCameraMode(mode: ExplorerCameraMode): void {
		if (mode === cameraMode || cameraModePending) return;
		if (mode === "free-fly") {
			void leavePhysicalCamera(true);
		} else if (!physicalCameraSession) {
			void enterPhysicalCamera();
		}
	}

	function readTextureAtlasPage(pageId: TexturePageId): Texture2DReadback {
		if (!gameRuntime || !webglDevice) {
			throw new Error(
				"Texture page readback requires an active Explorer runtime.",
			);
		}
		return webglDevice.readTexture2D(
			gameRuntime.getTextureAtlasPageResource(pageId),
		);
	}

	/** Project the one authoritative mirror into Svelte and the shared presentation runtime. */
	function reconcileSpawnedEntities(): Promise<void> {
		const session = dynamicEntitySession;
		if (session === undefined) return Promise.resolve();
		const entities = session.mirror.entities();
		spawnedEntities = entities;
		const runtime = gameRuntime;
		if (runtime === undefined) return Promise.resolve();
		const revision = ++dynamicEntityReconciliationRevision;
		spawnedEntityPresentationError = null;
		const completion = runtime.reconcileSpawnedDynamicEntities(entities);
		dynamicEntityReconciliation = completion;
		void completion.catch((error: unknown) => {
			if (revision !== dynamicEntityReconciliationRevision) return;
			const wcids = entities.map(({ identity }) => identity.wcid).join(", ");
			const provenance =
				entityCatalog?.status === "available"
					? entityCatalog.provenance
					: "catalog unavailable";
			spawnedEntityPresentationError = `Presentation reconciliation for WCID ${wcids || "<none>"} (${provenance}): ${errorMessage(error)}`;
		});
		return completion;
	}

	/** Route high-frequency accepted paths without restarting visual resource reconciliation. */
	function acceptDynamicEntityEvent(event: DynamicEntityEvent): void {
		const session = dynamicEntitySession;
		if (session === undefined) return;
		spawnedEntities = session.mirror.entities();
		const held = explorerPossession;
		if (
			held !== null &&
			held.guid !== null &&
			!spawnedEntities.some(
				(entity) =>
					entity.identity.guid === held.guid &&
					entity.generation === held.entityGeneration,
			)
		) {
			retireFrontendPossession();
		}
		if (event.kind !== "advanced") {
			void reconcileSpawnedEntities();
			return;
		}
		const runtime = gameRuntime;
		if (runtime === undefined) return;
		try {
			runtime.applySpawnedDynamicEntityAdvances(event.batch, performance.now());
			spawnedEntityPresentationError = null;
		} catch (error) {
			spawnedEntityPresentationError = `Dynamic-entity path presentation: ${errorMessage(error)}`;
		}
	}

	/** Apply one host epoch to entity and camera playback from the exact same receipt instant. */
	function acceptFixedTick({
		envelope,
		receivedAtMs,
	}: ExplorerFixedTickReceipt): void {
		const entityEvent = envelope.entityEvent;
		if (entityEvent !== null) {
			const session = dynamicEntitySession;
			if (session !== undefined) spawnedEntities = session.mirror.entities();
			const held = explorerPossession;
			if (
				held !== null &&
				held.guid !== null &&
				!spawnedEntities.some(
					(entity) =>
						entity.identity.guid === held.guid &&
						entity.generation === held.entityGeneration,
				)
			) {
				retireFrontendPossession();
			}
			try {
				gameRuntime?.applySpawnedDynamicEntityAdvances(
					entityEvent.batch,
					receivedAtMs,
				);
				spawnedEntityPresentationError = null;
			} catch (error) {
				spawnedEntityPresentationError = `Dynamic-entity path presentation: ${errorMessage(error)}`;
			}
		}
		if (envelope.boom !== null) {
			boomCameraSession?.receive(
				envelope.boom,
				envelope.durationMs,
				receivedAtMs,
			);
		}
	}

	async function spawnExplorerEntity(
		rawWcid: string,
		distance: number,
	): Promise<void> {
		const session = dynamicEntitySession;
		const coordinator = cameraCoordinator;
		const controller = cameraController;
		if (!session || !coordinator || !controller)
			throw new Error("Explorer entity spawning requires an active runtime.");
		const placement = coordinator.presentedPlacement();
		if (placement === null)
			throw new Error("Spawn requires a currently presented camera placement.");
		const request = createExplorerSpawnRequest(
			parseExplorerWcid(rawWcid),
			placement,
			physicalCameraInput(controller).viewDirection,
			distance,
			"simulated",
		);
		await session.spawn(request);
		await dynamicEntityReconciliation;
	}

	/// Drive with no axis held, used when a stance changes while no key is down.
	const IDLE_DRIVE: CharacterDrive = {
		gait: "run",
		lateral: null,
		longitudinal: null,
		turn: null,
	};

	/// Drive owner for the possessed entity, alive only while something is possessed.
	///
	/// Deliberately separate from camera navigation: possession routes the semantic character axes
	/// to the entity while the camera controller retains only view/boom gestures.
	let possessionInput: CharacterInputController | undefined;
	/// Monotonic semantic revision within the active host-issued possession generation.
	let possessionIntentRevision = 0;

	/// Third-person boom, alive exactly while an entity is possessed.
	///
	/// Owns only the boom's length. Orbit stays with the look controller, which already produces
	/// yaw and pitch from pointer input and keeps them continuous across possession and release.
	let boomCameraSession: HostKinematicBoomSession | undefined;
	/** Live policy evidence shown beside the possessed entity while debugging camera placement. */
	let boomCameraStatus = $state<HostKinematicBoomStatus | null>(null);
	/// Session-total wheel displacement is accumulated host-side; this is only the unsent frame delta.
	///
	/// Command transport failures report through the existing camera-host error surface.
	let pendingBoomZoom = 0;

	async function beginBoomCamera(
		possession: ExplorerPossession,
	): Promise<void> {
		if (possession.guid === null) {
			throw new Error("A released possession cannot start a host boom.");
		}
		// The same authority transfer a physical camera performs: the drive keys belong to the
		// possessed entity, so free fly must stop translating or both would consume them.
		cameraController?.setControlScheme({ kind: "possessed-character" });
		const previous = boomCameraSession;
		boomCameraSession = undefined;
		await previous?.stop();
		boomCameraStatus = null;
		pendingBoomZoom = 0;
		const controller = cameraController;
		if (controller === undefined) {
			throw new Error(
				"Host boom registration requires an active camera controller.",
			);
		}
		const boom = new HostKinematicBoomSession(
			tauriHostKinematicBoomTransport(),
		);
		boomCameraSession = boom;
		await boom.start(
			{
				possessionGeneration: possession.possessionGeneration,
				guid: possession.guid,
				entityGeneration: possession.entityGeneration,
			},
			FRONTEND_TUNING.explorer.camera.boom.distance,
			resolveKinematicBoomDirection(
				physicalCameraInput(controller).viewDirection,
			),
		);
		if (boomCameraSession === boom) boomCameraStatus = boom.status();
	}

	async function endBoomCamera(): Promise<void> {
		// Free fly resumes from wherever the boom left the camera, because `applyPresentedPosition`
		// has been writing that position every frame; only translation authority returns here.
		const boom = boomCameraSession;
		boomCameraSession = undefined;
		boomCameraStatus = null;
		pendingBoomZoom = 0;
		restoreCameraControlScheme();
		await boom?.stop();
	}

	/// Route one frame to whichever camera currently owns position.
	///
	/// Three owners in priority order, and the order matters: a boom outranks a physical session
	/// because possession is the more specific state. A possessed entity that is momentarily
	/// unpresented — an ordinary condition while presentation reconciles — falls through to free
	/// fly, which holds still rather than drifting, since the boom has been writing its position
	/// into the controller every frame and possession has taken the drive keys away.
	function syncActiveCamera(
		physicalPlacement: HostCameraPlacement | null,
		nowMs: number,
	): ExplorerCameraResidencySync | undefined {
		if (boomCameraSession) return syncBoomCamera(nowMs);
		if (physicalCameraSession || cameraModePending)
			return cameraCoordinator?.syncPhysicalCamera(physicalPlacement);
		return cameraCoordinator?.syncFreeFlyCamera();
	}

	/// Sample the host boom and hand its atomic position, pivot, and residency to the coordinator.
	///
	/// The look controller retains the operator's desired yaw/pitch for subsequent host intent. The
	/// rendered orientation instead follows the same host path as position, preventing desired input
	/// from visually outrunning collision-safe boom motion.
	function syncBoomCamera(nowMs: number) {
		const boom = boomCameraSession;
		const controller = cameraController;
		const coordinator = cameraCoordinator;
		if (!boom || !controller || !coordinator) return undefined;
		const desiredOrientation = controller.snapshotState();
		const zoomDisplacement = pendingBoomZoom;
		pendingBoomZoom = 0;
		void boom
			.setIntent(
				resolveKinematicBoomDirection(
					physicalCameraInput(controller).viewDirection,
				),
				zoomDisplacement,
			)
			.catch((error: unknown) => {
				if (boomCameraSession === boom)
					physicalCameraError = errorMessage(error);
			});
		boomCameraStatus = boom.status();
		const presentation = boom.presentation(nowMs);
		if (presentation === null) {
			const placement = coordinator.presentedPlacement();
			if (placement === null) return undefined;
			return coordinator.syncBoomCamera(
				placement,
				desiredOrientation.yawRadians,
				desiredOrientation.pitchRadians,
			);
		}
		const { placement, visualPivot } = presentation;
		const orientation = createCameraLookAtAngles(
			placement.position,
			visualPivot,
		);
		controller.applyPresentedPosition(placement.position);
		return coordinator.syncBoomCamera(
			placement,
			orientation.yawRadians,
			orientation.pitchRadians,
		);
	}

	function sendPossessedIntent(): void {
		const session = dynamicEntitySession;
		const input = possessionInput;
		const held = explorerPossession;
		if (
			!session ||
			input === undefined ||
			held === null ||
			held.guid === null
		) {
			return;
		}
		possessionIntentRevision += 1;
		void session
			.setPossessionIntent({
				drive: input.drive(),
				possessionGeneration: held.possessionGeneration,
				revision: possessionIntentRevision,
				stance: MOTION_STYLE[possessedStance],
			})
			.catch((error: unknown) => {
				spawnedEntityPresentationError = errorMessage(error);
			});
	}

	function acceptPossessionEventOutcome(outcome: PossessionEventOutcome): void {
		const held = explorerPossession;
		if (
			held === null ||
			outcome.possessionGeneration !== held.possessionGeneration
		)
			return;
		if (outcome.result.kind !== "rejected") return;
		possessionInput?.rejectBegin(outcome.sequence);
		spawnedEntityPresentationError = `Possession ${outcome.sequence} rejected: ${outcome.result.reason}.`;
	}

	function queuePossessedEdge(edge: CharacterInputEdge): void {
		const session = dynamicEntitySession;
		const input = possessionInput;
		const held = explorerPossession;
		if (!session || input === undefined || held === null || held.guid === null)
			return;
		possessionIntentRevision += 1;
		const drive = edge.kind === "reset" ? input.drive() : edge.drive;
		void session
			.queuePossessionEvent({
				...edge,
				drive,
				possessionGeneration: held.possessionGeneration,
				revision: possessionIntentRevision,
				stance: MOTION_STYLE[possessedStance],
			})
			.then((receipt) => {
				for (const outcome of receipt.outcomes)
					acceptPossessionEventOutcome(outcome);
			})
			.catch((error: unknown) => {
				spawnedEntityPresentationError = errorMessage(error);
				if (
					explorerPossession?.possessionGeneration !== held.possessionGeneration
				)
					return;
				// A missing sequence can strand every later edge. End both sides of this ownership
				// epoch; if the transport is unavailable, the generation check still protects the host.
				void session
					.possess(null)
					.catch((releaseError: unknown) => {
						spawnedEntityPresentationError = `${errorMessage(error)} Release also failed: ${errorMessage(releaseError)}`;
					})
					.finally(() => {
						if (
							explorerPossession?.possessionGeneration ===
							held.possessionGeneration
						)
							retireFrontendPossession();
					});
			});
	}

	function retireFrontendPossession(): void {
		possessionInput?.releaseOwnership();
		possessionInput = undefined;
		explorerPossession = null;
		possessionIntentRevision = 0;
		void endBoomCamera().catch((error: unknown) => {
			physicalCameraError = errorMessage(error);
		});
	}

	async function possessExplorerEntity(
		guid: number | null,
	): Promise<ExplorerPossession> {
		const session = dynamicEntitySession;
		if (!session)
			throw new Error("Explorer possession requires an active runtime.");
		if (
			guid !== null &&
			(cameraCoordinator?.presentedPlacement() ?? null) === null
		) {
			throw new Error(
				"Explorer possession requires a currently presented camera placement.",
			);
		}
		const possession = await session.possess(guid);
		if (possession.guid === null) {
			// Installing the next scheme first asks the outgoing character owner for its one reset.
			cameraController?.setControlScheme(nonPossessionCameraControlScheme());
			explorerPossession = null;
			possessionInput = undefined;
			possessionIntentRevision = 0;
			await endBoomCamera();
			return possession;
		}
		explorerPossession = possession;
		const acceptedName = (Object.keys(MOTION_STYLE) as MotionStyleName[]).find(
			(candidate) => MOTION_STYLE[candidate] === possession.acceptedStance,
		);
		if (acceptedName === undefined)
			throw new Error(
				`Host accepted unknown possession stance 0x${possession.acceptedStance.toString(16)}.`,
			);
		possessedStance = acceptedName;
		possessionIntentRevision = 0;
		const capability = possessionStance(possession, possession.acceptedStance);
		if (capability === null)
			throw new Error(
				"Host omitted the accepted possession stance capability.",
			);
		// Transition before installing the new sink so held camera keys cannot leak into the new
		// character ownership epoch; keys held across the cutover require a fresh browser press.
		cameraController?.setControlScheme({ kind: "possessed-character" });
		possessionInput = new CharacterInputController({
			fullChargeDurationMs: capability.chargeDurationMs,
			now: () => performance.now(),
			onDrive: () => sendPossessedIntent(),
			onEdge: queuePossessedEdge,
		});
		try {
			await beginBoomCamera(possession);
		} catch (error) {
			try {
				await session.possess(null);
			} finally {
				retireFrontendPossession();
			}
			throw error;
		}
		return possession;
	}

	async function setExplorerEntityStance(style: number): Promise<void> {
		const session = dynamicEntitySession;
		const held = explorerPossession;
		if (!session || held === null || held.guid === null) return;
		const name = (Object.keys(MOTION_STYLE) as MotionStyleName[]).find(
			(candidate) => MOTION_STYLE[candidate] === style,
		);
		if (name === undefined)
			throw new Error(`Unknown possession stance 0x${style.toString(16)}.`);
		possessionIntentRevision += 1;
		const result = await session.setPossessionIntent({
			drive: possessionInput?.drive() ?? IDLE_DRIVE,
			possessionGeneration: held.possessionGeneration,
			revision: possessionIntentRevision,
			stance: style,
		});
		if (result === "accepted") {
			const capability = possessionStance(held, style);
			if (capability === null)
				throw new Error(
					"Host accepted a stance absent from its capability receipt.",
				);
			possessedStance = name;
			possessionInput?.setFullChargeDurationMs(capability.chargeDurationMs);
		}
	}

	async function despawnExplorerEntity(
		entity: DynamicEntityView,
	): Promise<void> {
		const session = dynamicEntitySession;
		if (!session)
			throw new Error("Explorer entity despawn requires an active runtime.");
		await session.despawn(entity.identity.guid, entity.generation);
		await dynamicEntityReconciliation;
	}

	onMount(() => {
		const canvas = canvasElement;
		if (canvas === null) {
			startupError = "Explorer canvas was not mounted.";
			return;
		}

		let destroyed = false;
		let teardown: Promise<void> | undefined;

		const stopFrameLoop = (): void => {
			if (frameHandle === null) return;
			window.cancelAnimationFrame(frameHandle);
			frameHandle = null;
		};

		const destroySystems = (): Promise<void> => {
			if (teardown) return teardown;
			const runtime = gameRuntime;
			const pipeline = commitPipeline;
			const device = webglDevice;
			const regionSource = activeRegionSource;
			const detailOwner = staticDetailOwner;
			const coordinator = cameraCoordinator;
			const controller = cameraController;
			const physicalSession = physicalCameraSession;
			const boomSession = boomCameraSession;
			const entitySession = dynamicEntitySession;
			const entityUnsubscribe = unsubscribeDynamicEntities;
			const fixedTickUnsubscribe = unsubscribeFixedTicks;
			const possessionOutcomeUnsubscribe = unsubscribePossessionOutcomes;
			gameRuntime = undefined;
			runtimeReady = false;
			cameraLocation = null;
			rendererFrameDiagnostics = null;
			authoredDynamicRuntimeDiagnostics = null;
			commitPipeline = undefined;
			webglDevice = undefined;
			textureFilteringCapabilities = null;
			activeRegionSource = undefined;
			skySource?.destroy();
			skySource = undefined;
			staticDetailOwner = undefined;
			activeRegion = undefined;
			cameraCoordinator = undefined;
			cameraController = undefined;
			physicalCameraSession = undefined;
			boomCameraSession = undefined;
			boomCameraStatus = null;
			dynamicEntitySession = undefined;
			unsubscribeDynamicEntities = undefined;
			unsubscribeFixedTicks = undefined;
			unsubscribePossessionOutcomes = undefined;
			dynamicEntityReconciliationRevision += 1;
			dynamicEntityReconciliation = Promise.resolve();
			entityCatalog = null;
			spawnedEntities = [];
			spawnedEntityPresentationError = null;
			simulationInterestController = undefined;
			physicalSimulationAnchor = null;
			cameraMode = "free-fly";
			cameraModePending = false;
			physicalCameraStatus = null;
			teardown = (async () => {
				stopFrameLoop();
				entityUnsubscribe?.();
				fixedTickUnsubscribe?.();
				possessionOutcomeUnsubscribe?.();
				entitySession?.stop();
				coordinator?.dispose();
				controller?.dispose();
				try {
					await boomSession?.stop();
				} finally {
					try {
						await physicalSession?.stop();
					} finally {
						try {
							await runtime?.destroy();
						} finally {
							try {
								await pipeline?.destroy();
							} finally {
								try {
									await device?.destroy();
								} finally {
									detailOwner?.teardown();
									regionSource?.destroy();
								}
							}
						}
					}
				}
			})();
			return teardown;
		};

		const start = async (): Promise<void> => {
			try {
				const entitySession = new ExplorerDynamicEntitySession(
					tauriExplorerDynamicEntityTransport(),
				);
				dynamicEntitySession = entitySession;
				unsubscribeDynamicEntities = entitySession.subscribe(
					acceptDynamicEntityEvent,
				);
				unsubscribeFixedTicks =
					entitySession.subscribeFixedTicks(acceptFixedTick);
				unsubscribePossessionOutcomes =
					entitySession.subscribePossessionOutcomes(
						acceptPossessionEventOutcome,
					);
				await entitySession.start();
				entityCatalog = await entitySession.catalogCapability();
				if (destroyed) return;
				activeRegionSource = TauriActiveRegionSource.build();
				activeRegion = await activeRegionSource.load();
				if (destroyed) return;
				const sourceBatch = TauriLandblockSourceBatch.build(activeRegion);
				const texturePixelSource = TauriTexturePixelSource.build();
				staticDetailOwner = new ActiveRegionStaticDetailOwner(
					texturePixelSource,
				);
				const staticDetailBinding =
					await staticDetailOwner.install(activeRegion);
				if (destroyed) return;
				webglDevice = await WebGL2Device.build(canvas);
				textureFilteringCapabilities =
					webglDevice.getTextureFilteringCapabilities();
				if (destroyed) return;
				commitPipeline = await StandardCommitPipeline.build({
					sourceBatch,
				});
				if (destroyed) return;

				gameRuntime = await GameRuntime.build(
					webglDevice,
					commitPipeline,
					texturePixelSource,
					TauriAnimationAssetSource.build(),
					TauriPhysicsScriptSource.build(),
					new WebAudioDevice(
						new AudioContext(),
						TauriAudioSource.build(),
						FRONTEND_TUNING.audio.placementSmoothingSeconds,
						FRONTEND_TUNING.audio.loudnessCurveExponent,
					),
					TauriParticleEmitterSource.build(),
					TauriSoundTableSource.build(),
					TauriParticleMeshSource.build(),
					new TauriDynamicEntityVisualSource(),
					undefined,
					// The Explorer is a development surface and its Frame panel reports tick
					// timing; the thin client route passes nothing and pays nothing.
					new RuntimeTickProfiler(),
				);
				gameRuntime.installActiveRegionStaticDetails(staticDetailBinding);
				void reconcileSpawnedEntities();
				// Ambience is selected by the ground rather than by a hook, so nothing else pulls its
				// sound tables in; installing the region's facts is what stages them.
				if (activeRegion?.data.sound && activeRegion.data.scenes) {
					void gameRuntime.installAmbientRegion({
						sceneTypes: activeRegion.data.scenes.types.map((type) => ({
							soundTableIndex: type.soundTableIndex,
						})),
						tables: activeRegion.data.sound.tables.map((table) => ({
							soundTableId: table.soundTableId,
							sounds: table.sounds,
						})),
						terrainTypes:
							activeRegion.data.terrain?.types.map((type) => ({
								sceneTypes: type.sceneTypes,
							})) ?? [],
					});
				}
				skySource = new TauriSkySource();
				await gameRuntime.installSky(await skySource.loadSkySource());
				if (destroyed) return;
				applyEnvironment();
				applyFrameSettings();
				if (destroyed) return;
				cameraController = new FrontendCameraController({
					canvas,
					keyboardYawRadiansPerSecond(shiftActive) {
						const controls = FRONTEND_TUNING.explorer.camera.controls;
						return (
							controls.keyboardYawRadiansPerSecond *
							(shiftActive ? controls.shiftSlowMultiplier : 1)
						);
					},
					onChange(state) {
						if (cameraCoordinator) {
							cameraCoordinator.handleCameraState(state);
						}
						sendPhysicalCameraIntent();
					},
					onCharacterInput: handleCameraCharacterInput,
					onPhysicalWheel: sendPhysicalCameraWheel,
				});
				cameraCoordinator = new ExplorerCameraCoordinator(
					gameRuntime,
					cameraController,
					(status) => (cameraFocusStatus = status),
				);
				simulationInterestController = new SimulationInterestController(
					tauriSimulationInterestTransport(),
				);
				runtimeReady = true;

				const step = (): void => {
					if (gameRuntime === undefined) {
						frameMetrics = null;
						rendererFrameDiagnostics = null;
						authoredDynamicRuntimeDiagnostics = null;
						frameHandle = window.requestAnimationFrame(step);
						return;
					}

					const tickStartedAt = performance.now();
					const activePhysicalSession = physicalCameraSession;
					const terminalError =
						activePhysicalSession?.takeTerminalError() ?? null;
					if (
						terminalError !== null &&
						physicalCameraSession === activePhysicalSession
					) {
						physicalCameraError = errorMessage(terminalError);
						void leavePhysicalCamera(true);
					}
					const physicalPlacement = physicalCameraSession?.placement() ?? null;
					if (physicalPlacement && cameraController) {
						cameraController.applyPresentedPosition(physicalPlacement.position);
						physicalCameraStatus = physicalCameraSession?.status() ?? null;
						followPhysicalSimulationInterest(
							physicalPlacement.residency.landblockId,
						);
					}
					gameRuntime.tick();
					const residencySync = syncActiveCamera(
						physicalPlacement,
						tickStartedAt,
					);
					if (!residencySync) {
						throw new Error(
							"Explorer camera coordinator is unavailable during rendering.",
						);
					}
					cameraLocation = residencySync.location;
					const followResidency = residencySync.location?.residency;
					if (interestFollowsCamera && followResidency?.kind === "resolved") {
						followCameraSceneInterest(followResidency.residency);
					}
					const updateAndDrawStartedAt = performance.now();
					if (residencySync.renderable) {
						gameRuntime.render(performance.now() / 1_000);
					}
					const frameFinishedAt = performance.now();

					frameMetrics = {
						tickMs: updateAndDrawStartedAt - tickStartedAt,
						updateFrameMs: frameFinishedAt - updateAndDrawStartedAt,
						frameMs: frameFinishedAt - tickStartedAt,
					};
					if (frameFinishedAt - lastFrameSelectionSampleAt >= 250) {
						rendererFrameDiagnostics =
							gameRuntime.getRendererFrameDiagnostics();
						authoredDynamicRuntimeDiagnostics =
							gameRuntime.getAuthoredDynamicRuntimeDiagnostics();
						lastFrameSelectionSampleAt = frameFinishedAt;
					}
					frameHandle = window.requestAnimationFrame(step);
				};

				frameHandle = window.requestAnimationFrame(step);
			} catch (error) {
				startupError =
					error instanceof Error
						? error.message
						: "Failed to initialize renderer.";
				await destroySystems();
			}
		};

		const startup = start();

		return () => {
			destroyed = true;
			clearInterval(clockTimer);
			clockTimer = undefined;
			void startup
				.then(() => destroySystems())
				.catch((error: unknown) =>
					console.error("Failed to shut down explorer systems.", error),
				);
		};
	});
</script>

<div class="explorer-screen">
	<canvas
		bind:this={canvasElement}
		class="explorer-canvas"
		aria-label="Explorer render viewport"
		tabindex="0"
	></canvas>

	<div class="explorer-overlay">
		{#if startupError !== null}
			<section class="explorer-startup-error" role="alert">
				{startupError}
			</section>
		{/if}

		<FrameMetricsOverlay metrics={frameMetrics} />
		{#if startupError === null}
			<ExplorerCameraLocation location={cameraLocation} />
		{/if}
		<ExplorerTools
			{runtimeReady}
			{requestSceneInterest}
			{cameraFocusStatus}
			{cameraMode}
			{cameraModePending}
			{physicalCameraStatus}
			{physicalCameraError}
			{updateCameraMode}
			{environmentSelection}
			dayGroupNames={activeRegion?.data.sky?.dayGroups.map(
				({ dayName }) => dayName,
			) ?? []}
			{updateEnvironment}
			distanceFogEnabled={frameSettings.distanceFogEnabled}
			ambientOcclusion={frameSettings.ambientOcclusion}
			colorGrade={frameSettings.colorGrade}
			{updateColorGradeSettings}
			{clockFollowing}
			{interestFollowsCamera}
			{updateInterestFollowsCamera}
			{audioFollowsCamera}
			{effectVolume}
			{ambientVolume}
			{updateAudioFollowsCamera}
			{updateEffectVolume}
			{updateAmbientVolume}
			{updateClockFollowing}
			{updateDistanceFog}
			{updateAmbientOcclusionSettings}
			{updateViewerLight}
			viewerLightEnabled={frameSettings.viewerLightEnabled}
			{updateWeather}
			weatherEnabled={frameSettings.weatherEnabled}
			envCellRenderMode={frameSettings.envCellRenderMode}
			{updateEnvCellRenderMode}
			layerVisibility={frameSettings.layerVisibility}
			{updateLayerVisibility}
			textureFiltering={effectiveTextureFiltering}
			textureFilteringOptions={supportedTextureFiltering}
			maximumTextureAnisotropy={textureFilteringCapabilities?.maximumAnisotropy ??
				null}
			{updateTextureFiltering}
			renderScale={frameSettings.quality.renderScale}
			renderScaleOptions={RENDER_SCALE_OPTIONS}
			{updateRenderScale}
			{rendererFrameDiagnostics}
			{updateRendererFrameProfiling}
			{captureFrameDiagnosticReport}
			{authoredDynamicRuntimeDiagnostics}
			{readStaticObjectRuntimeDiagnostics}
			{readTextureAtlasPage}
			{entityCatalog}
			{spawnedEntities}
			{spawnedEntityPresentationError}
			{spawnExplorerEntity}
			{despawnExplorerEntity}
			{possessExplorerEntity}
			{setExplorerEntityStance}
			{explorerPossession}
			{boomCameraStatus}
		/>
	</div>
</div>
