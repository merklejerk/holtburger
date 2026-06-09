import type { PreparedAssetResolver } from "../assets/prepared-asset-store";
import type { SceneCameraFrame } from "./camera";
import type { WorldDebugOverlayModel } from "./debug-overlays";
import type { NormalizedViewportPoint } from "./model";
import type { RenderChunkTransform } from "./render-anchor";
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
import type {
	RenderResourceInspectionSnapshot,
	RenderResourceTexturePageIdentity,
	RenderResourceTexturePagePreview,
} from "./render-resource-inspection";
import type { WorldRenderSceneContext } from "./render-scene-context";
import type {
	StaticLandblockProductKey,
	StaticLandblockRenderProductSet,
} from "./static-landblock-render-artifact-store";
import type { LandblockRenderProductWorkerResult } from "./landblock-render-product";

export interface WorldDisplayRendererOptions {
	preparedAssetResolver: PreparedAssetResolver;
	staticLandblockRenderProducts: StaticLandblockRenderProductSet;
	debugOverlayScene: WorldDebugOverlayModel;
	renderSceneContext: WorldRenderSceneContext;
	renderChunkTransforms: readonly RenderChunkTransform[];
	renderSpatialQuery: RenderSpatialIndexQuery | null;
	selectedStaticRenderableRenderKey: string | null;
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
	commitStaticLandblockProduct(
		result: LandblockRenderProductWorkerResult,
	): void;
	evictStaticLandblockProduct(key: StaticLandblockProductKey): void;
	clearStaticLandblockProducts(): void;
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
	inspectResources(): RenderResourceInspectionSnapshot;
	previewTexturePage(
		identity: RenderResourceTexturePageIdentity,
	): RenderResourceTexturePagePreview | null;
	pickTerrainLandblockAtViewportPoint(
		viewportPoint: NormalizedViewportPoint,
	): number | null;
	pickAtViewportPoint(
		viewportPoint: NormalizedViewportPoint,
		mask: ReadonlySet<RenderSpatialItemKind>,
		ownerKeys?: ReadonlySet<string>,
	): RenderSpatialPick | null;
	dispose(): void;
}
