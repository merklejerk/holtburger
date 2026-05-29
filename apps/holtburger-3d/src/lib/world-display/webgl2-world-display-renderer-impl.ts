import {
	createWebgl2ArrayBuffer,
	createWebgl2Program,
	createWebgl2VertexArray,
	type Webgl2BufferResource,
	type Webgl2ProgramResource,
	type Webgl2VertexArrayResource,
} from "./webgl2-gl";
import { createFallbackSceneCameraFrame } from "./camera";
import { createWebgl2RenderMetrics } from "./webgl2-render-metrics";
import { Webgl2StateCache } from "./webgl2-state-cache";
import {
	buildStagedWorldFrame,
	type StagedWorldFrameMetrics,
} from "./staged-world-frame";
import {
	createEmptyWebgl2WorldSubmitMetrics,
	submitWebgl2FlatWorldFrame,
	type Webgl2FlatWorldProgram,
	type Webgl2TexturedWorldProgram,
	type Webgl2WorldSubmitMetrics,
} from "./webgl2-world-submit";
import {
	createWebgl2WorldResourceStore,
	destroyWebgl2WorldResources,
	syncWebgl2WorldResources,
	type Webgl2WorldResourceStore,
} from "./webgl2-world-resources";
import type { WorldRenderMetrics } from "./renderer-contract";
import type {
	WorldDisplayRenderer,
	WorldDisplayRendererOptions,
} from "./world-display-renderer-contract";

const WEBGL2_CANVAS_CLASS_NAME = "world-display__webgl2-canvas";
const WEBGL2_ERROR_CLASS_NAME = "world-display__webgl2-error";
const WEBGL2_CLEAR_COLOR: readonly [number, number, number, number] = [
	0.015, 0.055, 0.085, 1,
];
const PERFORMANCE_REPORT_INTERVAL_MS = 500;
const TRIANGLE_VERTEX_COUNT = 3;
const TRIANGLE_VERTICES = new Float32Array([
	0, 0.58, -0.58, -0.46, 0.58, -0.46,
]);

const TRIANGLE_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 position;

void main() {
	gl_Position = vec4(position, 0.0, 1.0);
}
`;

const TRIANGLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

out vec4 fragColor;

void main() {
	fragColor = vec4(0.98, 0.74, 0.34, 1.0);
}
`;

const FLAT_WORLD_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;

uniform mat4 uModelViewProjection;

void main() {
	gl_Position = uModelViewProjection * vec4(position, 1.0);
}
`;

const FLAT_WORLD_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec4 uColor;

out vec4 fragColor;

void main() {
	fragColor = uColor;
}
`;

const TEXTURED_WORLD_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec2 uv;

uniform mat4 uModelViewProjection;

out vec2 vUv;

void main() {
	vUv = uv;
	gl_Position = uModelViewProjection * vec4(position, 1.0);
}
`;

const TEXTURED_WORLD_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec4 uColor;
uniform float uAlphaTest;
uniform sampler2D uTexture;

in vec2 vUv;

out vec4 fragColor;

void main() {
	vec4 texel = texture(uTexture, vUv);
	vec4 color = texel * uColor;
	if (color.a < uAlphaTest) {
		discard;
	}
	fragColor = color;
}
`;

interface Webgl2RenderResources {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	triangleProgram: Webgl2ProgramResource<"position", never>;
	flatWorldProgram: Webgl2FlatWorldProgram;
	texturedWorldProgram: Webgl2TexturedWorldProgram;
	vertexBuffer: Webgl2BufferResource;
	vertexArray: Webgl2VertexArrayResource;
	worldStore: Webgl2WorldResourceStore;
}

export function createWebgl2WorldDisplayRendererImplementation(
	host: HTMLDivElement,
	options: WorldDisplayRendererOptions,
): WorldDisplayRenderer {
	let assetState = options.assetState;
	let terrainScene = options.terrainScene;
	let staticRenderableScene = options.staticRenderableScene;
	let structuredInteriorScene = options.structuredInteriorScene;
	let transitionPortalModel = options.transitionPortalModel;
	let renderChunkTransforms = options.renderChunkTransforms;
	let controlledCameraFrame = options.controlledCameraFrame;
	let transitionPortalMaxDepth = options.transitionPortalMaxDepth ?? 1;
	let textureFilteringMode = options.textureFilteringMode ?? "anisotropic-4x";
	let textureColorSpaceMode = options.textureColorSpaceMode ?? "auto";
	let detailTexturesEnabled = options.detailTexturesEnabled ?? true;
	let renderMetricsChangeHandler = options.onRenderMetricsChange;
	let disposed = false;
	let frameHandle: number | null = null;
	let resources: Webgl2RenderResources | null = null;
	let initializationError: string | null = null;
	let clearCount = 0;
	let drawCallCount = 0;
	let lastFrameDrawCount = 0;
	let lastFrameAt: number | null = null;
	let performanceWindowStartedAt = 0;
	let performanceWindowFrameCount = 0;
	let performanceWindowFrameMs = 0;
	let performanceWindowRenderMs = 0;
	let latestPerformanceMetrics: WorldRenderMetrics["performance"] = null;
	let latestSubmitMetrics: Webgl2WorldSubmitMetrics =
		createEmptyWebgl2WorldSubmitMetrics();
	let latestFrameMetrics: StagedWorldFrameMetrics | null = null;

	const canvas = document.createElement("canvas");
	canvas.className = WEBGL2_CANVAS_CLASS_NAME;
	Object.assign(canvas.style, {
		display: "block",
		height: "100%",
		width: "100%",
	});
	host.append(canvas);

	const resizeObserver = new ResizeObserver(() => {
		syncCanvasSize();
		reportMetrics();
	});
	resizeObserver.observe(host);

	initialize();
	reportMetrics();

	return {
		setAssetState(nextAssetState) {
			assetState = nextAssetState;
			syncWorldResources();
			reportMetrics();
		},
		setTerrainScene(scene) {
			terrainScene = scene;
			syncWorldResources();
			reportMetrics();
		},
		setStaticRenderableScene(scene) {
			staticRenderableScene = scene;
			syncWorldResources();
			reportMetrics();
		},
		setStructuredInteriorScene(scene) {
			structuredInteriorScene = scene;
			syncWorldResources();
			reportMetrics();
		},
		setTransitionPortalModel(model) {
			transitionPortalModel = model;
			syncWorldResources();
			reportMetrics();
		},
		setDebugOverlayScene() {
			reportMetrics();
		},
		setRenderSceneContext() {
			reportMetrics();
		},
		setRenderChunkTransforms(transforms) {
			renderChunkTransforms = transforms;
			syncWorldResources();
			reportMetrics();
		},
		setRenderSpatialQuery() {
			reportMetrics();
		},
		setControlledCameraFrame(frame) {
			controlledCameraFrame = frame;
			reportMetrics();
		},
		setTransitionPortalMaxDepth(maxDepth) {
			transitionPortalMaxDepth = maxDepth;
			reportMetrics();
		},
		setRenderStyle() {
			reportMetrics();
		},
		setTextureFilteringMode(mode) {
			textureFilteringMode = mode;
			reportMetrics();
		},
		setTextureColorSpaceMode(mode) {
			textureColorSpaceMode = mode;
			reportMetrics();
		},
		setDetailTexturesEnabled(enabled) {
			detailTexturesEnabled = enabled;
			reportMetrics();
		},
		setCameraFrameChangeHandler() {
			return;
		},
		setRenderMetricsChangeHandler(handler) {
			renderMetricsChangeHandler = handler;
			reportMetrics();
		},
		setCameraResidencyChangeHandler() {
			return;
		},
		pickTerrainLandblockAtViewportPoint() {
			return null;
		},
		pickAtViewportPoint() {
			return null;
		},
		dispose() {
			disposed = true;
			if (frameHandle !== null) {
				cancelAnimationFrame(frameHandle);
				frameHandle = null;
			}
			resizeObserver.disconnect();
			destroyResources();
			canvas.remove();
			host.querySelector(`.${WEBGL2_ERROR_CLASS_NAME}`)?.remove();
		},
	};

	function initialize(): void {
		try {
			const gl = canvas.getContext("webgl2", {
				alpha: false,
				antialias: true,
				depth: true,
				stencil: false,
			});
			if (!gl) {
				throw new Error("Browser did not provide a WebGL2 rendering context.");
			}

			resources = createTriangleResources(gl);
			syncCanvasSize();
			syncWorldResources();
			scheduleFrame();
		} catch (error) {
			initializationError =
				error instanceof Error ? error.message : String(error);
			console.error("[holtburger-3d][webgl2]", error);
			showInitializationError(initializationError);
			reportMetrics();
		}
	}

	function scheduleFrame(): void {
		if (disposed || frameHandle !== null) {
			return;
		}
		frameHandle = requestAnimationFrame((frameAt) => {
			frameHandle = null;
			renderFrame(frameAt);
		});
	}

	function renderFrame(frameAt: number): void {
		if (!resources) {
			return;
		}
		scheduleFrame();

		syncCanvasSize();
		const renderStartedAt = window.performance.now();
		const { gl } = resources;
		resources.stateCache.setViewport({
			x: 0,
			y: 0,
			width: canvas.width,
			height: canvas.height,
		});
		gl.clearColor(...WEBGL2_CLEAR_COLOR);
		gl.clearDepth(1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		clearCount += 1;

		if (resources.worldStore.drawUnits.length > 0) {
			const frame = buildStagedWorldFrame({
				assetState,
				candidates: resources.worldStore.drawUnits,
				cameraFrame: resolveCameraFrame(),
				renderChunkTransforms,
				staticRenderableScene,
				structuredInteriorScene,
				terrainScene,
			});
			latestFrameMetrics = frame.metrics;
			latestSubmitMetrics = submitWebgl2FlatWorldFrame({
				gl,
				stateCache: resources.stateCache,
				program: resources.flatWorldProgram,
				texturedProgram: resources.texturedWorldProgram,
				drawUnitsById: resources.worldStore.drawUnitsById,
				frame,
			});
			drawCallCount += latestSubmitMetrics.drawCallCount;
			lastFrameDrawCount = latestSubmitMetrics.drawCallCount;
		} else {
			latestFrameMetrics = null;
			latestSubmitMetrics = createEmptyWebgl2WorldSubmitMetrics();
			resources.stateCache.useProgram(resources.triangleProgram.program);
			resources.stateCache.bindVertexArray(resources.vertexArray.vertexArray);
			gl.drawArrays(gl.TRIANGLES, 0, TRIANGLE_VERTEX_COUNT);
			drawCallCount += 1;
			lastFrameDrawCount = 1;
		}
		recordPerformanceSample({
			frameAt,
			renderMs: window.performance.now() - renderStartedAt,
		});
		reportMetrics();
	}

	function syncCanvasSize(): void {
		const pixelRatio = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(host.clientWidth * pixelRatio));
		const height = Math.max(1, Math.round(host.clientHeight * pixelRatio));
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
			resources?.stateCache.invalidate();
		}
	}

	function recordPerformanceSample({
		frameAt,
		renderMs,
	}: {
		frameAt: number;
		renderMs: number;
	}): void {
		if (lastFrameAt !== null) {
			const frameMs = frameAt - lastFrameAt;
			performanceWindowFrameCount += 1;
			performanceWindowFrameMs += frameMs;
			performanceWindowRenderMs += renderMs;
			if (
				frameAt - performanceWindowStartedAt >=
				PERFORMANCE_REPORT_INTERVAL_MS
			) {
				const averageFrameMs =
					performanceWindowFrameMs / performanceWindowFrameCount;
				const averageRenderMs =
					performanceWindowRenderMs / performanceWindowFrameCount;
				latestPerformanceMetrics = {
					fps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
					frameMs: averageFrameMs,
					renderMs: averageRenderMs,
				};
				performanceWindowStartedAt = frameAt;
				performanceWindowFrameCount = 0;
				performanceWindowFrameMs = 0;
				performanceWindowRenderMs = 0;
			}
		} else {
			performanceWindowStartedAt = frameAt;
		}
		lastFrameAt = frameAt;
	}

	function destroyResources(): void {
		if (!resources) {
			return;
		}
		resources.stateCache.bindVertexArray(null);
		resources.stateCache.useProgram(null);
		resources.vertexArray.dispose();
		resources.vertexBuffer.dispose();
		resources.triangleProgram.dispose();
		resources.flatWorldProgram.dispose();
		resources.texturedWorldProgram.dispose();
		destroyWebgl2WorldResources(resources.worldStore);
		resources = null;
	}

	function syncWorldResources(): void {
		if (!resources) {
			return;
		}
		syncWebgl2WorldResources({
			gl: resources.gl,
			store: resources.worldStore,
			assetState,
			terrainScene,
			staticRenderableScene,
			structuredInteriorScene,
			transitionPortalModel,
			renderChunkTransforms,
			rendererResourceGraph: options.rendererResourceGraph,
		});
		resources.stateCache.invalidate();
	}

	function resolveCameraFrame() {
		const aspect = canvas.width / Math.max(1, canvas.height);
		if (controlledCameraFrame) {
			return controlledCameraFrame.aspect === aspect
				? controlledCameraFrame
				: { ...controlledCameraFrame, aspect };
		}
		return createFallbackSceneCameraFrame(aspect);
	}

	function reportMetrics(): void {
		renderMetricsChangeHandler?.(
			createWebgl2RenderMetrics({
				terrainScene,
				staticRenderableScene,
				structuredInteriorScene,
				transitionPortalModel,
				cameraFrame: controlledCameraFrame,
				canvasWidth: canvas.width,
				canvasHeight: canvas.height,
				pixelRatio: window.devicePixelRatio || 1,
				renderGraphPolicy: initializationError
					? "webgl2-initialization-failed"
					: resources
						? resources.worldStore.drawUnits.length > 0
							? "webgl2-staged-resources"
							: "webgl2-test-frame"
						: "webgl2-initializing",
				transitionPortalMaxDepth,
				clearCount,
				drawCallCount,
				lastFrameDrawCount,
				initializationError,
				worldStore: resources?.worldStore ?? null,
				frameMetrics: latestFrameMetrics,
				submitMetrics: latestSubmitMetrics,
				performance: latestPerformanceMetrics,
				textureFilteringMode,
				textureColorSpaceMode,
				detailTexturesEnabled,
			}),
		);
	}

	function showInitializationError(message: string): void {
		const errorElement = document.createElement("div");
		errorElement.className = WEBGL2_ERROR_CLASS_NAME;
		errorElement.textContent = `WebGL2 renderer failed to initialize: ${message}`;
		Object.assign(errorElement.style, {
			alignItems: "center",
			background: "rgba(17, 24, 39, 0.92)",
			boxSizing: "border-box",
			color: "#fecaca",
			display: "flex",
			font: "13px/1.45 system-ui, sans-serif",
			inset: "0",
			justifyContent: "center",
			padding: "24px",
			position: "absolute",
			textAlign: "center",
		});
		host.append(errorElement);
	}
}

function createTriangleResources(
	gl: WebGL2RenderingContext,
): Webgl2RenderResources {
	const triangleProgram = createWebgl2Program(gl, {
		label: "webgl2 test triangle",
		vertexSource: TRIANGLE_VERTEX_SHADER,
		fragmentSource: TRIANGLE_FRAGMENT_SHADER,
		attributes: ["position"],
	});
	const vertexBuffer = createWebgl2ArrayBuffer(gl, {
		label: "webgl2 test triangle vertices",
		data: TRIANGLE_VERTICES,
	});
	const vertexArray = createWebgl2VertexArray(gl, {
		label: "webgl2 test triangle vertex array",
		configure() {
			gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer.buffer);
			gl.enableVertexAttribArray(triangleProgram.attributes.position);
			gl.vertexAttribPointer(
				triangleProgram.attributes.position,
				2,
				gl.FLOAT,
				false,
				0,
				0,
			);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		},
	});

	return {
		gl,
		stateCache: new Webgl2StateCache(gl),
		triangleProgram,
		flatWorldProgram: createFlatWorldProgram(gl),
		texturedWorldProgram: createTexturedWorldProgram(gl),
		vertexBuffer,
		vertexArray,
		worldStore: createWebgl2WorldResourceStore(),
	};
}

function createFlatWorldProgram(gl: WebGL2RenderingContext): Webgl2FlatWorldProgram {
	return createWebgl2Program(gl, {
		label: "webgl2 flat world",
		vertexSource: FLAT_WORLD_VERTEX_SHADER,
		fragmentSource: FLAT_WORLD_FRAGMENT_SHADER,
		attributes: ["position"],
		uniforms: ["uModelViewProjection", "uColor"],
	});
}

function createTexturedWorldProgram(
	gl: WebGL2RenderingContext,
): Webgl2TexturedWorldProgram {
	return createWebgl2Program(gl, {
		label: "webgl2 textured world",
		vertexSource: TEXTURED_WORLD_VERTEX_SHADER,
		fragmentSource: TEXTURED_WORLD_FRAGMENT_SHADER,
		attributes: ["position", "uv"],
		uniforms: ["uModelViewProjection", "uColor", "uAlphaTest", "uTexture"],
	});
}
