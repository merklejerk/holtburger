<script lang="ts">
	import { onMount } from "svelte";
	import {
		DEFAULT_BUILDING_LOD_RADIUS,
		DEFAULT_DETAIL_LOD_RADIUS,
		DEFAULT_ENV_CELL_LOD_RADIUS,
		DEFAULT_TERRAIN_LOD_RADIUS,
		MAX_OUTDOOR_SCENE_LOD_RADIUS,
		MIN_OUTDOOR_SCENE_LOD_RADIUS,
		clampOutdoorSceneLodRadius,
		countOutdoorSceneLodTiles,
	} from "../lib/browser/outdoor-scene-interest";
	import {
		OUTDOOR_LANDBLOCK_WORLD_SIZE,
		getOutdoorLandblockCoords,
	} from "../lib/landblocks";
	import { BrowserCameraController } from "../lib/camera/browser-camera-controller";
	import {
		createFreeCameraFrameStateCamera,
		createFreeCameraState,
		type FreeCameraState,
	} from "../lib/camera/free-camera";
	import { createBrowserRuntime } from "../lib/browser/create-browser-runtime";
	import { createBrowserScenePickRay } from "../lib/browser/scene-picking";
	import {
		createSceneInterestFromLocation,
		inferLandblockInputMode,
		isLandblockPrefixInput,
		parseLocationInput,
		type LandblockInputMode,
		type ParsedLocationInput,
	} from "../lib/browser/location-input";
	import { resolveBrowserFollowModeRebase } from "../lib/browser/follow-mode";
	import { deriveOutdoorCameraLandblockResidency } from "../lib/runtime/static-placement";
	import {
		DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH,
		MAX_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH,
		MIN_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH,
	} from "../lib/runtime/client-runtime";
	import type {
		ClientRuntime,
		ManualStaticDomain,
		RuntimeCameraResidency,
		RuntimeEvent,
		RuntimeSceneDebugSelection,
		RuntimeSceneInterestSource,
		RuntimeOverviewSnapshot,
	} from "../lib/runtime/client-runtime";
	import type {
		PortalFrameNodeResources,
		PortalFrameWorkPlan,
		RendererStaticLayerVisibility,
	} from "../lib/renderer/types";
	import type { EnvCellResourceMembership } from "../lib/runtime/env-cell-resource-membership";
	import type { RuntimePortalOverlapResidency } from "../lib/runtime/portal-base-overlap";
	import type { StaticSceneSelectionKey } from "../lib/runtime/scene-query/contracts";
	import type { ScenePickHit } from "../lib/runtime/scene-query/merged-scene-query-contracts";
	import { describeStaticSceneSelectionKey } from "../lib/runtime/scene-query/static-selection-keys";
	import type { TextureFilteringMode } from "../lib/textures/sampling-policy";
	import DiagnosticsModal from "../lib/ui/DiagnosticsModal.svelte";
	import PerformanceOverlay from "../lib/ui/PerformanceOverlay.svelte";
	import {
		PerformanceMetricsTracker,
		type PerformanceMetricsSnapshot,
	} from "../lib/ui/performance-metrics";

	type BrowserPanelTab = "navigate" | "settings" | "debug";
	type SelectedScenePick =
		| {
				readonly distance: number;
				readonly kind: "static";
				readonly selectionKey: StaticSceneSelectionKey;
		  }
		| {
				readonly distance: number;
				readonly entityId: string;
				readonly kind: "dynamic";
				readonly sourceResidence: Extract<
					ScenePickHit,
					{ readonly source: "dynamic" }
				>["sourceResidence"];
		  };
	type CameraFocusStatus =
		| "idle"
		| "waiting"
		| "focused"
		| "focused-with-warnings"
		| "missing-bounds"
		| "failed"
		| "evicted"
		| "manual-control";
	type PendingCameraFocus =
		| {
				readonly kind: "interior-cell";
				readonly envCellId: number;
				readonly landblockId: number;
				readonly sceneInterestRevision: number;
		  }
		| {
				readonly kind: "outdoor-landblock";
				readonly landblockId: number;
				readonly sceneInterestRevision: number;
		  };

	const STATIC_INTEREST_REFRESH_DEBOUNCE_MS = 250;
	const CAMERA_POLICY_SYNC_INTERVAL_MS = 1000 / 30;
	const PERF_OVERLAY_SAMPLE_MS = 500;
	const PERF_OVERLAY_EMA_ALPHA = 0.18;
	const RUNTIME_OVERVIEW_POLL_INTERVAL_MS = 500;
	const STATIC_PICK_CLICK_DRAG_THRESHOLD_PX = 3;
	const INTERIOR_CAMERA_FOCUS_YAW_RADIANS = 0;
	const INTERIOR_CAMERA_FOCUS_PITCH_RADIANS = 0;
	const OUTDOOR_CAMERA_FOCUS_HORIZONTAL_DISTANCE =
		OUTDOOR_LANDBLOCK_WORLD_SIZE * 0.75;
	const OUTDOOR_CAMERA_FOCUS_MIN_CLEARANCE = 40;
	const TEXTURE_FILTERING_OPTIONS: readonly TextureFilteringMode[] = [
		"nearest",
		"linear",
		"anisotropic-4x",
	];

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let rootElement: HTMLElement | null = $state(null);
	let runtime: ClientRuntime | null = $state(null);
	let cameraController: BrowserCameraController | null = null;
	let runtimeFrameId: number | null = null;
	let runtimeOverviewPollIntervalId: number | null = null;
	let staticInterestRefreshTimer: number | null = null;
	let startupError = $state<string | null>(null);
	let activeTab = $state<BrowserPanelTab>("navigate");
	let panelCollapsed = $state(false);
	let locationInput = $state("0000");
	let landblockInputMode = $state<LandblockInputMode>("outdoor");
	let submittedStaticLocation = $state<ParsedLocationInput | null>(null);
	let followModeEnabled = $state(false);
	let terrainVisible = $state(true);
	let buildingsVisible = $state(true);
	let detailVisible = $state(true);
	let envCellsVisible = $state(true);
	let envCellAabbDebugVisible = $state(false);
	let envCellPortalDebugVisible = $state(false);
	let directEnvCellPortalMaxDepth = $state(
		DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH,
	);
	let flatVisionModeEnabled = $state(false);
	let envCellResourceInspectionInput = $state("");
	let terrainRadius = $state(DEFAULT_TERRAIN_LOD_RADIUS);
	let buildingRadius = $state(DEFAULT_BUILDING_LOD_RADIUS);
	let detailRadius = $state(DEFAULT_DETAIL_LOD_RADIUS);
	let envCellRadius = $state(DEFAULT_ENV_CELL_LOD_RADIUS);
	let runtimeOverview = $state<RuntimeOverviewSnapshot | null>(null);
	let cameraState = $state<FreeCameraState>(createFreeCameraState());
	let diagnosticsReportText = $state<string | null>(null);
	let selectedStaticDiagnosticsReportText = $state<string | null>(null);
	let selectedScenePick = $state<SelectedScenePick | null>(null);
	let pendingCameraFocus = $state<PendingCameraFocus | null>(null);
	let cameraFocusStatus = $state<CameraFocusStatus>("idle");
	let pickPointerCandidate: {
		readonly pointerId: number;
		readonly startX: number;
		readonly startY: number;
		readonly context: ParsedLocationInput | null;
		moved: boolean;
	} | null = null;
	let selectedTextureFilteringMode =
		$state<TextureFilteringMode>("anisotropic-4x");
	let performanceMetrics = $state<PerformanceMetricsSnapshot>({
		fps: 0,
		frameMs: 0,
		handlerMs: 0,
		extrapolatedFps: 0,
	});
	const performanceMetricsTracker = new PerformanceMetricsTracker({
		emaAlpha: PERF_OVERLAY_EMA_ALPHA,
		sampleMs: PERF_OVERLAY_SAMPLE_MS,
	});

	let copiedField = $state<string | null>(null);
	let copyTimeout: number | null = null;

	function copyToClipboard(value: string, label: string): void {
		navigator.clipboard
			.writeText(value)
			.then(() => {
				copiedField = label;
				if (copyTimeout) {
					window.clearTimeout(copyTimeout);
				}
				copyTimeout = window.setTimeout(() => {
					copiedField = null;
					copyTimeout = null;
				}, 1500);
			})
			.catch((err) => {
				console.error("Failed to copy to clipboard", err);
			});
	}

	const parsedLocation = $derived(
		parseLocationInput(locationInput, landblockInputMode),
	);
	const parsedIsInterior = $derived(parsedLocation?.kind === "interior-cell");
	const envCellResourceInspectionTarget = $derived(
		parseManualEnvCellResourceInspectionTarget(envCellResourceInspectionInput),
	);
	const canToggleLandblockMode = $derived(
		isLandblockPrefixInput(locationInput),
	);

	onMount(() => {
		if (!canvasElement) {
			startupError = "Browser canvas was not mounted.";
			return;
		}

		try {
			runtime = createBrowserRuntime(canvasElement);
			runtime.setStaticLayerVisibility(createStaticLayerVisibility());
			runtime.setEnvCellAabbDebugOverlayVisible(envCellAabbDebugVisible);
			runtime.setEnvCellPortalDebugOverlayVisible(envCellPortalDebugVisible);
			runtime.setDirectEnvCellPortalMaxDepth(directEnvCellPortalMaxDepth);
			runtime.setFlatVisionModeEnabled(flatVisionModeEnabled);
			cameraController = new BrowserCameraController({
				initialState: cameraState,
				onChange(nextCameraState) {
					cameraState = nextCameraState;
					if (nextCameraState.hasManualControl) {
						cancelPendingCameraFocus("manual-control");
					}
					pushCameraState();
				},
			});
			const unsubscribeFrameTelemetry = runtime.subscribeFrameTelemetry(
				(telemetry) => {
					performanceMetrics = performanceMetricsTracker.update(telemetry);
				},
			);
			const unsubscribeEvents = runtime.subscribeEvents(handleRuntimeEvent);
			pushCameraState();
			refreshRuntimeOverview();
			startRuntimeFrameLoop();
			startRuntimeOverviewPolling();
			const policySyncInterval = window.setInterval(() => {
				syncCameraPolicy();
			}, CAMERA_POLICY_SYNC_INTERVAL_MS);

			return () => {
				stopRuntimeFrameLoop();
				stopRuntimeOverviewPolling();
				window.clearInterval(policySyncInterval);
				clearStaticInterestRefresh();
				unsubscribeFrameTelemetry();
				unsubscribeEvents();
				cameraController?.dispose();
				cameraController = null;
				runtime?.dispose();
				runtime = null;
			};
		} catch (error) {
			startupError = error instanceof Error ? error.message : String(error);
		}
	});

	function requestSceneInterest(): void {
		clearStaticInterestRefresh();
		if (!runtime || !parsedLocation) {
			return;
		}

		submittedStaticLocation = parsedLocation;
		clearSceneDebugSelection();
		updateSceneInterestForLocation(parsedLocation, "manual");
	}

	function updateSceneInterestForLocation(
		location: ParsedLocationInput,
		source: Exclude<RuntimeSceneInterestSource, "none">,
	): void {
		if (!runtime) {
			return;
		}

		runtime.updateSceneInterest(
			createSceneInterestFromLocation(
				location,
				selectedDemandDomains(),
				{
					buildings: buildingRadius,
					detail: detailRadius,
					terrain: terrainRadius,
					envCells: envCellRadius,
				},
				source,
			),
		);
		refreshRuntimeOverview();
	}

	function handleStaticWorkSubmit(event: SubmitEvent): void {
		event.preventDefault();
		requestSceneInterest();
	}

	function clearSceneInterest(): void {
		clearStaticInterestRefresh();
		submittedStaticLocation = null;
		clearSceneDebugSelection();
		cancelPendingCameraFocus("idle");
		followModeEnabled = false;
		runtime?.updateSceneInterest({ kind: "none" });
		refreshRuntimeOverview();
	}

	function resetCamera(): void {
		cancelPendingCameraFocus("manual-control");
		cameraController?.reset();
	}

	function pushCameraState(): void {
		if (!runtime) {
			return;
		}

		const camera =
			cameraController?.createFrameStateCamera() ??
			createFreeCameraFrameStateCamera(cameraState);
		runtime.updateCameraState(camera);
	}

	function startRuntimeFrameLoop(): void {
		if (runtimeFrameId !== null) {
			return;
		}

		const pushRuntimeFrame = (timestampMilliseconds: number): void => {
			runtimeFrameId = window.requestAnimationFrame(pushRuntimeFrame);
			runtime?.tickFrame(timestampMilliseconds / 1000);
		};
		runtimeFrameId = window.requestAnimationFrame(pushRuntimeFrame);
	}

	function stopRuntimeFrameLoop(): void {
		if (runtimeFrameId === null) {
			return;
		}
		window.cancelAnimationFrame(runtimeFrameId);
		runtimeFrameId = null;
	}

	function startRuntimeOverviewPolling(): void {
		if (runtimeOverviewPollIntervalId !== null) {
			return;
		}

		runtimeOverviewPollIntervalId = window.setInterval(() => {
			refreshRuntimeOverview();
		}, RUNTIME_OVERVIEW_POLL_INTERVAL_MS);
	}

	function stopRuntimeOverviewPolling(): void {
		if (runtimeOverviewPollIntervalId === null) {
			return;
		}

		window.clearInterval(runtimeOverviewPollIntervalId);
		runtimeOverviewPollIntervalId = null;
	}

	function refreshRuntimeOverview(): void {
		if (!runtime) {
			return;
		}

		const nextOverview = runtime.createOverviewSnapshot();
		runtimeOverview = nextOverview;
		selectedTextureFilteringMode =
			nextOverview.renderPolicy.textureFilteringMode;
	}

	function handleLocationInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		locationInput = input.value;
		landblockInputMode = inferLandblockInputMode(
			locationInput,
			landblockInputMode,
		);
	}

	function handleTerrainRadiusInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const nextTerrainRadius = clampOutdoorSceneLodRadius(Number(input.value));
		terrainRadius = nextTerrainRadius;
		buildingRadius = Math.min(buildingRadius, nextTerrainRadius);
		detailRadius = Math.min(detailRadius, buildingRadius);
		envCellRadius = Math.min(envCellRadius, nextTerrainRadius);
		scheduleStaticInterestRefresh();
	}

	function handleBuildingRadiusInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const nextBuildingRadius = Math.min(
			clampOutdoorSceneLodRadius(Number(input.value)),
			terrainRadius,
		);
		buildingRadius = nextBuildingRadius;
		detailRadius = Math.min(detailRadius, nextBuildingRadius);
		scheduleStaticInterestRefresh();
	}

	function handleDetailRadiusInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		detailRadius = Math.min(
			clampOutdoorSceneLodRadius(Number(input.value)),
			buildingRadius,
		);
		scheduleStaticInterestRefresh();
	}

	function handleEnvCellRadiusInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		envCellRadius = Math.min(
			clampOutdoorSceneLodRadius(Number(input.value)),
			terrainRadius,
		);
		scheduleStaticInterestRefresh();
	}

	function handleOutdoorModeChange(): void {
		landblockInputMode = "outdoor";
	}

	function handleDungeonModeChange(): void {
		landblockInputMode = "dungeon";
	}

	function handleStaticVisibilityChange(): void {
		syncStaticLayerVisibility();
	}

	function handleFollowModeChange(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		followModeEnabled = input.checked;
		if (!followModeEnabled) {
			return;
		}

		if (!submittedStaticLocation && parsedLocation) {
			requestSceneInterest();
			return;
		}

		updateFollowModeSceneInterest(
			(
				cameraController?.createFrameStateCamera() ??
				createFreeCameraFrameStateCamera(cameraState)
			).position,
		);
	}

	function canRequestStaticWork(): boolean {
		if (!runtime || !parsedLocation) {
			return false;
		}

		return true;
	}

	function selectedDemandDomains(): ManualStaticDomain[] {
		return ["terrain", "buildings", "detail", "env-cells"];
	}

	function createStaticLayerVisibility(): RendererStaticLayerVisibility {
		return {
			envCellInteriors: envCellsVisible,
			outdoorBuildings: buildingsVisible,
			outdoorDetail: detailVisible,
			terrain: terrainVisible,
		};
	}

	function syncStaticLayerVisibility(): void {
		runtime?.setStaticLayerVisibility(createStaticLayerVisibility());
		refreshRuntimeOverview();
	}

	function togglePanelCollapsed(): void {
		panelCollapsed = !panelCollapsed;
	}

	function openDiagnosticsReport(): void {
		if (!runtime) {
			return;
		}

		diagnosticsReportText = JSON.stringify(
			runtime.createDiagnosticsReport(),
			null,
			2,
		);
	}

	function closeDiagnosticsReport(): void {
		diagnosticsReportText = null;
	}

	function closeSelectedStaticDiagnosticsReport(): void {
		selectedStaticDiagnosticsReportText = null;
	}

	function openSelectedStaticDiagnosticsReport(): void {
		const selectedStaticPick = getSelectedStaticPick(selectedScenePick);
		if (!runtime || !selectedStaticPick) {
			return;
		}

		selectedStaticDiagnosticsReportText = JSON.stringify(
			runtime.createStaticSelectionDiagnosticsReport(
				selectedStaticPick.selectionKey,
				{
					pickDistance: selectedStaticPick.distance,
				},
			),
			null,
			2,
		);
	}

	function setTextureFilteringMode(event: Event): void {
		const nextMode = (event.currentTarget as HTMLSelectElement)
			.value as TextureFilteringMode;
		selectedTextureFilteringMode = nextMode;
		runtime?.setTextureFilteringMode(nextMode);
		refreshRuntimeOverview();
	}

	function handleEnvCellAabbDebugToggle(event: Event): void {
		envCellAabbDebugVisible = (event.currentTarget as HTMLInputElement).checked;
		runtime?.setEnvCellAabbDebugOverlayVisible(envCellAabbDebugVisible);
		refreshRuntimeOverview();
	}

	function handleEnvCellPortalDebugToggle(event: Event): void {
		envCellPortalDebugVisible = (event.currentTarget as HTMLInputElement)
			.checked;
		runtime?.setEnvCellPortalDebugOverlayVisible(envCellPortalDebugVisible);
		refreshRuntimeOverview();
	}

	function handleFlatVisionModeToggle(event: Event): void {
		flatVisionModeEnabled = (event.currentTarget as HTMLInputElement).checked;
		runtime?.setFlatVisionModeEnabled(flatVisionModeEnabled);
		refreshRuntimeOverview();
	}

	function handleDirectEnvCellPortalMaxDepthInput(event: Event): void {
		directEnvCellPortalMaxDepth = Number(
			(event.currentTarget as HTMLInputElement).value,
		);
		runtime?.setDirectEnvCellPortalMaxDepth(directEnvCellPortalMaxDepth);
		refreshRuntimeOverview();
	}

	function cancelPendingCameraFocus(status: CameraFocusStatus): void {
		pendingCameraFocus = null;
		cameraFocusStatus = status;
	}

	function handleRuntimeEvent(event: RuntimeEvent): void {
		if (event.kind === "scene-interest-updated") {
			handleSceneInterestUpdatedEvent(event);
			return;
		}

		handleSceneInterestSettledEvent(event);
	}

	function handleSceneInterestUpdatedEvent(
		event: Extract<RuntimeEvent, { readonly kind: "scene-interest-updated" }>,
	): void {
		if (event.source !== "manual") {
			cancelPendingCameraFocus(
				event.interest.kind === "none" ? "idle" : "evicted",
			);
			return;
		}

		if (event.interest.kind === "interior-cell") {
			pendingCameraFocus = {
				envCellId: event.interest.envCellId,
				kind: "interior-cell",
				landblockId: event.interest.landblockId,
				sceneInterestRevision: event.revision,
			};
			cameraFocusStatus = "waiting";
			return;
		}

		if (event.interest.kind === "outdoor-anchor") {
			pendingCameraFocus = {
				kind: "outdoor-landblock",
				landblockId: event.interest.anchorLandblockId,
				sceneInterestRevision: event.revision,
			};
			cameraFocusStatus = "waiting";
			return;
		}

		cancelPendingCameraFocus("idle");
	}

	function handleSceneInterestSettledEvent(
		event: Extract<RuntimeEvent, { readonly kind: "scene-interest-settled" }>,
	): void {
		if (
			!runtime ||
			!cameraController ||
			!pendingCameraFocus ||
			event.revision !== pendingCameraFocus.sceneInterestRevision
		) {
			return;
		}

		if (event.result === "cleared") {
			cancelPendingCameraFocus("evicted");
			return;
		}
		if (event.result === "failed") {
			logCameraFocusSettledFailure(event, pendingCameraFocus);
			applyPendingCameraFocus("focused-with-warnings");
			return;
		}

		applyPendingCameraFocus("focused");
	}

	function logCameraFocusSettledFailure(
		event: Extract<RuntimeEvent, { readonly kind: "scene-interest-settled" }>,
		focus: PendingCameraFocus,
	): void {
		console.warn("[holtburger-3d][browser][camera-focus-failed]", {
			focus,
			interest: event.interest,
			result: event.result,
			revision: event.revision,
			source: event.source,
		});
	}

	function applyPendingCameraFocus(status: CameraFocusStatus): void {
		if (!runtime || !cameraController || !pendingCameraFocus) {
			return;
		}

		const pose =
			pendingCameraFocus.kind === "interior-cell"
				? createInteriorCameraFocusPose(pendingCameraFocus)
				: createOutdoorCameraFocusPose(pendingCameraFocus);
		if (!pose) {
			cancelPendingCameraFocus("missing-bounds");
			return;
		}

		cameraController.setState({
			...cameraState,
			hasManualControl: false,
			pitchRadians: pose.pitchRadians,
			position: pose.position,
			yawRadians: pose.yawRadians,
		});
		pendingCameraFocus = null;
		cameraFocusStatus = status;
		syncCurrentCameraResidency(pose.position);
	}

	function createInteriorCameraFocusPose(
		focus: Extract<PendingCameraFocus, { readonly kind: "interior-cell" }>,
	): {
		readonly pitchRadians: number;
		readonly position: readonly [number, number, number];
		readonly yawRadians: number;
	} | null {
		const bounds = runtime?.queryEnvCellBounds(focus);
		if (!bounds) {
			return null;
		}

		const center = centerOfBounds(bounds.bounds);
		return {
			pitchRadians: INTERIOR_CAMERA_FOCUS_PITCH_RADIANS,
			position: [center.x, center.y, center.z],
			yawRadians: INTERIOR_CAMERA_FOCUS_YAW_RADIANS,
		};
	}

	function createOutdoorCameraFocusPose(
		focus: Extract<PendingCameraFocus, { readonly kind: "outdoor-landblock" }>,
	): {
		readonly pitchRadians: number;
		readonly position: readonly [number, number, number];
		readonly yawRadians: number;
	} | null {
		const bounds =
			runtime?.queryTerrainLandblockBounds({
				landblockId: focus.landblockId,
			})?.bounds ?? createDefaultOutdoorFocusBounds();
		const center = centerOfBounds(bounds);
		const direction = normalizeVector({ x: 1, y: 0, z: 1 });
		const footprint = Math.max(
			bounds.max.x - bounds.min.x,
			Math.abs(bounds.max.z - bounds.min.z),
			OUTDOOR_LANDBLOCK_WORLD_SIZE,
		);
		const horizontalDistance = Math.max(
			OUTDOOR_CAMERA_FOCUS_HORIZONTAL_DISTANCE,
			footprint * 0.75,
		);
		const clearance = Math.max(
			OUTDOOR_CAMERA_FOCUS_MIN_CLEARANCE,
			footprint * 0.25,
		);
		const x = center.x + direction.x * horizontalDistance;
		const z = center.z + direction.z * horizontalDistance;
		const groundY = queryOutdoorTerrainHeightAtPoint({
			bounds,
			clearance,
			x,
			z,
		});
		const position = {
			x,
			y: groundY + clearance,
			z,
		};
		const look = normalizeVector({
			x: center.x - position.x,
			y: center.y - position.y,
			z: center.z - position.z,
		});

		return {
			pitchRadians: Math.asin(look.y),
			position: [position.x, position.y, position.z],
			yawRadians: Math.atan2(look.x, -look.z),
		};
	}

	function queryOutdoorTerrainHeightAtPoint(options: {
		readonly bounds: {
			readonly max: {
				readonly x: number;
				readonly y: number;
				readonly z: number;
			};
			readonly min: {
				readonly x: number;
				readonly y: number;
				readonly z: number;
			};
		};
		readonly clearance: number;
		readonly x: number;
		readonly z: number;
	}): number {
		const hit = runtime?.pickSceneRay({
			context: { kind: "outdoor" },
			filters: { itemKinds: ["terrain-quad"] },
			mode: "default-selection",
			ray: {
				direction: { x: 0, y: -1, z: 0 },
				origin: {
					x: options.x,
					y: options.bounds.max.y + options.clearance * 2,
					z: options.z,
				},
			},
		});

		return hit?.source === "static" &&
			hit.staticHit.selectionKey.itemKind === "terrain-quad"
			? hit.staticHit.hitPoint.y
			: options.bounds.max.y;
	}

	function centerOfBounds(bounds: {
		readonly max: {
			readonly x: number;
			readonly y: number;
			readonly z: number;
		};
		readonly min: {
			readonly x: number;
			readonly y: number;
			readonly z: number;
		};
	}): { readonly x: number; readonly y: number; readonly z: number } {
		return {
			x: (bounds.min.x + bounds.max.x) * 0.5,
			y: (bounds.min.y + bounds.max.y) * 0.5,
			z: (bounds.min.z + bounds.max.z) * 0.5,
		};
	}

	function createDefaultOutdoorFocusBounds(): {
		readonly max: {
			readonly x: number;
			readonly y: number;
			readonly z: number;
		};
		readonly min: {
			readonly x: number;
			readonly y: number;
			readonly z: number;
		};
	} {
		return {
			max: {
				x: OUTDOOR_LANDBLOCK_WORLD_SIZE,
				y: OUTDOOR_LANDBLOCK_WORLD_SIZE * 0.5,
				z: 0,
			},
			min: {
				x: 0,
				y: 0,
				z: -OUTDOOR_LANDBLOCK_WORLD_SIZE,
			},
		};
	}

	function normalizeVector(vector: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	}): { readonly x: number; readonly y: number; readonly z: number } {
		const length = Math.hypot(vector.x, vector.y, vector.z);
		if (length === 0) {
			return { x: 0, y: 0, z: -1 };
		}

		return {
			x: vector.x / length,
			y: vector.y / length,
			z: vector.z / length,
		};
	}

	function scheduleStaticInterestRefresh(): void {
		clearStaticInterestRefresh();
		if (!runtime || !submittedStaticLocation) {
			return;
		}

		staticInterestRefreshTimer = window.setTimeout(() => {
			staticInterestRefreshTimer = null;
			if (submittedStaticLocation) {
				updateSceneInterestForLocation(submittedStaticLocation, "settings");
			}
		}, STATIC_INTEREST_REFRESH_DEBOUNCE_MS);
	}

	function clearStaticInterestRefresh(): void {
		if (staticInterestRefreshTimer === null) {
			return;
		}

		window.clearTimeout(staticInterestRefreshTimer);
		staticInterestRefreshTimer = null;
	}

	function updateFollowModeSceneInterest(
		cameraPosition: readonly [number, number, number],
	): void {
		applyFollowModeRebaseForFrame({
			pitchRadians: cameraState.pitchRadians,
			position: cameraPosition,
			yawRadians: cameraState.yawRadians,
		});
	}

	function syncCameraPolicy(): void {
		const camera =
			cameraController?.createFrameStateCamera() ??
			createFreeCameraFrameStateCamera(cameraState);
		const rebasedCamera = applyFollowModeRebaseForFrame(camera);
		syncCurrentCameraResidency(rebasedCamera.position);
	}

	function syncCurrentCameraResidency(
		cameraPosition: readonly [number, number, number],
	): void {
		if (!runtime) {
			return;
		}

		runtime.setCurrentCameraResidency(
			resolveCurrentCameraResidency(cameraPosition),
		);
	}

	function resolveCurrentCameraResidency(
		cameraPosition: readonly [number, number, number],
	): RuntimeCameraResidency {
		if (!submittedStaticLocation) {
			return {
				kind: "unknown",
				landblockId: null,
			};
		}

		if (submittedStaticLocation.kind === "interior-cell") {
			const queriedResidency = runtime?.queryCameraResidencyAtLandblockPoint({
				landblockId: submittedStaticLocation.landblockId,
				point: {
					x: cameraPosition[0],
					y: cameraPosition[1],
					z: cameraPosition[2],
				},
			});
			return queriedResidency?.kind === "env-cell"
				? queriedResidency
				: {
						envCellId: submittedStaticLocation.envCellId,
						kind: "env-cell",
						landblockId: submittedStaticLocation.landblockId,
					};
		}

		return (
			runtime?.queryCameraResidencyAtPoint({
				outdoorAnchorLandblockId: submittedStaticLocation.landblockId,
				point: {
					x: cameraPosition[0],
					y: cameraPosition[1],
					z: cameraPosition[2],
				},
			}) ?? {
				kind: "unknown",
				landblockId: null,
			}
		);
	}

	function applyFollowModeRebaseForFrame(
		camera: ReturnType<typeof createFreeCameraFrameStateCamera>,
	): ReturnType<typeof createFreeCameraFrameStateCamera> {
		if (
			!followModeEnabled ||
			!runtime ||
			!submittedStaticLocation ||
			submittedStaticLocation.kind !== "outdoor-landblock"
		) {
			return camera;
		}

		const rebase = resolveBrowserFollowModeRebase({
			cameraPosition: camera.position,
			domains: selectedDemandDomains(),
			enabled: followModeEnabled,
			lod: {
				buildings: buildingRadius,
				detail: detailRadius,
				terrain: terrainRadius,
				envCells: envCellRadius,
			},
			submittedLocation: submittedStaticLocation,
		});
		if (!rebase) {
			return camera;
		}

		submittedStaticLocation = rebase.submittedLocation;
		cameraController?.setPosition(rebase.cameraPosition);
		cameraState = {
			...cameraState,
			position: rebase.cameraPosition,
		};
		runtime.updateSceneInterest(rebase.sceneInterest);
		if (!cameraController) {
			pushCameraState();
		}

		return {
			...camera,
			position: rebase.cameraPosition,
		};
	}

	function formatCameraPosition(
		position: readonly [number, number, number],
	): string {
		return `${position[0].toFixed(1)} ${position[1].toFixed(1)} ${position[2].toFixed(1)}`;
	}

	function formatOutdoorCameraPosition(
		position: readonly [number, number, number],
	): string {
		return `${position[0].toFixed(1)} ${(-position[2]).toFixed(1)} ${position[1].toFixed(1)}`;
	}

	function formatCameraPositionWithCell(): string {
		const residency = runtimeOverview?.currentCameraResidency;
		if (residency?.kind === "env-cell") {
			return `${formatHexId(residency.envCellId)} ${formatCameraPosition(cameraState.position)}`;
		}

		const outdoorPosition = getOutdoorCameraMapPosition();
		if (outdoorPosition) {
			const cellId = deriveOutdoorCellId(
				outdoorPosition.landblockId,
				outdoorPosition.localPosition,
			);
			return `${formatHexId(cellId)} ${formatOutdoorCameraPosition(outdoorPosition.localPosition)}`;
		}

		return `unknown ${formatCameraPosition(cameraState.position)}`;
	}

	function formatCameraMapCoords(): string {
		const residency = runtimeOverview?.currentCameraResidency;
		if (residency?.kind === "env-cell") {
			return "indoor";
		}

		const outdoorPosition = getOutdoorCameraMapPosition();
		if (!outdoorPosition) {
			return "unknown";
		}

		const landblockCoords = getOutdoorLandblockCoords(
			outdoorPosition.landblockId,
		);
		const totalX =
			landblockCoords.x * OUTDOOR_LANDBLOCK_WORLD_SIZE +
			outdoorPosition.localPosition[0];
		const totalY =
			landblockCoords.y * OUTDOOR_LANDBLOCK_WORLD_SIZE -
			outdoorPosition.localPosition[2];
		const longitude = totalX / 240 - 102;
		const latitude = totalY / 240 - 102;

		return `${formatMapCoord(latitude, "N", "S")} ${formatMapCoord(longitude, "E", "W")}`;
	}

	function getOutdoorCameraMapPosition(): {
		readonly landblockId: number;
		readonly localPosition: readonly [number, number, number];
	} | null {
		if (submittedStaticLocation?.kind !== "outdoor-landblock") {
			return null;
		}

		const residency = deriveOutdoorCameraLandblockResidency({
			anchorLandblockId: submittedStaticLocation.landblockId,
			cameraPosition: cameraState.position,
		});

		return residency
			? {
					landblockId: residency.landblockId,
					localPosition: residency.localCameraPosition,
				}
			: null;
	}

	function deriveOutdoorCellId(
		landblockId: number,
		localPosition: readonly [number, number, number],
	): number {
		const maxLocal = OUTDOOR_LANDBLOCK_WORLD_SIZE - 0.0001;
		const localX = clamp(localPosition[0], 0, maxLocal);
		const localY = clamp(-localPosition[2], 0, maxLocal);
		const cellLength = OUTDOOR_LANDBLOCK_WORLD_SIZE / 8;
		const cellX = Math.trunc(localX / cellLength);
		const cellY = Math.trunc(localY / cellLength);
		const cellId = cellX * 8 + cellY + 1;

		return ((landblockId & 0xffff0000) | cellId) >>> 0;
	}

	function formatMapCoord(
		value: number,
		positiveHemisphere: string,
		negativeHemisphere: string,
	): string {
		const hemisphere = value >= 0 ? positiveHemisphere : negativeHemisphere;
		return `${Math.abs(value).toFixed(2)}${hemisphere}`;
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.max(min, Math.min(max, value));
	}

	function formatRequestedStaticScope(): string {
		if (runtimeOverview?.sceneInterest.kind === "outdoor-anchor") {
			return `anchor ${formatHexId(runtimeOverview.sceneInterest.anchorLandblockId)} ${runtimeOverview.sceneInterest.domains.join(", ") || "no domains"} [${runtimeOverview.sceneInterest.source}]`;
		}

		if (runtimeOverview?.sceneInterest.kind === "interior-cell") {
			return `env ${formatHexId(runtimeOverview.sceneInterest.landblockId)} / ${formatHexId(runtimeOverview.sceneInterest.envCellId)} [${runtimeOverview.sceneInterest.source}]`;
		}

		return "none";
	}

	function isControlPanelEvent(event: Event): boolean {
		return (
			event.target instanceof Element &&
			(event.target.closest(".browser-display__panel") !== null ||
				event.target.closest("[data-browser-display-modal]") !== null)
		);
	}

	function handleViewportPointerDown(event: PointerEvent): void {
		if (!rootElement || isControlPanelEvent(event)) {
			return;
		}

		if (event.button === 0) {
			pickPointerCandidate = {
				context: submittedStaticLocation,
				moved: false,
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
			};
		}

		if (cameraController?.handlePointerDown(event, rootElement)) {
			event.preventDefault();
		}
	}

	function handleViewportPointerMove(event: PointerEvent): void {
		if (isControlPanelEvent(event)) {
			return;
		}

		updatePickPointerCandidate(event);

		if (cameraController?.handlePointerMove(event)) {
			event.preventDefault();
		}
	}

	function handleViewportPointerUp(event: PointerEvent): void {
		if (!rootElement || isControlPanelEvent(event)) {
			return;
		}

		const pickCandidate = pickPointerCandidate;
		pickPointerCandidate = null;
		if (cameraController?.handlePointerUp(event, rootElement)) {
			event.preventDefault();
		}
		if (pickCandidate && shouldPickFromPointerUp(event, pickCandidate)) {
			pickSceneAtPointer(event, pickCandidate.context);
		}
	}

	function handleViewportWheel(event: WheelEvent): void {
		if (isControlPanelEvent(event)) {
			return;
		}

		if (cameraController?.handleWheel(event)) {
			event.preventDefault();
		}
	}

	function handleViewportKeyDown(event: KeyboardEvent): void {
		if (isControlPanelEvent(event)) {
			return;
		}

		if (event.key.toLowerCase() === "f") {
			resetCamera();
			event.preventDefault();
			return;
		}

		if (cameraController?.handleKeyDown(event)) {
			event.preventDefault();
		}
	}

	function handleViewportKeyUp(event: KeyboardEvent): void {
		if (isControlPanelEvent(event)) {
			return;
		}

		if (cameraController?.handleKeyUp(event)) {
			event.preventDefault();
		}
	}

	function handleViewportBlur(): void {
		cameraController?.handleBlur();
		pickPointerCandidate = null;
	}

	function handleViewportContextMenu(event: MouseEvent): void {
		if (!isControlPanelEvent(event)) {
			event.preventDefault();
		}
	}

	function updatePickPointerCandidate(event: PointerEvent): void {
		if (
			!pickPointerCandidate ||
			pickPointerCandidate.pointerId !== event.pointerId
		) {
			return;
		}

		const distance = Math.hypot(
			event.clientX - pickPointerCandidate.startX,
			event.clientY - pickPointerCandidate.startY,
		);
		if (distance > STATIC_PICK_CLICK_DRAG_THRESHOLD_PX) {
			pickPointerCandidate.moved = true;
		}
	}

	function shouldPickFromPointerUp(
		event: PointerEvent,
		candidate: NonNullable<typeof pickPointerCandidate>,
	): boolean {
		return (
			event.pointerId === candidate.pointerId &&
			event.button === 0 &&
			!candidate.moved
		);
	}

	function pickSceneAtPointer(
		event: PointerEvent,
		contextLocation: ParsedLocationInput | null,
	): void {
		if (!runtime || !canvasElement || !contextLocation) {
			clearSceneDebugSelection();
			return;
		}

		const context =
			contextLocation.kind === "interior-cell"
				? {
						envCellId:
							runtimeOverview?.currentCameraResidency.kind === "env-cell" &&
							runtimeOverview.currentCameraResidency.landblockId ===
								contextLocation.landblockId
								? runtimeOverview.currentCameraResidency.envCellId
								: contextLocation.envCellId,
						kind: "env-cell" as const,
						landblockId: contextLocation.landblockId,
					}
				: { kind: "outdoor" as const };
		const camera =
			cameraController?.createFrameStateCamera() ??
			createFreeCameraFrameStateCamera(cameraState);
		const viewport = canvasElement.getBoundingClientRect();
		const pickRequest = createBrowserScenePickRay({
			camera,
			clientX: event.clientX,
			clientY: event.clientY,
			context,
			filters: { ignoreContainingOrigin: true },
			viewport,
		});
		const hit = runtime.pickSceneRay({
			...pickRequest,
			mode: "default-selection",
		});
		const selection = createSelectedScenePick(hit);
		selectedScenePick = selection;
		selectedStaticDiagnosticsReportText = null;
		runtime.setSceneDebugSelection(createRuntimeSceneDebugSelection(selection));
		refreshRuntimeOverview();
	}

	function clearSceneDebugSelection(): void {
		selectedScenePick = null;
		selectedStaticDiagnosticsReportText = null;
		runtime?.setSceneDebugSelection(null);
		refreshRuntimeOverview();
	}

	function createSelectedScenePick(
		hit: ScenePickHit | null,
	): SelectedScenePick | null {
		if (hit === null) {
			return null;
		}
		if (hit.source === "static") {
			return {
				distance: hit.staticHit.distance,
				kind: "static",
				selectionKey: hit.staticHit.selectionKey,
			};
		}
		return {
			distance: hit.distance,
			entityId: hit.entityId,
			kind: "dynamic",
			sourceResidence: hit.sourceResidence,
		};
	}

	function createRuntimeSceneDebugSelection(
		selection: SelectedScenePick | null,
	): RuntimeSceneDebugSelection | null {
		if (selection === null) {
			return null;
		}
		if (selection.kind === "static") {
			return {
				kind: "static",
				selectionKey: selection.selectionKey,
			};
		}
		return {
			entityId: selection.entityId,
			kind: "dynamic",
		};
	}

	function getSelectedStaticPick(
		selection: SelectedScenePick | null,
	): Extract<SelectedScenePick, { readonly kind: "static" }> | null {
		return selection?.kind === "static" ? selection : null;
	}

	function formatScenePickSummary(selection: SelectedScenePick | null): string {
		if (selection === null) {
			return "none";
		}
		if (selection.kind === "static") {
			return `${describeStaticSceneSelectionKey(selection.selectionKey)} d=${selection.distance.toFixed(2)}`;
		}
		return `${selection.entityId} ${formatDynamicPickResidence(selection.sourceResidence)} d=${selection.distance.toFixed(2)}`;
	}

	function formatDynamicPickResidence(
		residence:
			| {
					readonly kind: "outdoor-landblock";
					readonly landblockId: number;
			  }
			| {
					readonly envCellId: number;
					readonly kind: "env-cell";
					readonly landblockId: number;
			  },
	): string {
		if (residence.kind === "env-cell") {
			return `env ${formatHexId(residence.landblockId)} / ${formatHexId(residence.envCellId)}`;
		}
		return `out ${formatHexId(residence.landblockId)}`;
	}

	function formatHexId(value: number): string {
		return `0x${value.toString(16).padStart(8, "0")}`;
	}

	function parseManualEnvCellResourceInspectionTarget(
		value: string,
	): { readonly envCellId: number; readonly landblockId: number } | null {
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			return null;
		}
		const normalized = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
		if (!/^[0-9a-fA-F]{1,8}$/.test(normalized)) {
			return null;
		}
		const envCellId = Number.parseInt(normalized, 16) >>> 0;
		return {
			envCellId,
			landblockId: envCellId & 0xffff0000,
		};
	}

	function findEnvCellResourceMembership(
		landblockId: number,
		envCellId: number,
	): EnvCellResourceMembership | null {
		return (
			runtime?.queryEnvCellResourceMembership({ envCellId, landblockId }) ??
			null
		);
	}

	function formatEnvCellResourceMembership(
		target: { readonly envCellId: number; readonly landblockId: number } | null,
	): string {
		if (!target) {
			return "none";
		}
		const membership = findEnvCellResourceMembership(
			target.landblockId,
			target.envCellId,
		);
		const structuredCount =
			membership?.structuredInteriorDrawUnitIds.length ?? 0;
		const staticCount = membership?.envCellStaticObjectDrawUnitIds.length ?? 0;
		const sharedStaticCount =
			membership?.sharedEnvCellStaticObjectDrawUnits ?? 0;
		return `${formatHexId(target.envCellId)}: ${structuredCount} cell / ${staticCount} static (${sharedStaticCount} shared)`;
	}

	function formatPortalFrameWorkPlan(plan: PortalFrameWorkPlan): string {
		if (plan.kind === "legacy-render-pass") {
			return `legacy ${plan.mode}`;
		}
		if (plan.mode === "portal-projection") {
			const graph = plan.layeredGraph;
			const baseEntryResources =
				"resources" in graph.baseEntry ? graph.baseEntry.resources : null;
			const missingResourceCells =
				graph.renderEntries.filter(
					(entry) => entry.resources.resourceState === "missing-resources",
				).length +
				(baseEntryResources?.resourceState === "missing-resources" ? 1 : 0);
			const structuredDrawUnits =
				graph.renderEntries.reduce(
					(count, entry) =>
						count + entry.resources.structuredInteriorDrawUnitIds.length,
					0,
				) + (baseEntryResources?.structuredInteriorDrawUnitIds.length ?? 0);
			const staticDrawUnits =
				graph.renderEntries.reduce(
					(count, entry) =>
						count + entry.resources.envCellStaticObjectDrawUnitIds.length,
					0,
				) + (baseEntryResources?.envCellStaticObjectDrawUnitIds.length ?? 0);
			const base =
				graph.baseEntry.scene.kind === "outdoor-target"
					? `outdoor ${formatHexId(graph.baseEntry.scene.landblockId)}`
					: `env ${formatHexId(graph.baseEntry.scene.landblockId)} / ${formatHexId(graph.baseEntry.scene.envCellId)}`;
			const aperture = graph.diagnostics;
			const projection = graph.projectionDiagnostics;
			const overlap = plan.baseOverlap;
			return `${plan.mode} base ${base} entries ${graph.renderEntries.length}/${projection.projectedEnvCellCount} cells layers ${graph.renderLayers.length} max ${projection.maxSelectedRenderLayer}/${projection.maxProjectionRenderLayer} missing ${missingResourceCells} masks ${graph.maskEdges.length} apertures ${graph.apertureResources.length} edges ${aperture.envCellPortalEdges} env / ${aperture.buildingTransitionEdges} transition dup ${aperture.duplicateMaskEdges} dedupe ${aperture.dedupedGeometryResources} roots ${aperture.transitionRootCount}/${aperture.transitionRootCandidateCount} overlap ${overlap.envCells.length} cells / ${overlap.diagnostics.missingResourceEnvCellCount} missing exterior ${overlap.requiresExteriorSeed ? "yes" : "no"} sig ${overlap.overlapSignature} components ${projection.componentCount} cyclic ${projection.cyclicComponentCount} internal ${projection.componentInternalEdgeCount} skipped ${projection.renderEntriesSkippedByLayerCap} layer / ${projection.renderEntriesSkippedByMaxRenderEntries} entry-cap / ${projection.maskEdgesSkippedByMaxMaskEdges} mask-cap resources ${structuredDrawUnits} cell / ${staticDrawUnits} static`;
		}
		return "unsupported direct env-cell frame mode";
	}

	function formatPortalOverlapResidency(
		overlap: RuntimePortalOverlapResidency,
	): string {
		const diagnostics = overlap.diagnostics;
		return `${overlap.kind} cells ${overlap.baseOverlapEnvCellIds.length} boundaries ${overlap.boundaries.length} primary ${diagnostics.primaryAcceptedBoundaryCount}/${diagnostics.primaryCandidateCount} one-hop ${diagnostics.oneHopAcceptedBoundaryCount}/${diagnostics.oneHopCandidateCount} seeds ${diagnostics.oneHopSeedEnvCellCount} capped ${diagnostics.oneHopTraversalCapped ? "yes" : "no"}`;
	}

	function currentCameraEnvCellResourceTarget(): {
		readonly envCellId: number;
		readonly landblockId: number;
	} | null {
		if (runtimeOverview?.currentCameraResidency.kind !== "env-cell") {
			return null;
		}
		return {
			envCellId: runtimeOverview.currentCameraResidency.envCellId,
			landblockId: runtimeOverview.currentCameraResidency.landblockId,
		};
	}

	function formatCameraResidency(residency: RuntimeCameraResidency): string {
		if (residency.kind === "unknown") {
			return residency.landblockId === null
				? "unknown"
				: `unknown ${formatHexId(residency.landblockId)}`;
		}

		if (residency.kind === "outdoor-landblock") {
			return `outdoor ${formatHexId(residency.landblockId)}`;
		}

		return `env ${formatHexId(residency.landblockId)} / ${formatHexId(residency.envCellId)}`;
	}

	function formatCameraFocusStatus(): string {
		if (pendingCameraFocus) {
			if (pendingCameraFocus.kind === "interior-cell") {
				return `waiting env ${formatHexId(pendingCameraFocus.landblockId)} / ${formatHexId(pendingCameraFocus.envCellId)}`;
			}

			return `waiting outdoor ${formatHexId(pendingCameraFocus.landblockId)}`;
		}

		switch (cameraFocusStatus) {
			case "idle":
				return "idle";
			case "waiting":
				return "waiting";
			case "focused":
				return "focused";
			case "focused-with-warnings":
				return "focused with warnings";
			case "missing-bounds":
				return "missing bounds";
			case "failed":
				return "failed";
			case "evicted":
				return "evicted";
			case "manual-control":
				return "manual control";
		}
	}
</script>

<svelte:head>
	<title>Holtburger 3D Browser</title>
	<meta
		name="description"
		content="Browser frontend for proving runtime, renderer, and static pipeline boundaries."
	/>
</svelte:head>

<section
	bind:this={rootElement}
	class="browser-display"
	tabindex="-1"
	onblurcapture={handleViewportBlur}
	oncontextmenucapture={handleViewportContextMenu}
	onkeydowncapture={handleViewportKeyDown}
	onkeyupcapture={handleViewportKeyUp}
	onpointercancelcapture={handleViewportPointerUp}
	onpointerdowncapture={handleViewportPointerDown}
	onpointermovecapture={handleViewportPointerMove}
	onpointerupcapture={handleViewportPointerUp}
	onwheelcapture={handleViewportWheel}
>
	{#snippet copyOverlay(value: string, label: string)}
		<button
			class="browser-display__copy-overlay"
			class:copied={copiedField === label}
			title="Copy {label}"
			type="button"
			onclick={(e) => {
				e.stopPropagation();
				copyToClipboard(value, label);
			}}
		>
			<span>{copiedField === label ? "Copied!" : "Copy"}</span>
		</button>
	{/snippet}

	<canvas bind:this={canvasElement} class="browser-display__canvas"></canvas>

	<PerformanceOverlay metrics={performanceMetrics} />

	<aside
		class:browser-display__panel--collapsed={panelCollapsed}
		class="browser-display__panel"
		aria-label="Browser runtime controls"
	>
		<div class="browser-display__panel-bar">
			<button
				class="browser-display__collapse"
				type="button"
				aria-expanded={!panelCollapsed}
				aria-label={panelCollapsed ? "Expand controls" : "Collapse controls"}
				title={panelCollapsed ? "Expand controls" : "Collapse controls"}
				onclick={togglePanelCollapsed}
			>
				{panelCollapsed ? "+" : "-"}
			</button>
		</div>

		{#if !panelCollapsed}
			{#if startupError}
				<p class="browser-display__error">{startupError}</p>
			{/if}

			<div
				class="browser-display__tabs"
				role="tablist"
				aria-label="Browser views"
			>
				<button
					class:active={activeTab === "navigate"}
					type="button"
					role="tab"
					aria-selected={activeTab === "navigate"}
					aria-label="Navigate"
					title="Navigate"
					onclick={() => {
						activeTab = "navigate";
					}}
				>
					<span aria-hidden="true">⌖</span>
				</button>
				<button
					class:active={activeTab === "settings"}
					type="button"
					role="tab"
					aria-selected={activeTab === "settings"}
					aria-label="Settings"
					title="Settings"
					onclick={() => {
						activeTab = "settings";
					}}
				>
					<span aria-hidden="true">⚙</span>
				</button>
				<button
					class:active={activeTab === "debug"}
					type="button"
					role="tab"
					aria-selected={activeTab === "debug"}
					aria-label="Debug"
					title="Debug"
					onclick={() => {
						activeTab = "debug";
					}}
				>
					<span aria-hidden="true">◌</span>
				</button>
			</div>

			{#if activeTab === "navigate"}
				<div class="browser-display__tab-panel" role="tabpanel">
					<form class="browser-display__form" onsubmit={handleStaticWorkSubmit}>
						<section class="browser-display__control-group">
							<h2>Location</h2>
							<label class="browser-display__field">
								<span>Target</span>
								<input
									autocomplete="off"
									placeholder="33.50S, 72.80E, 0xda55, or 0xda550123"
									spellcheck="false"
									value={locationInput}
									oninput={handleLocationInput}
								/>
							</label>

							<div
								class="browser-display__toggles"
								aria-label="Landblock focus mode"
							>
								<label>
									<input
										checked={landblockInputMode === "outdoor"}
										disabled={!canToggleLandblockMode}
										name="browser-display-landblock-mode"
										type="radio"
										onchange={handleOutdoorModeChange}
									/>
									<span>Outdoor</span>
								</label>
								<label>
									<input
										checked={landblockInputMode === "dungeon"}
										disabled={!canToggleLandblockMode}
										name="browser-display-landblock-mode"
										type="radio"
										onchange={handleDungeonModeChange}
									/>
									<span>Dungeon</span>
								</label>
							</div>

							<dl class="browser-display__status">
								<div>
									<dt>Parsed</dt>
									<dd>{parsedLocation?.label ?? "invalid"}</dd>
								</div>
								<div>
									<dt>Requested</dt>
									<dd>{formatRequestedStaticScope()}</dd>
								</div>
								<div>
									<dt>Focus</dt>
									<dd>{formatCameraFocusStatus()}</dd>
								</div>
							</dl>
						</section>

						<section class="browser-display__control-group">
							<h2>Follow</h2>
							<div class="browser-display__toggles" aria-label="Follow mode">
								<label>
									<input
										checked={followModeEnabled}
										disabled={!runtime ||
											parsedLocation?.kind === "interior-cell"}
										type="checkbox"
										onchange={handleFollowModeChange}
									/>
									<span>Follow camera</span>
								</label>
							</div>
						</section>

						<section class="browser-display__control-group">
							<h2>Camera Residency</h2>
							<dl class="browser-display__status">
								<div>
									<dt>Position</dt>
									<dd>{formatCameraPositionWithCell()}</dd>
								</div>
								<div>
									<dt>Coords</dt>
									<dd>{formatCameraMapCoords()}</dd>
								</div>
							</dl>
						</section>

						<button
							class="browser-display__request"
							disabled={!canRequestStaticWork()}
							type="submit"
						>
							Request Static Scope
						</button>
					</form>
				</div>
			{:else if activeTab === "settings"}
				<div class="browser-display__tab-panel" role="tabpanel">
					<div class="browser-display__toggles" aria-label="Static visibility">
						<label>
							<input
								bind:checked={terrainVisible}
								type="checkbox"
								onchange={handleStaticVisibilityChange}
							/>
							<span>Terrain</span>
						</label>
						<label>
							<input
								bind:checked={buildingsVisible}
								type="checkbox"
								onchange={handleStaticVisibilityChange}
							/>
							<span>Buildings</span>
						</label>
						<label>
							<input
								bind:checked={detailVisible}
								type="checkbox"
								onchange={handleStaticVisibilityChange}
							/>
							<span>Detail</span>
						</label>
						<label>
							<input
								bind:checked={envCellsVisible}
								type="checkbox"
								onchange={handleStaticVisibilityChange}
							/>
							<span>Env Cells</span>
						</label>
					</div>

					<label class="browser-display__field">
						<span>Filtering</span>
						<select
							bind:value={selectedTextureFilteringMode}
							disabled={!runtime}
							onchange={setTextureFilteringMode}
						>
							{#each TEXTURE_FILTERING_OPTIONS as option}
								<option value={option}>{option}</option>
							{/each}
						</select>
					</label>

					<label class="browser-display__range">
						<span>Terrain distance</span>
						<strong>
							{terrainRadius} out ({countOutdoorSceneLodTiles(terrainRadius)} tiles)
						</strong>
						<input
							disabled={parsedIsInterior}
							max={MAX_OUTDOOR_SCENE_LOD_RADIUS}
							min={MIN_OUTDOOR_SCENE_LOD_RADIUS}
							step="1"
							type="range"
							value={terrainRadius}
							oninput={handleTerrainRadiusInput}
						/>
					</label>

					<label class="browser-display__range">
						<span>Building distance</span>
						<strong>
							{buildingRadius} out ({countOutdoorSceneLodTiles(buildingRadius)} tiles)
						</strong>
						<input
							disabled={parsedIsInterior}
							max={terrainRadius}
							min={MIN_OUTDOOR_SCENE_LOD_RADIUS}
							step="1"
							type="range"
							value={buildingRadius}
							oninput={handleBuildingRadiusInput}
						/>
					</label>

					<label class="browser-display__range">
						<span>Detail distance</span>
						<strong>
							{detailRadius} out ({countOutdoorSceneLodTiles(detailRadius)} tiles)
						</strong>
						<input
							disabled={parsedIsInterior}
							max={buildingRadius}
							min={MIN_OUTDOOR_SCENE_LOD_RADIUS}
							step="1"
							type="range"
							value={detailRadius}
							oninput={handleDetailRadiusInput}
						/>
					</label>

					<label class="browser-display__range">
						<span>Env-cell distance</span>
						<strong>
							{envCellRadius} out ({countOutdoorSceneLodTiles(envCellRadius)} tiles)
						</strong>
						<input
							disabled={parsedIsInterior}
							max={terrainRadius}
							min={MIN_OUTDOOR_SCENE_LOD_RADIUS}
							step="1"
							type="range"
							value={envCellRadius}
							oninput={handleEnvCellRadiusInput}
						/>
					</label>

					<dl class="browser-display__status">
						<div>
							<dt>Coverage</dt>
							<dd>
								{parsedIsInterior
									? "single dungeon landblock"
									: `${countOutdoorSceneLodTiles(terrainRadius)} terrain tiles max`}
							</dd>
							{@render copyOverlay(
								parsedIsInterior
									? "single dungeon landblock"
									: `${countOutdoorSceneLodTiles(terrainRadius)} terrain tiles max`,
								"Coverage",
							)}
						</div>
					</dl>

					<div
						class="browser-display__actions browser-display__actions--single"
					>
						<button
							disabled={!runtime}
							type="button"
							onclick={clearSceneInterest}
						>
							Evict
						</button>
						<button disabled={!runtime} type="button" onclick={resetCamera}>
							Reset Camera
						</button>
					</div>
				</div>
			{:else}
				<div class="browser-display__tab-panel" role="tabpanel">
					<div
						class="browser-display__actions browser-display__actions--single"
					>
						<button
							disabled={!runtime}
							type="button"
							onclick={openDiagnosticsReport}
						>
							Diagnostics Report
						</button>
					</div>

					<label class="browser-display__checkbox-row">
						<input
							checked={envCellAabbDebugVisible}
							disabled={!runtime}
							type="checkbox"
							onchange={handleEnvCellAabbDebugToggle}
						/>
						<span>Env-cell AABBs</span>
						<small>{runtimeOverview?.debugOverlays.envCellAabbCount ?? 0}</small
						>
					</label>
					<label class="browser-display__checkbox-row">
						<input
							checked={envCellPortalDebugVisible}
							disabled={!runtime}
							type="checkbox"
							onchange={handleEnvCellPortalDebugToggle}
						/>
						<span>Portals</span>
						<small>
							{runtimeOverview?.debugOverlays.portalCount ?? 0}
						</small>
					</label>
					<label class="browser-display__checkbox-row">
						<input
							checked={flatVisionModeEnabled}
							disabled={!runtime}
							type="checkbox"
							onchange={handleFlatVisionModeToggle}
						/>
						<span>Flat vision</span>
						<small>
							{runtimeOverview?.debugOverlays.flatVisionModeEnabled
								? "on"
								: "off"}
						</small>
					</label>
					<label class="browser-display__range">
						<span>Env-cell portal depth</span>
						<strong>
							{directEnvCellPortalMaxDepth}
							{directEnvCellPortalMaxDepth === 1 ? "level" : "levels"}
						</strong>
						<input
							disabled={!runtime || flatVisionModeEnabled}
							max={MAX_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH}
							min={MIN_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH}
							step="1"
							type="range"
							value={directEnvCellPortalMaxDepth}
							oninput={handleDirectEnvCellPortalMaxDepthInput}
						/>
					</label>

					<dl class="browser-display__status">
						<div>
							<dt>Static</dt>
							<dd>
								{#if runtimeOverview}
									r{runtimeOverview.static.revision} req {runtimeOverview.static
										.requested} res
									{runtimeOverview.static.resolving} bake {runtimeOverview
										.static.baking} commit
									{runtimeOverview.static.committed}
								{:else}
									pending
								{/if}
							</dd>
							{@render copyOverlay(
								runtimeOverview
									? `r${runtimeOverview.static.revision} req ${runtimeOverview.static.requested} res ${runtimeOverview.static.resolving} bake ${runtimeOverview.static.baking} commit ${runtimeOverview.static.committed}`
									: "pending",
								"Static",
							)}
						</div>
						<div>
							<dt>Scene query</dt>
							<dd>
								{#if runtimeOverview}
									out {runtimeOverview.staticSceneQuery.outdoorRecordCount} env
									{runtimeOverview.staticSceneQuery.envCellRecordCount} lb
									{runtimeOverview.staticSceneQuery.envCellLandblockCount}
								{:else}
									pending
								{/if}
							</dd>
							{@render copyOverlay(
								runtimeOverview
									? `out ${runtimeOverview.staticSceneQuery.outdoorRecordCount} env ${runtimeOverview.staticSceneQuery.envCellRecordCount} lb ${runtimeOverview.staticSceneQuery.envCellLandblockCount}`
									: "pending",
								"Scene query",
							)}
						</div>
						<div class="browser-display__status-row--action">
							<dt>Selected</dt>
							<dd>
								<span class="browser-display__copy-target">
									{formatScenePickSummary(selectedScenePick)}
									{@render copyOverlay(
										formatScenePickSummary(selectedScenePick),
										"Selected",
									)}
								</span>
								<button
									disabled={!getSelectedStaticPick(selectedScenePick)}
									type="button"
									onclick={openSelectedStaticDiagnosticsReport}
								>
									Inspect
								</button>
							</dd>
						</div>
						<div>
							<dt>Assets</dt>
							<dd>
								{#if runtimeOverview}
									p{runtimeOverview.assets.pendingCount} c{runtimeOverview
										.assets.committedCount}
								{:else}
									pending
								{/if}
							</dd>
							{@render copyOverlay(
								runtimeOverview
									? `p${runtimeOverview.assets.pendingCount} c${runtimeOverview.assets.committedCount}`
									: "pending",
								"Assets",
							)}
						</div>
						<div>
							<dt>Terrain payload</dt>
							<dd>
								{#if runtimeOverview?.static.latestTerrainPayload}
									lb {runtimeOverview.static.latestTerrainPayload.landblockId
										.toString(16)
										.padStart(8, "0")} region
									{runtimeOverview.static.latestTerrainPayload.regionNumber} mesh
									{runtimeOverview.static.latestTerrainPayload
										.vertexCount}v/{runtimeOverview.static.latestTerrainPayload
										.triangleCount}t tex
									{runtimeOverview.static.latestTerrainPayload.textureUseCount} missing
									{runtimeOverview.static.latestTerrainPayload.missingRefCount}
								{:else}
									none
								{/if}
							</dd>
							{@render copyOverlay(
								runtimeOverview?.static.latestTerrainPayload
									? `lb ${runtimeOverview.static.latestTerrainPayload.landblockId.toString(16).padStart(8, "0")} region ${runtimeOverview.static.latestTerrainPayload.regionNumber} mesh ${runtimeOverview.static.latestTerrainPayload.vertexCount}v/${runtimeOverview.static.latestTerrainPayload.triangleCount}t tex ${runtimeOverview.static.latestTerrainPayload.textureUseCount} missing ${runtimeOverview.static.latestTerrainPayload.missingRefCount}`
									: "none",
								"Terrain payload",
							)}
						</div>
						<div>
							<dt>Env-cell payload</dt>
							<dd>
								{#if runtimeOverview?.static.latestLandblockEnvCellsPayload}
									lb {runtimeOverview.static.latestLandblockEnvCellsPayload.landblockId
										.toString(16)
										.padStart(8, "0")}
									cells
									{runtimeOverview.static.latestLandblockEnvCellsPayload
										.envCellCount}
									accepted
									{runtimeOverview.static.latestLandblockEnvCellsPayload
										.acceptedEnvCellCount} visible
									{runtimeOverview.static.latestLandblockEnvCellsPayload
										.visibleCellCount} portals
									{runtimeOverview.static.latestLandblockEnvCellsPayload
										.portalCount}
									links
									{runtimeOverview.static.latestLandblockEnvCellsPayload
										.portalLinkCount}
									seeds
									{runtimeOverview.static.latestLandblockEnvCellsPayload
										.staticObjectSeedCount} missing
									{runtimeOverview.static.latestLandblockEnvCellsPayload
										.missingRefCount}
								{:else}
									none
								{/if}
							</dd>
							{@render copyOverlay(
								runtimeOverview?.static.latestLandblockEnvCellsPayload
									? `lb ${runtimeOverview.static.latestLandblockEnvCellsPayload.landblockId.toString(16).padStart(8, "0")} cells ${runtimeOverview.static.latestLandblockEnvCellsPayload.envCellCount} accepted ${runtimeOverview.static.latestLandblockEnvCellsPayload.acceptedEnvCellCount} visible ${runtimeOverview.static.latestLandblockEnvCellsPayload.visibleCellCount} portals ${runtimeOverview.static.latestLandblockEnvCellsPayload.portalCount} links ${runtimeOverview.static.latestLandblockEnvCellsPayload.portalLinkCount} seeds ${runtimeOverview.static.latestLandblockEnvCellsPayload.staticObjectSeedCount} missing ${runtimeOverview.static.latestLandblockEnvCellsPayload.missingRefCount}`
									: "none",
								"Env-cell payload",
							)}
						</div>
						<div>
							<dt>Camera</dt>
							<dd>
								{formatCameraPosition(cameraState.position)} yaw
								{cameraState.yawRadians.toFixed(2)} pitch
								{cameraState.pitchRadians.toFixed(2)}
							</dd>
							{@render copyOverlay(
								`${formatCameraPosition(cameraState.position)} yaw ${cameraState.yawRadians.toFixed(2)} pitch ${cameraState.pitchRadians.toFixed(2)}`,
								"Camera",
							)}
						</div>
						<div>
							<dt>Camera residency</dt>
							<dd>
								{runtimeOverview
									? formatCameraResidency(
											runtimeOverview.currentCameraResidency,
										)
									: "pending"}
							</dd>
							{@render copyOverlay(
								runtimeOverview
									? formatCameraResidency(
											runtimeOverview.currentCameraResidency,
										)
									: "pending",
								"Camera residency",
							)}
						</div>
						<div>
							<dt>Camera env resources</dt>
							<dd>
								{runtimeOverview
									? formatEnvCellResourceMembership(
											currentCameraEnvCellResourceTarget(),
										)
									: "pending"}
							</dd>
							{@render copyOverlay(
								runtimeOverview
									? formatEnvCellResourceMembership(
											currentCameraEnvCellResourceTarget(),
										)
									: "pending",
								"Camera env resources",
							)}
						</div>
						<div>
							<dt>Portal frame & overlap</dt>
							<dd>
								{#if runtimeOverview}
									{formatPortalFrameWorkPlan(
										runtimeOverview.portalFrameWorkPlan,
									)} | {formatPortalOverlapResidency(
										runtimeOverview.currentPortalOverlapResidency,
									)}
								{:else}
									pending
								{/if}
							</dd>
							{@render copyOverlay(
								runtimeOverview
									? `${formatPortalFrameWorkPlan(runtimeOverview.portalFrameWorkPlan)} | ${formatPortalOverlapResidency(runtimeOverview.currentPortalOverlapResidency)}`
									: "pending",
								"Portal frame & overlap",
							)}
						</div>
						<div class="browser-display__status-row--action">
							<dt>Inspect env resources</dt>
							<dd>
								<input
									aria-label="Env-cell resource id"
									placeholder="0x1a730103"
									type="text"
									value={envCellResourceInspectionInput}
									oninput={(event) => {
										envCellResourceInspectionInput = (
											event.currentTarget as HTMLInputElement
										).value;
									}}
								/>
								<span class="browser-display__copy-target">
									{formatEnvCellResourceMembership(
										envCellResourceInspectionTarget,
									)}
									{@render copyOverlay(
										formatEnvCellResourceMembership(
											envCellResourceInspectionTarget,
										),
										"Inspect env resources",
									)}
								</span>
							</dd>
						</div>
						<div>
							<dt>Camera focus</dt>
							<dd>{formatCameraFocusStatus()}</dd>
							{@render copyOverlay(formatCameraFocusStatus(), "Camera focus")}
						</div>
					</dl>
				</div>
			{/if}
		{/if}
	</aside>

	{#if diagnosticsReportText !== null}
		<DiagnosticsModal
			eyebrow="On-demand diagnostics"
			text={diagnosticsReportText}
			title="Runtime Report"
			titleId="browser-display-diagnostics-title"
			onClose={closeDiagnosticsReport}
		/>
	{/if}

	{#if selectedStaticDiagnosticsReportText !== null}
		<DiagnosticsModal
			eyebrow="Selected item diagnostics"
			text={selectedStaticDiagnosticsReportText}
			title="Static Selection"
			titleId="browser-display-selection-diagnostics-title"
			onClose={closeSelectedStaticDiagnosticsReport}
		/>
	{/if}
</section>

<style>
	:global(body) {
		margin: 0;
		background: #050807;
	}

	.browser-display {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background:
			linear-gradient(rgba(75, 255, 173, 0.035) 1px, transparent 1px),
			linear-gradient(90deg, rgba(75, 255, 173, 0.025) 1px, transparent 1px),
			#050807;
		background-size:
			24px 24px,
			24px 24px,
			auto;
		color: #d9ffe8;
		font-family:
			"IBM Plex Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
	}

	.browser-display__canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.browser-display__panel {
		position: absolute;
		top: 16px;
		right: 16px;
		z-index: 1;
		width: min(380px, calc(100vw - 32px));
		max-height: calc(100vh - 32px);
		overflow: auto;
		padding: 10px;
		border: 1px solid rgba(91, 255, 187, 0.58);
		border-radius: 6px;
		background:
			linear-gradient(180deg, rgba(9, 27, 23, 0.96), rgba(4, 12, 11, 0.94)),
			rgba(4, 12, 11, 0.94);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.75),
			0 18px 50px rgba(0, 0, 0, 0.55),
			0 0 36px rgba(57, 255, 170, 0.13);
	}

	.browser-display__panel--collapsed {
		left: auto;
		right: 16px;
		width: auto;
		max-height: none;
		overflow: visible;
		padding: 6px;
	}

	.browser-display__panel-bar {
		display: flex;
		align-items: start;
		justify-content: flex-end;
		gap: 10px;
		margin-bottom: 10px;
	}

	.browser-display__panel--collapsed .browser-display__panel-bar {
		margin-bottom: 0;
	}

	button,
	input,
	select {
		font: inherit;
	}

	.browser-display button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		min-height: 30px;
		padding: 0 9px;
		border: 1px solid rgba(91, 255, 187, 0.45);
		border-radius: 4px;
		background: rgba(9, 38, 31, 0.92);
		color: #d9ffe8;
		cursor: pointer;
		font-size: 12px;
		line-height: 1;
		text-align: center;
		white-space: nowrap;
	}

	.browser-display button:hover:not(:disabled),
	.browser-display button.active {
		border-color: rgba(255, 214, 102, 0.9);
		color: #fff7cf;
		box-shadow: inset 0 0 18px rgba(255, 214, 102, 0.11);
	}

	.browser-display button:disabled,
	input:disabled,
	select:disabled {
		cursor: not-allowed;
		opacity: 0.48;
	}

	.browser-display__collapse {
		flex: 0 0 auto;
		width: 30px;
		padding: 0;
		font-size: 15px;
		font-weight: 700;
	}

	.browser-display__tabs {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 5px;
		margin-bottom: 10px;
	}

	.browser-display__tabs button {
		min-height: 28px;
		padding: 0 6px;
		font-size: 15px;
		line-height: 1;
	}

	.browser-display__tab-panel {
		display: grid;
		gap: 9px;
		margin: 0;
	}

	.browser-display__form {
		display: grid;
		gap: 9px;
		margin: 0;
	}

	.browser-display__control-group {
		display: grid;
		gap: 7px;
		padding: 0;
		margin: 0;
	}

	.browser-display__control-group h2 {
		margin: 0;
		color: #75ffd1;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0;
	}

	.browser-display__field,
	.browser-display__range {
		display: grid;
		gap: 5px;
	}

	.browser-display__field span,
	.browser-display__range span {
		color: #75ffd1;
		font-size: 11px;
		text-transform: uppercase;
	}

	.browser-display__field input,
	.browser-display__field select {
		appearance: none;
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		border: 1px solid rgba(91, 255, 187, 0.48);
		border-radius: 4px;
		background:
			linear-gradient(180deg, rgba(9, 38, 31, 0.96), rgba(1, 9, 8, 0.94)),
			rgba(1, 9, 8, 0.94);
		color: #f1fff6;
		padding: 7px 9px;
		font-size: 12px;
		outline: none;
		color-scheme: dark;
	}

	.browser-display__field select {
		padding-right: 26px;
		background:
			linear-gradient(45deg, transparent 50%, #75ffd1 50%) right 12px top 12px /
				5px 5px no-repeat,
			linear-gradient(135deg, #75ffd1 50%, transparent 50%) right 7px top 12px /
				5px 5px no-repeat,
			linear-gradient(180deg, rgba(9, 38, 31, 0.96), rgba(1, 9, 8, 0.94)),
			rgba(1, 9, 8, 0.94);
	}

	.browser-display__field select option {
		background: #06130f;
		color: #f1fff6;
	}

	.browser-display__field input:focus,
	.browser-display__field select:focus {
		border-color: #ffd666;
		box-shadow: 0 0 0 2px rgba(255, 214, 102, 0.16);
	}

	.browser-display__toggles,
	.browser-display__actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 6px;
	}

	.browser-display__actions--single {
		grid-template-columns: 1fr;
	}

	.browser-display__toggles label {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 28px;
		padding: 0 7px;
		border: 1px solid rgba(91, 255, 187, 0.28);
		border-radius: 4px;
		background: rgba(9, 38, 31, 0.48);
		font-size: 12px;
	}

	.browser-display__checkbox-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 7px;
		min-height: 30px;
		padding: 0 8px;
		border: 1px solid rgba(91, 255, 187, 0.22);
		border-radius: 4px;
		background: rgba(1, 9, 8, 0.38);
		color: #f1fff6;
		font-size: 12px;
	}

	.browser-display__checkbox-row small {
		color: #75ffd1;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 11px;
	}

	.browser-display__range {
		padding: 8px;
		border: 1px solid rgba(91, 255, 187, 0.22);
		border-radius: 4px;
		background: rgba(1, 9, 8, 0.38);
	}

	.browser-display__range strong {
		color: #fff7cf;
		font-size: 11px;
		font-weight: 600;
	}

	.browser-display__range input {
		width: 100%;
		accent-color: #75ffd1;
	}

	.browser-display__request {
		min-height: 32px;
		background: rgba(36, 68, 35, 0.82);
	}

	.browser-display__status {
		display: grid;
		gap: 5px;
		margin: 0;
	}

	.browser-display__status div {
		display: grid;
		grid-template-columns: minmax(88px, 0.42fr) minmax(0, 1fr);
		gap: 7px;
		padding: 6px 7px;
		border-left: 2px solid rgba(91, 255, 187, 0.42);
		background: rgba(1, 9, 8, 0.42);
		position: relative;
		transition:
			background-color 0.15s ease,
			border-left-color 0.15s ease;
	}

	.browser-display__status div:hover {
		background: rgba(1, 9, 8, 0.65);
		border-left-color: rgba(255, 214, 102, 0.8);
	}

	.browser-display__status dt {
		color: #75ffd1;
		font-size: 11px;
		text-transform: uppercase;
	}

	.browser-display__status dd {
		margin: 0;
		color: #f1fff6;
		font-size: 12px;
		overflow-wrap: anywhere;
		padding-right: 28px;
	}

	.browser-display__status-row--action dd {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 6px;
		padding-right: 28px;
	}

	.browser-display__status-row--action button {
		min-height: 24px;
		padding: 0 7px;
		font-size: 11px;
	}

	.browser-display__status-row--action input {
		min-width: 0;
		min-height: 24px;
		padding: 0 7px;
		border: 1px solid rgba(117, 255, 209, 0.4);
		background: rgba(0, 0, 0, 0.28);
		color: #f1fff6;
		font-size: 11px;
	}

	:global(.browser-display__copy-overlay) {
		position: absolute;
		inset: 0;
		display: flex !important;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.45) !important;
		color: #75ffd1 !important;
		font-family: inherit;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 1.5px;
		border: none !important;
		border-radius: 4px;
		cursor: pointer;
		opacity: 0;
		transition:
			opacity 0.12s ease,
			background-color 0.12s ease,
			color 0.12s ease;
		pointer-events: none;
		width: 100% !important;
		height: 100% !important;
		margin: 0 !important;
		padding: 0 !important;
		min-width: 0 !important;
		min-height: 0 !important;
		box-sizing: border-box;
		z-index: 10;
		box-shadow: none !important;
	}

	.browser-display__status div:hover > :global(.browser-display__copy-overlay),
	:global(.browser-display__copy-target):hover
		> :global(.browser-display__copy-overlay) {
		opacity: 1;
		pointer-events: auto;
	}

	:global(.browser-display__copy-overlay):hover {
		color: #ffd666 !important;
		background: rgba(0, 0, 0, 0.6) !important;
	}

	:global(.browser-display__copy-overlay.copied) {
		opacity: 1 !important;
		pointer-events: auto !important;
		background: rgba(9, 38, 31, 0.7) !important;
		color: #4bffad !important;
		border: none !important;
	}

	:global(.browser-display__copy-target) {
		position: relative;
		display: inline-block;
		cursor: pointer;
		padding: 0 4px;
		background: rgba(0, 0, 0, 0.25);
		border-radius: 3px;
		border: 1px dashed rgba(91, 255, 187, 0.2);
	}

	:global(.browser-display__copy-target):hover {
		border-color: rgba(255, 214, 102, 0.4);
	}

	.browser-display__error {
		margin: 0 0 12px;
		padding: 7px;
		border: 1px solid rgba(255, 112, 112, 0.55);
		border-radius: 4px;
		background: rgba(61, 10, 10, 0.62);
		color: #ffd2d2;
		font-size: 12px;
	}

	@media (max-width: 720px) {
		.browser-display__panel {
			left: 10px;
			right: 10px;
			top: 10px;
			width: auto;
			max-height: calc(100vh - 20px);
		}

		.browser-display__panel--collapsed {
			left: auto;
			right: 10px;
			width: auto;
			max-height: none;
		}

		.browser-display__actions,
		.browser-display__toggles {
			grid-template-columns: 1fr;
		}

		.browser-display__status div {
			grid-template-columns: 1fr;
		}

		.browser-display__status-row--action dd {
			grid-template-columns: 1fr;
		}
	}
</style>
