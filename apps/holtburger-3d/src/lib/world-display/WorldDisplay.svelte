<script lang="ts">
	import { onMount, tick } from "svelte";

	import {
		createInitialAssetChannelState,
		type AssetChannelState,
	} from "../assets/types";
	import type { PreparedAssetResolver } from "../assets/prepared-asset-store";
	import type { NormalizedViewportPoint } from "./model";
	import type {
		RenderSpatialIndexQuery,
		RenderSpatialItemKind,
		RenderSpatialPick,
	} from "./render-spatial-index";
	import type { RenderChunkTransform } from "./render-anchor";
	import type { SceneCameraFrame } from "./camera";
	import type {
		BrowserCameraResidencyChangeHandler,
		WorldDisplayTextureFilteringMode,
		WorldDisplayRenderStyle,
		WorldRenderCameraFrameChangeHandler,
		WorldRenderMetricsChangeHandler,
	} from "./renderer-contract";
	import {
		createEmptyRenderResourceInspectionSnapshot,
		type RenderResourceInspectionSnapshot,
		type RenderResourceTexturePageIdentity,
		type RenderResourceTexturePagePreview,
	} from "./render-resource-inspection";
	import {
		createEmptyStaticLandblockRenderProductSet,
		type StaticLandblockProductKey,
		type StaticLandblockRenderProductSet,
	} from "./static-landblock-render-artifact-store";
	import {
		createStaticLandblockProductKeyFromResult,
		formatStaticLandblockProductKey,
		type LandblockRenderProductWorkerResult,
	} from "./landblock-render-product";
	import {
		createEmptyWorldDebugOverlayModel,
		type WorldDebugOverlayModel,
	} from "./debug-overlays";
	import type { WorldRenderSceneContext } from "./render-scene-context";
	import {
		createWorldDisplayRenderer,
		type WorldDisplayRenderer,
	} from "./world-display-renderer";

	let {
		preparedAssetResolver,
		onCameraFrameChange,
		onRenderMetricsChange,
		onCameraResidencyChange,
	}: {
		preparedAssetResolver: PreparedAssetResolver;
		onCameraFrameChange?: WorldRenderCameraFrameChangeHandler;
		onRenderMetricsChange?: WorldRenderMetricsChangeHandler;
		onCameraResidencyChange?: BrowserCameraResidencyChangeHandler;
	} = $props();

	let viewportHost = $state<HTMLDivElement | null>(null);
	let rendererController = $state<WorldDisplayRenderer | null>(null);

	let assetState = createInitialAssetChannelState();
	let staticLandblockRenderProducts =
		createEmptyStaticLandblockRenderProductSet();
	let debugOverlayScene = createEmptyWorldDebugOverlayModel();
	let renderSceneContext: WorldRenderSceneContext = {
		kind: "outdoor",
		anchorLandblockId: null,
	};
	let renderChunkTransforms: readonly RenderChunkTransform[] = [];
	let renderSpatialQuery: RenderSpatialIndexQuery | null = null;
	let selectedStaticRenderableRenderKey: string | null = null;
	let controlledCameraFrame: SceneCameraFrame | null = null;
	let transitionPortalMaxDepth = 1;
	let renderStyle: WorldDisplayRenderStyle = "solid";
	let textureFilteringMode: WorldDisplayTextureFilteringMode = "anisotropic-4x";
	let detailTexturesEnabled = true;

	onMount(() => {
		let disposed = false;

		void tick().then(() => {
			if (disposed || !viewportHost) {
				return;
			}

			const controller = createWorldDisplayRenderer(viewportHost, {
				assetState,
				preparedAssetResolver,
				staticLandblockRenderProducts,
				transitionPortalMaxDepth,
				debugOverlayScene,
				renderSceneContext,
				renderChunkTransforms,
				renderSpatialQuery,
				selectedStaticRenderableRenderKey,
				controlledCameraFrame,
				onCameraFrameChange,
				onRenderMetricsChange,
				onCameraResidencyChange,
				renderStyle,
				textureFilteringMode,
				detailTexturesEnabled,
			});
			rendererController = controller;
		});

		return () => {
			disposed = true;
			rendererController?.dispose();
			rendererController = null;
		};
	});

	export function setAssetState(nextAssetState: AssetChannelState): void {
		assetState = nextAssetState;
		rendererController?.setAssetState(assetState);
	}

	export function commitStaticLandblockProduct(
		result: LandblockRenderProductWorkerResult,
	): void {
		staticLandblockRenderProducts = commitStaticProductToSet(
			staticLandblockRenderProducts,
			result,
		);
		rendererController?.commitStaticLandblockProduct(result);
	}

	export function evictStaticLandblockProduct(
		key: StaticLandblockProductKey,
	): void {
		staticLandblockRenderProducts = evictStaticProductFromSet(
			staticLandblockRenderProducts,
			key,
		);
		rendererController?.evictStaticLandblockProduct(key);
	}

	export function clearStaticLandblockProducts(): void {
		staticLandblockRenderProducts = createEmptyStaticLandblockRenderProductSet();
		rendererController?.clearStaticLandblockProducts();
	}

	export function setDebugOverlayScene(
		nextScene: WorldDebugOverlayModel,
	): void {
		debugOverlayScene = nextScene;
		rendererController?.setDebugOverlayScene(debugOverlayScene);
	}

	export function setRenderSceneContext(
		nextContext: WorldRenderSceneContext,
	): void {
		renderSceneContext = nextContext;
		rendererController?.setRenderSceneContext(renderSceneContext);
	}

	export function setRenderChunkTransforms(
		nextTransforms: readonly RenderChunkTransform[],
	): void {
		renderChunkTransforms = nextTransforms;
		rendererController?.setRenderChunkTransforms(renderChunkTransforms);
	}

	export function setRenderSpatialQuery(
		nextQuery: RenderSpatialIndexQuery | null,
	): void {
		renderSpatialQuery = nextQuery;
		rendererController?.setRenderSpatialQuery(renderSpatialQuery);
	}

	export function setSelectedStaticRenderableRenderKey(
		nextRenderKey: string | null,
	): void {
		selectedStaticRenderableRenderKey = nextRenderKey;
		rendererController?.setSelectedStaticRenderableRenderKey(
			selectedStaticRenderableRenderKey,
		);
	}

	export function setControlledCameraFrame(
		nextFrame: SceneCameraFrame | null,
	): void {
		controlledCameraFrame = nextFrame;
		rendererController?.setControlledCameraFrame(controlledCameraFrame);
	}

	export function setTransitionPortalMaxDepth(nextMaxDepth: number): void {
		transitionPortalMaxDepth = nextMaxDepth;
		rendererController?.setTransitionPortalMaxDepth(transitionPortalMaxDepth);
	}

	export function setRenderStyle(nextStyle: WorldDisplayRenderStyle): void {
		renderStyle = nextStyle;
		rendererController?.setRenderStyle(renderStyle);
	}

	export function setTextureFilteringMode(
		nextMode: WorldDisplayTextureFilteringMode,
	): void {
		textureFilteringMode = nextMode;
		rendererController?.setTextureFilteringMode(textureFilteringMode);
	}

	export function setDetailTexturesEnabled(nextEnabled: boolean): void {
		detailTexturesEnabled = nextEnabled;
		rendererController?.setDetailTexturesEnabled(detailTexturesEnabled);
	}

	export function pickTerrainLandblockAtViewportPoint(
		viewportPoint: NormalizedViewportPoint,
	): number | null {
		return (
			rendererController?.pickTerrainLandblockAtViewportPoint(viewportPoint) ??
			null
		);
	}

	export function pickAtViewportPoint(
		viewportPoint: NormalizedViewportPoint,
		mask: ReadonlySet<RenderSpatialItemKind>,
		ownerKeys?: ReadonlySet<string>,
	): RenderSpatialPick | null {
		return (
			rendererController?.pickAtViewportPoint(viewportPoint, mask, ownerKeys) ??
			null
		);
	}

	export function inspectResources(): RenderResourceInspectionSnapshot {
		return (
			rendererController?.inspectResources() ??
			createEmptyRenderResourceInspectionSnapshot()
		);
	}

	export function previewTexturePage(
		identity: RenderResourceTexturePageIdentity,
	): RenderResourceTexturePagePreview | null {
		return rendererController?.previewTexturePage(identity) ?? null;
	}

	function commitStaticProductToSet(
		productSet: StaticLandblockRenderProductSet,
		result: LandblockRenderProductWorkerResult,
	): StaticLandblockRenderProductSet {
		const nextProductKey = formatStaticLandblockProductKey(
			createStaticLandblockProductKeyFromResult(result),
		);
		const artifacts = [
			...productSet.artifacts.filter(
				(artifact) =>
					formatStaticLandblockProductKey(
						createStaticLandblockProductKeyFromResult(artifact),
					) !== nextProductKey,
			),
			result,
		];
		return {
			...productSet,
			artifacts,
			residentCount: artifacts.length,
		};
	}

	function evictStaticProductFromSet(
		productSet: StaticLandblockRenderProductSet,
		key: StaticLandblockProductKey,
	): StaticLandblockRenderProductSet {
		const productKey = formatStaticLandblockProductKey(key);
		const artifacts = productSet.artifacts.filter(
			(artifact) =>
				formatStaticLandblockProductKey(
					createStaticLandblockProductKeyFromResult(artifact),
				) !== productKey,
		);
		return {
			...productSet,
			artifacts,
			residentCount: artifacts.length,
		};
	}
</script>

<div class="world-display">
	<button
		aria-label="World display viewport"
		class="world-display__viewport-button"
		type="button"
	>
		<div class="world-display__viewport">
			<div bind:this={viewportHost} class="world-display__renderer-host"></div>
		</div>
	</button>
</div>
