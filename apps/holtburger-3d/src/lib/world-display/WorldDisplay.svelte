<script lang="ts">
	import { onMount, tick } from "svelte";

	import {
		createInitialAssetChannelState,
		type AssetChannelState,
	} from "../assets/types";
	import type { NormalizedViewportPoint } from "./model";
	import type {
		RenderSpatialIndexQuery,
		RenderSpatialItemKind,
		RenderSpatialPick,
	} from "./render-spatial-index";
	import type { DrawUnitRuntimeDiagnostic } from "./runtime-render-diagnostics";
	import type { RendererResourceGraph } from "./renderer-resource-graph";
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
		createEmptyStaticRenderableSceneModel,
		type StaticRenderableSceneModel,
	} from "./static-renderables";
	import {
		createEmptyStaticLandblockRenderProductSet,
		type StaticLandblockRenderProductSet,
	} from "./static-landblock-render-artifact-store";
	import {
		createEmptyStructuredInteriorSceneModel,
		type StructuredInteriorSceneModel,
	} from "./structured-interior-scene";
	import {
		createEmptyTerrainSceneModel,
		type TerrainSceneModel,
	} from "./terrain-scene";
	import {
		createEmptyWorldDebugOverlayModel,
		type WorldDebugOverlayModel,
	} from "./debug-overlays";
	import {
		createEmptyTransitionPortalCandidateModel,
		type TransitionPortalCandidateModel,
	} from "./transition-portal-work-items";
	import type { WorldRenderSceneContext } from "./render-scene-context";
	import {
		createWorldDisplayRenderer,
		type WorldDisplayRenderer,
	} from "./world-display-renderer";

	let {
		onCameraFrameChange,
		onRenderMetricsChange,
		onCameraResidencyChange,
		rendererResourceGraph,
	}: {
		onCameraFrameChange?: WorldRenderCameraFrameChangeHandler;
		onRenderMetricsChange?: WorldRenderMetricsChangeHandler;
		onCameraResidencyChange?: BrowserCameraResidencyChangeHandler;
		rendererResourceGraph?: RendererResourceGraph;
	} = $props();

	let viewportHost = $state<HTMLDivElement | null>(null);
	let rendererController = $state<WorldDisplayRenderer | null>(null);

	let assetState = createInitialAssetChannelState();
	let terrainScene = createEmptyTerrainSceneModel();
	let staticLandblockRenderProducts =
		createEmptyStaticLandblockRenderProductSet();
	let staticRenderableScene = createEmptyStaticRenderableSceneModel();
	let structuredInteriorScene = createEmptyStructuredInteriorSceneModel();
	let transitionPortalModel = createEmptyTransitionPortalCandidateModel();
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
				terrainScene,
				staticLandblockRenderProducts,
				staticRenderableScene,
				structuredInteriorScene,
				transitionPortalModel,
				transitionPortalMaxDepth,
				debugOverlayScene,
				renderSceneContext,
				renderChunkTransforms,
				renderSpatialQuery,
				selectedStaticRenderableRenderKey,
				rendererResourceGraph,
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

	export function setTerrainScene(nextScene: TerrainSceneModel): void {
		terrainScene = nextScene;
		rendererController?.setTerrainScene(terrainScene);
	}

	export function setStaticRenderableScene(
		nextScene: StaticRenderableSceneModel,
	): void {
		staticRenderableScene = nextScene;
		rendererController?.setStaticRenderableScene(staticRenderableScene);
	}

	export function replaceStaticLandblockProducts(
		nextArtifacts: StaticLandblockRenderProductSet,
	): void {
		staticLandblockRenderProducts = nextArtifacts;
		rendererController?.replaceStaticLandblockProducts(
			staticLandblockRenderProducts,
		);
	}

	export function setStructuredInteriorScene(
		nextScene: StructuredInteriorSceneModel,
	): void {
		structuredInteriorScene = nextScene;
		rendererController?.setStructuredInteriorScene(structuredInteriorScene);
	}

	export function setTransitionPortalModel(
		nextModel: TransitionPortalCandidateModel,
	): void {
		transitionPortalModel = nextModel;
		rendererController?.setTransitionPortalModel(transitionPortalModel);
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

	export function getDrawUnitRuntimeDiagnostics(
		drawUnitIds: readonly string[],
	): readonly DrawUnitRuntimeDiagnostic[] {
		return rendererController?.getDrawUnitRuntimeDiagnostics(drawUnitIds) ?? [];
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
