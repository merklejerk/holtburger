<script lang="ts">
	import { onDestroy, onMount, tick } from "svelte";
	import { get } from "svelte/store";

	import { frontendState, type FrontendAppState } from "../app/frontend-state";
	import {
		describeBrowserDestinationIdentity,
		type BrowserLocationSelection,
	} from "../app/browser-mode";
	import type { AssetChannelState } from "../lib/assets/types";
	import type { CameraHintAckDto, CameraHintDto } from "../lib/host/contracts";
	import { submitCameraHint } from "../lib/host/tauri";
	import {
		buildCameraHintFromSceneCameraFrame,
		buildBrowserFreeCameraFrame,
		convertBrowserFreeCameraStateBetweenAnchors,
		createBrowserFreeCameraState,
		fitBrowserFreeCameraToBounds,
		getBrowserFreeCameraKeyboardMoveSpeedMultiplier,
		getBrowserFreeCameraSpeedMultiplier,
		moveBrowserFreeCameraLocalUpByWheel,
		moveBrowserFreeCameraLocal,
		panBrowserFreeCamera,
		prepareBrowserFreeCameraForDestinationFit,
		rotateBrowserFreeCamera,
		rotateBrowserFreeCameraAroundLocalUp,
		type BrowserFreeCameraState,
		type SceneCameraFrame,
		describeSceneCameraFrame,
	} from "../lib/world-display/camera";
	import WorldDisplay from "../lib/world-display/WorldDisplay.svelte";
	import {
		describeCameraHintAck,
		normalizeViewportPoint,
		shouldSendThrottledCameraHint,
		type NormalizedViewportPoint,
	} from "../lib/world-display/model";
	import type {
		BrowserCameraResidency,
		WorldRenderMetrics,
	} from "../lib/world-display/renderer-contract";
	import { isPreparedGfxObjAsset } from "../lib/world-display/static-renderables";
	import { formatHex32 } from "../lib/landblocks";
	import {
		countPreparedAssetsByKind,
		formatPreparedAssetKindCounts,
	} from "../lib/assets/asset-cache-diagnostics";
	import { describeMaterialAssetDiagnostics } from "../lib/assets/material-diagnostics";
	import type { RenderSpatialMetadata } from "../lib/world-display/render-spatial-index";
	import {
		commitRenderAnchorCandidate,
		deriveRenderAnchorCandidate,
		type RenderAnchorSource,
	} from "../lib/world-display/render-anchor";
	import { DEBUG_OVERLAY_SPATIAL_OWNER_KEY } from "../lib/world-display/render-spatial-scene";
	import {
		convertCameraFrameBetweenAnchors,
		type RenderLandblockAnchor,
	} from "../lib/world-display/render-chunks";
	import {
		BrowserRenderResourceCoordinator,
		createEmptyBrowserRenderResourceSnapshot,
		type BrowserRenderResourceCoordinatorInput,
		type BrowserRenderResourceSnapshot,
	} from "../lib/world-display/browser-render-resource-coordinator";
	import BrowserModePanel from "./BrowserModePanel.svelte";

	interface BrowserPanelRow {
		label: string;
		value: string;
	}

	interface BrowserPanelSection {
		title: string;
		rows: BrowserPanelRow[];
	}

	interface BrowserInspectorModel {
		title: string;
		kicker: string;
		rows: BrowserPanelRow[];
	}

	const initialFrontendState = get(frontendState);
	let assetState: AssetChannelState = initialFrontendState.asset;
	let browserDestination = $state<BrowserLocationSelection | null>(
		initialFrontendState.browserMode.destination,
	);
	let terrainLodRadius = $state(
		initialFrontendState.browserMode.terrainLodRadius,
	);
	let buildingLodRadius = $state(
		initialFrontendState.browserMode.buildingLodRadius,
	);
	let detailLodRadius = $state(
		initialFrontendState.browserMode.detailLodRadius,
	);
	let envCellLodRadius = $state(
		initialFrontendState.browserMode.envCellLodRadius,
	);
	let transitionPortalMaxDepth = $state(
		initialFrontendState.browserMode.transitionPortalMaxDepth,
	);
	let showPortalPolygons = $state(
		initialFrontendState.browserMode.showPortalPolygons,
	);
	let showCellIndicators = $state(
		initialFrontendState.browserMode.showCellIndicators,
	);
	let highlightPortalTargets = $state(
		initialFrontendState.browserMode.highlightPortalTargets,
	);
	let renderStyle = $state(initialFrontendState.browserMode.renderStyle);
	let navigationFocusMode = $state(
		initialFrontendState.browserMode.navigationFocusMode,
	);

	let rootElement = $state<HTMLDivElement | null>(null);
	let worldDisplaySurface = $state<WorldDisplay | null>(null);
	const renderResourceCoordinator = new BrowserRenderResourceCoordinator();
	let renderResourceSnapshot = $state<BrowserRenderResourceSnapshot>(
		createEmptyBrowserRenderResourceSnapshot(),
	);
	let renderMetrics = $state<WorldRenderMetrics | null>(null);
	let rendererCameraResidency = $state<BrowserCameraResidency | null>(null);
	let browserCameraState = $state<BrowserFreeCameraState>(
		createBrowserFreeCameraState(),
	);
	let browserCameraFrame = $state<SceneCameraFrame | null>(null);
	let cameraAck = $state<CameraHintAckDto | null>(null);
	let diagnosticSelection = $state<RenderSpatialMetadata | null>(null);
	let lastCameraHintAt = $state<number | null>(null);
	let trailingCameraHint = $state<CameraHintDto | null>(null);
	let activePointerDrag = $state<{
		pointerId: number;
		lastX: number;
		lastY: number;
		mode: "orbit" | "pan";
		moved: boolean;
	} | null>(null);
	let activeRenderAnchor = $state<RenderLandblockAnchor | null>(null);
	let activeRenderAnchorSource = $state<RenderAnchorSource | null>(null);
	let renderMetricsEventCount = $state(0);
	let cameraFrameApplyCount = $state(0);
	let pointerInputEventCount = $state(0);
	let keyboardInputEventCount = $state(0);
	let suppressNextBrowserClick = false;
	let cameraHintTimer: ReturnType<typeof setTimeout> | null = null;
	let renderResourceUpdateTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingRenderResourceInput: BrowserRenderResourceCoordinatorInput | null =
		null;
	let cameraMovementFrameId: number | null = null;
	let lastCameraMovementFrameAt: number | null = null;
	let keyboardLinearMovementStartedAt: number | null = null;
	let isCameraSlowModifierActive = false;
	const pressedCameraControlKeys = new Set<string>();
	let lastAppliedFollowResidencyKey: string | null = null;
	let lastManualFitDestinationIdentity: string | null = null;
	let debugSummaryTimer: ReturnType<typeof setTimeout> | null = null;
	let assetSummaryText = $state("Waiting for asset activity.");
	let assetDebugText = $state("Waiting for asset activity.");
	let assetPipelineDebugText = $state("Waiting for asset activity.");
	let assetCacheDebugText = $state("Waiting for asset cache activity.");
	let assetMaterialDebugText = $state("Waiting for material asset activity.");

	const CAMERA_HINT_INTERVAL_MS = 250;
	const DEBUG_SUMMARY_DEBOUNCE_MS = 500;
	const pendingCameraHint = $derived(trailingCameraHint !== null);
	const worldDisplay = $derived(renderResourceSnapshot.worldDisplay);
	const sceneGeometryText = $derived(renderResourceSnapshot.sceneGeometryText);
	const terrainHeightText = $derived(renderResourceSnapshot.terrainHeightText);
	const staticRenderableText = $derived(
		renderResourceSnapshot.staticRenderableText,
	);
	const structuredInteriorText = $derived(
		renderResourceSnapshot.structuredInteriorText,
	);
	const cellIndicatorText = $derived(renderResourceSnapshot.cellIndicatorText);
	const portalDiagnosticsText = $derived(
		renderResourceSnapshot.portalDiagnosticsText,
	);
	const portalRenderText = $derived.by(() => {
		const metrics = renderMetrics?.portal;
		if (!metrics) {
			return "Portal stencil metrics are waiting for the first rendered frame.";
		}
		const skipped =
			metrics.skippedMissingApertureCount +
			metrics.skippedMissingPolygonCount +
			metrics.skippedOutsideFrustumCount +
			metrics.skippedBackFacingCount +
			metrics.skippedTooSmallCount;
		const visibleArea =
			metrics.minVisibleScreenAreaPx === null ||
			metrics.maxVisibleScreenAreaPx === null
				? "visible area n/a"
				: `visible area ${metrics.minVisibleScreenAreaPx.toFixed(1)}-${metrics.maxVisibleScreenAreaPx.toFixed(1)}px`;
		return `${metrics.visiblePortalWorkItemCount}/${metrics.renderWorkItemCandidateCount} portal work item${metrics.renderWorkItemCandidateCount === 1 ? "" : "s"} visible; ${metrics.topologyOutdoorPortalCount} topology portal${metrics.topologyOutdoorPortalCount === 1 ? "" : "s"}, ${metrics.apertureCandidateCount} aperture candidate${metrics.apertureCandidateCount === 1 ? "" : "s"}; ${metrics.maskedInteriorCellCount} masked env cell${metrics.maskedInteriorCellCount === 1 ? "" : "s"}; ${skipped} skipped; area buckets <16 ${metrics.screenAreaBuckets.lt16}, <64 ${metrics.screenAreaBuckets.lt64}, <256 ${metrics.screenAreaBuckets.lt256}, >=256 ${metrics.screenAreaBuckets.gte256}; ${visibleArea}.`;
	});
	const sceneBoundsText = $derived(
		renderMetrics?.bounds
			? `Center (${renderMetrics.bounds.center.x.toFixed(1)}, ${renderMetrics.bounds.center.y.toFixed(1)}, ${renderMetrics.bounds.center.z.toFixed(1)}) span (${renderMetrics.bounds.size.x.toFixed(1)}, ${renderMetrics.bounds.size.y.toFixed(1)}, ${renderMetrics.bounds.size.z.toFixed(1)}).`
			: "Scene bounds are unavailable until terrain is framed.",
	);
	const renderPerformanceText = $derived(
		renderMetrics?.performance
			? `${renderMetrics.performance.fps.toFixed(1)} FPS, ${renderMetrics.performance.frameMs.toFixed(1)} ms/frame, ${renderMetrics.performance.renderMs.toFixed(1)} ms render.`
			: "Waiting for render performance sample.",
	);
	const rendererDiagnosticsText = $derived.by(() => {
		const debug = renderMetrics?.debug;
		if (!debug) {
			return "Renderer diagnostics are waiting for the first rendered frame.";
		}
		return `Policy ${debug.renderGraphPolicy}, base ${debug.renderGraphBaseScene}, transition depth ${debug.transitionPortalMaxDepth}; passes ${debug.renderPassCount}, calls ${debug.renderCalls}, tris ${debug.renderTriangles}; portal work ${debug.portalRenderWorkItemCount}, masks ${debug.transitionApertureMaskPassCount}, depth resets ${debug.apertureDepthResetPassCount}, composites interior ${debug.interiorCompositePassCount}/exterior ${debug.exteriorCompositePassCount}; terrain ${debug.visibleTerrainMeshCount}/${debug.terrainMeshCount}, static ${debug.visibleStaticGroupMeshCount}/${debug.staticGroupMeshCount}, interiors ${debug.visibleStructuredInteriorMeshCount}/${debug.structuredInteriorMeshCount}, overlays ${debug.visibleDebugOverlayObjectCount}/${debug.debugOverlayObjectCount}; portals ${debug.portalApertureMeshCount}/${debug.transitionPortalCandidateCount}; residency ${debug.cameraViewResidency} via ${debug.residencySource} (${debug.residencyCellCount} cells, ${debug.residencyLandblockCount} landblocks, ${debug.residencyAabbCandidateCount} AABB candidates, ${debug.residencyCellBspMatchCount} CellBSP matches, ${debug.residencyAabbFallbackCount} AABB fallbacks); canvas ${debug.canvasWidth}x${debug.canvasHeight} @${debug.pixelRatio.toFixed(2)}.`;
	});
	const sceneContextText = $derived(renderResourceSnapshot.sceneContextText);
	const cameraResidencyText = $derived.by(() => {
		if (!rendererCameraResidency) {
			return "Waiting for renderer residency.";
		}
		return describeBrowserCameraResidency(rendererCameraResidency);
	});
	const navigationFocusText = $derived(
		navigationFocusMode === "follow-camera" ? "Follow camera" : "Manual",
	);
	const destinationSourceText = $derived(
		describeBrowserDestinationSource(browserDestination),
	);
	const renderGraphText = $derived.by(() => {
		const debug = renderMetrics?.debug;
		if (!debug) {
			return "Waiting for render graph.";
		}
		return `${debug.renderGraphBaseScene} base, transition depth ${debug.transitionPortalMaxDepth}`;
	});
	const landblockVisibilityText = $derived(
		renderResourceSnapshot.landblockVisibilityText,
	);
	const cellVisibilityText = $derived.by(() => {
		const debug = renderMetrics?.debug;
		if (!debug) {
			return renderResourceSnapshot.cellVisibilityFallbackText;
		}
		return `${debug.visibleStructuredInteriorMeshCount}/${debug.structuredInteriorMeshCount} rendered mesh${debug.structuredInteriorMeshCount === 1 ? "" : "es"}; ${renderResourceSnapshot.cellVisibilityFallbackText}`;
	});
	const portalRenderSummaryText = $derived.by(() => {
		const metrics = renderMetrics?.portal;
		if (!metrics) {
			return "Waiting for portal metrics.";
		}
		return `${metrics.visiblePortalWorkItemCount}/${metrics.renderWorkItemCandidateCount} visible work item${metrics.renderWorkItemCandidateCount === 1 ? "" : "s"}; ${metrics.maskedInteriorCellCount} masked cell${metrics.maskedInteriorCellCount === 1 ? "" : "s"}.`;
	});
	const rendererSummaryText = $derived.by(() => {
		const debug = renderMetrics?.debug;
		if (!debug) {
			return "Waiting for renderer metrics.";
		}
		return `${debug.renderPassCount} pass${debug.renderPassCount === 1 ? "" : "es"}, ${debug.renderCalls} call${debug.renderCalls === 1 ? "" : "s"}, ${debug.renderTriangles} tris.`;
	});
	const cameraFrameText = $derived(
		browserCameraFrame
			? `${describeSceneCameraFrame(browserCameraFrame)} ${describeBrowserCameraControlMode()}`
			: "Camera frame is waiting for terrain.",
	);
	const cameraPipelineDebugText = $derived(describeCameraPipelineDebugState());
	const diagnosticInspector = $derived(
		deriveDiagnosticInspector(diagnosticSelection),
	);

	onMount(() => {
		const unsubscribeFrontendState =
			frontendState.subscribe(applyFrontendState);
		void tick().then(() => {
			renderResourceCoordinator.setSurface(worldDisplaySurface);
			scheduleCurrentSceneResourceUpdate();
		});

		return () => {
			unsubscribeFrontendState();
			renderResourceCoordinator.setSurface(null);
		};
	});
	const sceneStatusText = $derived(renderResourceSnapshot.sceneStatusText);
	const browserPanelSceneRows = $derived<BrowserPanelRow[]>([
		{ label: "Mode", value: sceneContextText },
		{ label: "Navigation", value: navigationFocusText },
		{ label: "Destination", value: worldDisplay.destinationFocusLabel },
		{ label: "Destination source", value: destinationSourceText },
		{ label: "Camera residency", value: cameraResidencyText },
		{ label: "Base scene", value: renderGraphText },
		{ label: "Landblocks", value: landblockVisibilityText },
		{ label: "Cells", value: cellVisibilityText },
	]);
	const browserPanelSceneDetailSections = $derived<BrowserPanelSection[]>([
		{
			title: "Geometry",
			rows: [
				{ label: "Terrain", value: renderResourceSnapshot.terrainCacheText },
				{
					label: "Source",
					value: renderResourceSnapshot.terrainDataSourceText,
				},
				{ label: "Meshes", value: sceneGeometryText },
				{ label: "Statics", value: staticRenderableText },
				{ label: "Heights", value: terrainHeightText },
				{ label: "Bounds", value: sceneBoundsText },
			],
		},
		{
			title: "Interior Cells",
			rows: [
				{ label: "Visibility", value: structuredInteriorText },
				{ label: "Rendered", value: cellVisibilityText },
				{ label: "Debug overlay", value: cellIndicatorText },
			],
		},
		{
			title: "Portals",
			rows: [
				{ label: "Rendering", value: portalRenderSummaryText },
				{ label: "Overlay", value: portalDiagnosticsText },
				{ label: "Stencil", value: portalRenderText },
			],
		},
	]);
	const browserPanelDebugRows = $derived<BrowserPanelRow[]>([
		{ label: "Camera", value: cameraFrameText },
		{ label: "Renderer", value: rendererSummaryText },
		{ label: "Assets", value: assetSummaryText },
	]);
	const browserPanelDebugDetailSections = $derived<BrowserPanelSection[]>([
		{
			title: "Input And Camera",
			rows: [
				{
					label: "Camera hint",
					value:
						describeCameraHintAck(cameraAck) ??
						"Waiting for the first world-display camera hint acknowledgement.",
				},
				{ label: "Events", value: cameraPipelineDebugText },
			],
		},
		{
			title: "Asset Pipeline",
			rows: [
				{ label: "Active", value: assetDebugText },
				{ label: "Pipeline", value: assetPipelineDebugText },
				{ label: "Materials", value: assetMaterialDebugText },
				{ label: "Cache", value: assetCacheDebugText },
				{
					label: "Layers",
					value: renderResourceSnapshot.staticRenderableLayerText,
				},
			],
		},
		{
			title: "Render Pipeline",
			rows: [
				{ label: "Renderer", value: rendererDiagnosticsText },
				{ label: "Stencil", value: portalRenderText },
			],
		},
	]);

	// Browser free-camera controls are a navigation policy, not the future client camera.
	function handleRenderMetricsChange(metrics: WorldRenderMetrics): void {
		renderMetricsEventCount += 1;
		renderMetrics = metrics;

		if (
			metrics.bounds &&
			!browserCameraState.hasManualControl &&
			browserCameraState.lastFitKey === null
		) {
			const fitKey = [
				metrics.bounds.center.x.toFixed(2),
				metrics.bounds.center.y.toFixed(2),
				metrics.bounds.center.z.toFixed(2),
				metrics.bounds.size.x.toFixed(2),
				metrics.bounds.size.y.toFixed(2),
				metrics.bounds.size.z.toFixed(2),
				metrics.geometry.terrainTileCount,
				metrics.geometry.staticRenderablePartCount,
			].join(":");
			browserCameraState = fitBrowserFreeCameraToBounds(
				browserCameraState,
				metrics.bounds,
				fitKey,
				{ force: false, aspect: metrics.cameraFrame?.aspect },
			);
			applyBrowserCameraFrame({ normalizedX: 0.5, normalizedY: 0.5 }, false);
			return;
		}

		if (!browserCameraFrame && metrics.cameraFrame) {
			browserCameraFrame = metrics.cameraFrame;
			syncControlledCameraFrame();
			scheduleRenderedCameraHint({ normalizedX: 0.5, normalizedY: 0.5 }, true);
		}
	}

	function handleRendererCameraFrameChange(
		cameraFrame: SceneCameraFrame,
	): void {
		if (!browserCameraFrame) {
			browserCameraFrame = cameraFrame;
			syncControlledCameraFrame();
			scheduleRenderedCameraHint({ normalizedX: 0.5, normalizedY: 0.5 }, true);
		}
	}

	function handleRendererCameraResidencyChange(
		residency: BrowserCameraResidency,
	): void {
		rendererCameraResidency = residency;
		applyFollowResidencyDestination();
	}

	function applyFrontendState(state: FrontendAppState): void {
		assetState = state.asset;
		browserDestination = state.browserMode.destination;
		terrainLodRadius = state.browserMode.terrainLodRadius;
		buildingLodRadius = state.browserMode.buildingLodRadius;
		detailLodRadius = state.browserMode.detailLodRadius;
		envCellLodRadius = state.browserMode.envCellLodRadius;
		transitionPortalMaxDepth = state.browserMode.transitionPortalMaxDepth;
		showPortalPolygons = state.browserMode.showPortalPolygons;
		showCellIndicators = state.browserMode.showCellIndicators;
		highlightPortalTargets = state.browserMode.highlightPortalTargets;
		renderStyle = state.browserMode.renderStyle;
		navigationFocusMode = state.browserMode.navigationFocusMode;

		const browserDestinationIdentity =
			describeBrowserDestinationIdentity(browserDestination);
		commitRenderAnchorForDestination(browserDestination);
		resetManualInteriorCameraIfNeeded(browserDestinationIdentity);
		applyFollowResidencyDestination();
		scheduleAssetDebugSummaryUpdate();
		scheduleCurrentSceneResourceUpdate();
	}

	function commitRenderAnchorForDestination(
		destination: BrowserLocationSelection | null,
	): void {
		const previousAnchor = activeRenderAnchor;
		const commit = commitRenderAnchorCandidate(
			activeRenderAnchor,
			deriveRenderAnchorCandidate(destination),
		);
		activeRenderAnchor = commit.anchor;
		activeRenderAnchorSource = commit.source;

		if (
			!commit.committed ||
			previousAnchor === null ||
			commit.anchor === null ||
			previousAnchor.landblockId === commit.anchor.landblockId
		) {
			return;
		}

		rebaseBrowserCameraBetweenAnchors(
			previousAnchor.landblockId,
			commit.anchor.landblockId,
		);
	}

	function resetManualInteriorCameraIfNeeded(
		browserDestinationIdentity: string | null,
	): void {
		if (navigationFocusMode !== "manual") {
			lastManualFitDestinationIdentity = browserDestinationIdentity;
			return;
		}

		if (browserDestination?.kind !== "interior-cell") {
			lastManualFitDestinationIdentity = browserDestinationIdentity;
			return;
		}

		if (
			browserDestinationIdentity === null ||
			browserDestinationIdentity === lastManualFitDestinationIdentity
		) {
			return;
		}

		lastManualFitDestinationIdentity = browserDestinationIdentity;
		browserCameraState =
			prepareBrowserFreeCameraForDestinationFit(browserCameraState);
		browserCameraFrame = null;
		activePointerDrag = null;
		suppressNextBrowserClick = false;
		stopCameraMovement();
	}

	function applyFollowResidencyDestination(): void {
		if (navigationFocusMode !== "follow-camera") {
			lastAppliedFollowResidencyKey = null;
			return;
		}

		const residencyKey = describeFollowResidencyKey(rendererCameraResidency);
		if (
			residencyKey === null ||
			residencyKey === lastAppliedFollowResidencyKey
		) {
			return;
		}

		lastAppliedFollowResidencyKey = residencyKey;
		frontendState.applyBrowserCameraResidencyDestination(
			rendererCameraResidency!,
		);
	}

	function scheduleCurrentSceneResourceUpdate(): void {
		scheduleSceneResourceUpdate({
			assetState,
			browserDestination,
			terrainLodRadius,
			buildingLodRadius,
			detailLodRadius,
			envCellLodRadius,
			transitionPortalMaxDepth,
			renderStyle,
			showPortalPolygons,
			showCellIndicators,
			highlightPortalTargets,
			diagnosticSelection,
			activeRenderAnchor,
			browserCameraFrame,
			cameraAck,
			pendingCameraHint,
		});
	}

	function syncControlledCameraFrame(): void {
		renderResourceCoordinator.updateControlledCameraFrame(browserCameraFrame);
	}

	function scheduleAssetDebugSummaryUpdate(): void {
		if (debugSummaryTimer) {
			clearTimeout(debugSummaryTimer);
		}

		debugSummaryTimer = setTimeout(() => {
			assetSummaryText = describeAssetSummaryState();
			assetDebugText = describeAssetDebugState();
			assetPipelineDebugText = describeAssetPipelineDebugState();
			assetMaterialDebugText = describeMaterialAssetDiagnostics({
				assetState,
				browserDestination,
				options: {
					terrainRadius: terrainLodRadius,
					buildingRadius: buildingLodRadius,
					detailRadius: detailLodRadius,
					envCellRadius: envCellLodRadius,
				},
			});
			assetCacheDebugText = describeAssetCacheDebugState();
			debugSummaryTimer = null;
		}, DEBUG_SUMMARY_DEBOUNCE_MS);
	}

	function scheduleSceneResourceUpdate(
		input: BrowserRenderResourceCoordinatorInput,
	): void {
		pendingRenderResourceInput = input;
		if (renderResourceUpdateTimer) {
			return;
		}

		renderResourceUpdateTimer = setTimeout(() => {
			renderResourceUpdateTimer = null;
			const nextInput = pendingRenderResourceInput;
			pendingRenderResourceInput = null;
			if (nextInput) {
				renderResourceSnapshot = renderResourceCoordinator.update(nextInput);
			}
		}, 0);
	}

	function describeBrowserCameraResidency(
		residency: BrowserCameraResidency,
	): string {
		const sourceText = `via ${residency.source}`;
		if (residency.kind === "env-cell" && residency.envCellId !== null) {
			return `env cell 0x${formatHex32(residency.envCellId)} in ${formatNullableLandblockId(residency.landblockId)} ${sourceText}`;
		}

		if (
			residency.kind === "outdoor-landblock" &&
			residency.landblockId !== null
		) {
			return `outdoor landblock 0x${formatHex32(residency.landblockId)} ${sourceText}`;
		}

		return residency.landblockId === null
			? `unknown ${sourceText}`
			: `unknown in ${formatNullableLandblockId(residency.landblockId)} ${sourceText}`;
	}

	function describeFollowResidencyKey(
		residency: BrowserCameraResidency | null,
	): string | null {
		if (residency === null || residency.kind === "unknown") {
			return null;
		}

		return [
			residency.kind,
			residency.landblockId?.toString(16) ?? "none",
			residency.envCellId?.toString(16) ?? "none",
			residency.source,
		].join(":");
	}

	function describeBrowserDestinationSource(
		destination: BrowserLocationSelection | null,
	): string {
		switch (destination?.source) {
			case "follow-camera":
				return "Follow camera";
			case "landblock-pick":
				return "Landblock pick";
			case "manual":
				return "Manual";
			default:
				return "Unavailable";
		}
	}

	function formatNullableLandblockId(landblockId: number | null): string {
		return landblockId === null
			? "unknown landblock"
			: `0x${formatHex32(landblockId)}`;
	}

	function handleBrowserPointerDownCapture(event: PointerEvent): void {
		if (isBrowserPanelEvent(event)) {
			return;
		}

		if (event.button !== 0 && event.button !== 1 && event.button !== 2) {
			return;
		}

		const target = event.currentTarget as HTMLElement;
		target.focus();
		target.setPointerCapture(event.pointerId);
		activePointerDrag = {
			pointerId: event.pointerId,
			lastX: event.clientX,
			lastY: event.clientY,
			mode: event.button === 0 ? "orbit" : "pan",
			moved: false,
		};
		pointerInputEventCount += 1;
		event.preventDefault();
	}

	function handleBrowserPointerMoveCapture(event: PointerEvent): void {
		if (isBrowserPanelEvent(event)) {
			return;
		}

		const drag = activePointerDrag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}

		const delta = {
			x: event.clientX - drag.lastX,
			y: event.clientY - drag.lastY,
		};
		if (delta.x === 0 && delta.y === 0) {
			return;
		}

		activePointerDrag = {
			...drag,
			lastX: event.clientX,
			lastY: event.clientY,
			moved: drag.moved || Math.hypot(delta.x, delta.y) > 2,
		};
		const speedMultiplier = getBrowserFreeCameraSpeedMultiplier(event.shiftKey);
		browserCameraState =
			drag.mode === "orbit"
				? rotateBrowserFreeCamera(browserCameraState, delta, speedMultiplier)
				: panBrowserFreeCamera(browserCameraState, delta, speedMultiplier);
		pointerInputEventCount += 1;
		applyBrowserCameraFrame(getViewportPoint(event), false);
		event.preventDefault();
	}

	function handleBrowserPointerUpCapture(event: PointerEvent): void {
		if (isBrowserPanelEvent(event)) {
			return;
		}

		const drag = activePointerDrag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return;
		}

		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) {
			target.releasePointerCapture(event.pointerId);
		}
		suppressNextBrowserClick = drag.moved;
		activePointerDrag = null;
		event.preventDefault();
	}

	function handleBrowserWheelCapture(event: WheelEvent): void {
		if (isBrowserPanelEvent(event)) {
			return;
		}

		browserCameraState = moveBrowserFreeCameraLocalUpByWheel(
			browserCameraState,
			getCameraWheelDelta(event),
			getBrowserFreeCameraSpeedMultiplier(event.shiftKey),
		);
		pointerInputEventCount += 1;
		applyBrowserCameraFrame(getViewportPoint(event), false);
		event.preventDefault();
	}

	function handleBrowserKeyDownCapture(event: KeyboardEvent): void {
		if (isBrowserPanelEvent(event)) {
			return;
		}

		isCameraSlowModifierActive = event.shiftKey;
		const movementKey = normalizeCameraMovementKey(event.key);
		if (movementKey) {
			pressedCameraControlKeys.add(movementKey);
			startCameraMovement();
			keyboardInputEventCount += 1;
			event.preventDefault();
			return;
		}

		if (event.key.toLowerCase() !== "f") {
			return;
		}

		resetBrowserCamera();
		event.preventDefault();
	}

	function resetBrowserCamera(): void {
		if (!renderMetrics?.bounds) {
			return;
		}

		stopCameraMovement();
		browserCameraState = fitBrowserFreeCameraToBounds(
			browserCameraState,
			renderMetrics.bounds,
			`forced:${Date.now()}`,
			{ force: true, aspect: renderMetrics.cameraFrame?.aspect },
		);
		keyboardInputEventCount += 1;
		applyBrowserCameraFrame({ normalizedX: 0.5, normalizedY: 0.5 }, true);
	}

	function handleBrowserKeyUpCapture(event: KeyboardEvent): void {
		if (isBrowserPanelEvent(event)) {
			return;
		}

		isCameraSlowModifierActive = event.shiftKey;
		const movementKey = normalizeCameraMovementKey(event.key);
		if (!movementKey) {
			if (event.key === "Shift") {
				isCameraSlowModifierActive = false;
			}
			return;
		}

		pressedCameraControlKeys.delete(movementKey);
		if (pressedCameraControlKeys.size === 0) {
			stopCameraMovement();
		}
		event.preventDefault();
	}

	function handleBrowserContextMenuCapture(event: MouseEvent): void {
		if (isBrowserPanelEvent(event)) {
			return;
		}

		event.preventDefault();
	}

	function handleBrowserBlurCapture(): void {
		stopCameraMovement();
	}

	function handleBrowserClickCapture(event: MouseEvent): void {
		if (isBrowserPanelEvent(event)) {
			return;
		}

		if (suppressNextBrowserClick) {
			suppressNextBrowserClick = false;
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		if (!rootElement || !worldDisplaySurface) {
			return;
		}

		const viewportPoint = getViewportPoint(event);

		if (!event.ctrlKey) {
			const diagnosticPick = worldDisplaySurface.pickAtViewportPoint(
				viewportPoint,
				new Set(["portal", "structured-cell"]),
				new Set([DEBUG_OVERLAY_SPATIAL_OWNER_KEY]),
			);
			if (!diagnosticPick) {
				diagnosticSelection = null;
				scheduleCurrentSceneResourceUpdate();
				return;
			}

			diagnosticSelection = diagnosticPick.item.metadata;
			scheduleCurrentSceneResourceUpdate();
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		const landblockId =
			worldDisplaySurface.pickTerrainLandblockAtViewportPoint(viewportPoint);

		if (landblockId === null) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		frontendState.selectBrowserLandblockDestination(landblockId);
	}

	function closeDiagnosticInspector(): void {
		diagnosticSelection = null;
		scheduleCurrentSceneResourceUpdate();
	}

	function deriveDiagnosticInspector(
		selection: RenderSpatialMetadata | null,
	): BrowserInspectorModel | null {
		if (!selection) {
			return null;
		}
		const metadata = selection;
		const commonRows = [
			{
				label: "Pick data",
				value:
					"Hit point and distance are renderer-local query results and are not retained.",
			},
		];
		if (metadata.kind === "structured-cell") {
			return {
				title: formatHex32(metadata.envCellId),
				kicker: "Structured cell",
				rows: [
					{ label: "Env cell", value: formatHex32(metadata.envCellId) },
					{ label: "Render key", value: metadata.renderKey },
					{ label: "Role", value: metadata.isFocus ? "Focus" : "Visible" },
					...commonRows,
				],
			};
		}
		if (metadata.kind === "portal") {
			return {
				title: metadata.portalId,
				kicker: "Portal",
				rows: [
					{
						label: "Source",
						value: formatCellIdForInspector(metadata.sourceEnvCellId),
					},
					{
						label: "Target",
						value: formatPortalTargetForInspector(metadata.targetEnvCellId),
					},
					{
						label: "Target status",
						value: formatPortalTargetStatus(metadata.targetStatus),
					},
					{ label: "Polygon", value: metadata.polygonId.toString() },
					{
						label: "Other portal",
						value: formatOtherPortalId(metadata.otherPortalId),
					},
					{ label: "Flags", value: formatPortalFlags(metadata.flags) },
					...commonRows,
				],
			};
		}
		return {
			title: formatHex32(metadata.landblockId),
			kicker: "Terrain",
			rows: [
				{ label: "Landblock", value: formatHex32(metadata.landblockId) },
				{ label: "Asset", value: metadata.assetId },
				...commonRows,
			],
		};
	}

	function formatCellIdForInspector(cellId: number): string {
		return `0x${formatHex32(cellId)}`;
	}

	function formatPortalTargetForInspector(
		targetEnvCellId: number | null,
	): string {
		if (targetEnvCellId === null) {
			return "Unsupported";
		}
		if ((targetEnvCellId & 0xffff) === 0xffff) {
			return `Outdoor landblock ${formatCellIdForInspector(targetEnvCellId)}`;
		}
		return `Env cell ${formatCellIdForInspector(targetEnvCellId)}`;
	}

	function formatPortalTargetStatus(status: string): string {
		if (status === "loaded-visible") {
			return "Loaded and visible";
		}
		if (status === "known-unloaded") {
			return "Known, not loaded";
		}
		if (status === "outside") {
			return "Outside transition";
		}
		if (status === "missing-polygon") {
			return "Missing portal polygon";
		}
		if (status === "unsupported") {
			return "Unsupported";
		}
		return status;
	}

	function formatOtherPortalId(otherPortalId: number): string {
		if (otherPortalId === 0xffff) {
			return "None (0xffff)";
		}
		return `0x${otherPortalId.toString(16).padStart(4, "0")}`;
	}

	function formatPortalFlags(flags: number): string {
		const knownFlags = [
			{ mask: 0x1, label: "ExactMatch" },
			{ mask: 0x2, label: "PortalSide bit" },
			{ mask: 0x4, label: "Outside transition" },
		];
		const labels = knownFlags
			.filter((flag) => (flags & flag.mask) !== 0)
			.map((flag) => flag.label);
		const unknownBits =
			flags & ~knownFlags.reduce((mask, flag) => mask | flag.mask, 0);
		if (unknownBits !== 0) {
			labels.push(`Unknown ${formatHex16(unknownBits)}`);
		}
		return labels.length === 0
			? `${formatHex16(flags)} (none)`
			: `${formatHex16(flags)} (${labels.join(", ")})`;
	}

	function formatHex16(value: number): string {
		return `0x${(value & 0xffff).toString(16).padStart(4, "0")}`;
	}

	function isBrowserPanelEvent(event: Event): boolean {
		return (
			event.target instanceof Element &&
			event.target.closest("[data-browser-panel]") !== null
		);
	}

	function applyBrowserCameraFrame(
		viewportPoint: NormalizedViewportPoint,
		immediate: boolean,
	): void {
		const nextFrame = {
			...buildBrowserFreeCameraFrame(browserCameraState),
			aspect:
				renderMetrics?.cameraFrame?.aspect ?? browserCameraFrame?.aspect ?? 1,
		};
		if (
			browserCameraFrame &&
			areSceneCameraFramesEquivalent(browserCameraFrame, nextFrame)
		) {
			return;
		}

		browserCameraFrame = nextFrame;
		cameraFrameApplyCount += 1;
		syncControlledCameraFrame();
		scheduleRenderedCameraHint(viewportPoint, immediate);
	}

	function rebaseBrowserCameraBetweenAnchors(
		oldAnchorLandblockId: number,
		newAnchorLandblockId: number,
	): void {
		if (browserCameraFrame) {
			browserCameraFrame = convertCameraFrameBetweenAnchors(
				browserCameraFrame,
				oldAnchorLandblockId,
				newAnchorLandblockId,
			);
		}

		browserCameraState = convertBrowserFreeCameraStateBetweenAnchors(
			browserCameraState,
			oldAnchorLandblockId,
			newAnchorLandblockId,
		);
	}

	function areSceneCameraFramesEquivalent(
		left: SceneCameraFrame,
		right: SceneCameraFrame,
	): boolean {
		return (
			areNumbersClose(left.aspect, right.aspect) &&
			areNumbersClose(left.fovDegrees, right.fovDegrees) &&
			areNumbersClose(left.near, right.near) &&
			areNumbersClose(left.far, right.far) &&
			areVec3sClose(left.position, right.position) &&
			areVec3sClose(left.target, right.target) &&
			areVec3sClose(left.up, right.up)
		);
	}

	function areVec3sClose(
		left: SceneCameraFrame["position"],
		right: SceneCameraFrame["position"],
	): boolean {
		return (
			areNumbersClose(left.x, right.x) &&
			areNumbersClose(left.y, right.y) &&
			areNumbersClose(left.z, right.z)
		);
	}

	function areNumbersClose(left: number, right: number): boolean {
		return Math.abs(left - right) < 0.0001;
	}

	function startCameraMovement(): void {
		if (cameraMovementFrameId !== null) {
			return;
		}

		lastCameraMovementFrameAt = null;
		cameraMovementFrameId = window.requestAnimationFrame(applyCameraMovement);
	}

	function stopCameraMovement(): void {
		if (cameraMovementFrameId !== null) {
			window.cancelAnimationFrame(cameraMovementFrameId);
			cameraMovementFrameId = null;
		}
		lastCameraMovementFrameAt = null;
		keyboardLinearMovementStartedAt = null;
		isCameraSlowModifierActive = false;
		pressedCameraControlKeys.clear();
	}

	function applyCameraMovement(frameAt: number): void {
		cameraMovementFrameId =
			pressedCameraControlKeys.size === 0
				? null
				: window.requestAnimationFrame(applyCameraMovement);
		if (pressedCameraControlKeys.size === 0) {
			lastCameraMovementFrameAt = null;
			return;
		}

		const deltaSeconds =
			lastCameraMovementFrameAt === null
				? 0
				: Math.min((frameAt - lastCameraMovementFrameAt) / 1000, 0.05);
		lastCameraMovementFrameAt = frameAt;
		if (deltaSeconds === 0) {
			return;
		}

		const movement = deriveCameraMovementVector();
		const yawDirection = deriveCameraYawDirection();
		const speedMultiplier = getBrowserFreeCameraSpeedMultiplier(
			isCameraSlowModifierActive,
		);
		if (movement.right !== 0 || movement.up !== 0 || movement.forward !== 0) {
			keyboardLinearMovementStartedAt ??= frameAt;
			const keyboardMoveSpeedMultiplier =
				getBrowserFreeCameraKeyboardMoveSpeedMultiplier(
					(frameAt - keyboardLinearMovementStartedAt) / 1000,
				);
			browserCameraState = moveBrowserFreeCameraLocal(
				browserCameraState,
				movement,
				deltaSeconds,
				speedMultiplier * keyboardMoveSpeedMultiplier,
			);
		} else {
			keyboardLinearMovementStartedAt = null;
		}
		if (yawDirection !== 0) {
			browserCameraState = rotateBrowserFreeCameraAroundLocalUp(
				browserCameraState,
				yawDirection,
				deltaSeconds,
				speedMultiplier,
			);
		}
		keyboardInputEventCount += 1;
		applyBrowserCameraFrame({ normalizedX: 0.5, normalizedY: 0.5 }, false);
	}

	function deriveCameraMovementVector(): {
		right: number;
		up: number;
		forward: number;
	} {
		return {
			right:
				(pressedCameraControlKeys.has("c") ? 1 : 0) -
				(pressedCameraControlKeys.has("z") ? 1 : 0),
			up:
				(pressedCameraControlKeys.has("space") ||
				pressedCameraControlKeys.has("pageup")
					? 1
					: 0) - (pressedCameraControlKeys.has("pagedown") ? 1 : 0),
			forward:
				(pressedCameraControlKeys.has("w") ? 1 : 0) -
				(pressedCameraControlKeys.has("s") ? 1 : 0),
		};
	}

	function deriveCameraYawDirection(): -1 | 0 | 1 {
		const direction =
			(pressedCameraControlKeys.has("d") ? 1 : 0) -
			(pressedCameraControlKeys.has("a") ? 1 : 0);

		return direction === 0 ? 0 : direction > 0 ? 1 : -1;
	}

	function normalizeCameraMovementKey(key: string): string | null {
		const normalizedKey = key.toLowerCase();
		if (
			normalizedKey === "w" ||
			normalizedKey === "a" ||
			normalizedKey === "s" ||
			normalizedKey === "d" ||
			normalizedKey === "z" ||
			normalizedKey === "c" ||
			normalizedKey === "pageup" ||
			normalizedKey === "pagedown"
		) {
			return normalizedKey;
		}

		return key === " " ? "space" : null;
	}

	function getCameraWheelDelta(event: WheelEvent): number {
		return event.deltaY !== 0 ? event.deltaY : event.deltaX;
	}

	function getViewportPoint(
		event: MouseEvent | PointerEvent | WheelEvent,
	): NormalizedViewportPoint {
		if (!rootElement) {
			return { normalizedX: 0.5, normalizedY: 0.5 };
		}

		const rect = rootElement.getBoundingClientRect();
		return normalizeViewportPoint(
			event.clientX - rect.left,
			event.clientY - rect.top,
			rect.width,
			rect.height,
		);
	}

	function scheduleRenderedCameraHint(
		viewportPoint: NormalizedViewportPoint,
		immediate: boolean,
	): void {
		const hint = buildRenderedCameraHint(viewportPoint);

		if (!hint) {
			return;
		}

		scheduleCameraHint(hint, immediate);
	}

	function buildRenderedCameraHint(
		viewportPoint: NormalizedViewportPoint,
	): CameraHintDto | null {
		if (!browserCameraFrame) {
			return null;
		}

		return buildCameraHintFromSceneCameraFrame(
			browserDestination,
			browserCameraFrame,
			viewportPoint,
			activeRenderAnchor,
		);
	}

	function scheduleCameraHint(hint: CameraHintDto, immediate: boolean): void {
		const now = Date.now();

		if (
			immediate ||
			shouldSendThrottledCameraHint(
				lastCameraHintAt,
				now,
				CAMERA_HINT_INTERVAL_MS,
			)
		) {
			if (cameraHintTimer) {
				clearTimeout(cameraHintTimer);
				cameraHintTimer = null;
			}
			trailingCameraHint = null;
			void flushCameraHint(hint);
			return;
		}

		trailingCameraHint = hint;

		if (cameraHintTimer) {
			return;
		}

		const remainingDelay =
			CAMERA_HINT_INTERVAL_MS - (now - (lastCameraHintAt ?? now));
		cameraHintTimer = setTimeout(
			() => {
				cameraHintTimer = null;
				const nextHint = trailingCameraHint;
				trailingCameraHint = null;

				if (nextHint) {
					void flushCameraHint(nextHint);
				}
			},
			Math.max(remainingDelay, 0),
		);
	}

	async function flushCameraHint(hint: CameraHintDto): Promise<void> {
		cameraAck = await submitCameraHint(hint);
		lastCameraHintAt = Date.now();
	}

	function describeBrowserCameraControlMode(): string {
		return browserCameraState.hasManualControl
			? "Browser camera: manual free camera."
			: "Browser camera: auto-fit.";
	}

	function describeCameraPipelineDebugState(): string {
		const renderAnchorText =
			activeRenderAnchor === null
				? "none"
				: `${formatHex32(activeRenderAnchor.landblockId)} via ${activeRenderAnchorSource ?? "unknown"}; chunks ${renderResourceSnapshot.activeRenderChunkCount}`;
		return `metrics ${renderMetricsEventCount}; frames ${cameraFrameApplyCount}; pointer ${pointerInputEventCount}; keys ${keyboardInputEventCount}; anchor ${renderAnchorText}; focus ${document.activeElement?.tagName.toLowerCase() ?? "none"}.`;
	}

	function describeAssetSummaryState(): string {
		if (assetState.errorMessage) {
			return `error preparing ${assetState.activeRequest?.assetId ?? "asset"}`;
		}

		const preparedCounts = countPreparedAssetsByKind(
			assetState.preparedByAssetId,
		);
		return `${assetState.status}; ${preparedCounts.total} prepared asset${preparedCounts.total === 1 ? "" : "s"}.`;
	}

	function describeAssetDebugState(): string {
		if (assetState.errorMessage) {
			return `Error while preparing ${assetState.activeRequest?.assetId ?? "asset"}: ${assetState.errorMessage}`;
		}

		const preparedCounts = countPreparedAssetsByKind(
			assetState.preparedByAssetId,
		);
		const activeAssetId = assetState.activeRequest?.assetId ?? "none";
		const recentActivity = assetState.history.at(-1);
		const recentText = recentActivity
			? `${recentActivity.status} ${recentActivity.assetId}`
			: "no asset activity yet";
		const preparedText = `${preparedCounts.total} (${formatPreparedAssetKindCounts(preparedCounts)})`;
		const renderDiagnostic = describeGfxObjRenderDiagnostics();
		if (renderDiagnostic) {
			return `${assetState.status}; ${renderDiagnostic}; active ${activeAssetId}; prepared ${preparedText}; latest ${recentText}.`;
		}

		return `${assetState.status}; active ${activeAssetId}; prepared ${preparedText}; latest ${recentText}.`;
	}

	function describeAssetPipelineDebugState(): string {
		const preparedLandblockRouteIds = Object.keys(assetState.preparedByAssetId)
			.filter((assetId) =>
				/^landblock\/[0-9a-fA-F]{8}\/(?:outdoor|topology)$/.test(assetId),
			)
			.sort();
		const recentHistory = assetState.history
			.map((entry) => `${entry.status}:${entry.assetId}`)
			.join(" | ");
		return `landblock routes ${preparedLandblockRouteIds.length}: ${preparedLandblockRouteIds.slice(0, 4).join(", ") || "none"}; recent ${recentHistory || "none"}.`;
	}

	function describeAssetCacheDebugState(): string {
		const cacheDiagnostics = assetState.cacheDiagnostics;
		if (!cacheDiagnostics) {
			const preparedCounts = countPreparedAssetsByKind(
				assetState.preparedByAssetId,
			);
			return `Prepared ${preparedCounts.total} (${formatPreparedAssetKindCounts(preparedCounts)}); waiting for first prune sample.`;
		}

		return `Prepared ${cacheDiagnostics.prepared.total} (${formatPreparedAssetKindCounts(cacheDiagnostics.prepared)}); retained ${cacheDiagnostics.retained.total} (${formatPreparedAssetKindCounts(cacheDiagnostics.retained)}); evicted ${cacheDiagnostics.evicted.total} (${formatPreparedAssetKindCounts(cacheDiagnostics.evicted)}).`;
	}

	function describeGfxObjRenderDiagnostics(): string | null {
		const affectedAssets = Object.values(assetState.preparedByAssetId)
			.filter(isPreparedGfxObjAsset)
			.map((asset) => ({
				assetId: asset.request.assetId,
				invalidPolygons: asset.payload.renderGeometry.invalidPolygons ?? [],
			}))
			.filter((asset) => asset.invalidPolygons.length > 0);

		if (affectedAssets.length === 0) {
			return null;
		}

		const firstAsset = affectedAssets[0];
		const firstPolygon = firstAsset?.invalidPolygons[0];
		const totalInvalidPolygons = affectedAssets.reduce(
			(total, asset) => total + asset.invalidPolygons.length,
			0,
		);

		if (!firstAsset || !firstPolygon) {
			return null;
		}

		return `${totalInvalidPolygons} invalid gfx polygon${totalInvalidPolygons === 1 ? "" : "s"} while preparing ${affectedAssets.length} gfx asset${affectedAssets.length === 1 ? "" : "s"}; first ${firstAsset.assetId} polygon ${firstPolygon.polygonId} missing vertices ${firstPolygon.missingVertexIds.join(", ")}`;
	}

	onDestroy(() => {
		if (debugSummaryTimer) {
			clearTimeout(debugSummaryTimer);
			debugSummaryTimer = null;
		}
		if (renderResourceUpdateTimer) {
			clearTimeout(renderResourceUpdateTimer);
			renderResourceUpdateTimer = null;
		}
		if (cameraHintTimer) {
			clearTimeout(cameraHintTimer);
		}
		stopCameraMovement();
	});
</script>

<div
	bind:this={rootElement}
	class="browser-world-display"
	tabindex="-1"
	onpointerdowncapture={handleBrowserPointerDownCapture}
	onpointermovecapture={handleBrowserPointerMoveCapture}
	onpointerupcapture={handleBrowserPointerUpCapture}
	onpointercancelcapture={handleBrowserPointerUpCapture}
	onwheelcapture={handleBrowserWheelCapture}
	onkeydowncapture={handleBrowserKeyDownCapture}
	onkeyupcapture={handleBrowserKeyUpCapture}
	onblurcapture={handleBrowserBlurCapture}
	oncontextmenucapture={handleBrowserContextMenuCapture}
	onclickcapture={handleBrowserClickCapture}
>
	<WorldDisplay
		bind:this={worldDisplaySurface}
		onCameraFrameChange={handleRendererCameraFrameChange}
		onRenderMetricsChange={handleRenderMetricsChange}
		onCameraResidencyChange={handleRendererCameraResidencyChange}
	/>

	<div class="browser-world-display__fps">{renderPerformanceText}</div>

	<div class="browser-world-display__panel">
		<BrowserModePanel
			{sceneStatusText}
			sceneSummaryRows={browserPanelSceneRows}
			sceneDetailSections={browserPanelSceneDetailSections}
			debugSummaryRows={browserPanelDebugRows}
			debugDetailSections={browserPanelDebugDetailSections}
			canResetCamera={Boolean(renderMetrics?.bounds)}
			onResetCamera={resetBrowserCamera}
		/>
	</div>

	{#if diagnosticInspector}
		<aside class="browser-world-display__inspector" data-browser-panel>
			<div class="browser-world-display__inspector-header">
				<div>
					<p>{diagnosticInspector.kicker}</p>
					<h2>{diagnosticInspector.title}</h2>
				</div>
				<button
					type="button"
					class="browser-world-display__inspector-close"
					aria-label="Close inspector"
					onclick={closeDiagnosticInspector}
				>
					Close
				</button>
			</div>
			<dl class="browser-world-display__inspector-rows">
				{#each diagnosticInspector.rows as row}
					<div>
						<dt>{row.label}</dt>
						<dd>{row.value}</dd>
					</div>
				{/each}
			</dl>
		</aside>
	{/if}
</div>
