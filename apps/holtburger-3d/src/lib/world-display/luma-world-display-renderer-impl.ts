import {
	Buffer as LumaBuffer,
	luma,
	type Buffer,
	type BufferLayout,
	type Device,
	type RenderPipelineParameters,
	type RenderPipeline,
	type Shader,
	type ShaderLayout,
	type VertexArray,
} from "@luma.gl/core";
import { webgl2Adapter } from "@luma.gl/webgl";

import { createFallbackSceneCameraFrame } from "./camera";
import { multiplyMat4 } from "./luma-math";
import { detectLumaMaterialTextureCapabilities } from "./luma-device-capabilities";
import {
	buildStagedWorldFrame,
	type StagedWorldFrameMetrics,
} from "./staged-world-frame";
import { createLumaRenderMetrics } from "./luma-render-metrics";
import {
	createLumaWorldResourceStore,
	destroyLumaWorldResources,
	LUMA_WORLD_BUFFER_LAYOUT,
	LUMA_WORLD_SHADER_LAYOUT,
	LUMA_TEXTURED_WORLD_BUFFER_LAYOUT,
	LUMA_TEXTURED_WORLD_SHADER_LAYOUT,
	syncLumaWorldResources,
	type LumaWorldDrawBatch,
	type LumaWorldResourceStore,
} from "./luma-resources";
import type { MaterialTextureCapabilities } from "./render-surface-texture-data";
import type { WorldRenderMetrics } from "./renderer-contract";
import type {
	WorldDisplayRenderer,
	WorldDisplayRendererOptions,
} from "./world-display-renderer-contract";

const LUMA_CANVAS_CLASS_NAME = "world-display__luma-canvas";
const LUMA_ERROR_CLASS_NAME = "world-display__luma-error";
const LUMA_CLEAR_COLOR: [number, number, number, number] = [
	0.015, 0.055, 0.085, 1,
];
const PERFORMANCE_REPORT_INTERVAL_MS = 500;
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

const TEXTURED_WORLD_VERTEX_SHADER = `#version 300 es
in vec3 position;
in vec2 texCoord;

uniform mat4 uModelViewProjection;

out vec2 vTexCoord;

void main() {
	vTexCoord = texCoord;
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

const TEXTURED_WORLD_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec4 uColor;
uniform float uAlphaTest;
uniform sampler2D uTexture;

in vec2 vTexCoord;

out vec4 fragColor;

void main() {
	vec4 sampled = texture(uTexture, vTexCoord);
	vec4 color = sampled * uColor;
	if (color.a < uAlphaTest) {
		discard;
	}
	fragColor = color;
}
`;

interface LumaRenderResources {
	device: Device;
	materialTextureCapabilities: MaterialTextureCapabilities;
	triangleVertexShader: Shader;
	triangleFragmentShader: Shader;
	trianglePipeline: RenderPipeline;
	triangleVertexBuffer: Buffer;
	triangleVertexArray: VertexArray;
	worldVertexShader: Shader;
	worldFragmentShader: Shader;
	worldPipeline: RenderPipeline;
	texturedWorldVertexShader: Shader;
	texturedWorldFragmentShader: Shader;
	texturedWorldPipeline: RenderPipeline;
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
	let lastFrameDrawCount = 0;
	let lastFrameAt: number | null = null;
	let latestPerformanceMetrics: WorldRenderMetrics["performance"] = null;
	let performanceWindowStartedAt = 0;
	let performanceWindowFrameCount = 0;
	let performanceWindowFrameMs = 0;
	let performanceWindowRenderMs = 0;
	let latestFrameMetrics: StagedWorldFrameMetrics | null = null;
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
			const materialTextureCapabilities =
				detectLumaMaterialTextureCapabilities(device);

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
			const texturedWorldVertexShader = device.createShader({
				id: "luma-textured-world-vertex-shader",
				language: "glsl",
				stage: "vertex",
				source: TEXTURED_WORLD_VERTEX_SHADER,
			});
			const texturedWorldFragmentShader = device.createShader({
				id: "luma-textured-world-fragment-shader",
				language: "glsl",
				stage: "fragment",
				source: TEXTURED_WORLD_FRAGMENT_SHADER,
			});
			const texturedWorldPipeline = device.createRenderPipeline({
				id: "luma-world-direct-texture-pipeline",
				vs: texturedWorldVertexShader,
				fs: texturedWorldFragmentShader,
				shaderLayout: LUMA_TEXTURED_WORLD_SHADER_LAYOUT,
				bufferLayout: LUMA_TEXTURED_WORLD_BUFFER_LAYOUT,
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
				materialTextureCapabilities,
				triangleVertexShader,
				triangleFragmentShader,
				trianglePipeline,
				triangleVertexBuffer,
				triangleVertexArray,
				worldVertexShader,
				worldFragmentShader,
				worldPipeline,
				texturedWorldVertexShader,
				texturedWorldFragmentShader,
				texturedWorldPipeline,
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
		let frameDrawCount = 0;
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
			const frame = buildStagedWorldFrame({
				assetState,
				candidates: resources.worldStore.batches,
				cameraFrame: resolveCameraFrame(),
				renderChunkTransforms,
				staticRenderableScene,
				structuredInteriorScene,
				terrainScene,
			});
			latestFrameMetrics = frame.metrics;
			for (const draw of frame.passes.flatMap((pass) => pass.draws)) {
				const batch = resources.worldStore.batchesById.get(draw.drawUnitId);
				if (!batch) {
					throw new Error(
						`Staged world frame referenced missing draw unit ${draw.drawUnitId}.`,
					);
				}
				const pipeline =
					batch.material.kind === "direct-texture"
						? resources.texturedWorldPipeline
						: resources.worldPipeline;
				const didDraw = pipeline.draw({
					renderPass,
					vertexArray: batch.vertexArray,
					vertexCount: batch.vertexCount,
					bindings: batch.bindings,
					parameters: createLumaMaterialParameters(batch),
					uniforms: {
						uModelViewProjection: multiplyMat4(
							frame.viewProjectionMatrix,
							batch.modelMatrix,
						),
						uColor: batch.color,
						uAlphaTest:
							batch.material.kind === "direct-texture"
								? batch.material.behavior.alphaTest
								: 0,
					},
				});
				if (didDraw) {
					drawCallCount += 1;
					frameDrawCount += 1;
				}
			}
		} else {
			latestFrameMetrics = null;
			const didDraw = resources.trianglePipeline.draw({
				renderPass,
				vertexArray: resources.triangleVertexArray,
				vertexCount: TRIANGLE_VERTEX_COUNT,
			});
			if (didDraw) {
				drawCallCount += 1;
				frameDrawCount += 1;
			}
		}

		renderPass.end();
		resources.device.submit(commandEncoder.finish());
		lastFrameDrawCount = frameDrawCount;
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
			resources?.device.canvasContext?.setDrawingBufferSize(width, height);
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
			resources.texturedWorldPipeline.destroy();
			resources.texturedWorldVertexShader.destroy();
			resources.texturedWorldFragmentShader.destroy();
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
			materialTextureCapabilities: resources.materialTextureCapabilities,
			store: resources.worldStore,
			assetState,
			terrainScene,
			staticRenderableScene,
			structuredInteriorScene,
			transitionPortalModel,
			renderChunkTransforms,
			rendererResourceGraph: options.rendererResourceGraph,
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
			lastFrameDrawCount,
			initializationError,
			terrainBatchCount: resources?.worldStore.terrainBatchCount ?? 0,
			structuredInteriorBatchCount:
				resources?.worldStore.structuredInteriorBatchCount ?? 0,
			staticBatchCount: resources?.worldStore.staticBatchCount ?? 0,
			staticInstanceCount: resources?.worldStore.staticInstanceCount ?? 0,
			materialCount: resources?.worldStore.materialCount ?? 0,
			directTextureBatchCount:
				resources?.worldStore.directTextureBatchCount ?? 0,
			textureResourceCount:
				resources?.worldStore.textureStore.texturesByKey.size ?? 0,
			materialFallbackReasonCount:
				resources?.worldStore.materialFallbackReasonCount ?? 0,
			materialFallbackReasonSamples:
				resources?.worldStore.materialFallbackReasonSamples ?? [],
			lumaFrameMetrics: latestFrameMetrics,
			worldTriangleCount: resources?.worldStore.triangleCount ?? 0,
			performance: latestPerformanceMetrics,
			textureFilteringMode: options.textureFilteringMode ?? "anisotropic-4x",
			textureColorSpaceMode: options.textureColorSpaceMode ?? "auto",
			detailTexturesEnabled: options.detailTexturesEnabled ?? true,
		});
	}
}

function createLumaMaterialParameters(
	batch: LumaWorldDrawBatch,
): RenderPipelineParameters {
	if (batch.material.kind !== "direct-texture") {
		return {
			cullMode: "none" as const,
			depthWriteEnabled: true,
			depthCompare: "less-equal" as const,
		};
	}
	const material = batch.material;
	return {
		cullMode: "none" as const,
		depthWriteEnabled: material.behavior.blend.depthWrite,
		depthCompare: "less-equal" as const,
		blend: material.behavior.blend.enabled,
		blendColorOperation: "add" as const,
		blendAlphaOperation: "add" as const,
		blendColorSrcFactor: material.behavior.blend.srcFactor ?? "one",
		blendColorDstFactor: material.behavior.blend.dstFactor ?? "zero",
		blendAlphaSrcFactor: material.behavior.blend.srcFactor ?? "one",
		blendAlphaDstFactor: material.behavior.blend.dstFactor ?? "zero",
	};
}
