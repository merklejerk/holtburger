<script lang="ts">
	import { onDestroy, onMount, tick } from "svelte";
	import { get } from "svelte/store";

	import { frontendState, type FrontendAppState } from "../app/frontend-state";
	import {
		describeBrowserDestinationIdentity,
		type BrowserLocationSelection,
	} from "../app/browser-mode";
	import type { AssetChannelState } from "../lib/assets/types";
	import { resolveRuntimeAppearance } from "../lib/host/tauri";
	import {
		buildSceneCameraRenderRay,
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
		syncBrowserFreeCameraStateFromFrame,
		type BrowserFreeCameraState,
		type SceneCameraFrame,
		describeSceneCameraFrame,
	} from "../lib/world-display/camera";
	import WorldDisplay from "../lib/world-display/WorldDisplay.svelte";
	import {
		normalizeViewportPoint,
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
	import {
		RuntimeAppearanceCache,
		type RuntimeAppearanceInput,
		type RuntimeAppearanceResolvedFacts as BaseRuntimeAppearanceResolvedFacts,
	} from "../lib/assets/runtime-appearance-cache";
	import type {
		RenderSpatialItemKind,
		RenderSpatialMetadata,
		RenderSpatialPick,
	} from "../lib/world-display/render-spatial-index";
	import {
		commitRenderAnchorCandidate,
		deriveRenderAnchorCandidate,
		type RenderAnchorSource,
	} from "../lib/world-display/render-anchor";
	import {
		DEBUG_OVERLAY_SPATIAL_OWNER_KEY,
		STATIC_RENDERABLE_SPATIAL_OWNER_KEY,
		STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY,
		TERRAIN_SPATIAL_OWNER_KEY,
	} from "../lib/world-display/render-spatial-scene";
	import type { RendererResourceGraph } from "../lib/world-display/renderer-resource-graph";
	import {
		convertCameraFrameBetweenAnchors,
		type RenderLandblockAnchor,
	} from "../lib/world-display/render-chunks";
	import {
		BrowserRenderResourceCoordinator,
		createEmptyBrowserRenderResourceReport,
		type BrowserRuntimeAppearancePreview,
		type BrowserRenderResourceCoordinatorInput,
		type BrowserRenderResourceReport,
	} from "../lib/world-display/browser-render-resource-coordinator";
	import {
		StaticLandblockRenderArtifactCoordinator,
		type StaticLandblockRenderArtifactCoordinatorInput,
	} from "../lib/world-display/static-landblock-render-artifact-coordinator";
	import type { BrowserStaticRenderablePickDiagnostic } from "../lib/world-display/browser-picker-diagnostics";
	import { buildRenderDebugReport } from "../lib/world-display/diagnostics/render-debug-report";
	import type {
		RuntimeAppearanceRequestDto,
		SetupAppearancePayloadDto,
	} from "../lib/host/contracts";
	import type { DrawUnitRuntimeDiagnostic } from "../lib/world-display/runtime-render-diagnostics";
	import BrowserModePanel from "./BrowserModePanel.svelte";

	interface BrowserPanelRow {
		label: string;
		value: string;
	}

	interface BrowserPanelSection {
		title: string;
		rows: BrowserPanelRow[];
	}

	type BrowserPickerFamily =
		| "static"
		| "structured"
		| "terrain"
		| "portal"
		| "debug";

	interface BrowserPickerOptions {
		pickableFamilies: Record<BrowserPickerFamily, boolean>;
	}

	interface BrowserPickerReport {
		statusText: string;
		sections: BrowserPanelSection[];
	}

	interface BrowserRenderablePickResult {
		pick: RenderSpatialPick;
		viewportPoint: NormalizedViewportPoint;
	}

	interface BrowserInspectorModel {
		title: string;
		kicker: string;
		rows: BrowserPanelRow[];
	}

	interface ResolvedRuntimeAppearanceFacts extends BaseRuntimeAppearanceResolvedFacts {
		setupAppearance: SetupAppearancePayloadDto;
	}

	interface RuntimeAppearancePreviewInstance extends BrowserRuntimeAppearancePreview {
		resolved: ResolvedRuntimeAppearanceFacts;
	}

	let {
		onRuntimeAppearanceAssetIdsChange,
		rendererResourceGraph,
	}: {
		onRuntimeAppearanceAssetIdsChange?: (assetIds: readonly string[]) => void;
		rendererResourceGraph?: RendererResourceGraph;
	} = $props();

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
	let cameraNearPlane = $state(
		initialFrontendState.browserMode.cameraNearPlane,
	);
	let cameraFarPlane = $state(initialFrontendState.browserMode.cameraFarPlane);
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
	let textureFilteringMode = $state(
		initialFrontendState.browserMode.textureFilteringMode,
	);
	let detailTexturesEnabled = $state(
		initialFrontendState.browserMode.detailTexturesEnabled,
	);
	let navigationFocusMode = $state(
		initialFrontendState.browserMode.navigationFocusMode,
	);

	let rootElement = $state<HTMLDivElement | null>(null);
	let worldDisplaySurface = $state<WorldDisplay | null>(null);
	const renderResourceCoordinator = new BrowserRenderResourceCoordinator();
	const staticLandblockRenderCoordinator =
		new StaticLandblockRenderArtifactCoordinator({
			onProductCommitted: (result) => {
				worldDisplaySurface?.commitStaticLandblockProduct(result);
				scheduleCurrentSceneResourceUpdate();
			},
			onProductEvicted: (key) => {
				worldDisplaySurface?.evictStaticLandblockProduct(key);
				scheduleCurrentSceneResourceUpdate();
			},
			onProductsCleared: () => {
				worldDisplaySurface?.clearStaticLandblockProducts();
				scheduleCurrentSceneResourceUpdate();
			},
			onStoreChanged: () => {
				scheduleCurrentSceneResourceUpdate();
			},
			onError: (error, desired) => {
				console.error("[holtburger-3d][static-landblock-render-worker]", {
					landblockId: desired.landblockId,
					product: desired.product,
					requestId: desired.requestId,
					message: error.message,
				});
			},
		});
	let renderResourceReport = $state<BrowserRenderResourceReport>(
		createEmptyBrowserRenderResourceReport(),
	);
	let renderMetrics = $state<WorldRenderMetrics | null>(null);
	let rendererCameraResidency = $state<BrowserCameraResidency | null>(null);
	let debugReportText = $state<string | null>(null);
	let debugReportCopied = $state(false);
	let browserCameraState = $state<BrowserFreeCameraState>(
		createBrowserFreeCameraState(),
	);
	let browserCameraFrame = $state<SceneCameraFrame | null>(null);
	let diagnosticSelection = $state<RenderSpatialMetadata | null>(null);
	let pickerOptions = $state<BrowserPickerOptions>({
		pickableFamilies: {
			static: true,
			structured: true,
			terrain: false,
			portal: false,
			debug: false,
		},
	});
	let pickerArmed = $state(false);
	let pickerResult = $state<BrowserRenderablePickResult | null>(null);
	let pickerMissText = $state("No target picked yet.");
	let pickerClipboardText = $state(
		"Picker reports copy to clipboard after a hit.",
	);
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
	const runtimeAppearanceCache =
		new RuntimeAppearanceCache<ResolvedRuntimeAppearanceFacts>({
			maxEntries: 24,
		});
	let runtimeAppearanceInput = $state<RuntimeAppearanceInput | null>(null);
	let runtimeAppearancePreviews = $state<RuntimeAppearancePreviewInstance[]>(
		[],
	);
	let runtimeAppearanceError = $state<string | null>(null);
	let runtimeAppearancePending = $state(false);
	let runtimeAppearanceRequestSequence = 0;
	let runtimeAppearancePreviewSequence = 0;

	const DEBUG_SUMMARY_DEBOUNCE_MS = 500;
	const worldDisplay = $derived(renderResourceReport.worldDisplay);
	const sceneGeometryText = $derived(renderResourceReport.sceneGeometryText);
	const terrainHeightText = $derived(renderResourceReport.terrainHeightText);
	const staticRenderableText = $derived(
		renderResourceReport.staticRenderableText,
	);
	const structuredInteriorText = $derived(
		renderResourceReport.structuredInteriorText,
	);
	const cellIndicatorText = $derived(renderResourceReport.cellIndicatorText);
	const portalDiagnosticsText = $derived(
		renderResourceReport.portalDiagnosticsText,
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
		const candidateBatchCount =
			debug.terrainBvhCandidateBatchCount +
			debug.staticBvhCandidateBatchCount +
			debug.structuredInteriorBvhCandidateBatchCount +
			debug.debugOverlayBvhCandidateBatchCount +
			debug.portalMaskBvhCandidateBatchCount;
		const staticCandidateRatio = describeRatio(
			debug.staticBvhCandidateBatchCount,
			candidateBatchCount,
		);
		const diagnosis =
			debug.renderCalls > 2_000
				? "draw-call/state-change bound; static artifact batching is the next meaningful reducer"
				: "draw pressure is not currently the dominant signal";
		const texturePageBuckets = summarizeRecord(
			debug.texturePageUsageBucketCounts,
		);
		const compactionMaterialFamilies = summarizeRecord(
			debug.compactionCoverageMaterialFamilyCounts,
		);
		const compactionRetainedFamilies = summarizeRecord(
			debug.compactionCoverageRetainedDirectMaterialFamilyCounts,
		);
		const compactionMaterialBlockers = summarizeRecord(
			debug.compactionCoverageMaterialBlockerCounts,
		);
		const compactionGeometryBlockers = summarizeRecord(
			debug.compactionCoverageGeometryBlockerCounts,
		);
		const fallbackSamples = summarizeSamples(debug.fallbackReasonSamples);
		const compactionBypassSamples = summarizeSamples(
			debug.compactionBypassSamples,
		);
		const terrainOneDrawBlockerSamples = summarizeSamples(
			debug.terrainOneDrawBlockerSamples,
		);
		const terrainOneDrawSubmitFallbackSamples = summarizeSamples(
			debug.terrainOneDrawSubmitFallbackSamples,
		);
		const directTexturePageFallbackSamples = summarizeSamples(
			debug.directTexturePageFallbackSamples,
		);
		const atlasFailureSamples = summarizeSamples(debug.atlasFailureSamples);
		const drawGroupTerm = "draw units";
		const performanceText = renderMetrics?.performance
			? `${renderMetrics.performance.fps.toFixed(1)} FPS, ${renderMetrics.performance.frameMs.toFixed(1)} ms/frame, ${renderMetrics.performance.renderMs.toFixed(1)} ms render`
			: "waiting for performance sample";
		return `Perf ${performanceText}. Diagnosis: ${diagnosis}. Draw pressure ${debug.renderCalls} visible draws from ${candidateBatchCount} candidate ${drawGroupTerm}; static candidates ${debug.staticBvhCandidateBatchCount}${staticCandidateRatio}; retained terrain ${debug.terrainRenderBatchCount}, static ${debug.staticRenderBatchCount}, interiors ${debug.structuredInteriorRenderBatchCount}; retained tris ${debug.renderTriangles}. Terrain family: visible ${debug.visibleTerrainTileCount}, ready ${debug.visibleTerrainOneDrawReadyTileCount}, blocked ${debug.visibleTerrainOneDrawBlockedTileCount}, ready slices ${debug.visibleTerrainDrawSliceReadyCount}, shader draws ${debug.terrainOneDrawShaderDrawCallCount}, submitted tiles ${debug.terrainOneDrawSubmittedTileCount}, submitted slices ${debug.terrainDrawSliceSubmittedCount}, tris ${debug.terrainOneDrawSubmittedTriangleCount}, atlas refs ${debug.terrainAtlasRefCount}, atlas candidates ${debug.terrainAtlasCandidateCount}, atlas blocker tiles ${debug.terrainAtlasBlockerTileCount}${terrainOneDrawBlockerSamples ? `, blockers ${terrainOneDrawBlockerSamples}` : ""}${terrainOneDrawSubmitFallbackSamples ? `, submit fallbacks ${terrainOneDrawSubmitFallbackSamples}` : ""}. Materials ${debug.materialCount}, textures ${debug.textureResourceCount}, indexed textures ${debug.indexedTextureResourceCount}, palettes ${debug.paletteResourceCount}; texture pages ${debug.texturePageBindingCount} bindings (${texturePageBuckets}), atlas failures ${debug.atlasFailureReasonCount}${atlasFailureSamples ? ` (${atlasFailureSamples})` : ""}; direct texture-page draws ${debug.directTexturePageDrawCount} (${debug.directPackedTexturePageDrawCount} packed, ${debug.directSingleEntryTexturePageDrawCount} single-entry)${directTexturePageFallbackSamples ? `, texture-page fallbacks ${directTexturePageFallbackSamples}` : ""}. Static eligibility: candidates ${debug.compactionCandidateDrawUnitCount}, families ${compactionMaterialFamilies}, retained direct families ${compactionRetainedFamilies}, material blockers ${compactionMaterialBlockers}, geometry blockers ${compactionGeometryBlockers}, bypasses ${debug.compactionBypassReasonCount}${compactionBypassSamples ? ` (${compactionBypassSamples})` : ""}. Fallbacks ${debug.fallbackReasonCount}${fallbackSamples ? ` (${fallbackSamples})` : ""}. Policy ${debug.renderGraphPolicy}, base ${debug.renderGraphBaseScene}, transition depth ${debug.transitionPortalMaxDepth}; canvas ${debug.canvasWidth}x${debug.canvasHeight} @${debug.pixelRatio.toFixed(2)}.`;
	});
	const sceneContextText = $derived(renderResourceReport.sceneContextText);
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
		renderResourceReport.landblockVisibilityText,
	);
	const cellVisibilityText = $derived.by(() => {
		const debug = renderMetrics?.debug;
		if (!debug) {
			return renderResourceReport.cellVisibilityFallbackText;
		}
		return `${debug.visibleStructuredInteriorMeshCount}/${debug.structuredInteriorMeshCount} rendered mesh${debug.structuredInteriorMeshCount === 1 ? "" : "es"}; ${renderResourceReport.cellVisibilityFallbackText}`;
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
		const performanceText = renderMetrics?.performance
			? `${renderMetrics.performance.fps.toFixed(1)} FPS, ${renderMetrics.performance.renderMs.toFixed(1)} ms render`
			: "waiting for perf";
		const drawGroupTerm = "draw units";
		return `${performanceText}; ${debug.renderCalls} visible draw${debug.renderCalls === 1 ? "" : "s"}, ${debug.renderTriangles} retained tris, ${debug.staticRenderBatchCount} static ${drawGroupTerm}, ${debug.structuredInteriorRenderBatchCount} interior ${drawGroupTerm}, ${debug.terrainRenderBatchCount} terrain tile${debug.terrainRenderBatchCount === 1 ? "" : "s"}.`;
	});
	const rendererBvhSummaryText = $derived.by(() => {
		const debug = renderMetrics?.debug;
		if (!debug) {
			return "Waiting for BVH metrics.";
		}
		const fallbackSamples = summarizeSamples(debug.fallbackReasonSamples);
		const drawGroupTerm = "draw units";
		return `BVH visible/candidate: terrain ${debug.terrainBvhVisibleItemCount}/${debug.terrainBvhTotalItemCount}, outdoor statics ${debug.outdoorStaticBvhVisibleItemCount}/${debug.outdoorStaticBvhTotalItemCount}, env local ${debug.envCellLocalBvhVisibleItemCount}/${debug.envCellLocalBvhTotalItemCount}. Candidate ${drawGroupTerm}: static ${debug.staticBvhCandidateBatchCount}/${debug.staticRenderBatchCount}, terrain ${debug.terrainBvhCandidateBatchCount}/${debug.terrainRenderBatchCount}, interiors ${debug.structuredInteriorBvhCandidateBatchCount}/${debug.structuredInteriorRenderBatchCount}, overlays ${debug.debugOverlayBvhCandidateBatchCount}/${debug.debugOverlayRenderBatchCount}, portal masks ${debug.portalMaskBvhCandidateBatchCount}/${debug.portalMaskRenderBatchCount}. Terrain submit: visible ${debug.visibleTerrainTileCount}, ready ${debug.visibleTerrainOneDrawReadyTileCount}, blocked ${debug.visibleTerrainOneDrawBlockedTileCount}, shader draws ${debug.terrainOneDrawShaderDrawCallCount}. Keys: static ${debug.visibleStaticInstanceKeyCount}, portals ${debug.visiblePortalKeyCount}, env cells ${debug.envCellBvhConsideredCount}. Fallback ${drawGroupTerm} ${debug.staticBvhFallbackIncludedBatchCount + debug.nonStaticBvhFallbackIncludedBatchCount}; fallback reasons ${debug.fallbackReasonCount}${fallbackSamples ? ` (${fallbackSamples})` : ""}; query ${debug.queryTimeMs.toFixed(2)} ms.`;
	});
	const runtimeAppearanceStatusText = $derived.by(() => {
		if (runtimeAppearancePending) {
			return "Resolving runtime appearance.";
		}
		if (runtimeAppearanceError) {
			return runtimeAppearanceError;
		}
		if (runtimeAppearancePreviews.length > 0) {
			return `${runtimeAppearancePreviews.length} preview object${runtimeAppearancePreviews.length === 1 ? "" : "s"} spawned.`;
		}
		return "No runtime appearance is active.";
	});
	const latestRuntimeAppearancePreview = $derived(
		runtimeAppearancePreviews.at(-1) ?? null,
	);
	const runtimeAppearanceRows = $derived<BrowserPanelRow[]>([
		{
			label: "Cache",
			value: describeRuntimeAppearanceCacheDiagnostics(),
		},
		{
			label: "Spawned",
			value: `${runtimeAppearancePreviews.length}`,
		},
		...(latestRuntimeAppearancePreview
			? [
					{
						label: "Latest",
						value: latestRuntimeAppearancePreview.resolved.appearanceKey,
					},
					{
						label: "Parts",
						value: `${latestRuntimeAppearancePreview.resolved.selectedGfxObjAssetIds.length} selected`,
					},
					{
						label: "Materials",
						value: `${latestRuntimeAppearancePreview.resolved.materialAssetIds.length} requested`,
					},
					{
						label: "Palettes",
						value: `${latestRuntimeAppearancePreview.resolved.paletteAssetIds.length} requested`,
					},
					{
						label: "Textures",
						value:
							latestRuntimeAppearancePreview.resolved.textureSwapSignature ??
							"base",
					},
					{
						label: "Palette view",
						value:
							latestRuntimeAppearancePreview.resolved.paletteViewSignature ??
							"base",
					},
				]
			: []),
	]);
	const cameraFrameText = $derived(
		browserCameraFrame
			? `${describeSceneCameraFrame(browserCameraFrame)} ${describeBrowserCameraControlMode()}`
			: "Camera frame is waiting for terrain.",
	);
	const cameraPipelineDebugText = $derived(describeCameraPipelineDebugState());
	const diagnosticInspector = $derived(
		deriveDiagnosticInspector(diagnosticSelection),
	);
	const pickerReport = $derived<BrowserPickerReport>(
		derivePickerReport(pickerResult, pickerMissText, pickerClipboardText),
	);
	const selectedStaticRenderableRenderKey = $derived(
		deriveSelectedStaticRenderableRenderKey(pickerResult),
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
	const sceneStatusText = $derived(renderResourceReport.sceneStatusText);
	const browserPanelSceneRows = $derived<BrowserPanelRow[]>([
		{ label: "Mode", value: sceneContextText },
		{ label: "Navigation", value: navigationFocusText },
		{ label: "Destination", value: worldDisplay.destinationFocusLabel },
		{ label: "Camera residency", value: cameraResidencyText },
		{ label: "Base scene", value: renderGraphText },
		{ label: "Landblocks", value: landblockVisibilityText },
		{
			label: "Worker artifacts",
			value: renderResourceReport.staticLandblockRenderArtifactText,
		},
		{ label: "Cells", value: cellVisibilityText },
		{ label: "Renderer", value: rendererSummaryText },
		{ label: "Materials", value: assetMaterialDebugText },
		{ label: "Assets", value: assetSummaryText },
	]);
	const browserPanelSceneDetailSections = $derived<BrowserPanelSection[]>([
		{
			title: "Geometry",
			rows: [
				{ label: "Terrain", value: renderResourceReport.terrainCacheText },
				{
					label: "Source",
					value: renderResourceReport.terrainDataSourceText,
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
		{ label: "BVH", value: rendererBvhSummaryText },
		{ label: "Assets", value: assetSummaryText },
	]);
	const browserPanelDebugDetailSections = $derived<BrowserPanelSection[]>([
		{
			title: "Input And Camera",
			rows: [{ label: "Events", value: cameraPipelineDebugText }],
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
					value: renderResourceReport.staticRenderableLayerText,
				},
			],
		},
		{
			title: "Render Pipeline",
			rows: [
				{ label: "Renderer", value: rendererDiagnosticsText },
				{ label: "BVH", value: rendererBvhSummaryText },
				{ label: "Stencil", value: portalRenderText },
			],
		},
	]);

	function describeRatio(value: number, total: number): string {
		if (total <= 0) {
			return "";
		}
		return ` (${((value / total) * 100).toFixed(0)}%)`;
	}

	function summarizeRecord(values: Record<string, number>): string {
		const entries = Object.entries(values)
			.filter(([, count]) => count > 0)
			.sort(([, left], [, right]) => right - left);
		if (entries.length === 0) {
			return "none";
		}
		return entries
			.slice(0, 4)
			.map(([key, count]) => `${key} ${count}`)
			.join(", ");
	}

	function summarizeSamples(samples: readonly string[]): string {
		if (samples.length === 0) {
			return "";
		}
		const counts = new Map<string, number>();
		for (const sample of samples) {
			const label = truncateDiagnosticSample(sample);
			counts.set(label, (counts.get(label) ?? 0) + 1);
		}
		return [...counts.entries()]
			.sort(([, left], [, right]) => right - left)
			.slice(0, 4)
			.map(([sample, count]) => (count === 1 ? sample : `${sample} x${count}`))
			.join(" || ");
	}

	function truncateDiagnosticSample(sample: string): string {
		const maxLength = 120;
		if (sample.length <= maxLength) {
			return sample;
		}
		return `${sample.slice(0, maxLength - 1)}…`;
	}

	function handleGenerateDebugReport(): void {
		debugReportText = buildCurrentFrameDebugReport();
		debugReportCopied = false;
	}

	function closeDebugReport(): void {
		debugReportText = null;
		debugReportCopied = false;
	}

	async function copyDebugReport(): Promise<void> {
		if (!debugReportText) {
			return;
		}
		await navigator.clipboard.writeText(debugReportText);
		debugReportCopied = true;
	}

	function handlePickerOptionsChange(options: BrowserPickerOptions): void {
		pickerOptions = options;
	}

	function handleTogglePickerMode(): void {
		pickerArmed = !pickerArmed;
		pickerMissText = pickerArmed
			? "Pick mode is active. Click a renderable in the scene."
			: "Pick mode canceled.";
	}

	function resolvePickerClick(viewportPoint: NormalizedViewportPoint): void {
		const pick = pickRenderableAtViewportPoint(viewportPoint);
		pickerArmed = false;
		if (!pick) {
			pickerClipboardText = "No picker report copied.";
			scheduleCurrentSceneResourceUpdate();
			return;
		}
		pickerResult = { pick, viewportPoint };
		pickerMissText = "";
		scheduleCurrentSceneResourceUpdate();
		void copyPickerReport({ pick, viewportPoint });
	}

	async function copyPickerReport(
		result: BrowserRenderablePickResult,
	): Promise<void> {
		const reportText = buildPickerClipboardReport(result);
		try {
			await navigator.clipboard.writeText(reportText);
			pickerClipboardText = "Picker report copied to clipboard.";
		} catch (error) {
			pickerClipboardText = `Clipboard copy failed: ${String(error)}`;
		}
	}

	function pickRenderableAtViewportPoint(
		viewportPoint: NormalizedViewportPoint,
	): RenderSpatialPick | null {
		const cameraFrame = getEffectiveBrowserCameraFrame();
		if (!cameraFrame) {
			pickerResult = null;
			pickerMissText = "Camera frame is not ready.";
			scheduleCurrentSceneResourceUpdate();
			return null;
		}
		const query = buildPickerQuery(pickerOptions);
		if (query.mask.size === 0) {
			pickerResult = null;
			pickerMissText = "No pickable renderable families are enabled.";
			scheduleCurrentSceneResourceUpdate();
			return null;
		}
		const pick = renderResourceReport.renderSpatialQuery.pickRay(
			buildSceneCameraRenderRay(cameraFrame, viewportPoint),
			query.mask,
			query.ownerKeys,
			query.acceptItem,
		);
		if (!pick) {
			pickerResult = null;
			pickerMissText = `No pick hit at ${formatViewportPoint(viewportPoint)}.`;
			scheduleCurrentSceneResourceUpdate();
			return null;
		}
		return pick;
	}

	function buildPickerQuery(options: BrowserPickerOptions): {
		mask: Set<RenderSpatialItemKind>;
		ownerKeys: Set<string>;
		acceptItem: (item: RenderSpatialPick["item"]) => boolean;
	} {
		const mask = new Set<RenderSpatialItemKind>();
		const ownerKeys = new Set<string>();
		const acceptedPairs = new Set<string>();
		if (options.pickableFamilies.static) {
			mask.add("outdoor-static");
			mask.add("building");
			mask.add("indoor-static");
			ownerKeys.add(STATIC_RENDERABLE_SPATIAL_OWNER_KEY);
			acceptedPairs.add(
				`${STATIC_RENDERABLE_SPATIAL_OWNER_KEY}:outdoor-static`,
			);
			acceptedPairs.add(`${STATIC_RENDERABLE_SPATIAL_OWNER_KEY}:building`);
			acceptedPairs.add(`${STATIC_RENDERABLE_SPATIAL_OWNER_KEY}:indoor-static`);
		}
		if (options.pickableFamilies.structured) {
			mask.add("structured-cell");
			ownerKeys.add(STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY);
			acceptedPairs.add(
				`${STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY}:structured-cell`,
			);
		}
		if (options.pickableFamilies.terrain) {
			mask.add("terrain");
			ownerKeys.add(TERRAIN_SPATIAL_OWNER_KEY);
			acceptedPairs.add(`${TERRAIN_SPATIAL_OWNER_KEY}:terrain`);
		}
		if (options.pickableFamilies.portal) {
			mask.add("portal");
			ownerKeys.add(DEBUG_OVERLAY_SPATIAL_OWNER_KEY);
			acceptedPairs.add(`${DEBUG_OVERLAY_SPATIAL_OWNER_KEY}:portal`);
		}
		if (options.pickableFamilies.debug) {
			mask.add("structured-cell");
			mask.add("portal");
			ownerKeys.add(DEBUG_OVERLAY_SPATIAL_OWNER_KEY);
			acceptedPairs.add(`${DEBUG_OVERLAY_SPATIAL_OWNER_KEY}:structured-cell`);
			acceptedPairs.add(`${DEBUG_OVERLAY_SPATIAL_OWNER_KEY}:portal`);
		}
		return {
			mask,
			ownerKeys,
			acceptItem: (item) => acceptedPairs.has(`${item.ownerKey}:${item.kind}`),
		};
	}

	function buildCurrentFrameDebugReport(): string {
		return buildRenderDebugReport({
			generatedAtIso: new Date().toISOString(),
			destinationFocusLabel: worldDisplay.destinationFocusLabel,
			sceneSummaryRows: browserPanelSceneRows,
			sceneDetailSections: browserPanelSceneDetailSections,
			debugSummaryRows: browserPanelDebugRows,
			debugDetailSections: browserPanelDebugDetailSections,
			pickerSections: pickerReport.sections,
			runtimeAppearanceStatusText,
			runtimeAppearanceRows,
			runtimeAppearancePayload: {
				pending: runtimeAppearancePending,
				error: runtimeAppearanceError,
				input: runtimeAppearanceInput,
				previews: runtimeAppearancePreviews.map((preview) => ({
					id: preview.id,
					setupModelId: preview.resolved.setupAppearance.setupModelId,
					appearanceKey: preview.resolved.setupAppearance.appearanceKey,
				})),
			},
		});
	}

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
			applyBrowserCameraFrame();
			return;
		}

		if (!browserCameraFrame && metrics.cameraFrame) {
			browserCameraFrame = metrics.cameraFrame;
			browserCameraState = syncBrowserFreeCameraStateFromFrame(
				browserCameraState,
				metrics.cameraFrame,
			);
			syncControlledCameraFrame();
		}
	}

	function handleRendererCameraFrameChange(
		cameraFrame: SceneCameraFrame,
	): void {
		if (!browserCameraFrame) {
			browserCameraFrame = cameraFrame;
			browserCameraState = syncBrowserFreeCameraStateFromFrame(
				browserCameraState,
				cameraFrame,
			);
			syncControlledCameraFrame();
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
		cameraNearPlane = state.browserMode.cameraNearPlane;
		cameraFarPlane = state.browserMode.cameraFarPlane;
		transitionPortalMaxDepth = state.browserMode.transitionPortalMaxDepth;
		showPortalPolygons = state.browserMode.showPortalPolygons;
		showCellIndicators = state.browserMode.showCellIndicators;
		highlightPortalTargets = state.browserMode.highlightPortalTargets;
		renderStyle = state.browserMode.renderStyle;
		textureFilteringMode = state.browserMode.textureFilteringMode;
		detailTexturesEnabled = state.browserMode.detailTexturesEnabled;
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
		const staticLandblockRenderInput =
			createStaticLandblockRenderCoordinatorInput();
		staticLandblockRenderCoordinator.sync(staticLandblockRenderInput);
		scheduleSceneResourceUpdate({
			assetState,
			browserDestination,
			terrainLodRadius,
			buildingLodRadius,
			detailLodRadius,
			envCellLodRadius,
			transitionPortalMaxDepth,
			renderStyle,
			textureFilteringMode,
			detailTexturesEnabled,
			showPortalPolygons,
			showCellIndicators,
			highlightPortalTargets,
			diagnosticSelection,
			selectedStaticRenderableRenderKey,
			activeRenderAnchor,
			browserCameraFrame: getEffectiveBrowserCameraFrame(),
			runtimeAppearancePreviews,
			staticLandblockRenderProducts:
				staticLandblockRenderCoordinator.getProductSet(),
		});
	}

	function createStaticLandblockRenderCoordinatorInput(): StaticLandblockRenderArtifactCoordinatorInput {
		return {
			browserDestination,
			terrainLodRadius,
			buildingLodRadius,
			detailLodRadius,
			envCellLodRadius,
		};
	}

	function handleRuntimeAppearanceSubmit(
		request: RuntimeAppearanceRequestDto,
	): void {
		const input: RuntimeAppearanceInput = {
			setupModelId: request.setupModelId,
			objDesc: request.objDesc,
		};
		runtimeAppearanceInput = input;
		runtimeAppearancePending = true;
		runtimeAppearanceError = null;
		runtimeAppearanceRequestSequence += 1;
		const requestSequence = runtimeAppearanceRequestSequence;

		void runtimeAppearanceCache
			.getOrResolve(input, async () =>
				createRuntimeAppearanceResolvedFacts(
					await resolveRuntimeAppearance(request),
				),
			)
			.then((resolved) => {
				if (runtimeAppearanceRequestSequence !== requestSequence) {
					return;
				}
				const spawnCameraFrame = browserCameraFrame;
				if (!spawnCameraFrame) {
					throw new Error(
						"Cannot spawn runtime appearance preview before the browser camera is ready.",
					);
				}
				const preview = createRuntimeAppearancePreviewInstance(
					resolved,
					spawnCameraFrame,
				);
				runtimeAppearancePreviews = [...runtimeAppearancePreviews, preview];
				runtimeAppearancePending = false;
				onRuntimeAppearanceAssetIdsChange?.(
					collectRuntimeAppearancePreviewAssetIds(runtimeAppearancePreviews),
				);
				scheduleCurrentSceneResourceUpdate();
			})
			.catch((error) => {
				if (runtimeAppearanceRequestSequence !== requestSequence) {
					return;
				}
				runtimeAppearancePending = false;
				runtimeAppearanceError =
					error instanceof Error ? error.message : String(error);
				scheduleCurrentSceneResourceUpdate();
			});
	}

	function clearRuntimeAppearance(): void {
		runtimeAppearanceInput = null;
		runtimeAppearancePreviews = [];
		runtimeAppearancePending = false;
		runtimeAppearanceError = null;
		runtimeAppearanceRequestSequence += 1;
		onRuntimeAppearanceAssetIdsChange?.([]);
		scheduleCurrentSceneResourceUpdate();
	}

	function createRuntimeAppearancePreviewInstance(
		resolved: ResolvedRuntimeAppearanceFacts,
		spawnCameraFrame: SceneCameraFrame,
	): RuntimeAppearancePreviewInstance {
		runtimeAppearancePreviewSequence += 1;
		return {
			id: `${resolved.appearanceKey}/${runtimeAppearancePreviewSequence}`,
			spawnCameraFrame,
			setupAppearance: resolved.setupAppearance,
			resolved,
		};
	}

	function createRuntimeAppearanceResolvedFacts(
		setupAppearance: SetupAppearancePayloadDto,
	): ResolvedRuntimeAppearanceFacts {
		const selectedGfxObjAssetIds = uniqueSortedStrings(
			setupAppearance.parts.map((part) => part.gfxObjAssetId),
		);
		return {
			setupModelId: setupAppearance.setupModelId,
			appearanceKey: setupAppearance.appearanceKey,
			selectedGfxObjAssetIds,
			materialAssetIds: uniqueSortedStrings(
				setupAppearance.dependencies.materialAssetIds,
			),
			paletteAssetIds: uniqueSortedStrings(
				setupAppearance.dependencies.paletteAssetIds,
			),
			textureChanges: setupAppearance.textureChanges,
			animPartChanges: setupAppearance.animPartChanges,
			paletteId: setupAppearance.paletteId,
			subPalettes: setupAppearance.subPalettes,
			selectedPartsSignature:
				selectedGfxObjAssetIds.length === 0
					? null
					: selectedGfxObjAssetIds.join(","),
			textureSwapSignature:
				setupAppearance.textureChanges.length === 0
					? null
					: setupAppearance.textureChanges
							.map(
								(change) =>
									`${change.partIndex}:${formatHex32(change.oldTexture)}>${formatHex32(change.newTexture)}`,
							)
							.join(","),
			paletteViewSignature:
				setupAppearance.paletteId === null &&
				setupAppearance.subPalettes.length === 0
					? null
					: [
							`base=${setupAppearance.paletteId === null ? "material" : formatHex32(setupAppearance.paletteId)}`,
							`sub=${setupAppearance.subPalettes
								.map(
									(subPalette) =>
										`${formatHex32(subPalette.subId)}@${subPalette.offset}+${subPalette.numColors}`,
								)
								.join(",")}`,
						].join("|"),
			setupAppearance,
		};
	}

	function collectRuntimeAppearancePreviewAssetIds(
		previews: readonly RuntimeAppearancePreviewInstance[],
	): string[] {
		return uniqueSortedStrings(
			previews.flatMap((preview) => {
				const { resolved } = preview;
				return [
					`setup-model/${formatHex32(resolved.setupModelId).toLowerCase()}`,
					...resolved.selectedGfxObjAssetIds,
					...resolved.materialAssetIds,
					...resolved.paletteAssetIds,
				];
			}),
		);
	}

	function describeRuntimeAppearanceCacheDiagnostics(): string {
		const diagnostics = runtimeAppearanceCache.diagnostics();
		return `${diagnostics.size}/${diagnostics.maxEntries} entries; ${diagnostics.hits} hits, ${diagnostics.misses} misses, ${diagnostics.evictions} evictions.`;
	}

	function uniqueSortedStrings(values: readonly string[]): string[] {
		return [...new Set(values)].sort();
	}

	function syncControlledCameraFrame(): void {
		renderResourceCoordinator.updateControlledCameraFrame(
			getEffectiveBrowserCameraFrame(),
		);
	}

	function getEffectiveBrowserCameraFrame(): SceneCameraFrame | null {
		if (!browserCameraFrame) {
			return null;
		}

		return {
			...browserCameraFrame,
			near: cameraNearPlane,
			far: cameraFarPlane,
		};
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
				renderResourceReport = renderResourceCoordinator.update(nextInput);
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
		applyBrowserCameraFrame();
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
		applyBrowserCameraFrame();
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
		applyBrowserCameraFrame();
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

		if (!rootElement) {
			return;
		}

		const viewportPoint = getViewportPoint(event);

		if (pickerArmed) {
			resolvePickerClick(viewportPoint);
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		if (!event.ctrlKey) {
			const cameraFrame = getEffectiveBrowserCameraFrame();
			const diagnosticPick = cameraFrame
				? renderResourceReport.renderSpatialQuery.pickRay(
						buildSceneCameraRenderRay(cameraFrame, viewportPoint),
						new Set(["portal", "structured-cell"]),
						new Set([DEBUG_OVERLAY_SPATIAL_OWNER_KEY]),
					)
				: null;
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

		const cameraFrame = getEffectiveBrowserCameraFrame();
		const terrainPick = cameraFrame
			? renderResourceReport.renderSpatialQuery.pickRay(
					buildSceneCameraRenderRay(cameraFrame, viewportPoint),
					new Set(["terrain"]),
					new Set([TERRAIN_SPATIAL_OWNER_KEY]),
				)
			: null;
		const landblockId =
			terrainPick?.item.metadata.kind === "terrain"
				? terrainPick.item.metadata.landblockId
				: null;

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

	function derivePickerReport(
		result: BrowserRenderablePickResult | null,
		missText: string,
		clipboardText: string,
	): BrowserPickerReport {
		if (!result) {
			return {
				statusText: missText,
				sections: [
					{
						title: "Target",
						rows: [
							{ label: "Status", value: missText },
							{ label: "Clipboard", value: clipboardText },
						],
					},
				],
			};
		}

		const { pick, viewportPoint } = result;
		const staticDiagnostic = getStaticPickDiagnostic(pick.item.metadata);
		const runtimeDiagnostics =
			getRuntimeDiagnosticsForStaticDiagnostic(staticDiagnostic);
		return {
			statusText: `Picked ${describePickedMetadataTitle(pick.item.metadata)} at ${pick.distance.toFixed(2)}m.`,
			sections: [
				{
					title: "Hit",
					rows: [
						{ label: "Clipboard", value: clipboardText },
						{ label: "Item", value: pick.item.id },
						{ label: "Kind", value: pick.item.kind },
						{ label: "Owner", value: pick.item.ownerKey },
						{ label: "Chunk", value: pick.item.chunkKey },
						{ label: "Distance", value: pick.distance.toFixed(3) },
						{ label: "Point", value: formatRenderPoint(pick.point) },
						{ label: "Viewport", value: formatViewportPoint(viewportPoint) },
					],
				},
				{
					title: "Metadata",
					rows: describePickedMetadataRows(pick.item.metadata),
				},
				...(staticDiagnostic
					? describeStaticPickDiagnosticSections(staticDiagnostic)
					: []),
				...(runtimeDiagnostics.length > 0
					? describeRuntimeDiagnosticSections(runtimeDiagnostics)
					: []),
			],
		};
	}

	function describePickedMetadataTitle(
		metadata: RenderSpatialMetadata,
	): string {
		if (metadata.kind === "static-renderable") {
			return metadata.renderKey;
		}
		if (metadata.kind === "structured-cell") {
			return `structured cell 0x${formatHex32(metadata.envCellId)}`;
		}
		if (metadata.kind === "portal") {
			return metadata.portalId;
		}
		return `terrain 0x${formatHex32(metadata.landblockId)}`;
	}

	function deriveSelectedStaticRenderableRenderKey(
		result: BrowserRenderablePickResult | null,
	): string | null {
		const metadata = result?.pick.item.metadata;
		return metadata?.kind === "static-renderable" ? metadata.renderKey : null;
	}

	function describePickedMetadataRows(
		metadata: RenderSpatialMetadata,
	): BrowserPanelRow[] {
		if (metadata.kind === "static-renderable") {
			return [
				{ label: "Renderable", value: metadata.renderKey },
				{ label: "Instance", value: metadata.instanceId },
				{ label: "Static kind", value: metadata.staticKind },
				{ label: "Domain", value: metadata.renderDomain },
				{
					label: "Landblock",
					value: `0x${formatHex32(metadata.owningLandblockId)}`,
				},
				{
					label: "Env cell",
					value:
						metadata.owningEnvCellId === null
							? "none"
							: `0x${formatHex32(metadata.owningEnvCellId)}`,
				},
				{ label: "Source", value: metadata.sourceAssetId },
				{ label: "Gfx object", value: metadata.gfxObjAssetId },
				{ label: "Gfx DID", value: `0x${formatHex32(metadata.gfxObjId)}` },
				{ label: "Part", value: metadata.partIndex.toString() },
				{
					label: "Material slots",
					value: metadata.materialSlotCount.toString(),
				},
				{ label: "Material", value: metadata.materialSignature },
				{ label: "Detail role", value: metadata.detailRoleKind },
				{ label: "Detail", value: metadata.detailSignature },
				{ label: "Texture velocity", value: metadata.textureVelocitySignature },
			];
		}
		if (metadata.kind === "structured-cell") {
			return [
				{ label: "Env cell", value: `0x${formatHex32(metadata.envCellId)}` },
				{ label: "Render key", value: metadata.renderKey },
				{ label: "Role", value: metadata.isFocus ? "Focus" : "Visible" },
			];
		}
		if (metadata.kind === "portal") {
			return [
				{ label: "Portal", value: metadata.portalId },
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
			];
		}
		return [
			{ label: "Landblock", value: `0x${formatHex32(metadata.landblockId)}` },
			{ label: "Asset", value: metadata.assetId },
			{
				label: "Terrain quad",
				value: metadata.terrainQuad
					? `${metadata.terrainQuad.row},${metadata.terrainQuad.col}`
					: "bounds-level",
			},
		];
	}

	function describeStaticPickDiagnosticSections(
		diagnostic: BrowserStaticRenderablePickDiagnostic,
	): BrowserPanelSection[] {
		return [
			{
				title: "Static Draw Units",
				rows:
					diagnostic.drawUnits.length === 0
						? [
								{
									label: "Status",
									value: "No staged static draw units matched this render key.",
								},
							]
						: diagnostic.drawUnits.flatMap((drawUnit, index) => [
								{
									label: `Draw ${index}`,
									value: drawUnit.drawUnitId,
								},
								{
									label: `Material ${index}`,
									value: describeStaticDiagnosticMaterial(drawUnit.material),
								},
								{
									label: `UV ${index}`,
									value: describeStaticDiagnosticUv(drawUnit.geometry.uv),
								},
							]),
			},
		];
	}

	function describeStaticDiagnosticMaterial(
		material: BrowserStaticRenderablePickDiagnostic["drawUnits"][number]["material"],
	): string {
		if (material.kind === "direct-texture") {
			return [
				material.kind,
				material.textureKey,
				material.renderSurfaceId,
				material.size,
				`wrap=${material.wrap}`,
				`filter=${material.filter}`,
				`page=${material.texturePageReadiness?.atlasEntryKey ?? "none"}`,
				`detail=${material.detailOverlay ? `${material.detailOverlay.renderSurfaceId}@${material.detailOverlay.tiling}` : "none"}`,
			].join("; ");
		}
		if (material.kind === "indexed-paletted") {
			return [
				material.kind,
				material.key,
				`format=${material.indexFormat}`,
				`size=${material.indexSize}`,
				`paletteColors=${material.paletteColorCount}`,
				`wrap=${material.wrap}`,
				`detail=${material.detailOverlay ? `${material.detailOverlay.renderSurfaceId}@${material.detailOverlay.tiling}` : "none"}`,
			].join("; ");
		}
		return [
			material.kind,
			material.key,
			`fallback=${material.fallbackReason ?? "none"}`,
		].join("; ");
	}

	function describeStaticDiagnosticUv(
		uv: BrowserStaticRenderablePickDiagnostic["drawUnits"][number]["geometry"]["uv"],
	): string {
		if (uv.coordinateCount === 0) {
			return "none";
		}
		return [
			`count=${uv.coordinateCount}`,
			`u=${formatNullableNumber(uv.minU)}..${formatNullableNumber(uv.maxU)}`,
			`v=${formatNullableNumber(uv.minV)}..${formatNullableNumber(uv.maxV)}`,
			`span=${formatNullableNumber(uv.spanU)}x${formatNullableNumber(uv.spanV)}`,
			`outside01=${uv.outsideUnitSquare}`,
		].join("; ");
	}

	function describeRuntimeDiagnosticSections(
		diagnostics: readonly DrawUnitRuntimeDiagnostic[],
	): BrowserPanelSection[] {
		return [
			{
				title: "Runtime Render Paths",
				rows: diagnostics.map((diagnostic, index) => ({
					label: `Path ${index}`,
					value: describeRuntimeDiagnosticSummary(diagnostic),
				})),
			},
		];
	}

	function describeRuntimeDiagnosticSummary(
		diagnostic: DrawUnitRuntimeDiagnostic,
	): string {
		if (!diagnostic.drawUnit) {
			return `${diagnostic.submissionPath}; ${diagnostic.drawUnitId}`;
		}
		return [
			diagnostic.submissionPath,
			`kind=${diagnostic.drawUnit.kind}`,
			`material=${diagnostic.drawUnit.materialKind}`,
			`family=${diagnostic.drawUnit.compactionMaterialFamily}`,
			`decision=${diagnostic.drawUnit.compactionDecision}`,
			`finalPlan=${diagnostic.drawUnit.finalCompactionPlan.status}`,
			`planSlot=${diagnostic.drawUnit.finalCompactionPlan.materialSlotKey ?? "none"}`,
			`planBypasses=${
				diagnostic.drawUnit.finalCompactionPlan.bypasses
					.map((bypass) => bypass.reason)
					.join(",") || "none"
			}`,
			`alpha=${diagnostic.drawUnit.compactionAlphaPolicy}`,
			`materialBlockers=${diagnostic.drawUnit.compactionMaterialBlockers.join(",") || "none"}`,
			`geometryBlockers=${diagnostic.drawUnit.compactionGeometryBlockers.join(",") || "none"}`,
		].join("; ");
	}

	function buildPickerClipboardReport(
		result: BrowserRenderablePickResult,
	): string {
		const staticDiagnostic = getStaticPickDiagnostic(result.pick.item.metadata);
		const runtimeDiagnostics =
			getRuntimeDiagnosticsForStaticDiagnostic(staticDiagnostic);
		const report = {
			generatedAt: new Date().toISOString(),
			hit: {
				itemId: result.pick.item.id,
				kind: result.pick.item.kind,
				owner: result.pick.item.ownerKey,
				chunk: result.pick.item.chunkKey,
				distance: result.pick.distance,
				point: result.pick.point,
				viewport: result.viewportPoint,
			},
			metadata: result.pick.item.metadata,
			staticRenderableDiagnostics: staticDiagnostic,
			runtimeRenderDiagnostics: runtimeDiagnostics,
			notes: staticDiagnostic
				? [
						runtimeDiagnostics.length === 0
							? "Static diagnostics are renderer CPU facts. Runtime WebGL draw-unit facts were unavailable, usually because the renderer had not finished loading resources."
							: "Static diagnostics are renderer CPU facts. Runtime render diagnostics are current WebGL2 resource-store facts for the matching draw unit ids.",
					]
				: [],
		};
		return JSON.stringify(report, null, 2);
	}

	function getRuntimeDiagnosticsForStaticDiagnostic(
		staticDiagnostic: BrowserStaticRenderablePickDiagnostic | null,
	): readonly DrawUnitRuntimeDiagnostic[] {
		if (!staticDiagnostic) {
			return [];
		}
		return (
			worldDisplaySurface?.getDrawUnitRuntimeDiagnostics(
				staticDiagnostic.drawUnits.map((drawUnit) => drawUnit.drawUnitId),
			) ?? []
		);
	}

	function getStaticPickDiagnostic(
		metadata: RenderSpatialMetadata,
	): BrowserStaticRenderablePickDiagnostic | null {
		return metadata.kind === "static-renderable"
			? renderResourceCoordinator.getStaticRenderablePickDiagnostic(
					metadata.renderKey,
				)
			: null;
	}

	function formatNullableNumber(value: number | null): string {
		return value === null ? "n/a" : value.toFixed(4);
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
		if (metadata.kind === "static-renderable") {
			return {
				title: metadata.renderKey,
				kicker: "Static renderable",
				rows: [
					{ label: "Instance", value: metadata.instanceId },
					{ label: "Kind", value: metadata.staticKind },
					{ label: "Domain", value: metadata.renderDomain },
					{
						label: "Landblock",
						value: `0x${formatHex32(metadata.owningLandblockId)}`,
					},
					{ label: "Gfx object", value: metadata.gfxObjAssetId },
					{ label: "Part", value: metadata.partIndex.toString() },
					{ label: "Material", value: metadata.materialSignature },
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

	function formatRenderPoint(point: {
		x: number;
		y: number;
		z: number;
	}): string {
		return `(${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`;
	}

	function formatViewportPoint(point: NormalizedViewportPoint): string {
		return `${point.normalizedX.toFixed(3)}, ${point.normalizedY.toFixed(3)}`;
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

	function applyBrowserCameraFrame(): void {
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
		applyBrowserCameraFrame();
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

	function describeBrowserCameraControlMode(): string {
		return browserCameraState.hasManualControl
			? "Browser camera: manual free camera."
			: "Browser camera: auto-fit.";
	}

	function describeCameraPipelineDebugState(): string {
		const renderAnchorText =
			activeRenderAnchor === null
				? "none"
				: `${formatHex32(activeRenderAnchor.landblockId)} via ${activeRenderAnchorSource ?? "unknown"}; chunks ${renderResourceReport.activeRenderChunkCount}`;
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
		const problemCount = assetState.history.filter(
			(entry) => entry.status !== "prepared",
		).length;
		return `landblock routes ${preparedLandblockRouteIds.length}: ${preparedLandblockRouteIds.slice(0, 4).join(", ") || "none"}; asset history problems ${problemCount}.`;
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
		staticLandblockRenderCoordinator.dispose();
		if (debugSummaryTimer) {
			clearTimeout(debugSummaryTimer);
			debugSummaryTimer = null;
		}
		if (renderResourceUpdateTimer) {
			clearTimeout(renderResourceUpdateTimer);
			renderResourceUpdateTimer = null;
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
		{rendererResourceGraph}
		onCameraFrameChange={handleRendererCameraFrameChange}
		onRenderMetricsChange={handleRenderMetricsChange}
		onCameraResidencyChange={handleRendererCameraResidencyChange}
	/>

	<div class="browser-world-display__fps">{renderPerformanceText}</div>

	<div class="browser-world-display__panel">
		<BrowserModePanel
			{sceneStatusText}
			sceneSummaryRows={browserPanelSceneRows}
			canResetCamera={Boolean(renderMetrics?.bounds)}
			onResetCamera={resetBrowserCamera}
			onGenerateDebugReport={handleGenerateDebugReport}
			{pickerOptions}
			{pickerReport}
			{pickerArmed}
			onPickerOptionsChange={handlePickerOptionsChange}
			onTogglePickerMode={handleTogglePickerMode}
		/>
	</div>

	{#if debugReportText !== null}
		<div class="browser-world-display__modal-backdrop" data-browser-panel>
			<div
				class="browser-world-display__debug-report-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="debug-report-title"
			>
				<div class="browser-world-display__debug-report-header">
					<div>
						<p>One-frame diagnostics</p>
						<h2 id="debug-report-title">Debug Report</h2>
					</div>
					<button type="button" onclick={closeDebugReport}>Close</button>
				</div>
				<textarea readonly spellcheck="false" value={debugReportText}
				></textarea>
				<div class="browser-world-display__debug-report-actions">
					<span>{debugReportCopied ? "Copied." : "Ready to copy."}</span>
					<button type="button" onclick={copyDebugReport}>Copy</button>
				</div>
			</div>
		</div>
	{/if}

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
