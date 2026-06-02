import type { AssetChannelState } from "../assets/types";
import type { SceneCameraFrame } from "./camera";
import type { WorldDebugOverlayModel } from "./debug-overlays";
import type { NormalizedViewportPoint } from "./model";
import type { RenderChunkTransform } from "./render-anchor";
import type { RendererResourceGraph } from "./renderer-resource-graph";
import type {
	RenderSpatialIndexQuery,
	RenderSpatialItemKind,
	RenderSpatialPick,
} from "./render-spatial-index";
import type {
	BrowserCameraResidencyChangeHandler,
	WorldDisplayRenderStyle,
	WorldDisplayTextureFilteringMode,
	WorldRenderCameraFrameChangeHandler,
	WorldRenderMetricsChangeHandler,
} from "./renderer-contract";
import type { DrawUnitRuntimeDiagnostic } from "./runtime-render-diagnostics";
import type { WorldRenderSceneContext } from "./render-scene-context";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";
import type { TransitionPortalCandidateModel } from "./transition-portal-work-items";

export interface WorldDisplayRendererOptions {
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	transitionPortalModel: TransitionPortalCandidateModel;
	debugOverlayScene: WorldDebugOverlayModel;
	renderSceneContext: WorldRenderSceneContext;
	renderChunkTransforms: readonly RenderChunkTransform[];
	renderSpatialQuery: RenderSpatialIndexQuery | null;
	selectedStaticRenderableRenderKey: string | null;
	rendererResourceGraph?: RendererResourceGraph;
	controlledCameraFrame: SceneCameraFrame | null;
	transitionPortalMaxDepth?: number;
	renderStyle?: WorldDisplayRenderStyle;
	textureFilteringMode?: WorldDisplayTextureFilteringMode;
	detailTexturesEnabled?: boolean;
	onCameraFrameChange?: WorldRenderCameraFrameChangeHandler;
	onRenderMetricsChange?: WorldRenderMetricsChangeHandler;
	onCameraResidencyChange?: BrowserCameraResidencyChangeHandler;
}

export interface WorldDisplayRenderer {
	setAssetState(assetState: AssetChannelState): void;
	setTerrainScene(scene: TerrainSceneModel): void;
	setStaticRenderableScene(scene: StaticRenderableSceneModel): void;
	setStructuredInteriorScene(scene: StructuredInteriorSceneModel): void;
	setTransitionPortalModel(model: TransitionPortalCandidateModel): void;
	setDebugOverlayScene(scene: WorldDebugOverlayModel): void;
	setRenderSceneContext(context: WorldRenderSceneContext): void;
	setRenderChunkTransforms(transforms: readonly RenderChunkTransform[]): void;
	setRenderSpatialQuery(query: RenderSpatialIndexQuery | null): void;
	setSelectedStaticRenderableRenderKey(renderKey: string | null): void;
	setControlledCameraFrame(frame: SceneCameraFrame | null): void;
	setTransitionPortalMaxDepth(maxDepth: number): void;
	setRenderStyle(renderStyle: WorldDisplayRenderStyle): void;
	setTextureFilteringMode(mode: WorldDisplayTextureFilteringMode): void;
	setDetailTexturesEnabled(enabled: boolean): void;
	setCameraFrameChangeHandler(
		handler: WorldRenderCameraFrameChangeHandler | undefined,
	): void;
	setRenderMetricsChangeHandler(
		handler: WorldRenderMetricsChangeHandler | undefined,
	): void;
	setCameraResidencyChangeHandler(
		handler: BrowserCameraResidencyChangeHandler | undefined,
	): void;
	pickTerrainLandblockAtViewportPoint(
		viewportPoint: NormalizedViewportPoint,
	): number | null;
	pickAtViewportPoint(
		viewportPoint: NormalizedViewportPoint,
		mask: ReadonlySet<RenderSpatialItemKind>,
		ownerKeys?: ReadonlySet<string>,
	): RenderSpatialPick | null;
	getDrawUnitRuntimeDiagnostics(
		drawUnitIds: readonly string[],
	): readonly DrawUnitRuntimeDiagnostic[];
	dispose(): void;
}
