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

import { createFallbackSceneCameraFrame } from "./camera";
import {
	buildSceneCameraViewProjectionMatrix,
	multiplyMat4,
} from "./luma-math";
import { createLumaRenderMetrics } from "./luma-render-metrics";
import {
	createLumaWorldResourceStore,
	destroyLumaWorldResources,
	LUMA_WORLD_BUFFER_LAYOUT,
	LUMA_WORLD_SHADER_LAYOUT,
	syncLumaWorldResources,
	type LumaWorldResourceStore,
} from "./luma-resources";
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

const WORLD_VERTEX_SHADER = `#version 300 es
in vec3 position;

uniform mat4 uModelViewProjection;

void main() {
	gl_Position = uModelViewProjection * vec4(position, 1.0);
}
`;

const WORLD_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec4 uColor;

out vec4 fragColor;

void main() {
	fragColor = uColor;
}
`;

interface LumaRenderResources {
	device: Device;
	triangleVertexShader: Shader;
	triangleFragmentShader: Shader;
	trianglePipeline: RenderPipeline;
	triangleVertexBuffer: Buffer;
	triangleVertexArray: VertexArray;
	worldVertexShader: Shader;
	worldFragmentShader: Shader;
	worldPipeline: RenderPipeline;
	worldStore: LumaWorldResourceStore;
}

export function createLumaWorldDisplayRendererImplementation(
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
		setAssetState(nextAssetState) {
			assetState = nextAssetState;
			syncWorldResources();
			scheduleFrame();
			reportMetrics();
		},
		setTerrainScene(scene) {
			terrainScene = scene;
			syncWorldResources();
			scheduleFrame();
			reportMetrics();
		},
		setStaticRenderableScene(scene) {
			staticRenderableScene = scene;
			syncWorldResources();
			scheduleFrame();
			reportMetrics();
		},
		setStructuredInteriorScene(scene) {
			structuredInteriorScene = scene;
			syncWorldResources();
			scheduleFrame();
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
		setRenderChunkTransforms(transforms) {
			renderChunkTransforms = transforms;
			syncWorldResources();
			scheduleFrame();
			reportMetrics();
		},
		setRenderSpatialQuery() {
			reportMetrics();
		},
		setControlledCameraFrame(frame) {
			controlledCameraFrame = frame;
			scheduleFrame();
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

			const triangleVertexShader = device.createShader({
				id: "luma-triangle-vertex-shader",
				language: "glsl",
				stage: "vertex",
				source: TRIANGLE_VERTEX_SHADER,
			});
			const triangleFragmentShader = device.createShader({
				id: "luma-triangle-fragment-shader",
				language: "glsl",
				stage: "fragment",
				source: TRIANGLE_FRAGMENT_SHADER,
			});
			const trianglePipeline = device.createRenderPipeline({
				id: "luma-triangle-pipeline",
				vs: triangleVertexShader,
				fs: triangleFragmentShader,
				shaderLayout: TRIANGLE_SHADER_LAYOUT,
				bufferLayout: TRIANGLE_BUFFER_LAYOUT,
				topology: "triangle-list",
				parameters: {
					cullMode: "none",
					depthWriteEnabled: false,
					depthCompare: "always",
				},
			});
			const triangleVertexBuffer = device.createBuffer({
				id: "luma-triangle-vertices",
				usage: LumaBuffer.VERTEX,
				data: TRIANGLE_VERTICES,
			});
			const triangleVertexArray = device.createVertexArray({
				id: "luma-triangle-vertex-array",
				shaderLayout: TRIANGLE_SHADER_LAYOUT,
				bufferLayout: TRIANGLE_BUFFER_LAYOUT,
			});
			triangleVertexArray.setBuffer(0, triangleVertexBuffer);

			const worldVertexShader = device.createShader({
				id: "luma-world-vertex-shader",
				language: "glsl",
				stage: "vertex",
				source: WORLD_VERTEX_SHADER,
			});
			const worldFragmentShader = device.createShader({
				id: "luma-world-fragment-shader",
				language: "glsl",
				stage: "fragment",
				source: WORLD_FRAGMENT_SHADER,
			});
			const worldPipeline = device.createRenderPipeline({
				id: "luma-world-flat-color-pipeline",
				vs: worldVertexShader,
				fs: worldFragmentShader,
				shaderLayout: LUMA_WORLD_SHADER_LAYOUT,
				bufferLayout: LUMA_WORLD_BUFFER_LAYOUT,
				topology: "triangle-list",
				parameters: {
					cullMode: "none",
					depthWriteEnabled: true,
					depthCompare: "less-equal",
				},
			});
			const worldStore = createLumaWorldResourceStore();

			resources = {
				device,
				triangleVertexShader,
				triangleFragmentShader,
				trianglePipeline,
				triangleVertexBuffer,
				triangleVertexArray,
				worldVertexShader,
				worldFragmentShader,
				worldPipeline,
				worldStore,
			};
			syncCanvasSize();
			syncWorldResources();
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
			id: "luma-world-command-encoder",
		});
		const renderPass = commandEncoder.beginRenderPass({
			clearColor: LUMA_CLEAR_COLOR,
			clearDepth: 1,
			clearStencil: false,
			parameters: {
				viewport: [0, 0, canvas.width, canvas.height],
			},
		});
		clearCount += 1;

		if (resources.worldStore.batches.length > 0) {
			const viewProjectionMatrix =
				buildSceneCameraViewProjectionMatrix(resolveCameraFrame());
			for (const batch of resources.worldStore.batches) {
				const didDraw = resources.worldPipeline.draw({
					renderPass,
					vertexArray: batch.vertexArray,
					vertexCount: batch.vertexCount,
					uniforms: {
						uModelViewProjection: multiplyMat4(
							viewProjectionMatrix,
							batch.modelMatrix,
						),
						uColor: batch.color,
					},
				});
				if (didDraw) {
					drawCallCount += 1;
				}
			}
		} else {
			const didDraw = resources.trianglePipeline.draw({
				renderPass,
				vertexArray: resources.triangleVertexArray,
				vertexCount: TRIANGLE_VERTEX_COUNT,
			});
			if (didDraw) {
				drawCallCount += 1;
			}
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
		if (resources) {
			destroyLumaWorldResources(resources.worldStore);
			resources.triangleVertexArray.destroy();
			resources.triangleVertexBuffer.destroy();
			resources.trianglePipeline.destroy();
			resources.triangleVertexShader.destroy();
			resources.triangleFragmentShader.destroy();
			resources.worldPipeline.destroy();
			resources.worldVertexShader.destroy();
			resources.worldFragmentShader.destroy();
			resources.device.destroy();
		}
		resources = null;
	}

	function syncWorldResources(): void {
		if (!resources) {
			return;
		}
		syncLumaWorldResources({
			device: resources.device,
			store: resources.worldStore,
			assetState,
			terrainScene,
			staticRenderableScene,
			structuredInteriorScene,
			transitionPortalModel,
			renderChunkTransforms,
		});
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
			cameraViewResidency: resources
				? resources.worldStore.batches.length > 0
					? "luma flat-color world"
					: "luma triangle"
				: "luma initializing",
			renderGraphPolicy: resources
				? resources.worldStore.batches.length > 0
					? "luma-flat-color-world"
					: "luma-triangle"
				: "luma-initializing",
			clearCount,
			drawCallCount,
			initializationError,
			terrainBatchCount: resources?.worldStore.terrainBatchCount ?? 0,
			structuredInteriorBatchCount:
				resources?.worldStore.structuredInteriorBatchCount ?? 0,
			staticBatchCount: resources?.worldStore.staticBatchCount ?? 0,
			staticInstanceCount: resources?.worldStore.staticInstanceCount ?? 0,
			worldTriangleCount: resources?.worldStore.triangleCount ?? 0,
			textureFilteringMode: options.textureFilteringMode ?? "anisotropic-4x",
			textureColorSpaceMode: options.textureColorSpaceMode ?? "auto",
			detailTexturesEnabled: options.detailTexturesEnabled ?? true,
		});
	}
}
