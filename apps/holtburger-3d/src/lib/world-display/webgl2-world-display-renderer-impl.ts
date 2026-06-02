import {
	createWebgl2ArrayBuffer,
	createWebgl2Program,
	createWebgl2VertexArray,
	type Webgl2BufferResource,
	type Webgl2ProgramResource,
	type Webgl2VertexArrayResource,
} from "./webgl2-gl";
import {
	createFallbackSceneCameraFrame,
	type SceneBoundsFrame,
} from "./camera";
import type { PreparedBounds } from "../assets/types";
import { createWebgl2RenderMetrics } from "./webgl2-render-metrics";
import { Webgl2StateCache } from "./webgl2-state-cache";
import {
	buildWorldRenderFrame,
	type WorldRenderFrame,
	type WorldRenderFrameMetrics,
} from "./world-render-frame";
import {
	createEmptyWebgl2WorldSubmitMetrics,
	partitionWebgl2SceneDomainDrawUnits,
	planWebgl2FlatWorldSubmitOrder,
	planWebgl2PortalMaskSubmitOrder,
	planWebgl2TerrainTileSubmitOrder,
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
	WEBGL2_RGBA_TEXTURE_PAGE_MAX_MATERIAL_SLOTS,
	type Webgl2RgbaTexturePageFamilyWorldProgram,
} from "./webgl2/families/rgba-texture-page-family-submit";
import {
	WEBGL2_INDEXED_PALETTED_MAX_MATERIAL_SLOTS,
	type Webgl2IndexedPalettedFamilyWorldProgram,
} from "./webgl2/families/indexed-paletted-family-submit";
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
	createWebgl2WorldResourceStore,
	destroyWebgl2WorldResources,
	syncWebgl2WorldResources,
	type Webgl2WorldResourceStore,
} from "./webgl2-world-resources";
import type { Webgl2TerrainTileResource } from "./webgl2/resources/terrain-tile-resources";
import type {
	BrowserCameraResidency,
	WorldRenderMetrics,
} from "./renderer-contract";
import type { MaterialTextureCapabilities } from "./render-surface-texture-data";
import {
	createTranslationMat4,
	multiplyMat4,
	type RenderMat4,
} from "./render-math";
import type { Webgl2WorldDrawUnit } from "./webgl2-world-resources";
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
import type { TransitionPortalScene } from "./transition-portal-work-items";
import {
	buildWorldResidencyIndex,
	createEmptyWorldResidencyIndex,
	deriveBrowserCameraResidency,
	describeCameraViewResidencyContext,
	type CameraViewResidencyContext,
	type WorldResidencyIndex,
	type WorldResidencyQueryDiagnostics,
} from "./world-residency-index";
import {
	isPreparedGfxObjAsset,
	type StaticRenderablePart,
} from "./static-renderables";
import { buildStaticRenderablePartMatrix } from "./staged-world-assembly";
import type {
	WorldDisplayRenderer,
	WorldDisplayRendererOptions,
} from "./world-display-renderer-contract";
import {
	buildPortalCompositeRenderBvhSources,
	calculateRenderSpaceBvhSourcesBoundsFrame,
} from "./prepared-bvh-render-sources";
import { profileBrowserJsScope } from "../diagnostics/browser-js-profiler";
import { deriveWebgl2DrawUnitRuntimeDiagnostics } from "./webgl2-runtime-render-diagnostics";

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
const SELECTED_STATIC_RENDERABLE_BOUNDS_COLOR = new Float32Array([
	1, 0.82, 0.28, 1,
]);
const BOUNDS_LINE_VERTEX_COMPONENTS = 3;

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
uniform int uAtlasEnabled;
uniform vec4 uAtlasRect;
uniform vec2 uAtlasSize;
uniform vec2 uTexturePageWrapMode;
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

vec2 resolveTexturePageUv(vec2 uv) {
	vec2 wrappedUv = mix(clamp(uv, 0.0, 1.0), fract(uv), uTexturePageWrapMode);
	return (uAtlasRect.xy + wrappedUv * uAtlasRect.zw) / uAtlasSize;
}

void main() {
	vec2 baseUv = uAtlasEnabled == 0
		? vUv
		: resolveTexturePageUv(vUv);
	vec4 texel = texture(uTexture, baseUv);
	vec4 color = texel * uColor;
	if (color.a < uAlphaTest) {
		discard;
	}
	color.rgb = applyDetailOverlay(color.rgb);
	fragColor = color;
}
`;

const ATLAS_STATIC_WORLD_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec2 uv;
layout(location = 2) in float materialSlot;

uniform mat4 uViewProjection;
uniform mat4 uBatchModel;

out vec2 vUv;
flat out int vMaterialSlot;

void main() {
	vUv = uv;
	vMaterialSlot = int(materialSlot + 0.5);
	gl_Position = uViewProjection * uBatchModel * vec4(position, 1.0);
}
`;

const ATLAS_STATIC_WORLD_FRAGMENT_SHADER = `#version 300 es
#define MAX_MATERIAL_SLOTS ${WEBGL2_RGBA_TEXTURE_PAGE_MAX_MATERIAL_SLOTS}

precision highp float;

uniform sampler2D uAtlasTexture;
uniform vec2 uAtlasSize;
uniform sampler2D uDetailAtlasTexture;
uniform vec2 uDetailAtlasSize;
uniform vec4 uMaterialRects[MAX_MATERIAL_SLOTS];
uniform ivec2 uMaterialWrapModes[MAX_MATERIAL_SLOTS];
uniform float uMaterialAlphaTests[MAX_MATERIAL_SLOTS];
uniform vec4 uDetailMaterialRects[MAX_MATERIAL_SLOTS];
uniform float uDetailMaterialTilings[MAX_MATERIAL_SLOTS];
uniform int uDetailMaterialEnabled[MAX_MATERIAL_SLOTS];

in vec2 vUv;
flat in int vMaterialSlot;

out vec4 fragColor;

vec2 resolveAtlasLocalUv(vec2 uv, int materialSlot) {
	ivec2 wrapMode = uMaterialWrapModes[materialSlot];
	return vec2(
		wrapMode.x == 1 ? fract(uv.x) : clamp(uv.x, 0.0, 1.0),
		wrapMode.y == 1 ? fract(uv.y) : clamp(uv.y, 0.0, 1.0)
	);
}

vec4 sampleAtlasRect(sampler2D atlasTexture, vec2 atlasSize, vec4 rect, vec2 localUv, vec2 gradX, vec2 gradY) {
	vec2 atlasUv = (rect.xy + localUv * rect.zw) / atlasSize;
	vec2 atlasGradX = gradX * rect.zw / atlasSize;
	vec2 atlasGradY = gradY * rect.zw / atlasSize;
	return textureGrad(atlasTexture, atlasUv, atlasGradX, atlasGradY);
}

vec3 applyDetailOverlay(vec3 baseColor, int materialSlot) {
	if (uDetailMaterialEnabled[materialSlot] == 0) {
		return baseColor;
	}
	vec4 detailRect = uDetailMaterialRects[materialSlot];
	float tiling = uDetailMaterialTilings[materialSlot];
	vec2 tiledUv = vUv * tiling;
	vec4 detailColor = sampleAtlasRect(
		uDetailAtlasTexture,
		uDetailAtlasSize,
		detailRect,
		fract(tiledUv),
		dFdx(tiledUv),
		dFdy(tiledUv)
	);
	float sourceAlpha = clamp(detailColor.a, 0.0, 1.0);
	return clamp(baseColor * (detailColor.rgb + (1.0 - sourceAlpha)), 0.0, 1.0);
}

void main() {
	vec4 rect = uMaterialRects[vMaterialSlot];
	vec4 color = sampleAtlasRect(
		uAtlasTexture,
		uAtlasSize,
		rect,
		resolveAtlasLocalUv(vUv, vMaterialSlot),
		dFdx(vUv),
		dFdy(vUv)
	);
	if (color.a < uMaterialAlphaTests[vMaterialSlot]) {
		discard;
	}
	color.rgb = applyDetailOverlay(color.rgb, vMaterialSlot);
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

const INDEXED_PALETTED_FAMILY_P8_FRAGMENT_SHADER = `#version 300 es
#define MAX_MATERIAL_SLOTS ${WEBGL2_INDEXED_PALETTED_MAX_MATERIAL_SLOTS}

precision highp float;

uniform sampler2D uIndexTexture;
uniform sampler2D uPaletteTexture;
uniform sampler2D uDetailAtlasTexture;
uniform vec2 uDetailAtlasSize;
uniform vec4 uMaterialColors[MAX_MATERIAL_SLOTS];
uniform vec4 uMaterialParams[MAX_MATERIAL_SLOTS];
uniform vec4 uDetailMaterialRects[MAX_MATERIAL_SLOTS];
uniform vec4 uDetailMaterialParams[MAX_MATERIAL_SLOTS];

in vec2 vUv;
flat in int vMaterialSlot;

out vec4 fragColor;

vec2 resolveIndexedUv(vec2 uv, int materialSlot) {
	vec4 detailParams = uDetailMaterialParams[materialSlot];
	vec2 wrapped = vec2(
		detailParams.x >= 0.5 ? fract(uv.x) : clamp(uv.x, 0.0, 0.999999),
		detailParams.y >= 0.5 ? fract(uv.y) : clamp(uv.y, 0.0, 0.999999)
	);
	return wrapped * uMaterialParams[materialSlot].xy;
}

ivec2 resolveIndexedSampleCoord(ivec2 baseCoord, ivec2 offset, int materialSlot) {
	ivec2 size = ivec2(uMaterialParams[materialSlot].xy);
	vec4 detailParams = uDetailMaterialParams[materialSlot];
	ivec2 coord = baseCoord + offset;
	coord.x = detailParams.x >= 0.5 ? coord.x % size.x : clamp(coord.x, 0, size.x - 1);
	coord.y = detailParams.y >= 0.5 ? coord.y % size.y : clamp(coord.y, 0, size.y - 1);
	return coord;
}

vec4 paletteColor(float index, int materialSlot) {
	vec4 materialParams = uMaterialParams[materialSlot];
	if (materialParams.w >= 0.0 && index < materialParams.w) {
		return vec4(0.0);
	}
	float paletteU = (index + 0.5) / materialParams.z;
	return texture(uPaletteTexture, vec2(paletteU, 0.5));
}

float paletteIndexAt(ivec2 coord) {
	vec4 packed = texelFetch(uIndexTexture, coord, 0) * 255.0;
	return floor(packed.r + 0.5);
}

vec4 sampleDetailAtlasRect(vec4 rect, vec2 localUv, vec2 gradX, vec2 gradY) {
	vec2 atlasUv = (rect.xy + localUv * rect.zw) / uDetailAtlasSize;
	vec2 atlasGradX = gradX * rect.zw / uDetailAtlasSize;
	vec2 atlasGradY = gradY * rect.zw / uDetailAtlasSize;
	return textureGrad(uDetailAtlasTexture, atlasUv, atlasGradX, atlasGradY);
}

vec3 applyDetailOverlay(vec3 baseColor, int materialSlot) {
	vec4 detailParams = uDetailMaterialParams[materialSlot];
	if (detailParams.w < 0.5) {
		return baseColor;
	}
	float tiling = detailParams.z;
	vec2 tiledUv = vUv * tiling;
	vec4 detailColor = sampleDetailAtlasRect(
		uDetailMaterialRects[materialSlot],
		fract(tiledUv),
		dFdx(tiledUv),
		dFdy(tiledUv)
	);
	float sourceAlpha = clamp(detailColor.a, 0.0, 1.0);
	return clamp(baseColor * (detailColor.rgb + (1.0 - sourceAlpha)), 0.0, 1.0);
}

void main() {
	vec2 texelPosition = resolveIndexedUv(vUv, vMaterialSlot);
	ivec2 baseCoord = ivec2(floor(texelPosition));
	vec2 blend = fract(texelPosition);
	vec4 top = mix(
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(0, 0), vMaterialSlot)), vMaterialSlot),
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(1, 0), vMaterialSlot)), vMaterialSlot),
		blend.x
	);
	vec4 bottom = mix(
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(0, 1), vMaterialSlot)), vMaterialSlot),
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(1, 1), vMaterialSlot)), vMaterialSlot),
		blend.x
	);
	vec4 color = mix(top, bottom, blend.y) * uMaterialColors[vMaterialSlot];
	if (color.a <= 0.0) {
		discard;
	}
	color.rgb = applyDetailOverlay(color.rgb, vMaterialSlot);
	fragColor = color;
}
`;

const INDEXED_PALETTED_FAMILY_P16_FRAGMENT_SHADER = `#version 300 es
#define MAX_MATERIAL_SLOTS ${WEBGL2_INDEXED_PALETTED_MAX_MATERIAL_SLOTS}

precision highp float;

uniform sampler2D uIndexTexture;
uniform sampler2D uPaletteTexture;
uniform sampler2D uDetailAtlasTexture;
uniform vec2 uDetailAtlasSize;
uniform vec4 uMaterialColors[MAX_MATERIAL_SLOTS];
uniform vec4 uMaterialParams[MAX_MATERIAL_SLOTS];
uniform vec4 uDetailMaterialRects[MAX_MATERIAL_SLOTS];
uniform vec4 uDetailMaterialParams[MAX_MATERIAL_SLOTS];

in vec2 vUv;
flat in int vMaterialSlot;

out vec4 fragColor;

vec2 resolveIndexedUv(vec2 uv, int materialSlot) {
	vec4 detailParams = uDetailMaterialParams[materialSlot];
	vec2 wrapped = vec2(
		detailParams.x >= 0.5 ? fract(uv.x) : clamp(uv.x, 0.0, 0.999999),
		detailParams.y >= 0.5 ? fract(uv.y) : clamp(uv.y, 0.0, 0.999999)
	);
	return wrapped * uMaterialParams[materialSlot].xy;
}

ivec2 resolveIndexedSampleCoord(ivec2 baseCoord, ivec2 offset, int materialSlot) {
	ivec2 size = ivec2(uMaterialParams[materialSlot].xy);
	vec4 detailParams = uDetailMaterialParams[materialSlot];
	ivec2 coord = baseCoord + offset;
	coord.x = detailParams.x >= 0.5 ? coord.x % size.x : clamp(coord.x, 0, size.x - 1);
	coord.y = detailParams.y >= 0.5 ? coord.y % size.y : clamp(coord.y, 0, size.y - 1);
	return coord;
}

vec4 paletteColor(float index, int materialSlot) {
	vec4 materialParams = uMaterialParams[materialSlot];
	if (materialParams.w >= 0.0 && index < materialParams.w) {
		return vec4(0.0);
	}
	float paletteU = (index + 0.5) / materialParams.z;
	return texture(uPaletteTexture, vec2(paletteU, 0.5));
}

float paletteIndexAt(ivec2 coord) {
	vec4 packed = texelFetch(uIndexTexture, coord, 0) * 255.0;
	return floor(packed.r + 0.5) + floor(packed.g + 0.5) * 256.0;
}

vec4 sampleDetailAtlasRect(vec4 rect, vec2 localUv, vec2 gradX, vec2 gradY) {
	vec2 atlasUv = (rect.xy + localUv * rect.zw) / uDetailAtlasSize;
	vec2 atlasGradX = gradX * rect.zw / uDetailAtlasSize;
	vec2 atlasGradY = gradY * rect.zw / uDetailAtlasSize;
	return textureGrad(uDetailAtlasTexture, atlasUv, atlasGradX, atlasGradY);
}

vec3 applyDetailOverlay(vec3 baseColor, int materialSlot) {
	vec4 detailParams = uDetailMaterialParams[materialSlot];
	if (detailParams.w < 0.5) {
		return baseColor;
	}
	float tiling = detailParams.z;
	vec2 tiledUv = vUv * tiling;
	vec4 detailColor = sampleDetailAtlasRect(
		uDetailMaterialRects[materialSlot],
		fract(tiledUv),
		dFdx(tiledUv),
		dFdy(tiledUv)
	);
	float sourceAlpha = clamp(detailColor.a, 0.0, 1.0);
	return clamp(baseColor * (detailColor.rgb + (1.0 - sourceAlpha)), 0.0, 1.0);
}

void main() {
	vec2 texelPosition = resolveIndexedUv(vUv, vMaterialSlot);
	ivec2 baseCoord = ivec2(floor(texelPosition));
	vec2 blend = fract(texelPosition);
	vec4 top = mix(
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(0, 0), vMaterialSlot)), vMaterialSlot),
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(1, 0), vMaterialSlot)), vMaterialSlot),
		blend.x
	);
	vec4 bottom = mix(
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(0, 1), vMaterialSlot)), vMaterialSlot),
		paletteColor(paletteIndexAt(resolveIndexedSampleCoord(baseCoord, ivec2(1, 1), vMaterialSlot)), vMaterialSlot),
		blend.x
	);
	vec4 color = mix(top, bottom, blend.y) * uMaterialColors[vMaterialSlot];
	if (color.a <= 0.0) {
		discard;
	}
	color.rgb = applyDetailOverlay(color.rgb, vMaterialSlot);
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
	triangleProgram: Webgl2ProgramResource<"position", never>;
	flatWorldProgram: Webgl2FlatWorldProgram;
	texturedWorldProgram: Webgl2TexturedWorldProgram;
	indexedP8WorldProgram: Webgl2IndexedP8WorldProgram;
	indexedP16WorldProgram: Webgl2IndexedP16WorldProgram;
	terrainBlendWorldProgram: Webgl2TerrainBlendWorldProgram;
	rgbaTexturePageFamilyWorldProgram: Webgl2RgbaTexturePageFamilyWorldProgram;
	indexedPalettedFamilyP8WorldProgram: Webgl2IndexedPalettedFamilyWorldProgram;
	indexedPalettedFamilyP16WorldProgram: Webgl2IndexedPalettedFamilyWorldProgram;
	sceneDomainCopyProgram: Webgl2ProgramResource<
		never,
		"uColorTexture" | "uDepthTexture"
	>;
	vertexBuffer: Webgl2BufferResource;
	vertexArray: Webgl2VertexArrayResource;
	sceneDomainCopyVertexArray: Webgl2VertexArrayResource;
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
	let terrainScene = options.terrainScene;
	let staticRenderableScene = options.staticRenderableScene;
	let structuredInteriorScene = options.structuredInteriorScene;
	let transitionPortalModel = options.transitionPortalModel;
	let renderSceneContext = options.renderSceneContext;
	let renderChunkTransforms = options.renderChunkTransforms;
	let selectedStaticRenderableRenderKey =
		options.selectedStaticRenderableRenderKey;
	let controlledCameraFrame = options.controlledCameraFrame;
	let transitionPortalMaxDepth = options.transitionPortalMaxDepth ?? 1;
	let textureFilteringMode = options.textureFilteringMode ?? "anisotropic-4x";
	let detailTexturesEnabled = options.detailTexturesEnabled ?? true;
	let renderMetricsChangeHandler = options.onRenderMetricsChange;
	let cameraResidencyChangeHandler = options.onCameraResidencyChange;
	let disposed = false;
	let frameHandle: number | null = null;
	let resources: Webgl2RenderResources | null = null;
	let worldResourcesDirty = false;
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
			structuredInteriorScene,
		});
	let latestPortalWorkPlan: Webgl2TransitionPortalWorkPlan | null = null;
	let latestSceneBounds: SceneBoundsFrame | null = null;

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
			markWorldResourcesDirty();
		},
		setTerrainScene(scene) {
			terrainScene = scene;
			markWorldResourcesDirty();
		},
		setStaticRenderableScene(scene) {
			staticRenderableScene = scene;
			markWorldResourcesDirty();
		},
		setStructuredInteriorScene(scene) {
			structuredInteriorScene = scene;
			markWorldResourcesDirty();
			syncResidencyIndex();
		},
		setTransitionPortalModel(model) {
			transitionPortalModel = model;
			markWorldResourcesDirty();
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
			markWorldResourcesDirty();
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
			markWorldResourcesDirty();
		},
		setDetailTexturesEnabled(enabled) {
			if (detailTexturesEnabled === enabled) {
				return;
			}
			detailTexturesEnabled = enabled;
			markWorldResourcesDirty();
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
		pickTerrainLandblockAtViewportPoint() {
			return null;
		},
		pickAtViewportPoint() {
			return null;
		},
		getDrawUnitRuntimeDiagnostics(drawUnitIds) {
			if (worldResourcesDirty) {
				syncWorldResources();
			}
			return resources
				? deriveWebgl2DrawUnitRuntimeDiagnostics({
						store: resources.worldStore,
						drawUnitIds,
					})
				: [];
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
		if (worldResourcesDirty) {
			syncWorldResources();
		}
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

		const frameDrawUnitCandidates =
			currentResources.worldStore.drawUnits.filter(
				(drawUnit) => drawUnit.kind !== "terrain",
			);
		const frameCandidates = [
			...frameDrawUnitCandidates,
			...currentResources.worldStore.terrainRenderCandidates.map((candidate) => ({
				id: candidate.id,
				kind: "terrain-tile" as const,
				bvhItemKeys: candidate.bvhItemKeys,
				bvhFallbackReason: candidate.bvhFallbackReason,
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
						structuredInteriorScene,
						terrainScene,
					}),
			);
			latestFrameMetrics = frame.metrics;
			const portalMaskDrawUnits = profileBrowserJsScope(
				"webgl2.frame.planPortalMasks",
				() =>
					planWebgl2PortalMaskSubmitOrder(
						frame,
						currentResources.worldStore.drawUnitsById,
					),
			);
			const baseSceneDomain = deriveWebgl2BaseSceneDomainFromResidency(
				latestCameraResidencyContext,
			);
			if (
				shouldUseSceneDomainTargets({
					portalMaskDrawUnitCount: portalMaskDrawUnits.length,
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
							portalMaskDrawUnits,
						}),
				);
			} else {
				latestSceneDomainFrameMetrics = null;
				latestPortalWorkPlan = null;
				latestBaseSceneDomain = baseSceneDomain;
				latestSubmitMetrics = profileBrowserJsScope(
					"webgl2.frame.submitFlatWorld",
					() =>
						submitWebgl2FlatWorldFrame({
							gl,
							stateCache: currentResources.stateCache,
							program: currentResources.flatWorldProgram,
							texturedProgram: currentResources.texturedWorldProgram,
							terrainBlendProgram: currentResources.terrainBlendWorldProgram,
							indexedP8Program: currentResources.indexedP8WorldProgram,
							indexedP16Program: currentResources.indexedP16WorldProgram,
							rgbaTexturePageFamilyProgram:
								currentResources.rgbaTexturePageFamilyWorldProgram,
							indexedPalettedFamilyP8Program:
								currentResources.indexedPalettedFamilyP8WorldProgram,
							indexedPalettedFamilyP16Program:
								currentResources.indexedPalettedFamilyP16WorldProgram,
							rgbaTexturePageFamilyResources: {
								batches: [
									...currentResources.worldStore.compactedGeometryBatches.values(),
								],
								rgbaTexturePageFamilies: [
									...currentResources.worldStore.compactedGeometryFamilyResources.values(),
								].filter((resource) => resource.family === "rgba-texture-page"),
								generation: currentResources.worldStore.textureAtlasGeneration,
							},
							indexedPalettedFamilyResources: {
								batches: [
									...currentResources.worldStore.compactedGeometryBatches.values(),
								],
								indexedPalettedFamilies: [
									...currentResources.worldStore.compactedGeometryFamilyResources.values(),
								].filter((resource) => resource.family === "indexed-paletted"),
								texturesByKey: currentResources.worldStore.texturesByKey,
								detailTextures:
									currentResources.worldStore.textureAtlasGeneration
										?.detailTextures ?? [],
							},
							drawUnitsById: currentResources.worldStore.drawUnitsById,
							terrainTilesById:
								currentResources.worldStore.terrainTilesById,
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
			currentResources.stateCache.useProgram(
				currentResources.triangleProgram.program,
			);
			currentResources.stateCache.bindVertexArray(
				currentResources.vertexArray.vertexArray,
			);
			gl.drawArrays(gl.TRIANGLES, 0, TRIANGLE_VERTEX_COUNT);
			drawCallCount += 1;
			lastFrameDrawCount = 1;
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
			multiplyMat4(frame.viewProjectionMatrix, overlay.modelMatrix),
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
		if (!part) {
			disposeSelectedStaticRenderableOverlay();
			return null;
		}
		const overlayInput = buildSelectedStaticRenderableOverlayInput(part);
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
			label: `selected static renderable bounds ${part.renderKey}`,
			data: overlayInput.positions,
		});
		const vertexArray = createWebgl2VertexArray(currentResources.gl, {
			label: `selected static renderable bounds ${part.renderKey}`,
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
		portalMaskDrawUnitCount,
		baseSceneDomain,
		transitionPortalCandidateCount,
	}: {
		portalMaskDrawUnitCount: number;
		baseSceneDomain: Webgl2SceneDomain;
		transitionPortalCandidateCount: number;
	}): boolean {
		return (
			transitionPortalMaxDepth > 0 &&
			(portalMaskDrawUnitCount > 0 ||
				(baseSceneDomain === "interior" && transitionPortalCandidateCount > 0))
		);
	}

	function submitWebgl2SceneDomainFrame({
		frame,
		portalMaskDrawUnits,
	}: {
		frame: ReturnType<typeof buildWorldRenderFrame>;
		portalMaskDrawUnits: readonly Webgl2WorldDrawUnit[];
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
		const visibleDrawUnits = profileBrowserJsScope(
			"webgl2.sceneDomain.planVisibleSubmitOrder",
			() =>
				planWebgl2FlatWorldSubmitOrder(
					frame,
					currentResources.worldStore.drawUnitsById,
				),
		);
		const sceneDomainDrawUnits =
			partitionWebgl2SceneDomainDrawUnits(visibleDrawUnits);
		const visibleTerrainTiles = profileBrowserJsScope(
			"webgl2.sceneDomain.planVisibleTerrainTiles",
			() =>
				planWebgl2TerrainTileSubmitOrder(
					frame,
					currentResources.worldStore.terrainTilesById,
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
					visiblePortalMaskDrawUnits: portalMaskDrawUnits,
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
					drawUnits: sceneDomainDrawUnits.exterior,
					terrainTiles: visibleTerrainTiles,
					frame,
					rgbaTexturePageFamilySubmitRoute: "scene-domain-exterior",
					terrainBackfaceCulling: baseScene === "interior",
				}),
		);
		const interiorMetrics = profileBrowserJsScope(
			"webgl2.sceneDomain.renderInterior",
			() =>
				renderSceneDomainTarget({
					target: targets.interior,
					drawUnits: sceneDomainDrawUnits.interior,
					terrainTiles: [],
					frame,
					rgbaTexturePageFamilySubmitRoute: "scene-domain-interior",
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
			portalMaskDrawUnitCount: portalMaskDrawUnits.length,
			exteriorDomainDrawUnitCount: sceneDomainDrawUnits.exterior.length,
			interiorDomainDrawUnitCount: sceneDomainDrawUnits.interior.length,
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
		drawUnits,
		terrainTiles,
		frame,
		rgbaTexturePageFamilySubmitRoute,
		terrainBackfaceCulling,
	}: {
		target: Webgl2SceneDomainTarget;
		drawUnits: readonly Webgl2WorldDrawUnit[];
		terrainTiles: readonly Webgl2TerrainTileResource[];
		frame: ReturnType<typeof buildWorldRenderFrame>;
		rgbaTexturePageFamilySubmitRoute:
			| "scene-domain-exterior"
			| "scene-domain-interior";
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
		return submitWebgl2FlatWorldDrawUnits({
			gl,
			stateCache,
			program: resources.flatWorldProgram,
			texturedProgram: resources.texturedWorldProgram,
			terrainBlendProgram: resources.terrainBlendWorldProgram,
			indexedP8Program: resources.indexedP8WorldProgram,
			indexedP16Program: resources.indexedP16WorldProgram,
			rgbaTexturePageFamilyProgram: resources.rgbaTexturePageFamilyWorldProgram,
			indexedPalettedFamilyP8Program:
				resources.indexedPalettedFamilyP8WorldProgram,
			indexedPalettedFamilyP16Program:
				resources.indexedPalettedFamilyP16WorldProgram,
			rgbaTexturePageFamilyResources: {
				batches: [...resources.worldStore.compactedGeometryBatches.values()],
				rgbaTexturePageFamilies: [
					...resources.worldStore.compactedGeometryFamilyResources.values(),
				].filter((resource) => resource.family === "rgba-texture-page"),
				generation: resources.worldStore.textureAtlasGeneration,
			},
			indexedPalettedFamilyResources: {
				batches: [...resources.worldStore.compactedGeometryBatches.values()],
				indexedPalettedFamilies: [
					...resources.worldStore.compactedGeometryFamilyResources.values(),
				].filter((resource) => resource.family === "indexed-paletted"),
				texturesByKey: resources.worldStore.texturesByKey,
				detailTextures:
					resources.worldStore.textureAtlasGeneration?.detailTextures ?? [],
			},
			viewProjectionMatrix: frame.viewProjectionMatrix,
			drawUnits,
			terrainTiles,
			rgbaTexturePageFamilySubmitRoute,
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
	}: {
		frame: ReturnType<typeof buildWorldRenderFrame>;
		targets: Webgl2SceneDomainTargetSet;
		compositeTargets: Webgl2PortalCompositeTargetSet;
		transitionLevels: readonly TransitionPortalRenderLevel[];
		workPlan: Webgl2TransitionPortalWorkPlan;
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
	}: {
		frame: ReturnType<typeof buildWorldRenderFrame>;
		level: TransitionPortalRenderLevel;
		batch: readonly Webgl2VisibleTransitionPortalWork[];
		destinationTarget: Webgl2PortalCompositeTarget;
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
			for (const work of batch) {
				const drawUnit = resources.worldStore.drawUnitsById.get(
					work.maskDrawUnitId,
				);
				if (!drawUnit) {
					continue;
				}
				const modelViewProjection = multiplyMat4(
					frame.viewProjectionMatrix,
					drawUnit.modelMatrix,
				);
				gl.uniformMatrix4fv(
					resources.flatWorldProgram.uniforms.uModelViewProjection,
					false,
					modelViewProjection,
				);
				stateCache.bindVertexArray(drawUnit.vertexArray.vertexArray);
				gl.drawElements(
					gl.TRIANGLES,
					drawUnit.vertexCount,
					drawUnit.indexType,
					0,
				);
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
		resources.vertexArray.dispose();
		resources.vertexBuffer.dispose();
		resources.triangleProgram.dispose();
		resources.flatWorldProgram.dispose();
		resources.texturedWorldProgram.dispose();
		resources.indexedP8WorldProgram.dispose();
		resources.indexedP16WorldProgram.dispose();
		resources.terrainBlendWorldProgram.dispose();
		resources.rgbaTexturePageFamilyWorldProgram.dispose();
		resources.indexedPalettedFamilyP8WorldProgram.dispose();
		resources.indexedPalettedFamilyP16WorldProgram.dispose();
		resources.sceneDomainCopyProgram.dispose();
		resources.sceneDomainCopyVertexArray.dispose();
		resources.sceneDomainTargets?.dispose();
		resources.portalCompositeTargets?.dispose();
		resources.selectedStaticRenderableOverlay?.dispose();
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

	function syncWorldResources(): void {
		if (!resources) {
			latestSceneBounds = null;
			worldResourcesDirty = false;
			return;
		}
		worldResourcesDirty = false;
		const currentResources = resources;
		profileBrowserJsScope("webgl2.resource.syncWorldResources", () => {
			syncWebgl2WorldResources({
				gl: currentResources.gl,
				store: currentResources.worldStore,
				assetState,
				terrainScene,
				staticRenderableScene,
				structuredInteriorScene,
				transitionPortalModel,
				renderChunkTransforms,
				rendererResourceGraph: options.rendererResourceGraph,
				materialTextureCapabilities:
					currentResources.materialTextureCapabilities,
				textureFilteringMode,
				detailTexturesEnabled,
			});
		});
		latestSceneBounds = profileBrowserJsScope(
			"webgl2.resource.calculateSceneBounds",
			() =>
				calculateRenderSpaceBvhSourcesBoundsFrame(
					buildPortalCompositeRenderBvhSources({
						assetState,
						terrainScene,
						staticRenderableScene,
						structuredInteriorScene,
						renderChunkTransforms,
					}),
				),
		);
		resources.stateCache.invalidate();
	}

	function markWorldResourcesDirty(): void {
		worldResourcesDirty = true;
		scheduleFrame();
	}

	function syncResidencyIndex(): void {
		residencyIndex = buildWorldResidencyIndex({
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
				terrainScene,
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
				renderGraphPolicy: initializationError
					? "webgl2-initialization-failed"
					: resources
						? resources.worldStore.drawUnits.length > 0
							? "webgl2-staged-resources"
							: "webgl2-test-frame"
						: "webgl2-initializing",
				renderGraphBaseScene: latestBaseSceneDomain,
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
		visibleTerrainTileCount:
			exteriorMetrics.visibleTerrainTileCount +
			interiorMetrics.visibleTerrainTileCount,
		visibleTerrainCompatibilityDrawCount:
			exteriorMetrics.visibleTerrainCompatibilityDrawCount +
			interiorMetrics.visibleTerrainCompatibilityDrawCount,
		portalMaskDrawUnitCount,
		exteriorDomainDrawUnitCount,
		interiorDomainDrawUnitCount,
		submittedTerrainTileCount:
			exteriorMetrics.submittedTerrainTileCount +
			interiorMetrics.submittedTerrainTileCount,
		terrainCompatibilityDrawCallCount:
			exteriorMetrics.terrainCompatibilityDrawCallCount +
			interiorMetrics.terrainCompatibilityDrawCallCount,
		terrainSubmittedTriangleCount:
			exteriorMetrics.terrainSubmittedTriangleCount +
			interiorMetrics.terrainSubmittedTriangleCount,
		retainedDirectOpaqueDrawUnitCount:
			exteriorMetrics.retainedDirectOpaqueDrawUnitCount +
			interiorMetrics.retainedDirectOpaqueDrawUnitCount,
		retainedDirectBlendedDrawUnitCount:
			exteriorMetrics.retainedDirectBlendedDrawUnitCount +
			interiorMetrics.retainedDirectBlendedDrawUnitCount,
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
		visibleDrawUnitCountsByMaterialKind: mergeMaterialKindCounts(
			exteriorMetrics.visibleDrawUnitCountsByMaterialKind,
			interiorMetrics.visibleDrawUnitCountsByMaterialKind,
		),
		visibleRetainedDirectDrawUnitCountsByCompactionFamily:
			mergeMaterialKindCounts(
				exteriorMetrics.visibleRetainedDirectDrawUnitCountsByCompactionFamily,
				interiorMetrics.visibleRetainedDirectDrawUnitCountsByCompactionFamily,
			),
		rgbaTexturePageFamilyShaderDrawCallCount:
			exteriorMetrics.rgbaTexturePageFamilyShaderDrawCallCount +
			interiorMetrics.rgbaTexturePageFamilyShaderDrawCallCount,
		rgbaTexturePageFamilySubmittedBatchCount:
			exteriorMetrics.rgbaTexturePageFamilySubmittedBatchCount +
			interiorMetrics.rgbaTexturePageFamilySubmittedBatchCount,
		rgbaTexturePageFamilySubmittedDrawSliceCount:
			exteriorMetrics.rgbaTexturePageFamilySubmittedDrawSliceCount +
			interiorMetrics.rgbaTexturePageFamilySubmittedDrawSliceCount,
		rgbaTexturePageFamilySubmittedSliceRepresentedDrawUnitCount:
			exteriorMetrics.rgbaTexturePageFamilySubmittedSliceRepresentedDrawUnitCount +
			interiorMetrics.rgbaTexturePageFamilySubmittedSliceRepresentedDrawUnitCount,
		rgbaTexturePageFamilySubmittedTriangleCount:
			exteriorMetrics.rgbaTexturePageFamilySubmittedTriangleCount +
			interiorMetrics.rgbaTexturePageFamilySubmittedTriangleCount,
		rgbaTexturePageFamilyReplacedDrawUnitCount:
			exteriorMetrics.rgbaTexturePageFamilyReplacedDrawUnitCount +
			interiorMetrics.rgbaTexturePageFamilyReplacedDrawUnitCount,
		rgbaTexturePageFamilyReplacedDrawUnitTriangleCount:
			exteriorMetrics.rgbaTexturePageFamilyReplacedDrawUnitTriangleCount +
			interiorMetrics.rgbaTexturePageFamilyReplacedDrawUnitTriangleCount,
		rgbaTexturePageFamilyConservativeOverdrawTriangleCount:
			exteriorMetrics.rgbaTexturePageFamilyConservativeOverdrawTriangleCount +
			interiorMetrics.rgbaTexturePageFamilyConservativeOverdrawTriangleCount,
		rgbaTexturePageFamilyConservativeOverdrawRatio: calculateCombinedRatio({
			numerator:
				exteriorMetrics.rgbaTexturePageFamilyConservativeOverdrawTriangleCount +
				interiorMetrics.rgbaTexturePageFamilyConservativeOverdrawTriangleCount,
			denominator:
				exteriorMetrics.rgbaTexturePageFamilySubmittedTriangleCount +
				interiorMetrics.rgbaTexturePageFamilySubmittedTriangleCount,
		}),
		rgbaTexturePageFamilyRetainedDirectDrawUnitCount:
			exteriorMetrics.rgbaTexturePageFamilyRetainedDirectDrawUnitCount +
			interiorMetrics.rgbaTexturePageFamilyRetainedDirectDrawUnitCount,
		rgbaTexturePageFamilyOriginalDrawCallEstimateCount:
			exteriorMetrics.rgbaTexturePageFamilyOriginalDrawCallEstimateCount +
			interiorMetrics.rgbaTexturePageFamilyOriginalDrawCallEstimateCount,
		rgbaTexturePageFamilySubmittedDrawCallEstimateCount:
			exteriorMetrics.rgbaTexturePageFamilySubmittedDrawCallEstimateCount +
			interiorMetrics.rgbaTexturePageFamilySubmittedDrawCallEstimateCount,
		rgbaTexturePageFamilyDrawCallSavingsCount:
			exteriorMetrics.rgbaTexturePageFamilyDrawCallSavingsCount +
			interiorMetrics.rgbaTexturePageFamilyDrawCallSavingsCount,
		rgbaTexturePageFamilyNoVisibleRouteCount:
			exteriorMetrics.rgbaTexturePageFamilyNoVisibleRouteCount +
			interiorMetrics.rgbaTexturePageFamilyNoVisibleRouteCount,
		rgbaTexturePageFamilyNoVisibleExteriorRouteCount:
			exteriorMetrics.rgbaTexturePageFamilyNoVisibleExteriorRouteCount +
			interiorMetrics.rgbaTexturePageFamilyNoVisibleExteriorRouteCount,
		rgbaTexturePageFamilyNoVisibleInteriorRouteCount:
			exteriorMetrics.rgbaTexturePageFamilyNoVisibleInteriorRouteCount +
			interiorMetrics.rgbaTexturePageFamilyNoVisibleInteriorRouteCount,
		rgbaTexturePageFamilyNoVisibleOtherRouteCount:
			exteriorMetrics.rgbaTexturePageFamilyNoVisibleOtherRouteCount +
			interiorMetrics.rgbaTexturePageFamilyNoVisibleOtherRouteCount,
		rgbaTexturePageFamilyFallbackSamples: [
			...exteriorMetrics.rgbaTexturePageFamilyFallbackSamples,
			...interiorMetrics.rgbaTexturePageFamilyFallbackSamples,
		].slice(0, 8),
		indexedPalettedFamilyShaderDrawCallCount:
			exteriorMetrics.indexedPalettedFamilyShaderDrawCallCount +
			interiorMetrics.indexedPalettedFamilyShaderDrawCallCount,
		indexedPalettedFamilySubmittedBatchCount:
			exteriorMetrics.indexedPalettedFamilySubmittedBatchCount +
			interiorMetrics.indexedPalettedFamilySubmittedBatchCount,
		indexedPalettedFamilySubmittedDrawSliceCount:
			exteriorMetrics.indexedPalettedFamilySubmittedDrawSliceCount +
			interiorMetrics.indexedPalettedFamilySubmittedDrawSliceCount,
		indexedPalettedFamilySubmittedSliceRepresentedDrawUnitCount:
			exteriorMetrics.indexedPalettedFamilySubmittedSliceRepresentedDrawUnitCount +
			interiorMetrics.indexedPalettedFamilySubmittedSliceRepresentedDrawUnitCount,
		indexedPalettedFamilySubmittedTriangleCount:
			exteriorMetrics.indexedPalettedFamilySubmittedTriangleCount +
			interiorMetrics.indexedPalettedFamilySubmittedTriangleCount,
		indexedPalettedFamilyReplacedDrawUnitCount:
			exteriorMetrics.indexedPalettedFamilyReplacedDrawUnitCount +
			interiorMetrics.indexedPalettedFamilyReplacedDrawUnitCount,
		indexedPalettedFamilyReplacedDrawUnitTriangleCount:
			exteriorMetrics.indexedPalettedFamilyReplacedDrawUnitTriangleCount +
			interiorMetrics.indexedPalettedFamilyReplacedDrawUnitTriangleCount,
		indexedPalettedFamilyRetainedDirectDrawUnitCount:
			exteriorMetrics.indexedPalettedFamilyRetainedDirectDrawUnitCount +
			interiorMetrics.indexedPalettedFamilyRetainedDirectDrawUnitCount,
		indexedPalettedFamilyNoVisibleRouteCount:
			exteriorMetrics.indexedPalettedFamilyNoVisibleRouteCount +
			interiorMetrics.indexedPalettedFamilyNoVisibleRouteCount,
		directTexturePageDrawCount:
			exteriorMetrics.directTexturePageDrawCount +
			interiorMetrics.directTexturePageDrawCount,
		directSingleEntryTexturePageDrawCount:
			exteriorMetrics.directSingleEntryTexturePageDrawCount +
			interiorMetrics.directSingleEntryTexturePageDrawCount,
		directPackedTexturePageDrawCount:
			exteriorMetrics.directPackedTexturePageDrawCount +
			interiorMetrics.directPackedTexturePageDrawCount,
		directPackedTexturePageEstimatedBindAvoidedCount:
			exteriorMetrics.directPackedTexturePageEstimatedBindAvoidedCount +
			interiorMetrics.directPackedTexturePageEstimatedBindAvoidedCount,
		directPackedTexturePageTextureCount: Math.max(
			exteriorMetrics.directPackedTexturePageTextureCount,
			interiorMetrics.directPackedTexturePageTextureCount,
		),
		directTexturePageFallbackSamples: [
			...exteriorMetrics.directTexturePageFallbackSamples,
			...interiorMetrics.directTexturePageFallbackSamples,
		].slice(0, 8),
	};
}

function calculateCombinedRatio({
	numerator,
	denominator,
}: {
	numerator: number;
	denominator: number;
}): number {
	return denominator === 0 ? 0 : numerator / denominator;
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
		rgbaTexturePageFamilyWorldProgram:
			createRgbaTexturePageFamilyWorldProgram(gl),
		indexedPalettedFamilyP8WorldProgram:
			createIndexedPalettedFamilyWorldProgram(gl, {
				label: "webgl2 indexed-paletted p8 family world",
				fragmentSource: INDEXED_PALETTED_FAMILY_P8_FRAGMENT_SHADER,
			}),
		indexedPalettedFamilyP16WorldProgram:
			createIndexedPalettedFamilyWorldProgram(gl, {
				label: "webgl2 indexed-paletted p16 family world",
				fragmentSource: INDEXED_PALETTED_FAMILY_P16_FRAGMENT_SHADER,
			}),
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

function createRgbaTexturePageFamilyWorldProgram(
	gl: WebGL2RenderingContext,
): Webgl2RgbaTexturePageFamilyWorldProgram {
	return createWebgl2Program(gl, {
		label: "webgl2 rgba texture-page family world",
		vertexSource: ATLAS_STATIC_WORLD_VERTEX_SHADER,
		fragmentSource: ATLAS_STATIC_WORLD_FRAGMENT_SHADER,
		attributes: ["position", "uv", "materialSlot"],
		uniforms: [
			"uViewProjection",
			"uBatchModel",
			"uAtlasTexture",
			"uAtlasSize",
			"uDetailAtlasTexture",
			"uDetailAtlasSize",
			"uMaterialRects",
			"uMaterialWrapModes",
			"uMaterialAlphaTests",
			"uDetailMaterialRects",
			"uDetailMaterialTilings",
			"uDetailMaterialEnabled",
		],
	});
}

function createIndexedPalettedFamilyWorldProgram(
	gl: WebGL2RenderingContext,
	options: { label: string; fragmentSource: string },
): Webgl2IndexedPalettedFamilyWorldProgram {
	return createWebgl2Program(gl, {
		label: options.label,
		vertexSource: ATLAS_STATIC_WORLD_VERTEX_SHADER,
		fragmentSource: options.fragmentSource,
		attributes: ["position", "uv", "materialSlot"],
		uniforms: [
			"uViewProjection",
			"uBatchModel",
			"uIndexTexture",
			"uPaletteTexture",
			"uDetailAtlasTexture",
			"uDetailAtlasSize",
			"uMaterialColors",
			"uMaterialParams",
			"uDetailMaterialRects",
			"uDetailMaterialParams",
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
