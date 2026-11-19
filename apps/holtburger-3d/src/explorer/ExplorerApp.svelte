<script lang="ts">
	import { onMount, untrack } from "svelte";
	import {
		retainRendererFailure,
		retainStartupFailure,
	} from "../app/desktop/app-failure-report";
	import { observeEntitySelectionColors } from "../app/theme/entity-selection-theme";
	import FrameMetricsOverlay from "./panels/FrameMetricsOverlay.svelte";
	import Minimap from "../app/minimap/Minimap.svelte";
	import type { MinimapState } from "../app/minimap/frame";
	import { startPresentationFrameLoop } from "../app/performance/presentation-frame-loop";
	import type { ActiveRegionSource } from "../lib/assets/active-region-source";
	import type { SceneEnvironmentSelection } from "../lib/game/environment/scene-environment";
	import { MAP_DEFAULT_VIEW_DIAMETERS } from "../lib/game/map/map-appearance";
	import type { ExplorerCameraMode } from "../lib/game/motion/host-physical-fly-path";
	import type { FrameSettings } from "../lib/game/renderer/renderer";
	import {
		resolveTextureFilteringPolicy,
		supportedTextureFilteringPolicies,
		type TextureFilteringCapabilities,
	} from "../lib/game/renderer/webgl2/texture-filtering-policy";
	import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";
	import { GamePresentationOwner } from "../lib/game/runtime/game-presentation-owner";
	import type { GamePresentationRuntime } from "../lib/game/runtime/game-presentation-runtime";
	import { HostPresentationAssets } from "../lib/game/runtime/host-presentation-assets";
	import { createElectronHostTransport } from "../lib/host/electron-host-transport";
	import type { WeenieCatalogCapability } from "../lib/host/weenie-catalog-capability";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import { ExplorerCameraAuthorityController } from "./camera/camera-authority";
	import type { ExplorerCameraFocusStatus } from "./camera/camera-coordinator";
	import {
		EXPLORER_RENDER_SCALE_OPTIONS,
		ExplorerDisplayDiagnosticsController,
	} from "./world/display-diagnostics";
	import { ExplorerDynamicEntityController } from "./entities/dynamic-entity-controller";
	import type { ExplorerEntitySelection } from "./entities/entity-panel-state";
	import type {
		ExplorerPossession,
		ExplorerPossessionControls,
	} from "./entities/entity-possession";
	import { presentExplorerPortalFrame } from "./world/portal-presentation";
	import ExplorerTools from "./ExplorerTools.svelte";
	import type {
		ExplorerToolsCameraSurface,
		ExplorerToolsDiagnosticsSurface,
		ExplorerToolsEntitiesSurface,
		ExplorerToolsEnvironmentSurface,
		ExplorerToolsRenderingSurface,
	} from "./explorer-tools-surfaces";
	import { EXPLORER_TUNING } from "./explorer-tuning";

	let canvasElement: HTMLCanvasElement | null = $state(null);
	const { viewport: inputGate, keyboard } = useAppInputPolicy();
	/** Scene activation owns one blocker independently of modal/UI blockers. */
	let releaseSceneInput: (() => void) | null = null;
	function setSceneInputBlocked(blocked: boolean): void {
		if (blocked) {
			if (releaseSceneInput === null) releaseSceneInput = inputGate.block();
		} else {
			releaseSceneInput?.();
			releaseSceneInput = null;
		}
	}
	function errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	/** Borrowed imperative runtime; its lifecycle belongs to the shared presentation owner below. */
	let presentationOwner: GamePresentationOwner | undefined;
	let gameRuntime: GamePresentationRuntime | undefined;
	const hostTransport = createElectronHostTransport();

	let startupError: string | null = $state(null);
	let runtimeReady = $state(false);
	let activeRegion = $state<ActiveRegionSource | undefined>(undefined);
	let textureFilteringCapabilities =
		$state<TextureFilteringCapabilities | null>(null);

	let cameraFocusStatus = $state<ExplorerCameraFocusStatus>(
		"No camera focus requested.",
	);
	/**
	 * Camera residency as the World tab prints it.
	 *
	 * This is the one reactive projection of the camera location, and it is a string precisely so
	 * that frames which do not change the resolved cell fail Svelte's equality check and schedule
	 * nothing at all.
	 */
	let cameraResidencyLabel = $state<string | null>(null);
	let cameraMode = $state<ExplorerCameraMode>("free-fly");
	let cameraModePending = $state(false);
	let physicalCameraError = $state<string | null>(null);
	/** Follow mode: update scene interest when the camera reaches a new outdoor residency. */
	let interestFollowsCamera = $state(false);
	/** Mirrors the camera coordinator's default so the switch reflects reality on first paint. */
	let audioFollowsCamera = $state(true);

	let entityCatalog = $state<WeenieCatalogCapability | null>(null);
	/** Cold replace-only panel snapshot; raw keeps host DTOs cloneable across later IPC boundaries. */
	let spawnedEntities = $state.raw<readonly DynamicEntityView[]>([]);
	let spawnedEntityPresentationError = $state<string | null>(null);
	let explorerPossession = $state<ExplorerPossession | null>(null);
	let possessedControls = $state<ExplorerPossessionControls | null>(null);
	/** Selection is frontend-owned and survives switching inspector tabs. */
	let selectedExplorerEntity = $state<ExplorerEntitySelection | null>(null);

	let environmentSelection = $state<SceneEnvironmentSelection>({
		dayIndex: EXPLORER_TUNING.environment.defaultDayIndex,
		timeOfDay: EXPLORER_TUNING.environment.defaultTimeOfDay,
		dayGroupOverride: EXPLORER_TUNING.environment.defaultDayGroupOverride,
	});
	/**
	 * Follow the regional clock instead of the explicit time-of-day slider.
	 *
	 * Retail always runs the clock; the slider is this app's equivalent of the `/day`
	 * override, so the two are one path with a selector rather than two ways to reach the same
	 * resolution.
	 */
	let clockFollowing = $state(false);
	/** Mirror `AudioSystem`'s own defaults, which are full volume in every category. */
	let effectVolume = $state(1);
	let ambientVolume = $state(1);
	/** Explorer-local dynamic display choices; they do not alter resolved regional data. */
	let frameSettings = $state<FrameSettings>({
		...EXPLORER_TUNING.frameSettings,
	});

	/**
	 * Minimap geometry and view choices.
	 *
	 * The minimap is a controlled component: it owns no persistence policy, so the shell that mounts
	 * it owns where it sits and how far it sees. The Explorer keeps that here in memory.
	 */
	let minimap = $state<MinimapState>({
		left: 16,
		size: 220,
		top: 96,
		viewDiameters: {
			...MAP_DEFAULT_VIEW_DIAMETERS,
		},
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

	function selectExplorerEntity(
		selection: ExplorerEntitySelection | null,
	): void {
		selectedExplorerEntity = selection;
		gameRuntime?.setSelectedEntityGuid(selection?.guid ?? null);
	}

	function selectMinimapEntity(guid: number | null): void {
		const entity =
			guid === null
				? null
				: spawnedEntities.find((candidate) => candidate.identity.guid === guid);
		selectExplorerEntity(
			entity
				? { guid: entity.identity.guid, generation: entity.generation }
				: null,
		);
	}

	const cameraAuthority: ExplorerCameraAuthorityController =
		new ExplorerCameraAuthorityController({
			hostTransport,
			isRuntimeReady: () => runtimeReady,
			hasPossession: () => entityController.hasPossession(),
			hasPossessionInput: () => entityController.hasPossessionInput(),
			readPossessionOwnership: () => entityController.readPossessionOwnership(),
			readPossessedEntityFacingCameraYaw: () =>
				entityController.possessedEntityFacingCameraYaw(),
			onCharacterInput: (input) =>
				entityController.handleCameraCharacterInput(input),
			onReleasePossession: () => entityController.possessExplorerEntity(null),
			onCameraFocusStatusChange: (status) => {
				cameraFocusStatus = status;
			},
			onCameraResidencyLabelChange: (label) => {
				cameraResidencyLabel = label;
			},
			onCameraModeChange: (mode) => {
				cameraMode = mode;
			},
			onCameraModePendingChange: (pending) => {
				cameraModePending = pending;
			},
			onPhysicalCameraErrorChange: (error) => {
				physicalCameraError = error;
			},
			onSceneInputBlockedChange: setSceneInputBlocked,
		});

	const entityController: ExplorerDynamicEntityController =
		new ExplorerDynamicEntityController({
			hostTransport,
			isActivationReady: () => cameraAuthority.activationReady(),
			hasPresentedCameraPlacement: () =>
				cameraAuthority.presentedPlacement() !== null,
			resolveSpawnAuthority: () => cameraAuthority.resolveSpawnAuthority(),
			onBeginPossessionCamera: (possession) =>
				cameraAuthority.beginBoomCamera(possession),
			onEndPossessionCamera: () => cameraAuthority.endBoomCamera(),
			onSetPossessedControlScheme: () =>
				cameraAuthority.setPossessedControlScheme(),
			onRestoreNonPossessionControlScheme: () =>
				cameraAuthority.restoreNonPossessionControlScheme(),
			onBoomFrame: (boom, durationMs, receivedAtMs) =>
				cameraAuthority.receiveBoomFrame(boom, durationMs, receivedAtMs),
			onBoomTranslationIntent: (active, nowMs) =>
				cameraAuthority.setBoomTranslationIntent(active, nowMs),
			onPhysicalCameraError: (error) => {
				physicalCameraError = error;
			},
			onEntityCatalogChange: (catalog) => {
				entityCatalog = catalog;
			},
			onSpawnedEntitiesChange: (entities) => {
				spawnedEntities = entities;
			},
			onSpawnedEntityPresentationErrorChange: (error) => {
				spawnedEntityPresentationError = error;
			},
			onExplorerPossessionChange: (possession) => {
				explorerPossession = possession;
			},
			onPossessedControlsChange: (controls) => {
				possessedControls = controls;
			},
			readSelectedEntity: () => selectedExplorerEntity,
			onClearSelectedEntity: () => selectExplorerEntity(null),
		});

	const displayDiagnostics = new ExplorerDisplayDiagnosticsController({
		isRuntimeReady: () => runtimeReady,
		readCameraLocation: () => cameraAuthority.cameraLocation,
		readCameraYawRadians: () => cameraAuthority.cameraYawRadians,
		readCameraSnapshot: () => cameraAuthority.cameraSnapshotState(),
		readSceneInterest: () => cameraAuthority.sceneInterestSnapshot(),
		readPossessedGuid: () => entityController.readPossessedGuid(),
		readPossessedPlacement: () => entityController.possessedPlacement,
		readSelectedEntityGuid: () => selectedExplorerEntity?.guid ?? null,
		onFrameSettingsChange: (settings) => {
			frameSettings = settings;
		},
		onEnvironmentSelectionChange: (selection) => {
			environmentSelection = selection;
		},
		onClockFollowingChange: (enabled) => {
			clockFollowing = enabled;
		},
		onEffectVolumeChange: (volume) => {
			effectVolume = volume;
		},
		onAmbientVolumeChange: (volume) => {
			ambientVolume = volume;
		},
	});

	function observeSelectionTheme(element: HTMLElement) {
		return observeEntitySelectionColors(element, (colors) => {
			displayDiagnostics.updateEntitySelectionColors(colors);
		});
	}

	onMount(() => {
		const canvas = canvasElement;
		if (canvas === null) {
			startupError = "Explorer canvas was not mounted.";
			return;
		}

		let destroyed = false;
		let teardown: Promise<void> | undefined;
		const presentationAssets = new HostPresentationAssets(hostTransport);
		const construction = new AbortController();

		let stopFrameLoop: (() => void) | null = null;

		const destroySystems = (): Promise<void> => {
			if (teardown) return teardown;
			const presentation = presentationOwner;
			gameRuntime = undefined;
			runtimeReady = false;
			presentationOwner = undefined;
			textureFilteringCapabilities = null;
			activeRegion = undefined;
			displayDiagnostics.detach();
			entityController.detach();
			teardown = (async () => {
				stopFrameLoop?.();
				setSceneInputBlocked(false);
				try {
					await cameraAuthority.detach();
				} finally {
					try {
						await presentation?.destroy();
					} finally {
						await presentationAssets.destroy();
					}
				}
			})();
			return teardown;
		};

		const start = async (): Promise<void> => {
			try {
				await entityController.start();
				if (destroyed) return;
				const presentation = await GamePresentationOwner.build({
					onRendererFailure: retainRendererFailure,
					canvas,
					hostTransport,
					presentationResources: await presentationAssets.resources(),
					signal: construction.signal,
					frameSettings: untrack(() =>
						displayDiagnostics.readFrameSettingsSnapshot(),
					),
					portalWarpDriveTuning: EXPLORER_TUNING.portalTransition.visual,
					audioTuning: {
						placementSmoothingSeconds:
							EXPLORER_TUNING.audio.placementSmoothingSeconds,
						loudnessCurveExponent: EXPLORER_TUNING.audio.loudnessCurveExponent,
					},
				});
				presentationOwner = presentation;
				activeRegion = presentation.activeRegion;
				gameRuntime = presentation.runtime;
				textureFilteringCapabilities =
					presentation.textureFilteringCapabilities;
				if (destroyed) return;
				displayDiagnostics.attachRuntime({ presentation, canvas });
				cameraAuthority.attachRuntime({
					canvas,
					gameRuntime: presentation.runtime,
					profileSource: presentation.profileSource,
					inputGate,
					keyboard,
				});
				entityController.attachRuntime(presentation.runtime);
				runtimeReady = true;

				const step = (animationFrameTimeMs: number): void => {
					if (gameRuntime === undefined) {
						displayDiagnostics.clearFrameMetrics();
						return;
					}

					const tickStartedAt = performance.now();
					const physicalPlacement = cameraAuthority.pollPhysicalCamera();
					gameRuntime.tick(tickStartedAt);
					cameraAuthority.pollSceneActivation();
					const staticActivationReady = cameraAuthority.activationReady();
					const activationPending = cameraAuthority.activationPending();
					entityController.syncSceneActivationConvergence(
						activationPending,
						staticActivationReady,
					);
					setSceneInputBlocked(activationPending);
					const residencySync = cameraAuthority.syncFrameCamera(
						physicalPlacement,
						gameRuntime,
						canvas,
						tickStartedAt,
					);
					entityController.syncPossessedPlacement(gameRuntime);
					const updateAndDrawStartedAt = performance.now();
					const activationReady =
						staticActivationReady &&
						entityController.isActivationPresentationReady();
					const activeCameraCoordinator = cameraAuthority.cameraCoordinator;
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
						entityController.clearActivationConvergence();
						setSceneInputBlocked(false);
					}
					const frameFinishedAt = performance.now();
					displayDiagnostics.recordFrameSample(
						animationFrameTimeMs,
						tickStartedAt,
						updateAndDrawStartedAt,
						frameFinishedAt,
					);
				};

				stopFrameLoop = startPresentationFrameLoop(step, () => 0);
			} catch (error) {
				if (!destroyed) {
					retainStartupFailure(error);
					startupError = errorMessage(error);
				}
				await destroySystems();
			}
		};

		const startup = start();

		return () => {
			destroyed = true;
			construction.abort();
			displayDiagnostics.stopClockTimer();
			void startup
				.then(() => destroySystems())
				.catch((error: unknown) =>
					console.error("Failed to shut down explorer systems.", error),
				);
		};
	});

	const toolsCamera: ExplorerToolsCameraSurface = {
		get runtimeReady() {
			return runtimeReady;
		},
		requestSceneInterest(target, radii) {
			cameraAuthority.requestSceneInterest(target, radii);
		},
		get cameraFocusStatus() {
			return cameraFocusStatus;
		},
		get cameraResidencyLabel() {
			return cameraResidencyLabel;
		},
		get cameraMode() {
			return cameraMode;
		},
		get cameraModePending() {
			return cameraModePending;
		},
		readPhysicalCameraStatus() {
			return cameraAuthority.readPhysicalCameraStatus();
		},
		get physicalCameraError() {
			return physicalCameraError;
		},
		updateCameraMode(mode) {
			cameraAuthority.updateCameraMode(mode);
		},
		get interestFollowsCamera() {
			return interestFollowsCamera;
		},
		updateInterestFollowsCamera(enabled) {
			interestFollowsCamera = enabled;
			cameraAuthority.setInterestFollowsCamera(enabled);
		},
		get audioFollowsCamera() {
			return audioFollowsCamera;
		},
		updateAudioFollowsCamera(enabled) {
			audioFollowsCamera = enabled;
			cameraAuthority.setAudioFollowsCamera(enabled);
		},
	};

	const toolsEnvironment: ExplorerToolsEnvironmentSurface = {
		get environmentSelection() {
			return environmentSelection;
		},
		get dayGroupNames() {
			return (
				activeRegion?.data.sky?.dayGroups.map(({ dayName }) => dayName) ?? []
			);
		},
		updateEnvironment(selection) {
			displayDiagnostics.updateEnvironment(selection);
		},
		get weatherEnabled() {
			return frameSettings.weatherEnabled;
		},
		updateWeather(enabled) {
			displayDiagnostics.updateWeather(enabled);
		},
		get clockFollowing() {
			return clockFollowing;
		},
		updateClockFollowing(enabled) {
			displayDiagnostics.updateClockFollowing(enabled);
		},
		get effectVolume() {
			return effectVolume;
		},
		get ambientVolume() {
			return ambientVolume;
		},
		updateEffectVolume(volume) {
			displayDiagnostics.updateEffectVolume(volume);
		},
		updateAmbientVolume(volume) {
			displayDiagnostics.updateAmbientVolume(volume);
		},
	};

	const toolsRendering: ExplorerToolsRenderingSurface = {
		get distanceFogEnabled() {
			return frameSettings.distanceFogEnabled;
		},
		updateDistanceFog(enabled) {
			displayDiagnostics.updateDistanceFog(enabled);
		},
		get viewerLightEnabled() {
			return frameSettings.viewerLightEnabled;
		},
		updateViewerLight(enabled) {
			displayDiagnostics.updateViewerLight(enabled);
		},
		get showRetailHiddenGeometry() {
			return frameSettings.showRetailHiddenGeometry;
		},
		updateShowRetailHiddenGeometry(visible) {
			displayDiagnostics.updateShowRetailHiddenGeometry(visible);
		},
		get nameplates() {
			return frameSettings.nameplates;
		},
		updateNameplateCategory(category, visible) {
			displayDiagnostics.updateNameplateCategory(category, visible);
		},
		get ambientOcclusion() {
			return frameSettings.ambientOcclusion;
		},
		updateAmbientOcclusionSettings(settings) {
			displayDiagnostics.updateAmbientOcclusionSettings(settings);
		},
		get entityShadows() {
			return frameSettings.entityShadows;
		},
		updateEntityShadowSettings(settings) {
			displayDiagnostics.updateEntityShadowSettings(settings);
		},
		get colorGrade() {
			return frameSettings.colorGrade;
		},
		updateColorGradeSettings(settings) {
			displayDiagnostics.updateColorGradeSettings(settings);
		},
		get envCellRenderMode() {
			return frameSettings.envCellRenderMode;
		},
		updateEnvCellRenderMode(mode) {
			displayDiagnostics.updateEnvCellRenderMode(mode);
		},
		get layerVisibility() {
			return frameSettings.layerVisibility;
		},
		updateLayerVisibility(layer, visible) {
			displayDiagnostics.updateLayerVisibility(layer, visible);
		},
		get textureFiltering() {
			return effectiveTextureFiltering;
		},
		get textureFilteringOptions() {
			return supportedTextureFiltering;
		},
		get maximumTextureAnisotropy() {
			return textureFilteringCapabilities?.maximumAnisotropy ?? null;
		},
		updateTextureFiltering(policy) {
			displayDiagnostics.updateTextureFiltering(policy);
		},
		get renderScale() {
			return frameSettings.quality.renderScale;
		},
		renderScaleOptions: EXPLORER_RENDER_SCALE_OPTIONS,
		updateRenderScale(scale) {
			displayDiagnostics.updateRenderScale(scale);
		},
	};

	const toolsDiagnostics: ExplorerToolsDiagnosticsSurface = {
		readPerformanceSession: () => displayDiagnostics.readPerformanceSession(),
		readRendererFrameDiagnostics: () =>
			displayDiagnostics.readRendererFrameDiagnostics(),
		captureFrameDiagnosticReport: () =>
			displayDiagnostics.captureFrameDiagnosticReport(),
		readAuthoredDynamicRuntimeDiagnostics: () =>
			displayDiagnostics.readAuthoredDynamicRuntimeDiagnostics(),
		readStaticObjectRuntimeDiagnostics: () =>
			displayDiagnostics.readStaticObjectRuntimeDiagnostics(),
		readTextureAtlasPage: (pageId) =>
			displayDiagnostics.readTextureAtlasPage(pageId),
	};

	const toolsEntities: ExplorerToolsEntitiesSurface = {
		get entitySelection() {
			return selectedExplorerEntity;
		},
		selectEntity: selectExplorerEntity,
		get entityCatalog() {
			return entityCatalog;
		},
		get spawnedEntities() {
			return spawnedEntities;
		},
		get spawnedEntityPresentationError() {
			return spawnedEntityPresentationError;
		},
		spawnExplorerEntity: (wcid, distance) =>
			entityController.spawnExplorerEntity(wcid, distance),
		searchExplorerWeenies: (request) =>
			entityController.searchExplorerWeenies(request),
		despawnExplorerEntity: (entity) =>
			entityController.despawnExplorerEntity(entity),
		possessExplorerEntity: (guid) =>
			entityController.possessExplorerEntity(guid),
		setExplorerEntityStance: (style) =>
			entityController.setExplorerEntityStance(style),
		setExplorerEntityRunRate: (value) =>
			entityController.setExplorerEntityRunRate(value),
		get explorerPossession() {
			return explorerPossession;
		},
		get explorerPossessionControls() {
			return possessedControls;
		},
		readPossessionMotionProbe: () =>
			entityController.readPossessionMotionProbe(),
		readExplorerEntity: (selection) =>
			entityController.readExplorerEntity(selection),
		readBoomCameraStatus: () => cameraAuthority.readBoomCameraStatus(),
	};
</script>

<div class="explorer-screen ui-theme" use:observeSelectionTheme>
	<canvas
		bind:this={canvasElement}
		class="explorer-canvas"
		aria-label="Explorer render viewport"
		tabindex="-1"
		data-game-viewport
	></canvas>

	<div class="explorer-overlay">
		{#if startupError !== null}
			<section class="explorer-startup-error ui-error" role="alert">
				{startupError}
			</section>
		{/if}

		<FrameMetricsOverlay
			readMetrics={() => displayDiagnostics.readFrameMetrics()}
			readFrameRates={() => displayDiagnostics.readFrameRates()}
			diagnosticsTuning={EXPLORER_TUNING.diagnostics}
		/>
		{#if startupError === null}
			<Minimap
				onClearWaypoint={null}
				readFrame={() => displayDiagnostics.readMinimapFrame()}
				viewState={minimap}
				editable={true}
				minSize={140}
				resizeBounds={null}
				resizable={true}
				onGeometryChange={(geometry) => {
					minimap = { ...minimap, ...geometry };
				}}
				onViewDiametersChange={(viewDiameters) => {
					minimap = { ...minimap, viewDiameters };
				}}
				onSelectEntity={selectMinimapEntity}
			/>
		{/if}
		<ExplorerTools
			camera={toolsCamera}
			environment={toolsEnvironment}
			rendering={toolsRendering}
			diagnostics={toolsDiagnostics}
			entities={toolsEntities}
		/>
	</div>
</div>
