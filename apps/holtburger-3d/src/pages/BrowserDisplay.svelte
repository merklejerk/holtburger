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
	import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../lib/landblocks";
	import { BrowserCameraController } from "../lib/camera/browser-camera-controller";
	import {
		createFreeCameraFrameStateCamera,
		createFreeCameraState,
		type FreeCameraState,
	} from "../lib/camera/free-camera";
	import { createBrowserRuntime } from "../lib/browser/create-browser-runtime";
	import { createBrowserStaticPickRay } from "../lib/browser/static-picking";
	import {
		createSceneInterestFromLocation,
		inferLandblockInputMode,
		isLandblockPrefixInput,
		parseLocationInput,
		type LandblockInputMode,
		type ParsedLocationInput,
	} from "../lib/browser/location-input";
	import { resolveBrowserFollowModeRebase } from "../lib/browser/follow-mode";
	import {
		DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH,
		MAX_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH,
		MIN_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH,
	} from "../lib/runtime/client-runtime";
	import type {
		ClientRuntime,
		ManualStaticDomain,
		PortalDebugOverlayMode,
		RuntimeCameraResidency,
		RuntimeEvent,
		RuntimeSceneInterestSource,
		RuntimeSnapshot,
	} from "../lib/runtime/client-runtime";
	import type {
		PortalFrameNodeResources,
		PortalFrameWorkPlan,
		RendererStaticLayerVisibility,
	} from "../lib/renderer/types";
	import type { EnvCellResourceMembership } from "../lib/runtime/env-cell-resource-membership";
	import type { RuntimePortalOverlapResidency } from "../lib/runtime/portal-base-overlap";
	import {
		describeStaticSceneSelectionKey,
		type StaticSceneSelectionKey,
	} from "../lib/runtime/static-scene-query";
	import type { TextureFilteringMode } from "../lib/textures/sampling-policy";
	import DiagnosticsModal from "../lib/ui/DiagnosticsModal.svelte";
	import PerformanceOverlay from "../lib/ui/PerformanceOverlay.svelte";
	import {
		PerformanceMetricsTracker,
		type PerformanceMetricsSnapshot,
	} from "../lib/ui/performance-metrics";

	type BrowserPanelTab = "navigate" | "settings" | "debug";
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
	let portalDebugOverlayMode = $state<PortalDebugOverlayMode>("both");
	let terrainRadius = $state(DEFAULT_TERRAIN_LOD_RADIUS);
	let buildingRadius = $state(DEFAULT_BUILDING_LOD_RADIUS);
	let detailRadius = $state(DEFAULT_DETAIL_LOD_RADIUS);
	let envCellRadius = $state(DEFAULT_ENV_CELL_LOD_RADIUS);
	let snapshot = $state<RuntimeSnapshot | null>(null);
	let cameraState = $state<FreeCameraState>(createFreeCameraState());
	let diagnosticsReportText = $state<string | null>(null);
	let selectedStaticDiagnosticsReportText = $state<string | null>(null);
	let selectedStaticSelectionKey = $state<StaticSceneSelectionKey | null>(null);
	let selectedStaticPickDistance = $state<number | null>(null);
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
	});
	const performanceMetricsTracker = new PerformanceMetricsTracker({
		emaAlpha: PERF_OVERLAY_EMA_ALPHA,
		sampleMs: PERF_OVERLAY_SAMPLE_MS,
	});
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
			runtime.setPortalDebugOverlayMode(portalDebugOverlayMode);
			cameraController = new BrowserCameraController({
				initialState: cameraState,
				onChange(nextCameraState) {
					cameraState = nextCameraState;
					if (nextCameraState.hasManualControl) {
						cancelPendingCameraFocus("manual-control");
					}
					pushCameraFrameState();
				},
			});
			const unsubscribeSnapshot = runtime.subscribe((nextSnapshot) => {
				snapshot = nextSnapshot;
				selectedTextureFilteringMode =
					nextSnapshot.renderPolicy.textureFilteringMode;
			});
			const unsubscribeFrameTelemetry = runtime.subscribeFrameTelemetry(
				(telemetry) => {
					performanceMetrics = performanceMetricsTracker.update(telemetry);
				},
			);
			const unsubscribeEvents = runtime.subscribeEvents(handleRuntimeEvent);
			pushCameraFrameState();
			const policySyncInterval = window.setInterval(() => {
				syncCameraPolicy();
			}, CAMERA_POLICY_SYNC_INTERVAL_MS);

			return () => {
				window.clearInterval(policySyncInterval);
				clearStaticInterestRefresh();
				unsubscribeSnapshot();
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
		clearStaticDebugSelection();
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
	}

	function handleStaticWorkSubmit(event: SubmitEvent): void {
		event.preventDefault();
		requestSceneInterest();
	}

	function clearSceneInterest(): void {
		clearStaticInterestRefresh();
		submittedStaticLocation = null;
		clearStaticDebugSelection();
		cancelPendingCameraFocus("idle");
		followModeEnabled = false;
		runtime?.updateSceneInterest({ kind: "none" });
	}

	function resetCamera(): void {
		cancelPendingCameraFocus("manual-control");
		cameraController?.reset();
	}

	function pushCameraFrameState(): void {
		if (!runtime) {
			return;
		}

		const camera =
			cameraController?.createFrameStateCamera() ??
			createFreeCameraFrameStateCamera(cameraState);
		runtime.updateFrameState({
			camera,
			timeSeconds: performance.now() / 1000,
		});
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
		if (!runtime || !selectedStaticSelectionKey) {
			return;
		}

		selectedStaticDiagnosticsReportText = JSON.stringify(
			runtime.createStaticSelectionDiagnosticsReport(
				selectedStaticSelectionKey,
				{
					pickDistance: selectedStaticPickDistance,
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
	}

	function handleEnvCellAabbDebugToggle(event: Event): void {
		envCellAabbDebugVisible = (event.currentTarget as HTMLInputElement).checked;
		runtime?.setEnvCellAabbDebugOverlayVisible(envCellAabbDebugVisible);
	}

	function handleEnvCellPortalDebugToggle(event: Event): void {
		envCellPortalDebugVisible = (event.currentTarget as HTMLInputElement)
			.checked;
		runtime?.setEnvCellPortalDebugOverlayVisible(envCellPortalDebugVisible);
	}

	function handleFlatVisionModeToggle(event: Event): void {
		flatVisionModeEnabled = (event.currentTarget as HTMLInputElement).checked;
		runtime?.setFlatVisionModeEnabled(flatVisionModeEnabled);
	}

	function handleDirectEnvCellPortalMaxDepthInput(event: Event): void {
		directEnvCellPortalMaxDepth = Number(
			(event.currentTarget as HTMLInputElement).value,
		);
		runtime?.setDirectEnvCellPortalMaxDepth(directEnvCellPortalMaxDepth);
	}

	function handlePortalDebugModeChange(event: Event): void {
		portalDebugOverlayMode = (event.currentTarget as HTMLSelectElement)
			.value as PortalDebugOverlayMode;
		runtime?.setPortalDebugOverlayMode(portalDebugOverlayMode);
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
		const hit = runtime?.pickStaticRay({
			context: { kind: "outdoor" },
			filters: { itemKinds: ["terrain-quad"] },
			ray: {
				direction: { x: 0, y: -1, z: 0 },
				origin: {
					x: options.x,
					y: options.bounds.max.y + options.clearance * 2,
					z: options.z,
				},
			},
		});

		return hit?.selectionKey.itemKind === "terrain-quad"
			? hit.hitPoint.y
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
			pushCameraFrameState();
		}

		return {
			...camera,
			position: rebase.cameraPosition,
		};
	}

	function formatCameraPosition(
		position: readonly [number, number, number],
	): string {
		return `${position[0].toFixed(1)}, ${position[1].toFixed(1)}, ${position[2].toFixed(1)}`;
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
			pickStaticAtPointer(event, pickCandidate.context);
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

	function pickStaticAtPointer(
		event: PointerEvent,
		contextLocation: ParsedLocationInput | null,
	): void {
		if (!runtime || !canvasElement || !contextLocation) {
			clearStaticDebugSelection();
			return;
		}

		const context =
			contextLocation.kind === "interior-cell"
				? {
						envCellId:
							snapshot?.currentCameraResidency.kind === "env-cell" &&
							snapshot.currentCameraResidency.landblockId ===
								contextLocation.landblockId
								? snapshot.currentCameraResidency.envCellId
								: contextLocation.envCellId,
						kind: "env-cell" as const,
						landblockId: contextLocation.landblockId,
					}
				: { kind: "outdoor" as const };
		const camera =
			cameraController?.createFrameStateCamera() ??
			createFreeCameraFrameStateCamera(cameraState);
		const viewport = canvasElement.getBoundingClientRect();
		const pickRequest = createBrowserStaticPickRay({
			camera,
			clientX: event.clientX,
			clientY: event.clientY,
			context,
			filters: { ignoreContainingOrigin: true },
			viewport,
		});
		const hit = runtime.pickStaticRay(pickRequest);
		selectedStaticSelectionKey = hit?.selectionKey ?? null;
		selectedStaticPickDistance = hit?.distance ?? null;
		selectedStaticDiagnosticsReportText = null;
		runtime.setStaticDebugSelection(selectedStaticSelectionKey);
	}

	function clearStaticDebugSelection(): void {
		selectedStaticSelectionKey = null;
		selectedStaticPickDistance = null;
		selectedStaticDiagnosticsReportText = null;
		runtime?.setStaticDebugSelection(null);
	}

	function formatStaticPickSummary(
		selectionKey: StaticSceneSelectionKey | null,
		distance: number | null,
	): string {
		if (!selectionKey) {
			return "none";
		}

		const distanceText = distance === null ? "" : ` d=${distance.toFixed(2)}`;
		return `${describeStaticSceneSelectionKey(selectionKey)}${distanceText}`;
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

	function formatPortalBaseCompositionDiagnostics(
		snapshot: RuntimeSnapshot,
	): string {
		const plan = snapshot.portalFrameWorkPlan;
		const renderer = snapshot.renderer;
		const targets = renderer.sceneDomainTargets;
		const overlap = snapshot.currentPortalOverlapResidency;
		const overlapDiagnostics = overlap.diagnostics;
		if (plan.kind !== "direct-env-cell" || plan.mode !== "portal-projection") {
			return `plan=${plan.kind} residency=${formatCameraResidency(snapshot.currentCameraResidency)} source=${targets.outdoorCrossingSource} colorBase=${targets.envCellOutdoorCrossingColorBase} directDraws=${renderer.directEnvCellDrawCalls}`;
		}
		const graph = plan.layeredGraph;
		const base =
			graph.baseEntry.scene.kind === "outdoor-target"
				? `outdoor:${formatHexId(graph.baseEntry.scene.landblockId)}`
				: `env:${formatHexId(graph.baseEntry.scene.envCellId)}`;
		const baseResources =
			"resources" in graph.baseEntry
				? formatPortalResourceCounts(graph.baseEntry.resources)
				: "none";
		const overlapCells =
			plan.baseOverlap.envCells
				.map(
					(envCell) =>
						`${formatHexId(envCell.envCellId)}:${formatPortalResourceCounts(envCell.resources)}:${envCell.reasons.map((reason) => reason.kind).join("+") || "unknown"}`,
				)
				.join(",") || "none";
		const renderEntries =
			graph.renderEntries
				.map(
					(entry) =>
						`${formatHexId(entry.envCellId)}@${entry.renderLayer}:${formatPortalResourceCounts(entry.resources)}:m${entry.incomingMaskEdgeIds.length}`,
				)
				.join(",") || "none";
		const outdoorCrossings =
			graph.outdoorCrossings
				.map(
					(crossing) =>
						`${crossing.crossingId}->${formatHexId(crossing.targetEnvCellId)}`,
				)
				.join(",") || "none";
		return `residency=${formatCameraResidency(snapshot.currentCameraResidency)} base=${base} source=${targets.outdoorCrossingSource} colorBase=${targets.envCellOutdoorCrossingColorBase} directDraws=${renderer.directEnvCellDrawCalls} exteriorDraws=${targets.exteriorDrawCalls} suffix=${targets.exteriorSuffixCompositePasses}/${targets.exteriorSuffixCompositeDepth} baseRes=${baseResources} overlapReqExterior=${plan.baseOverlap.requiresExteriorSeed} overlapCells=${overlapCells} renderEntries=${renderEntries} outdoorCrossings=${outdoorCrossings} masks=${graph.maskEdges.length} overlapRuntime=${overlap.kind}:${overlap.baseOverlapEnvCellIds.map(formatHexId).join(",") || "none"} primary=${overlapDiagnostics.primaryAcceptedBoundaryCount}/${overlapDiagnostics.primaryCandidateCount} oneHop=${overlapDiagnostics.oneHopAcceptedBoundaryCount}/${overlapDiagnostics.oneHopCandidateCount}`;
	}

	function formatPortalResourceCounts(
		resources: PortalFrameNodeResources,
	): string {
		return `${resources.resourceState}:${resources.structuredInteriorDrawUnitIds.length}cell/${resources.envCellStaticObjectDrawUnitIds.length}static`;
	}

	function currentCameraEnvCellResourceTarget(): {
		readonly envCellId: number;
		readonly landblockId: number;
	} | null {
		if (snapshot?.currentCameraResidency.kind !== "env-cell") {
			return null;
		}
		return {
			envCellId: snapshot.currentCameraResidency.envCellId,
			landblockId: snapshot.currentCameraResidency.landblockId,
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
	<canvas bind:this={canvasElement} class="browser-display__canvas"></canvas>

	<PerformanceOverlay metrics={performanceMetrics} />

	<aside
		class:browser-display__panel--collapsed={panelCollapsed}
		class="browser-display__panel"
		aria-label="Browser runtime controls"
	>
		<div class="browser-display__panel-bar">
			{#if !panelCollapsed}
				<header>
					<p class="kicker">Browser</p>
					<h1>Runtime Harness</h1>
				</header>
			{/if}

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
						<label class="browser-display__field">
							<span>Location</span>
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

						<dl class="browser-display__status">
							<div>
								<dt>Parsed</dt>
								<dd>{parsedLocation?.label ?? "invalid"}</dd>
							</div>
							<div>
								<dt>Mode</dt>
								<dd>
									{parsedLocation?.kind === "interior-cell"
										? "interior cell"
										: parsedLocation?.kind === "outdoor-landblock"
											? "outdoor landblock"
											: "unknown"}
								</dd>
							</div>
							<div>
								<dt>Scene interest</dt>
								<dd>
									{#if snapshot?.sceneInterest.kind === "outdoor-anchor"}
										{formatHexId(snapshot.sceneInterest.anchorLandblockId)}
										({snapshot.sceneInterest.domains.join(", ") || "none"}) [{snapshot
											.sceneInterest.source}]
									{:else if snapshot?.sceneInterest.kind === "interior-cell"}
										{formatHexId(snapshot.sceneInterest.landblockId)}
										/ {formatHexId(snapshot.sceneInterest.envCellId)}
										[{snapshot.sceneInterest.source}]
									{:else}
										none
									{/if}
								</dd>
							</div>
							<div>
								<dt>Camera focus</dt>
								<dd>{formatCameraFocusStatus()}</dd>
							</div>
						</dl>

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
						<small>{snapshot?.debugOverlays.envCellAabbCount ?? 0}</small>
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
							{snapshot?.debugOverlays.portalCount ?? 0}
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
							{snapshot?.debugOverlays.flatVisionModeEnabled ? "on" : "off"}
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
					<label class="browser-display__field">
						<span>Portal overlay</span>
						<select
							bind:value={portalDebugOverlayMode}
							disabled={!runtime}
							onchange={handlePortalDebugModeChange}
						>
							<option value="both">Both directions</option>
							<option value="outdoor-to-indoor">Outdoor to indoor</option>
							<option value="indoor-to-outdoor">Indoor to outdoor</option>
						</select>
					</label>

					<dl class="browser-display__status">
						<div>
							<dt>Filtering</dt>
							<dd>
								{snapshot?.renderPolicy.textureFilteringMode ?? "starting"}
							</dd>
						</div>
						<div>
							<dt>Static</dt>
							<dd>
								{#if snapshot}
									r{snapshot.static.revision} req {snapshot.static.requested} res
									{snapshot.static.resolving} bake {snapshot.static.baking} commit
									{snapshot.static.committed}
								{:else}
									pending
								{/if}
							</dd>
						</div>
						<div>
							<dt>Status</dt>
							<dd>{snapshot?.status ?? "starting"}</dd>
						</div>
						<div>
							<dt>Scene query</dt>
							<dd>
								{#if snapshot}
									out {snapshot.staticSceneQuery.outdoorRecordCount} env
									{snapshot.staticSceneQuery.envCellRecordCount} lb
									{snapshot.staticSceneQuery.envCellLandblockCount}
								{:else}
									pending
								{/if}
							</dd>
						</div>
						<div class="browser-display__status-row--action">
							<dt>Selected static</dt>
							<dd>
								<span>
									{formatStaticPickSummary(
										selectedStaticSelectionKey,
										selectedStaticPickDistance,
									)}
								</span>
								<button
									disabled={!selectedStaticSelectionKey}
									type="button"
									onclick={openSelectedStaticDiagnosticsReport}
								>
									Inspect
								</button>
							</dd>
						</div>
						<div>
							<dt>Host</dt>
							<dd>{snapshot?.host.isAvailable ? "tauri" : "unavailable"}</dd>
						</div>
						<div>
							<dt>Assets</dt>
							<dd>
								{#if snapshot}
									p{snapshot.assets.pending.length} c{snapshot.assets.committed
										.length}
								{:else}
									pending
								{/if}
							</dd>
						</div>
						<div>
							<dt>Renderer</dt>
							<dd>{snapshot?.renderer.backend ?? "none"}</dd>
						</div>
						<div>
							<dt>Terrain payload</dt>
							<dd>
								{#if snapshot?.static.latestTerrainPayload}
									lb {snapshot.static.latestTerrainPayload.landblockId
										.toString(16)
										.padStart(8, "0")} region
									{snapshot.static.latestTerrainPayload.regionNumber} mesh
									{snapshot.static.latestTerrainPayload.vertexCount}v/{snapshot
										.static.latestTerrainPayload.triangleCount}t tex
									{snapshot.static.latestTerrainPayload.textureUseCount} missing
									{snapshot.static.latestTerrainPayload.missingRefCount}
								{:else}
									none
								{/if}
							</dd>
						</div>
						<div>
							<dt>Env-cell payload</dt>
							<dd>
								{#if snapshot?.static.latestLandblockEnvCellsPayload}
									lb {snapshot.static.latestLandblockEnvCellsPayload.landblockId
										.toString(16)
										.padStart(8, "0")}
									cells
									{snapshot.static.latestLandblockEnvCellsPayload.envCellCount}
									accepted
									{snapshot.static.latestLandblockEnvCellsPayload
										.acceptedEnvCellCount} visible
									{snapshot.static.latestLandblockEnvCellsPayload
										.visibleCellCount} portals
									{snapshot.static.latestLandblockEnvCellsPayload.portalCount}
									links
									{snapshot.static.latestLandblockEnvCellsPayload
										.portalLinkCount}
									seeds
									{snapshot.static.latestLandblockEnvCellsPayload
										.staticObjectSeedCount} missing
									{snapshot.static.latestLandblockEnvCellsPayload
										.missingRefCount}
								{:else}
									none
								{/if}
							</dd>
						</div>
						<div>
							<dt>Camera</dt>
							<dd>
								{formatCameraPosition(cameraState.position)} yaw
								{cameraState.yawRadians.toFixed(2)} pitch
								{cameraState.pitchRadians.toFixed(2)}
							</dd>
						</div>
						<div>
							<dt>Camera residency</dt>
							<dd>
								{snapshot
									? formatCameraResidency(snapshot.currentCameraResidency)
									: "pending"}
							</dd>
						</div>
						<div>
							<dt>Camera env resources</dt>
							<dd>
								{snapshot
									? formatEnvCellResourceMembership(
											currentCameraEnvCellResourceTarget(),
										)
									: "pending"}
							</dd>
						</div>
						<div>
							<dt>Portal frame</dt>
							<dd>
								{snapshot
									? formatPortalFrameWorkPlan(snapshot.portalFrameWorkPlan)
									: "pending"}
							</dd>
						</div>
						<div>
							<dt>Portal overlap</dt>
							<dd>
								{snapshot
									? formatPortalOverlapResidency(
											snapshot.currentPortalOverlapResidency,
										)
									: "pending"}
							</dd>
						</div>
						<div>
							<dt>Portal base composition</dt>
							<dd>
								{snapshot
									? formatPortalBaseCompositionDiagnostics(snapshot)
									: "pending"}
							</dd>
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
								<span>
									{formatEnvCellResourceMembership(
										envCellResourceInspectionTarget,
									)}
								</span>
							</dd>
						</div>
						<div>
							<dt>Camera focus</dt>
							<dd>{formatCameraFocusStatus()}</dd>
						</div>
						<div>
							<dt>Draw units</dt>
							<dd>
								{snapshot
									? `${snapshot.renderer.staticDrawUnits} static / ${snapshot.renderer.terrainDrawUnits} terrain`
									: "pending"}
							</dd>
						</div>
						<div>
							<dt>Direct env draws</dt>
							<dd>{snapshot?.renderer.directEnvCellDrawCalls ?? 0}</dd>
						</div>
						<div>
							<dt>Triangles</dt>
							<dd>{snapshot?.renderer.renderedTriangles ?? 0}</dd>
						</div>
						<div>
							<dt>Canvas</dt>
							<dd>
								{snapshot
									? `${snapshot.renderer.canvasWidth}x${snapshot.renderer.canvasHeight}`
									: "pending"}
							</dd>
						</div>
						<div>
							<dt>Frame handler</dt>
							<dd>
								{performanceMetrics.handlerMs > 0
									? `${performanceMetrics.handlerMs.toFixed(2)} ms`
									: "pending"}
							</dd>
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
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 10px;
	}

	.browser-display__panel--collapsed .browser-display__panel-bar {
		margin-bottom: 0;
	}

	.browser-display__panel header {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.kicker {
		margin: 0;
		color: #75ffd1;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0;
	}

	h1 {
		margin: 0;
		color: #f1fff6;
		font-size: 16px;
		font-weight: 700;
		letter-spacing: 0;
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
	}

	.browser-display__status-row--action dd {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 6px;
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
