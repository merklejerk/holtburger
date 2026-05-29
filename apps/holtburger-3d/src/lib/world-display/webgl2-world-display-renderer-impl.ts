import { createWebgl2RenderMetrics } from "./webgl2-render-metrics";
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

interface Webgl2RenderResources {
	gl: WebGL2RenderingContext;
	program: WebGLProgram;
	vertexBuffer: WebGLBuffer;
	vertexArray: WebGLVertexArrayObject;
}

export function createWebgl2WorldDisplayRendererImplementation(
	host: HTMLDivElement,
	options: WorldDisplayRendererOptions,
): WorldDisplayRenderer {
	let terrainScene = options.terrainScene;
	let staticRenderableScene = options.staticRenderableScene;
	let structuredInteriorScene = options.structuredInteriorScene;
	let transitionPortalModel = options.transitionPortalModel;
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
		setAssetState() {
			reportMetrics();
		},
		setTerrainScene(scene) {
			terrainScene = scene;
			reportMetrics();
		},
		setStaticRenderableScene(scene) {
			staticRenderableScene = scene;
			reportMetrics();
		},
		setStructuredInteriorScene(scene) {
			structuredInteriorScene = scene;
			reportMetrics();
		},
		setTransitionPortalModel(model) {
			transitionPortalModel = model;
			reportMetrics();
		},
		setDebugOverlayScene() {
			reportMetrics();
		},
		setRenderSceneContext() {
			reportMetrics();
		},
		setRenderChunkTransforms() {
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
		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.clearColor(...WEBGL2_CLEAR_COLOR);
		gl.clearDepth(1);
		gl.enable(gl.DEPTH_TEST);
		gl.depthMask(true);
		gl.depthFunc(gl.LEQUAL);
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.STENCIL_TEST);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		clearCount += 1;

		gl.useProgram(resources.program);
		gl.bindVertexArray(resources.vertexArray);
		gl.drawArrays(gl.TRIANGLES, 0, TRIANGLE_VERTEX_COUNT);
		gl.bindVertexArray(null);

		drawCallCount += 1;
		lastFrameDrawCount = 1;
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
		const { gl } = resources;
		gl.deleteVertexArray(resources.vertexArray);
		gl.deleteBuffer(resources.vertexBuffer);
		gl.deleteProgram(resources.program);
		resources = null;
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
					: "webgl2-test-frame",
				transitionPortalMaxDepth,
				clearCount,
				drawCallCount,
				lastFrameDrawCount,
				initializationError,
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
	const vertexShader = compileShader(
		gl,
		gl.VERTEX_SHADER,
		TRIANGLE_VERTEX_SHADER,
	);
	const fragmentShader = compileShader(
		gl,
		gl.FRAGMENT_SHADER,
		TRIANGLE_FRAGMENT_SHADER,
	);
	const program = linkProgram(gl, vertexShader, fragmentShader);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);

	const vertexArray = gl.createVertexArray();
	if (!vertexArray) {
		gl.deleteProgram(program);
		throw new Error("Failed to create WebGL2 vertex array.");
	}
	const vertexBuffer = gl.createBuffer();
	if (!vertexBuffer) {
		gl.deleteVertexArray(vertexArray);
		gl.deleteProgram(program);
		throw new Error("Failed to create WebGL2 vertex buffer.");
	}

	gl.bindVertexArray(vertexArray);
	gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, TRIANGLE_VERTICES, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
	gl.bindVertexArray(null);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);

	return {
		gl,
		program,
		vertexBuffer,
		vertexArray,
	};
}

function compileShader(
	gl: WebGL2RenderingContext,
	type: GLenum,
	source: string,
): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) {
		throw new Error("Failed to create WebGL2 shader.");
	}
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const message = gl.getShaderInfoLog(shader) ?? "unknown shader error";
		gl.deleteShader(shader);
		throw new Error(`Failed to compile WebGL2 shader: ${message}`);
	}
	return shader;
}

function linkProgram(
	gl: WebGL2RenderingContext,
	vertexShader: WebGLShader,
	fragmentShader: WebGLShader,
): WebGLProgram {
	const program = gl.createProgram();
	if (!program) {
		throw new Error("Failed to create WebGL2 program.");
	}
	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(program) ?? "unknown program error";
		gl.deleteProgram(program);
		throw new Error(`Failed to link WebGL2 program: ${message}`);
	}
	return program;
}
