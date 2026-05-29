import {
	parseWorldRenderBackend,
	type WorldRenderBackend,
} from "../app-config/render-backend";
import { createThreeWorldDisplayRenderer } from "./three-world-display-renderer";
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
	const rendererBackend = readConfiguredWorldRenderBackend();
	switch (rendererBackend) {
		case "three":
			return createThreeWorldDisplayRenderer(host, options);
		case "luma":
			return createDeferredWorldDisplayRenderer({
				host,
				options,
				backendLabel: "luma",
				loadModule: () => import("./luma-world-display-renderer-impl"),
				createRenderer: (module, currentOptions) =>
					module.createLumaWorldDisplayRendererImplementation(
						host,
						currentOptions,
					),
			});
		case "webgl2":
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
}

type LumaRendererModule = typeof import("./luma-world-display-renderer-impl");
type Webgl2RendererModule = typeof import("./webgl2-world-display-renderer-impl");
type DeferredRendererModule = LumaRendererModule | Webgl2RendererModule;

interface DeferredWorldDisplayRendererInput<TModule extends DeferredRendererModule> {
	host: HTMLDivElement;
	options: WorldDisplayRendererOptions;
	backendLabel: string;
	loadModule(): Promise<TModule>;
	createRenderer(
		module: TModule,
		options: WorldDisplayRendererOptions,
	): WorldDisplayRenderer;
}

function readConfiguredWorldRenderBackend(): WorldRenderBackend {
	return parseWorldRenderBackend(
		import.meta.env.VITE_HOLTBURGER_RENDER_BACKEND,
	);
}

function createDeferredWorldDisplayRenderer<TModule extends DeferredRendererModule>(
	input: DeferredWorldDisplayRendererInput<TModule>,
): WorldDisplayRenderer {
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
	const rendererResourceGraph = options.rendererResourceGraph;
	let controlledCameraFrame = options.controlledCameraFrame;
	let transitionPortalMaxDepth = options.transitionPortalMaxDepth;
	let renderStyle = options.renderStyle;
	let textureFilteringMode = options.textureFilteringMode;
	let textureColorSpaceMode = options.textureColorSpaceMode;
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
		setTextureColorSpaceMode(mode) {
			textureColorSpaceMode = mode;
			loadedRenderer?.setTextureColorSpaceMode(mode);
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
			rendererResourceGraph,
			controlledCameraFrame,
			transitionPortalMaxDepth,
			renderStyle,
			textureFilteringMode,
			textureColorSpaceMode,
			detailTexturesEnabled,
			onCameraFrameChange,
			onRenderMetricsChange,
			onCameraResidencyChange,
		};
	}
}
