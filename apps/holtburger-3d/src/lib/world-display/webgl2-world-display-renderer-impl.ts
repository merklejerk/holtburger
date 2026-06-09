import {
	createWebgl2ArrayBuffer,
	createWebgl2Program,
	createWebgl2VertexArray,
	type Webgl2BufferResource,
	type Webgl2ProgramResource,
	type Webgl2VertexArrayResource,
} from "./webgl2-gl";
import {
	buildSceneCameraRenderRay,
	createFallbackSceneCameraFrame,
	type SceneBoundsFrame,
} from "./camera";
import type { PreparedBounds } from "../assets/types";
import { createWebgl2RenderMetrics } from "./webgl2-render-metrics";
import { Webgl2StateCache } from "./webgl2-state-cache";
import {
	buildWorldRenderFrame,
	WORLD_RENDER_CANDIDATE_KIND,
	type WorldRenderFrame,
	type WorldRenderCandidate,
	type WorldRenderFrameMetrics,
} from "./world-render-frame";
import {
	createEmptyWebgl2WorldSubmitMetrics,
	planWebgl2StaticBundleLayerSubmitOrder,
	planWebgl2TransitionPortalMaskSubmitOrder,
	planWebgl2TerrainTileSubmitOrder,
	submitWebgl2WorldFrame,
	submitWebgl2WorldResources,
	type Webgl2FlatWorldProgram,
	type Webgl2IndexedP16WorldProgram,
	type Webgl2IndexedP8WorldProgram,
	type Webgl2TexturedWorldProgram,
	type Webgl2WorldSubmitMetrics,
} from "./webgl2-world-submit";
import {
	createWebgl2TerrainFamilyWorldProgram,
	type Webgl2TerrainFamilyWorldProgram,
} from "./webgl2/families/terrain-family-submit";
import {
	createWebgl2PortalCompositeTargetSet,
	createWebgl2SceneDomainTargetSet,
	type Webgl2PortalCompositeTarget,
	type Webgl2PortalCompositeTargetSet,
	type Webgl2SceneDomain,
	type Webgl2SceneDomainTarget,
	type Webgl2SceneDomainTargetSet,
} from "./webgl2-scene-domain-targets";
import {
	clearWebgl2TransitionPortalMaskResources,
	commitWebgl2TerrainProductResultResources,
	createWebgl2WorldResourceStore,
	destroyWebgl2WorldResources,
	evictWebgl2TerrainProductResources,
	refreshWebgl2StaticLandblockProductResourceCounters,
	syncWebgl2TransitionPortalMaskResources,
	type Webgl2TransitionPortalMaskResource,
	type Webgl2WorldResourceStore,
} from "./webgl2-world-resources";
import { deriveLandblockRenderChunkPlacement } from "./render-chunks";
import {
	createStaticLandblockProductKeyFromResult,
	formatStaticLandblockProductKey,
	getDetailedLandblockRenderArtifacts,
	getLandblockTerrainRenderArtifact,
	getStaticObjectBundleArtifacts,
} from "./landblock-render-product";
import {
	createEmptyStaticLandblockRenderProductSet,
	type StaticLandblockRenderProductSet,
} from "./static-landblock-render-artifact-store";
import { inspectWebgl2WorldResources } from "./render-resource-inspection";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type {
	LandblockRenderProductWorkerResult,
	StaticLandblockProductKey,
} from "./landblock-render-product";
import type {
	StaticBundleSpatialHint,
	StaticObjectBundleArtifact,
} from "./static-bundle-layer";
import type { Webgl2TerrainTileResource } from "./webgl2/resources/terrain-tile-resources";
import type {
	BrowserCameraResidency,
	WorldRenderMetrics,
} from "./renderer-contract";
import type { MaterialTextureCapabilities } from "./render-surface-texture-data";
import {
	createTranslationMat4,
	multiplyMat4Into,
	type RenderMat4,
} from "./render-math";
import {
	deriveTransitionPortalRenderLevels,
	type TransitionPortalRenderLevel,
} from "./render-policy";
import { transitionPortalDepthBatchKey } from "./transition-portal-depth-batches";
import {
	deriveWebgl2BaseSceneDomain,
	deriveWebgl2BaseSceneDomainFromResidency,
	deriveWebgl2InitialPortalEnvCellId,
	planWebgl2TransitionPortalWork,
	type Webgl2TransitionPortalWorkPlan,
	type Webgl2VisibleTransitionPortalWork,
} from "./webgl2-transition-portal-work";
import { resolveTransitionPortalMaskModelMatrix } from "./transition-portal-mask-resources";
import {
	createEmptyTransitionPortalCandidateModel,
	deriveTransitionPortalCandidatesFromLandblockArtifacts,
	type TransitionPortalScene,
} from "./transition-portal-work-items";
import {
	buildWorldResidencyIndex,
	buildWorldResidencyIndexFromLandblockArtifacts,
	createEmptyWorldResidencyIndex,
	deriveBrowserCameraResidency,
	describeCameraViewResidencyContext,
	type CameraViewResidencyContext,
	type WorldResidencyIndex,
	type WorldResidencyQueryDiagnostics,
} from "./world-residency-index";
import {
	createEmptyStaticRenderableSceneModel,
	isPreparedGfxObjAsset,
	type StaticRenderablePart,
} from "./static-renderables";
import { createEmptyTerrainSceneModel } from "./terrain-scene";
import { createEmptyStructuredInteriorSceneModel } from "./structured-interior-scene";
import { buildStaticRenderablePartMatrix } from "./static-renderable-placement";
import type {
	WorldDisplayRenderer,
	WorldDisplayRendererOptions,
} from "./world-display-renderer-contract";
import { calculateStaticLandblockArtifactSceneBoundsFrame } from "./artifact-scene-bounds";
import { profileBrowserJsScope } from "../diagnostics/browser-js-profiler";
import { createStaticLandblockProductMetadataStore } from "./static-landblock-product-metadata";
import {
	commitWebgl2StaticBundleProductResources,
	describeStaticBundleLayerResourceKey,
	evictWebgl2StaticBundleProductResources,
	type Webgl2StaticBundleLayerResource,
} from "./webgl2/resources/static-bundle-layer-resources";
import type { Webgl2ResidentTexturePageResource } from "./webgl2/resources/texture-page-upload";
import {
	commitWebgl2StructuredInteriorProductResources,
	evictWebgl2StructuredInteriorProductResources,
} from "./webgl2/resources/structured-interior-resources";
import {
	ALL_RENDER_UPLOAD_DIAGNOSTIC_FAMILIES,
	describeDiagnosticSet,
	logTemporaryRenderRegressionDiagnostic,
	readTemporaryRenderRegressionDiagnostics,
	shouldUploadRenderFamily,
	type RenderUploadDiagnosticFamily,
} from "./render-regression-diagnostics";
import {
	calculateTexturePageCoverage,
	RENDER_RESOURCE_INSPECTION_OWNER_KIND,
	type RenderResourceTexturePageIdentity,
	type RenderResourceTexturePagePreview,
} from "./render-resource-inspection";
import type { NormalizedViewportPoint } from "./model";
import type {
	RenderSpatialItemKind,
	RenderSpatialPick,
} from "./render-spatial-index";

const WEBGL2_CANVAS_CLASS_NAME = "world-display__webgl2-canvas";
const WEBGL2_ERROR_CLASS_NAME = "world-display__webgl2-error";
const WEBGL2_CLEAR_COLOR: readonly [number, number, number, number] = [
	0.015, 0.055, 0.085, 1,
];
const PERFORMANCE_REPORT_INTERVAL_MS = 500;
const SELECTED_STATIC_RENDERABLE_BOUNDS_COLOR = new Float32Array([
	1, 0.82, 0.28, 1,
]);
const BOUNDS_LINE_VERTEX_COMPONENTS = 3;
const IDENTITY_BOUNDS_MATRIX = new Float32Array([
	1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]) satisfies RenderMat4;

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
uniform int uAtlasEnabled;
uniform vec4 uAtlasRect;
uniform vec2 uAtlasSize;
uniform vec2 uTexturePageWrapMode;
uniform sampler2D uDetailTexture;
uniform float uDetailTiling;
uniform int uDetailEnabled;
uniform vec4 uDetailAtlasRect;
uniform vec2 uDetailAtlasSize;
uniform vec2 uDetailTexturePageWrapMode;

in vec2 vUv;

out vec4 fragColor;

vec2 resolveTexturePageUv(vec2 uv, vec4 rect, vec2 atlasSize, vec2 wrapMode) {
	vec2 wrappedUv = mix(clamp(uv, 0.0, 0.999999), fract(uv), wrapMode);
	return (rect.xy + wrappedUv * rect.zw) / atlasSize;
}

vec3 applyDetailOverlay(vec3 baseColor) {
	if (uDetailEnabled == 0) {
		return baseColor;
	}
	vec4 detailColor = texture(
		uDetailTexture,
		resolveTexturePageUv(vUv * uDetailTiling, uDetailAtlasRect, uDetailAtlasSize, uDetailTexturePageWrapMode)
	);
	float sourceAlpha = clamp(detailColor.a, 0.0, 1.0);
	return clamp(baseColor * (detailColor.rgb + (1.0 - sourceAlpha)), 0.0, 1.0);
}

void main() {
	vec2 baseUv = uAtlasEnabled == 0
		? vUv
		: resolveTexturePageUv(vUv, uAtlasRect, uAtlasSize, uTexturePageWrapMode);
	vec4 texel = texture(uTexture, baseUv);
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
uniform vec4 uIndexAtlasRect;
uniform vec4 uPaletteAtlasRect;
uniform vec2 uPaletteAtlasSize;
uniform int uClipThreshold;
uniform int uRepeatS;
uniform int uRepeatT;
uniform sampler2D uDetailTexture;
uniform float uDetailTiling;
uniform int uDetailEnabled;
uniform vec4 uDetailAtlasRect;
uniform vec2 uDetailAtlasSize;
uniform vec2 uDetailTexturePageWrapMode;

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
	vec2 paletteUv =
		(uPaletteAtlasRect.xy + vec2(index + 0.5, 0.5)) / uPaletteAtlasSize;
	return texture(uPaletteTexture, paletteUv);
}

float paletteIndexAt(ivec2 coord) {
	ivec2 atlasCoord = ivec2(floor(uIndexAtlasRect.xy + vec2(0.5))) + coord;
	vec4 packed = texelFetch(uIndexTexture, atlasCoord, 0) * 255.0;
	return floor(packed.r + 0.5);
}

vec3 applyDetailOverlay(vec3 baseColor) {
	if (uDetailEnabled == 0) {
		return baseColor;
	}
	vec2 localUv = vUv * uDetailTiling;
	vec2 wrappedUv = mix(
		clamp(localUv, 0.0, 0.999999),
		fract(localUv),
		uDetailTexturePageWrapMode
	);
	vec2 detailUv = (uDetailAtlasRect.xy + wrappedUv * uDetailAtlasRect.zw) / uDetailAtlasSize;
	vec4 detailColor = texture(uDetailTexture, detailUv);
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
uniform vec4 uIndexAtlasRect;
uniform vec4 uPaletteAtlasRect;
uniform vec2 uPaletteAtlasSize;
uniform int uClipThreshold;
uniform int uRepeatS;
uniform int uRepeatT;
uniform sampler2D uDetailTexture;
uniform float uDetailTiling;
uniform int uDetailEnabled;
uniform vec4 uDetailAtlasRect;
uniform vec2 uDetailAtlasSize;
uniform vec2 uDetailTexturePageWrapMode;

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
	vec2 paletteUv =
		(uPaletteAtlasRect.xy + vec2(index + 0.5, 0.5)) / uPaletteAtlasSize;
	return texture(uPaletteTexture, paletteUv);
}

float paletteIndexAt(ivec2 coord) {
	ivec2 atlasCoord = ivec2(floor(uIndexAtlasRect.xy + vec2(0.5))) + coord;
	vec4 packed = texelFetch(uIndexTexture, atlasCoord, 0) * 255.0;
	return floor(packed.r + 0.5) + floor(packed.g + 0.5) * 256.0;
}

vec3 applyDetailOverlay(vec3 baseColor) {
	if (uDetailEnabled == 0) {
		return baseColor;
	}
	vec2 localUv = vUv * uDetailTiling;
	vec2 wrappedUv = mix(
		clamp(localUv, 0.0, 0.999999),
		fract(localUv),
		uDetailTexturePageWrapMode
	);
	vec2 detailUv = (uDetailAtlasRect.xy + wrappedUv * uDetailAtlasRect.zw) / uDetailAtlasSize;
	vec4 detailColor = texture(uDetailTexture, detailUv);
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

const TEXTURE_PAGE_PREVIEW_VERTEX_SHADER = `#version 300 es
out vec2 vUv;

void main() {
	vec2 position = gl_VertexID == 0
		? vec2(-1.0, -1.0)
		: gl_VertexID == 1
			? vec2(3.0, -1.0)
			: vec2(-1.0, 3.0);
	vUv = position * 0.5 + 0.5;
	gl_Position = vec4(position, 0.0, 1.0);
}
`;

const TEXTURE_PAGE_PREVIEW_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uTexture;
uniform int uPreviewMode;

in vec2 vUv;

out vec4 fragColor;

void main() {
	vec4 value = texture(uTexture, vUv);
	if (uPreviewMode == 1) {
		fragColor = vec4(value.rrr, 1.0);
		return;
	}
	if (uPreviewMode == 2) {
		fragColor = vec4(value.rg, 0.0, 1.0);
		return;
	}
	fragColor = value;
}
`;

interface Webgl2ColorDepthTarget {
	readonly width: number;
	readonly height: number;
	readonly framebuffer: WebGLFramebuffer;
	readonly colorTexture: WebGLTexture;
	readonly depthTexture: WebGLTexture;
	readonly hasDepth: boolean;
	readonly hasStencil: boolean;
}

interface Webgl2RenderResources {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	flatWorldProgram: Webgl2FlatWorldProgram;
	texturedWorldProgram: Webgl2TexturedWorldProgram;
	indexedP8WorldProgram: Webgl2IndexedP8WorldProgram;
	indexedP16WorldProgram: Webgl2IndexedP16WorldProgram;
	terrainFamilyWorldProgram: Webgl2TerrainFamilyWorldProgram;
	sceneDomainCopyProgram: Webgl2ProgramResource<
		never,
		"uColorTexture" | "uDepthTexture"
	>;
	sceneDomainCopyVertexArray: Webgl2VertexArrayResource;
	texturePagePreviewProgram: Webgl2ProgramResource<
		never,
		"uTexture" | "uPreviewMode"
	>;
	texturePagePreviewVertexArray: Webgl2VertexArrayResource;
	sceneDomainTargets: Webgl2SceneDomainTargetSet | null;
	portalCompositeTargets: Webgl2PortalCompositeTargetSet | null;
	selectedStaticRenderableOverlay: Webgl2StaticRenderableSelectionOverlay | null;
	sceneDomainFramebufferFailureCount: number;
	sceneDomainFramebufferFailureSamples: string[];
	worldStore: Webgl2WorldResourceStore;
	materialTextureCapabilities: MaterialTextureCapabilities;
}

interface Webgl2StaticRenderableSelectionOverlay {
	readonly signature: string;
	readonly modelMatrix: RenderMat4;
	readonly vertexBuffer: Webgl2BufferResource;
	readonly vertexArray: Webgl2VertexArrayResource;
	readonly vertexCount: number;
	dispose(): void;
}

interface Webgl2SceneDomainFrameMetrics {
	width: number;
	height: number;
	exteriorDrawCallCount: number;
	interiorDrawCallCount: number;
	baseCopyPassCount: number;
	transitionApertureMaskPassCount: number;
	interiorCompositePassCount: number;
	exteriorCompositePassCount: number;
	portalCompositeRectCount: number;
	portalCompositeEstimatedPixelArea: number;
	portalCompositeMaxDepth: number;
}

export function createWebgl2WorldDisplayRendererImplementation(
	host: HTMLDivElement,
	options: WorldDisplayRendererOptions,
): WorldDisplayRenderer {
	let assetState = options.assetState;
	const emptyTerrainScene = createEmptyTerrainSceneModel();
	let staticLandblockRenderProducts = options.staticLandblockRenderProducts;
	const staticRenderableScene = createEmptyStaticRenderableSceneModel();
	const structuredInteriorScene = createEmptyStructuredInteriorSceneModel();
	let transitionPortalModel = createEmptyTransitionPortalCandidateModel();
	let renderSceneContext = options.renderSceneContext;
	let renderChunkTransforms = options.renderChunkTransforms;
	let selectedStaticRenderableRenderKey =
		options.selectedStaticRenderableRenderKey;
	let controlledCameraFrame = options.controlledCameraFrame;
	let transitionPortalMaxDepth = options.transitionPortalMaxDepth ?? 1;
	let textureFilteringMode = options.textureFilteringMode ?? "anisotropic-4x";
	let detailTexturesEnabled = options.detailTexturesEnabled ?? true;
	const renderRegressionDiagnostics =
		readTemporaryRenderRegressionDiagnostics();
	let renderMetricsChangeHandler = options.onRenderMetricsChange;
	let cameraResidencyChangeHandler = options.onCameraResidencyChange;
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
	let latestFrameMetrics: WorldRenderFrameMetrics | null = null;
	let latestSceneDomainFrameMetrics: Webgl2SceneDomainFrameMetrics | null =
		null;
	let residencyIndex: WorldResidencyIndex = createEmptyWorldResidencyIndex();
	let latestCameraResidencyContext: CameraViewResidencyContext = {
		kind: "unknown",
		landblockId: null,
	};
	let latestCameraResidencyDiagnostics: WorldResidencyQueryDiagnostics = {
		landblockId: null,
		aabbCandidateCount: 0,
		cellBspMatchCount: 0,
		aabbFallbackCount: 0,
		source: "unknown",
	};
	let latestCameraResidencyKey = "";
	let latestBaseSceneDomain: TransitionPortalScene =
		deriveWebgl2BaseSceneDomain({
			renderSceneContext,
		});
	let latestPortalWorkPlan: Webgl2TransitionPortalWorkPlan | null = null;
	let latestSceneBounds: SceneBoundsFrame | null = null;
	const staticProductMetadata = createStaticLandblockProductMetadataStore();
	staticProductMetadata.updateRenderChunkTransforms(renderChunkTransforms);
	for (const artifact of staticLandblockRenderProducts.artifacts) {
		staticProductMetadata.commitProduct(artifact);
	}
	const selectedOverlayModelViewProjection = new Float32Array(16);

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
			recommitStaticProductRenderResources();
			reportMetrics();
			scheduleFrame();
		},
		commitStaticLandblockProduct(result) {
			staticLandblockRenderProducts = commitProductToSet(
				staticLandblockRenderProducts,
				result,
			);
			syncStaticProductTransitionPortalModel();
			syncTransitionPortalMaskResources();
			commitStaticProductRenderResources(result);
			staticProductMetadata.commitProduct(result);
			refreshStaticProductSceneBounds();
			resources?.stateCache.invalidate();
			scheduleFrame();
			syncResidencyIndex();
		},
		evictStaticLandblockProduct(key) {
			staticLandblockRenderProducts = evictProductFromSet(
				staticLandblockRenderProducts,
				key,
			);
			syncStaticProductTransitionPortalModel();
			syncTransitionPortalMaskResources();
			evictStaticProductRenderResources(key);
			staticProductMetadata.evictProduct(key);
			refreshStaticProductSceneBounds();
			resources?.stateCache.invalidate();
			scheduleFrame();
			syncResidencyIndex();
		},
		clearStaticLandblockProducts() {
			clearStaticProductRenderResources(staticLandblockRenderProducts);
			staticLandblockRenderProducts =
				createEmptyStaticLandblockRenderProductSet();
			syncStaticProductTransitionPortalModel();
			syncTransitionPortalMaskResources();
			staticProductMetadata.clearProducts();
			refreshStaticProductSceneBounds();
			resources?.stateCache.invalidate();
			scheduleFrame();
			syncResidencyIndex();
		},
		setDebugOverlayScene() {
			reportMetrics();
		},
		setRenderSceneContext(context) {
			renderSceneContext = context;
			syncResidencyIndex();
			reportMetrics();
		},
		setRenderChunkTransforms(transforms) {
			renderChunkTransforms = transforms;
			staticProductMetadata.updateRenderChunkTransforms(transforms);
			refreshStaticProductSceneBounds();
			resources?.stateCache.invalidate();
			scheduleFrame();
			syncResidencyIndex();
		},
		setRenderSpatialQuery() {
			reportMetrics();
		},
		setSelectedStaticRenderableRenderKey(renderKey) {
			if (selectedStaticRenderableRenderKey === renderKey) {
				return;
			}
			selectedStaticRenderableRenderKey = renderKey;
			disposeSelectedStaticRenderableOverlay();
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
			recommitStaticProductRenderResources();
			resources?.stateCache.invalidate();
			reportMetrics();
			scheduleFrame();
		},
		setDetailTexturesEnabled(enabled) {
			if (detailTexturesEnabled === enabled) {
				return;
			}
			detailTexturesEnabled = enabled;
			recommitStaticProductRenderResources();
			resources?.stateCache.invalidate();
			reportMetrics();
			scheduleFrame();
		},
		setCameraFrameChangeHandler() {
			return;
		},
		setRenderMetricsChangeHandler(handler) {
			renderMetricsChangeHandler = handler;
			reportMetrics();
		},
		setCameraResidencyChangeHandler(handler) {
			cameraResidencyChangeHandler = handler;
			reportCameraResidency();
		},
		inspectResources() {
			return inspectWebgl2WorldResources(resources?.worldStore ?? null);
		},
		previewTexturePage(identity) {
			return previewWebgl2TexturePage(identity);
		},
		pickTerrainLandblockAtViewportPoint(viewportPoint) {
			const pick = pickStaticProductAtViewportPoint(
				viewportPoint,
				new Set(["terrain"]),
			);
			return pick?.item.metadata.kind === "terrain"
				? pick.item.metadata.landblockId
				: null;
		},
		pickAtViewportPoint(viewportPoint, mask, ownerKeys) {
			return pickStaticProductAtViewportPoint(viewportPoint, mask, ownerKeys);
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

			resources = createWebgl2RenderResources(gl);
			syncStaticProductTransitionPortalModel();
			recommitStaticProductRenderResources();
			syncTransitionPortalMaskResources();
			syncCanvasSize();
			refreshStaticProductSceneBounds();
			syncResidencyIndex();
			scheduleFrame();
		} catch (error) {
			initializationError =
				error instanceof Error ? error.message : String(error);
			console.error("[holtburger-3d][webgl2]", error);
			showInitializationError(initializationError);
			reportMetrics();
		}
	}

	function commitStaticProductRenderResources(
		result: LandblockRenderProductWorkerResult,
	): void {
		if (!resources) {
			return;
		}
		const startedAtMs = nowMs();
		const currentResources = resources;
		currentResources.stateCache.bindVertexArray(null);
		const productKey = createStaticLandblockProductKeyFromResult(result);
		const maxAnisotropy =
			currentResources.materialTextureCapabilities.maxAnisotropy ?? 1;
		const enabledUploadFamilies = new Set(
			ALL_RENDER_UPLOAD_DIAGNOSTIC_FAMILIES.filter((family) =>
				shouldUploadRenderFamily(renderRegressionDiagnostics, family),
			),
		);
		const staticBundleLayers = getStaticObjectBundleArtifacts(result).filter(
			(bundle) =>
				isRenderableStaticLandblockArtifactLayer(
					result.product,
					bundle.bundleKind,
				),
		);
		if (enabledUploadFamilies.has("static-objects")) {
			profileBrowserJsScope("webgl2.commit.staticBundles", () => {
				commitWebgl2StaticBundleProductResources({
					gl: currentResources.gl,
					store: currentResources.worldStore.staticBundleLayerResources,
					productKey,
					layers: staticBundleLayers,
					textureFilteringMode,
					maxAnisotropy,
				});
			});
		} else {
			evictWebgl2StaticBundleProductResources({
				store: currentResources.worldStore.staticBundleLayerResources,
				productKey,
			});
		}
		const detailed = getDetailedLandblockRenderArtifacts(result);
		if (detailed && enabledUploadFamilies.has("cell-structures")) {
			profileBrowserJsScope("webgl2.commit.structuredInterior", () => {
				commitWebgl2StructuredInteriorProductResources({
					gl: currentResources.gl,
					store: currentResources.worldStore.structuredInteriorResources,
					productKey,
					artifact: detailed,
					textureFilteringMode,
					maxAnisotropy,
				});
			});
		} else {
			evictWebgl2StructuredInteriorProductResources({
				store: currentResources.worldStore.structuredInteriorResources,
				productKey,
			});
		}
		if (
			getLandblockTerrainRenderArtifact(result) &&
			enabledUploadFamilies.has("terrain")
		) {
			profileBrowserJsScope("webgl2.commit.terrainProduct", () => {
				commitWebgl2TerrainProductResultResources({
					gl: currentResources.gl,
					store: currentResources.worldStore,
					result,
					assetState,
					materialTextureCapabilities:
						currentResources.materialTextureCapabilities,
					textureFilteringMode,
					detailTexturesEnabled,
				});
			});
		} else {
			evictWebgl2TerrainProductResources({
				gl: currentResources.gl,
				store: currentResources.worldStore,
				productKey,
				assetState,
				materialTextureCapabilities:
					currentResources.materialTextureCapabilities,
				textureFilteringMode,
				detailTexturesEnabled,
			});
		}
		refreshWebgl2StaticLandblockProductResourceCounters(
			currentResources.worldStore,
		);
		reportStaticProductCommitDiagnostics({
			result,
			enabledUploadFamilies,
			staticBundleLayers,
			durationMs: nowMs() - startedAtMs,
			store: currentResources.worldStore,
		});
	}

	function evictStaticProductRenderResources(
		productKey: StaticLandblockProductKey,
	): void {
		if (!resources) {
			return;
		}
		const currentResources = resources;
		evictWebgl2StaticBundleProductResources({
			store: currentResources.worldStore.staticBundleLayerResources,
			productKey,
		});
		evictWebgl2StructuredInteriorProductResources({
			store: currentResources.worldStore.structuredInteriorResources,
			productKey,
		});
		evictWebgl2TerrainProductResources({
			gl: currentResources.gl,
			store: currentResources.worldStore,
			productKey,
			assetState,
			materialTextureCapabilities: currentResources.materialTextureCapabilities,
			textureFilteringMode,
			detailTexturesEnabled,
		});
		refreshWebgl2StaticLandblockProductResourceCounters(
			currentResources.worldStore,
		);
	}

	function clearStaticProductRenderResources(
		products: StaticLandblockRenderProductSet,
	): void {
		for (const product of products.artifacts) {
			evictStaticProductRenderResources(
				createStaticLandblockProductKeyFromResult(product),
			);
		}
	}

	function recommitStaticProductRenderResources(): void {
		syncStaticProductTransitionPortalModel();
		for (const product of staticLandblockRenderProducts.artifacts) {
			commitStaticProductRenderResources(product);
		}
	}

	function syncStaticProductTransitionPortalModel(): void {
		transitionPortalModel =
			deriveTransitionPortalCandidatesFromLandblockArtifacts({
				artifacts: staticLandblockRenderProducts,
				activeLandblockIds: staticLandblockRenderProducts.artifacts.map(
					(product) => product.landblockId,
				),
			}) ?? createEmptyTransitionPortalCandidateModel();
	}

	function syncTransitionPortalMaskResources(): void {
		if (!resources) {
			return;
		}
		if (
			!shouldUploadRenderFamily(renderRegressionDiagnostics, "portal-masks")
		) {
			clearWebgl2TransitionPortalMaskResources({
				store: resources.worldStore,
			});
			return;
		}
		profileBrowserJsScope("webgl2.sync.transitionPortalMasks", () => {
			if (!resources) {
				return;
			}
			syncWebgl2TransitionPortalMaskResources({
				gl: resources.gl,
				store: resources.worldStore,
				transitionPortalModel,
			});
		});
	}

	function refreshStaticProductSceneBounds(): void {
		latestSceneBounds = calculateStaticLandblockArtifactSceneBoundsFrame({
			artifacts: staticLandblockRenderProducts,
			renderChunkTransforms,
		});
		reportMetrics();
	}

	function isRenderableStaticLandblockArtifactLayer(
		product: LandblockRenderProductWorkerResult["product"],
		bundleKind: StaticObjectBundleArtifact["bundleKind"],
	): boolean {
		switch (product) {
			case "outdoor-terrain":
				return false;
			case "outdoor-buildings":
				return bundleKind === "outdoor-buildings";
			case "outdoor-detail":
				return bundleKind === "outdoor-detail";
			case "outdoor-env-cells":
			case "dungeon-env-cells":
				return bundleKind === "env-cell-static";
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
		const currentResources = resources;
		scheduleFrame();

		profileBrowserJsScope("webgl2.frame.syncCanvasSize", syncCanvasSize);
		const renderStartedAt = window.performance.now();
		const { gl } = currentResources;
		currentResources.stateCache.bindFramebuffer(null);
		currentResources.stateCache.setViewport({
			x: 0,
			y: 0,
			width: canvas.width,
			height: canvas.height,
		});
		currentResources.stateCache.setDepthState({
			enabled: true,
			write: true,
			func: gl.LEQUAL,
		});
		gl.clearColor(...WEBGL2_CLEAR_COLOR);
		gl.clearDepth(1);
		clearBoundFramebuffer({
			gl,
			color: true,
			depth: true,
			stencil: false,
			hasDepth: defaultFramebufferHasDepth(gl),
			hasStencil: defaultFramebufferHasStencil(gl),
		});
		clearCount += 1;
		const cameraFrame = profileBrowserJsScope(
			"webgl2.frame.resolveCameraFrame",
			resolveCameraFrame,
		);
		profileBrowserJsScope("webgl2.frame.updateCameraResidency", () => {
			updateCameraResidency(cameraFrame.position);
		});

		const frameCandidates = [
			...createStaticBundleLayerRenderCandidates(staticLandblockRenderProducts),
			...currentResources.worldStore.terrainRenderCandidates.map(
				(candidate) => ({
					id: candidate.id,
					kind: WORLD_RENDER_CANDIDATE_KIND.terrainTile,
					bvhItemKeys: candidate.bvhItemKeys,
					bvhFallbackReason: candidate.bvhFallbackReason,
				}),
			),
			...currentResources.worldStore.transitionPortalMasks.map((mask) => ({
				id: mask.id,
				kind: WORLD_RENDER_CANDIDATE_KIND.portalMask,
				bvhItemKeys: mask.bvhItemKeys,
				bvhFallbackReason: mask.bvhFallbackReason,
			})),
		];
		if (frameCandidates.length > 0) {
			const frame = profileBrowserJsScope(
				"webgl2.frame.buildWorldRenderFrame",
				() =>
					buildWorldRenderFrame({
						assetState,
						candidates: frameCandidates,
						cameraFrame,
						renderChunkTransforms,
						staticRenderableScene,
						staticLandblockRenderProducts,
						structuredInteriorScene,
						terrainScene: emptyTerrainScene,
					}),
			);
			latestFrameMetrics = frame.metrics;
			const transitionPortalMasks = profileBrowserJsScope(
				"webgl2.frame.planPortalMasks",
				() =>
					planWebgl2TransitionPortalMaskSubmitOrder(
						frame,
						currentResources.worldStore.transitionPortalMasksById,
					),
			);
			const baseSceneDomain = deriveWebgl2BaseSceneDomainFromResidency(
				latestCameraResidencyContext,
			);
			if (
				shouldUseSceneDomainTargets({
					portalMaskResourceCount: transitionPortalMasks.length,
					baseSceneDomain,
					transitionPortalCandidateCount:
						transitionPortalModel.diagnostics.workItemCandidateCount,
				})
			) {
				latestSubmitMetrics = profileBrowserJsScope(
					"webgl2.frame.submitSceneDomain",
					() =>
						submitWebgl2SceneDomainFrame({
							frame,
							transitionPortalMasks,
						}),
				);
			} else {
				latestSceneDomainFrameMetrics = null;
				latestPortalWorkPlan = null;
				latestBaseSceneDomain = baseSceneDomain;
				latestSubmitMetrics = profileBrowserJsScope(
					"webgl2.frame.submitWorld",
					() =>
						submitWebgl2WorldFrame({
							gl,
							stateCache: currentResources.stateCache,
							program: currentResources.flatWorldProgram,
							texturedProgram: currentResources.texturedWorldProgram,
							terrainFamilyProgram: currentResources.terrainFamilyWorldProgram,
							indexedP8Program: currentResources.indexedP8WorldProgram,
							indexedP16Program: currentResources.indexedP16WorldProgram,
							staticBundleLayerResources:
								currentResources.worldStore.staticBundleLayerResources,
							structuredInteriorResources:
								currentResources.worldStore.structuredInteriorResources,
							renderChunkTransforms,
							transitionPortalMasksById:
								currentResources.worldStore.transitionPortalMasksById,
							terrainTilesById: currentResources.worldStore.terrainTilesById,
							frame,
						}),
				);
			}
			drawCallCount += latestSubmitMetrics.drawCallCount;
			lastFrameDrawCount = latestSubmitMetrics.drawCallCount;
			profileBrowserJsScope("webgl2.frame.renderSelectedStatic", () =>
				renderSelectedStaticRenderableOverlay(frame),
			);
		} else {
			latestFrameMetrics = null;
			latestSceneDomainFrameMetrics = null;
			latestSubmitMetrics = createEmptyWebgl2WorldSubmitMetrics();
			lastFrameDrawCount = 0;
		}
		recordPerformanceSample({
			frameAt,
			renderMs: window.performance.now() - renderStartedAt,
		});
		profileBrowserJsScope("webgl2.frame.reportMetrics", reportMetrics);
	}

	function renderSelectedStaticRenderableOverlay(
		frame: WorldRenderFrame,
	): void {
		if (!resources) {
			return;
		}
		const overlay = syncSelectedStaticRenderableOverlay(resources);
		if (!overlay) {
			return;
		}
		const { gl, stateCache, flatWorldProgram } = resources;
		stateCache.setDepthState({
			enabled: true,
			write: false,
			func: gl.LEQUAL,
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
		stateCache.useProgram(flatWorldProgram.program);
		stateCache.bindVertexArray(overlay.vertexArray.vertexArray);
		gl.uniformMatrix4fv(
			flatWorldProgram.uniforms.uModelViewProjection,
			false,
			multiplyMat4Into(
				selectedOverlayModelViewProjection,
				frame.viewProjectionMatrix,
				overlay.modelMatrix,
			),
		);
		gl.uniform4fv(
			flatWorldProgram.uniforms.uColor,
			SELECTED_STATIC_RENDERABLE_BOUNDS_COLOR,
		);
		gl.drawArrays(gl.LINES, 0, overlay.vertexCount);
		stateCache.setDepthState({
			enabled: true,
			write: true,
			func: gl.LEQUAL,
		});
	}

	function syncSelectedStaticRenderableOverlay(
		currentResources: Webgl2RenderResources,
	): Webgl2StaticRenderableSelectionOverlay | null {
		if (selectedStaticRenderableRenderKey === null) {
			disposeSelectedStaticRenderableOverlay();
			return null;
		}
		const part = staticRenderableScene.parts.find(
			(candidate) => candidate.renderKey === selectedStaticRenderableRenderKey,
		);
		const overlayInput =
			buildSelectedStaticArtifactOverlayInput(
				selectedStaticRenderableRenderKey,
			) ?? (part ? buildSelectedStaticRenderableOverlayInput(part) : null);
		if (!overlayInput) {
			disposeSelectedStaticRenderableOverlay();
			return null;
		}
		const existing = currentResources.selectedStaticRenderableOverlay;
		if (existing?.signature === overlayInput.signature) {
			return existing;
		}

		existing?.dispose();
		currentResources.selectedStaticRenderableOverlay = null;
		const vertexBuffer = createWebgl2ArrayBuffer(currentResources.gl, {
			label: `selected static renderable bounds ${overlayInput.label}`,
			data: overlayInput.positions,
		});
		const vertexArray = createWebgl2VertexArray(currentResources.gl, {
			label: `selected static renderable bounds ${overlayInput.label}`,
			configure() {
				currentResources.gl.bindBuffer(
					currentResources.gl.ARRAY_BUFFER,
					vertexBuffer.buffer,
				);
				currentResources.gl.enableVertexAttribArray(
					currentResources.flatWorldProgram.attributes.position,
				);
				currentResources.gl.vertexAttribPointer(
					currentResources.flatWorldProgram.attributes.position,
					BOUNDS_LINE_VERTEX_COMPONENTS,
					currentResources.gl.FLOAT,
					false,
					0,
					0,
				);
				currentResources.gl.bindBuffer(currentResources.gl.ARRAY_BUFFER, null);
			},
		});
		const overlay = {
			signature: overlayInput.signature,
			modelMatrix: overlayInput.modelMatrix,
			vertexBuffer,
			vertexArray,
			vertexCount:
				overlayInput.positions.length / BOUNDS_LINE_VERTEX_COMPONENTS,
			dispose() {
				vertexArray.dispose();
				vertexBuffer.dispose();
			},
		};
		currentResources.selectedStaticRenderableOverlay = overlay;
		currentResources.stateCache.invalidate();
		return overlay;
	}

	function buildSelectedStaticRenderableOverlayInput(
		part: StaticRenderablePart,
	): {
		label: string;
		signature: string;
		modelMatrix: RenderMat4;
		positions: Float32Array;
	} | null {
		const asset = assetState.preparedByAssetId[part.gfxObjAssetId];
		if (!isPreparedGfxObjAsset(asset) || !asset.payload.renderGeometry.bounds) {
			return null;
		}
		const chunkOffset = renderChunkTransforms.find(
			(transform) => transform.chunkKey === part.renderChunk.chunkKey,
		)?.offset;
		if (!chunkOffset) {
			return null;
		}
		const partMatrix = buildStaticRenderablePartMatrix(part);
		const modelMatrix = createTranslationMat4(chunkOffset);
		const positions = buildSelectedStaticRenderableBoundsLinePositions(
			asset.payload.renderGeometry.bounds,
			partMatrix,
		);
		return {
			label: part.renderKey,
			signature: [
				part.renderKey,
				part.gfxObjAssetId,
				describeMat4Signature(partMatrix),
				`${chunkOffset.x},${chunkOffset.y},${chunkOffset.z}`,
				describeBoundsSignature(asset.payload.renderGeometry.bounds),
			].join("|"),
			modelMatrix,
			positions,
		};
	}

	function buildSelectedStaticArtifactOverlayInput(renderKey: string): {
		label: string;
		signature: string;
		modelMatrix: RenderMat4;
		positions: Float32Array;
	} | null {
		const hint = findSelectedStaticBundleSpatialHint(renderKey);
		if (!hint) {
			return null;
		}
		const chunkOffset = renderChunkTransforms.find(
			(transform) => transform.chunkKey === hint.chunkKey,
		)?.offset;
		if (!chunkOffset) {
			return null;
		}
		const modelMatrix = createTranslationMat4(chunkOffset);
		return {
			label: renderKey,
			signature: [
				renderKey,
				hint.bundleKey,
				hint.sourceRevision,
				hint.bundleKind,
				hint.chunkKey,
				`${chunkOffset.x},${chunkOffset.y},${chunkOffset.z}`,
				describeBoundsSignature(hint.bounds),
			].join("|"),
			modelMatrix,
			positions: buildSelectedStaticRenderableBoundsLinePositions(
				hint.bounds,
				IDENTITY_BOUNDS_MATRIX,
			),
		};
	}

	function findSelectedStaticBundleSpatialHint(renderKey: string): {
		bundleKey: string;
		bundleKind: string;
		chunkKey: string;
		sourceRevision: string;
		bounds: StaticBundleSpatialHint["bounds"];
	} | null {
		for (const result of staticLandblockRenderProducts.artifacts) {
			for (const bundle of getStaticObjectBundleArtifacts(result)) {
				const renderChunk = deriveLandblockRenderChunkPlacement(
					bundle.landblockId,
				);
				for (const hint of bundle.spatialHints ?? []) {
					if (hint.key !== renderKey) {
						continue;
					}
					return {
						bundleKey: bundle.key,
						bundleKind: bundle.bundleKind,
						chunkKey: renderChunk.chunkKey,
						sourceRevision: bundle.sourceRevision,
						bounds: hint.bounds,
					};
				}
			}
		}
		return null;
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
			if (resources?.portalCompositeTargets) {
				resources.portalCompositeTargets.dispose();
				resources.portalCompositeTargets = null;
			}
		}
	}

	function shouldUseSceneDomainTargets({
		portalMaskResourceCount,
		baseSceneDomain,
		transitionPortalCandidateCount,
	}: {
		portalMaskResourceCount: number;
		baseSceneDomain: Webgl2SceneDomain;
		transitionPortalCandidateCount: number;
	}): boolean {
		return (
			transitionPortalMaxDepth > 0 &&
			(portalMaskResourceCount > 0 ||
				(baseSceneDomain === "interior" && transitionPortalCandidateCount > 0))
		);
	}

	function submitWebgl2SceneDomainFrame({
		frame,
		transitionPortalMasks,
	}: {
		frame: ReturnType<typeof buildWorldRenderFrame>;
		transitionPortalMasks: readonly Webgl2TransitionPortalMaskResource[];
	}): Webgl2WorldSubmitMetrics {
		if (!resources) {
			return createEmptyWebgl2WorldSubmitMetrics();
		}
		const currentResources = resources;
		const targets = profileBrowserJsScope(
			"webgl2.sceneDomain.syncSceneTargets",
			() => syncSceneDomainTargets(currentResources),
		);
		const compositeTargets = profileBrowserJsScope(
			"webgl2.sceneDomain.syncCompositeTargets",
			() => syncPortalCompositeTargets(currentResources),
		);
		const visibleTerrainTiles = profileBrowserJsScope(
			"webgl2.sceneDomain.planVisibleTerrainTiles",
			() =>
				planWebgl2TerrainTileSubmitOrder(
					frame,
					currentResources.worldStore.terrainTilesById,
				),
		);
		const visibleStaticBundleLayers = profileBrowserJsScope(
			"webgl2.sceneDomain.planVisibleStaticBundleLayers",
			() =>
				planWebgl2StaticBundleLayerSubmitOrder(
					frame,
					currentResources.worldStore.staticBundleLayerResources,
				),
		);
		const baseScene = deriveWebgl2BaseSceneDomainFromResidency(
			latestCameraResidencyContext,
		);
		const transitionLevels = deriveTransitionPortalRenderLevels({
			baseScene,
			maxDepth: transitionPortalMaxDepth,
		});
		latestBaseSceneDomain = baseScene;
		const portalWorkPlan = profileBrowserJsScope(
			"webgl2.sceneDomain.planTransitionPortals",
			() =>
				planWebgl2TransitionPortalWork({
					transitionPortalModel,
					visibleTransitionPortalMasks: transitionPortalMasks,
					renderChunkTransforms,
					cameraPosition: frameCameraPosition(),
					viewProjectionMatrix: frame.viewProjectionMatrix,
					viewport: { width: canvas.width, height: canvas.height },
					baseScene,
					initialEnvCellId: deriveWebgl2InitialPortalEnvCellId(
						latestCameraResidencyContext,
					),
					levels: transitionLevels,
				}),
		);
		latestPortalWorkPlan = portalWorkPlan;
		const exteriorMetrics = profileBrowserJsScope(
			"webgl2.sceneDomain.renderExterior",
			() =>
				renderSceneDomainTarget({
					target: targets.exterior,
					staticBundleLayers: visibleStaticBundleLayers,
					terrainTiles: visibleTerrainTiles,
					frame,
					terrainBackfaceCulling: baseScene === "interior",
				}),
		);
		const interiorMetrics = profileBrowserJsScope(
			"webgl2.sceneDomain.renderInterior",
			() =>
				renderSceneDomainTarget({
					target: targets.interior,
					staticBundleLayers: [],
					terrainTiles: [],
					frame,
					terrainBackfaceCulling: false,
				}),
		);
		const baseTarget =
			baseScene === "interior" ? targets.interior : targets.exterior;

		profileBrowserJsScope("webgl2.sceneDomain.copyBaseTarget", () => {
			copySceneDomainTargetToFramebuffer(baseTarget, compositeTargets.read);
		});
		const portalCompositeMetrics = profileBrowserJsScope(
			"webgl2.sceneDomain.compositeTransitionPortals",
			() =>
				compositeTransitionPortals({
					frame,
					targets,
					compositeTargets,
					transitionLevels,
					workPlan: portalWorkPlan,
					transitionPortalMasksById:
						currentResources.worldStore.transitionPortalMasksById,
				}),
		);
		profileBrowserJsScope("webgl2.sceneDomain.copyFinalTarget", () =>
			copySceneDomainTargetToDefaultFramebuffer(
				portalCompositeMetrics.finalTarget,
			),
		);

		latestSceneDomainFrameMetrics = {
			width: targets.width,
			height: targets.height,
			exteriorDrawCallCount: exteriorMetrics.drawCallCount,
			interiorDrawCallCount: interiorMetrics.drawCallCount,
			baseCopyPassCount: 1,
			transitionApertureMaskPassCount:
				portalCompositeMetrics.transitionApertureMaskPassCount,
			interiorCompositePassCount:
				portalCompositeMetrics.interiorCompositePassCount,
			exteriorCompositePassCount:
				portalCompositeMetrics.exteriorCompositePassCount,
			portalCompositeRectCount: portalCompositeMetrics.portalCompositeRectCount,
			portalCompositeEstimatedPixelArea:
				portalCompositeMetrics.portalCompositeEstimatedPixelArea,
			portalCompositeMaxDepth: portalCompositeMetrics.portalCompositeMaxDepth,
		};
		return mergeSceneDomainSubmitMetrics({
			exteriorMetrics,
			interiorMetrics,
			portalMaskResourceCount: transitionPortalMasks.length,
		});
	}

	function frameCameraPosition(): { x: number; y: number; z: number } {
		return resolveCameraFrame().position;
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

	function syncPortalCompositeTargets(
		currentResources: Webgl2RenderResources,
	): Webgl2PortalCompositeTargetSet {
		const existing = currentResources.portalCompositeTargets;
		if (
			existing &&
			existing.width === canvas.width &&
			existing.height === canvas.height
		) {
			return existing;
		}
		existing?.dispose();
		try {
			const targets = createWebgl2PortalCompositeTargetSet(
				currentResources.gl,
				{
					width: canvas.width,
					height: canvas.height,
				},
			);
			currentResources.portalCompositeTargets = targets;
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
		staticBundleLayers,
		terrainTiles,
		frame,
		terrainBackfaceCulling,
	}: {
		target: Webgl2SceneDomainTarget;
		staticBundleLayers: readonly Webgl2StaticBundleLayerResource[];
		terrainTiles: readonly Webgl2TerrainTileResource[];
		frame: ReturnType<typeof buildWorldRenderFrame>;
		terrainBackfaceCulling: boolean;
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
		stateCache.setDepthState({
			enabled: true,
			write: true,
			func: gl.LEQUAL,
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
		gl.clearColor(...WEBGL2_CLEAR_COLOR);
		gl.clearDepth(1);
		clearBoundFramebuffer({
			gl,
			color: true,
			depth: true,
			stencil: false,
			hasDepth: target.hasDepth,
			hasStencil: target.hasStencil,
		});
		return submitWebgl2WorldResources({
			gl,
			stateCache,
			program: resources.flatWorldProgram,
			texturedProgram: resources.texturedWorldProgram,
			terrainFamilyProgram: resources.terrainFamilyWorldProgram,
			indexedP8Program: resources.indexedP8WorldProgram,
			indexedP16Program: resources.indexedP16WorldProgram,
			viewProjectionMatrix: frame.viewProjectionMatrix,
			cameraPosition: frame.cameraFrame.position,
			staticBundleLayers,
			renderChunkTransforms,
			terrainTiles,
			terrainBackfaceCulling,
		});
	}

	function copySceneDomainTargetToDefaultFramebuffer(
		target: Webgl2ColorDepthTarget,
	): void {
		copyColorDepthTarget({
			sourceTarget: target,
			destinationFramebuffer: null,
			width: canvas.width,
			height: canvas.height,
			clearStencil: false,
			depthCopyMode: "shader",
		});
	}

	function copySceneDomainTargetToFramebuffer(
		sourceTarget: Webgl2ColorDepthTarget,
		destinationTarget: Webgl2PortalCompositeTarget,
	): void {
		copyColorDepthTarget({
			sourceTarget,
			destinationTarget,
			destinationFramebuffer: destinationTarget.framebuffer,
			width: destinationTarget.width,
			height: destinationTarget.height,
			clearStencil: true,
			depthCopyMode: "blit",
		});
	}

	function copyPortalCompositeTargetToFramebuffer(
		sourceTarget: Webgl2PortalCompositeTarget,
		destinationTarget: Webgl2PortalCompositeTarget,
	): void {
		copySceneDomainTargetToFramebuffer(sourceTarget, destinationTarget);
		copyPortalStencilBuffer({
			sourceTarget,
			destinationTarget,
		});
	}

	function copyPortalStencilBuffer({
		sourceTarget,
		destinationTarget,
	}: {
		sourceTarget: Webgl2PortalCompositeTarget;
		destinationTarget: Webgl2PortalCompositeTarget;
	}): void {
		if (!resources) {
			return;
		}
		const { gl } = resources;
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceTarget.framebuffer);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destinationTarget.framebuffer);
		gl.blitFramebuffer(
			0,
			0,
			sourceTarget.width,
			sourceTarget.height,
			0,
			0,
			destinationTarget.width,
			destinationTarget.height,
			gl.STENCIL_BUFFER_BIT,
			gl.NEAREST,
		);
		resources.stateCache.invalidate();
	}

	function copyColorDepthTarget({
		sourceTarget,
		destinationTarget,
		destinationFramebuffer,
		width,
		height,
		clearStencil,
		depthCopyMode,
	}: {
		sourceTarget: Webgl2ColorDepthTarget;
		destinationTarget?: Webgl2ColorDepthTarget;
		destinationFramebuffer: WebGLFramebuffer | null;
		width: number;
		height: number;
		clearStencil: boolean;
		depthCopyMode: "shader" | "blit";
	}): void {
		if (!resources) {
			return;
		}
		const { gl, stateCache } = resources;
		stateCache.bindFramebuffer(destinationFramebuffer);
		stateCache.setViewport({
			x: 0,
			y: 0,
			width,
			height,
		});
		clearBoundFramebuffer({
			gl,
			color: false,
			depth: false,
			stencil: clearStencil,
			hasDepth: destinationTarget?.hasDepth ?? false,
			hasStencil: destinationTarget?.hasStencil ?? false,
		});
		stateCache.setDepthState(
			depthCopyMode === "shader"
				? {
						enabled: true,
						write: true,
						func: gl.ALWAYS,
					}
				: {
						enabled: false,
						write: false,
						func: gl.ALWAYS,
					},
		);
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
		stateCache.bindTexture2D(0, sourceTarget.colorTexture);
		stateCache.bindTexture2D(1, sourceTarget.depthTexture);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		if (depthCopyMode === "blit") {
			if (!destinationTarget) {
				throw new Error(
					"WebGL2 depth blit copy requires a destination target.",
				);
			}
			copyDepthBuffer({
				sourceTarget,
				destinationTarget,
			});
		}
	}

	function copyDepthBuffer({
		sourceTarget,
		destinationTarget,
	}: {
		sourceTarget: Webgl2ColorDepthTarget;
		destinationTarget: Webgl2ColorDepthTarget;
	}): void {
		if (!resources) {
			return;
		}
		const { gl } = resources;
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceTarget.framebuffer);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destinationTarget.framebuffer);
		gl.blitFramebuffer(
			0,
			0,
			sourceTarget.width,
			sourceTarget.height,
			0,
			0,
			destinationTarget.width,
			destinationTarget.height,
			gl.DEPTH_BUFFER_BIT,
			gl.NEAREST,
		);
		resources.stateCache.invalidate();
	}

	function compositeTransitionPortals({
		frame,
		targets,
		compositeTargets,
		transitionLevels,
		workPlan,
		transitionPortalMasksById,
	}: {
		frame: ReturnType<typeof buildWorldRenderFrame>;
		targets: Webgl2SceneDomainTargetSet;
		compositeTargets: Webgl2PortalCompositeTargetSet;
		transitionLevels: readonly TransitionPortalRenderLevel[];
		workPlan: Webgl2TransitionPortalWorkPlan;
		transitionPortalMasksById: ReadonlyMap<
			string,
			Webgl2TransitionPortalMaskResource
		>;
	}): Omit<
		Webgl2SceneDomainFrameMetrics,
		| "width"
		| "height"
		| "exteriorDrawCallCount"
		| "interiorDrawCallCount"
		| "baseCopyPassCount"
	> & { finalTarget: Webgl2PortalCompositeTarget } {
		const metrics = {
			transitionApertureMaskPassCount: 0,
			interiorCompositePassCount: 0,
			exteriorCompositePassCount: 0,
			portalCompositeRectCount: 0,
			portalCompositeEstimatedPixelArea: 0,
			portalCompositeMaxDepth: 0,
		};
		let currentTarget = compositeTargets.read;
		let nextTarget = compositeTargets.write;
		for (const level of transitionLevels) {
			const batch =
				workPlan.batches.get(transitionPortalDepthBatchKey(level)) ?? [];
			if (batch.length === 0) {
				break;
			}
			copyPortalCompositeTargetToFramebuffer(currentTarget, nextTarget);
			const sourceTarget =
				level.compositeScene === "interior"
					? targets.interior
					: targets.exterior;
			drawTransitionPortalMaskBatch({
				frame,
				level,
				batch,
				destinationTarget: nextTarget,
				transitionPortalMasksById,
			});
			metrics.transitionApertureMaskPassCount += 1;
			compositeTransitionPortalBatch({
				sourceTarget,
				destinationTarget: nextTarget,
				stencilRef: level.stencilRef,
				batch,
			});
			if (level.compositeScene === "interior") {
				metrics.interiorCompositePassCount += 1;
			} else {
				metrics.exteriorCompositePassCount += 1;
			}
			metrics.portalCompositeRectCount += batch.length;
			metrics.portalCompositeEstimatedPixelArea += batch.reduce(
				(total, work) => total + work.screenAreaPx,
				0,
			);
			metrics.portalCompositeMaxDepth = level.recursionDepth;
			[currentTarget, nextTarget] = [nextTarget, currentTarget];
		}
		resources?.stateCache.setStencilState({
			enabled: false,
			writeMask: 0xff,
			func: resources.gl.ALWAYS,
			ref: 0,
			readMask: 0xff,
			fail: resources.gl.KEEP,
			zfail: resources.gl.KEEP,
			zpass: resources.gl.KEEP,
		});
		return { ...metrics, finalTarget: currentTarget };
	}

	function drawTransitionPortalMaskBatch({
		frame,
		level,
		batch,
		destinationTarget,
		transitionPortalMasksById,
	}: {
		frame: ReturnType<typeof buildWorldRenderFrame>;
		level: TransitionPortalRenderLevel;
		batch: readonly Webgl2VisibleTransitionPortalWork[];
		destinationTarget: Webgl2PortalCompositeTarget;
		transitionPortalMasksById: ReadonlyMap<
			string,
			Webgl2TransitionPortalMaskResource
		>;
	}): void {
		if (!resources) {
			return;
		}
		const { gl, stateCache } = resources;
		stateCache.bindFramebuffer(destinationTarget.framebuffer);
		stateCache.setViewport({
			x: 0,
			y: 0,
			width: destinationTarget.width,
			height: destinationTarget.height,
		});
		gl.colorMask(false, false, false, false);
		try {
			stateCache.setDepthState({
				enabled: true,
				write: false,
				func: gl.LEQUAL,
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
				enabled: true,
				writeMask: 0xff,
				func: level.parentStencilRef === null ? gl.ALWAYS : gl.EQUAL,
				ref: level.parentStencilRef ?? level.stencilRef,
				readMask: 0xff,
				fail: gl.KEEP,
				zfail: gl.KEEP,
				zpass: level.parentStencilRef === null ? gl.REPLACE : gl.INCR,
			});
			stateCache.useProgram(resources.flatWorldProgram.program);
			gl.uniform4fv(
				resources.flatWorldProgram.uniforms.uColor,
				new Float32Array([1, 1, 1, 1]),
			);
			const modelViewProjection = new Float32Array(16);
			for (const work of batch) {
				const mask = transitionPortalMasksById.get(work.maskResourceId);
				if (!mask) {
					continue;
				}
				const modelMatrix = resolveTransitionPortalMaskModelMatrix({
					mask,
					renderChunkTransforms,
				});
				if (!modelMatrix) {
					continue;
				}
				multiplyMat4Into(
					modelViewProjection,
					frame.viewProjectionMatrix,
					modelMatrix,
				);
				gl.uniformMatrix4fv(
					resources.flatWorldProgram.uniforms.uModelViewProjection,
					false,
					modelViewProjection,
				);
				stateCache.bindVertexArray(mask.vertexArray.vertexArray);
				gl.drawElements(gl.TRIANGLES, mask.vertexCount, mask.indexType, 0);
			}
		} finally {
			gl.colorMask(true, true, true, true);
		}
	}

	function compositeTransitionPortalBatch({
		sourceTarget,
		destinationTarget,
		stencilRef,
		batch,
	}: {
		sourceTarget: Webgl2SceneDomainTarget;
		destinationTarget: Webgl2PortalCompositeTarget;
		stencilRef: number;
		batch: readonly Webgl2VisibleTransitionPortalWork[];
	}): void {
		if (!resources || batch.length === 0) {
			return;
		}
		const { gl, stateCache } = resources;
		stateCache.bindFramebuffer(destinationTarget.framebuffer);
		stateCache.setViewport({
			x: 0,
			y: 0,
			width: destinationTarget.width,
			height: destinationTarget.height,
		});
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
		stateCache.setStencilState({
			enabled: true,
			writeMask: 0x00,
			func: gl.EQUAL,
			ref: stencilRef,
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
		stateCache.bindTexture2D(0, sourceTarget.colorTexture);
		stateCache.bindTexture2D(1, sourceTarget.depthTexture);
		gl.enable(gl.SCISSOR_TEST);
		try {
			for (const work of batch) {
				gl.scissor(
					work.screenRect.x,
					canvas.height - work.screenRect.y - work.screenRect.height,
					work.screenRect.width,
					work.screenRect.height,
				);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			}
		} finally {
			gl.disable(gl.SCISSOR_TEST);
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
		resources.flatWorldProgram.dispose();
		resources.texturedWorldProgram.dispose();
		resources.indexedP8WorldProgram.dispose();
		resources.indexedP16WorldProgram.dispose();
		resources.terrainFamilyWorldProgram.dispose();
		resources.sceneDomainCopyProgram.dispose();
		resources.sceneDomainCopyVertexArray.dispose();
		resources.sceneDomainTargets?.dispose();
		resources.portalCompositeTargets?.dispose();
		resources.selectedStaticRenderableOverlay?.dispose();
		resources.texturePagePreviewProgram.dispose();
		resources.texturePagePreviewVertexArray.dispose();
		destroyWebgl2WorldResources(resources.worldStore);
		resources = null;
	}

	function disposeSelectedStaticRenderableOverlay(): void {
		if (!resources?.selectedStaticRenderableOverlay) {
			return;
		}
		resources.selectedStaticRenderableOverlay.dispose();
		resources.selectedStaticRenderableOverlay = null;
		resources.stateCache.invalidate();
	}

	function pickStaticProductAtViewportPoint(
		viewportPoint: NormalizedViewportPoint,
		mask: ReadonlySet<RenderSpatialItemKind>,
		ownerKeys?: ReadonlySet<string>,
	): RenderSpatialPick | null {
		const cameraFrame = resolveCameraFrame();
		return staticProductMetadata.spatialQuery.pickRay(
			buildSceneCameraRenderRay(cameraFrame, viewportPoint),
			mask,
			ownerKeys,
		);
	}

	function syncResidencyIndex(): void {
		residencyIndex =
			buildWorldResidencyIndexFromLandblockArtifacts({
				artifacts: staticLandblockRenderProducts,
				renderChunkTransforms,
				sceneContext: renderSceneContext,
			}) ??
			buildWorldResidencyIndex({
				cells: structuredInteriorScene.cells,
				renderChunkTransforms,
				sceneContext: renderSceneContext,
			});
		updateCameraResidency(resolveCameraFrame().position);
	}

	function updateCameraResidency(position: {
		x: number;
		y: number;
		z: number;
	}): void {
		const result = residencyIndex.queryDetailed(position);
		latestCameraResidencyContext = result.context;
		latestCameraResidencyDiagnostics = result.diagnostics;
		latestBaseSceneDomain = deriveWebgl2BaseSceneDomainFromResidency(
			result.context,
		);
		reportCameraResidency();
	}

	function reportCameraResidency(): void {
		if (!cameraResidencyChangeHandler) {
			return;
		}
		const residency = deriveBrowserCameraResidency(
			latestCameraResidencyContext,
			latestCameraResidencyDiagnostics,
		);
		const residencyKey = describeWebgl2BrowserCameraResidencyKey(residency);
		if (residencyKey === latestCameraResidencyKey) {
			return;
		}
		latestCameraResidencyKey = residencyKey;
		cameraResidencyChangeHandler(residency);
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
		const metricsCameraFrame = resolveCameraFrame();
		renderMetricsChangeHandler?.(
			createWebgl2RenderMetrics({
				terrainScene: emptyTerrainScene,
				staticRenderableScene,
				structuredInteriorScene,
				transitionPortalModel,
				cameraFrame: controlledCameraFrame,
				canvasWidth: canvas.width,
				canvasHeight: canvas.height,
				pixelRatio: window.devicePixelRatio || 1,
				cameraViewResidency: describeCameraViewResidencyContext(
					latestCameraResidencyContext,
				),
				residencyCellCount: residencyIndex.cellCount,
				residencyLandblockCount: residencyIndex.landblockCount,
				residencyAabbCandidateCount:
					latestCameraResidencyDiagnostics.aabbCandidateCount,
				residencyCellBspMatchCount:
					latestCameraResidencyDiagnostics.cellBspMatchCount,
				residencyAabbFallbackCount:
					latestCameraResidencyDiagnostics.aabbFallbackCount,
				residencySource: latestCameraResidencyDiagnostics.source,
				resourcePolicy: initializationError
					? "webgl2-initialization-failed"
					: resources
						? hasWebgl2ProductResources(resources.worldStore)
							? "webgl2-product-resources"
							: "webgl2-test-frame"
						: "webgl2-initializing",
				baseSceneDomain: latestBaseSceneDomain,
				transitionPortalMaxDepth,
				cameraNear: metricsCameraFrame.near,
				cameraFar: metricsCameraFrame.far,
				cameraFarNearRatio:
					metricsCameraFrame.near > 0
						? metricsCameraFrame.far / metricsCameraFrame.near
						: null,
				clearCount,
				drawCallCount,
				lastFrameDrawCount,
				initializationError,
				worldStore: resources?.worldStore ?? null,
				frameMetrics: latestFrameMetrics,
				submitMetrics: latestSubmitMetrics,
				portalRenderWorkItemCandidateCount:
					transitionPortalModel.diagnostics.workItemCandidateCount,
				visiblePortalWorkItemCount:
					latestPortalWorkPlan?.visibleWorkItems.length ?? 0,
				maskedInteriorCellCount:
					latestPortalWorkPlan?.maskedInteriorCellIds.size ?? 0,
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
				transitionApertureMaskPassCount:
					latestSceneDomainFrameMetrics?.transitionApertureMaskPassCount ?? 0,
				interiorCompositePassCount:
					latestSceneDomainFrameMetrics?.interiorCompositePassCount ?? 0,
				exteriorCompositePassCount:
					latestSceneDomainFrameMetrics?.exteriorCompositePassCount ?? 0,
				portalCompositeRectCount:
					latestSceneDomainFrameMetrics?.portalCompositeRectCount ?? 0,
				portalCompositeEstimatedPixelArea:
					latestSceneDomainFrameMetrics?.portalCompositeEstimatedPixelArea ?? 0,
				portalCompositeMaxDepth:
					latestSceneDomainFrameMetrics?.portalCompositeMaxDepth ?? 0,
				performance: latestPerformanceMetrics,
				textureFilteringMode,
				detailTexturesEnabled,
				sceneBounds: latestSceneBounds,
			}),
		);
	}

	function previewWebgl2TexturePage(
		identity: RenderResourceTexturePageIdentity,
	): RenderResourceTexturePagePreview | null {
		if (!resources) {
			return null;
		}
		const page = resolveInspectableTexturePageResource(
			resources.worldStore,
			identity,
		);
		if (!page) {
			return null;
		}
		const coverage = calculateTexturePageCoverage({
			width: page.texture.width,
			height: page.texture.height,
			rects: page.entries.map((entry) => entry.rect),
		});
		return {
			identity,
			key: page.key,
			bucket: page.bucket,
			sampleClass: page.sampleClass,
			pageKind: page.pageKind,
			indexedFormat: page.indexedFormat ?? null,
			width: page.texture.width,
			height: page.texture.height,
			coveredPixelCount: coverage.coveredPixelCount,
			coverageRatio: coverage.coverageRatio,
			pixels: readTexturePagePreviewPixels(resources, page),
			entries: page.entries.map((entry) => ({
				sourcePlacementKey: entry.sourcePlacementKey,
				virtualRefKey: entry.virtualRefKey,
				virtualRefKeys: entry.virtualRefKeys,
				sourceAssetId: entry.sourceAssetId,
				rect: entry.rect,
			})),
		};
	}

	function readTexturePagePreviewPixels(
		currentResources: Webgl2RenderResources,
		page: Webgl2ResidentTexturePageResource,
	): Uint8ClampedArray<ArrayBuffer> {
		const { gl, stateCache } = currentResources;
		const previousViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
		const framebuffer = gl.createFramebuffer();
		const colorTexture = gl.createTexture();
		if (!framebuffer || !colorTexture) {
			if (framebuffer) {
				gl.deleteFramebuffer(framebuffer);
			}
			if (colorTexture) {
				gl.deleteTexture(colorTexture);
			}
			throw new Error(`Failed to create texture preview target for ${page.key}.`);
		}

		try {
			stateCache.bindVertexArray(null);
			gl.bindTexture(gl.TEXTURE_2D, colorTexture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texStorage2D(
				gl.TEXTURE_2D,
				1,
				gl.RGBA8,
				page.texture.width,
				page.texture.height,
			);
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
			gl.framebufferTexture2D(
				gl.FRAMEBUFFER,
				gl.COLOR_ATTACHMENT0,
				gl.TEXTURE_2D,
				colorTexture,
				0,
			);
			const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
			if (status !== gl.FRAMEBUFFER_COMPLETE) {
				throw new Error(
					`Texture preview framebuffer for ${page.key} is incomplete: 0x${status.toString(16)}.`,
				);
			}

			gl.viewport(0, 0, page.texture.width, page.texture.height);
			gl.disable(gl.BLEND);
			gl.disable(gl.CULL_FACE);
			gl.disable(gl.DEPTH_TEST);
			gl.disable(gl.SCISSOR_TEST);
			gl.disable(gl.STENCIL_TEST);
			stateCache.useProgram(currentResources.texturePagePreviewProgram.program);
			stateCache.bindVertexArray(
				currentResources.texturePagePreviewVertexArray.vertexArray,
			);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, page.texture.texture);
			gl.uniform1i(
				currentResources.texturePagePreviewProgram.uniforms.uTexture,
				0,
			);
			gl.uniform1i(
				currentResources.texturePagePreviewProgram.uniforms.uPreviewMode,
				resolveTexturePagePreviewMode(page),
			);
			gl.drawArrays(gl.TRIANGLES, 0, 3);

			const pixels = new Uint8Array(page.texture.width * page.texture.height * 4);
			gl.readPixels(
				0,
				0,
				page.texture.width,
				page.texture.height,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				pixels,
			);
			return new Uint8ClampedArray(pixels);
		} finally {
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.bindTexture(gl.TEXTURE_2D, null);
			gl.viewport(
				previousViewport[0] ?? 0,
				previousViewport[1] ?? 0,
				previousViewport[2] ?? canvas.width,
				previousViewport[3] ?? canvas.height,
			);
			gl.deleteTexture(colorTexture);
			gl.deleteFramebuffer(framebuffer);
			stateCache.invalidate();
		}
	}

	function resolveTexturePagePreviewMode(
		page: Webgl2ResidentTexturePageResource,
	): number {
		if (page.sampleClass === "control-data" || page.indexedFormat === "p8") {
			return 1;
		}
		if (page.indexedFormat === "index16") {
			return 2;
		}
		return 0;
	}

	function resolveInspectableTexturePageResource(
		store: Webgl2WorldResourceStore,
		identity: RenderResourceTexturePageIdentity,
	): Webgl2ResidentTexturePageResource | null {
		if (
			identity.ownerKind === RENDER_RESOURCE_INSPECTION_OWNER_KIND.staticBundle
		) {
			return (
				store.staticBundleLayerResources.layersByKey
					.get(identity.ownerKey)
					?.texturePagesByKey.get(identity.texturePageKey) ?? null
			);
		}
		if (
			identity.ownerKind ===
			RENDER_RESOURCE_INSPECTION_OWNER_KIND.structuredInterior
		) {
			return (
				store.structuredInteriorResources.productsByKey
					.get(identity.ownerKey)
					?.texturePagesByKey.get(identity.texturePageKey) ?? null
			);
		}
		if (identity.ownerKind === RENDER_RESOURCE_INSPECTION_OWNER_KIND.terrain) {
			return (
				store.productTerrainTexturePagesByKey.get(identity.texturePageKey) ??
				null
			);
		}
		const exhaustiveOwnerKind: never = identity.ownerKind;
		throw new Error(
			`Unhandled inspectable texture page owner kind: ${exhaustiveOwnerKind}`,
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
	portalMaskResourceCount,
}: {
	exteriorMetrics: Webgl2WorldSubmitMetrics;
	interiorMetrics: Webgl2WorldSubmitMetrics;
	portalMaskResourceCount: number;
}): Webgl2WorldSubmitMetrics {
	return {
		visibleTerrainTileCount:
			exteriorMetrics.visibleTerrainTileCount +
			interiorMetrics.visibleTerrainTileCount,
		visibleTerrainOneDrawReadyTileCount:
			exteriorMetrics.visibleTerrainOneDrawReadyTileCount +
			interiorMetrics.visibleTerrainOneDrawReadyTileCount,
		visibleTerrainOneDrawBlockedTileCount:
			exteriorMetrics.visibleTerrainOneDrawBlockedTileCount +
			interiorMetrics.visibleTerrainOneDrawBlockedTileCount,
		visibleTerrainDrawSliceReadyCount:
			exteriorMetrics.visibleTerrainDrawSliceReadyCount +
			interiorMetrics.visibleTerrainDrawSliceReadyCount,
		terrainOneDrawShaderDrawCallCount:
			exteriorMetrics.terrainOneDrawShaderDrawCallCount +
			interiorMetrics.terrainOneDrawShaderDrawCallCount,
		terrainOneDrawSubmittedTileCount:
			exteriorMetrics.terrainOneDrawSubmittedTileCount +
			interiorMetrics.terrainOneDrawSubmittedTileCount,
		terrainDrawSliceSubmittedCount:
			exteriorMetrics.terrainDrawSliceSubmittedCount +
			interiorMetrics.terrainDrawSliceSubmittedCount,
		terrainOneDrawSubmittedTriangleCount:
			exteriorMetrics.terrainOneDrawSubmittedTriangleCount +
			interiorMetrics.terrainOneDrawSubmittedTriangleCount,
		terrainOneDrawBlockerSamples: [
			...exteriorMetrics.terrainOneDrawBlockerSamples,
			...interiorMetrics.terrainOneDrawBlockerSamples,
		].slice(0, 8),
		terrainOneDrawSubmitFallbackSamples: [
			...exteriorMetrics.terrainOneDrawSubmitFallbackSamples,
			...interiorMetrics.terrainOneDrawSubmitFallbackSamples,
		].slice(0, 8),
		portalMaskResourceCount,
		submittedTerrainTileCount:
			exteriorMetrics.submittedTerrainTileCount +
			interiorMetrics.submittedTerrainTileCount,
		terrainSubmittedTriangleCount:
			exteriorMetrics.terrainSubmittedTriangleCount +
			interiorMetrics.terrainSubmittedTriangleCount,
		drawCallCount:
			exteriorMetrics.drawCallCount + interiorMetrics.drawCallCount + 1,
		programSwitchCount:
			exteriorMetrics.programSwitchCount +
			interiorMetrics.programSwitchCount +
			1,
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
		triangleCount:
			exteriorMetrics.triangleCount + interiorMetrics.triangleCount,
		staticBundleLayerSubmittedCount:
			exteriorMetrics.staticBundleLayerSubmittedCount +
			interiorMetrics.staticBundleLayerSubmittedCount,
		visibleStaticBundleLayerCount:
			exteriorMetrics.visibleStaticBundleLayerCount +
			interiorMetrics.visibleStaticBundleLayerCount,
		staticBundleSelectedObjectRecordCount:
			exteriorMetrics.staticBundleSelectedObjectRecordCount +
			interiorMetrics.staticBundleSelectedObjectRecordCount,
		staticBundleSelectedSpatialHintCount:
			exteriorMetrics.staticBundleSelectedSpatialHintCount +
			interiorMetrics.staticBundleSelectedSpatialHintCount,
		staticBundleSelectedSourceObjectCount:
			exteriorMetrics.staticBundleSelectedSourceObjectCount +
			interiorMetrics.staticBundleSelectedSourceObjectCount,
		staticBundleSelectedCompactedBatchCount:
			exteriorMetrics.staticBundleSelectedCompactedBatchCount +
			interiorMetrics.staticBundleSelectedCompactedBatchCount,
		staticBundleSelectedDirectEntryCount:
			exteriorMetrics.staticBundleSelectedDirectEntryCount +
			interiorMetrics.staticBundleSelectedDirectEntryCount,
		staticBundleSelectedNoGeometryLayerCount:
			exteriorMetrics.staticBundleSelectedNoGeometryLayerCount +
			interiorMetrics.staticBundleSelectedNoGeometryLayerCount,
		staticBundleSelectedUnsubmittedLayerCount:
			exteriorMetrics.staticBundleSelectedUnsubmittedLayerCount +
			interiorMetrics.staticBundleSelectedUnsubmittedLayerCount,
		staticBundleSelectedMissingMaterialGeometryCount:
			exteriorMetrics.staticBundleSelectedMissingMaterialGeometryCount +
			interiorMetrics.staticBundleSelectedMissingMaterialGeometryCount,
		staticBundleBuilderSkippedSurfaceCount:
			exteriorMetrics.staticBundleBuilderSkippedSurfaceCount +
			interiorMetrics.staticBundleBuilderSkippedSurfaceCount,
		staticBundleBuilderSkippedReasonCounts: sumNumberRecords(
			exteriorMetrics.staticBundleBuilderSkippedReasonCounts,
			interiorMetrics.staticBundleBuilderSkippedReasonCounts,
		),
		staticBundleGeometryCandidateTriangleCount:
			exteriorMetrics.staticBundleGeometryCandidateTriangleCount +
			interiorMetrics.staticBundleGeometryCandidateTriangleCount,
		staticBundleSelectedLayerCoverageSamples: [
			...exteriorMetrics.staticBundleSelectedLayerCoverageSamples,
			...interiorMetrics.staticBundleSelectedLayerCoverageSamples,
		].slice(0, 16),
		staticBundleGeometryCandidateCount:
			exteriorMetrics.staticBundleGeometryCandidateCount +
			interiorMetrics.staticBundleGeometryCandidateCount,
		staticBundleMaterialRecordCount:
			exteriorMetrics.staticBundleMaterialRecordCount +
			interiorMetrics.staticBundleMaterialRecordCount,
		staticBundleMaterialFamilyCounts: sumNumberRecords(
			exteriorMetrics.staticBundleMaterialFamilyCounts,
			interiorMetrics.staticBundleMaterialFamilyCounts,
		),
		staticBundleMaterialAlphaPolicyCounts: sumNumberRecords(
			exteriorMetrics.staticBundleMaterialAlphaPolicyCounts,
			interiorMetrics.staticBundleMaterialAlphaPolicyCounts,
		),
		staticBundleMaterialBindingUsageCounts: sumNumberRecords(
			exteriorMetrics.staticBundleMaterialBindingUsageCounts,
			interiorMetrics.staticBundleMaterialBindingUsageCounts,
		),
		staticBundleMaterialBaseColorBindingCount:
			exteriorMetrics.staticBundleMaterialBaseColorBindingCount +
			interiorMetrics.staticBundleMaterialBaseColorBindingCount,
		staticBundleMaterialIndexedBindingCount:
			exteriorMetrics.staticBundleMaterialIndexedBindingCount +
			interiorMetrics.staticBundleMaterialIndexedBindingCount,
		materialSurfaceSubmittedCount:
			exteriorMetrics.materialSurfaceSubmittedCount +
			interiorMetrics.materialSurfaceSubmittedCount,
		materialSurfaceSubmittedCountsByDomain: sumNumberRecords(
			exteriorMetrics.materialSurfaceSubmittedCountsByDomain,
			interiorMetrics.materialSurfaceSubmittedCountsByDomain,
		),
		materialSurfaceDrawCallCountsByDomain: sumNumberRecords(
			exteriorMetrics.materialSurfaceDrawCallCountsByDomain,
			interiorMetrics.materialSurfaceDrawCallCountsByDomain,
		),
		materialSurfaceTriangleCountsByDomain: sumNumberRecords(
			exteriorMetrics.materialSurfaceTriangleCountsByDomain,
			interiorMetrics.materialSurfaceTriangleCountsByDomain,
		),
		materialSurfaceSkippedCount:
			exteriorMetrics.materialSurfaceSkippedCount +
			interiorMetrics.materialSurfaceSkippedCount,
		materialSurfaceSkippedCountsByDomain: sumNumberRecords(
			exteriorMetrics.materialSurfaceSkippedCountsByDomain,
			interiorMetrics.materialSurfaceSkippedCountsByDomain,
		),
		materialSurfaceSubmittedAlphaPolicyCounts: sumNumberRecords(
			exteriorMetrics.materialSurfaceSubmittedAlphaPolicyCounts,
			interiorMetrics.materialSurfaceSubmittedAlphaPolicyCounts,
		),
		materialSurfaceSkippedReasonCounts: sumNumberRecords(
			exteriorMetrics.materialSurfaceSkippedReasonCounts,
			interiorMetrics.materialSurfaceSkippedReasonCounts,
		),
		materialSurfaceSkippedFamilyCounts: sumNumberRecords(
			exteriorMetrics.materialSurfaceSkippedFamilyCounts,
			interiorMetrics.materialSurfaceSkippedFamilyCounts,
		),
		materialSurfaceSkippedAlphaPolicyCounts: sumNumberRecords(
			exteriorMetrics.materialSurfaceSkippedAlphaPolicyCounts,
			interiorMetrics.materialSurfaceSkippedAlphaPolicyCounts,
		),
		materialSurfaceSkippedBindingUsageCounts: sumNumberRecords(
			exteriorMetrics.materialSurfaceSkippedBindingUsageCounts,
			interiorMetrics.materialSurfaceSkippedBindingUsageCounts,
		),
		materialSurfaceSubmitFallbackSamples: [
			...exteriorMetrics.materialSurfaceSubmitFallbackSamples,
			...interiorMetrics.materialSurfaceSubmitFallbackSamples,
		].slice(0, 16),
		structuredInteriorShellSubmittedCount:
			exteriorMetrics.structuredInteriorShellSubmittedCount +
			interiorMetrics.structuredInteriorShellSubmittedCount,
		structuredInteriorShellDrawCallCount:
			exteriorMetrics.structuredInteriorShellDrawCallCount +
			interiorMetrics.structuredInteriorShellDrawCallCount,
		structuredInteriorShellTriangleCount:
			exteriorMetrics.structuredInteriorShellTriangleCount +
			interiorMetrics.structuredInteriorShellTriangleCount,
	};
}

function sumNumberRecords(
	left: Readonly<Record<string, number>>,
	right: Readonly<Record<string, number>>,
): Record<string, number> {
	const result: Record<string, number> = {};
	for (const [key, value] of Object.entries(left)) {
		result[key] = (result[key] ?? 0) + value;
	}
	for (const [key, value] of Object.entries(right)) {
		result[key] = (result[key] ?? 0) + value;
	}
	return result;
}

function describeWebgl2BrowserCameraResidencyKey(
	residency: BrowserCameraResidency,
): string {
	return [
		residency.kind,
		residency.landblockId ?? "none",
		residency.envCellId ?? "none",
		residency.source,
	].join(":");
}

function hasWebgl2ProductResources(store: Webgl2WorldResourceStore): boolean {
	return (
		store.staticBundleLayerResourceCount > 0 ||
		store.structuredInteriorResourceCount > 0 ||
		store.terrainTileCount > 0 ||
		store.transitionPortalMasks.length > 0
	);
}

function buildSelectedStaticRenderableBoundsLinePositions(
	bounds: PreparedBounds,
	matrix: RenderMat4,
): Float32Array {
	const corners = [
		{ x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
		{ x: bounds.max.x, y: bounds.min.y, z: bounds.min.z },
		{ x: bounds.min.x, y: bounds.max.y, z: bounds.min.z },
		{ x: bounds.max.x, y: bounds.max.y, z: bounds.min.z },
		{ x: bounds.min.x, y: bounds.min.y, z: bounds.max.z },
		{ x: bounds.max.x, y: bounds.min.y, z: bounds.max.z },
		{ x: bounds.min.x, y: bounds.max.y, z: bounds.max.z },
		{ x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
	].map((corner) => transformBoundsCorner(corner, matrix));
	const edgeCornerIndices = [
		0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 2, 6, 3, 7,
	];
	const positions = new Float32Array(
		edgeCornerIndices.length * BOUNDS_LINE_VERTEX_COMPONENTS,
	);
	for (
		let edgeIndex = 0;
		edgeIndex < edgeCornerIndices.length;
		edgeIndex += 1
	) {
		const corner = corners[edgeCornerIndices[edgeIndex]];
		const offset = edgeIndex * BOUNDS_LINE_VERTEX_COMPONENTS;
		positions[offset] = corner.x;
		positions[offset + 1] = corner.y;
		positions[offset + 2] = corner.z;
	}
	return positions;
}

function transformBoundsCorner(
	corner: PreparedBounds["min"],
	matrix: RenderMat4,
): PreparedBounds["min"] {
	return {
		x:
			matrix[0] * corner.x +
			matrix[4] * corner.y +
			matrix[8] * corner.z +
			matrix[12],
		y:
			matrix[1] * corner.x +
			matrix[5] * corner.y +
			matrix[9] * corner.z +
			matrix[13],
		z:
			matrix[2] * corner.x +
			matrix[6] * corner.y +
			matrix[10] * corner.z +
			matrix[14],
	};
}

function describeBoundsSignature(bounds: PreparedBounds): string {
	return [
		bounds.min.x,
		bounds.min.y,
		bounds.min.z,
		bounds.max.x,
		bounds.max.y,
		bounds.max.z,
	].join(",");
}

function describeMat4Signature(matrix: RenderMat4): string {
	return [...matrix].join(",");
}

function createWebgl2RenderResources(
	gl: WebGL2RenderingContext,
): Webgl2RenderResources {
	return {
		gl,
		stateCache: new Webgl2StateCache(gl),
		flatWorldProgram: createFlatWorldProgram(gl),
		texturedWorldProgram: createTexturedWorldProgram(gl),
		indexedP8WorldProgram: createIndexedP8WorldProgram(gl),
		indexedP16WorldProgram: createIndexedP16WorldProgram(gl),
		terrainFamilyWorldProgram: createWebgl2TerrainFamilyWorldProgram(gl),
		sceneDomainCopyProgram: createSceneDomainCopyProgram(gl),
		sceneDomainCopyVertexArray: createWebgl2VertexArray(gl, {
			label: "webgl2 scene-domain copy vertex array",
			configure() {
				return;
			},
		}),
		texturePagePreviewProgram: createTexturePagePreviewProgram(gl),
		texturePagePreviewVertexArray: createWebgl2VertexArray(gl, {
			label: "webgl2 texture-page preview vertex array",
			configure() {
				return;
			},
		}),
		sceneDomainTargets: null,
		portalCompositeTargets: null,
		selectedStaticRenderableOverlay: null,
		sceneDomainFramebufferFailureCount: 0,
		sceneDomainFramebufferFailureSamples: [],
		worldStore: createWebgl2WorldResourceStore(),
		materialTextureCapabilities: detectWebgl2MaterialTextureCapabilities(gl),
	};
}

function defaultFramebufferHasDepth(gl: WebGL2RenderingContext): boolean {
	return gl.getContextAttributes()?.depth === true;
}

function defaultFramebufferHasStencil(gl: WebGL2RenderingContext): boolean {
	return gl.getContextAttributes()?.stencil === true;
}

function clearBoundFramebuffer({
	gl,
	color,
	depth,
	stencil,
	hasDepth,
	hasStencil,
}: {
	gl: WebGL2RenderingContext;
	color: boolean;
	depth: boolean;
	stencil: boolean;
	hasDepth: boolean;
	hasStencil: boolean;
}): void {
	let mask = color ? gl.COLOR_BUFFER_BIT : 0;
	if (depth && hasDepth) {
		mask |= gl.DEPTH_BUFFER_BIT;
	}
	if (stencil && hasStencil) {
		mask |= gl.STENCIL_BUFFER_BIT;
	}
	if (mask !== 0) {
		gl.clear(mask);
	}
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
			"uAtlasEnabled",
			"uAtlasRect",
			"uAtlasSize",
			"uTexturePageWrapMode",
			"uDetailTexture",
			"uDetailTiling",
			"uDetailEnabled",
			"uDetailAtlasRect",
			"uDetailAtlasSize",
			"uDetailTexturePageWrapMode",
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
			"uIndexAtlasRect",
			"uPaletteAtlasRect",
			"uPaletteAtlasSize",
			"uClipThreshold",
			"uRepeatS",
			"uRepeatT",
			"uDetailTexture",
			"uDetailTiling",
			"uDetailEnabled",
			"uDetailAtlasRect",
			"uDetailAtlasSize",
			"uDetailTexturePageWrapMode",
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

function createTexturePagePreviewProgram(
	gl: WebGL2RenderingContext,
): Webgl2ProgramResource<never, "uTexture" | "uPreviewMode"> {
	return createWebgl2Program(gl, {
		label: "webgl2 texture-page preview",
		vertexSource: TEXTURE_PAGE_PREVIEW_VERTEX_SHADER,
		fragmentSource: TEXTURE_PAGE_PREVIEW_FRAGMENT_SHADER,
		uniforms: ["uTexture", "uPreviewMode"],
	});
}

function commitProductToSet(
	productSet: StaticLandblockRenderProductSet,
	result: LandblockRenderProductWorkerResult,
): StaticLandblockRenderProductSet {
	const nextProductKey = formatStaticLandblockProductKey(
		createStaticLandblockProductKeyFromResult(result),
	);
	const artifacts = productSet.artifacts.filter(
		(artifact) =>
			formatStaticLandblockProductKey(
				createStaticLandblockProductKeyFromResult(artifact),
			) !== nextProductKey,
	);
	return {
		...productSet,
		artifacts: [...artifacts, result],
		residentCount: artifacts.length + 1,
		committedResultCount: productSet.committedResultCount + 1,
	};
}

function createStaticBundleLayerRenderCandidates(
	products: StaticLandblockRenderProductSet,
): WorldRenderCandidate[] {
	return products.artifacts.flatMap((result) =>
		getStaticObjectBundleArtifacts(result).map((bundle) => {
			const bvhItemKeys = uniqueSortedStrings(
				bundle.objectRecords.flatMap((record) => record.visibilityKeys),
			);
			return {
				id: describeStaticBundleLayerResourceKey(bundle),
				kind: WORLD_RENDER_CANDIDATE_KIND.staticBundleLayer,
				bvhItemKeys,
				bvhFallbackReason:
					bvhItemKeys.length === 0
						? `static bundle layer ${bundle.key} contains no visibility keys`
						: null,
			};
		}),
	);
}

function uniqueSortedStrings(
	values: readonly RenderBvhItemKey[],
): RenderBvhItemKey[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function reportStaticProductCommitDiagnostics({
	result,
	enabledUploadFamilies,
	staticBundleLayers,
	durationMs,
	store,
}: {
	result: LandblockRenderProductWorkerResult;
	enabledUploadFamilies: ReadonlySet<RenderUploadDiagnosticFamily>;
	staticBundleLayers: readonly StaticObjectBundleArtifact[];
	durationMs: number;
	store: Webgl2WorldResourceStore;
}): void {
	logTemporaryRenderRegressionDiagnostic("webgl2-product-commit", {
		landblockId: result.landblockId,
		product: result.product,
		requestId: result.requestId,
		durationMs: roundMs(durationMs),
		uploadFilter: describeDiagnosticSet(
			readTemporaryRenderRegressionDiagnostics().uploadFilter,
		),
		enabledUploadFamilies: [...enabledUploadFamilies].sort(),
		resultShape: describeLandblockProductResultShape({
			result,
			staticBundleLayers,
		}),
		resourceShape: describeWebgl2ResourceShape(store),
	});
}

function describeLandblockProductResultShape({
	result,
	staticBundleLayers,
}: {
	result: LandblockRenderProductWorkerResult;
	staticBundleLayers: readonly StaticObjectBundleArtifact[];
}): Record<string, unknown> {
	const terrain = getLandblockTerrainRenderArtifact(result);
	const detailed = getDetailedLandblockRenderArtifacts(result);
	return {
		artifactCounts: countArtifactsByKind(result),
		staticBundleLayers: staticBundleLayers.length,
		staticBundleTexturePages: staticBundleLayers.reduce(
			(total, layer) => total + layer.texturePages.length,
			0,
		),
		staticBundleTextureBytes: staticBundleLayers.reduce(
			(total, layer) =>
				total +
				layer.texturePages.reduce(
					(layerTotal, page) => layerTotal + page.bytes.byteLength,
					0,
				),
			0,
		),
		staticBundleCompactedBatches: staticBundleLayers.reduce(
			(total, layer) => total + layer.compactedBatches.length,
			0,
		),
		staticBundleDirectEntries: staticBundleLayers.reduce(
			(total, layer) => total + layer.directEntries.length,
			0,
		),
		terrainTextureRefs: terrain?.texturePageRefs.length ?? 0,
		terrainTextureBytes:
			terrain?.texturePageRefs.reduce(
				(total, ref) => total + ref.bytes.byteLength,
				0,
			) ?? 0,
		terrainDrawSlices: terrain?.drawSlices.length ?? 0,
		terrainFallbackReasons:
			terrain?.diagnostics.fallbackReasons.slice(0, 8) ?? [],
		structuredInteriorCells: detailed?.structuredInteriorCells.length ?? 0,
		structuredInteriorMaterialSlices:
			detailed?.structuredInteriorCells.reduce(
				(total, cell) => total + cell.materialSlices.length,
				0,
			) ?? 0,
		structuredInteriorTexturePages:
			detailed?.structuredInteriorTexturePages.length ?? 0,
		structuredInteriorTextureBytes:
			detailed?.structuredInteriorTexturePages.reduce(
				(total, page) => total + page.bytes.byteLength,
				0,
			) ?? 0,
		structuredInteriorMaterialRecords:
			detailed?.structuredInteriorMaterialRecords.length ?? 0,
	};
}

function describeWebgl2ResourceShape(
	store: Webgl2WorldResourceStore,
): Record<string, unknown> {
	return {
		terrainTiles: store.terrainTileCount,
		terrainTexturePages: store.terrainTexturePageCount,
		terrainDetailTexturePages: store.terrainDetailTexturePageCount,
		staticBundleProducts: store.staticBundleLayerResources.productsByKey.size,
		staticBundleLayers: store.staticBundleLayerResourceCount,
		staticBundleTexturePages: store.staticBundleLayerTexturePageResourceCount,
		staticBundleTextureEstimatedBytes: estimateStaticBundleTextureResourceBytes(
			store.staticBundleLayerResources.layersByKey.values(),
		),
		staticBundleCompactedBatches:
			store.staticBundleLayerCompactedBatchResourceCount,
		staticBundleDirectEntries: store.staticBundleLayerDirectEntryResourceCount,
		structuredInteriorProducts:
			store.structuredInteriorResources.productsByKey.size,
		structuredInteriorCells: store.structuredInteriorResourceCount,
		structuredInteriorTexturePages:
			store.structuredInteriorTexturePageResourceCount,
		structuredInteriorMaterialRecords:
			store.structuredInteriorMaterialRecordResourceCount,
		structuredInteriorTriangles: store.structuredInteriorResourceTriangleCount,
		textureCount: store.textureCount,
		preparedTextureUploadCount: store.preparedTextureUploadCount,
		preparedTextureGeneratedByteLength:
			store.preparedTextureGeneratedByteLength,
	};
}

function estimateStaticBundleTextureResourceBytes(
	layers: Iterable<Webgl2StaticBundleLayerResource>,
): number {
	let total = 0;
	for (const layer of layers) {
		for (const page of layer.texturePages) {
			total += estimateStaticBundleTexturePageBytes(page);
		}
	}
	return total;
}

function estimateStaticBundleTexturePageBytes(
	page: Webgl2StaticBundleLayerResource["texturePages"][number],
): number {
	const baseBytes =
		page.texture.width *
		page.texture.height *
		bytesPerStaticBundleTexturePixel(page);
	return page.mipmapsGenerated ? Math.ceil((baseBytes * 4) / 3) : baseBytes;
}

function bytesPerStaticBundleTexturePixel(
	page: Webgl2StaticBundleLayerResource["texturePages"][number],
): number {
	switch (page.sampleClass) {
		case "rgba-color":
		case "palette-data":
			return 4;
		case "control-data":
			return 1;
		case "indexed-data":
			switch (page.indexedFormat) {
				case "p8":
					return 1;
				case "index16":
					return 2;
				case null:
					return 1;
			}
	}
	throw new Error(
		`Unsupported static bundle texture sample class ${page.sampleClass}.`,
	);
}

function countArtifactsByKind(
	result: LandblockRenderProductWorkerResult,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const artifact of result.artifacts) {
		counts[artifact.artifactKind] = (counts[artifact.artifactKind] ?? 0) + 1;
	}
	return counts;
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}

function evictProductFromSet(
	productSet: StaticLandblockRenderProductSet,
	key: StaticLandblockProductKey,
): StaticLandblockRenderProductSet {
	const productKey = formatStaticLandblockProductKey(key);
	const artifacts = productSet.artifacts.filter(
		(artifact) =>
			formatStaticLandblockProductKey(
				createStaticLandblockProductKeyFromResult(artifact),
			) !== productKey,
	);
	return {
		...productSet,
		artifacts,
		residentCount: artifacts.length,
		evictedResultCount:
			artifacts.length === productSet.artifacts.length
				? productSet.evictedResultCount
				: productSet.evictedResultCount + 1,
	};
}
