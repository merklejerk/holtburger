<script lang="ts">
	import { onDestroy, onMount, tick } from "svelte";
	import { get } from "svelte/store";

	import { frontendState, type FrontendAppState } from "../app/frontend-state";
	import {
		describeBrowserDestinationIdentity,
		type BrowserLocationSelection,
	} from "../app/browser-mode";
	import type { AssetChannelState } from "../lib/assets/types";
	import {
		countPreparedAssetsByKindFromResolver,
		type PreparedAssetResolver,
	} from "../lib/assets/prepared-asset-store";
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
	import {
		createEmptyRenderResourceInspectionSnapshot,
		formatRenderResourceInspectionKeyForDisplay,
		type RenderResourceInspectionSnapshot,
		type RenderResourceTexturePageIdentity,
		type RenderResourceTexturePagePreview,
	} from "../lib/world-display/render-resource-inspection";
	import { isPreparedGfxObjAsset } from "../lib/world-display/static-renderables";
	import { formatHex32 } from "../lib/landblocks";
	import { formatPreparedAssetKindCounts } from "../lib/assets/asset-cache-diagnostics";
	import { getPreparedAssetHotPathDiagnosticsSnapshot } from "../lib/assets/prepared-asset-hot-path-diagnostics";
	import { describeMaterialAssetDiagnostics } from "../lib/assets/material-diagnostics";
	import {
		createCadencedDirtySampler,
		type CadencedDirtySampler,
	} from "../lib/diagnostics/cadenced-dirty-sampler";
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
	import {
		convertCameraFrameBetweenAnchors,
		type RenderLandblockAnchor,
	} from "../lib/world-display/render-chunks";
	import {
		BrowserRenderResourceCoordinator,
		createEmptyBrowserRenderResourceReport,
		type BrowserRenderResourceCoordinatorInput,
		type BrowserRenderResourceReport,
	} from "../lib/world-display/browser-render-resource-coordinator";
	import type { StaticLandblockProductSource } from "../lib/world-display/static-landblock-product-source";
	import { buildRenderDebugReport } from "../lib/world-display/diagnostics/render-debug-report";
	import BrowserModePanel from "./BrowserModePanel.svelte";

	interface BrowserPanelRow {
		label: string;
		value: string;
	}

	let {
		preparedAssetResolver,
		staticLandblockProductSource,
	}: {
		preparedAssetResolver: PreparedAssetResolver;
		staticLandblockProductSource: StaticLandblockProductSource;
	} = $props();

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
	let renderResourceReport = $state<BrowserRenderResourceReport>(
		createEmptyBrowserRenderResourceReport(),
	);
	let renderMetrics = $state<WorldRenderMetrics | null>(null);
	let resourceInspection = $state<RenderResourceInspectionSnapshot>(
		createEmptyRenderResourceInspectionSnapshot(),
	);
	let texturePreview = $state<RenderResourceTexturePagePreview | null>(null);
	let texturePreviewError = $state<string | null>(null);
	let texturePreviewCanvas = $state<HTMLCanvasElement | null>(null);
	let texturePreviewStage = $state<HTMLDivElement | null>(null);
	let texturePreviewZoom = $state(1);
	let texturePreviewShowAtlasBounds = $state(true);
	let selectedTexturePreviewEntryKey = $state<string | null>(null);
	let texturePreviewDrag = $state<{
		pointerId: number;
		startX: number;
		startY: number;
		lastX: number;
		lastY: number;
	} | null>(null);
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
	let renderPresentationResourceUpdateTimer: ReturnType<
		typeof setTimeout
	> | null = null;
	let pendingRenderPresentationResourceInput: BrowserRenderResourceCoordinatorInput | null =
		null;
	let cameraMovementFrameId: number | null = null;
	let lastCameraMovementFrameAt: number | null = null;
	let keyboardLinearMovementStartedAt: number | null = null;
	let isCameraSlowModifierActive = false;
	const pressedCameraControlKeys = new Set<string>();
	let lastAppliedFollowResidencyKey: string | null = null;
	let lastManualFitDestinationIdentity: string | null = null;
	let assetDiagnosticsSampler: CadencedDirtySampler | null = null;
	let assetSummaryText = $state("Waiting for asset activity.");
	let assetDebugText = $state("Waiting for asset activity.");
	let assetPipelineDebugText = $state("Waiting for asset activity.");
	let assetCacheDebugText = $state("Waiting for asset cache activity.");
	let assetMaterialDebugText = $state("Waiting for material asset activity.");

	$effect(() => {
		if (!texturePreview || !texturePreviewCanvas) {
			return;
		}
		texturePreviewCanvas.width = texturePreview.width;
		texturePreviewCanvas.height = texturePreview.height;
		const context = texturePreviewCanvas.getContext("2d");
		if (!context) {
			return;
		}
		context.putImageData(
			new ImageData(
				texturePreview.pixels,
				texturePreview.width,
				texturePreview.height,
			),
			0,
			0,
		);
		if (texturePreviewShowAtlasBounds) {
			drawTexturePreviewEntryBounds(
				context,
				texturePreview.entries,
				selectedTexturePreviewEntryKey,
			);
		} else if (selectedTexturePreviewEntry) {
			drawTexturePreviewSelectedEntryBounds(
				context,
				selectedTexturePreviewEntry,
			);
		}
	});

	const ASSET_DIAGNOSTICS_SAMPLE_MS = 1_000;
	const MIN_TEXTURE_PREVIEW_ZOOM = 0.05;
	const MAX_TEXTURE_PREVIEW_ZOOM = 32;
	const TEXTURE_PREVIEW_ZOOM_STEP = 1.25;
	const TEXTURE_PREVIEW_WHEEL_ZOOM_STEP = 1.08;
	const TEXTURE_PREVIEW_CLICK_MOVE_THRESHOLD = 4;
	const worldDisplay = $derived(renderResourceReport.worldDisplay);
	const sceneGeometryText = $derived(renderResourceReport.sceneGeometryText);
	const terrainHeightText = $derived(renderResourceReport.terrainHeightText);
	const staticRenderableText = $derived(
		renderResourceReport.staticRenderableText,
	);
	const structuredInteriorText = $derived(
		renderResourceReport.structuredInteriorText,
	);
	const selectedTexturePreviewEntry = $derived(
		texturePreview?.entries.find(
			(entry) => entry.sourcePlacementKey === selectedTexturePreviewEntryKey,
		) ?? null,
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
		const fallbackSamples = summarizeSamples(debug.fallbackReasonSamples);
		const terrainOneDrawBlockerSamples = summarizeSamples(
			debug.terrainOneDrawBlockerSamples,
		);
		const terrainOneDrawSubmitFallbackSamples = summarizeSamples(
			debug.terrainOneDrawSubmitFallbackSamples,
		);
		const materialSurfaceSubmitFallbackSamples = summarizeSamples(
			debug.materialSurfaceSubmitFallbackSamples,
		);
		const staticBundleLayerCoverageSamples = summarizeSamples(
			debug.staticBundleSelectedLayerCoverageSamples,
		);
		const staticBundleMaterialFamilies = summarizeRecord(
			debug.staticBundleMaterialFamilyCounts,
		);
		const staticBundleAlphaPolicies = summarizeRecord(
			debug.staticBundleMaterialAlphaPolicyCounts,
		);
		const staticBundleBindingUsages = summarizeRecord(
			debug.staticBundleMaterialBindingUsageCounts,
		);
		const materialSurfaceSkipReasons = summarizeRecord(
			debug.materialSurfaceSkippedReasonCounts,
		);
		const materialSurfaceSkippedFamilies = summarizeRecord(
			debug.materialSurfaceSkippedFamilyCounts,
		);
		const materialSurfaceSkippedAlphaPolicies = summarizeRecord(
			debug.materialSurfaceSkippedAlphaPolicyCounts,
		);
		const materialSurfaceSkippedBindingUsages = summarizeRecord(
			debug.materialSurfaceSkippedBindingUsageCounts,
		);
		const materialSurfaceSubmittedByDomain = summarizeRecord(
			debug.materialSurfaceSubmittedCountsByDomain,
		);
		const materialSurfaceDrawsByDomain = summarizeRecord(
			debug.materialSurfaceDrawCallCountsByDomain,
		);
		const materialSurfaceTrianglesByDomain = summarizeRecord(
			debug.materialSurfaceTriangleCountsByDomain,
		);
		const materialSurfaceSkippedByDomain = summarizeRecord(
			debug.materialSurfaceSkippedCountsByDomain,
		);
		const staticProductDomains = summarizeRecord(
			debug.staticLandblockProductDomainCounts,
		);
		const staticBundleProductDomains = summarizeRecord(
			debug.staticBundleProductDomainCounts,
		);
		const structuredInteriorProductDomains = summarizeRecord(
			debug.structuredInteriorProductDomainCounts,
		);
		const terrainProductDomains = summarizeRecord(
			debug.terrainProductDomainCounts,
		);
		const atlasFailureSamples = summarizeSamples(debug.atlasFailureSamples);
		const drawGroupTerm = "render resources";
		const performanceText = renderMetrics?.performance
			? `${renderMetrics.performance.fps.toFixed(1)} FPS, ${renderMetrics.performance.frameMs.toFixed(1)} ms/frame, ${renderMetrics.performance.renderMs.toFixed(1)} ms render`
			: "waiting for performance sample";
		return `Perf ${performanceText}. Diagnosis: ${diagnosis}. Draw pressure ${debug.renderCalls} visible draws from ${candidateBatchCount} candidate ${drawGroupTerm}; asset syncs ${debug.rendererAssetSyncCount}, latest recommitted ${debug.latestRendererAssetSyncRecommittedProductCount} product${debug.latestRendererAssetSyncRecommittedProductCount === 1 ? "" : "s"}, scheduled frame ${debug.latestRendererAssetSyncScheduledFrame ? "yes" : "no"}; static product resources ${debug.staticLandblockProductCount} products (${staticProductDomains}), ${debug.staticBundleLayerResourceCount} bundle layers (${staticBundleProductDomains}), ${debug.structuredInteriorCellResourceCount} interior cells (${structuredInteriorProductDomains}), ${debug.terrainProductResourceCount} terrain products (${terrainProductDomains}), ${debug.transitionPortalMaskResourceCount} portal masks; retained tris ${debug.renderTriangles}. Material surfaces: submitted ${debug.materialSurfaceSubmittedCount} (${materialSurfaceSubmittedByDomain}), draws ${materialSurfaceDrawsByDomain}, tris ${materialSurfaceTrianglesByDomain}, skipped ${debug.materialSurfaceSkippedCount} (${materialSurfaceSkippedByDomain}; reasons ${materialSurfaceSkipReasons}; families ${materialSurfaceSkippedFamilies}; alpha ${materialSurfaceSkippedAlphaPolicies}; bindings ${materialSurfaceSkippedBindingUsages})${materialSurfaceSubmitFallbackSamples ? `, fallbacks ${materialSurfaceSubmitFallbackSamples}` : ""}. Static bundle layers: selected ${debug.visibleStaticBundleLayerCount}, submitted layers ${debug.staticBundleLayerSubmittedCount}, objects ${debug.staticBundleSelectedObjectRecordCount}/${debug.staticBundleSelectedSourceObjectCount}, hints ${debug.staticBundleSelectedSpatialHintCount}, geometry ${debug.staticBundleSelectedCompactedBatchCount} compacted/${debug.staticBundleSelectedDirectEntryCount} direct, candidate ${debug.staticBundleGeometryCandidateCount} entries/${debug.staticBundleGeometryCandidateTriangleCount} tris, empty layers ${debug.staticBundleSelectedNoGeometryLayerCount}, unsubmitted layers ${debug.staticBundleSelectedUnsubmittedLayerCount}, missing-material geometry ${debug.staticBundleSelectedMissingMaterialGeometryCount}${staticBundleLayerCoverageSamples ? `, samples ${staticBundleLayerCoverageSamples}` : ""}. Static bundle materials: records ${debug.staticBundleMaterialRecordCount}, families ${staticBundleMaterialFamilies}, alpha ${staticBundleAlphaPolicies}, bindings ${debug.staticBundleMaterialBaseColorBindingCount} base/${debug.staticBundleMaterialIndexedBindingCount} indexed (${staticBundleBindingUsages}), submitted alpha ${summarizeRecord(debug.materialSurfaceSubmittedAlphaPolicyCounts)}. Terrain family: visible ${debug.visibleTerrainTileCount}, ready ${debug.visibleTerrainOneDrawReadyTileCount}, blocked ${debug.visibleTerrainOneDrawBlockedTileCount}, ready slices ${debug.visibleTerrainDrawSliceReadyCount}, shader draws ${debug.terrainOneDrawShaderDrawCallCount}, submitted tiles ${debug.terrainOneDrawSubmittedTileCount}, submitted slices ${debug.terrainDrawSliceSubmittedCount}, tris ${debug.terrainOneDrawSubmittedTriangleCount}, atlas refs ${debug.terrainAtlasRefCount}, atlas candidates ${debug.terrainAtlasCandidateCount}, atlas blocker tiles ${debug.terrainAtlasBlockerTileCount}${terrainOneDrawBlockerSamples ? `, blockers ${terrainOneDrawBlockerSamples}` : ""}${terrainOneDrawSubmitFallbackSamples ? `, submit fallbacks ${terrainOneDrawSubmitFallbackSamples}` : ""}. Materials ${debug.materialCount}, textures ${debug.textureResourceCount}, indexed textures ${debug.indexedTextureResourceCount}, palettes ${debug.paletteResourceCount}; texture pages ${debug.texturePageBindingCount} bindings (${texturePageBuckets}), atlas failures ${debug.atlasFailureReasonCount}${atlasFailureSamples ? ` (${atlasFailureSamples})` : ""}. Render blockers ${debug.fallbackReasonCount}${fallbackSamples ? ` (${fallbackSamples})` : ""}. Policy ${debug.resourcePolicy}, base ${debug.baseSceneDomain}, transition depth ${debug.transitionPortalMaxDepth}; canvas ${debug.canvasWidth}x${debug.canvasHeight} @${debug.pixelRatio.toFixed(2)}.`;
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
	const resourcePolicyText = $derived.by(() => {
		const debug = renderMetrics?.debug;
		if (!debug) {
			return "Waiting for renderer resources.";
		}
		return `${debug.baseSceneDomain} base, transition depth ${debug.transitionPortalMaxDepth}`;
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
		return `${performanceText}; ${debug.renderCalls} visible draw${debug.renderCalls === 1 ? "" : "s"}, ${debug.renderTriangles} retained tris, static products ${debug.staticLandblockProductCount}, interiors ${debug.structuredInteriorRenderBatchCount}, terrain tiles ${debug.terrainRenderBatchCount}.`;
	});
	const rendererBvhSummaryText = $derived.by(() => {
		const debug = renderMetrics?.debug;
		if (!debug) {
			return "Waiting for BVH metrics.";
		}
		const fallbackSamples = summarizeSamples(debug.fallbackReasonSamples);
		return `BVH visible/candidate: terrain ${debug.terrainBvhVisibleItemCount}/${debug.terrainBvhTotalItemCount}, outdoor statics ${debug.outdoorStaticBvhVisibleItemCount}/${debug.outdoorStaticBvhTotalItemCount}, env local ${debug.envCellLocalBvhVisibleItemCount}/${debug.envCellLocalBvhTotalItemCount}. Candidate resources: static ${debug.staticBvhCandidateBatchCount}/${debug.staticRenderBatchCount}, terrain ${debug.terrainBvhCandidateBatchCount}/${debug.terrainRenderBatchCount}, interiors ${debug.structuredInteriorBvhCandidateBatchCount}/${debug.structuredInteriorRenderBatchCount}, overlays ${debug.debugOverlayBvhCandidateBatchCount}/${debug.debugOverlayRenderBatchCount}, portal masks ${debug.portalMaskBvhCandidateBatchCount}/${debug.portalMaskRenderBatchCount}. Terrain submit: visible ${debug.visibleTerrainTileCount}, ready ${debug.visibleTerrainOneDrawReadyTileCount}, blocked ${debug.visibleTerrainOneDrawBlockedTileCount}, shader draws ${debug.terrainOneDrawShaderDrawCallCount}. Keys: static ${debug.visibleStaticInstanceKeyCount}, portals ${debug.visiblePortalKeyCount}, env cells ${debug.envCellBvhConsideredCount}. Fallback resources ${debug.staticBvhFallbackIncludedBatchCount + debug.nonStaticBvhFallbackIncludedBatchCount}; fallback reasons ${debug.fallbackReasonCount}${fallbackSamples ? ` (${fallbackSamples})` : ""}; query ${debug.queryTimeMs.toFixed(2)} ms.`;
	});
	const staticBundleMaterialDiagnosticsText = $derived.by(() => {
		const debug = renderMetrics?.debug;
		if (!debug) {
			return "Waiting for static material metrics.";
		}
		const fallbackSamples = summarizeSamples(
			debug.materialSurfaceSubmitFallbackSamples,
		);
		return `Records ${debug.staticBundleMaterialRecordCount}; families ${summarizeRecord(debug.staticBundleMaterialFamilyCounts)}; alpha policies ${summarizeRecord(debug.staticBundleMaterialAlphaPolicyCounts)}; bindings ${debug.staticBundleMaterialBaseColorBindingCount} base-color, ${debug.staticBundleMaterialIndexedBindingCount} indexed, usages ${summarizeRecord(debug.staticBundleMaterialBindingUsageCounts)}; submitted material surfaces ${debug.materialSurfaceSubmittedCount}, domains ${summarizeRecord(debug.materialSurfaceSubmittedCountsByDomain)}, alpha ${summarizeRecord(debug.materialSurfaceSubmittedAlphaPolicyCounts)}; skipped ${debug.materialSurfaceSkippedCount}, domains ${summarizeRecord(debug.materialSurfaceSkippedCountsByDomain)}, reasons ${summarizeRecord(debug.materialSurfaceSkippedReasonCounts)}, families ${summarizeRecord(debug.materialSurfaceSkippedFamilyCounts)}, alpha ${summarizeRecord(debug.materialSurfaceSkippedAlphaPolicyCounts)}, bindings ${summarizeRecord(debug.materialSurfaceSkippedBindingUsageCounts)}${fallbackSamples ? `; samples ${fallbackSamples}` : ""}.`;
	});
	const staticBundleLayerCoverageDiagnosticsText = $derived.by(() => {
		const debug = renderMetrics?.debug;
		if (!debug) {
			return "Waiting for static layer metrics.";
		}
		const samples = summarizeSamples(
			debug.staticBundleSelectedLayerCoverageSamples,
		);
		return `Selected ${debug.visibleStaticBundleLayerCount}, submitted ${debug.staticBundleLayerSubmittedCount}, unsubmitted ${debug.staticBundleSelectedUnsubmittedLayerCount}; objects ${debug.staticBundleSelectedObjectRecordCount}/${debug.staticBundleSelectedSourceObjectCount}, spatial hints ${debug.staticBundleSelectedSpatialHintCount}; geometry ${debug.staticBundleSelectedCompactedBatchCount} compacted batches/${debug.staticBundleSelectedDirectEntryCount} direct entries, candidate ${debug.staticBundleGeometryCandidateCount} entries/${debug.staticBundleGeometryCandidateTriangleCount} tris, material submitted ${debug.materialSurfaceSubmittedCountsByDomain["static-bundle"] ?? 0} entries/${debug.materialSurfaceTriangleCountsByDomain["static-bundle"] ?? 0} tris; empty layers ${debug.staticBundleSelectedNoGeometryLayerCount}, missing-material geometry ${debug.staticBundleSelectedMissingMaterialGeometryCount}, builder-skipped surfaces ${debug.staticBundleBuilderSkippedSurfaceCount} (${summarizeRecord(debug.staticBundleBuilderSkippedReasonCounts)})${samples ? `; samples ${samples}` : ""}.`;
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
	const pickerReport = $derived<BrowserPickerReport>(
		derivePickerReport(pickerResult, pickerMissText, pickerClipboardText),
	);
	const selectedStaticRenderableRenderKey = $derived(
		deriveSelectedStaticRenderableRenderKey(pickerResult),
	);

	onMount(() => {
		const unsubscribeFrontendState =
			frontendState.subscribe(applyFrontendState);
		const unsubscribePreparedAssets = preparedAssetResolver.subscribe(() => {
			markAssetDiagnosticsDirty();
		});
		assetDiagnosticsSampler = createCadencedDirtySampler({
			intervalMs: ASSET_DIAGNOSTICS_SAMPLE_MS,
			sample: sampleAssetDiagnostics,
		});
		assetDiagnosticsSampler.start();
		void tick().then(() => {
			sampleAssetDiagnosticsNow();
			renderResourceCoordinator.setSurface(worldDisplaySurface);
			scheduleCurrentRenderPresentationResourceUpdate();
		});

		return () => {
			unsubscribeFrontendState();
			unsubscribePreparedAssets();
			renderResourceCoordinator.setSurface(null);
		};
	});
	const sceneStatusText = $derived(renderResourceReport.sceneStatusText);
	const staticLandblockProductText = $derived.by(() => {
		const debug = renderMetrics?.debug;
		if (!debug) {
			return "Static product resource metrics are waiting for the first rendered frame.";
		}
		return `${debug.staticLandblockProductCount} resident product${debug.staticLandblockProductCount === 1 ? "" : "s"} (${summarizeRecord(debug.staticLandblockProductDomainCounts)}); bundles ${debug.staticBundleProductResourceCount} product${debug.staticBundleProductResourceCount === 1 ? "" : "s"}/${debug.staticBundleLayerResourceCount} layer${debug.staticBundleLayerResourceCount === 1 ? "" : "s"}/${debug.staticBundleLayerTexturePageResourceCount} page${debug.staticBundleLayerTexturePageResourceCount === 1 ? "" : "s"}, interiors ${debug.structuredInteriorProductResourceCount} product${debug.structuredInteriorProductResourceCount === 1 ? "" : "s"}/${debug.structuredInteriorCellResourceCount} cell${debug.structuredInteriorCellResourceCount === 1 ? "" : "s"}/${debug.structuredInteriorTexturePageResourceCount} page${debug.structuredInteriorTexturePageResourceCount === 1 ? "" : "s"}/${debug.structuredInteriorMaterialRecordResourceCount} material${debug.structuredInteriorMaterialRecordResourceCount === 1 ? "" : "s"}, terrain ${debug.terrainProductResourceCount} product${debug.terrainProductResourceCount === 1 ? "" : "s"}/${debug.productTerrainTexturePageCount} page${debug.productTerrainTexturePageCount === 1 ? "" : "s"}, portal masks ${debug.portalMaskProductResourceCount} product${debug.portalMaskProductResourceCount === 1 ? "" : "s"}/${debug.transitionPortalMaskResourceCount} mask${debug.transitionPortalMaskResourceCount === 1 ? "" : "s"}.`;
	});
	const browserPanelSceneRows = $derived<BrowserPanelRow[]>([
		{ label: "Mode", value: sceneContextText },
		{ label: "Navigation", value: navigationFocusText },
		{ label: "Destination", value: worldDisplay.destinationFocusLabel },
		{ label: "Camera residency", value: cameraResidencyText },
		{ label: "Base scene", value: resourcePolicyText },
		{ label: "Landblocks", value: landblockVisibilityText },
		{
			label: "Static products",
			value: staticLandblockProductText,
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
				{
					label: "Static Layers",
					value: staticBundleLayerCoverageDiagnosticsText,
				},
				{
					label: "Static Materials",
					value: staticBundleMaterialDiagnosticsText,
				},
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
			scheduleCurrentRenderPresentationResourceUpdate();
			return;
		}
		pickerResult = { pick, viewportPoint };
		pickerMissText = "";
		scheduleCurrentRenderPresentationResourceUpdate();
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
			scheduleCurrentRenderPresentationResourceUpdate();
			return null;
		}
		const query = buildPickerQuery(pickerOptions);
		if (query.mask.size === 0) {
			pickerResult = null;
			pickerMissText = "No pickable renderable families are enabled.";
			scheduleCurrentRenderPresentationResourceUpdate();
			return null;
		}
		const pick =
			worldDisplaySurface?.pickAtViewportPoint(
				viewportPoint,
				query.mask,
				query.ownerKeys,
			) ??
			renderResourceReport.renderSpatialQuery.pickRay(
				buildSceneCameraRenderRay(cameraFrame, viewportPoint),
				query.mask,
				query.ownerKeys,
				query.acceptItem,
			);
		if (!pick) {
			pickerResult = null;
			pickerMissText = `No pick hit at ${formatViewportPoint(viewportPoint)}.`;
			scheduleCurrentRenderPresentationResourceUpdate();
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
		sampleAssetDiagnosticsNow();
		return buildRenderDebugReport({
			generatedAtIso: new Date().toISOString(),
			destinationFocusLabel: worldDisplay.destinationFocusLabel,
			sceneSummaryRows: browserPanelSceneRows,
			sceneDetailSections: browserPanelSceneDetailSections,
			debugSummaryRows: browserPanelDebugRows,
			debugDetailSections: browserPanelDebugDetailSections,
			pickerSections: pickerReport.sections,
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

	function handleGenerateResourceSnapshot(): void {
		resourceInspection =
			worldDisplaySurface?.inspectResources() ??
			createEmptyRenderResourceInspectionSnapshot();
	}

	function handlePreviewTexturePage(
		identity: RenderResourceTexturePageIdentity,
	): void {
		texturePreviewError = null;
		texturePreviewDrag = null;
		try {
			const preview = worldDisplaySurface?.previewTexturePage(identity) ?? null;
			if (!preview) {
				texturePreview = null;
				texturePreviewError = "Texture page is no longer resident.";
				return;
			}
			texturePreview = preview;
			texturePreviewZoom = 1;
			selectedTexturePreviewEntryKey =
				preview.entries[0]?.sourcePlacementKey ?? null;
			void fitTexturePreviewToStage();
		} catch (error) {
			texturePreview = null;
			texturePreviewError =
				error instanceof Error ? error.message : String(error);
		}
	}

	function closeTexturePreview(): void {
		texturePreview = null;
		texturePreviewError = null;
		texturePreviewDrag = null;
		selectedTexturePreviewEntryKey = null;
	}

	async function fitTexturePreviewToStage(): Promise<void> {
		await tick();
		if (!texturePreview || !texturePreviewStage) {
			return;
		}

		const stage = texturePreviewStage;
		const fitZoom = clampTexturePreviewZoom(
			Math.min(
				stage.clientWidth / Math.max(texturePreview.width, 1),
				stage.clientHeight / Math.max(texturePreview.height, 1),
				1,
			),
		);
		texturePreviewZoom = fitZoom;
		await tick();
		centerTexturePreviewStage();
	}

	function resetTexturePreviewZoom(): void {
		setTexturePreviewZoom(1, texturePreviewStageCenter());
	}

	function zoomTexturePreviewIn(): void {
		setTexturePreviewZoom(
			texturePreviewZoom * TEXTURE_PREVIEW_ZOOM_STEP,
			texturePreviewStageCenter(),
		);
	}

	function zoomTexturePreviewOut(): void {
		setTexturePreviewZoom(
			texturePreviewZoom / TEXTURE_PREVIEW_ZOOM_STEP,
			texturePreviewStageCenter(),
		);
	}

	function toggleTexturePreviewAtlasBounds(): void {
		texturePreviewShowAtlasBounds = !texturePreviewShowAtlasBounds;
	}

	function handleTexturePreviewWheel(event: WheelEvent): void {
		if (!texturePreviewStage) {
			return;
		}

		const zoomMultiplier =
			event.deltaY < 0
				? TEXTURE_PREVIEW_WHEEL_ZOOM_STEP
				: 1 / TEXTURE_PREVIEW_WHEEL_ZOOM_STEP;
		const stageRect = texturePreviewStage.getBoundingClientRect();
		setTexturePreviewZoom(texturePreviewZoom * zoomMultiplier, {
			x: event.clientX - stageRect.left,
			y: event.clientY - stageRect.top,
		});
		event.preventDefault();
	}

	function handleTexturePreviewPointerDown(event: PointerEvent): void {
		if (event.button !== 0 || !texturePreviewStage) {
			return;
		}

		texturePreviewStage.setPointerCapture(event.pointerId);
		texturePreviewDrag = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			lastX: event.clientX,
			lastY: event.clientY,
		};
		event.preventDefault();
	}

	function handleTexturePreviewPointerMove(event: PointerEvent): void {
		if (
			!texturePreviewStage ||
			texturePreviewDrag?.pointerId !== event.pointerId
		) {
			return;
		}

		const deltaX = event.clientX - texturePreviewDrag.lastX;
		const deltaY = event.clientY - texturePreviewDrag.lastY;
		texturePreviewStage.scrollLeft -= deltaX;
		texturePreviewStage.scrollTop -= deltaY;
		texturePreviewDrag = {
			pointerId: event.pointerId,
			startX: texturePreviewDrag.startX,
			startY: texturePreviewDrag.startY,
			lastX: event.clientX,
			lastY: event.clientY,
		};
		event.preventDefault();
	}

	function handleTexturePreviewPointerUp(event: PointerEvent): void {
		if (
			!texturePreviewStage ||
			texturePreviewDrag?.pointerId !== event.pointerId
		) {
			return;
		}
		const drag = texturePreviewDrag;

		if (texturePreviewStage.hasPointerCapture(event.pointerId)) {
			texturePreviewStage.releasePointerCapture(event.pointerId);
		}
		texturePreviewDrag = null;
		if (
			Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <=
			TEXTURE_PREVIEW_CLICK_MOVE_THRESHOLD
		) {
			selectTexturePreviewEntryAtPointer(event);
		}
		event.preventDefault();
	}

	function selectTexturePreviewEntry(
		entry: RenderResourceTexturePagePreview["entries"][number],
	): void {
		selectedTexturePreviewEntryKey = entry.sourcePlacementKey;
	}

	function selectTexturePreviewEntryAtPointer(event: PointerEvent): void {
		if (!texturePreview || !texturePreviewCanvas) {
			return;
		}
		const canvasRect = texturePreviewCanvas.getBoundingClientRect();
		if (
			event.clientX < canvasRect.left ||
			event.clientX > canvasRect.right ||
			event.clientY < canvasRect.top ||
			event.clientY > canvasRect.bottom
		) {
			return;
		}
		const textureX =
			((event.clientX - canvasRect.left) / Math.max(canvasRect.width, 1)) *
			texturePreview.width;
		const textureY =
			((event.clientY - canvasRect.top) / Math.max(canvasRect.height, 1)) *
			texturePreview.height;
		const entry = findTexturePreviewEntryAtPoint(
			texturePreview.entries,
			textureX,
			textureY,
		);
		selectedTexturePreviewEntryKey = entry?.sourcePlacementKey ?? null;
	}

	function findTexturePreviewEntryAtPoint(
		entries: readonly RenderResourceTexturePagePreview["entries"][number][],
		x: number,
		y: number,
	): RenderResourceTexturePagePreview["entries"][number] | null {
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			const entry = entries[index];
			if (!entry) {
				continue;
			}
			const [rectX, rectY, rectWidth, rectHeight] = entry.rect;
			if (
				x >= rectX &&
				x < rectX + rectWidth &&
				y >= rectY &&
				y < rectY + rectHeight
			) {
				return entry;
			}
		}
		return null;
	}

	function setTexturePreviewZoom(
		nextZoom: number,
		anchor: { x: number; y: number } | null,
	): void {
		const stage = texturePreviewStage;
		const previousZoom = texturePreviewZoom;
		const clampedZoom = clampTexturePreviewZoom(nextZoom);
		if (!stage || !anchor || clampedZoom === previousZoom) {
			texturePreviewZoom = clampedZoom;
			return;
		}

		const contentAnchorX = (stage.scrollLeft + anchor.x) / previousZoom;
		const contentAnchorY = (stage.scrollTop + anchor.y) / previousZoom;
		texturePreviewZoom = clampedZoom;
		void tick().then(() => {
			stage.scrollLeft = contentAnchorX * clampedZoom - anchor.x;
			stage.scrollTop = contentAnchorY * clampedZoom - anchor.y;
		});
	}

	function texturePreviewStageCenter(): { x: number; y: number } | null {
		if (!texturePreviewStage) {
			return null;
		}
		return {
			x: texturePreviewStage.clientWidth / 2,
			y: texturePreviewStage.clientHeight / 2,
		};
	}

	function centerTexturePreviewStage(): void {
		if (!texturePreviewStage) {
			return;
		}
		texturePreviewStage.scrollLeft =
			(texturePreviewStage.scrollWidth - texturePreviewStage.clientWidth) / 2;
		texturePreviewStage.scrollTop =
			(texturePreviewStage.scrollHeight - texturePreviewStage.clientHeight) / 2;
	}

	function clampTexturePreviewZoom(value: number): number {
		return Math.min(
			MAX_TEXTURE_PREVIEW_ZOOM,
			Math.max(MIN_TEXTURE_PREVIEW_ZOOM, value),
		);
	}

	function formatTexturePreviewZoom(value: number): string {
		return `${Math.round(value * 100)}%`;
	}

	function formatPercent(value: number): string {
		return `${(value * 100).toFixed(1)}%`;
	}

	function drawTexturePreviewEntryBounds(
		context: CanvasRenderingContext2D,
		entries: readonly RenderResourceTexturePagePreview["entries"][number][],
		selectedEntryKey: string | null,
	): void {
		context.save();
		context.lineWidth = 1;
		context.strokeStyle = "rgba(0, 255, 255, 0.95)";
		context.setLineDash([4, 3]);
		for (const entry of entries) {
			const [x, y, width, height] = entry.rect;
			context.strokeRect(
				x + 0.5,
				y + 0.5,
				Math.max(0, width - 1),
				Math.max(0, height - 1),
			);
		}
		context.restore();
		const selectedEntry =
			entries.find((entry) => entry.sourcePlacementKey === selectedEntryKey) ??
			null;
		if (selectedEntry) {
			drawTexturePreviewSelectedEntryBounds(context, selectedEntry);
		}
	}

	function drawTexturePreviewSelectedEntryBounds(
		context: CanvasRenderingContext2D,
		entry: RenderResourceTexturePagePreview["entries"][number],
	): void {
		const [x, y, width, height] = entry.rect;
		context.save();
		context.lineWidth = 3;
		context.strokeStyle = "rgba(255, 216, 102, 1)";
		context.setLineDash([]);
		context.strokeRect(
			x + 1.5,
			y + 1.5,
			Math.max(0, width - 3),
			Math.max(0, height - 3),
		);
		context.lineWidth = 1;
		context.strokeStyle = "rgba(0, 0, 0, 0.9)";
		context.strokeRect(
			x + 0.5,
			y + 0.5,
			Math.max(0, width - 1),
			Math.max(0, height - 1),
		);
		context.restore();
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
		markAssetDiagnosticsDirty();
		scheduleCurrentRenderPresentationResourceUpdate();
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

	function scheduleCurrentRenderPresentationResourceUpdate(): void {
		scheduleRenderPresentationResourceUpdate({
			assetPresentationState: assetState,
			preparedAssetResolver,
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
		});
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

	function markAssetDiagnosticsDirty(): void {
		assetDiagnosticsSampler?.markDirty();
	}

	function sampleAssetDiagnosticsNow(): void {
		if (assetDiagnosticsSampler) {
			assetDiagnosticsSampler.sampleNow();
			return;
		}
		sampleAssetDiagnostics();
	}

	function sampleAssetDiagnostics(): void {
		assetSummaryText = describeAssetSummaryState();
		assetDebugText = describeAssetDebugState();
		assetPipelineDebugText = describeAssetPipelineDebugState();
		assetMaterialDebugText = describeMaterialAssetDiagnostics({
			assetPresentationState: assetState,
			preparedAssetResolver,
			browserDestination,
			options: {
				terrainRadius: terrainLodRadius,
				buildingRadius: buildingLodRadius,
				detailRadius: detailLodRadius,
				envCellRadius: envCellLodRadius,
			},
		});
		assetCacheDebugText = describeAssetCacheDebugState();
	}

	function scheduleRenderPresentationResourceUpdate(
		input: BrowserRenderResourceCoordinatorInput,
	): void {
		pendingRenderPresentationResourceInput = input;
		if (renderPresentationResourceUpdateTimer) {
			return;
		}

		renderPresentationResourceUpdateTimer = setTimeout(() => {
			renderPresentationResourceUpdateTimer = null;
			const nextInput = pendingRenderPresentationResourceInput;
			pendingRenderPresentationResourceInput = null;
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
				scheduleCurrentRenderPresentationResourceUpdate();
				return;
			}

			diagnosticSelection = diagnosticPick.item.metadata;
			scheduleCurrentRenderPresentationResourceUpdate();
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
		scheduleCurrentRenderPresentationResourceUpdate();
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
			const coverage = metadata.artifactCoverage;
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
				...(coverage
					? [
							{
								label: "Artifact parts",
								value: `${coverage.sourcePartHintCount} hint${coverage.sourcePartHintCount === 1 ? "" : "s"} (${summarizeNumberList(coverage.sourcePartIndices)}), material slots ${coverage.renderMaterialSlotCount}/${coverage.sourceMaterialSlotCount}`,
							},
							{
								label: "Source geometry",
								value: `${coverage.sourceRenderTriangleCount} render tris from ${coverage.sourcePhysicsPolygonCount} physics polys; skipped ${coverage.sourceSkippedPolygonCount}, invalid ${coverage.sourceInvalidPolygonCount}`,
							},
							{
								label: "Artifact geometry",
								value: `${coverage.emittedGeometryEntryCount} entr${coverage.emittedGeometryEntryCount === 1 ? "y" : "ies"} (${coverage.emittedDirectEntryCount} direct/${coverage.emittedCompactedBatchCount} compacted); direct tris ${coverage.emittedDirectTriangleCount}, containing batch tris ${coverage.emittedCompactedBatchTriangleCount}, zero-tri entries ${coverage.emittedZeroTriangleEntryCount}`,
							},
							{
								label: "Material tris",
								value: summarizeStringList(
									coverage.materialTriangleCounts.map(
										formatMaterialTriangleCount,
									),
								),
							},
							{
								label: "Zero-tri materials",
								value: summarizeStringList(
									coverage.zeroTriangleMaterialRecordKeys,
								),
							},
							{
								label: "Artifact materials",
								value: `${coverage.materialRecordKeys.length} record${coverage.materialRecordKeys.length === 1 ? "" : "s"}; families ${summarizeStringList(coverage.materialFamilyKeys)}`,
							},
						]
					: []),
			];
		}
		if (metadata.kind === "structured-cell") {
			const coverage = metadata.artifactCoverage;
			return [
				{ label: "Env cell", value: `0x${formatHex32(metadata.envCellId)}` },
				{ label: "Render key", value: metadata.renderKey },
				{ label: "Role", value: metadata.isFocus ? "Focus" : "Visible" },
				...(coverage
					? [
							{ label: "Product", value: coverage.product },
							{
								label: "Landblock",
								value: `0x${formatHex32(coverage.landblockId)}`,
							},
							{
								label: "Structure",
								value: `env 0x${formatHex32(coverage.environmentId)}, cell-struct 0x${formatHex32(coverage.cellStructureId)}`,
							},
							{
								label: "Source surfaces",
								value: `${coverage.sourceSurfaceCount}; ${summarizeNumberList(coverage.sourceSurfaceIds)}`,
							},
							{
								label: "Source geometry",
								value: `${coverage.renderTriangleCount} render tris, ${coverage.renderVertexCount} verts; skipped ${coverage.skippedPolygonCount}, invalid ${coverage.invalidPolygonCount}`,
							},
							{
								label: "Material slices",
								value: `${coverage.materialSliceCount} slice${coverage.materialSliceCount === 1 ? "" : "s"}, ${coverage.materialSliceTriangleCount} tris; fallback shell ${coverage.fallbackShellExpected ? "yes" : "no"}, missing materials ${coverage.missingMaterialSliceCount}`,
							},
							{
								label: "Material tris",
								value: summarizeStringList(
									coverage.materialTriangleCounts.map(
										formatStructuredMaterialTriangleCount,
									),
								),
							},
							{
								label: "Material records",
								value: `${coverage.materialRecordCount} record${coverage.materialRecordCount === 1 ? "" : "s"}; families ${summarizeStringList(coverage.materialFamilyKeys)}`,
							},
							{
								label: "Texture pages",
								value: `${coverage.texturePageRefCount} ref${coverage.texturePageRefCount === 1 ? "" : "s"}, ${coverage.texturePageCount} page${coverage.texturePageCount === 1 ? "" : "s"}`,
							},
							{
								label: "Static contents",
								value: `${coverage.staticObjectCount} static object${coverage.staticObjectCount === 1 ? "" : "s"}, ${coverage.portalCount} portal${coverage.portalCount === 1 ? "" : "s"}, ${coverage.portalApertureCount} aperture${coverage.portalApertureCount === 1 ? "" : "s"}`,
							},
						]
					: []),
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

	function summarizeNumberList(values: readonly number[]): string {
		if (values.length === 0) {
			return "none";
		}
		const shown = values.slice(0, 12).join(", ");
		return values.length > 12 ? `${shown}, ... +${values.length - 12}` : shown;
	}

	function summarizeStringList(values: readonly string[]): string {
		if (values.length === 0) {
			return "none";
		}
		const shown = values.slice(0, 4).join(" || ");
		return values.length > 4 ? `${shown} || ... +${values.length - 4}` : shown;
	}

	function formatMaterialTriangleCount(entry: {
		materialRecordKey: string;
		familyKey: string | null;
		triangleCount: number;
	}): string {
		const materialKey = entry.materialRecordKey.replace(
			"material:material/",
			"mat/",
		);
		return `${entry.triangleCount} ${materialKey}${entry.familyKey ? ` ${entry.familyKey}` : ""}`;
	}

	function formatStructuredMaterialTriangleCount(entry: {
		materialRecordKey: string;
		familyKey: string | null;
		surfaceId: number;
		geometrySurfaceId: number;
		materialVariantSignature: string | null;
		triangleCount: number;
	}): string {
		const materialKey = entry.materialRecordKey.replace(
			"material:material/",
			"mat/",
		);
		return `${entry.triangleCount} ${materialKey}${entry.familyKey ? ` ${entry.familyKey}` : ""} surface 0x${formatHex32(entry.surfaceId)}/geom ${entry.geometrySurfaceId} variant ${entry.materialVariantSignature ?? "base"}`;
	}

	function buildPickerClipboardReport(
		result: BrowserRenderablePickResult,
	): string {
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
		};
		return JSON.stringify(report, null, 2);
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

		const preparedCounts = countPreparedAssetsByKindFromResolver(
			preparedAssetResolver,
		);
		return `${assetState.status}; ${preparedCounts.total} prepared asset${preparedCounts.total === 1 ? "" : "s"}.`;
	}

	function describeAssetDebugState(): string {
		if (assetState.errorMessage) {
			return `Error while preparing ${assetState.activeRequest?.assetId ?? "asset"}: ${assetState.errorMessage}`;
		}

		const preparedCounts = countPreparedAssetsByKindFromResolver(
			preparedAssetResolver,
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
		const preparedLandblockRouteIds = [...preparedAssetResolver.keys()]
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
		const hotPathDiagnostics = getPreparedAssetHotPathDiagnosticsSnapshot();
		const latestPrune = hotPathDiagnostics.latestPrune;
		const pruneText = latestPrune
			? `prunes ${hotPathDiagnostics.pruneCallCount}, latest ${latestPrune.durationMs.toFixed(1)} ms over ${latestPrune.evaluatedAssetCount} asset${latestPrune.evaluatedAssetCount === 1 ? "" : "s"}, evicted ${latestPrune.evictedAssetCount}`
			: `prunes ${hotPathDiagnostics.pruneCallCount}, no prune sample`;
		const resolverRevisionText = `resolver revisions prepared ${preparedAssetResolver.getPreparedRevision()}, cache metadata ${preparedAssetResolver.getCacheMetadataRevision()}, prepared ${preparedAssetResolver.getPreparedCount()}`;
		const cacheDiagnostics = preparedAssetResolver.getCacheDiagnostics();
		if (!cacheDiagnostics) {
			const preparedCounts = countPreparedAssetsByKindFromResolver(
				preparedAssetResolver,
			);
			return `Prepared ${preparedCounts.total} (${formatPreparedAssetKindCounts(preparedCounts)}); waiting for first prune sample; ${pruneText}; ${resolverRevisionText}.`;
		}

		return `Prepared ${cacheDiagnostics.prepared.total} (${formatPreparedAssetKindCounts(cacheDiagnostics.prepared)}); retained ${cacheDiagnostics.retained.total} (${formatPreparedAssetKindCounts(cacheDiagnostics.retained)}); hard ${cacheDiagnostics.hardRetained.total} (${formatPreparedAssetKindCounts(cacheDiagnostics.hardRetained)}); warm ${cacheDiagnostics.warmRetained.total} (${formatPreparedAssetKindCounts(cacheDiagnostics.warmRetained)}); evicted ${cacheDiagnostics.evicted.total} (${formatPreparedAssetKindCounts(cacheDiagnostics.evicted)}); ${pruneText}; ${resolverRevisionText}.`;
	}

	function describeGfxObjRenderDiagnostics(): string | null {
		const affectedAssets = [...preparedAssetResolver.values()]
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
		assetDiagnosticsSampler?.dispose();
		assetDiagnosticsSampler = null;
		if (renderPresentationResourceUpdateTimer) {
			clearTimeout(renderPresentationResourceUpdateTimer);
			renderPresentationResourceUpdateTimer = null;
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
		{preparedAssetResolver}
		{staticLandblockProductSource}
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
			{resourceInspection}
			onGenerateResourceSnapshot={handleGenerateResourceSnapshot}
			onPreviewTexturePage={handlePreviewTexturePage}
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

	{#if texturePreview !== null || texturePreviewError !== null}
		<div class="browser-world-display__modal-backdrop" data-browser-panel>
			<div
				class="browser-world-display__texture-preview-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="texture-preview-title"
			>
				<div class="browser-world-display__debug-report-header">
					<div>
						<p>Texture page preview</p>
						<h2 id="texture-preview-title">
							{texturePreview
								? formatRenderResourceInspectionKeyForDisplay(
										texturePreview.key,
									)
								: "Preview unavailable"}
						</h2>
					</div>
					<button type="button" onclick={closeTexturePreview}>Close</button>
				</div>
				{#if texturePreviewError}
					<p class="browser-panel__status">{texturePreviewError}</p>
				{:else if texturePreview}
					<div class="browser-world-display__texture-preview-toolbar">
						<button
							type="button"
							onclick={() => void fitTexturePreviewToStage()}
						>
							Fit
						</button>
						<button type="button" onclick={resetTexturePreviewZoom}>100%</button
						>
						<button
							type="button"
							aria-label="Zoom out"
							title="Zoom out"
							onclick={zoomTexturePreviewOut}
						>
							-
						</button>
						<span>{formatTexturePreviewZoom(texturePreviewZoom)}</span>
						<button
							type="button"
							aria-label="Zoom in"
							title="Zoom in"
							onclick={zoomTexturePreviewIn}
						>
							+
						</button>
						<button
							type="button"
							class:active={texturePreviewShowAtlasBounds}
							aria-pressed={texturePreviewShowAtlasBounds}
							title="Toggle atlas rect bounds"
							onclick={toggleTexturePreviewAtlasBounds}
						>
							Rects
						</button>
					</div>
					<div class="browser-world-display__texture-preview-body">
						<div
							bind:this={texturePreviewStage}
							class:dragging={texturePreviewDrag !== null}
							class="browser-world-display__texture-preview-stage"
							role="region"
							aria-label="Texture preview pan and zoom viewport"
							onpointerdown={handleTexturePreviewPointerDown}
							onpointermove={handleTexturePreviewPointerMove}
							onpointerup={handleTexturePreviewPointerUp}
							onpointercancel={handleTexturePreviewPointerUp}
							onwheel={handleTexturePreviewWheel}
						>
							<div class="browser-world-display__texture-preview-surface">
								<div
									class="browser-world-display__texture-preview-content"
									style:width={`${texturePreview.width * texturePreviewZoom}px`}
									style:height={`${texturePreview.height * texturePreviewZoom}px`}
								>
									<canvas
										bind:this={texturePreviewCanvas}
										aria-label="Texture page preview"
									></canvas>
									<span
										class="browser-world-display__texture-preview-bounds"
										aria-hidden="true"
									></span>
								</div>
							</div>
						</div>
						<aside
							class="browser-world-display__texture-preview-entry-panel"
							aria-label="Selected atlas entry"
						>
							{#if selectedTexturePreviewEntry}
								<p>Selected Placement</p>
								<h3 title={selectedTexturePreviewEntry.sourcePlacementKey}>
									{formatRenderResourceInspectionKeyForDisplay(
										selectedTexturePreviewEntry.virtualRefKey,
									)}
								</h3>
								<dl>
									<div>
										<dt>Source</dt>
										<dd>{selectedTexturePreviewEntry.sourceAssetId}</dd>
									</div>
									<div>
										<dt>Rect</dt>
										<dd>[{selectedTexturePreviewEntry.rect.join(", ")}]</dd>
									</div>
									<div>
										<dt>Aliases</dt>
										<dd>{selectedTexturePreviewEntry.virtualRefKeys.length}</dd>
									</div>
									<div>
										<dt>Source Placement</dt>
										<dd>{selectedTexturePreviewEntry.sourcePlacementKey}</dd>
									</div>
								</dl>
								<div class="browser-world-display__texture-preview-aliases">
									<p>Virtual Refs</p>
									<ul>
										{#each selectedTexturePreviewEntry.virtualRefKeys as alias}
											<li title={alias}>
												{formatRenderResourceInspectionKeyForDisplay(alias)}
											</li>
										{/each}
									</ul>
								</div>
							{:else}
								<p>Selected Placement</p>
								<h3>No atlas entry selected</h3>
							{/if}
						</aside>
					</div>
					<div class="browser-world-display__texture-preview-metadata">
						<dl class="browser-world-display__texture-preview-stats">
							<div>
								<dt>Format</dt>
								<dd>
									{texturePreview.bucket}; {texturePreview.sampleClass};
									{texturePreview.indexedFormat ?? "rgba"}
								</dd>
							</div>
							<div>
								<dt>Size</dt>
								<dd>{texturePreview.width}x{texturePreview.height}</dd>
							</div>
							<div>
								<dt>Entries</dt>
								<dd>
									{texturePreview.entries.length} placements;
									{texturePreview.entries.reduce(
										(count, entry) => count + entry.virtualRefKeys.length,
										0,
									)} aliases
								</dd>
							</div>
							<div>
								<dt>Efficiency</dt>
								<dd>{formatPercent(texturePreview.coverageRatio)}</dd>
							</div>
						</dl>
						<details class="browser-panel__details">
							<summary>Atlas Entries</summary>
							<dl
								class="data-list compact-data-list browser-panel__resource-list"
							>
								{#each texturePreview.entries as entry}
									<div
										class:selected={entry.sourcePlacementKey ===
											selectedTexturePreviewEntryKey}
									>
										<dt title={entry.virtualRefKey}>
											<button
												type="button"
												class="browser-world-display__texture-preview-entry-button"
												aria-pressed={entry.sourcePlacementKey ===
													selectedTexturePreviewEntryKey}
												onclick={() => selectTexturePreviewEntry(entry)}
											>
												{formatRenderResourceInspectionKeyForDisplay(
													entry.virtualRefKey,
												)}
											</button>
										</dt>
										<dd>
											{entry.sourceAssetId}; aliases {entry.virtualRefKeys
												.length}; rect [{entry.rect.join(", ")}]
										</dd>
									</div>
								{/each}
							</dl>
						</details>
					</div>
				{/if}
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
