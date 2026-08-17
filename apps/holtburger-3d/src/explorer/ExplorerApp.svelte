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
	import type { SceneResidency } from "../lib/game/scene";
	import {
		DEFAULT_FRAME_SETTINGS,
		type FrameSettings,
		type EnvCellRenderMode,
		type RendererFrameDiagnosticsSnapshot,
	} from "../lib/game/renderer/renderer";
	import type { AmbientOcclusionSettings } from "../lib/game/renderer/ambient-occlusion-policy";
	import {
		ExplorerCameraCoordinator,
		type ExplorerCameraFocusStatus,
	} from "./explorer-camera-coordinator";
	import {
		FreeFlyCameraController,
		type CameraCharacterInput,
	} from "./free-fly-camera-controller";
	import {
		resolvePhysicalCameraViewDirection,
		resolvePhysicalFlyVelocity,
		resolvePhysicalFlyWheelDisplacement,
		type ExplorerCameraMode,
		type PhysicalCameraMode,
		type PhysicalCameraLocalMovement,
	} from "../lib/game/motion/host-physical-camera-path";
	import {
		GroundedCharacterInput,
		type GroundedCharacterEdge,
	} from "./grounded-character-input";
	import {
		PhysicalCameraSession,
		type PhysicalCameraStatus,
	} from "./physical-camera-session";
	import { tauriPhysicalCameraTransport } from "./physical-camera-transport";
	import { SimulationInterestController } from "./simulation-interest";
	import { tauriSimulationInterestTransport } from "./simulation-interest-transport";
	import {
		ExplorerDynamicEntitySession,
		tauriExplorerDynamicEntityTransport,
	} from "./explorer-dynamic-entity-session";
	import {
		createExplorerSpawnRequest,
		parseExplorerWcid,
		type ExplorerCatalogCapability,
	} from "./explorer-entity-commands";
	import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";
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
	import {
		createExplorerFrameDiagnosticReport,
		type ExplorerFrameDiagnosticReport,
		type ExplorerSceneInterestSnapshot,
	} from "./explorer-frame-diagnostic-report";

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let frameHandle: number | null = null;
	let gameRuntime: GameRuntime | undefined;
	let commitPipeline: StandardCommitPipeline | undefined;
	let webglDevice: WebGL2Device | undefined;
	let activeRegionSource: TauriActiveRegionSource | undefined;
	let skySource: TauriSkySource | undefined;
	let staticDetailOwner: ActiveRegionStaticDetailOwner | undefined;
	let cameraController: FreeFlyCameraController | undefined;
	let cameraCoordinator: ExplorerCameraCoordinator | undefined;
	let physicalCameraSession: PhysicalCameraSession | undefined;
	let groundedCharacterInput: GroundedCharacterInput | undefined;
	let simulationInterestController: SimulationInterestController | undefined;
	let dynamicEntitySession: ExplorerDynamicEntitySession | undefined;
	let unsubscribeDynamicEntities: (() => void) | undefined;
	let dynamicEntityReconciliation: Promise<void> = Promise.resolve();
	let dynamicEntityReconciliationRevision = 0;
	let entityCatalog = $state<ExplorerCatalogCapability | null>(null);
	let spawnedEntities = $state<readonly DynamicEntityView[]>([]);
	let spawnedEntityPresentationError = $state<string | null>(null);
	let physicalSimulationAnchor: string | null = null;
	let cameraMode = $state<ExplorerCameraMode>("free-fly");
	let cameraModePending = $state(false);
	let physicalCameraStatus = $state<PhysicalCameraStatus | null>(null);
	let physicalCameraError = $state<string | null>(null);
	let jumpChargeExtent = $state<number | null>(null);
	let frameMetrics: FrameMetrics | null = $state(null);
	let rendererFrameDiagnostics: RendererFrameDiagnosticsSnapshot | null =
		$state(null);
	let sceneInterest: ExplorerSceneInterestSnapshot | null = null;
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
			sceneInterest,
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
		sceneInterest = {
			radii: { ...radii },
			residency: { ...residency },
		};
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

	function physicalCameraInput(controller: FreeFlyCameraController): {
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
			movement as PhysicalCameraLocalMovement,
			cameraBasis,
			FRONTEND_TUNING.explorer.camera.controls.moveSpeed *
				(precision
					? FRONTEND_TUNING.explorer.camera.controls.shiftSlowMultiplier
					: 1),
		);
		return {
			basis: cameraBasis,
			viewDirection: resolvePhysicalCameraViewDirection(cameraBasis),
			worldVelocity,
		};
	}

	function sendPhysicalCameraIntent(): void {
		const session = physicalCameraSession;
		const controller = cameraController;
		if (!session?.running || !controller) return;
		const mode =
			session.status().mode ?? (cameraMode === "free-fly" ? null : cameraMode);
		if (mode === null) return;
		const input = physicalCameraInput(controller);
		const characterInput = groundedCharacterInput;
		let request: Promise<void>;
		if (mode === "grounded-walk") {
			if (characterInput === undefined) {
				physicalCameraError =
					"Grounded camera session has no character input owner.";
				return;
			}
			request = session.setGroundedDrive(
				characterInput.drive(),
				input.viewDirection,
			);
		} else {
			request = session.setIntent(input.worldVelocity, input.viewDirection);
		}
		void request.catch((error: unknown) => {
			if (physicalCameraSession !== session) return;
			physicalCameraError = errorMessage(error);
		});
	}

	function sendPhysicalCameraWheel(localUpDistance: number): void {
		const session = physicalCameraSession;
		const controller = cameraController;
		if (!session?.running || !controller) return;
		const mode =
			session.status().mode ?? (cameraMode === "free-fly" ? null : cameraMode);
		if (mode !== "physical-fly") return;
		const input = physicalCameraInput(controller);
		void session
			.addDisplacement(
				resolvePhysicalFlyWheelDisplacement(input.basis, localUpDistance),
				input.worldVelocity,
				input.viewDirection,
			)
			.catch((error: unknown) => {
				if (physicalCameraSession !== session) return;
				physicalCameraError = errorMessage(error);
			});
	}

	function createGroundedCharacterInput(
		session: PhysicalCameraSession,
	): GroundedCharacterInput {
		return new GroundedCharacterInput({
			fullChargeDurationMs: session.groundedJumpChargeDurationMs(),
			now: () => performance.now(),
			onDrive: () => sendPhysicalCameraIntent(),
			onEdge: (edge: GroundedCharacterEdge) => {
				const controller = cameraController;
				if (controller === undefined) return;
				const viewDirection = physicalCameraInput(controller).viewDirection;
				void session
					.queueGroundedEvent(edge, viewDirection)
					.catch((error: unknown) => {
						if (physicalCameraSession !== session) return;
						physicalCameraError = errorMessage(error);
						// A missing discrete edge would strand the host's contiguous sequence. End
						// this ownership epoch instead of allowing later input to queue behind a gap.
						void leavePhysicalCamera(true);
					});
			},
		});
	}

	function handleCameraCharacterInput(input: CameraCharacterInput): void {
		const characterInput = groundedCharacterInput;
		if (cameraMode !== "grounded-walk" || characterInput === undefined) return;
		if (input.kind === "reset") {
			characterInput.reset();
			return;
		}
		characterInput.applyKey(input.key, input.pressed, input.repeat);
	}

	async function enterPhysicalCamera(mode: PhysicalCameraMode): Promise<void> {
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
		controller.setLocalTranslationEnabled(false);
		const session = new PhysicalCameraSession(tauriPhysicalCameraTransport());
		try {
			await session.start(
				placement,
				physicalCameraInput(controller).viewDirection,
				mode,
			);
			if (cameraController !== controller || !runtimeReady) {
				await session.stop();
				controller.setLocalTranslationEnabled(true);
				cameraMode = "free-fly";
				return;
			}
			physicalCameraSession = session;
			cameraMode = mode;
			groundedCharacterInput =
				mode === "grounded-walk"
					? createGroundedCharacterInput(session)
					: undefined;
			sendPhysicalCameraIntent();
		} catch (error) {
			controller.setLocalTranslationEnabled(true);
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
		physicalCameraSession = undefined;
		groundedCharacterInput = undefined;
		jumpChargeExtent = null;
		const presented = controller.snapshotState();
		controller.adoptPresentedPose(presented);
		if (preserveResidency && lastHostResidency !== null) {
			cameraCoordinator?.seedFreeFlyResidency(lastHostResidency);
		}
		controller.setLocalTranslationEnabled(true);
		cameraMode = "free-fly";
		physicalCameraStatus = null;
		try {
			await session.stop();
		} catch (error) {
			physicalCameraError = errorMessage(error);
		}
	}

	async function replacePhysicalCamera(
		mode: PhysicalCameraMode,
	): Promise<void> {
		const oldSession = physicalCameraSession;
		const controller = cameraController;
		if (!oldSession || !controller || cameraModePending) return;
		cameraModePending = true;
		physicalCameraError = null;
		const lastHostPlacement =
			cameraCoordinator?.presentedPlacement() ?? oldSession.placement() ?? null;
		const lastHostResidency = lastHostPlacement?.residency ?? null;
		physicalCameraSession = undefined;
		groundedCharacterInput = undefined;
		jumpChargeExtent = null;
		controller.adoptPresentedPose(controller.snapshotState());
		controller.setLocalTranslationEnabled(false);
		physicalCameraStatus = null;
		try {
			await oldSession.stop();
			if (cameraController !== controller || !runtimeReady) {
				controller.setLocalTranslationEnabled(true);
				cameraMode = "free-fly";
				return;
			}
			const nextSession = new PhysicalCameraSession(
				tauriPhysicalCameraTransport(),
			);
			if (lastHostPlacement === null) {
				throw new Error(
					"Physical camera replacement lost its presented placement.",
				);
			}
			await nextSession.start(
				lastHostPlacement,
				physicalCameraInput(controller).viewDirection,
				mode,
			);
			if (cameraController !== controller || !runtimeReady) {
				await nextSession.stop();
				controller.setLocalTranslationEnabled(true);
				cameraMode = "free-fly";
				return;
			}
			physicalCameraSession = nextSession;
			cameraMode = mode;
			groundedCharacterInput =
				mode === "grounded-walk"
					? createGroundedCharacterInput(nextSession)
					: undefined;
			sendPhysicalCameraIntent();
		} catch (error) {
			if (lastHostResidency !== null) {
				cameraCoordinator?.seedFreeFlyResidency(lastHostResidency);
			}
			controller.setLocalTranslationEnabled(true);
			cameraMode = "free-fly";
			physicalCameraError = errorMessage(error);
		} finally {
			cameraModePending = false;
		}
	}

	function updateCameraMode(mode: ExplorerCameraMode): void {
		if (mode === cameraMode || cameraModePending) return;
		if (mode === "free-fly") {
			void leavePhysicalCamera(true);
		} else if (physicalCameraSession) {
			void replacePhysicalCamera(mode);
		} else {
			void enterPhysicalCamera(mode);
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
		);
		await session.spawn(request);
		await dynamicEntityReconciliation;
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
			const entitySession = dynamicEntitySession;
			const entityUnsubscribe = unsubscribeDynamicEntities;
			gameRuntime = undefined;
			runtimeReady = false;
			cameraLocation = null;
			rendererFrameDiagnostics = null;
			sceneInterest = null;
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
			dynamicEntitySession = undefined;
			unsubscribeDynamicEntities = undefined;
			dynamicEntityReconciliationRevision += 1;
			dynamicEntityReconciliation = Promise.resolve();
			entityCatalog = null;
			spawnedEntities = [];
			spawnedEntityPresentationError = null;
			groundedCharacterInput = undefined;
			jumpChargeExtent = null;
			simulationInterestController = undefined;
			physicalSimulationAnchor = null;
			cameraMode = "free-fly";
			cameraModePending = false;
			physicalCameraStatus = null;
			teardown = (async () => {
				stopFrameLoop();
				entityUnsubscribe?.();
				entitySession?.stop();
				coordinator?.dispose();
				controller?.dispose();
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
			})();
			return teardown;
		};

		const start = async (): Promise<void> => {
			try {
				const entitySession = new ExplorerDynamicEntitySession(
					tauriExplorerDynamicEntityTransport(),
				);
				dynamicEntitySession = entitySession;
				unsubscribeDynamicEntities = entitySession.subscribe(() => {
					void reconcileSpawnedEntities();
				});
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
					new WebAudioDevice(new AudioContext(), TauriAudioSource.build()),
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
				cameraController = new FreeFlyCameraController({
					canvas,
					keyboardYawRadiansPerSecond(shiftActive) {
						const controls = FRONTEND_TUNING.explorer.camera.controls;
						if (cameraMode === "grounded-walk") {
							return shiftActive
								? controls.groundedWalkYawRadiansPerSecond
								: controls.groundedRunYawRadiansPerSecond;
						}
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
					for (const outcome of physicalCameraSession?.takeCharacterEventOutcomes() ??
						[]) {
						if (outcome.kind === "rejected") {
							groundedCharacterInput?.rejectBegin(outcome.sequence);
						}
					}
					jumpChargeExtent = groundedCharacterInput?.chargeExtent() ?? null;
					if (physicalPlacement && cameraController) {
						cameraController.applyPresentedPosition(physicalPlacement.position);
						physicalCameraStatus = physicalCameraSession?.status() ?? null;
						followPhysicalSimulationInterest(
							physicalPlacement.residency.landblockId,
						);
					}
					gameRuntime.tick();
					const residencySync =
						physicalCameraSession || cameraModePending
							? cameraCoordinator?.syncPhysicalCamera(physicalPlacement)
							: cameraCoordinator?.syncFreeFlyCamera();
					if (!residencySync) {
						throw new Error(
							"Explorer camera coordinator is unavailable during rendering.",
						);
					}
					cameraLocation = residencySync.location;
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
		{#if jumpChargeExtent !== null}
			<div class="explorer-jump-charge" aria-label="Jump power">
				<div
					class="explorer-jump-charge-fill"
					style:width={`${jumpChargeExtent * 100}%`}
				></div>
			</div>
		{/if}
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
			{clockFollowing}
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
		/>
	</div>
</div>
