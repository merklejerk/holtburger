<script lang="ts">
	import { onDestroy } from "svelte";

	import { frontendState } from "../app/frontend-state";
	import {
		browserDestinationToIndoorEnvCellId,
		type BrowserLocationSelection,
	} from "../app/browser-mode";
	import type { AppModeId } from "../app/modes";
	import type { AssetChannelState } from "../lib/assets/types";
	import type {
		CameraHintAckDto,
		FrontendStateFeedDto,
		RayPickResponseDto,
		RuntimeBatchDto,
	} from "../lib/host/contracts";
	import { submitCameraHint } from "../lib/host/tauri";
	import {
		buildCameraHintFromSceneCameraFrame,
		buildBrowserFreeCameraFrame,
		createBrowserFreeCameraState,
		fitBrowserFreeCameraToBounds,
		getBrowserFreeCameraKeyboardMoveSpeedMultiplier,
		getBrowserFreeCameraSpeedMultiplier,
		moveBrowserFreeCameraLocalUpByWheel,
		moveBrowserFreeCameraLocal,
		panBrowserFreeCamera,
		rotateBrowserFreeCamera,
		rotateBrowserFreeCameraAroundLocalUp,
		type BrowserFreeCameraState,
		type SceneCameraFrame,
		describeSceneCameraFrame,
	} from "../lib/world-display/camera";
	import WorldDisplay from "../lib/world-display/WorldDisplay.svelte";
	import {
		deriveOutdoorInteriorSeedEnvCellIds,
		deriveTerrainFocusLandblockId,
	} from "../lib/assets/scene-asset-request-planner";
	import { deriveStructuredInteriorCoverage } from "../lib/assets/structured-interior-coverage";
	import {
		buildCameraHint,
		deriveWorldDisplayModel,
		describeCameraHintAck,
		describeRayPickResponse,
		normalizeViewportPoint,
		shouldSendThrottledCameraHint,
		type NormalizedViewportPoint,
	} from "../lib/world-display/model";
	import type { WorldRenderMetrics } from "../lib/world-display/renderer-contract";
	import {
		deriveStaticRenderableSceneModel,
		isPreparedGfxObjAsset,
		type StaticRenderableSceneModel,
	} from "../lib/world-display/static-renderables";
	import { WORLD_RENDER_DOMAIN } from "../lib/world-display/render-domains";
	import {
		deriveTerrainSceneModel,
		type TerrainSceneModel,
	} from "../lib/world-display/terrain-scene";
	import {
		deriveWorldDebugOverlayModel,
		type WorldDebugOverlayModel,
	} from "../lib/world-display/debug-overlays";
	import {
		deriveStructuredInteriorSceneModel,
		type StructuredInteriorSceneModel,
	} from "../lib/world-display/structured-interior-scene";
	import { formatHex32, normalizeOutdoorLandblockId } from "../lib/landblocks";
	import { deriveOutdoorSceneInterest } from "../lib/world-display/outdoor-scene-interest";
	import {
		deriveTransitionPortalCandidates,
		type TransitionPortalCandidateModel,
	} from "../lib/world-display/transition-portal-work-items";
	import {
		countPreparedAssetsByKind,
		formatPreparedAssetKindCounts,
	} from "../lib/assets/asset-cache-diagnostics";
	import {
		createLinearRenderSpatialIndex,
		type RenderSpatialMetadata,
	} from "../lib/world-display/render-spatial-index";
	import {
		commitRenderAnchorCandidate,
		deriveRenderAnchorCandidate,
		deriveRenderChunkTransforms,
		type RenderAnchorSource,
		type RenderChunkTransform,
	} from "../lib/world-display/render-anchor";
	import {
		deriveWorldRenderSceneContext,
		type WorldRenderSceneContext,
	} from "../lib/world-display/render-scene-context";
	import {
		DEBUG_OVERLAY_SPATIAL_OWNER_KEY,
		STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY,
		TERRAIN_SPATIAL_OWNER_KEY,
		deriveDebugOverlaySpatialItems,
		deriveStructuredInteriorSpatialItems,
		deriveTerrainSpatialItems,
	} from "../lib/world-display/render-spatial-scene";
	import type {
		RenderChunkPlacement,
		RenderLandblockAnchor,
	} from "../lib/world-display/render-chunks";
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

	let {
		activeMode,
		activeModeLabel,
		hostStatus,
		runtimeBatch,
		viewModelFeed,
		assetState,
		browserDestination,
		terrainLodRadius,
		buildingLodRadius,
		detailLodRadius,
		envCellLodRadius,
		transitionPortalMaxDepth,
		showPortalPolygons,
		showCellIndicators,
		highlightPortalTargets,
	}: {
		activeMode: AppModeId;
		activeModeLabel: string;
		hostStatus: string;
		runtimeBatch: RuntimeBatchDto | null;
		viewModelFeed: FrontendStateFeedDto | null;
		assetState: AssetChannelState;
		browserDestination: BrowserLocationSelection | null;
		terrainLodRadius: number;
		buildingLodRadius: number;
		detailLodRadius: number;
		envCellLodRadius: number;
		transitionPortalMaxDepth: number;
		showPortalPolygons: boolean;
		showCellIndicators: boolean;
		highlightPortalTargets: boolean;
	} = $props();

	let rootElement = $state<HTMLDivElement | null>(null);
	let worldDisplaySurface = $state<WorldDisplay | null>(null);
	const renderSpatialIndex = createLinearRenderSpatialIndex();
	let renderMetrics = $state<WorldRenderMetrics | null>(null);
	let browserCameraState = $state<BrowserFreeCameraState>(
		createBrowserFreeCameraState(),
	);
	let browserCameraFrame = $state<SceneCameraFrame | null>(null);
	let cameraAck = $state<CameraHintAckDto | null>(null);
	let rayPickResponse = $state<RayPickResponseDto | null>(null);
	let diagnosticSelection = $state<RenderSpatialMetadata | null>(null);
	let lastCameraHintAt = $state<number | null>(null);
	let trailingCameraHint = $state<ReturnType<typeof buildCameraHint> | null>(
		null,
	);
	let activePointerDrag = $state<{
		pointerId: number;
		lastX: number;
		lastY: number;
		mode: "orbit" | "pan";
		moved: boolean;
	} | null>(null);
	let activeCameraSceneKey = $state<string | null>(null);
	let activeRenderAnchor = $state<RenderLandblockAnchor | null>(null);
	let activeRenderAnchorSource = $state<RenderAnchorSource | null>(null);
	let renderMetricsEventCount = $state(0);
	let cameraFrameApplyCount = $state(0);
	let pointerInputEventCount = $state(0);
	let keyboardInputEventCount = $state(0);
	let suppressNextBrowserClick = false;
	let cameraHintTimer: ReturnType<typeof setTimeout> | null = null;
	let cameraMovementFrameId: number | null = null;
	let lastCameraMovementFrameAt: number | null = null;
	let keyboardLinearMovementStartedAt: number | null = null;
	let isCameraSlowModifierActive = false;
	const pressedCameraControlKeys = new Set<string>();

	const CAMERA_HINT_INTERVAL_MS = 250;
	const browserCameraSceneKey = $derived(
		describeBrowserCameraSceneKey(browserDestination, runtimeBatch),
	);
	const renderAnchorCandidate = $derived(
		deriveRenderAnchorCandidate(runtimeBatch, browserDestination),
	);

	const outdoorFocusLandblockId = $derived(
		runtimeBatch &&
			!runtimeBatch.residency.indoors &&
			browserDestination?.kind !== "indoor-env-cell"
			? deriveTerrainFocusLandblockId(runtimeBatch, browserDestination)
			: null,
	);
	const outdoorSceneInterest = $derived(
		outdoorFocusLandblockId === null
			? null
			: deriveOutdoorSceneInterest({
					focusLandblockId: outdoorFocusLandblockId,
					terrainRadius: terrainLodRadius,
					buildingRadius: buildingLodRadius,
					detailRadius: detailLodRadius,
					envCellRadius: envCellLodRadius,
				}),
	);
	const terrainScene = $derived(
		deriveTerrainSceneModel(
			runtimeBatch,
			assetState,
			browserDestination,
			terrainLodRadius,
			outdoorSceneInterest?.terrainLandblockIds ?? null,
		),
	);
	const linkedOutdoorEnvCellIds = $derived.by(() => {
		if (outdoorSceneInterest === null) {
			return [];
		}

		return [
			...deriveOutdoorInteriorSeedEnvCellIds(
				assetState.preparedByAssetId,
				new Set(outdoorSceneInterest.envCellLandblockIds),
			),
		].sort((left, right) => left - right);
	});
	const structuredInteriorCoverage = $derived.by(() => {
		const browserFocusEnvCellId =
			browserDestinationToIndoorEnvCellId(browserDestination);
		if (browserFocusEnvCellId !== null) {
			return deriveStructuredInteriorCoverage(
				{
					kind: "landblock-closure",
					seedEnvCellIds: [browserFocusEnvCellId],
				},
				assetState.preparedByAssetId,
			);
		}

		if (linkedOutdoorEnvCellIds.length > 0) {
			return deriveStructuredInteriorCoverage(
				{
					kind: "landblock-closure",
					seedEnvCellIds: linkedOutdoorEnvCellIds,
				},
				assetState.preparedByAssetId,
			);
		}

		return null;
	});
	const staticRenderableScene = $derived(
		deriveStaticRenderableSceneModel(
			runtimeBatch,
			assetState,
			browserDestination,
			detailLodRadius,
			structuredInteriorCoverage,
			outdoorSceneInterest === null
				? null
				: {
						buildingLandblockIds: outdoorSceneInterest.buildingLandblockIds,
						detailLandblockIds: outdoorSceneInterest.detailLandblockIds,
						envCellLandblockIds: outdoorSceneInterest.envCellLandblockIds,
					},
		),
	);
	const structuredInteriorScene = $derived(
		deriveStructuredInteriorSceneModel(
			runtimeBatch,
			assetState,
			browserDestination,
			outdoorFocusLandblockId === null
				? null
				: {
						envCellIds: linkedOutdoorEnvCellIds,
					},
			structuredInteriorCoverage,
		),
	);
	const selectedDiagnosticPortalId = $derived(
		diagnosticSelection?.kind === "portal"
			? diagnosticSelection.portalId
			: null,
	);
	const selectedDiagnosticEnvCellId = $derived(
		diagnosticSelection?.kind === "structured-cell"
			? diagnosticSelection.envCellId
			: diagnosticSelection?.kind === "portal"
				? diagnosticSelection.sourceEnvCellId
				: null,
	);
	const debugOverlayScene = $derived(
		deriveWorldDebugOverlayModel(structuredInteriorScene, {
			showPortalPolygons,
			showCellIndicators,
			highlightPortalTargets,
			selectedPortalId: selectedDiagnosticPortalId,
			selectedEnvCellId: selectedDiagnosticEnvCellId,
		}),
	);
	const transitionPortalModel = $derived(
		deriveTransitionPortalCandidates({
			assetState,
			structuredInteriorScene,
			activeLandblockIds: outdoorSceneInterest?.buildingLandblockIds ?? [],
		}),
	);
	const terrainSpatialItems = $derived(deriveTerrainSpatialItems(terrainScene));
	const structuredInteriorSpatialItems = $derived(
		deriveStructuredInteriorSpatialItems(structuredInteriorScene),
	);
	const debugOverlaySpatialItems = $derived(
		deriveDebugOverlaySpatialItems(debugOverlayScene),
	);
	const activeRenderChunkPlacements = $derived(
		collectActiveRenderChunkPlacements(
			terrainScene,
			structuredInteriorScene,
			debugOverlayScene,
			staticRenderableScene,
		),
	);
	const activeRenderChunkTransforms = $derived<RenderChunkTransform[]>(
		deriveRenderChunkTransforms(
			activeRenderAnchor,
			activeRenderChunkPlacements,
		),
	);
	const renderSceneContext = $derived(
		deriveWorldRenderSceneContext({
			activeRenderAnchor,
			terrainScene,
			structuredInteriorScene,
		}),
	);
	const assetStateResourceRevision = $derived(
		describeAssetStateResourceRevision(assetState),
	);
	const terrainSceneResourceRevision = $derived(
		describeTerrainSceneResourceRevision(terrainScene),
	);
	const staticRenderableSceneResourceRevision = $derived(
		describeStaticRenderableSceneResourceRevision(staticRenderableScene),
	);
	const structuredInteriorSceneResourceRevision = $derived(
		describeStructuredInteriorSceneResourceRevision(structuredInteriorScene),
	);
	const transitionPortalModelResourceRevision = $derived(
		describeTransitionPortalModelResourceRevision(transitionPortalModel),
	);
	const debugOverlaySceneResourceRevision = $derived(
		describeDebugOverlaySceneResourceRevision(debugOverlayScene),
	);
	const renderSceneContextResourceRevision = $derived(
		describeRenderSceneContextResourceRevision(renderSceneContext),
	);
	const renderChunkTransformsResourceRevision = $derived(
		describeRenderChunkTransformsResourceRevision(activeRenderChunkTransforms),
	);
	const browserCameraFrameResourceRevision = $derived(
		describeSceneCameraFrameResourceRevision(browserCameraFrame),
	);
	const terrainVertexCount = $derived(
		terrainScene.tiles.reduce(
			(total, tile) => total + tile.mesh.vertices.length,
			0,
		),
	);
	const terrainTriangleCount = $derived(
		terrainScene.tiles.reduce(
			(total, tile) => total + tile.mesh.triangles.length,
			0,
		),
	);
	const terrainMinHeight = $derived(
		terrainScene.tiles.length === 0
			? null
			: Math.min(...terrainScene.tiles.map((tile) => tile.mesh.minHeight)),
	);
	const terrainMaxHeight = $derived(
		terrainScene.tiles.length === 0
			? null
			: Math.max(...terrainScene.tiles.map((tile) => tile.mesh.maxHeight)),
	);
	const sceneGeometryText = $derived(
		structuredInteriorScene.cells.length > 0
			? `${structuredInteriorScene.cells.length} env cell${structuredInteriorScene.cells.length === 1 ? "" : "s"}, ${renderMetrics?.geometry.structuredInteriorVertexCount ?? 0} vertices, ${renderMetrics?.geometry.structuredInteriorTriangleCount ?? 0} triangles.`
			: terrainScene.tiles.length === 0
				? "No terrain geometry is cached yet."
				: `${terrainScene.tiles.length} tile${terrainScene.tiles.length === 1 ? "" : "s"}, ${terrainVertexCount} vertices, ${terrainTriangleCount} triangles.`,
	);
	const terrainHeightText = $derived(
		terrainMinHeight === null || terrainMaxHeight === null
			? "No terrain heights are cached yet."
			: `Height range ${terrainMinHeight.toFixed(1)} to ${terrainMaxHeight.toFixed(1)} across cached tiles.`,
	);
	const staticRenderableText = $derived(
		staticRenderableScene.parts.length === 0
			? describeStaticRenderableIdleState()
			: `${staticRenderableScene.parts.length} static renderable part${staticRenderableScene.parts.length === 1 ? "" : "s"} across ${staticRenderableScene.partsByRenderDomainChunkAndGfxAssetId.size} domain-safe chunked instanced group${staticRenderableScene.partsByRenderDomainChunkAndGfxAssetId.size === 1 ? "" : "s"}.`,
	);
	const staticRenderableLayerText = $derived.by(() => {
		const explicitCount = staticRenderableScene.sourceInstances.filter(
			(instance) => instance.kind === "scenery",
		).length;
		const buildingCount = staticRenderableScene.sourceInstances.filter(
			(instance) => instance.kind === "building",
		).length;
		const generatedCount = staticRenderableScene.sourceInstances.filter(
			(instance) => instance.kind === "generated-scenery",
		).length;
		const indoorCount = staticRenderableScene.sourceInstances.filter(
			(instance) => instance.kind === "indoor-static",
		).length;
		const exteriorGroupCount = [
			...staticRenderableScene.partsByRenderDomainChunkAndGfxAssetId.values(),
		].filter(
			(parts) => parts[0]?.renderDomain === WORLD_RENDER_DOMAIN.exteriorStatic,
		).length;
		const interiorGroupCount = [
			...staticRenderableScene.partsByRenderDomainChunkAndGfxAssetId.values(),
		].filter(
			(parts) => parts[0]?.renderDomain === WORLD_RENDER_DOMAIN.interiorStatic,
		).length;
		return `Explicit ${explicitCount}, buildings ${buildingCount}, generated ${generatedCount}, indoor ${indoorCount}; groups exterior ${exteriorGroupCount}, interior ${interiorGroupCount}.`;
	});
	const structuredInteriorEnvironmentCount = $derived(
		new Set(structuredInteriorScene.cells.map((cell) => cell.environmentId))
			.size,
	);
	const structuredInteriorText = $derived(
		structuredInteriorScene.cells.length > 0
			? linkedOutdoorEnvCellIds.length > 0 &&
				browserDestination?.kind !== "indoor-env-cell" &&
				!runtimeBatch?.residency.indoors
				? `${structuredInteriorScene.cells.length} outdoor-linked env cell${structuredInteriorScene.cells.length === 1 ? "" : "s"} rendered from ${structuredInteriorEnvironmentCount} environment payload${structuredInteriorEnvironmentCount === 1 ? "" : "s"}; ${linkedOutdoorEnvCellIds.length} linked, ${structuredInteriorCoverage?.envCellIds.length ?? linkedOutdoorEnvCellIds.length} covered${structuredInteriorCoverage?.truncated ? " (truncated)" : ""}.`
				: `${structuredInteriorScene.cells.length} visible env cell${structuredInteriorScene.cells.length === 1 ? "" : "s"} rendered from ${structuredInteriorEnvironmentCount} environment payload${structuredInteriorEnvironmentCount === 1 ? "" : "s"}.`
			: describeStructuredInteriorIdleState(),
	);
	const cellIndicatorText = $derived(
		debugOverlayScene.showCellIndicators
			? `${debugOverlayScene.diagnostics.cellCount} cell indicator${debugOverlayScene.diagnostics.cellCount === 1 ? "" : "s"} visible.`
			: "Cell indicators are hidden.",
	);
	const portalDiagnosticsText = $derived(
		debugOverlayScene.showPortalPolygons
			? `${debugOverlayScene.diagnostics.portalCount} portal overlay${debugOverlayScene.diagnostics.portalCount === 1 ? "" : "s"}; ${debugOverlayScene.diagnostics.loadedTargetCount}/${debugOverlayScene.diagnostics.knownTargetCount} known target${debugOverlayScene.diagnostics.knownTargetCount === 1 ? "" : "s"} loaded${debugOverlayScene.diagnostics.missingPortalPolygonCount > 0 ? `; ${debugOverlayScene.diagnostics.missingPortalPolygonCount} missing polygon witness${debugOverlayScene.diagnostics.missingPortalPolygonCount === 1 ? "" : "es"}` : ""}.`
			: "Portal polygon overlays are hidden.",
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
	const sceneContextText = $derived(
		`${renderSceneContext.kind === "dungeon" ? "Dungeon" : "Outdoor"}${renderSceneContext.anchorLandblockId === null ? "" : ` anchored at 0x${formatHex32(renderSceneContext.anchorLandblockId)}`}`,
	);
	const cameraResidencyText = $derived.by(() => {
		const debug = renderMetrics?.debug;
		if (!debug) {
			return "Waiting for renderer residency.";
		}
		return `${debug.cameraViewResidency} via ${debug.residencySource}`;
	});
	const renderGraphText = $derived.by(() => {
		const debug = renderMetrics?.debug;
		if (!debug) {
			return "Waiting for render graph.";
		}
		return `${debug.renderGraphBaseScene} base, transition depth ${debug.transitionPortalMaxDepth}`;
	});
	const landblockVisibilityText = $derived.by(() => {
		if (renderSceneContext.kind === "dungeon") {
			return "Dungeon context; outdoor landblock rendering is inactive.";
		}
		if (!outdoorSceneInterest) {
			return "Outdoor landblock selection is waiting for focus.";
		}
		return `Terrain ${terrainScene.tiles.length}/${outdoorSceneInterest.terrainLandblockIds.length}, buildings ${outdoorSceneInterest.buildingLandblockIds.length}, detail ${outdoorSceneInterest.detailLandblockIds.length}.`;
	});
	const cellVisibilityText = $derived.by(() => {
		const debug = renderMetrics?.debug;
		if (!debug) {
			return `${structuredInteriorScene.cells.length} loaded env cell${structuredInteriorScene.cells.length === 1 ? "" : "s"}; renderer visibility pending.`;
		}
		return `${debug.visibleStructuredInteriorMeshCount}/${debug.structuredInteriorMeshCount} rendered mesh${debug.structuredInteriorMeshCount === 1 ? "" : "es"}; ${structuredInteriorScene.cells.length} loaded cell${structuredInteriorScene.cells.length === 1 ? "" : "s"}.`;
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
	const assetSummaryText = $derived(describeAssetSummaryState());
	const assetDebugText = $derived(describeAssetDebugState());
	const assetPipelineDebugText = $derived(describeAssetPipelineDebugState());
	const assetCacheDebugText = $derived(describeAssetCacheDebugState());
	const diagnosticInspector = $derived(
		deriveDiagnosticInspector(diagnosticSelection),
	);
	const pendingCameraHint = $derived(trailingCameraHint !== null);
	const worldDisplay = $derived(
		deriveWorldDisplayModel({
			activeModeLabel,
			hostStatus,
			runtimeBatch,
			viewModelFeed,
			assetState,
			browserDestination,
			terrainLodRadius,
			buildingLodRadius,
			detailLodRadius,
			cameraAck,
			rayPickResponse,
			pendingCameraHint,
		}),
	);
	$effect(() => {
		const commit = commitRenderAnchorCandidate(
			activeRenderAnchor,
			renderAnchorCandidate,
		);
		activeRenderAnchor = commit.anchor;
		activeRenderAnchorSource = commit.source;
	});
	$effect(() => {
		renderSpatialIndex.replaceChunkTransforms(activeRenderChunkTransforms);
	});
	$effect(() => {
		renderSpatialIndex.replaceOwnerItems(
			TERRAIN_SPATIAL_OWNER_KEY,
			terrainSpatialItems,
		);
	});
	$effect(() => {
		renderSpatialIndex.replaceOwnerItems(
			STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY,
			structuredInteriorSpatialItems,
		);
	});
	$effect(() => {
		renderSpatialIndex.replaceOwnerItems(
			DEBUG_OVERLAY_SPATIAL_OWNER_KEY,
			debugOverlaySpatialItems,
		);
	});
	$effect(() => {
		worldDisplaySurface?.setAssetState(assetStateResourceRevision, assetState);
	});
	$effect(() => {
		worldDisplaySurface?.setRenderSceneContext(
			renderSceneContextResourceRevision,
			renderSceneContext,
		);
	});
	$effect(() => {
		worldDisplaySurface?.setRenderChunkTransforms(
			renderChunkTransformsResourceRevision,
			activeRenderChunkTransforms,
		);
	});
	$effect(() => {
		worldDisplaySurface?.setTerrainScene(
			terrainSceneResourceRevision,
			terrainScene,
		);
	});
	$effect(() => {
		worldDisplaySurface?.setStaticRenderableScene(
			staticRenderableSceneResourceRevision,
			staticRenderableScene,
		);
	});
	$effect(() => {
		worldDisplaySurface?.setStructuredInteriorScene(
			structuredInteriorSceneResourceRevision,
			structuredInteriorScene,
		);
	});
	$effect(() => {
		worldDisplaySurface?.setTransitionPortalModel(
			transitionPortalModelResourceRevision,
			transitionPortalModel,
		);
	});
	$effect(() => {
		worldDisplaySurface?.setDebugOverlayScene(
			debugOverlaySceneResourceRevision,
			debugOverlayScene,
		);
	});
	$effect(() => {
		worldDisplaySurface?.setRenderSpatialQuery(
			"browser-render-spatial-index",
			renderSpatialIndex,
		);
	});
	$effect(() => {
		worldDisplaySurface?.setControlledCameraFrame(
			browserCameraFrameResourceRevision,
			browserCameraFrame,
		);
	});
	$effect(() => {
		worldDisplaySurface?.setTransitionPortalMaxDepth(
			`transition-depth=${transitionPortalMaxDepth}`,
			transitionPortalMaxDepth,
		);
	});
	const sceneStatusText = $derived(
		structuredInteriorScene.cells.length > 0
			? structuredInteriorScene.statusText
			: terrainScene.statusText,
	);
	const browserPanelSceneRows = $derived<BrowserPanelRow[]>([
		{ label: "Mode", value: sceneContextText },
		{ label: "Focus", value: worldDisplay.focusLocationLabel },
		{ label: "Camera residency", value: cameraResidencyText },
		{ label: "Base scene", value: renderGraphText },
		{ label: "Landblocks", value: landblockVisibilityText },
		{ label: "Cells", value: cellVisibilityText },
	]);
	const browserPanelSceneDetailSections = $derived<BrowserPanelSection[]>([
		{
			title: "Geometry",
			rows: [
				{ label: "Terrain", value: terrainScene.cacheText },
				{ label: "Source", value: terrainScene.dataSourceText },
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
				{
					label: "Ray pick",
					value:
						describeRayPickResponse(rayPickResponse) ??
						"No authority-sensitive debug pick has been resolved yet.",
				},
				{ label: "Events", value: cameraPipelineDebugText },
			],
		},
		{
			title: "Asset Pipeline",
			rows: [
				{ label: "Active", value: assetDebugText },
				{ label: "Pipeline", value: assetPipelineDebugText },
				{ label: "Cache", value: assetCacheDebugText },
				{ label: "Layers", value: staticRenderableLayerText },
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

	$effect(() => {
		if (activeCameraSceneKey === null) {
			activeCameraSceneKey = browserCameraSceneKey;
			return;
		}

		if (activeCameraSceneKey === browserCameraSceneKey) {
			return;
		}

		activeCameraSceneKey = browserCameraSceneKey;
		browserCameraState = createBrowserFreeCameraState();
		browserCameraFrame = null;
		activePointerDrag = null;
		suppressNextBrowserClick = false;
		stopCameraMovement();
	});

	// Browser free-camera controls are a navigation policy, not the future client camera.
	function handleRenderMetricsChange(metrics: WorldRenderMetrics): void {
		renderMetricsEventCount += 1;
		renderMetrics = metrics;

		if (metrics.bounds) {
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
				{ force: false },
			);
			applyBrowserCameraFrame({ normalizedX: 0.5, normalizedY: 0.5 }, false);
			return;
		}

		if (!browserCameraFrame && metrics.cameraFrame) {
			browserCameraFrame = metrics.cameraFrame;
			scheduleRenderedCameraHint({ normalizedX: 0.5, normalizedY: 0.5 }, true);
		}
	}

	function handleRendererCameraFrameChange(
		cameraFrame: SceneCameraFrame,
	): void {
		if (!browserCameraFrame) {
			browserCameraFrame = cameraFrame;
			scheduleRenderedCameraHint({ normalizedX: 0.5, normalizedY: 0.5 }, true);
		}
	}

	function describeBrowserCameraSceneKey(
		destination: BrowserLocationSelection | null,
		runtime: RuntimeBatchDto | null,
	): string {
		if (destination?.kind === "indoor-env-cell") {
			return `browser:indoor:${destination.envCellId.toString(16).padStart(8, "0")}`;
		}

		if (destination?.kind === "outdoor-location") {
			const landblockKey =
				destination.landblockId === null
					? "unresolved"
					: normalizeOutdoorLandblockId(destination.landblockId)
							.toString(16)
							.padStart(8, "0");
			return `browser:outdoor:${landblockKey}`;
		}

		if (runtime?.residency.indoors) {
			return `runtime:indoor:${runtime.residency.focusEnvCellId?.toString(16).padStart(8, "0") ?? "none"}`;
		}

		if (runtime) {
			return `runtime:outdoor:${normalizeOutdoorLandblockId(runtime.residency.focusLandblockId).toString(16).padStart(8, "0")}`;
		}

		return "pending";
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
			{ force: true },
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
				return;
			}

			diagnosticSelection = diagnosticPick.item.metadata;
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

	function collectActiveRenderChunkPlacements(
		terrain: TerrainSceneModel,
		structuredInterior: StructuredInteriorSceneModel,
		debugOverlay: WorldDebugOverlayModel,
		staticRenderables: StaticRenderableSceneModel,
	): RenderChunkPlacement[] {
		const chunksByKey = new Map<string, RenderChunkPlacement>();
		for (const chunk of [
			...terrain.tiles.map((tile) => tile.renderChunk),
			...structuredInterior.cells.map((cell) => cell.renderChunk),
			...debugOverlay.cells.map((cell) => cell.renderChunk),
			...debugOverlay.portals.map((portal) => portal.renderChunk),
			...staticRenderables.parts.map((part) => part.renderChunk),
		]) {
			chunksByKey.set(chunk.chunkKey, chunk);
		}

		return [...chunksByKey.values()].sort((left, right) =>
			left.chunkKey.localeCompare(right.chunkKey),
		);
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
		scheduleRenderedCameraHint(viewportPoint, immediate);
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
	): NonNullable<ReturnType<typeof buildCameraHint>> | null {
		if (!browserCameraFrame) {
			return buildCameraHint(
				activeMode,
				runtimeBatch,
				browserDestination,
				viewportPoint,
			);
		}

		return buildCameraHintFromSceneCameraFrame(
			activeMode,
			runtimeBatch,
			browserDestination,
			browserCameraFrame,
			viewportPoint,
			activeRenderAnchor,
		);
	}

	function scheduleCameraHint(
		hint: NonNullable<ReturnType<typeof buildCameraHint>>,
		immediate: boolean,
	): void {
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

	async function flushCameraHint(
		hint: NonNullable<ReturnType<typeof buildCameraHint>>,
	): Promise<void> {
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
				: `${formatHex32(activeRenderAnchor.landblockId)} via ${activeRenderAnchorSource ?? "unknown"}; chunks ${activeRenderChunkTransforms.length}`;
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
		const preparedOutdoorSceneIds = Object.keys(assetState.preparedByAssetId)
			.filter((assetId) => assetId.startsWith("outdoor-static-scene/"))
			.sort();
		const recentHistory = assetState.history
			.map((entry) => `${entry.status}:${entry.assetId}`)
			.join(" | ");
		return `outdoor scenes ${preparedOutdoorSceneIds.length}: ${preparedOutdoorSceneIds.slice(0, 4).join(", ") || "none"}; recent ${recentHistory || "none"}.`;
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

	function describeStaticRenderableIdleState(): string {
		if (staticRenderableScene.sourceInstances.length === 0) {
			return browserDestination?.kind === "indoor-env-cell" ||
				runtimeBatch?.residency.indoors
				? "No indoor static object source facts are active for the current visible env cells."
				: "No static renderable source facts are active for the current outdoor coverage.";
		}

		if (staticRenderableScene.missingSourceAssetIds.length > 0) {
			return `Waiting for ${staticRenderableScene.missingSourceAssetIds.length} static renderable source asset${staticRenderableScene.missingSourceAssetIds.length === 1 ? "" : "s"}.`;
		}

		if (staticRenderableScene.missingGfxAssetIds.length > 0) {
			return `Waiting for ${staticRenderableScene.missingGfxAssetIds.length} gfx geometry dependenc${staticRenderableScene.missingGfxAssetIds.length === 1 ? "y" : "ies"}.`;
		}

		return "Static renderable source facts are active, but no drawable gfx geometry is ready.";
	}

	function describeStructuredInteriorIdleState(): string {
		if (
			!runtimeBatch?.residency.indoors &&
			browserDestination?.kind !== "indoor-env-cell" &&
			linkedOutdoorEnvCellIds.length === 0
		) {
			return "Structured interior rendering is dormant while outdoor residency is active.";
		}

		if (structuredInteriorScene.missingEnvCellAssetIds.length > 0) {
			return `Waiting for ${structuredInteriorScene.missingEnvCellAssetIds.length} visible env-cell metadata payload${structuredInteriorScene.missingEnvCellAssetIds.length === 1 ? "" : "s"}.`;
		}

		if (structuredInteriorScene.missingEnvironmentAssetIds.length > 0) {
			return `Waiting for ${structuredInteriorScene.missingEnvironmentAssetIds.length} environment geometry payload${structuredInteriorScene.missingEnvironmentAssetIds.length === 1 ? "" : "s"}.`;
		}

		if (structuredInteriorScene.missingCellStructureKeys.length > 0) {
			return `Waiting for ${structuredInteriorScene.missingCellStructureKeys.length} selected cell-structure match${structuredInteriorScene.missingCellStructureKeys.length === 1 ? "" : "es"}.`;
		}

		return "Structured interior source facts are active, but no drawable cell geometry is ready.";
	}

	function describeAssetStateResourceRevision(
		state: AssetChannelState,
	): string {
		return [
			state.channel,
			state.status,
			Object.keys(state.preparedByAssetId).sort().join(","),
			Object.keys(state.cacheMetadataByAssetId).sort().join(","),
		].join(";");
	}

	function describeTerrainSceneResourceRevision(
		scene: TerrainSceneModel,
	): string {
		return [
			`focus=${scene.focusLandblockId ?? "none"}`,
			...scene.tiles.map(
				(tile) =>
					`${tile.assetId}:${tile.landblockId}:${tile.renderChunk.chunkKey}:${tile.dataSource}`,
			),
		].join("|");
	}

	function describeStaticRenderableSceneResourceRevision(
		scene: StaticRenderableSceneModel,
	): string {
		const groupSignature = [
			...scene.partsByRenderDomainChunkAndGfxAssetId.entries(),
		]
			.map(
				([groupKey, parts]) =>
					`${groupKey}:${parts.map((part) => part.renderKey).join(",")}`,
			)
			.sort()
			.join("|");
		return [
			`focus=${scene.focusLandblockId ?? "none"}`,
			`landblocks=${scene.activeLandblockIds.join(",")}`,
			`sources=${scene.sourceInstances.length}`,
			`parts=${scene.parts.length}`,
			`groups=${scene.partsByRenderDomainChunkAndGfxAssetId.size}`,
			`missingSources=${scene.missingSourceAssetIds.join(",")}`,
			`missingGfx=${scene.missingGfxAssetIds.join(",")}`,
			`groupHash=${hashDiagnosticString(groupSignature)}`,
		].join(";");
	}

	function describeStructuredInteriorSceneResourceRevision(
		scene: StructuredInteriorSceneModel,
	): string {
		return [
			`focus=${scene.focusEnvCellId ?? "none"}`,
			`active=${scene.activeEnvCellIds.join(",")}`,
			`cells=${scene.cells
				.map(
					(cell) =>
						`${cell.envCellId}:${cell.renderKey}:${cell.renderChunk.chunkKey}:${cell.portalCount}:${cell.staticObjectCount}:${cell.renderGeometry.vertexCount}:${cell.renderGeometry.triangleCount}`,
				)
				.sort()
				.join(",")}`,
			`missingEnv=${scene.missingEnvCellAssetIds.join(",")}`,
			`missingEnvironment=${scene.missingEnvironmentAssetIds.join(",")}`,
			`missingStructure=${scene.missingCellStructureKeys.join(",")}`,
		].join(";");
	}

	function describeTransitionPortalModelResourceRevision(
		model: TransitionPortalCandidateModel,
	): string {
		return [
			...model.candidates.map(
				(candidate) =>
					`${candidate.id}:${candidate.stencilRef}:${candidate.targetStatus}:${candidate.entryEnvCellId}:${candidate.requestedInteriorEnvCellIds.join(",")}`,
			),
			`diagnostics=${Object.values(model.diagnostics).join(",")}`,
		]
			.sort()
			.join("|");
	}

	function describeDebugOverlaySceneResourceRevision(
		scene: WorldDebugOverlayModel,
	): string {
		return [
			`portals=${scene.showPortalPolygons}`,
			`cells=${scene.showCellIndicators}`,
			`targets=${scene.highlightPortalTargets}`,
			`cellIds=${scene.cells.map((cell) => `${cell.envCellId}:${cell.colorKey}:${cell.isSelected}`).join(",")}`,
			`portalIds=${scene.portals.map((portal) => `${portal.portalId}:${portal.colorKey}:${portal.isSelected}:${portal.targetStatus}`).join(",")}`,
		].join(";");
	}

	function describeRenderSceneContextResourceRevision(
		context: WorldRenderSceneContext,
	): string {
		return `${context.kind}:${context.anchorLandblockId ?? "none"}`;
	}

	function describeRenderChunkTransformsResourceRevision(
		transforms: readonly RenderChunkTransform[],
	): string {
		return transforms
			.map(
				(transform) =>
					`${transform.chunkKey}:${transform.chunkLandblockId}:${transform.offset.x.toFixed(5)},${transform.offset.y.toFixed(5)},${transform.offset.z.toFixed(5)}`,
			)
			.join("|");
	}

	function describeSceneCameraFrameResourceRevision(
		frame: SceneCameraFrame | null,
	): string {
		if (!frame) {
			return "none";
		}
		return [
			frame.position.x,
			frame.position.y,
			frame.position.z,
			frame.target.x,
			frame.target.y,
			frame.target.z,
			frame.up.x,
			frame.up.y,
			frame.up.z,
			frame.fovDegrees,
			frame.near,
			frame.far,
			frame.aspect,
		]
			.map((entry) => entry.toFixed(5))
			.join(",");
	}

	function hashDiagnosticString(value: string): string {
		let hash = 0;
		for (let index = 0; index < value.length; index += 1) {
			hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
		}
		return (hash >>> 0).toString(16);
	}

	onDestroy(() => {
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
