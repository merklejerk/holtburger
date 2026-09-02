<script lang="ts">
	import { onMount } from "svelte";
	import FrameMetricsOverlay, {
		type FrameMetrics,
	} from "../app/FrameMetricsOverlay.svelte";
	import {
		createFrameRateSampler,
		type FrameRates,
		type FrameRateSampler,
	} from "../app/frame-rate-sampler";
	import ExplorerTools from "./ExplorerTools.svelte";
	import {
		GamePresentationRuntime,
		type StaticObjectRuntimeDiagnostics,
	} from "../lib/game/runtime/game-presentation-runtime";
	import { RuntimeTickProfiler } from "../lib/game/runtime/runtime-tick-profiler";
	import { GamePresentationOwner } from "../lib/game/runtime/game-presentation-owner";
	import {
		createProjectionClearanceRevision,
		type ProjectionClearanceRevision,
	} from "../lib/game/camera/projection-clearance";
	import { createElectronHostTransport } from "../lib/host/electron-host-transport";
	import type { SceneInterestRadii } from "../lib/game/runtime/types";
	import { LandblockLayerKind } from "../lib/game/runtime/scene-interest";
	import type { LandblockOwnerId } from "../lib/game/game-types";
	import type { ExplorerResidencyResolution } from "./explorer-residency";
	import {
		SceneInterestRequestCoordinator,
		type SceneInterestTarget,
	} from "../lib/game/runtime/scene-target";
	import {
		type FrameSettings,
		type EnvCellRenderMode,
		type RendererFrameDiagnosticsSnapshot,
	} from "../lib/game/renderer/renderer";
	import type { NameplateCategory } from "../lib/game/renderer/nameplate-policy";
	import type { AmbientOcclusionSettings } from "../lib/game/renderer/ambient-occlusion-policy";
	import type { ColorGradeSettings } from "../lib/game/renderer/color-grade-policy";
	import {
		ExplorerCameraCoordinator,
		type ExplorerCameraFocusStatus,
		type ExplorerCameraResidencySync,
	} from "./explorer-camera-coordinator";
	import {
		ExplorerCameraInputController,
		type CharacterKeyInput,
		type FrontendControlScheme,
	} from "./explorer-camera-input-controller";
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
		type ExplorerPossessionControls,
		type MotionStyleName,
		type PossessionEventOutcome,
		type PossessionMotionProbe,
	} from "./explorer-entity-possession";
	import {
		hostKinematicBoomTransport,
		type HostKinematicBoomStatus,
	} from "../lib/game/camera/host-kinematic-boom-session";
	import { PossessionCameraController } from "../lib/game/camera/possession-camera-controller";
	import {
		findSelectedExplorerEntity,
		refreshesExplorerEntityPanel,
		type ExplorerEntitySelection,
	} from "./explorer-entity-panel-state";
	import {
		createEntityFacingCameraYaw,
		resolveCameraLookAtAngles,
	} from "../lib/game/math/camera-orientation";
	import {
		PhysicalFlySession,
		type PhysicalFlyStatus,
	} from "./physical-fly-session";
	import { hostPhysicalFlyTransport } from "./physical-fly-transport";
	import {
		SimulationInterestController,
		type SimulationInterestReceipt,
	} from "./simulation-interest";
	import { hostSimulationInterestTransport } from "./simulation-interest-transport";
	import {
		ExplorerDynamicEntitySession,
		hostExplorerDynamicEntityTransport,
		type ExplorerFixedTickReceipt,
	} from "./explorer-dynamic-entity-session";
	import {
		createExplorerSpawnRequest,
		type ExplorerCatalogCapability,
		type ExplorerWeenieSearchRequest,
		type ExplorerWeenieSearchResult,
	} from "./explorer-entity-commands";
	import type {
		DynamicEntityEvent,
		DynamicEntityView,
	} from "../lib/game/runtime/dynamic-entity-feed";
	import { Vec3 } from "../lib/game/math/types";
	import { EXPLORER_TUNING } from "./explorer-tuning";
	import { presentExplorerPortalFrame } from "./explorer-portal-presentation";
	import {
		resolveSceneEnvironment,
		type ExplorerEnvironmentSelection,
	} from "../lib/game/environment/scene-environment";
	import { resolveDayFraction } from "../lib/game/environment/game-clock";
	import type { ActiveRegionSource } from "../lib/assets/active-region-source";
	import type { Texture2DReadback } from "../lib/game/renderer/webgl2-device";
	import type { TexturePageId } from "../lib/game/textures/texture-manager";
	import {
		formatExplorerCameraResidency,
		type ExplorerCameraLocation,
	} from "./explorer-camera-location";
	import MapPanel from "../app/MapPanel.svelte";
	import type { MapPanelFrame, MapPanelState } from "../app/map-panel-frame";
	import {
		type MapAnchor,
		mapHeadingFromSceneTransform,
	} from "../lib/game/map/map-view";
	import { dynamicEntityPlacementFromPoint } from "../lib/game/runtime/dynamic-entity-presentation";
	import { createLandblockWorldOrigin } from "../lib/game/landblocks";
	import type { ScenePlacement } from "../lib/game/scene";
	import { MAP_DEFAULT_VIEW_DIAMETERS } from "../lib/game/map/map-appearance";
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
	import {
		createEntityShadowSettings,
		type EntityShadowSettings,
	} from "../lib/game/renderer/entity-shadow-policy";

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let frameHandle: number | null = null;
	/** Borrowed imperative runtime; its lifecycle belongs to the shared presentation owner below. */
	let presentationOwner: GamePresentationOwner | undefined;
	let gameRuntime: GamePresentationRuntime | undefined;
	const hostTransport = createElectronHostTransport();
	let sceneInterestCoordinator: SceneInterestRequestCoordinator | undefined;
	let cameraController: ExplorerCameraInputController | undefined;
	let cameraCoordinator: ExplorerCameraCoordinator | undefined;
	let physicalCameraSession: PhysicalFlySession | undefined;
	let explorerPossession = $state<ExplorerPossession | null>(null);
	let possessedControls = $state<ExplorerPossessionControls | null>(null);
	let simulationInterestController: SimulationInterestController | undefined;
	let dynamicEntitySession: ExplorerDynamicEntitySession | undefined;
	let unsubscribeDynamicEntities: (() => void) | undefined;
	let unsubscribeFixedTicks: (() => void) | undefined;
	let unsubscribePossessionOutcomes: (() => void) | undefined;
	let dynamicEntityPresentationCompletion: Promise<void> = Promise.resolve();
	let dynamicEntityPresentationRevision = 0;
	/** Exact ordinary dynamic realization withholding an activated destination's first frame. */
	let sceneActivationPresentationConvergence: {
		readonly completion: Promise<void>;
		ready: boolean;
	} | null = null;
	let entityCatalog = $state<ExplorerCatalogCapability | null>(null);
	/** Cold replace-only panel snapshot; raw keeps host DTOs cloneable across later IPC boundaries. */
	let spawnedEntities = $state.raw<readonly DynamicEntityView[]>([]);
	let spawnedEntityPresentationError = $state<string | null>(null);
	let physicalSimulationAnchor: string | null = null;
	let cameraMode = $state<ExplorerCameraMode>("free-fly");
	let cameraModePending = $state(false);
	let physicalCameraStatus: PhysicalFlyStatus | null = null;
	let physicalCameraError = $state<string | null>(null);
	let frameMetrics: FrameMetrics | null = null;
	const frameRateSampler: FrameRateSampler = createFrameRateSampler(
		EXPLORER_TUNING.diagnostics.frameMetricsEmaWindowMs,
	);
	let startupError: string | null = $state(null);
	let runtimeReady = $state(false);
	let cameraFocusStatus = $state<ExplorerCameraFocusStatus>(
		"No camera focus requested.",
	);
	/**
	 * Latest presented camera position and residency, republished every frame.
	 *
	 * Deliberately not reactive. Its readers — the map panel's anchor and the frame diagnostic
	 * report — pull it imperatively on their own cadence, so publishing it through `$state` would
	 * schedule a Svelte flush per frame to notify a much slower consumer.
	 */
	let cameraLocation: ExplorerCameraLocation | null = null;
	/**
	 * Camera residency as the World tab prints it.
	 *
	 * This is the one reactive projection of the camera location, and it is a string precisely so
	 * that frames which do not change the resolved cell fail Svelte's equality check and schedule
	 * nothing at all.
	 */
	let cameraResidencyLabel = $state<string | null>(null);

	/** Publish one frame's camera location, deriving its label so the two never drift apart. */
	function publishCameraLocation(
		location: ExplorerCameraLocation | null,
	): void {
		cameraLocation = location;
		cameraResidencyLabel =
			location === null
				? null
				: formatExplorerCameraResidency(location.residency);
	}

	/**
	 * Overhead-map panel geometry and view choices.
	 *
	 * The panel is a controlled component: it owns no persistence policy, so the shell that mounts
	 * it owns where it sits and how far it sees. The Explorer keeps that here in memory.
	 */
	let mapPanel = $state<MapPanelState>({
		left: 16,
		size: 220,
		top: 96,
		viewDiameters: {
			...MAP_DEFAULT_VIEW_DIAMETERS,
		},
	});
	/** Heading the map orients by, kept in step with whatever controls the camera. */
	let cameraYawRadians = 0;

	/**
	 * Where the possessed entity is being drawn, refreshed every frame.
	 *
	 * Deliberately not derived from `spawnedEntities`: that snapshot exists for the diagnostics
	 * inspector and is republished only on identity changes and discontinuous corrections, so a
	 * walking character never moves it. The scene is what presentation rate updates.
	 */
	let possessedPlacement: ScenePlacement | null = null;

	/**
	 * Anchor on the possessed entity itself, not on the camera watching it.
	 *
	 * Possession is the one mode where the two genuinely differ: the camera orbits while the
	 * character faces where it is going, and it is the character's own position and facing that a
	 * map should be drawn around. The pose is converted through the same helper the scene uses, so
	 * the map cannot drift from where the entity is actually drawn.
	 */
	function anchorFromPossession(): MapAnchor | null {
		const placement = possessedPlacement;
		if (placement === null) return null;
		const origin = createLandblockWorldOrigin(placement.landblockId);
		return {
			// The possessed character is the subject, so its own facing is up and the boom is not
			// consulted; the boom's bearing still reaches the panel separately, to draw where the
			// operator is looking relative to the character.
			headingRadians: mapHeadingFromSceneTransform(placement.localTransform),
			residency: {
				envCellId: placement.envCellId,
				landblockId: placement.landblockId,
			},
			worldX: origin.x + placement.localTransform.m41,
			worldY: origin.y + placement.localTransform.m42,
			worldZ: origin.z + placement.localTransform.m43,
		};
	}

	/** Anchor on the free camera, which is what the Explorer has whenever nothing is possessed. */
	function anchorFromCamera(): MapAnchor | null {
		if (cameraLocation === null) return null;
		return {
			headingRadians: cameraYawRadians,
			residency:
				cameraLocation.residency.kind === "resolved"
					? cameraLocation.residency.residency
					: null,
			worldX: cameraLocation.position.x,
			worldY: cameraLocation.position.y,
			worldZ: cameraLocation.position.z,
		};
	}

	/** Pull the scene's current map picture without publishing presentation-rate Svelte state. */
	function readMapPanelFrame(): MapPanelFrame {
		const runtime = runtimeReady ? (gameRuntime ?? null) : null;
		const controlledGuid = explorerPossession?.guid ?? null;
		const controlledAnchor = anchorFromPossession();
		const freeCameraAnchor = anchorFromCamera();
		return {
			cameraFovRadians: (EXPLORER_TUNING.camera.framing.fov * Math.PI) / 180,
			cameraHeadingRadians: cameraYawRadians,
			presentedEntities: readPresentedMapEntities,
			source: runtime,
			subject:
				controlledGuid !== null && controlledAnchor !== null
					? {
							anchor: controlledAnchor,
							guid: controlledGuid,
							kind: "controlled-entity",
						}
					: freeCameraAnchor === null
						? null
						: { anchor: freeCameraAnchor, kind: "free-camera" },
		};
	}

	function readPresentedMapEntities() {
		return gameRuntime?.listPresentedSpawnedEntities() ?? [];
	}

	function readFrameRates(): FrameRates | null {
		return frameRateSampler.readFrameRates();
	}

	function readFrameMetrics(): FrameMetrics | null {
		return frameMetrics;
	}

	function readPhysicalCameraStatus(): PhysicalFlyStatus | null {
		return physicalCameraStatus;
	}
	let activeRegion = $state<ActiveRegionSource | undefined>(undefined);
	/** Fast enough that a tick boundary is never visibly late; resolution is tick-quantized. */
	const CLOCK_SAMPLE_INTERVAL_MS = 250;

	let textureFilteringCapabilities =
		$state<TextureFilteringCapabilities | null>(null);
	let environmentSelection = $state<ExplorerEnvironmentSelection>({
		dayIndex: EXPLORER_TUNING.environment.defaultDayIndex,
		timeOfDay: EXPLORER_TUNING.environment.defaultTimeOfDay,
		dayGroupOverride: EXPLORER_TUNING.environment.defaultDayGroupOverride,
	});
	/** Explorer-local dynamic display choices; they do not alter resolved regional data. */
	let frameSettings = $state<FrameSettings>({
		...EXPLORER_TUNING.frameSettings,
	});
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
	/** Follow mode: update scene interest when the camera reaches a new outdoor residency. */
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
	 * The coordinator holds the target snapshot and decides whether the camera's residency is a
	 * crossing worth following, so this only mirrors a move it already made.
	 */
	function followCameraSceneInterest(
		resolution: ExplorerResidencyResolution,
	): void {
		const coordinator = cameraCoordinator;
		const requestCoordinator = sceneInterestCoordinator;
		const pending = coordinator?.prepareFollowCameraResidency(resolution);
		if (!coordinator || !requestCoordinator || !pending) return;
		const request = requestCoordinator.request(pending.target, pending.radii);
		void request.promise
			.then((resolved) => {
				if (!requestCoordinator.isCurrent(request.revision)) {
					coordinator.rejectFollowCameraResidency(pending);
					return;
				}
				if (!coordinator.applyFollowCameraResidency(pending, resolved)) return;
				void requestSimulationInterest(
					pending.residency.landblockId,
					"follow",
				).catch((error: unknown) => {
					physicalCameraError = errorMessage(error);
				});
			})
			.catch((error: unknown) => {
				coordinator.rejectFollowCameraResidency(pending);
				if (requestCoordinator.isCurrent(request.revision))
					physicalCameraError = errorMessage(error);
			});
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

	function updateShowRetailHiddenGeometry(visible: boolean): void {
		frameSettings = { ...frameSettings, showRetailHiddenGeometry: visible };
		applyFrameSettings();
	}

	function updateNameplateCategory(
		category: NameplateCategory,
		visible: boolean,
	): void {
		frameSettings = {
			...frameSettings,
			nameplates: {
				...frameSettings.nameplates,
				categoryVisibility: {
					...frameSettings.nameplates.categoryVisibility,
					[category]: visible,
				},
			},
		};
		applyFrameSettings();
	}

	function updateAmbientOcclusionSettings(
		ambientOcclusion: AmbientOcclusionSettings,
	): void {
		frameSettings = { ...frameSettings, ambientOcclusion };
		applyFrameSettings();
	}

	function updateEntityShadowSettings(
		entityShadows: EntityShadowSettings,
	): void {
		frameSettings = {
			...frameSettings,
			entityShadows: createEntityShadowSettings(entityShadows),
		};
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
	}

	function readRendererFrameDiagnostics(): RendererFrameDiagnosticsSnapshot | null {
		return gameRuntime?.getRendererFrameDiagnostics() ?? null;
	}

	function readAuthoredDynamicRuntimeDiagnostics(): ReturnType<
		GamePresentationRuntime["getAuthoredDynamicRuntimeDiagnostics"]
	> | null {
		return gameRuntime?.getAuthoredDynamicRuntimeDiagnostics() ?? null;
	}

	function captureFrameDiagnosticReport(): ExplorerFrameDiagnosticReport | null {
		const device = presentationOwner?.device;
		if (!gameRuntime || !device || !canvasElement) return null;
		const frame = gameRuntime.getRendererFrameDiagnostics();
		if (!frame) return null;
		const viewport = canvasElement.getBoundingClientRect();
		return createExplorerFrameDiagnosticReport({
			applicationFrame: frameMetrics,
			browser: {
				userAgent: navigator.userAgent,
				webgl: device.getDiagnosticIdentity(),
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
		target: SceneInterestTarget,
		radii: SceneInterestRadii,
	): void {
		const requestCoordinator = sceneInterestCoordinator;
		if (!requestCoordinator) {
			physicalCameraError = "Scene-interest resolution is not initialized.";
			return;
		}
		// Reserve the revision before releasing camera authority so a newer target supersedes this
		// request while the handoff is in flight; the resolved target is not applied until release.
		const request = requestCoordinator.request(target, radii);
		void (async () => {
			try {
				if (
					explorerPossession !== null ||
					possessionInput !== undefined ||
					boomCameraSession !== undefined
				)
					cameraFocusStatus =
						"Releasing possession before scene-interest change.";
				await releaseCameraAuthorityForSceneChange();
			} catch (error: unknown) {
				if (!requestCoordinator.isCurrent(request.revision)) return;
				cameraFocusStatus = `Scene-interest change failed: Could not release camera authority: ${errorMessage(error)}`;
				return;
			}

			try {
				const resolved = await request.promise;
				if (!requestCoordinator.isCurrent(request.revision)) return;
				void requestSimulationInterest(
					resolved.target.requested.landblockId,
					"replace",
				).catch((error: unknown) => {
					physicalCameraError = errorMessage(error);
				});
				cameraController?.setInputEnabled(false);
				if (cameraCoordinator !== undefined) {
					await cameraCoordinator.requestSceneInterest(
						resolved,
						request.revision,
					);
				}
			} catch (error: unknown) {
				if (!requestCoordinator.isCurrent(request.revision)) return;
				cameraFocusStatus = `Scene target unavailable: ${errorMessage(error)}`;
			}
		})();
	}

	async function requestSimulationInterest(
		anchorLandblockId: LandblockOwnerId,
		mode: "ensure" | "follow" | "replace",
	): Promise<SimulationInterestReceipt> {
		const controller = simulationInterestController;
		if (!controller) {
			throw new Error("Simulation-interest policy is not initialized.");
		}
		const receipt = await controller[mode](anchorLandblockId);
		// A newer application anchor superseding this request is ordinary asynchronous currentness.
		if (!receipt.committed) return receipt;
		if (
			receipt.unavailableLandblockIds.some(
				(owner) => owner.toLowerCase() === anchorLandblockId.toLowerCase(),
			)
		) {
			throw new Error(
				`Collision content is unavailable for ${anchorLandblockId}.`,
			);
		}
		return receipt;
	}

	/** Await collision authority for a mutation that is about to enter the host. */
	async function awaitCurrentSimulationInterest(
		anchorLandblockId: LandblockOwnerId,
	): Promise<SimulationInterestReceipt> {
		const receipt = await requestSimulationInterest(
			anchorLandblockId,
			"ensure",
		);
		if (!receipt.committed) {
			throw new Error(
				`Collision interest for ${anchorLandblockId} was superseded before the operation could start.`,
			);
		}
		const controller = simulationInterestController;
		if (
			controller === undefined ||
			!controller.isCurrent(anchorLandblockId, receipt.revision)
		) {
			throw new Error(
				`Collision interest for ${anchorLandblockId} changed before the operation could start.`,
			);
		}
		return receipt;
	}

	/** A handoff is valid only when the exact presented pose and residency survived the await. */
	function requireStablePresentedPlacement(
		before: HostCameraPlacement,
		after: HostCameraPlacement | null,
		interest: SimulationInterestReceipt,
	): HostCameraPlacement {
		const controller = simulationInterestController;
		if (after === null) {
			throw new Error(
				"Camera placement disappeared while collision interest loaded.",
			);
		}
		if (
			controller === undefined ||
			!controller.isCurrent(before.residency.landblockId, interest.revision)
		) {
			throw new Error(
				"Camera placement changed while collision interest loaded.",
			);
		}
		if (
			after.residency.landblockId !== before.residency.landblockId ||
			after.residency.envCellId !== before.residency.envCellId ||
			after.position.x !== before.position.x ||
			after.position.y !== before.position.y ||
			after.position.z !== before.position.z
		) {
			throw new Error(
				"Camera placement changed while collision interest loaded.",
			);
		}
		return after;
	}

	type CameraOwnershipToken = {
		readonly input: CharacterInputController | undefined;
		readonly possessionGeneration: number | null;
	};

	function cameraOwnershipToken(): CameraOwnershipToken {
		return {
			input: possessionInput,
			possessionGeneration: explorerPossession?.possessionGeneration ?? null,
		};
	}

	function requireStableCameraOwnership(token: CameraOwnershipToken): void {
		if (
			possessionInput !== token.input ||
			(explorerPossession?.possessionGeneration ?? null) !==
				token.possessionGeneration
		) {
			throw new Error(
				"Camera ownership changed while collision interest loaded.",
			);
		}
	}

	function followPhysicalSimulationInterest(
		anchorLandblockId: LandblockOwnerId,
	): void {
		if (physicalSimulationAnchor === anchorLandblockId) return;
		physicalSimulationAnchor = anchorLandblockId;
		void requestSimulationInterest(anchorLandblockId, "follow").catch(
			(error: unknown) => {
				if (physicalSimulationAnchor === anchorLandblockId) {
					physicalSimulationAnchor = null;
				}
				physicalCameraError = errorMessage(error);
			},
		);
	}

	function physicalCameraInput(controller: ExplorerCameraInputController): {
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
			EXPLORER_TUNING.camera.controls.moveSpeed *
				(precision ? EXPLORER_TUNING.camera.controls.shiftSlowMultiplier : 1),
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

	function routeCameraWheel(localUpDistance: number): void {
		if (boomCameraSession) {
			boomCameraSession.zoom(
				-localUpDistance * EXPLORER_TUNING.camera.boom.zoomDistanceMultiplier,
			);
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
		const ownership = cameraOwnershipToken();
		cameraModePending = true;
		physicalCameraError = null;
		controller.setControlScheme(
			possessionInput === undefined
				? controlSchemeForCameraMode("physical-fly")
				: { kind: "possessed-character" },
		);
		const session = new PhysicalFlySession(
			hostPhysicalFlyTransport(hostTransport),
		);
		try {
			const interest = await awaitCurrentSimulationInterest(
				placement.residency.landblockId,
			);
			const stablePlacement = requireStablePresentedPlacement(
				placement,
				cameraCoordinator?.presentedPlacement() ?? null,
				interest,
			);
			requireStableCameraOwnership(ownership);
			await session.start(stablePlacement);
			if (
				cameraController !== controller ||
				!runtimeReady ||
				possessionInput !== ownership.input ||
				(explorerPossession?.possessionGeneration ?? null) !==
					ownership.possessionGeneration
			) {
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
		const device = presentationOwner?.device;
		if (!gameRuntime || !device) {
			throw new Error(
				"Texture page readback requires an active Explorer runtime.",
			);
		}
		return device.readTexture2D(
			gameRuntime.getTextureAtlasPageResource(pageId),
		);
	}

	/** Publish a cold panel snapshot and retire possession if its exact generation disappeared. */
	function publishExplorerEntityPanelSnapshot(): readonly DynamicEntityView[] {
		const session = dynamicEntitySession;
		if (session === undefined) return [];
		const entities = session.mirror.entities();
		spawnedEntities = entities;
		const held = explorerPossession;
		if (
			held !== null &&
			held.guid !== null &&
			!entities.some(
				(entity) =>
					entity.identity.guid === held.guid &&
					entity.generation === held.entityGeneration,
			)
		) {
			retireFrontendPossession();
		}
		return entities;
	}

	/** Project lifecycle state from the one authoritative mirror into Svelte and presentation. */
	function replaceSpawnedEntitySnapshot(): Promise<void> {
		const session = dynamicEntitySession;
		if (session === undefined) return Promise.resolve();
		const entities = publishExplorerEntityPanelSnapshot();
		const runtime = gameRuntime;
		if (runtime === undefined) return Promise.resolve();
		return trackDynamicEntityPresentation(
			runtime.replaceDynamicEntitySnapshot(entities),
			entities,
		);
	}

	/** Retain one presentation completion as the current Explorer convergence boundary. */
	function trackDynamicEntityPresentation(
		operation: Promise<unknown>,
		entities: readonly DynamicEntityView[],
	): Promise<void> {
		const revision = ++dynamicEntityPresentationRevision;
		spawnedEntityPresentationError = null;
		const completion = operation.then(() => undefined);
		dynamicEntityPresentationCompletion = completion;
		if (cameraCoordinator?.activationReady()) {
			const convergence = { completion, ready: false };
			sceneActivationPresentationConvergence = convergence;
			void completion.then(() => {
				if (sceneActivationPresentationConvergence === convergence)
					convergence.ready = true;
			});
		}
		void completion.catch((error: unknown) => {
			if (revision !== dynamicEntityPresentationRevision) return;
			const wcids = entities.map(({ identity }) => identity.wcid).join(", ");
			spawnedEntityPresentationError = `Presentation realization for WCID ${wcids || "<none>"}: ${errorMessage(error)}`;
			console.error(spawnedEntityPresentationError, error);
		});
		return completion;
	}

	/** Route high-frequency accepted paths without restarting visual resource realization. */
	function acceptDynamicEntityEvent(event: DynamicEntityEvent): void {
		if (dynamicEntitySession === undefined) return;
		if (refreshesExplorerEntityPanel(event))
			publishExplorerEntityPanelSnapshot();
		const runtime = gameRuntime;
		if (runtime === undefined) return;
		try {
			switch (event.kind) {
				case "ticked":
					runtime.applyDynamicEntityTick(event.batch, performance.now());
					spawnedEntityPresentationError = null;
					return;
				case "snapshot":
					void trackDynamicEntityPresentation(
						runtime.replaceDynamicEntitySnapshot(spawnedEntities),
						spawnedEntities,
					);
					return;
				case "upserted":
					void trackDynamicEntityPresentation(
						runtime.upsertDynamicEntity(event.entity),
						[event.entity],
					);
					return;
				case "removed":
					runtime.removeDynamicEntity(event.guid, event.generation);
					spawnedEntityPresentationError = null;
					return;
			}
		} catch (error) {
			spawnedEntityPresentationError = `Dynamic-entity presentation: ${errorMessage(error)}`;
		}
	}

	/** Apply one host epoch to entity and camera playback from the exact same receipt instant. */
	function acceptFixedTick({
		envelope,
		receivedAtMs,
	}: ExplorerFixedTickReceipt): void {
		const entityEvent = envelope.entityEvent;
		if (entityEvent !== null) {
			if (refreshesExplorerEntityPanel(entityEvent))
				publishExplorerEntityPanelSnapshot();
			try {
				gameRuntime?.applyDynamicEntityTick(entityEvent.batch, receivedAtMs);
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
		wcid: number,
		distance: number,
	): Promise<void> {
		const session = dynamicEntitySession;
		const coordinator = cameraCoordinator;
		const controller = cameraController;
		if (!session || !coordinator || !controller)
			throw new Error("Explorer entity spawning requires an active runtime.");
		const initialPlacement = coordinator.presentedPlacement();
		if (initialPlacement === null)
			throw new Error("Spawn requires a currently presented camera placement.");
		const ownership = cameraOwnershipToken();
		const interest = await awaitCurrentSimulationInterest(
			initialPlacement.residency.landblockId,
		);
		const placement = requireStablePresentedPlacement(
			initialPlacement,
			coordinator.presentedPlacement(),
			interest,
		);
		requireStableCameraOwnership(ownership);
		const request = createExplorerSpawnRequest(
			wcid,
			placement,
			physicalCameraInput(controller).viewDirection,
			distance,
			"integrated",
		);
		await session.spawn(request);
		await dynamicEntityPresentationCompletion;
	}

	async function searchExplorerWeenies(
		request: ExplorerWeenieSearchRequest,
	): Promise<readonly ExplorerWeenieSearchResult[]> {
		const session = dynamicEntitySession;
		if (!session)
			throw new Error("Explorer weenie search requires an active runtime.");
		return session.searchWeenies(request);
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
	/// Shared possession camera owning desired orbit, zoom, projection gating, and host playback.
	let boomCameraSession: PossessionCameraController | undefined;
	/** Coalesces concurrent scene changes while one host camera authority release is in flight. */
	let cameraAuthorityReleaseForSceneChange: Promise<void> | undefined;
	/** Latest viewport/FOV projection authored before camera synchronization. */
	let cameraProjection: ProjectionClearanceRevision | undefined;

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
		const controller = cameraController;
		if (controller === undefined) {
			throw new Error(
				"Host boom registration requires an active camera controller.",
			);
		}
		const state = controller.snapshotState();
		const controls = EXPLORER_TUNING.camera.controls;
		const boom = new PossessionCameraController({
			initialLook: state,
			orbit: {
				maximumPitchRadians: controls.maximumPitchRadians,
				pitchRadiansPerPixel: controls.pointerPitchRadiansPerPixel,
				yawRadiansPerPixel: controls.pointerYawRadiansPerPixel,
			},
			recenter: {
				delayMs: EXPLORER_TUNING.camera.boom.recenterDelayMs,
				durationMs: EXPLORER_TUNING.camera.boom.recenterDurationMs,
			},
			transport: hostKinematicBoomTransport(hostTransport),
		});
		boomCameraSession = boom;
		const runtime = gameRuntime;
		const canvas = canvasElement;
		if (runtime === undefined || canvas === null) {
			throw new Error("Host boom registration requires an active viewport.");
		}
		const initialPlacement = cameraCoordinator?.presentedPlacement() ?? null;
		if (initialPlacement === null) {
			throw new Error(
				"Host boom registration requires a presented camera placement.",
			);
		}
		const ownership = cameraOwnershipToken();
		const interest = await awaitCurrentSimulationInterest(
			initialPlacement.residency.landblockId,
		);
		requireStablePresentedPlacement(
			initialPlacement,
			cameraCoordinator?.presentedPlacement() ?? null,
			interest,
		);
		requireStableCameraOwnership(ownership);
		const projection = resolveCameraProjection(runtime, canvas);
		await boom.start(
			{
				possessionGeneration: possession.possessionGeneration,
				guid: possession.guid,
				entityGeneration: possession.entityGeneration,
			},
			EXPLORER_TUNING.camera.boom.distance,
			projection,
		);
	}

	async function endBoomCamera(): Promise<void> {
		// Free fly resumes from wherever the boom left the camera, because `applyPresentedPosition`
		// has been writing that position every frame; only translation authority returns here.
		const boom = boomCameraSession;
		boomCameraSession = undefined;
		const controller = cameraController;
		if (boom !== undefined && controller !== undefined) {
			const state = controller.snapshotState();
			controller.adoptPresentedPose({
				...boom.desiredLook(),
				position: state.position,
			});
		}
		restoreCameraControlScheme();
		await boom?.stop();
	}

	/** Pull-only diagnostic read; callers choose an explicit low-frequency sampling policy. */
	function readBoomCameraStatus(): HostKinematicBoomStatus | null {
		return boomCameraSession?.status() ?? null;
	}

	/** Pull one exact current generation for disclosure-scoped volatile diagnostics. */
	function readExplorerEntity(
		selection: ExplorerEntitySelection,
	): DynamicEntityView | null {
		const session = dynamicEntitySession;
		return session === undefined
			? null
			: findSelectedExplorerEntity(session.mirror.entities(), selection);
	}

	/** Pull the host-applied possession sample only when the Inspector is sampling diagnostics. */
	async function readPossessionMotionProbe(): Promise<PossessionMotionProbe | null> {
		return (await dynamicEntitySession?.possessionMotionProbe()) ?? null;
	}

	/// Route one frame to whichever camera currently owns position.
	///
	/// Three owners in priority order, and the order matters: a boom outranks a physical session
	/// because possession is the more specific state. A possessed entity that is momentarily
	/// unpresented — an ordinary condition while presentation realizes — falls through to free
	/// fly, which holds still rather than drifting, since the boom has been writing its position
	/// into the controller every frame and possession has taken the drive keys away.
	function syncActiveCamera(
		physicalPlacement: HostCameraPlacement | null,
		nowMs: number,
		projection: ProjectionClearanceRevision,
	): ExplorerCameraResidencySync | undefined {
		if (boomCameraSession) return syncBoomCamera(nowMs, projection);
		if (physicalCameraSession || cameraModePending)
			return cameraCoordinator?.syncPhysicalCamera(
				physicalPlacement,
				projection,
			);
		return cameraCoordinator?.syncFreeFlyCamera(projection);
	}

	/// Sample the host boom and hand its atomic position, pivot, and residency to the coordinator.
	///
	/// The look controller retains the operator's desired yaw/pitch for subsequent host intent. The
	/// rendered orientation instead follows the same host path as position, preventing desired input
	/// from visually outrunning collision-safe boom motion.
	function syncBoomCamera(
		nowMs: number,
		projection: ProjectionClearanceRevision,
	) {
		const boom = boomCameraSession;
		const controller = cameraController;
		const coordinator = cameraCoordinator;
		if (!boom || !controller || !coordinator) return undefined;
		void boom
			.synchronize(projection, nowMs, possessedEntityFacingCameraYaw())
			.catch((error: unknown) => {
				if (boomCameraSession === boom)
					physicalCameraError = errorMessage(error);
			});
		const desiredOrientation = boom.desiredLook();
		const presentation = boom.presentation(nowMs);
		const acknowledgedProjection = boom.acknowledgedProjection(nowMs);
		if (acknowledgedProjection === null) {
			return { location: null, renderable: false };
		}
		if (presentation === null) {
			const placement = coordinator.presentedPlacement();
			if (placement === null) return undefined;
			cameraYawRadians = desiredOrientation.yawRadians;
			return coordinator.syncBoomCamera(
				placement,
				desiredOrientation.yawRadians,
				desiredOrientation.pitchRadians,
				acknowledgedProjection,
			);
		}
		const { placement, visualPivot } = presentation;
		// A reseed instant carries no look direction. The operator's desired orbit is what the boom
		// is about to spring back out along, which is what the unpresented branch above uses too.
		const orientation =
			resolveCameraLookAtAngles(placement.position, visualPivot) ??
			desiredOrientation;
		controller.applyPresentedPosition(placement.position);
		// Published where it is decided: the boom owns orientation while it is running, and the
		// free-fly controller only receives position, so reading yaw from that controller here
		// would hand the map a bearing from before possession began.
		cameraYawRadians = orientation.yawRadians;
		return coordinator.syncBoomCamera(
			placement,
			orientation.yawRadians,
			orientation.pitchRadians,
			acknowledgedProjection,
		);
	}

	function resolveCameraProjection(
		runtime: GamePresentationRuntime,
		canvas: HTMLCanvasElement,
	): ProjectionClearanceRevision {
		const extent = runtime.resolveViewportExtent(
			canvas.clientWidth,
			canvas.clientHeight,
		);
		const framing = EXPLORER_TUNING.camera.framing;
		const current = cameraProjection;
		if (
			current !== undefined &&
			current.fov === framing.fov &&
			current.near === framing.near &&
			current.extent.width === extent.width &&
			current.extent.height === extent.height
		) {
			return current;
		}
		const revision = (current === undefined ? 0 : current.revision) + 1;
		if (!Number.isSafeInteger(revision)) {
			throw new Error("Explorer camera projection revision exhausted.");
		}
		cameraProjection = createProjectionClearanceRevision(
			revision,
			framing,
			extent,
		);
		return cameraProjection;
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
		const controls = possessedControls;
		if (controls === null) return;
		possessionIntentRevision += 1;
		void session
			.setPossessionIntent({
				drive: input.drive(),
				possessionGeneration: held.possessionGeneration,
				revision: possessionIntentRevision,
				runRateScalar: controls.runRateScalar,
				stance: controls.stance,
			})
			.catch((error: unknown) => {
				spawnedEntityPresentationError = errorMessage(error);
			});
	}

	function setPossessionTranslationIntent(drive: CharacterDrive): void {
		boomCameraSession?.setTranslationIntent(
			drive.longitudinal !== null || drive.lateral !== null,
			performance.now(),
		);
		sendPossessedIntent();
	}

	function possessedEntityFacingCameraYaw(): number {
		const held = explorerPossession;
		const session = dynamicEntitySession;
		if (
			held === null ||
			held.guid === null ||
			held.entityGeneration === null ||
			session === undefined
		) {
			throw new Error("Possession camera requires an active possessed entity.");
		}
		const entity = session.mirror.entity(held.guid, held.entityGeneration);
		if (entity === null || entity.placement.kind !== "world") {
			throw new Error(
				"Possession camera requires the possessed entity's current world pose.",
			);
		}
		return createEntityFacingCameraYaw(entity.placement.pose.rotation);
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
		const controls = possessedControls;
		if (controls === null) return;
		possessionIntentRevision += 1;
		const drive = edge.kind === "reset" ? input.drive() : edge.drive;
		void session
			.queuePossessionEvent({
				...edge,
				drive,
				possessionGeneration: held.possessionGeneration,
				revision: possessionIntentRevision,
				runRateScalar: controls.runRateScalar,
				stance: controls.stance,
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
		possessedControls = null;
		possessionIntentRevision = 0;
		void endBoomCamera().catch((error: unknown) => {
			physicalCameraError = errorMessage(error);
		});
	}

	/** Return camera authority to the frontend before a target focus can replace the scene. */
	async function releaseCameraAuthorityForSceneChange(): Promise<void> {
		const pendingRelease = cameraAuthorityReleaseForSceneChange;
		if (pendingRelease !== undefined) {
			await pendingRelease;
			return;
		}
		if (
			physicalCameraSession === undefined &&
			explorerPossession === null &&
			possessionInput === undefined &&
			boomCameraSession === undefined
		)
			return;

		const release = (async () => {
			// Physical fly and possession can briefly overlap while an authority handoff is pending;
			// stop the host camera before releasing the character so neither can overwrite the focus pose.
			if (physicalCameraSession !== undefined) await leavePhysicalCamera(false);
			if (
				explorerPossession !== null ||
				possessionInput !== undefined ||
				boomCameraSession !== undefined
			)
				await possessExplorerEntity(null);
		})();
		cameraAuthorityReleaseForSceneChange = release;
		try {
			await release;
		} finally {
			if (cameraAuthorityReleaseForSceneChange === release)
				cameraAuthorityReleaseForSceneChange = undefined;
		}
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
			possessedControls = null;
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
		if (possession.runRateCapability === null)
			throw new Error("Host omitted the possession run-rate capability.");
		possessedControls = {
			stance: possession.acceptedStance,
			runRateScalar: possession.runRateCapability.initial,
		};
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
			onDrive: setPossessionTranslationIntent,
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
		const controls = possessedControls;
		if (!session || held === null || held.guid === null || controls === null)
			return;
		const name = (Object.keys(MOTION_STYLE) as MotionStyleName[]).find(
			(candidate) => MOTION_STYLE[candidate] === style,
		);
		if (name === undefined)
			throw new Error(`Unknown possession stance 0x${style.toString(16)}.`);
		possessionIntentRevision += 1;
		const revision = possessionIntentRevision;
		const nextControls = { ...controls, stance: style };
		possessedControls = nextControls;
		try {
			const result = await session.setPossessionIntent({
				drive: possessionInput?.drive() ?? IDLE_DRIVE,
				possessionGeneration: held.possessionGeneration,
				revision,
				runRateScalar: nextControls.runRateScalar,
				stance: nextControls.stance,
			});
			if (result === "accepted") {
				const capability = possessionStance(held, style);
				if (capability === null)
					throw new Error(
						"Host accepted a stance absent from its capability receipt.",
					);
				possessionInput?.setFullChargeDurationMs(capability.chargeDurationMs);
			}
		} catch (error) {
			if (
				possessionIntentRevision === revision &&
				explorerPossession?.possessionGeneration === held.possessionGeneration
			)
				possessedControls = controls;
			throw error;
		}
	}

	async function setExplorerEntityRunRate(value: number): Promise<void> {
		const session = dynamicEntitySession;
		const held = explorerPossession;
		const controls = possessedControls;
		if (!session || held === null || held.guid === null || controls === null)
			return;
		const capability = held.runRateCapability;
		if (capability === null)
			throw new Error("Host omitted the possession run-rate capability.");
		if (
			!Number.isFinite(value) ||
			value < capability.minimum ||
			value > capability.maximum
		)
			throw new Error("Run rate is outside the host-reported range.");
		possessionIntentRevision += 1;
		const revision = possessionIntentRevision;
		const nextControls = { ...controls, runRateScalar: value };
		possessedControls = nextControls;
		try {
			await session.setPossessionIntent({
				drive: possessionInput?.drive() ?? IDLE_DRIVE,
				possessionGeneration: held.possessionGeneration,
				revision,
				runRateScalar: nextControls.runRateScalar,
				stance: nextControls.stance,
			});
		} catch (error) {
			if (
				possessionIntentRevision === revision &&
				explorerPossession?.possessionGeneration === held.possessionGeneration
			)
				possessedControls = controls;
			throw error;
		}
	}

	async function despawnExplorerEntity(
		entity: DynamicEntityView,
	): Promise<void> {
		const session = dynamicEntitySession;
		if (!session)
			throw new Error("Explorer entity despawn requires an active runtime.");
		await session.despawn(entity.identity.guid, entity.generation);
		await dynamicEntityPresentationCompletion;
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
			const presentation = presentationOwner;
			const requestCoordinator = sceneInterestCoordinator;
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
			publishCameraLocation(null);
			presentationOwner = undefined;
			textureFilteringCapabilities = null;
			sceneInterestCoordinator = undefined;
			activeRegion = undefined;
			cameraCoordinator = undefined;
			cameraController = undefined;
			cameraProjection = undefined;
			physicalCameraSession = undefined;
			boomCameraSession = undefined;
			dynamicEntitySession = undefined;
			unsubscribeDynamicEntities = undefined;
			unsubscribeFixedTicks = undefined;
			unsubscribePossessionOutcomes = undefined;
			dynamicEntityPresentationRevision += 1;
			dynamicEntityPresentationCompletion = Promise.resolve();
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
				requestCoordinator?.invalidate();
				controller?.dispose();
				try {
					await boomSession?.stop();
				} finally {
					try {
						await physicalSession?.stop();
					} finally {
						await presentation?.destroy();
					}
				}
			})();
			return teardown;
		};

		const start = async (): Promise<void> => {
			try {
				const entitySession = new ExplorerDynamicEntitySession(
					hostExplorerDynamicEntityTransport(hostTransport),
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
				const presentation = await GamePresentationOwner.build({
					canvas,
					hostTransport,
					frameSettings: EXPLORER_TUNING.frameSettings,
					portalWarpDriveTuning: EXPLORER_TUNING.portalTransition.visual,
					audioTuning: {
						placementSmoothingSeconds:
							EXPLORER_TUNING.audio.placementSmoothingSeconds,
						loudnessCurveExponent: EXPLORER_TUNING.audio.loudnessCurveExponent,
					},
					// The Explorer is a development surface and its Frame panel reports tick
					// timing; the thin client route passes nothing and pays nothing.
					tickProfiler: new RuntimeTickProfiler(),
				});
				presentationOwner = presentation;
				activeRegion = presentation.activeRegion;
				gameRuntime = presentation.runtime;
				textureFilteringCapabilities =
					presentation.textureFilteringCapabilities;
				if (destroyed) return;
				sceneInterestCoordinator = new SceneInterestRequestCoordinator(
					presentation.profileSource,
				);
				void replaceSpawnedEntitySnapshot();
				applyEnvironment();
				applyFrameSettings();
				if (destroyed) return;
				cameraController = new ExplorerCameraInputController({
					canvas,
					keyboardYawRadiansPerSecond(shiftActive) {
						const controls = EXPLORER_TUNING.camera.controls;
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
					onPhysicalWheel: routeCameraWheel,
					onPossessionOrbit(deltaX, deltaY) {
						boomCameraSession?.orbit(deltaX, deltaY, performance.now());
					},
					onPossessionWheel: routeCameraWheel,
				});
				cameraCoordinator = new ExplorerCameraCoordinator(
					gameRuntime,
					cameraController,
					(status) => (cameraFocusStatus = status),
				);
				simulationInterestController = new SimulationInterestController(
					hostSimulationInterestTransport(hostTransport),
				);
				runtimeReady = true;

				const step = (animationFrameTimeMs: number): void => {
					if (gameRuntime === undefined) {
						frameMetrics = null;
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
					cameraCoordinator?.pollSceneActivation();
					const staticActivationReady =
						cameraCoordinator?.activationReady() ?? false;
					const activationPending =
						cameraCoordinator?.activationPending() ?? false;
					if (!activationPending || !staticActivationReady) {
						sceneActivationPresentationConvergence = null;
					} else if (sceneActivationPresentationConvergence === null) {
						void replaceSpawnedEntitySnapshot();
					}
					cameraController?.setInputEnabled(!activationPending);
					const projection = resolveCameraProjection(gameRuntime, canvas);
					const residencySync = syncActiveCamera(
						physicalPlacement,
						tickStartedAt,
						projection,
					);
					if (!residencySync) {
						throw new Error(
							"Explorer camera coordinator is unavailable during rendering.",
						);
					}
					publishCameraLocation(residencySync.location);
					// Only the free-fly controller's yaw is authoritative here; while a boom runs it
					// publishes its own, because the controller is not the one turning.
					if (boomCameraSession === undefined) {
						cameraYawRadians =
							cameraController?.snapshotState().yawRadians ?? cameraYawRadians;
					}
					const possessedGuid = explorerPossession?.guid ?? null;
					possessedPlacement =
						possessedGuid === null
							? null
							: (gameRuntime.spawnedEntityPlacement(possessedGuid) ?? null);
					// The possessed character is what the viewer is driving, so it carries the
					// viewer light; with nothing possessed the camera carries it, as retail does.
					gameRuntime.setViewerEntity(possessedGuid);
					const followResidency = residencySync.location?.residency;
					if (interestFollowsCamera && followResidency) {
						followCameraSceneInterest(followResidency);
					}
					const updateAndDrawStartedAt = performance.now();
					const activationReady =
						staticActivationReady &&
						(sceneActivationPresentationConvergence?.ready ?? false);
					const activeCameraCoordinator = cameraCoordinator;
					if (activeCameraCoordinator === undefined) {
						throw new Error(
							"Explorer camera coordinator is unavailable during portal presentation.",
						);
					}
					const reveal = presentExplorerPortalFrame({
						activationReady,
						coordinator: activeCameraCoordinator,
						extent: gameRuntime.resolveViewportExtent(
							canvas.clientWidth,
							canvas.clientHeight,
						),
						nowMs: tickStartedAt,
						runtime: gameRuntime,
						worldRenderable:
							residencySync.renderable &&
							(!activationPending || activationReady),
					});
					if (reveal !== null) {
						activeCameraCoordinator.completeSceneActivation();
						sceneActivationPresentationConvergence = null;
						cameraController?.setInputEnabled(true);
					}
					const frameFinishedAt = performance.now();
					frameRateSampler.recordFrame({
						animationFrameTimeMs,
						startedAtMs: tickStartedAt,
						workMs: frameFinishedAt - tickStartedAt,
					});

					frameMetrics = {
						tickMs: updateAndDrawStartedAt - tickStartedAt,
						updateFrameMs: frameFinishedAt - updateAndDrawStartedAt,
						frameMs: frameFinishedAt - tickStartedAt,
					};
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

		<FrameMetricsOverlay
			readMetrics={readFrameMetrics}
			{readFrameRates}
			diagnosticsTuning={EXPLORER_TUNING.diagnostics}
		/>
		{#if startupError === null}
			<MapPanel
				readFrame={readMapPanelFrame}
				panel={mapPanel}
				editable={true}
				onStateChange={(next) => {
					mapPanel = next;
				}}
			/>
		{/if}
		<ExplorerTools
			{runtimeReady}
			{requestSceneInterest}
			{cameraFocusStatus}
			{cameraResidencyLabel}
			{cameraMode}
			{cameraModePending}
			{readPhysicalCameraStatus}
			{physicalCameraError}
			{updateCameraMode}
			{environmentSelection}
			dayGroupNames={activeRegion?.data.sky?.dayGroups.map(
				({ dayName }) => dayName,
			) ?? []}
			{updateEnvironment}
			distanceFogEnabled={frameSettings.distanceFogEnabled}
			showRetailHiddenGeometry={frameSettings.showRetailHiddenGeometry}
			{updateShowRetailHiddenGeometry}
			nameplates={frameSettings.nameplates}
			{updateNameplateCategory}
			ambientOcclusion={frameSettings.ambientOcclusion}
			entityShadows={frameSettings.entityShadows}
			{updateEntityShadowSettings}
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
			{readRendererFrameDiagnostics}
			{updateRendererFrameProfiling}
			{captureFrameDiagnosticReport}
			{readAuthoredDynamicRuntimeDiagnostics}
			{readStaticObjectRuntimeDiagnostics}
			{readTextureAtlasPage}
			{entityCatalog}
			{spawnedEntities}
			{spawnedEntityPresentationError}
			{spawnExplorerEntity}
			{searchExplorerWeenies}
			{despawnExplorerEntity}
			{possessExplorerEntity}
			{setExplorerEntityStance}
			{setExplorerEntityRunRate}
			{explorerPossession}
			explorerPossessionControls={possessedControls}
			{readExplorerEntity}
			{readBoomCameraStatus}
			{readPossessionMotionProbe}
		/>
	</div>
</div>
