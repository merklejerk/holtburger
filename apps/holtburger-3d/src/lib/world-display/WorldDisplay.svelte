<script lang="ts">
	import { untrack } from "svelte";

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
	import type { RenderChunkTransform } from "./render-anchor";
	import type { SceneCameraFrame } from "./camera";
	import type {
		BrowserCameraResidencyChangeHandler,
		WorldRenderCameraFrameChangeHandler,
		WorldRenderMetricsChangeHandler,
	} from "./renderer-contract";
	import {
		createEmptyStaticRenderableSceneModel,
		type StaticRenderableSceneModel,
	} from "./static-renderables";
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
	}: {
		onCameraFrameChange?: WorldRenderCameraFrameChangeHandler;
		onRenderMetricsChange?: WorldRenderMetricsChangeHandler;
		onCameraResidencyChange?: BrowserCameraResidencyChangeHandler;
	} = $props();

	let viewportHost = $state<HTMLDivElement | null>(null);
	let rendererController = $state<WorldDisplayRenderer | null>(null);

	let assetState = createInitialAssetChannelState();
	let terrainScene = createEmptyTerrainSceneModel();
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
	let controlledCameraFrame: SceneCameraFrame | null = null;
	let transitionPortalMaxDepth = 1;

	let assetStateRevision = "initial";
	let terrainSceneRevision = "initial";
	let staticRenderableSceneRevision = "initial";
	let structuredInteriorSceneRevision = "initial";
	let transitionPortalModelRevision = "initial";
	let debugOverlaySceneRevision = "initial";
	let renderSceneContextRevision = "initial";
	let renderChunkTransformsRevision = "initial";
	let renderSpatialQueryRevision = "initial";
	let controlledCameraFrameRevision = "initial";
	let transitionPortalMaxDepthRevision = "initial";

	let appliedAssetStateRevision: string | null = null;
	let appliedTerrainSceneRevision: string | null = null;
	let appliedStaticRenderableSceneRevision: string | null = null;
	let appliedStructuredInteriorSceneRevision: string | null = null;
	let appliedTransitionPortalModelRevision: string | null = null;
	let appliedDebugOverlaySceneRevision: string | null = null;
	let appliedRenderSceneContextRevision: string | null = null;
	let appliedRenderChunkTransformsRevision: string | null = null;
	let appliedRenderSpatialQueryRevision: string | null = null;
	let appliedControlledCameraFrameRevision: string | null = null;
	let appliedTransitionPortalMaxDepthRevision: string | null = null;

	$effect(() => {
		if (!viewportHost) {
			return;
		}

		const controller = createWorldDisplayRenderer(
			viewportHost,
			untrack(() => ({
				assetState,
				terrainScene,
				staticRenderableScene,
				structuredInteriorScene,
				transitionPortalModel,
				transitionPortalMaxDepth,
				debugOverlayScene,
				renderSceneContext,
				renderChunkTransforms,
				renderSpatialQuery,
				controlledCameraFrame,
				onCameraFrameChange,
				onRenderMetricsChange,
				onCameraResidencyChange,
			})),
		);
		appliedAssetStateRevision = assetStateRevision;
		appliedTerrainSceneRevision = terrainSceneRevision;
		appliedStaticRenderableSceneRevision = staticRenderableSceneRevision;
		appliedStructuredInteriorSceneRevision = structuredInteriorSceneRevision;
		appliedTransitionPortalModelRevision = transitionPortalModelRevision;
		appliedDebugOverlaySceneRevision = debugOverlaySceneRevision;
		appliedRenderSceneContextRevision = renderSceneContextRevision;
		appliedRenderChunkTransformsRevision = renderChunkTransformsRevision;
		appliedRenderSpatialQueryRevision = renderSpatialQueryRevision;
		appliedControlledCameraFrameRevision = controlledCameraFrameRevision;
		appliedTransitionPortalMaxDepthRevision = transitionPortalMaxDepthRevision;
		rendererController = controller;

		return () => {
			if (rendererController === controller) {
				rendererController = null;
			}
			controller.dispose();
		};
	});

	$effect(() => {
		const controller = rendererController;
		if (!controller) {
			return;
		}
		controller.setCameraFrameChangeHandler(onCameraFrameChange);
	});

	$effect(() => {
		const controller = rendererController;
		if (!controller) {
			return;
		}
		controller.setRenderMetricsChangeHandler(onRenderMetricsChange);
	});

	$effect(() => {
		const controller = rendererController;
		if (!controller) {
			return;
		}
		controller.setCameraResidencyChangeHandler(onCameraResidencyChange);
	});

	export function setAssetState(
		revision: string,
		nextAssetState: AssetChannelState,
	): void {
		assetState = nextAssetState;
		assetStateRevision = revision;
		applyAssetState();
	}

	export function setTerrainScene(
		revision: string,
		nextScene: TerrainSceneModel,
	): void {
		terrainScene = nextScene;
		terrainSceneRevision = revision;
		applyTerrainScene();
	}

	export function setStaticRenderableScene(
		revision: string,
		nextScene: StaticRenderableSceneModel,
	): void {
		staticRenderableScene = nextScene;
		staticRenderableSceneRevision = revision;
		applyStaticRenderableScene();
	}

	export function setStructuredInteriorScene(
		revision: string,
		nextScene: StructuredInteriorSceneModel,
	): void {
		structuredInteriorScene = nextScene;
		structuredInteriorSceneRevision = revision;
		applyStructuredInteriorScene();
	}

	export function setTransitionPortalModel(
		revision: string,
		nextModel: TransitionPortalCandidateModel,
	): void {
		transitionPortalModel = nextModel;
		transitionPortalModelRevision = revision;
		applyTransitionPortalModel();
	}

	export function setDebugOverlayScene(
		revision: string,
		nextScene: WorldDebugOverlayModel,
	): void {
		debugOverlayScene = nextScene;
		debugOverlaySceneRevision = revision;
		applyDebugOverlayScene();
	}

	export function setRenderSceneContext(
		revision: string,
		nextContext: WorldRenderSceneContext,
	): void {
		renderSceneContext = nextContext;
		renderSceneContextRevision = revision;
		applyRenderSceneContext();
	}

	export function setRenderChunkTransforms(
		revision: string,
		nextTransforms: readonly RenderChunkTransform[],
	): void {
		renderChunkTransforms = nextTransforms;
		renderChunkTransformsRevision = revision;
		applyRenderChunkTransforms();
	}

	export function setRenderSpatialQuery(
		revision: string,
		nextQuery: RenderSpatialIndexQuery | null,
	): void {
		renderSpatialQuery = nextQuery;
		renderSpatialQueryRevision = revision;
		applyRenderSpatialQuery();
	}

	export function setControlledCameraFrame(
		revision: string,
		nextFrame: SceneCameraFrame | null,
	): void {
		controlledCameraFrame = nextFrame;
		controlledCameraFrameRevision = revision;
		applyControlledCameraFrame();
	}

	export function setTransitionPortalMaxDepth(
		revision: string,
		nextMaxDepth: number,
	): void {
		transitionPortalMaxDepth = nextMaxDepth;
		transitionPortalMaxDepthRevision = revision;
		applyTransitionPortalMaxDepth();
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

	function applyAssetState(): void {
		const controller = rendererController;
		if (!controller || appliedAssetStateRevision === assetStateRevision) {
			return;
		}
		controller.setAssetState(assetState);
		appliedAssetStateRevision = assetStateRevision;
	}

	function applyTerrainScene(): void {
		const controller = rendererController;
		if (!controller || appliedTerrainSceneRevision === terrainSceneRevision) {
			return;
		}
		controller.setTerrainScene(terrainScene);
		appliedTerrainSceneRevision = terrainSceneRevision;
	}

	function applyStaticRenderableScene(): void {
		const controller = rendererController;
		if (
			!controller ||
			appliedStaticRenderableSceneRevision === staticRenderableSceneRevision
		) {
			return;
		}
		controller.setStaticRenderableScene(staticRenderableScene);
		appliedStaticRenderableSceneRevision = staticRenderableSceneRevision;
	}

	function applyStructuredInteriorScene(): void {
		const controller = rendererController;
		if (
			!controller ||
			appliedStructuredInteriorSceneRevision === structuredInteriorSceneRevision
		) {
			return;
		}
		controller.setStructuredInteriorScene(structuredInteriorScene);
		appliedStructuredInteriorSceneRevision = structuredInteriorSceneRevision;
	}

	function applyTransitionPortalModel(): void {
		const controller = rendererController;
		if (
			!controller ||
			appliedTransitionPortalModelRevision === transitionPortalModelRevision
		) {
			return;
		}
		controller.setTransitionPortalModel(transitionPortalModel);
		appliedTransitionPortalModelRevision = transitionPortalModelRevision;
	}

	function applyDebugOverlayScene(): void {
		const controller = rendererController;
		if (
			!controller ||
			appliedDebugOverlaySceneRevision === debugOverlaySceneRevision
		) {
			return;
		}
		controller.setDebugOverlayScene(debugOverlayScene);
		appliedDebugOverlaySceneRevision = debugOverlaySceneRevision;
	}

	function applyRenderSceneContext(): void {
		const controller = rendererController;
		if (
			!controller ||
			appliedRenderSceneContextRevision === renderSceneContextRevision
		) {
			return;
		}
		controller.setRenderSceneContext(renderSceneContext);
		appliedRenderSceneContextRevision = renderSceneContextRevision;
	}

	function applyRenderChunkTransforms(): void {
		const controller = rendererController;
		if (
			!controller ||
			appliedRenderChunkTransformsRevision === renderChunkTransformsRevision
		) {
			return;
		}
		controller.setRenderChunkTransforms(renderChunkTransforms);
		appliedRenderChunkTransformsRevision = renderChunkTransformsRevision;
	}

	function applyRenderSpatialQuery(): void {
		const controller = rendererController;
		if (
			!controller ||
			appliedRenderSpatialQueryRevision === renderSpatialQueryRevision
		) {
			return;
		}
		controller.setRenderSpatialQuery(renderSpatialQuery);
		appliedRenderSpatialQueryRevision = renderSpatialQueryRevision;
	}

	function applyControlledCameraFrame(): void {
		const controller = rendererController;
		if (
			!controller ||
			appliedControlledCameraFrameRevision === controlledCameraFrameRevision
		) {
			return;
		}
		controller.setControlledCameraFrame(controlledCameraFrame);
		appliedControlledCameraFrameRevision = controlledCameraFrameRevision;
	}

	function applyTransitionPortalMaxDepth(): void {
		const controller = rendererController;
		if (
			!controller ||
			appliedTransitionPortalMaxDepthRevision ===
				transitionPortalMaxDepthRevision
		) {
			return;
		}
		controller.setTransitionPortalMaxDepth(transitionPortalMaxDepth);
		appliedTransitionPortalMaxDepthRevision = transitionPortalMaxDepthRevision;
	}
</script>

<div class="world-display">
	<button
		aria-label="World display viewport"
		class="world-display__viewport-button"
		type="button"
	>
		<div class="world-display__viewport">
			<div bind:this={viewportHost} class="world-display__three-host"></div>
		</div>
	</button>
</div>
