import {
	Buffer as LumaBuffer,
	luma,
	type Buffer,
	type BufferLayout,
	type Device,
	type RenderPipeline,
	type Shader,
	type ShaderLayout,
	type VertexArray,
} from "@luma.gl/core";
import { webgl2Adapter } from "@luma.gl/webgl";

import { createLumaRenderMetrics } from "./luma-render-metrics";
import type {
	WorldDisplayRenderer,
	WorldDisplayRendererOptions,
} from "./world-display-renderer-contract";

const LUMA_CANVAS_CLASS_NAME = "world-display__luma-canvas";
const LUMA_ERROR_CLASS_NAME = "world-display__luma-error";
const LUMA_CLEAR_COLOR: [number, number, number, number] = [
	0.015, 0.055, 0.085, 1,
];
const TRIANGLE_VERTEX_COUNT = 3;

const TRIANGLE_VERTICES = new Float32Array([
	0, 0.58, -0.58, -0.46, 0.58, -0.46,
]);

const TRIANGLE_SHADER_LAYOUT: ShaderLayout = {
	attributes: [{ name: "position", location: 0, type: "vec2<f32>" }],
	bindings: [],
};

const TRIANGLE_BUFFER_LAYOUT: BufferLayout[] = [
	{ name: "position", format: "float32x2" },
];

const TRIANGLE_VERTEX_SHADER = `#version 300 es
in vec2 position;

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

interface LumaRenderResources {
	device: Device;
	vertexShader: Shader;
	fragmentShader: Shader;
	pipeline: RenderPipeline;
	vertexBuffer: Buffer;
	vertexArray: VertexArray;
}

export function createLumaWorldDisplayRendererImplementation(
	host: HTMLDivElement,
	options: WorldDisplayRendererOptions,
): WorldDisplayRenderer {
	let terrainScene = options.terrainScene;
	let staticRenderableScene = options.staticRenderableScene;
	let structuredInteriorScene = options.structuredInteriorScene;
	let transitionPortalModel = options.transitionPortalModel;
	let controlledCameraFrame = options.controlledCameraFrame;
	let renderMetricsChangeHandler = options.onRenderMetricsChange;
	let resources: LumaRenderResources | null = null;
	let disposed = false;
	let frameHandle: number | null = null;
	let clearCount = 0;
	let drawCallCount = 0;
	let initializationError: string | null = null;

	const canvas = document.createElement("canvas");
	canvas.className = LUMA_CANVAS_CLASS_NAME;
	Object.assign(canvas.style, {
		display: "block",
		height: "100%",
		width: "100%",
	});
	host.append(canvas);

	const resizeObserver = new ResizeObserver(() => {
		syncCanvasSize();
		scheduleFrame();
		reportMetrics();
	});
	resizeObserver.observe(host);
	syncCanvasSize();
	void initialize();
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
		setTransitionPortalMaxDepth() {
			reportMetrics();
		},
		setRenderStyle() {
			reportMetrics();
		},
		setTextureFilteringMode() {
			reportMetrics();
		},
		setTextureColorSpaceMode() {
			reportMetrics();
		},
		setDetailTexturesEnabled() {
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
			host.querySelector(`.${LUMA_ERROR_CLASS_NAME}`)?.remove();
		},
	};

	async function initialize(): Promise<void> {
		try {
			const device = await luma.createDevice({
				id: "holtburger-luma-webgl-device",
				type: "webgl",
				adapters: [webgl2Adapter],
				waitForPageLoad: false,
				createCanvasContext: {
					canvas,
					autoResize: false,
					useDevicePixels: false,
					alphaMode: "opaque",
				},
				webgl: {
					alpha: false,
					antialias: true,
					stencil: true,
				},
			});
			if (disposed) {
				device.destroy();
				return;
			}

			const vertexShader = device.createShader({
				id: "luma-triangle-vertex-shader",
				language: "glsl",
				stage: "vertex",
				source: TRIANGLE_VERTEX_SHADER,
			});
			const fragmentShader = device.createShader({
				id: "luma-triangle-fragment-shader",
				language: "glsl",
				stage: "fragment",
				source: TRIANGLE_FRAGMENT_SHADER,
			});
			const pipeline = device.createRenderPipeline({
				id: "luma-triangle-pipeline",
				vs: vertexShader,
				fs: fragmentShader,
				shaderLayout: TRIANGLE_SHADER_LAYOUT,
				bufferLayout: TRIANGLE_BUFFER_LAYOUT,
				topology: "triangle-list",
				parameters: {
					cullMode: "none",
					depthWriteEnabled: false,
					depthCompare: "always",
				},
			});
			const vertexBuffer = device.createBuffer({
				id: "luma-triangle-vertices",
				usage: LumaBuffer.VERTEX,
				data: TRIANGLE_VERTICES,
			});
			const vertexArray = device.createVertexArray({
				id: "luma-triangle-vertex-array",
				shaderLayout: TRIANGLE_SHADER_LAYOUT,
				bufferLayout: TRIANGLE_BUFFER_LAYOUT,
			});
			vertexArray.setBuffer(0, vertexBuffer);

			resources = {
				device,
				vertexShader,
				fragmentShader,
				pipeline,
				vertexBuffer,
				vertexArray,
			};
			syncCanvasSize();
			scheduleFrame();
		} catch (error) {
			initializationError =
				error instanceof Error ? error.message : String(error);
			console.error("[holtburger-3d][luma]", error);
			showInitializationError(initializationError);
			reportMetrics();
		}
	}

	function scheduleFrame(): void {
		if (disposed || frameHandle !== null) {
			return;
		}
		frameHandle = requestAnimationFrame(() => {
			frameHandle = null;
			renderFrame();
		});
	}

	function renderFrame(): void {
		if (!resources) {
			return;
		}

		syncCanvasSize();
		const commandEncoder = resources.device.createCommandEncoder({
			id: "luma-triangle-command-encoder",
		});
		const renderPass = commandEncoder.beginRenderPass({
			clearColor: LUMA_CLEAR_COLOR,
			clearDepth: false,
			clearStencil: false,
			parameters: {
				viewport: [0, 0, canvas.width, canvas.height],
			},
		});
		clearCount += 1;
		const didDraw = resources.pipeline.draw({
			renderPass,
			vertexArray: resources.vertexArray,
			vertexCount: TRIANGLE_VERTEX_COUNT,
		});
		if (didDraw) {
			drawCallCount += 1;
		}
		renderPass.end();
		resources.device.submit(commandEncoder.finish());
		reportMetrics();
	}

	function syncCanvasSize(): void {
		const pixelRatio = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(host.clientWidth * pixelRatio));
		const height = Math.max(1, Math.round(host.clientHeight * pixelRatio));
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
			resources?.device.canvasContext?.setDrawingBufferSize(width, height);
		}
	}

	function destroyResources(): void {
		resources?.vertexArray.destroy();
		resources?.vertexBuffer.destroy();
		resources?.pipeline.destroy();
		resources?.vertexShader.destroy();
		resources?.fragmentShader.destroy();
		resources?.device.destroy();
		resources = null;
	}

	function showInitializationError(message: string): void {
		const errorElement = document.createElement("div");
		errorElement.className = LUMA_ERROR_CLASS_NAME;
		errorElement.textContent = `Luma renderer failed to initialize: ${message}`;
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

	function reportMetrics(): void {
		renderMetricsChangeHandler?.(createLumaMetrics());
	}

	function createLumaMetrics() {
		return createLumaRenderMetrics({
			terrainScene,
			staticRenderableScene,
			structuredInteriorScene,
			transitionPortalModel,
			cameraFrame: controlledCameraFrame,
			canvasWidth: canvas.width,
			canvasHeight: canvas.height,
			pixelRatio: window.devicePixelRatio || 1,
			cameraViewResidency: resources ? "luma triangle" : "luma initializing",
			renderGraphPolicy: resources ? "luma-triangle" : "luma-initializing",
			clearCount,
			drawCallCount,
			initializationError,
			textureFilteringMode: options.textureFilteringMode ?? "anisotropic-4x",
			textureColorSpaceMode: options.textureColorSpaceMode ?? "auto",
			detailTexturesEnabled: options.detailTexturesEnabled ?? true,
		});
	}
}
