import type {
	WorldDisplayRenderer,
	WorldDisplayRendererOptions,
} from "./world-display-renderer-contract";

export type {
	WorldDisplayRenderer,
	WorldDisplayRendererOptions,
} from "./world-display-renderer-contract";

export function createWorldDisplayRenderer(
	host: HTMLDivElement,
	options: WorldDisplayRendererOptions,
): WorldDisplayRenderer {
	return createDeferredWorldDisplayRenderer({
		host,
		options,
		backendLabel: "webgl2",
		loadModule: () => import("./webgl2-world-display-renderer-impl"),
		createRenderer: (module, currentOptions) =>
			module.createWebgl2WorldDisplayRendererImplementation(
				host,
				currentOptions,
			),
	});
}

type Webgl2RendererModule =
	typeof import("./webgl2-world-display-renderer-impl");
type DeferredRendererModule = Webgl2RendererModule;

interface DeferredWorldDisplayRendererInput<
	TModule extends DeferredRendererModule,
> {
	host: HTMLDivElement;
	options: WorldDisplayRendererOptions;
	backendLabel: string;
	loadModule(): Promise<TModule>;
	createRenderer(
		module: TModule,
		options: WorldDisplayRendererOptions,
	): WorldDisplayRenderer;
}

function createDeferredWorldDisplayRenderer<
	TModule extends DeferredRendererModule,
>(input: DeferredWorldDisplayRendererInput<TModule>): WorldDisplayRenderer {
	let loadedRenderer: WorldDisplayRenderer | null = null;
	let disposed = false;

	const { options } = input;
	let assetState = options.assetState;
	let terrainScene = options.terrainScene;
	let staticRenderableScene = options.staticRenderableScene;
	let structuredInteriorScene = options.structuredInteriorScene;
	let transitionPortalModel = options.transitionPortalModel;
	let debugOverlayScene = options.debugOverlayScene;
	let renderSceneContext = options.renderSceneContext;
	let renderChunkTransforms = options.renderChunkTransforms;
	let renderSpatialQuery = options.renderSpatialQuery;
	let selectedStaticRenderableRenderKey =
		options.selectedStaticRenderableRenderKey;
	const rendererResourceGraph = options.rendererResourceGraph;
	let controlledCameraFrame = options.controlledCameraFrame;
	let transitionPortalMaxDepth = options.transitionPortalMaxDepth;
	let renderStyle = options.renderStyle;
	let textureFilteringMode = options.textureFilteringMode;
	let detailTexturesEnabled = options.detailTexturesEnabled;
	let onCameraFrameChange = options.onCameraFrameChange;
	let onRenderMetricsChange = options.onRenderMetricsChange;
	let onCameraResidencyChange = options.onCameraResidencyChange;

	void input
		.loadModule()
		.then((module) => installRenderer(module))
		.catch((error: unknown) => {
			console.error(`[holtburger-3d][${input.backendLabel}-loader]`, error);
		});

	return {
		setAssetState(nextAssetState) {
			assetState = nextAssetState;
			loadedRenderer?.setAssetState(nextAssetState);
		},
		setTerrainScene(scene) {
			terrainScene = scene;
			loadedRenderer?.setTerrainScene(scene);
		},
		setStaticRenderableScene(scene) {
			staticRenderableScene = scene;
			loadedRenderer?.setStaticRenderableScene(scene);
		},
		setStructuredInteriorScene(scene) {
			structuredInteriorScene = scene;
			loadedRenderer?.setStructuredInteriorScene(scene);
		},
		setTransitionPortalModel(model) {
			transitionPortalModel = model;
			loadedRenderer?.setTransitionPortalModel(model);
		},
		setDebugOverlayScene(scene) {
			debugOverlayScene = scene;
			loadedRenderer?.setDebugOverlayScene(scene);
		},
		setRenderSceneContext(context) {
			renderSceneContext = context;
			loadedRenderer?.setRenderSceneContext(context);
		},
		setRenderChunkTransforms(transforms) {
			renderChunkTransforms = transforms;
			loadedRenderer?.setRenderChunkTransforms(transforms);
		},
		setRenderSpatialQuery(query) {
			renderSpatialQuery = query;
			loadedRenderer?.setRenderSpatialQuery(query);
		},
		setSelectedStaticRenderableRenderKey(renderKey) {
			selectedStaticRenderableRenderKey = renderKey;
			loadedRenderer?.setSelectedStaticRenderableRenderKey(renderKey);
		},
		setControlledCameraFrame(frame) {
			controlledCameraFrame = frame;
			loadedRenderer?.setControlledCameraFrame(frame);
		},
		setTransitionPortalMaxDepth(maxDepth) {
			transitionPortalMaxDepth = maxDepth;
			loadedRenderer?.setTransitionPortalMaxDepth(maxDepth);
		},
		setRenderStyle(nextRenderStyle) {
			renderStyle = nextRenderStyle;
			loadedRenderer?.setRenderStyle(nextRenderStyle);
		},
		setTextureFilteringMode(mode) {
			textureFilteringMode = mode;
			loadedRenderer?.setTextureFilteringMode(mode);
		},
		setDetailTexturesEnabled(enabled) {
			detailTexturesEnabled = enabled;
			loadedRenderer?.setDetailTexturesEnabled(enabled);
		},
		setCameraFrameChangeHandler(handler) {
			onCameraFrameChange = handler;
			loadedRenderer?.setCameraFrameChangeHandler(handler);
		},
		setRenderMetricsChangeHandler(handler) {
			onRenderMetricsChange = handler;
			loadedRenderer?.setRenderMetricsChangeHandler(handler);
		},
		setCameraResidencyChangeHandler(handler) {
			onCameraResidencyChange = handler;
			loadedRenderer?.setCameraResidencyChangeHandler(handler);
		},
		pickTerrainLandblockAtViewportPoint(viewportPoint) {
			return (
				loadedRenderer?.pickTerrainLandblockAtViewportPoint(viewportPoint) ??
				null
			);
		},
		pickAtViewportPoint(viewportPoint, mask, ownerKeys) {
			return (
				loadedRenderer?.pickAtViewportPoint(viewportPoint, mask, ownerKeys) ??
				null
			);
		},
		getDrawUnitRuntimeDiagnostics(drawUnitIds) {
			return loadedRenderer?.getDrawUnitRuntimeDiagnostics(drawUnitIds) ?? [];
		},
		dispose() {
			disposed = true;
			loadedRenderer?.dispose();
			loadedRenderer = null;
		},
	};

	function installRenderer(module: TModule): void {
		if (disposed) {
			return;
		}

		const renderer = input.createRenderer(module, currentOptions());
		if (disposed) {
			renderer.dispose();
			return;
		}
		loadedRenderer = renderer;
	}

	function currentOptions(): WorldDisplayRendererOptions {
		return {
			assetState,
			terrainScene,
			staticRenderableScene,
			structuredInteriorScene,
			transitionPortalModel,
			debugOverlayScene,
			renderSceneContext,
			renderChunkTransforms,
			renderSpatialQuery,
			selectedStaticRenderableRenderKey,
			rendererResourceGraph,
			controlledCameraFrame,
			transitionPortalMaxDepth,
			renderStyle,
			textureFilteringMode,
			detailTexturesEnabled,
			onCameraFrameChange,
			onRenderMetricsChange,
			onCameraResidencyChange,
		};
	}
}
