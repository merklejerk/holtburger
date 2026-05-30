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
	partitionWebgl2SceneDomainDrawUnits,
	planWebgl2FlatWorldSubmitOrder,
	planWebgl2PortalMaskSubmitOrder,
	submitWebgl2FlatWorldDrawUnits,
	submitWebgl2FlatWorldFrame,
	type Webgl2FlatWorldProgram,
	type Webgl2IndexedP16WorldProgram,
	type Webgl2IndexedP8WorldProgram,
	type Webgl2TerrainBlendWorldProgram,
	type Webgl2TexturedWorldProgram,
	type Webgl2WorldSubmitMetrics,
} from "./webgl2-world-submit";
import {
	createWebgl2SceneDomainTargetSet,
	type Webgl2SceneDomainTarget,
	type Webgl2SceneDomainTargetSet,
} from "./webgl2-scene-domain-targets";
import {
	createWebgl2WorldResourceStore,
	destroyWebgl2WorldResources,
	syncWebgl2WorldResources,
	type Webgl2WorldResourceStore,
} from "./webgl2-world-resources";
import type { WorldRenderMetrics } from "./renderer-contract";
import type { MaterialTextureCapabilities } from "./render-surface-texture-data";
import type { Webgl2WorldDrawUnit } from "./webgl2-world-resources";
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
uniform sampler2D uDetailTexture;
uniform float uDetailTiling;
uniform int uDetailEnabled;

in vec2 vUv;

out vec4 fragColor;

vec3 applyDetailOverlay(vec3 baseColor) {
	if (uDetailEnabled == 0) {
		return baseColor;
	}
	vec4 detailColor = texture(uDetailTexture, vUv * uDetailTiling);
	float sourceAlpha = clamp(detailColor.a, 0.0, 1.0);
	return clamp(baseColor * (detailColor.rgb + (1.0 - sourceAlpha)), 0.0, 1.0);
}

void main() {
	vec4 texel = texture(uTexture, vUv);
	vec4 color = texel * uColor;
	if (color.a < uAlphaTest) {
		discard;
	}
	color.rgb = applyDetailOverlay(color.rgb);
	fragColor = color;
}
`;

const INDEXED_P8_WORLD_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec4 uColor;
uniform float uAlphaTest;
uniform sampler2D uIndexTexture;
uniform sampler2D uPaletteTexture;
uniform vec2 uTextureSize;
uniform float uPaletteColorCount;
uniform int uClipThreshold;
uniform int uRepeatS;
uniform int uRepeatT;
uniform sampler2D uDetailTexture;
uniform float uDetailTiling;
uniform int uDetailEnabled;

in vec2 vUv;

out vec4 fragColor;

vec2 resolveIndexedUv(vec2 uv) {
	vec2 wrapped = vec2(
		uRepeatS == 1 ? fract(uv.x) : clamp(uv.x, 0.0, 0.999999),
		uRepeatT == 1 ? fract(uv.y) : clamp(uv.y, 0.0, 0.999999)
	);
	return wrapped * uTextureSize;
}

ivec2 resolveIndexedSampleCoord(ivec2 baseCoord, ivec2 offset) {
	ivec2 size = ivec2(uTextureSize);
	ivec2 coord = baseCoord + offset;
	coord.x = uRepeatS == 1 ? coord.x % size.x : clamp(coord.x, 0, size.x - 1);
	coord.y = uRepeatT == 1 ? coord.y % size.y : clamp(coord.y, 0, size.y - 1);
	return coord;
}

vec4 paletteColor(float index) {
	if (uClipThreshold >= 0 && index < float(uClipThreshold)) {
		return vec4(0.0);
	}
	float paletteU = (index + 0.5) / uPaletteColorCount;
	return texture(uPaletteTexture, vec2(paletteU, 0.5));
}

float paletteIndexAt(ivec2 coord) {
	vec4 packed = texelFetch(uIndexTexture, coord, 0) * 255.0;
	return floor(packed.r + 0.5);
}

vec3 applyDetailOverlay(vec3 baseColor) {
	if (uDetailEnabled == 0) {
		return baseColor;
	}
	vec4 detailColor = texture(uDetailTexture, vUv * uDetailTiling);
	float sourceAlpha = clamp(detailColor.a, 0.0, 1.0);
	return clamp(baseColor * (detailColor.rgb + (1.0 - sourceAlpha)), 0.0, 1.0);
}

void main() {
	vec2 texelPosition = resolveIndexedUv(vUv);
	ivec2 baseCoord = ivec2(floor(texelPosition));
	vec2 blend = fract(texelPosition);
	vec4 top = mix(
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(0, 0)))),
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(1, 0)))),
		blend.x
	);
	vec4 bottom = mix(
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(0, 1)))),
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(1, 1)))),
		blend.x
	);
	vec4 color = mix(top, bottom, blend.y) * uColor;
	if (color.a <= 0.0 || color.a < uAlphaTest) {
		discard;
	}
	color.rgb = applyDetailOverlay(color.rgb);
	fragColor = color;
}
`;

const INDEXED_P16_WORLD_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec4 uColor;
uniform float uAlphaTest;
uniform sampler2D uIndexTexture;
uniform sampler2D uPaletteTexture;
uniform vec2 uTextureSize;
uniform float uPaletteColorCount;
uniform int uClipThreshold;
uniform int uRepeatS;
uniform int uRepeatT;
uniform sampler2D uDetailTexture;
uniform float uDetailTiling;
uniform int uDetailEnabled;

in vec2 vUv;

out vec4 fragColor;

vec2 resolveIndexedUv(vec2 uv) {
	vec2 wrapped = vec2(
		uRepeatS == 1 ? fract(uv.x) : clamp(uv.x, 0.0, 0.999999),
		uRepeatT == 1 ? fract(uv.y) : clamp(uv.y, 0.0, 0.999999)
	);
	return wrapped * uTextureSize;
}

ivec2 resolveIndexedSampleCoord(ivec2 baseCoord, ivec2 offset) {
	ivec2 size = ivec2(uTextureSize);
	ivec2 coord = baseCoord + offset;
	coord.x = uRepeatS == 1 ? coord.x % size.x : clamp(coord.x, 0, size.x - 1);
	coord.y = uRepeatT == 1 ? coord.y % size.y : clamp(coord.y, 0, size.y - 1);
	return coord;
}

vec4 paletteColor(float index) {
	if (uClipThreshold >= 0 && index < float(uClipThreshold)) {
		return vec4(0.0);
	}
	float paletteU = (index + 0.5) / uPaletteColorCount;
	return texture(uPaletteTexture, vec2(paletteU, 0.5));
}

float paletteIndexAt(ivec2 coord) {
	vec4 packed = texelFetch(uIndexTexture, coord, 0) * 255.0;
	return floor(packed.r + 0.5) + floor(packed.g + 0.5) * 256.0;
}

vec3 applyDetailOverlay(vec3 baseColor) {
	if (uDetailEnabled == 0) {
		return baseColor;
	}
	vec4 detailColor = texture(uDetailTexture, vUv * uDetailTiling);
	float sourceAlpha = clamp(detailColor.a, 0.0, 1.0);
	return clamp(baseColor * (detailColor.rgb + (1.0 - sourceAlpha)), 0.0, 1.0);
}

void main() {
	vec2 texelPosition = resolveIndexedUv(vUv);
	ivec2 baseCoord = ivec2(floor(texelPosition));
	vec2 blend = fract(texelPosition);
	vec4 top = mix(
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(0, 0)))),
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(1, 0)))),
		blend.x
	);
	vec4 bottom = mix(
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(0, 1)))),
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(1, 1)))),
		blend.x
	);
	vec4 color = mix(top, bottom, blend.y) * uColor;
	if (color.a <= 0.0 || color.a < uAlphaTest) {
		discard;
	}
	color.rgb = applyDetailOverlay(color.rgb);
	fragColor = color;
}
`;

const TERRAIN_BLEND_WORLD_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec2 uv;

uniform mat4 uModelViewProjection;

out vec2 vUv;

void main() {
	vUv = uv;
	gl_Position = uModelViewProjection * vec4(position, 1.0);
}
`;

const TERRAIN_BLEND_WORLD_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uBaseTexture;
uniform float uBaseTiling;
uniform sampler2D uOverlay0;
uniform sampler2D uOverlay1;
uniform sampler2D uOverlay2;
uniform sampler2D uOverlayAlpha0;
uniform sampler2D uOverlayAlpha1;
uniform sampler2D uOverlayAlpha2;
uniform float uOverlayTiling0;
uniform float uOverlayTiling1;
uniform float uOverlayTiling2;
uniform int uOverlayRotation0;
uniform int uOverlayRotation1;
uniform int uOverlayRotation2;
uniform int uOverlayCount;
uniform sampler2D uRoadTexture;
uniform float uRoadTiling;
uniform sampler2D uRoadAlpha0;
uniform sampler2D uRoadAlpha1;
uniform int uRoadRotation0;
uniform int uRoadRotation1;
uniform int uRoadCount;

in vec2 vUv;

out vec4 fragColor;

vec2 legacyAlphaUv(vec2 uv) {
	return vec2(uv.x, 1.0 - uv.y);
}

vec2 rotateLegacyAlphaUv(vec2 uv, int rotation) {
	if (rotation == 1) {
		return vec2(1.0 - uv.y, uv.x);
	}
	if (rotation == 2) {
		return vec2(1.0 - uv.x, 1.0 - uv.y);
	}
	if (rotation == 3) {
		return vec2(uv.y, 1.0 - uv.x);
	}
	return uv;
}

vec4 blendOverlay(vec4 baseColor, sampler2D overlayTexture, sampler2D alphaTexture, float tiling, int rotation) {
	vec4 overlayColor = texture(overlayTexture, vUv * tiling);
	float alpha = texture(alphaTexture, rotateLegacyAlphaUv(legacyAlphaUv(vUv), rotation)).r;
	return mix(baseColor, overlayColor, clamp(1.0 - alpha, 0.0, 1.0));
}

void main() {
	vec4 color = texture(uBaseTexture, vUv * uBaseTiling);
	if (uOverlayCount > 0) {
		color = blendOverlay(color, uOverlay0, uOverlayAlpha0, uOverlayTiling0, uOverlayRotation0);
	}
	if (uOverlayCount > 1) {
		color = blendOverlay(color, uOverlay1, uOverlayAlpha1, uOverlayTiling1, uOverlayRotation1);
	}
	if (uOverlayCount > 2) {
		color = blendOverlay(color, uOverlay2, uOverlayAlpha2, uOverlayTiling2, uOverlayRotation2);
	}
	if (uRoadCount > 0) {
		vec4 roadColor = texture(uRoadTexture, vUv * uRoadTiling);
		float roadAlpha = 1.0 - texture(uRoadAlpha0, rotateLegacyAlphaUv(legacyAlphaUv(vUv), uRoadRotation0)).r;
		if (uRoadCount > 1) {
			roadAlpha = 1.0 - (
				texture(uRoadAlpha0, rotateLegacyAlphaUv(legacyAlphaUv(vUv), uRoadRotation0)).r *
				texture(uRoadAlpha1, rotateLegacyAlphaUv(legacyAlphaUv(vUv), uRoadRotation1)).r
			);
		}
		color = mix(color, roadColor, clamp(roadAlpha, 0.0, 1.0));
	}
	fragColor = vec4(color.rgb, 1.0);
}
`;

const SCENE_DOMAIN_COPY_VERTEX_SHADER = `#version 300 es
precision highp float;

out vec2 vUv;

const vec2 POSITIONS[3] = vec2[3](
	vec2(-1.0, -1.0),
	vec2(3.0, -1.0),
	vec2(-1.0, 3.0)
);

void main() {
	vec2 position = POSITIONS[gl_VertexID];
	vUv = position * 0.5 + 0.5;
	gl_Position = vec4(position, 0.0, 1.0);
}
`;

const SCENE_DOMAIN_COPY_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uColorTexture;
uniform sampler2D uDepthTexture;

in vec2 vUv;

out vec4 fragColor;

void main() {
	fragColor = texture(uColorTexture, vUv);
	gl_FragDepth = texture(uDepthTexture, vUv).r;
}
`;

interface Webgl2RenderResources {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	triangleProgram: Webgl2ProgramResource<"position", never>;
	flatWorldProgram: Webgl2FlatWorldProgram;
	texturedWorldProgram: Webgl2TexturedWorldProgram;
	indexedP8WorldProgram: Webgl2IndexedP8WorldProgram;
	indexedP16WorldProgram: Webgl2IndexedP16WorldProgram;
	terrainBlendWorldProgram: Webgl2TerrainBlendWorldProgram;
	sceneDomainCopyProgram: Webgl2ProgramResource<
		never,
		"uColorTexture" | "uDepthTexture"
	>;
	vertexBuffer: Webgl2BufferResource;
	vertexArray: Webgl2VertexArrayResource;
	sceneDomainCopyVertexArray: Webgl2VertexArrayResource;
	sceneDomainTargets: Webgl2SceneDomainTargetSet | null;
	sceneDomainFramebufferFailureCount: number;
	sceneDomainFramebufferFailureSamples: string[];
	worldStore: Webgl2WorldResourceStore;
	materialTextureCapabilities: MaterialTextureCapabilities;
}

interface Webgl2SceneDomainFrameMetrics {
	width: number;
	height: number;
	exteriorDrawCallCount: number;
	interiorDrawCallCount: number;
	baseCopyPassCount: number;
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
	let latestSceneDomainFrameMetrics: Webgl2SceneDomainFrameMetrics | null = null;

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
			if (textureFilteringMode === mode) {
				return;
			}
			textureFilteringMode = mode;
			syncWorldResources();
			reportMetrics();
		},
		setTextureColorSpaceMode(mode) {
			textureColorSpaceMode = mode;
			reportMetrics();
		},
		setDetailTexturesEnabled(enabled) {
			detailTexturesEnabled = enabled;
			syncWorldResources();
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
				stencil: true,
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
			const portalMaskDrawUnits = planWebgl2PortalMaskSubmitOrder(
				frame,
				resources.worldStore.drawUnitsById,
			);
			if (shouldUseSceneDomainTargets(portalMaskDrawUnits.length)) {
				latestSubmitMetrics = submitWebgl2SceneDomainFrame({
					frame,
					portalMaskDrawUnitCount: portalMaskDrawUnits.length,
				});
			} else {
				latestSceneDomainFrameMetrics = null;
				latestSubmitMetrics = submitWebgl2FlatWorldFrame({
					gl,
					stateCache: resources.stateCache,
					program: resources.flatWorldProgram,
					texturedProgram: resources.texturedWorldProgram,
					terrainBlendProgram: resources.terrainBlendWorldProgram,
					indexedP8Program: resources.indexedP8WorldProgram,
					indexedP16Program: resources.indexedP16WorldProgram,
					drawUnitsById: resources.worldStore.drawUnitsById,
					frame,
				});
			}
			drawCallCount += latestSubmitMetrics.drawCallCount;
			lastFrameDrawCount = latestSubmitMetrics.drawCallCount;
		} else {
			latestFrameMetrics = null;
			latestSceneDomainFrameMetrics = null;
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
			if (resources?.sceneDomainTargets) {
				resources.sceneDomainTargets.dispose();
				resources.sceneDomainTargets = null;
			}
		}
	}

	function shouldUseSceneDomainTargets(portalMaskDrawUnitCount: number): boolean {
		return transitionPortalMaxDepth > 0 && portalMaskDrawUnitCount > 0;
	}

	function submitWebgl2SceneDomainFrame({
		frame,
		portalMaskDrawUnitCount,
	}: {
		frame: ReturnType<typeof buildStagedWorldFrame>;
		portalMaskDrawUnitCount: number;
	}): Webgl2WorldSubmitMetrics {
		if (!resources) {
			return createEmptyWebgl2WorldSubmitMetrics();
		}
		const targets = syncSceneDomainTargets(resources);
		const { gl, stateCache } = resources;
		const visibleDrawUnits = planWebgl2FlatWorldSubmitOrder(
			frame,
			resources.worldStore.drawUnitsById,
		);
		const sceneDomainDrawUnits =
			partitionWebgl2SceneDomainDrawUnits(visibleDrawUnits);
		const exteriorMetrics = renderSceneDomainTarget({
			target: targets.exterior,
			drawUnits: sceneDomainDrawUnits.exterior,
			frame,
		});
		const interiorMetrics = renderSceneDomainTarget({
			target: targets.interior,
			drawUnits: sceneDomainDrawUnits.interior,
			frame,
		});

		stateCache.bindFramebuffer(null);
		stateCache.setViewport({
			x: 0,
			y: 0,
			width: canvas.width,
			height: canvas.height,
		});
		gl.clear(gl.STENCIL_BUFFER_BIT);
		copySceneDomainTargetToDefaultFramebuffer(targets.exterior);

		latestSceneDomainFrameMetrics = {
			width: targets.width,
			height: targets.height,
			exteriorDrawCallCount: exteriorMetrics.drawCallCount,
			interiorDrawCallCount: interiorMetrics.drawCallCount,
			baseCopyPassCount: 1,
		};
		return mergeSceneDomainSubmitMetrics({
			exteriorMetrics,
			interiorMetrics,
			portalMaskDrawUnitCount,
			exteriorDomainDrawUnitCount: sceneDomainDrawUnits.exterior.length,
			interiorDomainDrawUnitCount: sceneDomainDrawUnits.interior.length,
		});
	}

	function syncSceneDomainTargets(
		currentResources: Webgl2RenderResources,
	): Webgl2SceneDomainTargetSet {
		const existing = currentResources.sceneDomainTargets;
		if (
			existing &&
			existing.width === canvas.width &&
			existing.height === canvas.height
		) {
			return existing;
		}
		existing?.dispose();
		try {
			const targets = createWebgl2SceneDomainTargetSet(currentResources.gl, {
				width: canvas.width,
				height: canvas.height,
			});
			currentResources.sceneDomainTargets = targets;
			currentResources.stateCache.invalidate();
			return targets;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			currentResources.sceneDomainFramebufferFailureCount += 1;
			currentResources.sceneDomainFramebufferFailureSamples = [
				message,
				...currentResources.sceneDomainFramebufferFailureSamples,
			].slice(0, 4);
			throw error;
		}
	}

	function renderSceneDomainTarget({
		target,
		drawUnits,
		frame,
	}: {
		target: Webgl2SceneDomainTarget;
		drawUnits: readonly Webgl2WorldDrawUnit[];
		frame: ReturnType<typeof buildStagedWorldFrame>;
	}): Webgl2WorldSubmitMetrics {
		if (!resources) {
			return createEmptyWebgl2WorldSubmitMetrics();
		}
		const { gl, stateCache } = resources;
		stateCache.bindFramebuffer(target.framebuffer);
		stateCache.setViewport({
			x: 0,
			y: 0,
			width: target.width,
			height: target.height,
		});
		gl.clearColor(...WEBGL2_CLEAR_COLOR);
		gl.clearDepth(1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		return submitWebgl2FlatWorldDrawUnits({
			gl,
			stateCache,
			program: resources.flatWorldProgram,
			texturedProgram: resources.texturedWorldProgram,
			terrainBlendProgram: resources.terrainBlendWorldProgram,
			indexedP8Program: resources.indexedP8WorldProgram,
			indexedP16Program: resources.indexedP16WorldProgram,
			viewProjectionMatrix: frame.viewProjectionMatrix,
			drawUnits,
		});
	}

	function copySceneDomainTargetToDefaultFramebuffer(
		target: Webgl2SceneDomainTarget,
	): void {
		if (!resources) {
			return;
		}
		const { gl, stateCache } = resources;
		stateCache.setDepthState({
			enabled: true,
			write: true,
			func: gl.ALWAYS,
		});
		stateCache.setBlendState({
			enabled: false,
			srcRgb: gl.ONE,
			dstRgb: gl.ZERO,
			srcAlpha: gl.ONE,
			dstAlpha: gl.ZERO,
			equationRgb: gl.FUNC_ADD,
			equationAlpha: gl.FUNC_ADD,
		});
		stateCache.setCullState({
			enabled: false,
			mode: gl.BACK,
		});
		stateCache.setStencilState({
			enabled: false,
			writeMask: 0xff,
			func: gl.ALWAYS,
			ref: 0,
			readMask: 0xff,
			fail: gl.KEEP,
			zfail: gl.KEEP,
			zpass: gl.KEEP,
		});
		stateCache.useProgram(resources.sceneDomainCopyProgram.program);
		stateCache.bindVertexArray(
			resources.sceneDomainCopyVertexArray.vertexArray,
		);
		gl.uniform1i(resources.sceneDomainCopyProgram.uniforms.uColorTexture, 0);
		gl.uniform1i(resources.sceneDomainCopyProgram.uniforms.uDepthTexture, 1);
		stateCache.bindTexture2D(0, target.colorTexture);
		stateCache.bindTexture2D(1, target.depthTexture);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
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
		resources.indexedP8WorldProgram.dispose();
		resources.indexedP16WorldProgram.dispose();
		resources.terrainBlendWorldProgram.dispose();
		resources.sceneDomainCopyProgram.dispose();
		resources.sceneDomainCopyVertexArray.dispose();
		resources.sceneDomainTargets?.dispose();
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
			materialTextureCapabilities: resources.materialTextureCapabilities,
			textureFilteringMode,
			detailTexturesEnabled,
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
				sceneDomainTargetWidth:
					latestSceneDomainFrameMetrics?.width ??
					resources?.sceneDomainTargets?.width ??
					0,
				sceneDomainTargetHeight:
					latestSceneDomainFrameMetrics?.height ??
					resources?.sceneDomainTargets?.height ??
					0,
				sceneDomainFramebufferFailureCount:
					resources?.sceneDomainFramebufferFailureCount ?? 0,
				sceneDomainFramebufferFailureSamples:
					resources?.sceneDomainFramebufferFailureSamples ?? [],
				sceneDomainBaseCopyPassCount:
					latestSceneDomainFrameMetrics?.baseCopyPassCount ?? 0,
				sceneDomainExteriorDrawCallCount:
					latestSceneDomainFrameMetrics?.exteriorDrawCallCount ?? 0,
				sceneDomainInteriorDrawCallCount:
					latestSceneDomainFrameMetrics?.interiorDrawCallCount ?? 0,
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

function mergeSceneDomainSubmitMetrics({
	exteriorMetrics,
	interiorMetrics,
	portalMaskDrawUnitCount,
	exteriorDomainDrawUnitCount,
	interiorDomainDrawUnitCount,
}: {
	exteriorMetrics: Webgl2WorldSubmitMetrics;
	interiorMetrics: Webgl2WorldSubmitMetrics;
	portalMaskDrawUnitCount: number;
	exteriorDomainDrawUnitCount: number;
	interiorDomainDrawUnitCount: number;
}): Webgl2WorldSubmitMetrics {
	return {
		visibleDrawUnitCount:
			exteriorMetrics.visibleDrawUnitCount +
			interiorMetrics.visibleDrawUnitCount,
		portalMaskDrawUnitCount,
		exteriorDomainDrawUnitCount,
		interiorDomainDrawUnitCount,
		drawCallCount:
			exteriorMetrics.drawCallCount + interiorMetrics.drawCallCount + 1,
		programSwitchCount:
			exteriorMetrics.programSwitchCount + interiorMetrics.programSwitchCount + 1,
		vertexArrayBindCount:
			exteriorMetrics.vertexArrayBindCount +
			interiorMetrics.vertexArrayBindCount +
			1,
		uniformUploadCount:
			exteriorMetrics.uniformUploadCount +
			interiorMetrics.uniformUploadCount +
			2,
		stateChangeCount:
			exteriorMetrics.stateChangeCount + interiorMetrics.stateChangeCount,
		triangleCount: exteriorMetrics.triangleCount + interiorMetrics.triangleCount,
		visibleDrawUnitCountsByMaterialKind: mergeMaterialKindCounts(
			exteriorMetrics.visibleDrawUnitCountsByMaterialKind,
			interiorMetrics.visibleDrawUnitCountsByMaterialKind,
		),
	};
}

function mergeMaterialKindCounts(
	left: Readonly<Record<string, number>>,
	right: Readonly<Record<string, number>>,
): Record<string, number> {
	const counts: Record<string, number> = { ...left };
	for (const [key, value] of Object.entries(right)) {
		counts[key] = (counts[key] ?? 0) + value;
	}
	return counts;
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
		indexedP8WorldProgram: createIndexedP8WorldProgram(gl),
		indexedP16WorldProgram: createIndexedP16WorldProgram(gl),
		terrainBlendWorldProgram: createTerrainBlendWorldProgram(gl),
		sceneDomainCopyProgram: createSceneDomainCopyProgram(gl),
		vertexBuffer,
		vertexArray,
		sceneDomainCopyVertexArray: createWebgl2VertexArray(gl, {
			label: "webgl2 scene-domain copy vertex array",
			configure() {
				return;
			},
		}),
		sceneDomainTargets: null,
		sceneDomainFramebufferFailureCount: 0,
		sceneDomainFramebufferFailureSamples: [],
		worldStore: createWebgl2WorldResourceStore(),
		materialTextureCapabilities: detectWebgl2MaterialTextureCapabilities(gl),
	};
}

function detectWebgl2MaterialTextureCapabilities(
	gl: WebGL2RenderingContext,
): MaterialTextureCapabilities {
	const anisotropyExtension =
		gl.getExtension("EXT_texture_filter_anisotropic") ??
		gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic") ??
		gl.getExtension("MOZ_EXT_texture_filter_anisotropic");
	const maxAnisotropy =
		anisotropyExtension === null
			? 1
			: Number(
					gl.getParameter(anisotropyExtension.MAX_TEXTURE_MAX_ANISOTROPY_EXT),
				);
	return {
		supportsS3tc: gl.getExtension("WEBGL_compressed_texture_s3tc") !== null,
		supportsS3tcSrgb:
			gl.getExtension("WEBGL_compressed_texture_s3tc_srgb") !== null,
		supportsPackedRgb565: false,
		supportsPackedRgba4444: true,
		maxAnisotropy: Number.isFinite(maxAnisotropy)
			? Math.max(1, maxAnisotropy)
			: 1,
	};
}

function createFlatWorldProgram(
	gl: WebGL2RenderingContext,
): Webgl2FlatWorldProgram {
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
		uniforms: [
			"uModelViewProjection",
			"uColor",
			"uAlphaTest",
			"uTexture",
			"uDetailTexture",
			"uDetailTiling",
			"uDetailEnabled",
		],
	});
}

function createIndexedP8WorldProgram(
	gl: WebGL2RenderingContext,
): Webgl2IndexedP8WorldProgram {
	return createIndexedWorldProgram(gl, {
		label: "webgl2 indexed p8 world",
		fragmentSource: INDEXED_P8_WORLD_FRAGMENT_SHADER,
	});
}

function createIndexedP16WorldProgram(
	gl: WebGL2RenderingContext,
): Webgl2IndexedP16WorldProgram {
	return createIndexedWorldProgram(gl, {
		label: "webgl2 indexed p16 world",
		fragmentSource: INDEXED_P16_WORLD_FRAGMENT_SHADER,
	});
}

function createIndexedWorldProgram(
	gl: WebGL2RenderingContext,
	options: { label: string; fragmentSource: string },
): Webgl2IndexedP8WorldProgram | Webgl2IndexedP16WorldProgram {
	return createWebgl2Program(gl, {
		label: options.label,
		vertexSource: TEXTURED_WORLD_VERTEX_SHADER,
		fragmentSource: options.fragmentSource,
		attributes: ["position", "uv"],
		uniforms: [
			"uModelViewProjection",
			"uColor",
			"uAlphaTest",
			"uIndexTexture",
			"uPaletteTexture",
			"uTextureSize",
			"uPaletteColorCount",
			"uClipThreshold",
			"uRepeatS",
			"uRepeatT",
			"uDetailTexture",
			"uDetailTiling",
			"uDetailEnabled",
		],
	});
}

function createTerrainBlendWorldProgram(
	gl: WebGL2RenderingContext,
): Webgl2TerrainBlendWorldProgram {
	return createWebgl2Program(gl, {
		label: "webgl2 terrain blend world",
		vertexSource: TERRAIN_BLEND_WORLD_VERTEX_SHADER,
		fragmentSource: TERRAIN_BLEND_WORLD_FRAGMENT_SHADER,
		attributes: ["position", "uv"],
		uniforms: [
			"uModelViewProjection",
			"uBaseTexture",
			"uBaseTiling",
			"uOverlay0",
			"uOverlay1",
			"uOverlay2",
			"uOverlayAlpha0",
			"uOverlayAlpha1",
			"uOverlayAlpha2",
			"uOverlayTiling0",
			"uOverlayTiling1",
			"uOverlayTiling2",
			"uOverlayRotation0",
			"uOverlayRotation1",
			"uOverlayRotation2",
			"uOverlayCount",
			"uRoadTexture",
			"uRoadTiling",
			"uRoadAlpha0",
			"uRoadAlpha1",
			"uRoadRotation0",
			"uRoadRotation1",
			"uRoadCount",
		],
	});
}

function createSceneDomainCopyProgram(
	gl: WebGL2RenderingContext,
): Webgl2ProgramResource<never, "uColorTexture" | "uDepthTexture"> {
	return createWebgl2Program(gl, {
		label: "webgl2 scene-domain copy",
		vertexSource: SCENE_DOMAIN_COPY_VERTEX_SHADER,
		fragmentSource: SCENE_DOMAIN_COPY_FRAGMENT_SHADER,
		uniforms: ["uColorTexture", "uDepthTexture"],
	});
}
