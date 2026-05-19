<script lang="ts">
	import { untrack } from "svelte";

	import type { AssetChannelState } from "../assets/types";
	import type { NormalizedViewportPoint } from "./model";
	import type {
		RenderSpatialIndexQuery,
		RenderSpatialItemKind,
		RenderSpatialPick,
	} from "./render-spatial-index";
	import type { RenderChunkTransform } from "./render-anchor";
	import type { RenderLandblockAnchor } from "./render-chunks";
	import type { SceneCameraFrame } from "./camera";
	import type {
		WorldRenderCameraFrameChangeHandler,
		WorldRenderMetricsChangeHandler,
	} from "./renderer-contract";
	import type { WorldRenderPolicyMode } from "./render-policy";
	import type { StaticRenderableSceneModel } from "./static-renderables";
	import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
	import type { TerrainSceneModel } from "./terrain-scene";
	import type { WorldDebugOverlayModel } from "./debug-overlays";
	import type { TransitionPortalCandidateModel } from "./transition-portal-work-items";
	import {
		createWorldDisplayRenderer,
		type WorldDisplayRenderer,
	} from "./world-display-renderer";

	let {
		assetState,
		terrainScene,
		staticRenderableScene,
		structuredInteriorScene,
		transitionPortalModel,
		debugOverlayScene,
		renderPolicyMode = "browser-free-camera",
		activeRenderAnchor: _activeRenderAnchor = null,
		renderChunkTransforms = [],
		renderSpatialQuery = null,
		controlledCameraFrame = null,
		onCameraFrameChange,
		onRenderMetricsChange,
	}: {
		assetState: AssetChannelState;
		terrainScene: TerrainSceneModel;
		staticRenderableScene: StaticRenderableSceneModel;
		structuredInteriorScene: StructuredInteriorSceneModel;
		transitionPortalModel: TransitionPortalCandidateModel;
		debugOverlayScene: WorldDebugOverlayModel;
		renderPolicyMode?: WorldRenderPolicyMode;
		activeRenderAnchor?: RenderLandblockAnchor | null;
		renderChunkTransforms?: RenderChunkTransform[];
		renderSpatialQuery?: RenderSpatialIndexQuery | null;
		controlledCameraFrame?: SceneCameraFrame | null;
		onCameraFrameChange?: WorldRenderCameraFrameChangeHandler;
		onRenderMetricsChange?: WorldRenderMetricsChangeHandler;
	} = $props();

	let viewportHost = $state<HTMLDivElement | null>(null);
	let rendererController = $state<WorldDisplayRenderer | null>(null);

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
				debugOverlayScene,
				renderPolicyMode,
				renderChunkTransforms,
				renderSpatialQuery,
				controlledCameraFrame,
				onCameraFrameChange,
				onRenderMetricsChange,
			})),
		);
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
		controller.setAssetState(assetState);
	});

	$effect(() => {
		const controller = rendererController;
		if (!controller) {
			return;
		}
		controller.setRenderChunkTransforms(renderChunkTransforms);
	});

	$effect(() => {
		const controller = rendererController;
		if (!controller) {
			return;
		}
		controller.setTerrainScene(terrainScene);
	});

	$effect(() => {
		const controller = rendererController;
		if (!controller) {
			return;
		}
		controller.setStaticRenderableScene(staticRenderableScene);
	});

	$effect(() => {
		const controller = rendererController;
		if (!controller) {
			return;
		}
		controller.setStructuredInteriorScene(structuredInteriorScene);
	});

	$effect(() => {
		const controller = rendererController;
		if (!controller) {
			return;
		}
		controller.setTransitionPortalModel(transitionPortalModel);
	});

	$effect(() => {
		const controller = rendererController;
		if (!controller) {
			return;
		}
		controller.setDebugOverlayScene(debugOverlayScene);
	});

	$effect(() => {
		const controller = rendererController;
		if (!controller) {
			return;
		}
		controller.setRenderPolicyMode(renderPolicyMode);
	});

	$effect(() => {
		const controller = rendererController;
		if (!controller) {
			return;
		}
		controller.setRenderSpatialQuery(renderSpatialQuery);
	});

	$effect(() => {
		const controller = rendererController;
		if (!controller) {
			return;
		}
		controller.setControlledCameraFrame(controlledCameraFrame);
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
