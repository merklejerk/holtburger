import type {
	DebugOverlayPrimitive,
	DynamicRendererResourceCommit,
	DynamicRendererResourceCommitDiagnostics,
	DynamicRendererInstance,
	DynamicRendererInstanceCommit,
	DynamicRendererVisualResource,
	DynamicRendererVisualPart,
	FrameState,
	Renderer,
	RendererFrameTelemetry,
	RendererFrameTelemetryListener,
	RendererSnapshot,
	StaticObjectUploadDiagnostics,
	RenderPassPlan,
	PortalProjectionFrameGraphPlan,
	PortalProjectionFrameMaskEdgePlan,
	PortalProjectionFrameOutdoorCrossingPlan,
	PortalBaseOverlapPlan,
	PortalFrameNodeResources,
	PortalFrameWorkPlan,
	SceneDomainTargetKind,
	SceneDomainTargetSnapshot,
	SamplerPolicyUpdate,
	EnvCellSystemLayerPayload,
	OutdoorBuildingsLayerPayload,
	OutdoorDetailsLayerPayload,
	RendererStaticLayerVisibility,
	TerrainLayerPayload,
	StaticTextureBinding,
	TextureBindingOwner,
	TexturePlacementUpdate,
} from "../types";
import {
	createTextureBindingOwnerKey,
	DEFAULT_RENDERER_STATIC_LAYER_VISIBILITY,
	MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW,
	MAX_STATIC_OBJECT_DETAIL_PAGES_PER_DRAW,
	MAX_STATIC_OBJECT_INDEX_PAGES_PER_DRAW,
	MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
	MAX_STATIC_OBJECT_PALETTE_PAGES_PER_DRAW,
	MAX_TERRAIN_COLOR_PAGES_PER_DRAW,
	MAX_TERRAIN_MASK_PAGES_PER_DRAW,
	createStaticLandblockLayerKey,
} from "../types";
import type {
	StaticObjectGeometryStaticDrawUnit,
	StaticObjectRenderInstance,
	StaticObjectRenderState,
	StaticObjectSortMetadata,
	StaticObjectVisualResource,
	StaticPortalApertureResource,
	StaticPortalApertureRange,
	StructuredInteriorGeometryStaticDrawUnit,
	TerrainGeometryStaticDrawUnit,
} from "../../static/contracts";
import {
	type TextureFilteringMode,
	type TextureWrapMode,
} from "../../textures/sampling-policy";
import { createOutdoorLandblockRootTranslation } from "../../static/placement";
import {
	Webgl2StateCache,
	type Webgl2BlendState,
	type Webgl2DepthState,
	type Webgl2StencilState,
} from "../../../lib/webgl2/webgl2-state-cache";
import {
	createStaticObjectPreparedDrawPayloadState,
	markStaticObjectPreparedDrawPayloadDirty,
	prepareStaticObjectDrawPayloadState,
	type StaticObjectPreparedMaterialUniforms,
	type StaticObjectPreparedDrawPayload,
	type StaticObjectPreparedDrawPayloadState,
	type StaticObjectPreparedRolePageBindings,
} from "./webgl2-static-object-payloads";
import {
	createTerrainPreparedLayeredPayloadState,
	markTerrainPreparedLayeredPayloadDirty,
	prepareTerrainLayeredPayloadState,
	TERRAIN_LAYERED_MAX_LAYER_ENTRIES,
	TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER,
	TERRAIN_LAYERED_MAX_ROADS_PER_LAYER,
	type TerrainPreparedDetailUniforms,
	type TerrainPreparedLayerRects,
	type TerrainPreparedLayeredPayload,
	type TerrainPreparedLayeredPayloadState,
	type TerrainPreparedRolePageBindings,
} from "./webgl2-terrain-payloads";

type DirectEnvCellPortalFrameWorkPlan = Extract<
	PortalFrameWorkPlan,
	{ readonly kind: "direct-env-cell" }
>;
type DirectEnvCellPortalProjectionFrameWorkPlan = Extract<
	DirectEnvCellPortalFrameWorkPlan,
	{ readonly kind: "direct-env-cell" }
> & {
	readonly mode: "portal-projection";
	readonly layeredGraph: PortalProjectionFrameGraphPlan;
};

function createEmptyPortalBaseOverlapPlan(): PortalBaseOverlapPlan {
	return {
		diagnostics: {
			envCellCount: 0,
			missingResourceEnvCellCount: 0,
		},
		envCells: [],
		overlapSignature: "none",
		requiresExteriorSeed: false,
	};
}

const TERRAIN_ATLAS_MIP_GRADIENT_SCALE = 0.5;
const CAMERA_NEAR_PLANE = 0.1;
const CAMERA_FAR_PLANE = 2500;
const TERRAIN_COLOR_TEXTURE_UNIT_BASE = 1;
const TERRAIN_MASK_TEXTURE_UNIT_BASE =
	TERRAIN_COLOR_TEXTURE_UNIT_BASE + MAX_TERRAIN_COLOR_PAGES_PER_DRAW;
const TERRAIN_DETAIL_TEXTURE_UNIT =
	TERRAIN_MASK_TEXTURE_UNIT_BASE + MAX_TERRAIN_MASK_PAGES_PER_DRAW;
const STATIC_OBJECT_BASE_COLOR_TEXTURE_UNIT_BASE = 0;
const STATIC_OBJECT_INDEX_TEXTURE_UNIT_BASE =
	STATIC_OBJECT_BASE_COLOR_TEXTURE_UNIT_BASE +
	MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW;
const STATIC_OBJECT_PALETTE_TEXTURE_UNIT_BASE =
	STATIC_OBJECT_INDEX_TEXTURE_UNIT_BASE +
	MAX_STATIC_OBJECT_INDEX_PAGES_PER_DRAW;
const STATIC_OBJECT_DETAIL_TEXTURE_UNIT_BASE =
	STATIC_OBJECT_PALETTE_TEXTURE_UNIT_BASE +
	MAX_STATIC_OBJECT_PALETTE_PAGES_PER_DRAW;
const SOURCE_SCENE_COPY_COLOR_TEXTURE_UNIT = 0;
const SOURCE_SCENE_COPY_DEPTH_TEXTURE_UNIT = 1;
const OUTDOOR_CROSSING_STENCIL_VALUE = 0xfe;
const DEBUG_OVERLAY_FLOATS_PER_VERTEX = 7;
// Visual-quality/perf tradeoff: sort only transparent statics close enough for
// object-order artifacts to be obvious.
const NEAR_TRANSPARENT_STATIC_SORT_DISTANCE = 16;
const NEAR_TRANSPARENT_STATIC_SORT_DISTANCE_SQUARED =
	NEAR_TRANSPARENT_STATIC_SORT_DISTANCE * NEAR_TRANSPARENT_STATIC_SORT_DISTANCE;
const RECENT_STATIC_OBJECT_UPLOAD_DIAGNOSTICS_LIMIT = 20;
const RECENT_DYNAMIC_RESOURCE_COMMIT_DIAGNOSTICS_LIMIT = 16;
const STATIC_OBJECT_INSTANCE_TRANSFORM_ATTRIBUTE_LOCATION = 3;
const STATIC_OBJECT_INSTANCE_TRANSFORM_FLOATS = 16;
const EMPTY_STATIC_TEXTURE_BINDINGS: ReadonlyMap<string, StaticTextureBinding> =
	new Map();

interface StaticLayerResourceOwnership {
	readonly drawUnitIds: Set<string>;
	readonly staticObjectRenderInstanceIds: Set<string>;
	readonly staticObjectVisualResourceIds: Set<string>;
	readonly portalApertureResourceIds: Set<string>;
	readonly textureBindingOwnerKeys: Set<string>;
}

interface StaticObjectMaterialPassDrawCallAccumulator {
	additive: number;
	alphaTest: number;
	opaque: number;
	transparent: number;
}

const defaultFrameState: FrameState = {
	camera: {
		position: [96, 120, 260],
		yawRadians: 0,
		pitchRadians: -0.45,
	},
	timeSeconds: 0,
};

const TERRAIN_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec2 texCoord;
layout(location = 2) in float layerSlot;

uniform mat4 uModelViewProjection;
uniform vec3 uPlacementTranslation;

out vec2 vTexCoord;
out vec3 vWorldPosition;
flat out int vLayerSlot;

void main() {
	vec3 worldPosition = position + uPlacementTranslation;
	vTexCoord = texCoord;
	vWorldPosition = worldPosition;
	vLayerSlot = int(layerSlot);
	gl_Position = uModelViewProjection * vec4(worldPosition, 1.0);
}
`;

const STATIC_OBJECT_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec2 texCoord;
layout(location = 2) in float materialSlot;
layout(location = 3) in mat4 instanceObjectTransform;

uniform mat4 uModelViewProjection;
uniform mat4 uObjectTransform;
uniform int uUseInstanceObjectTransform;

out vec2 vTexCoord;
flat out int vMaterialSlot;

void main() {
	vTexCoord = texCoord;
	vMaterialSlot = int(materialSlot);
	mat4 objectTransform = uUseInstanceObjectTransform == 1
		? instanceObjectTransform
		: uObjectTransform;
	gl_Position = uModelViewProjection * objectTransform * vec4(position, 1.0);
}
`;

export const DEBUG_OVERLAY_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec4 color;

uniform mat4 uModelViewProjection;

out vec4 vColor;

void main() {
	vColor = color;
	gl_Position = uModelViewProjection * vec4(position, 1.0);
}
`;

export const DEBUG_OVERLAY_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 vColor;
out vec4 fragColor;

void main() {
	fragColor = vColor;
}
`;

const TRANSITION_APERTURE_COMPOSITE_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;

uniform mat4 uModelViewProjection;
uniform vec3 uPlacementTranslation;

void main() {
	gl_Position = uModelViewProjection * vec4(position + uPlacementTranslation, 1.0);
}
`;

const TRANSITION_APERTURE_MASK_FRAGMENT_SHADER = `#version 300 es
precision highp float;

void main() {
}
`;

const SOURCE_SCENE_COPY_VERTEX_SHADER = `#version 300 es
precision highp float;

const vec2 POSITIONS[3] = vec2[3](
	vec2(-1.0, -1.0),
	vec2(3.0, -1.0),
	vec2(-1.0, 3.0)
);

void main() {
	vec2 position = POSITIONS[gl_VertexID];
	gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const SOURCE_SCENE_COPY_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uSourceSceneColor;
uniform sampler2D uSourceSceneDepth;

out vec4 fragColor;

void main() {
	ivec2 textureExtent = textureSize(uSourceSceneColor, 0);
	ivec2 texelCoord = clamp(ivec2(gl_FragCoord.xy), ivec2(0), textureExtent - ivec2(1));
	vec4 sourceColor = texelFetch(uSourceSceneColor, texelCoord, 0);
	float sourceDepth = texelFetch(uSourceSceneDepth, texelCoord, 0).r;
	fragColor = sourceColor;
	gl_FragDepth = sourceDepth;
}
`;

export const DIRECT_PORTAL_DEPTH_RESET_FRAGMENT_SHADER = `#version 300 es
precision highp float;

out vec4 fragColor;

void main() {
	fragColor = vec4(0.0);
	gl_FragDepth = 1.0;
}
`;

export const STATIC_OBJECT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uStaticBaseColorTexture0;
uniform sampler2D uStaticBaseColorTexture1;
uniform sampler2D uStaticBaseColorTexture2;
uniform sampler2D uStaticBaseColorTexture3;
uniform vec2 uStaticBaseColorSizes[${MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW}];
uniform sampler2D uStaticIndexTexture0;
uniform sampler2D uStaticIndexTexture1;
uniform sampler2D uStaticIndexTexture2;
uniform sampler2D uStaticIndexTexture3;
uniform sampler2D uStaticPaletteTexture0;
uniform sampler2D uStaticPaletteTexture1;
uniform sampler2D uStaticPaletteTexture2;
uniform sampler2D uStaticPaletteTexture3;
uniform vec2 uStaticPaletteSizes[${MAX_STATIC_OBJECT_PALETTE_PAGES_PER_DRAW}];
uniform sampler2D uStaticDetailTexture0;
uniform sampler2D uStaticDetailTexture1;
uniform sampler2D uStaticDetailTexture2;
uniform sampler2D uStaticDetailTexture3;
uniform vec2 uStaticDetailSizes[${MAX_STATIC_OBJECT_DETAIL_PAGES_PER_DRAW}];
uniform vec4 uMaterialBaseColorRects[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform int uMaterialBaseColorPages[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform vec4 uMaterialIndexTextureRects[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform int uMaterialIndexTexturePages[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform vec4 uMaterialPaletteTextureRects[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform int uMaterialPaletteTexturePages[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform vec4 uMaterialDetailTextureRects[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform int uMaterialDetailTexturePages[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform float uMaterialPaletteFirstIndices[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform float uMaterialDetailTilings[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform int uMaterialDetailEnabled[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform float uMaterialAlphaTests[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform float uMaterialIndexedClipThresholds[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform vec4 uMaterialColors[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform vec3 uMaterialEmissiveColors[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform int uMaterialIndexedTextureFormats[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform int uMaterialModes[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];
uniform int uMaterialWrapModes[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];

in vec2 vTexCoord;
flat in int vMaterialSlot;

out vec4 fragColor;

int materialSlot() {
	return clamp(vMaterialSlot, 0, ${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW - 1});
}

vec2 resolveWrappedUv(vec2 uv) {
	return uMaterialWrapModes[materialSlot()] == 1 ? fract(uv) : clamp(uv, vec2(0.0), vec2(0.999999));
}

ivec2 resolveIndexSampleCoord(ivec2 baseCoord, ivec2 offset) {
	int slot = materialSlot();
	ivec2 size = ivec2(uMaterialIndexTextureRects[slot].zw);
	ivec2 coord = baseCoord + offset;
	if (uMaterialWrapModes[materialSlot()] == 1) {
		coord = ivec2(
			((coord.x % size.x) + size.x) % size.x,
			((coord.y % size.y) + size.y) % size.y
		);
	} else {
		coord = clamp(coord, ivec2(0), size - ivec2(1));
	}
	return coord;
}

vec4 sampleStaticBaseColorPage(int page, vec4 rect, vec2 localUv) {
	vec2 atlasSize = uStaticBaseColorSizes[0];
	if (page == 1) {
		atlasSize = uStaticBaseColorSizes[1];
		vec2 atlasUv = (rect.xy + localUv * rect.zw) / atlasSize;
		return texture(uStaticBaseColorTexture1, atlasUv);
	}
	if (page == 2) {
		atlasSize = uStaticBaseColorSizes[2];
		vec2 atlasUv = (rect.xy + localUv * rect.zw) / atlasSize;
		return texture(uStaticBaseColorTexture2, atlasUv);
	}
	if (page == 3) {
		atlasSize = uStaticBaseColorSizes[3];
		vec2 atlasUv = (rect.xy + localUv * rect.zw) / atlasSize;
		return texture(uStaticBaseColorTexture3, atlasUv);
	}
	vec2 atlasUv = (rect.xy + localUv * rect.zw) / atlasSize;
	return texture(uStaticBaseColorTexture0, atlasUv);
}

vec4 fetchStaticIndexPage(int page, ivec2 atlasCoord) {
	if (page == 1) {
		return texelFetch(uStaticIndexTexture1, atlasCoord, 0);
	}
	if (page == 2) {
		return texelFetch(uStaticIndexTexture2, atlasCoord, 0);
	}
	if (page == 3) {
		return texelFetch(uStaticIndexTexture3, atlasCoord, 0);
	}
	return texelFetch(uStaticIndexTexture0, atlasCoord, 0);
}

vec4 sampleStaticPalettePage(int page, vec4 rect, float paletteLocalX) {
	vec2 atlasSize = uStaticPaletteSizes[0];
	if (page == 1) {
		atlasSize = uStaticPaletteSizes[1];
		vec2 paletteUv = (rect.xy + vec2(paletteLocalX + 0.5, 0.5)) / atlasSize;
		return texture(uStaticPaletteTexture1, paletteUv);
	}
	if (page == 2) {
		atlasSize = uStaticPaletteSizes[2];
		vec2 paletteUv = (rect.xy + vec2(paletteLocalX + 0.5, 0.5)) / atlasSize;
		return texture(uStaticPaletteTexture2, paletteUv);
	}
	if (page == 3) {
		atlasSize = uStaticPaletteSizes[3];
		vec2 paletteUv = (rect.xy + vec2(paletteLocalX + 0.5, 0.5)) / atlasSize;
		return texture(uStaticPaletteTexture3, paletteUv);
	}
	vec2 paletteUv = (rect.xy + vec2(paletteLocalX + 0.5, 0.5)) / atlasSize;
	return texture(uStaticPaletteTexture0, paletteUv);
}

vec4 sampleStaticDetailPage(int page, vec4 rect, vec2 localUv) {
	vec2 atlasSize = uStaticDetailSizes[0];
	if (page == 1) {
		atlasSize = uStaticDetailSizes[1];
		vec2 atlasUv = (rect.xy + localUv * rect.zw) / atlasSize;
		return texture(uStaticDetailTexture1, atlasUv);
	}
	if (page == 2) {
		atlasSize = uStaticDetailSizes[2];
		vec2 atlasUv = (rect.xy + localUv * rect.zw) / atlasSize;
		return texture(uStaticDetailTexture2, atlasUv);
	}
	if (page == 3) {
		atlasSize = uStaticDetailSizes[3];
		vec2 atlasUv = (rect.xy + localUv * rect.zw) / atlasSize;
		return texture(uStaticDetailTexture3, atlasUv);
	}
	vec2 atlasUv = (rect.xy + localUv * rect.zw) / atlasSize;
	return texture(uStaticDetailTexture0, atlasUv);
}

float paletteIndexAt(ivec2 coord) {
	int slot = materialSlot();
	ivec2 atlasCoord = ivec2(floor(uMaterialIndexTextureRects[slot].xy + vec2(0.5))) + coord;
	vec4 packed = fetchStaticIndexPage(uMaterialIndexTexturePages[slot], atlasCoord) * 255.0;
	if (uMaterialIndexedTextureFormats[slot] == 1) {
		return floor(packed.r + 0.5) + floor(packed.g + 0.5) * 256.0;
	}
	return floor(packed.r + 0.5);
}

vec4 paletteColor(float index) {
	int slot = materialSlot();
	if (
		uMaterialIndexedClipThresholds[slot] >= 0.0 &&
		index < uMaterialIndexedClipThresholds[slot]
	) {
		return vec4(0.0);
	}
	vec4 rect = uMaterialPaletteTextureRects[slot];
	float paletteIndex = index - uMaterialPaletteFirstIndices[slot];
	float paletteLocalX = clamp(paletteIndex, 0.0, max(rect.z - 1.0, 0.0));
	return sampleStaticPalettePage(uMaterialPaletteTexturePages[slot], rect, paletteLocalX);
}

vec4 sampleIndexedPaletteLinear(vec2 uv) {
	int slot = materialSlot();
	vec2 texelPosition = resolveWrappedUv(uv) * uMaterialIndexTextureRects[slot].zw;
	ivec2 baseCoord = ivec2(floor(texelPosition));
	vec2 blend = fract(texelPosition);
	vec4 top = mix(
		paletteColor(paletteIndexAt(resolveIndexSampleCoord(baseCoord, ivec2(0, 0)))),
		paletteColor(paletteIndexAt(resolveIndexSampleCoord(baseCoord, ivec2(1, 0)))),
		blend.x
	);
	vec4 bottom = mix(
		paletteColor(paletteIndexAt(resolveIndexSampleCoord(baseCoord, ivec2(0, 1)))),
		paletteColor(paletteIndexAt(resolveIndexSampleCoord(baseCoord, ivec2(1, 1)))),
		blend.x
	);
	return mix(top, bottom, blend.y);
}

vec4 sampleDetailOverlay(vec2 uv) {
	int slot = materialSlot();
	vec2 localUv = fract(uv * uMaterialDetailTilings[slot]);
	return sampleStaticDetailPage(
		uMaterialDetailTexturePages[slot],
		uMaterialDetailTextureRects[slot],
		localUv
	);
}

void main() {
	int slot = materialSlot();
	int materialMode = uMaterialModes[slot];
	if (materialMode == 2) {
		fragColor = vec4(1.0, 0.0, 1.0, 1.0);
		return;
	}

	vec4 baseColor = vec4(1.0);
	if (materialMode == 1) {
		vec2 localUv = resolveWrappedUv(vTexCoord);
		baseColor = sampleStaticBaseColorPage(
			uMaterialBaseColorPages[slot],
			uMaterialBaseColorRects[slot],
			localUv
		);
	} else if (materialMode == 3) {
		baseColor = sampleIndexedPaletteLinear(vTexCoord);
	}

	vec3 rgb = min(baseColor.rgb * uMaterialColors[slot].rgb + uMaterialEmissiveColors[slot], vec3(1.0));
	if (uMaterialDetailEnabled[slot] == 1) {
		vec4 detailColor = sampleDetailOverlay(vTexCoord);
		float detailAlpha = clamp(detailColor.a, 0.0, 1.0);
		rgb = clamp(rgb * (detailColor.rgb + (1.0 - detailAlpha)), vec3(0.0), vec3(1.0));
	}

	fragColor = vec4(
		rgb,
		baseColor.a * uMaterialColors[slot].a
	);
	if (fragColor.a < uMaterialAlphaTests[slot]) {
		discard;
	}
}
`;

export const TERRAIN_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec4 uColor;
uniform sampler2D uTexture;
uniform vec4 uTextureRect;
uniform vec2 uTextureSize;
uniform bool uUseTexture;
uniform int uMaterialMode;
uniform sampler2D uColorAtlasTexture0;
uniform sampler2D uColorAtlasTexture1;
uniform sampler2D uColorAtlasTexture2;
uniform sampler2D uColorAtlasTexture3;
uniform vec2 uColorAtlasSizes[${MAX_TERRAIN_COLOR_PAGES_PER_DRAW}];
uniform sampler2D uMaskAtlasTexture0;
uniform sampler2D uMaskAtlasTexture1;
uniform sampler2D uMaskAtlasTexture2;
uniform sampler2D uMaskAtlasTexture3;
uniform vec2 uMaskAtlasSizes[${MAX_TERRAIN_MASK_PAGES_PER_DRAW}];
uniform sampler2D uDetailAtlasTexture;
uniform vec2 uDetailAtlasSize;
uniform vec4 uDetailAtlasRect;
uniform float uDetailTiling;
uniform float uDetailFadeNear;
uniform float uDetailFadeFar;
uniform int uDetailEnabled;
uniform vec3 uCameraPosition;
uniform vec4 uLayerBaseColorRects[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES}];
uniform int uLayerBaseColorPages[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES}];
uniform float uLayerBaseTilings[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES}];
uniform vec4 uLayerOverlayColorRects[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER}];
uniform int uLayerOverlayColorPages[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER}];
uniform vec4 uLayerOverlayMaskRects[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER}];
uniform int uLayerOverlayMaskPages[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER}];
uniform float uLayerOverlayTilings[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER}];
uniform int uLayerOverlayRotations[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER}];
uniform int uLayerOverlayCounts[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES}];
uniform vec4 uLayerRoadColorRects[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES}];
uniform int uLayerRoadColorPages[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES}];
uniform vec4 uLayerRoadMaskRects[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_ROADS_PER_LAYER}];
uniform int uLayerRoadMaskPages[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_ROADS_PER_LAYER}];
uniform float uLayerRoadTilings[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES}];
uniform int uLayerRoadRotations[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_ROADS_PER_LAYER}];
uniform int uLayerRoadCounts[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES}];

in vec2 vTexCoord;
in vec3 vWorldPosition;
flat in int vLayerSlot;

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

vec4 sampleAtlasRect(sampler2D atlasTexture, vec2 atlasSize, vec4 rect, vec2 localUv, vec2 gradX, vec2 gradY) {
	vec2 atlasUv = (rect.xy + localUv * rect.zw) / atlasSize;
	vec2 atlasGradX = gradX * rect.zw / atlasSize * ${TERRAIN_ATLAS_MIP_GRADIENT_SCALE.toFixed(8)};
	vec2 atlasGradY = gradY * rect.zw / atlasSize * ${TERRAIN_ATLAS_MIP_GRADIENT_SCALE.toFixed(8)};
	return textureGrad(atlasTexture, atlasUv, atlasGradX, atlasGradY);
}

vec4 sampleColorPage(int page, vec4 rect, vec2 localUv, vec2 gradX, vec2 gradY) {
	if (page == 1) {
		return sampleAtlasRect(uColorAtlasTexture1, uColorAtlasSizes[1], rect, localUv, gradX, gradY);
	}
	if (page == 2) {
		return sampleAtlasRect(uColorAtlasTexture2, uColorAtlasSizes[2], rect, localUv, gradX, gradY);
	}
	if (page == 3) {
		return sampleAtlasRect(uColorAtlasTexture3, uColorAtlasSizes[3], rect, localUv, gradX, gradY);
	}
	return sampleAtlasRect(uColorAtlasTexture0, uColorAtlasSizes[0], rect, localUv, gradX, gradY);
}

float sampleMaskPage(int page, vec4 rect, vec2 localUv) {
	vec2 atlasSize = uMaskAtlasSizes[0];
	vec2 atlasUv = vec2(0.0);
	if (page == 1) {
		atlasSize = uMaskAtlasSizes[1];
		atlasUv = (rect.xy + localUv * rect.zw) / atlasSize;
		return texture(uMaskAtlasTexture1, atlasUv).r;
	}
	if (page == 2) {
		atlasSize = uMaskAtlasSizes[2];
		atlasUv = (rect.xy + localUv * rect.zw) / atlasSize;
		return texture(uMaskAtlasTexture2, atlasUv).r;
	}
	if (page == 3) {
		atlasSize = uMaskAtlasSizes[3];
		atlasUv = (rect.xy + localUv * rect.zw) / atlasSize;
		return texture(uMaskAtlasTexture3, atlasUv).r;
	}
	atlasUv = (rect.xy + localUv * rect.zw) / atlasSize;
	return texture(uMaskAtlasTexture0, atlasUv).r;
}

vec4 sampleRepeatingColor(int page, vec4 rect, float tiling) {
	vec2 tiledUv = vTexCoord * tiling;
	return sampleColorPage(
		page,
		rect,
		fract(tiledUv),
		dFdx(tiledUv),
		dFdy(tiledUv)
	);
}

vec4 sampleRepeatingDetail() {
	vec2 tiledUv = vTexCoord * uDetailTiling;
	return sampleAtlasRect(
		uDetailAtlasTexture,
		uDetailAtlasSize,
		uDetailAtlasRect,
		fract(tiledUv),
		dFdx(tiledUv),
		dFdy(tiledUv)
	);
}

float terrainDetailFade() {
	float cameraDistance = length(vWorldPosition - uCameraPosition);
	return clamp(
		(uDetailFadeFar - cameraDistance) / max(uDetailFadeFar - uDetailFadeNear, 0.0001),
		0.0,
		1.0
	);
}

float sampleMask(int page, vec4 rect, int rotation) {
	vec2 maskUv = rotateLegacyAlphaUv(legacyAlphaUv(vTexCoord), rotation);
	return sampleMaskPage(page, rect, maskUv);
}

vec4 sampleLayeredTerrain() {
	int layer = clamp(vLayerSlot, 0, ${TERRAIN_LAYERED_MAX_LAYER_ENTRIES - 1});
	vec4 color = sampleRepeatingColor(
		uLayerBaseColorPages[layer],
		uLayerBaseColorRects[layer],
		uLayerBaseTilings[layer]
	);
	for (int overlayIndex = 0; overlayIndex < ${TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER}; overlayIndex += 1) {
		if (overlayIndex >= uLayerOverlayCounts[layer]) {
			break;
		}
		int index = layer * ${TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER} + overlayIndex;
		vec4 overlayColor = sampleRepeatingColor(
			uLayerOverlayColorPages[index],
			uLayerOverlayColorRects[index],
			uLayerOverlayTilings[index]
		);
		float alpha = sampleMask(
			uLayerOverlayMaskPages[index],
			uLayerOverlayMaskRects[index],
			uLayerOverlayRotations[index]
		);
		color = mix(color, overlayColor, clamp(1.0 - alpha, 0.0, 1.0));
	}
	if (uLayerRoadCounts[layer] > 0) {
		vec4 roadColor = sampleRepeatingColor(
			uLayerRoadColorPages[layer],
			uLayerRoadColorRects[layer],
			uLayerRoadTilings[layer]
		);
		int roadBaseIndex = layer * ${TERRAIN_LAYERED_MAX_ROADS_PER_LAYER};
		float roadAlpha = 1.0 - sampleMask(
			uLayerRoadMaskPages[roadBaseIndex],
			uLayerRoadMaskRects[roadBaseIndex],
			uLayerRoadRotations[roadBaseIndex]
		);
		if (uLayerRoadCounts[layer] > 1) {
			roadAlpha = 1.0 - (
				sampleMask(uLayerRoadMaskPages[roadBaseIndex], uLayerRoadMaskRects[roadBaseIndex], uLayerRoadRotations[roadBaseIndex]) *
				sampleMask(uLayerRoadMaskPages[roadBaseIndex + 1], uLayerRoadMaskRects[roadBaseIndex + 1], uLayerRoadRotations[roadBaseIndex + 1])
			);
		}
		color = mix(color, roadColor, clamp(roadAlpha, 0.0, 1.0));
	}
	if (uDetailEnabled == 1) {
		vec4 detailColor = sampleRepeatingDetail();
		float detailWeight = clamp(detailColor.a * terrainDetailFade(), 0.0, 1.0);
		color.rgb = mix(color.rgb, detailColor.rgb, detailWeight);
	}
	return vec4(color.rgb, 1.0);
}

void main() {
	if (uMaterialMode == 2) {
		fragColor = sampleLayeredTerrain();
		return;
	}
	vec2 localUv = fract(vTexCoord);
	vec2 atlasUv = (uTextureRect.xy + localUv * uTextureRect.zw) / uTextureSize;
	vec2 atlasGradX = dFdx(vTexCoord) * uTextureRect.zw / uTextureSize * ${TERRAIN_ATLAS_MIP_GRADIENT_SCALE.toFixed(8)};
	vec2 atlasGradY = dFdy(vTexCoord) * uTextureRect.zw / uTextureSize * ${TERRAIN_ATLAS_MIP_GRADIENT_SCALE.toFixed(8)};
	vec4 textureColor = textureGrad(uTexture, atlasUv, atlasGradX, atlasGradY);
	fragColor = uUseTexture ? textureColor : uColor;
}
`;

export function createWebgl2Renderer(canvas: HTMLCanvasElement): Renderer {
	const gl = canvas.getContext("webgl2", {
		alpha: false,
		antialias: false,
		depth: true,
		stencil: true,
	});

	if (!gl) {
		throw new Error("WebGL2 is not available in this browser.");
	}

	return new Webgl2Renderer(canvas, gl);
}

class Webgl2Renderer implements Renderer {
	readonly #canvas: HTMLCanvasElement;
	readonly #gl: WebGL2RenderingContext;
	readonly #telemetryListeners = new Set<RendererFrameTelemetryListener>();
	readonly #terrainResources = new Map<string, TerrainGeometryResource>();
	readonly #staticObjectResources = new Map<
		string,
		StaticObjectGeometryResource
	>();
	readonly #staticObjectVisualResources = new Map<
		string,
		StaticObjectVisualGeometryResource
	>();
		readonly #dynamicVisualResources = new Map<
			string,
			DynamicRendererVisualResource
		>();
		readonly #dynamicGeometryResources = new Map<
			string,
			DynamicVisualGeometryResource[]
		>();
		readonly #dynamicInstances = new Map<string, DynamicRendererInstance>();
	readonly #staticObjectRenderInstances = new Map<
		string,
		StaticObjectRenderInstance
	>();
	readonly #structuredInteriorResources = new Map<
		string,
		StructuredInteriorGeometryResource
	>();
	readonly #structuredInteriorResourceIdsByEnvCellKey = new Map<
		string,
		Set<string>
	>();
	readonly #envCellStaticObjectResourceIdsByEnvCellKey = new Map<
		string,
		Set<string>
	>();
	readonly #portalApertureResources = new Map<
		string,
		PortalApertureGeometryResource
	>();
	readonly #portalApertureRangesById = new Map<
		string,
		PortalApertureRangeResource
	>();
	readonly #textures = new Map<string, WebGLTexture>();
	readonly #textureBindings = new Map<
		string,
		Map<string, StaticTextureBinding>
	>();
	readonly #staticLayerOwnershipByKey = new Map<
		string,
		StaticLayerResourceOwnership
	>();
	readonly #recentStaticObjectUploads: StaticObjectUploadDiagnostics[] = [];
	#recentDynamicResourceCommits: DynamicRendererResourceCommitDiagnostics[] = [];
	#lastDynamicDrawCalls = 0;
	#lastSkippedDynamicSubmissions = 0;
	readonly #warnedLayeredFallbackDrawUnitIds = new Set<string>();
	readonly #warnedMissingPortalApertureRangeIds = new Set<string>();
	readonly #terrainProgram: TerrainGeometryProgram;
	readonly #staticObjectProgram: StaticObjectGeometryProgram;
	readonly #debugOverlayProgram: DebugOverlayProgram;
	readonly #transitionCompositeProgram: TransitionApertureCompositeProgram;
	readonly #sourceSceneCopyProgram: SourceSceneCopyProgram;
	readonly #directPortalDepthResetProgram: DirectPortalDepthResetProgram;
	readonly #sourceSceneCopyVertexArray: WebGLVertexArrayObject;
	readonly #staticObjectInstanceTransformBuffer: WebGLBuffer;
	readonly #debugOverlayVertexArray: WebGLVertexArrayObject;
	readonly #debugOverlayVertexBuffer: WebGLBuffer;
	readonly #stateCache: Webgl2StateCache;
	#sceneDomainTargets: SceneDomainTargets | null = null;
	readonly #farTransparentStaticObjectDrawList: StaticObjectGeometryResource[] =
		[];
	readonly #farTransparentStaticObjectInstanceDrawList: StaticObjectInstanceDrawResource[] =
		[];
	readonly #nearTransparentStaticObjectDrawEntries: StaticObjectTransparentDrawEntry[] =
		[];
	readonly #transparentStaticObjectDrawEntryPool: StaticObjectTransparentDrawEntry[] =
		[];
	#transparentStaticObjectDrawEntryPoolActiveCount = 0;
	#animationFrameId: number | null = null;
	#disposed = false;
	#frameCount = 0;
	#frameHandlerMs = 0;
	#frameState = defaultFrameState;
	#staticRenderAnchorLandblockId: number | null = null;
	#renderPassPlan: RenderPassPlan = { kind: "single-surface-resident" };
	#portalFrameWorkPlan: PortalFrameWorkPlan = {
		kind: "legacy-render-pass",
		mode: "single-surface-resident",
		renderPassPlan: { kind: "single-surface-resident" },
	};
	#staticLayerVisibility = DEFAULT_RENDERER_STATIC_LAYER_VISIBILITY;
	#flatVisionModeEnabled = false;
	#lastExteriorSceneDomainDrawCalls = 0;
	#lastInteriorSceneDomainDrawCalls = 0;
	#lastCompositePasses = 0;
	#lastCompositeApertureBatchDrawCalls = 0;
	#lastExecutedCompositeDepth = 0;
	#lastDirectEnvCellDrawCalls = 0;
	#lastCompositingMode: SceneDomainTargetSnapshot["compositingMode"] = "none";
	#lastExteriorSuffixCompositeDepth = 0;
	#lastExteriorSuffixCompositePasses = 0;
	#lastEnvCellOutdoorCrossingColorBase = false;
	#lastOutdoorCrossingSource: SceneDomainTargetSnapshot["outdoorCrossingSource"] =
		"none";
	#lastStaticObjectBakedDirectDrawCalls = 0;
	#lastOutdoorDetailStaticObjectBakedDirectDrawCalls = 0;
	#lastOutdoorDetailStaticObjectBakedDirectDrawCallsByPass =
		createEmptyStaticObjectMaterialPassDrawCallCounts();
	#lastStaticObjectDirectRenderInstanceDrawCalls = 0;
	#lastStaticObjectInstancedRenderInstanceDrawCalls = 0;
	#lastStaticObjectInstancedRenderInstances = 0;
	#lastStaticObjectNearTransparentDirectRenderInstanceDrawCalls = 0;
	#lastStaticObjectFarTransparentDirectRenderInstanceDrawCalls = 0;
	#lastStaticObjectFarTransparentInstancedRenderInstanceDrawCalls = 0;
	#lastStaticObjectFarTransparentInstancedRenderInstances = 0;
	#staticObjectInstanceTransformScratch = new Float32Array(0);
	#debugOverlayPrimitiveCount = 0;
	#debugOverlayLineVertexCount = 0;
	#debugOverlayTriangleVertexCount = 0;
	#error: string | null = null;

	constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
		this.#canvas = canvas;
		this.#gl = gl;
		this.#terrainProgram = createTerrainGeometryProgram(gl);
		this.#staticObjectProgram = createStaticObjectGeometryProgram(gl);
		this.#debugOverlayProgram = createDebugOverlayProgram(gl);
		this.#transitionCompositeProgram =
			createTransitionApertureCompositeProgram(gl);
		this.#sourceSceneCopyProgram = createSourceSceneCopyProgram(gl);
		this.#directPortalDepthResetProgram =
			createDirectPortalDepthResetProgram(gl);
		this.#stateCache = new Webgl2StateCache(gl);
		const sourceSceneCopyVertexArray = gl.createVertexArray();
		const staticObjectInstanceTransformBuffer = gl.createBuffer();
		const vertexArray = gl.createVertexArray();
		const vertexBuffer = gl.createBuffer();
		if (
			!sourceSceneCopyVertexArray ||
			!staticObjectInstanceTransformBuffer ||
			!vertexArray ||
			!vertexBuffer
		) {
			throw new Error("Failed to create renderer scratch resources.");
		}
		this.#sourceSceneCopyVertexArray = sourceSceneCopyVertexArray;
		this.#staticObjectInstanceTransformBuffer =
			staticObjectInstanceTransformBuffer;
		this.#debugOverlayVertexArray = vertexArray;
		this.#debugOverlayVertexBuffer = vertexBuffer;
		this.#configureDebugOverlayVertexArray();
		this.#startFrameLoop();
	}

	setTerrainLayer(
		landblockId: number,
		payload: TerrainLayerPayload | null,
	): void {
		this.#replaceStaticLayer(
			{ kind: "terrain", landblockId },
			payload,
			(ownership) => {
				for (const drawUnit of payload?.drawUnits ?? []) {
					this.#terrainResources.get(drawUnit.drawUnitId)?.dispose();
					this.#terrainResources.set(
						drawUnit.drawUnitId,
						createTerrainGeometryResource(this.#gl, drawUnit),
					);
					ownership.drawUnitIds.add(drawUnit.drawUnitId);
					ownership.textureBindingOwnerKeys.add(
						createTextureBindingOwnerKey({
							drawUnitId: drawUnit.drawUnitId,
							kind: "draw-unit",
						}),
					);
				}
			},
		);
	}

	setOutdoorBuildingsLayer(
		landblockId: number,
		payload: OutdoorBuildingsLayerPayload | null,
	): void {
		this.#replaceStaticLayer(
			{ kind: "outdoor-buildings", landblockId },
			payload,
			(ownership) => {
				const uploadStartedAt = nowMs();
				let uploadedBufferBytes = 0;
				let drawUnitCount = 0;
				for (const drawUnit of payload?.drawUnits ?? []) {
					this.#removeStaticObjectResource(drawUnit.drawUnitId);
					this.#addStaticObjectResource(
						createStaticObjectGeometryResource(this.#gl, drawUnit),
					);
					ownership.drawUnitIds.add(drawUnit.drawUnitId);
					ownership.textureBindingOwnerKeys.add(
						createTextureBindingOwnerKey({
							drawUnitId: drawUnit.drawUnitId,
							kind: "draw-unit",
						}),
					);
					uploadedBufferBytes +=
						estimateStaticObjectUploadedBufferBytes(drawUnit);
					drawUnitCount += 1;
				}
				if (payload && drawUnitCount > 0) {
					this.#recordStaticObjectUpload({
						domain: "outdoor-buildings",
						drawUnitCount,
						kind: "static-object-upload-diagnostics",
						landblockId,
						uploadedBufferBytes,
						uploadMs: nowMs() - uploadStartedAt,
					});
				}
			},
		);
	}

	setOutdoorDetailsLayer(
		landblockId: number,
		payload: OutdoorDetailsLayerPayload | null,
	): void {
		this.#replaceStaticLayer(
			{ kind: "outdoor-detail", landblockId },
			payload,
			(ownership) => {
				const uploadStartedAt = nowMs();
				let uploadedBufferBytes = 0;
				let drawUnitCount = 0;
				for (const drawUnit of payload?.drawUnits ?? []) {
					this.#removeStaticObjectResource(drawUnit.drawUnitId);
					this.#addStaticObjectResource(
						createStaticObjectGeometryResource(this.#gl, drawUnit),
					);
					ownership.drawUnitIds.add(drawUnit.drawUnitId);
					ownership.textureBindingOwnerKeys.add(
						createTextureBindingOwnerKey({
							drawUnitId: drawUnit.drawUnitId,
							kind: "draw-unit",
						}),
					);
					uploadedBufferBytes +=
						estimateStaticObjectUploadedBufferBytes(drawUnit);
					drawUnitCount += 1;
				}
				for (const resource of payload?.instancedObjectResources ?? []) {
					this.#removeStaticObjectVisualResource(resource.resourceId);
					this.#addStaticObjectVisualResource(
						createStaticObjectVisualGeometryResource(this.#gl, resource),
					);
					ownership.staticObjectVisualResourceIds.add(resource.resourceId);
					ownership.textureBindingOwnerKeys.add(
						createTextureBindingOwnerKey({
							kind: "static-object-visual-resource",
							resourceId: resource.resourceId,
						}),
					);
					uploadedBufferBytes +=
						estimateStaticObjectVisualResourceUploadedBufferBytes(resource);
				}
				for (const instance of payload?.instancedObjectInstances ?? []) {
					this.#staticObjectRenderInstances.set(instance.instanceId, instance);
					ownership.staticObjectRenderInstanceIds.add(instance.instanceId);
				}
				if (payload && drawUnitCount > 0) {
					this.#recordStaticObjectUpload({
						domain: "outdoor-detail",
						drawUnitCount,
						kind: "static-object-upload-diagnostics",
						landblockId,
						uploadedBufferBytes,
						uploadMs: nowMs() - uploadStartedAt,
					});
				}
			},
		);
	}

	setEnvCellSystemLayer(
		landblockId: number,
		payload: EnvCellSystemLayerPayload | null,
	): void {
		this.#replaceStaticLayer(
			{ kind: "env-cell-system", landblockId },
			payload,
			(ownership) => {
				const uploadStartedAt = nowMs();
				let uploadedBufferBytes = 0;
				let drawUnitCount = 0;
				for (const drawUnit of payload?.envCellStaticObjectDrawUnits ?? []) {
					this.#removeStaticObjectResource(drawUnit.drawUnitId);
					this.#addStaticObjectResource(
						createStaticObjectGeometryResource(this.#gl, drawUnit),
					);
					ownership.drawUnitIds.add(drawUnit.drawUnitId);
					ownership.textureBindingOwnerKeys.add(
						createTextureBindingOwnerKey({
							drawUnitId: drawUnit.drawUnitId,
							kind: "draw-unit",
						}),
					);
					uploadedBufferBytes +=
						estimateStaticObjectUploadedBufferBytes(drawUnit);
					drawUnitCount += 1;
				}
				if (payload && drawUnitCount > 0) {
					this.#recordStaticObjectUpload({
						domain: "landblock-env-cells",
						drawUnitCount,
						kind: "static-object-upload-diagnostics",
						landblockId,
						uploadedBufferBytes,
						uploadMs: nowMs() - uploadStartedAt,
					});
				}
				for (const drawUnit of payload?.structuredInteriorDrawUnits ?? []) {
					this.#removeStructuredInteriorResource(drawUnit.drawUnitId);
					this.#addStructuredInteriorResource(
						createStructuredInteriorGeometryResource(this.#gl, drawUnit),
					);
					ownership.drawUnitIds.add(drawUnit.drawUnitId);
					ownership.textureBindingOwnerKeys.add(
						createTextureBindingOwnerKey({
							drawUnitId: drawUnit.drawUnitId,
							kind: "draw-unit",
						}),
					);
				}
				for (const resource of payload?.portalApertureResources ?? []) {
					this.#addPortalApertureResource(resource);
					ownership.portalApertureResourceIds.add(resource.apertureResourceId);
				}
			},
		);
	}

		commitDynamicResources(commit: DynamicRendererResourceCommit): void {
			if (this.#disposed) {
				return;
			}
			for (const resourceId of commit.removedVisualResourceIds) {
				this.#dynamicVisualResources.delete(resourceId);
				this.#disposeDynamicGeometryResources(resourceId);
				for (const [instanceId, instance] of this.#dynamicInstances) {
					if (instance.resourceId === resourceId) {
						this.#dynamicInstances.delete(instanceId);
				}
			}
			this.#textureBindings.delete(
				createTextureBindingOwnerKey({
					kind: "dynamic-visual-resource",
					resourceId,
				}),
				);
			}
			for (const resource of commit.addedVisualResources) {
				this.#disposeDynamicGeometryResources(resource.resourceId);
				this.#dynamicVisualResources.set(resource.resourceId, resource);
				this.#dynamicGeometryResources.set(
					resource.resourceId,
					resource.parts.map((part) =>
						createDynamicVisualGeometryResource(this.#gl, resource, part),
					),
				);
			}
		this.#recentDynamicResourceCommits = appendBounded(
			this.#recentDynamicResourceCommits,
			createDynamicResourceCommitDiagnostics(commit),
			RECENT_DYNAMIC_RESOURCE_COMMIT_DIAGNOSTICS_LIMIT,
			);
			this.#stateCache.invalidate();
		}

		#disposeDynamicGeometryResources(resourceId: string): void {
			const resources = this.#dynamicGeometryResources.get(resourceId);
			if (!resources) {
				return;
			}
			for (const resource of resources) {
				resource.dispose();
			}
			this.#dynamicGeometryResources.delete(resourceId);
		}

		commitDynamicInstances(commit: DynamicRendererInstanceCommit): void {
		if (this.#disposed) {
			return;
		}
		this.#dynamicInstances.clear();
		let skipped = 0;
		for (const instance of commit.instances) {
			if (!this.#dynamicVisualResources.has(instance.resourceId)) {
				skipped += 1;
				continue;
			}
			this.#dynamicInstances.set(instance.instanceId, instance);
		}
		this.#lastSkippedDynamicSubmissions = skipped;
		this.#lastDynamicDrawCalls = 0;
		this.#stateCache.invalidate();
	}

	setStaticLayerVisibility(visibility: RendererStaticLayerVisibility): void {
		if (staticLayerVisibilityEquals(this.#staticLayerVisibility, visibility)) {
			return;
		}
		this.#staticLayerVisibility = visibility;
		this.#stateCache.invalidate();
	}

	setStaticRenderAnchorLandblockId(anchorLandblockId: number | null): void {
		this.#staticRenderAnchorLandblockId = anchorLandblockId;
	}

	setFlatVisionModeEnabled(enabled: boolean): void {
		if (this.#flatVisionModeEnabled === enabled) {
			return;
		}
		this.#flatVisionModeEnabled = enabled;
		this.#stateCache.invalidate();
	}

	setRenderPassPlan(plan: RenderPassPlan): void {
		this.#renderPassPlan = plan;
	}

	setPortalFrameWorkPlan(plan: PortalFrameWorkPlan): void {
		this.#portalFrameWorkPlan = plan;
	}

	setDebugOverlayPrimitives(
		primitives: readonly DebugOverlayPrimitive[],
	): void {
		if (this.#disposed) {
			return;
		}
		const overlay = createDebugOverlayVertices(primitives);
		const gl = this.#gl;
		gl.bindVertexArray(this.#debugOverlayVertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#debugOverlayVertexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, overlay.vertices, gl.DYNAMIC_DRAW);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		this.#stateCache.invalidate();
		this.#debugOverlayPrimitiveCount = primitives.length;
		this.#debugOverlayTriangleVertexCount = overlay.triangleVertexCount;
		this.#debugOverlayLineVertexCount = overlay.lineVertexCount;
	}

	applyTexturePlacementUpdate(update: TexturePlacementUpdate): void {
		const gl = this.#gl;
		let shouldMarkAllStaticPayloadsDirty =
			update.removedTextureRefIds.length > 0;
		let shouldMarkAllTerrainPayloadsDirty =
			update.removedTextureRefIds.length > 0;
		for (const textureRefId of update.removedTextureRefIds) {
			const texture = this.#textures.get(textureRefId);
			if (!texture) {
				continue;
			}
			gl.deleteTexture(texture);
			this.#textures.delete(textureRefId);
		}

		for (const placement of update.placements) {
			const texture = createTexturePage(gl, placement);
			const previousTexture = this.#textures.get(placement.textureRefId);
			if (previousTexture) {
				gl.deleteTexture(previousTexture);
			}
			this.#textures.set(placement.textureRefId, texture);
			shouldMarkAllStaticPayloadsDirty = true;
			shouldMarkAllTerrainPayloadsDirty = true;
		}
		if (update.placements.length > 0) {
			this.#stateCache.invalidate();
		}

			for (const binding of update.textureBindings) {
			const ownerKey = createTextureBindingOwnerKey(binding.owner);
			const bindings = this.#textureBindings.get(ownerKey) ?? new Map();
			bindings.set(binding.textureUseId, binding);
			this.#textureBindings.set(ownerKey, bindings);
			this.#markPreparedPayloadDirtyForTextureBindingOwner(binding.owner);
		}

		// Prepared payloads hold WebGLTexture handles. Without a reverse
		// texture-ref owner map, texture page adds/replacements/removals must
		// conservatively dirty all live payloads.
		if (shouldMarkAllStaticPayloadsDirty) {
			this.#markAllStaticObjectPreparedPayloadsDirty();
		}
		if (shouldMarkAllTerrainPayloadsDirty) {
			this.#markAllTerrainPreparedPayloadsDirty();
		}
	}

	applySamplerPolicyUpdate(update: SamplerPolicyUpdate): void {
		const gl = this.#gl;
		let didApplyPolicy = false;
		for (const policy of update.policies) {
			const texture = this.#textures.get(policy.textureRefId);
			if (!texture) {
				continue;
			}
			applyTextureSamplerPolicy(gl, texture, policy);
			didApplyPolicy = true;
		}
		if (didApplyPolicy) {
			this.#stateCache.invalidate();
		}
	}

	updateFrameState(state: FrameState): void {
		this.#frameState = state;
	}

	subscribeTelemetry(listener: RendererFrameTelemetryListener): () => void {
		this.#telemetryListeners.add(listener);
		listener(this.#createFrameTelemetry());

		return () => {
			this.#telemetryListeners.delete(listener);
		};
	}

	createDiagnosticsSnapshot(): RendererSnapshot {
		return this.#createSnapshot();
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}
		this.#disposed = true;

		if (this.#animationFrameId !== null) {
			cancelAnimationFrame(this.#animationFrameId);
			this.#animationFrameId = null;
		}

		for (const resource of this.#terrainResources.values()) {
			resource.dispose();
		}
		for (const resource of this.#staticObjectResources.values()) {
			resource.dispose();
		}
			for (const resource of this.#staticObjectVisualResources.values()) {
				resource.dispose();
			}
			for (const resources of this.#dynamicGeometryResources.values()) {
				for (const resource of resources) {
					resource.dispose();
				}
			}
			for (const resource of this.#structuredInteriorResources.values()) {
				resource.dispose();
			}
		for (const resource of this.#portalApertureResources.values()) {
			resource.dispose();
		}
		for (const texture of this.#textures.values()) {
			this.#gl.deleteTexture(texture);
		}
		this.#terrainResources.clear();
			this.#staticObjectResources.clear();
			this.#staticObjectVisualResources.clear();
			this.#dynamicVisualResources.clear();
			this.#dynamicGeometryResources.clear();
			this.#dynamicInstances.clear();
		this.#staticObjectRenderInstances.clear();
		this.#structuredInteriorResources.clear();
		this.#structuredInteriorResourceIdsByEnvCellKey.clear();
		this.#envCellStaticObjectResourceIdsByEnvCellKey.clear();
		this.#portalApertureResources.clear();
		this.#portalApertureRangesById.clear();
		this.#textures.clear();
		this.#textureBindings.clear();
		this.#staticLayerOwnershipByKey.clear();
		this.#recentDynamicResourceCommits.length = 0;
		this.#lastDynamicDrawCalls = 0;
		this.#lastSkippedDynamicSubmissions = 0;
		this.#warnedLayeredFallbackDrawUnitIds.clear();
		this.#warnedMissingPortalApertureRangeIds.clear();
		this.#terrainProgram.dispose();
		this.#staticObjectProgram.dispose();
		this.#debugOverlayProgram.dispose();
		this.#transitionCompositeProgram.dispose();
		this.#sourceSceneCopyProgram.dispose();
		this.#directPortalDepthResetProgram.dispose();
		this.#sceneDomainTargets?.dispose();
		this.#sceneDomainTargets = null;
		this.#gl.deleteBuffer(this.#staticObjectInstanceTransformBuffer);
		this.#gl.deleteBuffer(this.#debugOverlayVertexBuffer);
		this.#gl.deleteVertexArray(this.#debugOverlayVertexArray);
		this.#gl.deleteVertexArray(this.#sourceSceneCopyVertexArray);
		this.#telemetryListeners.clear();
	}

	#startFrameLoop(): void {
		const renderFrame = (timestampMilliseconds: number): void => {
			if (this.#disposed) {
				return;
			}

			const startedAt = performance.now();
			try {
				this.#render(timestampMilliseconds / 1000);
			} catch (error) {
				this.#error = error instanceof Error ? error.message : String(error);
				console.error("WebGL2 render frame failed.", error);
				this.#emitFrameTelemetry();
				this.dispose();
				return;
			}
			this.#frameHandlerMs = performance.now() - startedAt;
			this.#emitFrameTelemetry();

			this.#animationFrameId = requestAnimationFrame(renderFrame);
		};

		this.#animationFrameId = requestAnimationFrame(renderFrame);
	}

	#render(timeSeconds: number): void {
		this.#resizeToDisplaySize();
		this.#resetFramebufferTransferState();

		const frameTime = this.#frameState.timeSeconds || timeSeconds;
		const pulse = 0.5 + Math.sin(frameTime * 0.7) * 0.5;
		this.#lastExteriorSceneDomainDrawCalls = 0;
		this.#lastInteriorSceneDomainDrawCalls = 0;
		this.#lastCompositePasses = 0;
		this.#lastCompositeApertureBatchDrawCalls = 0;
		this.#lastExecutedCompositeDepth = 0;
		this.#lastDirectEnvCellDrawCalls = 0;
		this.#lastCompositingMode = "none";
		this.#lastExteriorSuffixCompositeDepth = 0;
		this.#lastExteriorSuffixCompositePasses = 0;
		this.#lastEnvCellOutdoorCrossingColorBase = false;
		this.#lastOutdoorCrossingSource = "none";
		this.#lastStaticObjectBakedDirectDrawCalls = 0;
		this.#lastOutdoorDetailStaticObjectBakedDirectDrawCalls = 0;
		this.#lastOutdoorDetailStaticObjectBakedDirectDrawCallsByPass =
			createEmptyStaticObjectMaterialPassDrawCallCounts();
		this.#lastStaticObjectDirectRenderInstanceDrawCalls = 0;
		this.#lastStaticObjectInstancedRenderInstanceDrawCalls = 0;
		this.#lastStaticObjectInstancedRenderInstances = 0;
			this.#lastStaticObjectNearTransparentDirectRenderInstanceDrawCalls = 0;
			this.#lastStaticObjectFarTransparentDirectRenderInstanceDrawCalls = 0;
			this.#lastStaticObjectFarTransparentInstancedRenderInstanceDrawCalls = 0;
			this.#lastStaticObjectFarTransparentInstancedRenderInstances = 0;
			this.#lastDynamicDrawCalls = 0;

		const effectiveRenderPassPlan = this.#getEffectiveRenderPassPlan();
		const directEnvCellFramePlan = this.#getEffectiveDirectEnvCellFramePlan();

		if (directEnvCellFramePlan) {
			this.#renderDirectEnvCellFramePlan(pulse, directEnvCellFramePlan);
		} else if (effectiveRenderPassPlan.kind === "single-surface-resident") {
			this.#renderSingleSurfaceResident(pulse);
		} else {
			this.#renderSceneDomainTargets(pulse, effectiveRenderPassPlan);
		}
		this.#drawDebugOverlay();

		this.#frameCount += 1;
	}

	#resetFramebufferTransferState(): void {
		const gl = this.#gl;
		gl.colorMask(true, true, true, true);
		gl.disable(gl.SCISSOR_TEST);
	}

	#renderSingleSurfaceResident(pulse: number): void {
		const gl = this.#gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		this.#stateCache.setViewport({
			height: gl.drawingBufferHeight,
			width: gl.drawingBufferWidth,
			x: 0,
			y: 0,
		});
		this.#stateCache.setDepthState(createDepthState(gl, true, true));
		gl.clearColor(0.025 + pulse * 0.015, 0.045, 0.065 + pulse * 0.025, 1);
		gl.clearDepth(1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		const aspectRatio =
			gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight);
		this.#drawTerrain(aspectRatio);
		this.#drawStaticObjects("single-surface-resident", aspectRatio);
	}

	#renderDirectEnvCellFramePlan(
		pulse: number,
		plan: DirectEnvCellPortalFrameWorkPlan,
	): void {
		const gl = this.#gl;
		const aspectRatio =
			gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight);
		const portalProjectionUsesExteriorBase =
			plan.layeredGraph.baseEntry.scene.kind === "outdoor-target";
		if (portalProjectionUsesExteriorBase) {
			const targets = this.#ensureSceneDomainTargets(
				gl.drawingBufferWidth,
				gl.drawingBufferHeight,
			);
			this.#lastExteriorSceneDomainDrawCalls = this.#renderSceneDomainTarget(
				targets.exterior,
				"exterior",
				pulse,
				targets.width / Math.max(1, targets.height),
			);
			this.#lastDirectEnvCellDrawCalls +=
				this.#renderOutdoorProjectionComposite(
					plan.layeredGraph,
					plan.baseOverlap,
					targets,
					targets.compositePing,
				);
			this.#copySceneDomainColorToDisplay(targets.compositePing);
			return;
		}
		if (plan.layeredGraph.outdoorCrossings.length > 0) {
			const targets = this.#ensureSceneDomainTargets(
				gl.drawingBufferWidth,
				gl.drawingBufferHeight,
			);
			this.#lastExteriorSceneDomainDrawCalls = this.#renderSceneDomainTarget(
				targets.exterior,
				"exterior",
				pulse,
				targets.width / Math.max(1, targets.height),
				{ cullTerrainBackfaces: true },
			);
			const outdoorCompositeSource = this.#renderSelectedOutdoorCompositeSource(
				plan,
				targets,
			);
			const destination =
				outdoorCompositeSource.target === targets.compositePing
					? targets.compositePong
					: targets.compositePing;
			this.#prepareEnvCellOutdoorColorBaseDestination({
				destination,
				outdoorCompositeSource: outdoorCompositeSource.target,
			});
			const targetAspectRatio =
				destination.width / Math.max(1, destination.height);
			this.#lastDirectEnvCellDrawCalls +=
				this.#drawPortalProjectionFrameResources(plan, targetAspectRatio);
			this.#drawPortalProjectionOutdoorCrossings(
				plan.layeredGraph,
				outdoorCompositeSource.target,
				targetAspectRatio,
			);
			this.#stateCache.setStencilState(
				createStencilState(gl, false, 0xff, gl.ALWAYS, 0, gl.KEEP),
			);
			this.#stateCache.bindVertexArray(null);
			this.#copySceneDomainColorToDisplay(destination);
			return;
		}

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		this.#stateCache.setViewport({
			height: gl.drawingBufferHeight,
			width: gl.drawingBufferWidth,
			x: 0,
			y: 0,
		});
		this.#stateCache.setDepthState(createDepthState(gl, true, true));
		gl.clearColor(0.025 + pulse * 0.015, 0.045, 0.065 + pulse * 0.025, 1);
		gl.clearDepth(1);
		gl.clearStencil(0);
		this.#stateCache.setStencilState(
			createStencilState(gl, false, 0xff, gl.ALWAYS, 0, gl.KEEP),
		);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
		this.#lastDirectEnvCellDrawCalls = this.#drawPortalProjectionFrameResources(
			plan,
			aspectRatio,
		);
	}

	#renderSceneDomainTargets(
		pulse: number,
		plan: Extract<RenderPassPlan, { readonly kind: "portal-scene-domains" }>,
	): void {
		const gl = this.#gl;
		const targets = this.#ensureSceneDomainTargets(
			gl.drawingBufferWidth,
			gl.drawingBufferHeight,
		);
		const aspectRatio = targets.width / Math.max(1, targets.height);
		this.#lastExteriorSceneDomainDrawCalls = this.#renderSceneDomainTarget(
			targets.exterior,
			"exterior",
			pulse,
			aspectRatio,
		);
		this.#lastInteriorSceneDomainDrawCalls = this.#renderSceneDomainTarget(
			targets.interior,
			"interior",
			pulse,
			aspectRatio,
		);
		const baseTarget = this.#getSceneDomainTarget(targets, plan.baseScene.kind);
		this.#copySceneDomainColorToDisplay(baseTarget);
	}

	#renderExteriorSuffixComposite(
		plan: DirectEnvCellPortalProjectionFrameWorkPlan,
		targets: SceneDomainTargets,
	): SceneDomainTarget {
		const graphs = plan.exteriorComposite?.graphs ?? [];
		if (graphs.length === 0) {
			return targets.exterior;
		}

		const graph = graphs[0];
		if (!graph) {
			return targets.exterior;
		}
		this.#lastDirectEnvCellDrawCalls += this.#renderOutdoorProjectionComposite(
			graph,
			createEmptyPortalBaseOverlapPlan(),
			targets,
			targets.compositePing,
		);
		this.#lastExteriorSuffixCompositePasses = 1;
		this.#lastExteriorSuffixCompositeDepth = 1;
		return targets.compositePing;
	}

	#renderSelectedOutdoorCompositeSource(
		plan: DirectEnvCellPortalProjectionFrameWorkPlan,
		targets: SceneDomainTargets,
	): SelectedOutdoorCompositeSource {
		if (!plan.exteriorComposite) {
			this.#lastOutdoorCrossingSource = "raw-exterior";
			return {
				kind: "raw-exterior",
				target: targets.exterior,
			};
		}

		this.#lastOutdoorCrossingSource = "exterior-suffix";
		return {
			kind: "exterior-suffix",
			target: this.#renderExteriorSuffixComposite(plan, targets),
		};
	}

	#renderOutdoorProjectionComposite(
		graph: PortalProjectionFrameGraphPlan,
		baseOverlap: PortalBaseOverlapPlan,
		targets: SceneDomainTargets,
		destination: SceneDomainTarget,
	): number {
		if (graph.baseEntry.scene.kind !== "outdoor-target") {
			throw new Error(
				"Outdoor projection composites require an outdoor-target base graph.",
			);
		}
		this.#copySceneDomainColorAndDepth(targets.exterior, destination, {
			clearStencil: true,
			copyStencil: false,
		});
		this.#stateCache.bindFramebuffer(destination.framebuffer);
		this.#stateCache.setViewport({
			height: destination.height,
			width: destination.width,
			x: 0,
			y: 0,
		});
		return this.#drawPortalProjectionFrameResources(
			{
				baseOverlap,
				kind: "direct-env-cell",
				layeredGraph: graph,
				mode: "portal-projection",
			},
			destination.width / Math.max(1, destination.height),
		);
	}

	#renderSceneDomainTarget(
		target: SceneDomainTarget,
		domain: SceneDomain,
		pulse: number,
		aspectRatio: number,
		options: { readonly cullTerrainBackfaces?: boolean } = {},
	): number {
		const gl = this.#gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
		this.#stateCache.invalidate();
		this.#stateCache.setViewport({
			height: target.height,
			width: target.width,
			x: 0,
			y: 0,
		});
		this.#stateCache.setDepthState(createDepthState(gl, true, true));
		gl.clearColor(0.025 + pulse * 0.015, 0.045, 0.065 + pulse * 0.025, 1);
		gl.clearDepth(1);
		gl.clearStencil(0);
		this.#stateCache.setStencilState(
			createStencilState(gl, false, 0xff, gl.ALWAYS, 0, gl.KEEP),
		);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
		let drawCalls = 0;
		if (domain === "exterior") {
			drawCalls += this.#drawTerrain(aspectRatio, {
				cullBackfaces: options.cullTerrainBackfaces ?? false,
			});
		}
		drawCalls += this.#drawStaticObjects(domain, aspectRatio);
		return drawCalls;
	}

	#copySceneDomainColorToDisplay(target: SceneDomainTarget): void {
		const gl = this.#gl;
		this.#resetFramebufferTransferState();
		this.#stateCache.bindFramebuffer(null);
		this.#stateCache.setViewport({
			height: gl.drawingBufferHeight,
			width: gl.drawingBufferWidth,
			x: 0,
			y: 0,
		});
		this.#stateCache.setDepthState({
			enabled: false,
			func: gl.ALWAYS,
			write: false,
		});
		this.#stateCache.setBlendState(
			createBlendState(gl, false, gl.ONE, gl.ZERO),
		);
		this.#stateCache.setCullState({ enabled: false, mode: gl.BACK });
		this.#stateCache.setStencilState(
			createStencilState(gl, false, 0xff, gl.ALWAYS, 0, gl.KEEP),
		);
		this.#drawSourceSceneCopy(target);
	}

	#copySceneDomainColorAndDepth(
		source: SceneDomainTarget,
		destination: SceneDomainTarget,
		options: {
			readonly clearStencil: boolean;
			readonly copyStencil: boolean;
		},
	): void {
		const gl = this.#gl;
		this.#resetFramebufferTransferState();
		this.#stateCache.bindFramebuffer(destination.framebuffer);
		this.#stateCache.setViewport({
			height: destination.height,
			width: destination.width,
			x: 0,
			y: 0,
		});
		if (options.clearStencil) {
			this.#stateCache.setStencilState(
				createStencilState(gl, false, 0xff, gl.ALWAYS, 0, gl.KEEP),
			);
			gl.clearStencil(0);
			gl.clear(gl.STENCIL_BUFFER_BIT);
		}
		this.#stateCache.setDepthState({
			enabled: false,
			func: gl.ALWAYS,
			write: false,
		});
		this.#stateCache.setBlendState(
			createBlendState(gl, false, gl.ONE, gl.ZERO),
		);
		this.#stateCache.setCullState({ enabled: false, mode: gl.BACK });
		this.#stateCache.setStencilState(
			createStencilState(gl, false, 0xff, gl.ALWAYS, 0, gl.KEEP),
		);
		this.#drawSourceSceneCopy(source);
		this.#blitSceneDomainDepth(source, destination);
		if (options.copyStencil) {
			this.#blitSceneDomainStencil(source, destination);
		}
	}

	#copySceneDomainColorOnly(
		source: SceneDomainTarget,
		destination: SceneDomainTarget,
	): void {
		const gl = this.#gl;
		this.#resetFramebufferTransferState();
		this.#stateCache.bindFramebuffer(destination.framebuffer);
		this.#stateCache.setViewport({
			height: destination.height,
			width: destination.width,
			x: 0,
			y: 0,
		});
		this.#stateCache.setDepthState({
			enabled: false,
			func: gl.ALWAYS,
			write: false,
		});
		this.#stateCache.setBlendState(
			createBlendState(gl, false, gl.ONE, gl.ZERO),
		);
		this.#stateCache.setCullState({ enabled: false, mode: gl.BACK });
		this.#stateCache.setStencilState(
			createStencilState(gl, false, 0xff, gl.ALWAYS, 0, gl.KEEP),
		);
		this.#drawSourceSceneCopy(source);
	}

	#blitSceneDomainDepth(
		source: SceneDomainTarget,
		destination: SceneDomainTarget,
	): void {
		const gl = this.#gl;
		this.#resetFramebufferTransferState();
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source.framebuffer);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination.framebuffer);
		gl.blitFramebuffer(
			0,
			0,
			source.width,
			source.height,
			0,
			0,
			destination.width,
			destination.height,
			gl.DEPTH_BUFFER_BIT,
			gl.NEAREST,
		);
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
		this.#stateCache.invalidate();
	}

	#blitSceneDomainStencil(
		source: SceneDomainTarget,
		destination: SceneDomainTarget,
	): void {
		const gl = this.#gl;
		this.#resetFramebufferTransferState();
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source.framebuffer);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination.framebuffer);
		gl.blitFramebuffer(
			0,
			0,
			source.width,
			source.height,
			0,
			0,
			destination.width,
			destination.height,
			gl.STENCIL_BUFFER_BIT,
			gl.NEAREST,
		);
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
		this.#stateCache.invalidate();
	}

	#drawSourceSceneCopy(source: SceneDomainTarget): void {
		const gl = this.#gl;
		this.#resetFramebufferTransferState();
		this.#stateCache.useProgram(this.#sourceSceneCopyProgram.program);
		this.#stateCache.bindVertexArray(this.#sourceSceneCopyVertexArray);
		this.#stateCache.bindTexture2D(
			SOURCE_SCENE_COPY_COLOR_TEXTURE_UNIT,
			source.colorTexture,
		);
		this.#stateCache.bindTexture2D(
			SOURCE_SCENE_COPY_DEPTH_TEXTURE_UNIT,
			source.depthTexture,
		);
		gl.uniform1i(
			this.#sourceSceneCopyProgram.uniforms.uSourceSceneColor,
			SOURCE_SCENE_COPY_COLOR_TEXTURE_UNIT,
		);
		gl.uniform1i(
			this.#sourceSceneCopyProgram.uniforms.uSourceSceneDepth,
			SOURCE_SCENE_COPY_DEPTH_TEXTURE_UNIT,
		);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	#getSceneDomainTarget(
		targets: SceneDomainTargets,
		target: SceneDomainTargetKind,
	): SceneDomainTarget {
		return target === "exterior" ? targets.exterior : targets.interior;
	}

	#drawTerrain(
		aspectRatio: number,
		options: { readonly cullBackfaces?: boolean } = {},
	): number {
		if (
			!this.#staticLayerVisibility.terrain ||
			this.#terrainResources.size === 0
		) {
			return 0;
		}

		const gl = this.#gl;
		const mvp = createModelViewProjectionMatrix(this.#frameState, aspectRatio);

		this.#stateCache.useProgram(this.#terrainProgram.program);
		gl.uniformMatrix4fv(
			this.#terrainProgram.uniforms.uModelViewProjection,
			false,
			mvp,
		);
		gl.uniform4f(this.#terrainProgram.uniforms.uColor, 0.22, 0.72, 0.42, 1);
		this.#stateCache.setCullState({
			enabled: options.cullBackfaces ?? false,
			mode: gl.BACK,
		});

		for (const resource of this.#terrainResources.values()) {
			const bindings =
				this.#textureBindings.get(
					createTextureBindingOwnerKey({
						drawUnitId: resource.drawUnitId,
						kind: "draw-unit",
					}),
				) ?? EMPTY_STATIC_TEXTURE_BINDINGS;
			const binding = resource.primaryTextureUseId
				? bindings.get(resource.primaryTextureUseId)
				: undefined;
			const texture = binding
				? (this.#textures.get(binding.textureRefId) ?? null)
				: null;
			const useTexture =
				resource.materialFamily === "terrain-single-base-color" &&
				texture !== null;
			const layeredPayload =
				resource.materialFamily === "terrain-layered"
					? this.#getTerrainPreparedLayeredPayload(resource, bindings)
					: null;
			const useLayered = layeredPayload !== null;
			if (layeredPayload) {
				uploadTerrainLayeredUniforms(
					gl,
					this.#stateCache,
					this.#terrainProgram,
					layeredPayload,
					this.#frameState,
				);
			}
			if (resource.materialFamily === "terrain-layered" && !useLayered) {
				this.#warnTerrainLayeredFallback(resource);
			}
			this.#stateCache.bindTexture2D(0, useTexture ? texture : null);
			gl.uniform1i(this.#terrainProgram.uniforms.uTexture, 0);
			gl.uniform4f(
				this.#terrainProgram.uniforms.uTextureRect,
				binding?.rect[0] ?? 0,
				binding?.rect[1] ?? 0,
				binding?.rect[2] ?? 1,
				binding?.rect[3] ?? 1,
			);
			gl.uniform2f(
				this.#terrainProgram.uniforms.uTextureSize,
				binding?.textureWidth ?? 1,
				binding?.textureHeight ?? 1,
			);
			gl.uniform1i(
				this.#terrainProgram.uniforms.uUseTexture,
				useTexture ? 1 : 0,
			);
			gl.uniform1i(
				this.#terrainProgram.uniforms.uMaterialMode,
				useLayered ? 2 : useTexture ? 1 : 0,
			);
			gl.uniform3f(
				this.#terrainProgram.uniforms.uPlacementTranslation,
				...this.#createResourceTranslation(resource),
			);
			this.#stateCache.bindVertexArray(resource.vertexArray);
			gl.drawElements(gl.TRIANGLES, resource.indexCount, resource.indexType, 0);
		}

		this.#stateCache.bindVertexArray(null);
		this.#stateCache.bindTexture2D(0, null);
		return this.#terrainResources.size;
	}

	#drawStaticObjects(domain: RenderStaticDomain, aspectRatio: number): number {
		const staticObjectResources = [
			...this.#staticObjectResources.values(),
		].filter((resource) =>
			shouldDrawStaticObjectResourceInDomain(
				resource,
				domain,
				this.#staticLayerVisibility,
			),
		);
		const staticObjectInstanceResources =
			this.#createDrawableStaticObjectInstanceResources(domain);
		const structuredInteriorResources =
			domain === "exterior" || !this.#staticLayerVisibility.envCellInteriors
				? []
				: [...this.#structuredInteriorResources.values()];

			const staticDrawCalls = this.#drawStaticMaterialResourceSet(
				staticObjectResources,
				staticObjectInstanceResources,
				structuredInteriorResources,
				aspectRatio,
			);
			return staticDrawCalls + this.#drawDynamicResources(domain);
		}

		#createDrawableStaticObjectInstanceResources(
			domain: RenderStaticDomain,
		): readonly StaticObjectInstanceDrawResource[] {
			if (!this.#staticLayerVisibility.outdoorDetail || domain === "interior") {
			return [];
		}
		return [...this.#staticObjectRenderInstances.values()].flatMap(
			(instance) => {
				const resource = this.#staticObjectVisualResources.get(
					instance.resourceId,
				);
				return resource ? [{ instance, resource }] : [];
				},
			);
		}

		#drawDynamicResources(domain: RenderStaticDomain): number {
			const gl = this.#gl;
			let drawCalls = 0;
			let skipped = 0;
			for (const instance of this.#dynamicInstances.values()) {
				if (!shouldDrawDynamicInstanceInDomain(instance, domain)) {
					continue;
				}
				const resources = this.#dynamicGeometryResources.get(instance.resourceId);
				if (!resources || resources.length === 0) {
					skipped += 1;
					continue;
				}
				const partMatrixByIndex = new Map(
					instance.partToObjectMatrices.map((part) => [
						part.partIndex,
						new Float32Array(part.matrix),
					]),
				);
				const objectToRenderMatrix = multiplyMat4(
					this.#createDynamicInstanceResidenceTransform(instance),
					new Float32Array(instance.objectToRenderMatrix),
				);
				for (const resource of resources) {
					const partMatrix = partMatrixByIndex.get(resource.partIndex);
					if (!partMatrix) {
						skipped += 1;
						continue;
					}
					applyStaticObjectRenderState(
						gl,
						this.#stateCache,
						resource.renderState,
					);
					this.#drawStaticMaterialResource(
						resource,
						multiplyMat4(objectToRenderMatrix, partMatrix),
					);
					drawCalls += 1;
				}
			}
			this.#lastDynamicDrawCalls += drawCalls;
			this.#lastSkippedDynamicSubmissions += skipped;
			return drawCalls;
		}

		#createDynamicInstanceResidenceTransform(
			instance: DynamicRendererInstance,
		): Float32Array {
			if (instance.renderResidence.kind === "env-cell") {
				return createTranslationMatrix([0, 0, 0]);
			}
			return createTranslationMatrix(
				this.#createLandblockTranslation(instance.renderResidence.landblockId),
			);
		}

		#drawPortalProjectionFrameResources(
		plan: DirectEnvCellPortalProjectionFrameWorkPlan,
		aspectRatio: number,
	): number {
		const gl = this.#gl;
		let drawCalls = this.#drawPortalProjectionBaseResources(
			plan.layeredGraph,
			aspectRatio,
		);
		this.#stateCache.setStencilState(
			createStencilState(gl, false, 0xff, gl.ALWAYS, 0, gl.KEEP),
		);
		drawCalls +=
			this.#drawPortalBaseOverlapEnvCells(plan.baseOverlap, aspectRatio) +
			this.#drawPortalProjectionMaskedLayers(plan.layeredGraph, aspectRatio);

		this.#stateCache.setStencilState(
			createStencilState(gl, false, 0xff, gl.ALWAYS, 0, gl.KEEP),
		);
		this.#stateCache.bindVertexArray(null);
		return drawCalls;
	}

	#drawPortalProjectionBaseResources(
		graph: PortalProjectionFrameGraphPlan,
		aspectRatio: number,
	): number {
		if (!("resources" in graph.baseEntry)) {
			return 0;
		}
		return this.#drawPortalFrameResourceSet(
			graph.baseEntry.resources,
			aspectRatio,
		);
	}

	#drawPortalBaseOverlapEnvCells(
		baseOverlap: PortalBaseOverlapPlan,
		aspectRatio: number,
	): number {
		let drawCalls = 0;
		for (const envCell of baseOverlap.envCells) {
			drawCalls += this.#drawPortalFrameResourceSet(
				envCell.resources,
				aspectRatio,
			);
		}
		return drawCalls;
	}

	#drawPortalProjectionMaskedLayers(
		graph: PortalProjectionFrameGraphPlan,
		aspectRatio: number,
	): number {
		const gl = this.#gl;
		const renderEntryById = new Map(
			graph.renderEntries.map((entry) => [entry.renderEntryId, entry] as const),
		);
		const maskEdgeById = new Map(
			graph.maskEdges.map((edge) => [edge.edgeId, edge] as const),
		);
		let drawCalls = 0;
		for (const layer of graph.renderLayers) {
			let layerMaskCount = 0;
			for (const renderEntryId of layer.renderEntryIds) {
				const renderEntry = renderEntryById.get(renderEntryId);
				if (!renderEntry) {
					throw new Error(
						`Portal projection layer ${layer.renderLayer} references missing render entry ${renderEntryId}.`,
					);
				}
				for (const maskEdgeId of renderEntry.incomingMaskEdgeIds) {
					const edge = maskEdgeById.get(maskEdgeId);
					if (!edge) {
						throw new Error(
							`Portal projection render entry ${renderEntryId} references missing mask edge ${maskEdgeId}.`,
						);
					}
					const apertureRange = this.#portalApertureRangesById.get(
						edge.apertureRangeId,
					);
					if (!apertureRange) {
						this.#warnMissingPortalProjectionPortalApertureRange(edge);
						continue;
					}
					this.#drawPortalProjectionApertureStencilMask(edge, apertureRange, {
						aspectRatio,
					});
					layerMaskCount += 1;
				}
			}
			if (layerMaskCount === 0) {
				continue;
			}
			this.#stateCache.setStencilState(
				createStencilState(
					gl,
					true,
					0x00,
					gl.EQUAL,
					layer.renderLayer,
					gl.KEEP,
				),
			);
			this.#resetDirectPortalDepthForStencilValue(layer.renderLayer);
			for (const renderEntryId of layer.renderEntryIds) {
				const renderEntry = renderEntryById.get(renderEntryId);
				if (!renderEntry) {
					throw new Error(
						`Portal projection layer ${layer.renderLayer} references missing render entry ${renderEntryId}.`,
					);
				}
				drawCalls += this.#drawPortalFrameResourceSet(
					renderEntry.resources,
					aspectRatio,
				);
			}
		}
		return drawCalls;
	}

	#prepareEnvCellOutdoorColorBaseDestination(options: {
		readonly destination: SceneDomainTarget;
		readonly outdoorCompositeSource: SceneDomainTarget;
	}): void {
		const gl = this.#gl;
		this.#lastEnvCellOutdoorCrossingColorBase = true;
		this.#copySceneDomainColorOnly(
			options.outdoorCompositeSource,
			options.destination,
		);
		this.#stateCache.bindFramebuffer(options.destination.framebuffer);
		this.#stateCache.setDepthState({
			enabled: false,
			func: gl.ALWAYS,
			write: true,
		});
		gl.clearDepth(1);
		gl.clearStencil(0);
		this.#stateCache.setStencilState(
			createStencilState(gl, false, 0xff, gl.ALWAYS, 0, gl.KEEP),
		);
		gl.clear(gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
	}

	#drawPortalProjectionOutdoorCrossings(
		graph: PortalProjectionFrameGraphPlan,
		exterior: SceneDomainTarget,
		aspectRatio: number,
	): void {
		if (graph.outdoorCrossings.length === 0) {
			return;
		}
		const gl = this.#gl;
		for (const crossing of graph.outdoorCrossings) {
			const apertureRange = this.#portalApertureRangesById.get(
				crossing.apertureRangeId,
			);
			if (!apertureRange) {
				this.#warnMissingPortalProjectionOutdoorCrossingApertureRange(crossing);
				continue;
			}
			this.#stateCache.setStencilState(
				createStencilState(gl, false, 0xff, gl.ALWAYS, 0, gl.KEEP),
			);
			gl.clearStencil(0);
			gl.clear(gl.STENCIL_BUFFER_BIT);
			this.#drawPortalApertureStencilMask(apertureRange, {
				aspectRatio,
				stencilValue: OUTDOOR_CROSSING_STENCIL_VALUE,
			});
			this.#stateCache.setDepthState({
				enabled: true,
				func: gl.ALWAYS,
				write: true,
			});
			this.#stateCache.setBlendState(
				createBlendState(gl, false, gl.ONE, gl.ZERO),
			);
			this.#stateCache.setCullState({ enabled: false, mode: gl.BACK });
			this.#stateCache.setStencilState(
				createStencilState(
					gl,
					true,
					0x00,
					gl.EQUAL,
					OUTDOOR_CROSSING_STENCIL_VALUE,
					gl.KEEP,
				),
			);
			this.#resetFramebufferTransferState();
			this.#drawSourceSceneCopy(exterior);
		}
		this.#stateCache.setStencilState(
			createStencilState(gl, false, 0xff, gl.ALWAYS, 0, gl.KEEP),
		);
		this.#stateCache.bindVertexArray(null);
	}

	#resetDirectPortalDepthForStencilValue(stencilValue: number): void {
		const gl = this.#gl;
		gl.colorMask(false, false, false, false);
		try {
			this.#stateCache.useProgram(this.#directPortalDepthResetProgram.program);
			this.#stateCache.setDepthState({
				enabled: true,
				func: gl.ALWAYS,
				write: true,
			});
			this.#stateCache.setBlendState(
				createBlendState(gl, false, gl.ONE, gl.ZERO),
			);
			this.#stateCache.setCullState({ enabled: false, mode: gl.BACK });
			this.#stateCache.setStencilState(
				createStencilState(gl, true, 0x00, gl.EQUAL, stencilValue, gl.KEEP),
			);
			this.#stateCache.bindVertexArray(this.#sourceSceneCopyVertexArray);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		} finally {
			gl.colorMask(true, true, true, true);
		}
	}

	#drawPortalFrameResourceSet(
		resources: PortalFrameNodeResources,
		aspectRatio: number,
	): number {
		if (!this.#staticLayerVisibility.envCellInteriors) {
			return 0;
		}
		const staticObjectResources: StaticObjectGeometryResource[] = [];
		const structuredInteriorResources: StructuredInteriorGeometryResource[] =
			[];
		for (const drawUnitId of resources.envCellStaticObjectDrawUnitIds) {
			const resource = this.#staticObjectResources.get(drawUnitId);
			if (resource) {
				staticObjectResources.push(resource);
			}
		}
		for (const drawUnitId of resources.structuredInteriorDrawUnitIds) {
			const resource = this.#structuredInteriorResources.get(drawUnitId);
			if (resource) {
				structuredInteriorResources.push(resource);
			}
		}

		return this.#drawStaticMaterialResourceSet(
			staticObjectResources,
			[],
			structuredInteriorResources,
			aspectRatio,
		);
	}

	#drawPortalProjectionApertureStencilMask(
		edge: PortalProjectionFrameMaskEdgePlan,
		apertureRange: PortalApertureRangeResource,
		options: { readonly aspectRatio: number },
	): void {
		this.#drawPortalApertureStencilMask(apertureRange, {
			aspectRatio: options.aspectRatio,
			stencilValue: edge.renderLayer,
		});
	}

	#drawPortalApertureStencilMask(
		apertureRange: PortalApertureRangeResource,
		options: {
			readonly aspectRatio: number;
			readonly stencilValue: number;
		},
	): void {
		if (apertureRange.range.indexCount === 0) {
			return;
		}
		const gl = this.#gl;
		gl.colorMask(false, false, false, false);
		try {
			this.#stateCache.useProgram(this.#transitionCompositeProgram.program);
			this.#stateCache.setDepthState({
				enabled: true,
				func: gl.LEQUAL,
				write: false,
			});
			this.#stateCache.setBlendState(
				createBlendState(gl, false, gl.ONE, gl.ZERO),
			);
			this.#stateCache.setCullState({ enabled: false, mode: gl.BACK });
			this.#stateCache.setStencilState(
				createStencilState(
					gl,
					true,
					0xff,
					gl.ALWAYS,
					options.stencilValue,
					gl.REPLACE,
				),
			);
			gl.uniformMatrix4fv(
				this.#transitionCompositeProgram.uniforms.uModelViewProjection,
				false,
				createModelViewProjectionMatrix(this.#frameState, options.aspectRatio),
			);
			const translation = this.#createLandblockTranslation(
				apertureRange.resource.landblockId,
			);
			gl.uniform3f(
				this.#transitionCompositeProgram.uniforms.uPlacementTranslation,
				translation[0],
				translation[1],
				translation[2],
			);
			this.#stateCache.bindVertexArray(apertureRange.resource.vertexArray);
			gl.drawElements(
				gl.TRIANGLES,
				apertureRange.range.indexCount,
				apertureRange.resource.indexType,
				apertureRange.range.firstIndex *
					getIndexElementByteSize(apertureRange.resource.indexType, gl),
			);
		} finally {
			gl.colorMask(true, true, true, true);
		}
	}

	#drawStaticMaterialResourceSet(
		staticObjectResources: readonly StaticObjectGeometryResource[],
		staticObjectInstanceResources: readonly StaticObjectInstanceDrawResource[],
		structuredInteriorResources: readonly StructuredInteriorGeometryResource[],
		aspectRatio: number,
	): number {
		if (
			staticObjectResources.length === 0 &&
			staticObjectInstanceResources.length === 0 &&
			structuredInteriorResources.length === 0
		) {
			this.#resetTransparentStaticObjectDrawLists();
			return 0;
		}

		const gl = this.#gl;
		const mvp = createModelViewProjectionMatrix(this.#frameState, aspectRatio);

		this.#stateCache.useProgram(this.#staticObjectProgram.program);
		gl.uniformMatrix4fv(
			this.#staticObjectProgram.uniforms.uModelViewProjection,
			false,
			mvp,
		);

		applyStaticObjectDepthWritingState(gl, this.#stateCache);
		this.#resetTransparentStaticObjectDrawLists();
		let drawCalls = 0;
		const instanceGroupsByResourceId = new Map<
			string,
			StaticObjectInstanceDrawResource[]
		>();
		for (const resource of staticObjectResources) {
			if (isTransparentStaticObjectResource(resource)) {
				this.#appendTransparentStaticObjectResource(resource);
				continue;
			}
			this.#drawStaticMaterialResource(
				resource,
				this.#createResourceTransform(resource),
			);
			this.#recordBakedStaticObjectDirectDraw(resource);
			drawCalls += 1;
		}
		for (const resource of staticObjectInstanceResources) {
			if (isTransparentStaticObjectInstanceDrawResource(resource)) {
				this.#appendTransparentStaticObjectInstanceResource(resource);
				continue;
			}
			const group = instanceGroupsByResourceId.get(
				resource.resource.resourceId,
			);
			if (group) {
				group.push(resource);
			} else {
				instanceGroupsByResourceId.set(resource.resource.resourceId, [
					resource,
				]);
			}
		}
		for (const group of instanceGroupsByResourceId.values()) {
			drawCalls += this.#drawStaticObjectInstanceGroup(group);
		}
		for (const resource of structuredInteriorResources) {
			applyStaticObjectRenderState(gl, this.#stateCache, resource.renderState);
			applyStructuredInteriorCullState(
				gl,
				this.#stateCache,
				this.#flatVisionModeEnabled,
			);
			this.#drawStaticMaterialResource(
				resource,
				this.#createResourceTransform(resource),
			);
			drawCalls += 1;
		}

		for (const resource of this.#farTransparentStaticObjectDrawList) {
			applyStaticObjectRenderState(gl, this.#stateCache, resource.renderState);
			this.#drawStaticMaterialResource(
				resource,
				this.#createResourceTransform(resource),
			);
			this.#recordBakedStaticObjectDirectDraw(resource);
			drawCalls += 1;
		}
		const farTransparentInstanceGroupsByResourceId = new Map<
			string,
			StaticObjectInstanceDrawResource[]
		>();
		for (const resource of this.#farTransparentStaticObjectInstanceDrawList) {
			const group = farTransparentInstanceGroupsByResourceId.get(
				resource.resource.resourceId,
			);
			if (group) {
				group.push(resource);
			} else {
				farTransparentInstanceGroupsByResourceId.set(
					resource.resource.resourceId,
					[resource],
				);
			}
		}
		for (const group of farTransparentInstanceGroupsByResourceId.values()) {
			const first = group[0];
			if (!first) {
				continue;
			}
			applyStaticObjectRenderState(
				gl,
				this.#stateCache,
				first.resource.renderState,
			);
			drawCalls += this.#drawStaticObjectInstanceGroup(group);
			if (group.length < 2) {
				this.#lastStaticObjectFarTransparentDirectRenderInstanceDrawCalls += 1;
			} else {
				this.#lastStaticObjectFarTransparentInstancedRenderInstanceDrawCalls += 1;
				this.#lastStaticObjectFarTransparentInstancedRenderInstances +=
					group.length;
			}
		}
		this.#nearTransparentStaticObjectDrawEntries.sort(
			compareStaticObjectTransparentDrawEntries,
		);
		for (const entry of this.#nearTransparentStaticObjectDrawEntries) {
			const resource = entry.resource;
			if (!resource) {
				throw new Error("Missing transparent static object draw resource.");
			}
			applyStaticObjectRenderState(gl, this.#stateCache, resource.renderState);
			this.#drawStaticMaterialResource(
				resource,
				entry.instance
					? this.#createStaticObjectInstanceTransform(entry.instance)
					: this.#createResourceTransform(resource),
			);
			if (entry.instance) {
				this.#lastStaticObjectDirectRenderInstanceDrawCalls += 1;
				this.#lastStaticObjectNearTransparentDirectRenderInstanceDrawCalls += 1;
			} else if (isStaticObjectGeometryResource(resource)) {
				this.#recordBakedStaticObjectDirectDraw(resource);
			}
			drawCalls += 1;
		}

		this.#stateCache.bindVertexArray(null);
		restoreStaticObjectRenderState(gl, this.#stateCache);
		return drawCalls;
	}

	#recordBakedStaticObjectDirectDraw(
		resource: StaticObjectGeometryResource,
	): void {
		this.#lastStaticObjectBakedDirectDrawCalls += 1;
		if (resource.domain !== "outdoor-detail") {
			return;
		}
		this.#lastOutdoorDetailStaticObjectBakedDirectDrawCalls += 1;
		incrementStaticObjectMaterialPassDrawCallCounts(
			this.#lastOutdoorDetailStaticObjectBakedDirectDrawCallsByPass,
			resource.materialPass,
		);
	}

	#drawStaticObjectInstanceGroup(
		group: readonly StaticObjectInstanceDrawResource[],
	): number {
		const first = group[0];
		if (!first) {
			return 0;
		}
		if (group.length < 2) {
			this.#drawStaticMaterialResource(
				first.resource,
				this.#createStaticObjectInstanceTransform(first.instance),
			);
			this.#lastStaticObjectDirectRenderInstanceDrawCalls += 1;
			return 1;
		}

		this.#drawStaticMaterialResourceInstanced(first.resource, group);
		this.#lastStaticObjectInstancedRenderInstanceDrawCalls += 1;
		this.#lastStaticObjectInstancedRenderInstances += group.length;
		return 1;
	}

	#drawDebugOverlay(): void {
		if (
			this.#debugOverlayTriangleVertexCount === 0 &&
			this.#debugOverlayLineVertexCount === 0
		) {
			return;
		}

		const gl = this.#gl;
		const mvp = createModelViewProjectionMatrix(
			this.#frameState,
			gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight),
		);

		this.#stateCache.useProgram(this.#debugOverlayProgram.program);
		gl.uniformMatrix4fv(
			this.#debugOverlayProgram.uniforms.uModelViewProjection,
			false,
			mvp,
		);
		this.#stateCache.setDepthState(createDepthState(gl, false, false));
		this.#stateCache.bindVertexArray(this.#debugOverlayVertexArray);
		if (this.#debugOverlayTriangleVertexCount > 0) {
			applyDebugOverlayAlphaBlendState(gl, this.#stateCache);
			this.#stateCache.setCullState({ enabled: true, mode: gl.BACK });
			gl.drawArrays(gl.TRIANGLES, 0, this.#debugOverlayTriangleVertexCount);
		}
		if (this.#debugOverlayLineVertexCount > 0) {
			applyDebugOverlayAlphaBlendState(gl, this.#stateCache);
			this.#stateCache.setCullState({ enabled: false, mode: gl.BACK });
			gl.lineWidth(1);
			gl.drawArrays(
				gl.LINES,
				this.#debugOverlayTriangleVertexCount,
				this.#debugOverlayLineVertexCount,
			);
		}
		this.#stateCache.bindVertexArray(null);
		restoreDebugOverlayRenderState(gl, this.#stateCache);
	}

	#drawStaticMaterialResource(
		resource: StaticMaterialGeometryResource,
		objectTransform: Float32Array,
	): void {
		const gl = this.#gl;
		this.#bindStaticMaterialResourcePayload(resource);
		gl.uniformMatrix4fv(
			this.#staticObjectProgram.uniforms.uObjectTransform,
			false,
			objectTransform,
		);
		gl.uniform1i(
			this.#staticObjectProgram.uniforms.uUseInstanceObjectTransform,
			0,
		);
		this.#stateCache.bindVertexArray(resource.vertexArray);
		gl.drawElements(gl.TRIANGLES, resource.indexCount, resource.indexType, 0);
	}

	#drawStaticMaterialResourceInstanced(
		resource: StaticObjectVisualGeometryResource,
		group: readonly StaticObjectInstanceDrawResource[],
	): void {
		const gl = this.#gl;
		this.#bindStaticMaterialResourcePayload(resource);
		this.#writeStaticObjectInstanceTransforms(group);
		gl.uniform1i(
			this.#staticObjectProgram.uniforms.uUseInstanceObjectTransform,
			1,
		);
		this.#stateCache.bindVertexArray(resource.vertexArray);
		this.#bindStaticObjectInstanceTransformAttributes();
		gl.drawElementsInstanced(
			gl.TRIANGLES,
			resource.indexCount,
			resource.indexType,
			0,
			group.length,
		);
	}

	#bindStaticMaterialResourcePayload(
		resource: StaticMaterialGeometryResource,
	): void {
		const gl = this.#gl;
		const { materialUniforms, rolePages } =
			this.#getStaticObjectPreparedPayload(resource);

		uploadStaticObjectRolePageBindings(
			gl,
			this.#stateCache,
			this.#staticObjectProgram.uniforms.uStaticBaseColorTextures,
			this.#staticObjectProgram.uniforms.uStaticBaseColorSizes,
			rolePages.baseColor,
			STATIC_OBJECT_BASE_COLOR_TEXTURE_UNIT_BASE,
		);
		uploadStaticObjectRolePageBindings(
			gl,
			this.#stateCache,
			this.#staticObjectProgram.uniforms.uStaticIndexTextures,
			null,
			rolePages.index,
			STATIC_OBJECT_INDEX_TEXTURE_UNIT_BASE,
		);
		uploadStaticObjectRolePageBindings(
			gl,
			this.#stateCache,
			this.#staticObjectProgram.uniforms.uStaticPaletteTextures,
			this.#staticObjectProgram.uniforms.uStaticPaletteSizes,
			rolePages.palette,
			STATIC_OBJECT_PALETTE_TEXTURE_UNIT_BASE,
		);
		uploadStaticObjectRolePageBindings(
			gl,
			this.#stateCache,
			this.#staticObjectProgram.uniforms.uStaticDetailTextures,
			this.#staticObjectProgram.uniforms.uStaticDetailSizes,
			rolePages.detail,
			STATIC_OBJECT_DETAIL_TEXTURE_UNIT_BASE,
		);

		uploadStaticObjectMaterialTableUniforms(
			gl,
			this.#staticObjectProgram,
			materialUniforms,
		);
	}

	#writeStaticObjectInstanceTransforms(
		group: readonly StaticObjectInstanceDrawResource[],
	): void {
		const requiredLength =
			group.length * STATIC_OBJECT_INSTANCE_TRANSFORM_FLOATS;
		if (this.#staticObjectInstanceTransformScratch.length < requiredLength) {
			this.#staticObjectInstanceTransformScratch = new Float32Array(
				requiredLength,
			);
		}
		for (const [index, drawResource] of group.entries()) {
			this.#staticObjectInstanceTransformScratch.set(
				this.#createStaticObjectInstanceTransform(drawResource.instance),
				index * STATIC_OBJECT_INSTANCE_TRANSFORM_FLOATS,
			);
		}

		const gl = this.#gl;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#staticObjectInstanceTransformBuffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			this.#staticObjectInstanceTransformScratch.subarray(0, requiredLength),
			gl.DYNAMIC_DRAW,
		);
	}

	#bindStaticObjectInstanceTransformAttributes(): void {
		const gl = this.#gl;
		const stride =
			STATIC_OBJECT_INSTANCE_TRANSFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#staticObjectInstanceTransformBuffer);
		for (let column = 0; column < 4; column += 1) {
			const location =
				STATIC_OBJECT_INSTANCE_TRANSFORM_ATTRIBUTE_LOCATION + column;
			gl.enableVertexAttribArray(location);
			gl.vertexAttribPointer(
				location,
				4,
				gl.FLOAT,
				false,
				stride,
				column * 4 * Float32Array.BYTES_PER_ELEMENT,
			);
			gl.vertexAttribDivisor(location, 1);
		}
	}

	#getTerrainPreparedLayeredPayload(
		resource: TerrainGeometryResource,
		bindings: ReadonlyMap<string, StaticTextureBinding>,
	): TerrainPreparedLayeredPayload | null {
		const plan = resource.terrainMaterialPlan;
		if (!plan) {
			return null;
		}

		return prepareTerrainLayeredPayloadState(
			resource.preparedLayeredPayloadState,
			plan,
			bindings,
			this.#textures,
		);
	}

	#markTerrainPreparedPayloadDirty(drawUnitId: string): void {
		const resource = this.#terrainResources.get(drawUnitId);
		if (!resource) {
			return;
		}
		markTerrainPreparedLayeredPayloadDirty(
			resource.preparedLayeredPayloadState,
		);
	}

	#markAllTerrainPreparedPayloadsDirty(): void {
		for (const resource of this.#terrainResources.values()) {
			markTerrainPreparedLayeredPayloadDirty(
				resource.preparedLayeredPayloadState,
			);
		}
	}

	#getStaticObjectPreparedPayload(
		resource: StaticMaterialGeometryResource,
	): StaticObjectPreparedDrawPayload {
		const bindings =
			this.#textureBindings.get(
				createTextureBindingOwnerKey(
					createStaticTextureBindingOwnerForResource(resource),
				),
			) ?? EMPTY_STATIC_TEXTURE_BINDINGS;

		return prepareStaticObjectDrawPayloadState(
			resource.preparedDrawPayloadState,
			resource,
			bindings,
			this.#textures,
		);
	}

	#resetTransparentStaticObjectDrawLists(): void {
		this.#farTransparentStaticObjectDrawList.length = 0;
		this.#farTransparentStaticObjectInstanceDrawList.length = 0;
		this.#nearTransparentStaticObjectDrawEntries.length = 0;
		for (
			let index = 0;
			index < this.#transparentStaticObjectDrawEntryPoolActiveCount;
			index += 1
		) {
			const entry = this.#transparentStaticObjectDrawEntryPool[index];
			if (entry) {
				entry.instance = null;
				entry.resource = null;
			}
		}
		this.#transparentStaticObjectDrawEntryPoolActiveCount = 0;
	}

	#appendTransparentStaticObjectResource(
		resource: StaticObjectGeometryResource,
	): void {
		const distanceSquared =
			this.#computeStaticObjectSortDistanceSquared(resource);
		if (distanceSquared > NEAR_TRANSPARENT_STATIC_SORT_DISTANCE_SQUARED) {
			this.#farTransparentStaticObjectDrawList.push(resource);
			return;
		}

		const poolIndex = this.#transparentStaticObjectDrawEntryPoolActiveCount;
		const entry =
			this.#transparentStaticObjectDrawEntryPool[poolIndex] ??
			createStaticObjectTransparentDrawEntry();
		entry.resource = resource;
		entry.instance = null;
		entry.drawUnitId = resource.drawUnitId;
		entry.distanceSquared = distanceSquared;
		this.#transparentStaticObjectDrawEntryPool[poolIndex] = entry;
		this.#transparentStaticObjectDrawEntryPoolActiveCount += 1;
		this.#nearTransparentStaticObjectDrawEntries.push(entry);
	}

	#appendTransparentStaticObjectInstanceResource(
		drawResource: StaticObjectInstanceDrawResource,
	): void {
		const distanceSquared =
			this.#computeStaticObjectInstanceSortDistanceSquared(
				drawResource.instance,
			);
		if (distanceSquared > NEAR_TRANSPARENT_STATIC_SORT_DISTANCE_SQUARED) {
			this.#farTransparentStaticObjectInstanceDrawList.push(drawResource);
			return;
		}

		const poolIndex = this.#transparentStaticObjectDrawEntryPoolActiveCount;
		const entry =
			this.#transparentStaticObjectDrawEntryPool[poolIndex] ??
			createStaticObjectTransparentDrawEntry();
		entry.distanceSquared = distanceSquared;
		entry.drawUnitId = drawResource.instance.instanceId;
		entry.instance = drawResource.instance;
		entry.resource = drawResource.resource;
		this.#transparentStaticObjectDrawEntryPool[poolIndex] = entry;
		this.#transparentStaticObjectDrawEntryPoolActiveCount += 1;
		this.#nearTransparentStaticObjectDrawEntries.push(entry);
	}

	#markStaticObjectPreparedPayloadDirty(drawUnitId: string): void {
		const resource = this.#staticObjectResources.get(drawUnitId);
		if (resource) {
			markStaticObjectPreparedDrawPayloadDirty(
				resource.preparedDrawPayloadState,
			);
		}
		const structuredInteriorResource =
			this.#structuredInteriorResources.get(drawUnitId);
		if (structuredInteriorResource) {
			markStaticObjectPreparedDrawPayloadDirty(
				structuredInteriorResource.preparedDrawPayloadState,
			);
		}
	}

		#markStaticObjectVisualResourcePreparedPayloadDirty(
			resourceId: string,
		): void {
			const resource = this.#staticObjectVisualResources.get(resourceId);
		if (resource) {
			markStaticObjectPreparedDrawPayloadDirty(
				resource.preparedDrawPayloadState,
			);
			}
		}

		#markDynamicVisualResourcePreparedPayloadDirty(resourceId: string): void {
			for (const resource of this.#dynamicGeometryResources.get(resourceId) ?? []) {
				markStaticObjectPreparedDrawPayloadDirty(
					resource.preparedDrawPayloadState,
				);
			}
		}

		#markPreparedPayloadDirtyForTextureBindingOwner(
			owner: TextureBindingOwner,
		): void {
		if (owner.kind === "draw-unit") {
			this.#markStaticObjectPreparedPayloadDirty(owner.drawUnitId);
			this.#markTerrainPreparedPayloadDirty(owner.drawUnitId);
			return;
			}
			if (owner.kind === "dynamic-visual-resource") {
				this.#markDynamicVisualResourcePreparedPayloadDirty(owner.resourceId);
				return;
			}
		this.#markStaticObjectVisualResourcePreparedPayloadDirty(owner.resourceId);
	}

	#markAllStaticObjectPreparedPayloadsDirty(): void {
		for (const resource of this.#staticObjectResources.values()) {
			markStaticObjectPreparedDrawPayloadDirty(
				resource.preparedDrawPayloadState,
			);
		}
			for (const resource of this.#staticObjectVisualResources.values()) {
				markStaticObjectPreparedDrawPayloadDirty(
					resource.preparedDrawPayloadState,
				);
			}
			for (const resources of this.#dynamicGeometryResources.values()) {
				for (const resource of resources) {
					markStaticObjectPreparedDrawPayloadDirty(
						resource.preparedDrawPayloadState,
					);
				}
			}
			for (const resource of this.#structuredInteriorResources.values()) {
				markStaticObjectPreparedDrawPayloadDirty(
					resource.preparedDrawPayloadState,
			);
		}
	}

	#resizeToDisplaySize(): void {
		const devicePixelRatio = window.devicePixelRatio || 1;
		const width = Math.max(
			1,
			Math.floor(this.#canvas.clientWidth * devicePixelRatio),
		);
		const height = Math.max(
			1,
			Math.floor(this.#canvas.clientHeight * devicePixelRatio),
		);

		if (this.#canvas.width !== width || this.#canvas.height !== height) {
			this.#canvas.width = width;
			this.#canvas.height = height;
		}
	}

	#createSnapshot(): RendererSnapshot {
		const effectiveRenderPassPlan = this.#getEffectiveRenderPassPlan();
		const staticObjectResources = [...this.#staticObjectResources.values()];
		const staticObjectVisualResources = [
			...this.#staticObjectVisualResources.values(),
		];
		return {
			backend: "webgl2",
			canvasWidth: this.#canvas.width,
			canvasHeight: this.#canvas.height,
			debugOverlayPrimitives: this.#debugOverlayPrimitiveCount,
			error: this.#error,
			frameCount: this.#frameCount,
			frameHandlerMs: this.#frameHandlerMs,
			isRunning: !this.#disposed,
			portalFrameWorkPlan: this.#portalFrameWorkPlan,
			renderPassPlan: effectiveRenderPassPlan,
			dynamicVisualResources: this.#dynamicVisualResources.size,
			dynamicVisualResourceTextureUses: sumNumbers(
				[...this.#dynamicVisualResources.values()].map(
					(resource) => resource.materialPlan.textureUses.length,
				),
			),
			dynamicDrawCalls: this.#lastDynamicDrawCalls,
			dynamicInstances: this.#dynamicInstances.size,
			renderedTriangles: sumRenderedTriangles([
				...this.#terrainResources.values(),
				...staticObjectResources,
				...staticObjectVisualResources,
				...this.#structuredInteriorResources.values(),
			]),
			recentDynamicResourceCommits: [...this.#recentDynamicResourceCommits],
			recentStaticObjectUploads: [...this.#recentStaticObjectUploads],
			skippedDynamicSubmissions: this.#lastSkippedDynamicSubmissions,
			sceneDomainTargets: this.#createSceneDomainTargetSnapshot(),
			staticDrawUnits:
				this.#terrainResources.size +
				this.#staticObjectResources.size +
				this.#staticObjectVisualResources.size +
				this.#structuredInteriorResources.size,
			staticObjectBakedDirectDrawCalls:
				this.#lastStaticObjectBakedDirectDrawCalls,
			staticObjectResources: staticObjectResources.length,
			staticObjectVisualResources: staticObjectVisualResources.length,
			staticObjectRenderInstances: this.#staticObjectRenderInstances.size,
			staticObjectDirectRenderInstanceDrawCalls:
				this.#lastStaticObjectDirectRenderInstanceDrawCalls,
			staticObjectInstancedRenderInstanceDrawCalls:
				this.#lastStaticObjectInstancedRenderInstanceDrawCalls,
			staticObjectInstancedRenderInstances:
				this.#lastStaticObjectInstancedRenderInstances,
			staticObjectNearTransparentDirectRenderInstanceDrawCalls:
				this.#lastStaticObjectNearTransparentDirectRenderInstanceDrawCalls,
			staticObjectFarTransparentDirectRenderInstanceDrawCalls:
				this.#lastStaticObjectFarTransparentDirectRenderInstanceDrawCalls,
			staticObjectFarTransparentInstancedRenderInstanceDrawCalls:
				this.#lastStaticObjectFarTransparentInstancedRenderInstanceDrawCalls,
			staticObjectFarTransparentInstancedRenderInstances:
				this.#lastStaticObjectFarTransparentInstancedRenderInstances,
			outdoorDetailStaticObjectResources: staticObjectResources.filter(
				(resource) => resource.domain === "outdoor-detail",
			).length,
			outdoorDetailStaticObjectBakedDirectDrawCalls:
				this.#lastOutdoorDetailStaticObjectBakedDirectDrawCalls,
			outdoorDetailStaticObjectBakedDirectDrawCallsByPass: {
				...this.#lastOutdoorDetailStaticObjectBakedDirectDrawCallsByPass,
			},
			outdoorDetailStaticObjectVisualResources:
				staticObjectVisualResources.length,
			outdoorDetailStaticObjectRenderInstances:
				this.#staticObjectRenderInstances.size,
			staticObjectUploadedBufferBytes: sumNumbers(
				[...staticObjectResources, ...staticObjectVisualResources].map(
					(resource) => resource.uploadedBufferBytes,
				),
			),
			outdoorDetailStaticObjectUploadedBufferBytes: sumNumbers(
				[
					...staticObjectResources.filter(
						(resource) => resource.domain === "outdoor-detail",
					),
					...staticObjectVisualResources,
				].map((resource) => resource.uploadedBufferBytes),
			),
			terrainDrawUnits: this.#terrainResources.size,
			directEnvCellDrawCalls: this.#lastDirectEnvCellDrawCalls,
		};
	}

	#createFrameTelemetry(): RendererFrameTelemetry {
		return {
			directEnvCellDrawCalls: this.#lastDirectEnvCellDrawCalls,
			frameCount: this.#frameCount,
			frameHandlerMs: this.#frameHandlerMs,
		};
	}

	#replaceStaticLayer(
		key: Parameters<typeof createStaticLandblockLayerKey>[0],
		payload: { readonly landblockId: number } | null,
		install: (ownership: StaticLayerResourceOwnership) => void,
	): void {
		const normalizedKey = {
			...key,
			landblockId: key.landblockId >>> 0,
		};
		const layerKey = createStaticLandblockLayerKey(normalizedKey);
		this.#clearStaticLayerByKey(layerKey);

		if (!payload) {
			this.#stateCache.invalidate();
			return;
		}
		if (payload.landblockId >>> 0 !== normalizedKey.landblockId) {
			throw new Error(
				`Static layer ${layerKey} received payload for 0x${(payload.landblockId >>> 0).toString(16).padStart(8, "0")}.`,
			);
		}

		const ownership = createEmptyStaticLayerResourceOwnership();
		install(ownership);
		this.#staticLayerOwnershipByKey.set(layerKey, ownership);
		this.#stateCache.invalidate();
	}

	#clearStaticLayerByKey(layerKey: string): void {
		const ownership = this.#staticLayerOwnershipByKey.get(layerKey);
		if (!ownership) {
			return;
		}

		for (const apertureResourceId of ownership.portalApertureResourceIds) {
			this.#removePortalApertureResource(apertureResourceId);
		}
		for (const drawUnitId of ownership.drawUnitIds) {
			const terrainResource = this.#terrainResources.get(drawUnitId);
			if (terrainResource) {
				terrainResource.dispose();
				this.#terrainResources.delete(drawUnitId);
				this.#warnedLayeredFallbackDrawUnitIds.delete(drawUnitId);
			}
			this.#removeStaticObjectResource(drawUnitId);
			this.#removeStructuredInteriorResource(drawUnitId);
		}
		for (const ownerKey of ownership.textureBindingOwnerKeys) {
			this.#textureBindings.delete(ownerKey);
		}
		for (const instanceId of ownership.staticObjectRenderInstanceIds) {
			this.#staticObjectRenderInstances.delete(instanceId);
		}
		for (const resourceId of ownership.staticObjectVisualResourceIds) {
			this.#removeStaticObjectVisualResource(resourceId);
		}
		this.#staticLayerOwnershipByKey.delete(layerKey);
	}

	#addStaticObjectResource(resource: StaticObjectGeometryResource): void {
		this.#staticObjectResources.set(resource.drawUnitId, resource);
		for (const envCellId of resource.envCellIds) {
			addResourceMembership(
				this.#envCellStaticObjectResourceIdsByEnvCellKey,
				createEnvCellResourceKey(resource.landblockId, envCellId),
				resource.drawUnitId,
			);
		}
	}

	#removeStaticObjectResource(drawUnitId: string): void {
		const resource = this.#staticObjectResources.get(drawUnitId);
		if (!resource) {
			return;
		}
		resource.dispose();
		this.#staticObjectResources.delete(drawUnitId);
		for (const envCellId of resource.envCellIds) {
			removeResourceMembership(
				this.#envCellStaticObjectResourceIdsByEnvCellKey,
				createEnvCellResourceKey(resource.landblockId, envCellId),
				drawUnitId,
			);
		}
	}

	#addStaticObjectVisualResource(
		resource: StaticObjectVisualGeometryResource,
	): void {
		this.#staticObjectVisualResources.set(resource.resourceId, resource);
	}

	#removeStaticObjectVisualResource(resourceId: string): void {
		const resource = this.#staticObjectVisualResources.get(resourceId);
		if (!resource) {
			return;
		}
		resource.dispose();
		this.#staticObjectVisualResources.delete(resourceId);
	}

	#recordStaticObjectUpload(diagnostics: StaticObjectUploadDiagnostics): void {
		this.#recentStaticObjectUploads.push(diagnostics);
		if (
			this.#recentStaticObjectUploads.length >
			RECENT_STATIC_OBJECT_UPLOAD_DIAGNOSTICS_LIMIT
		) {
			this.#recentStaticObjectUploads.splice(
				0,
				this.#recentStaticObjectUploads.length -
					RECENT_STATIC_OBJECT_UPLOAD_DIAGNOSTICS_LIMIT,
			);
		}
	}

	#addStructuredInteriorResource(
		resource: StructuredInteriorGeometryResource,
	): void {
		this.#structuredInteriorResources.set(resource.drawUnitId, resource);
		addResourceMembership(
			this.#structuredInteriorResourceIdsByEnvCellKey,
			createEnvCellResourceKey(resource.landblockId, resource.envCellId),
			resource.drawUnitId,
		);
	}

	#removeStructuredInteriorResource(drawUnitId: string): void {
		const resource = this.#structuredInteriorResources.get(drawUnitId);
		if (!resource) {
			return;
		}
		resource.dispose();
		this.#structuredInteriorResources.delete(drawUnitId);
		removeResourceMembership(
			this.#structuredInteriorResourceIdsByEnvCellKey,
			createEnvCellResourceKey(resource.landblockId, resource.envCellId),
			drawUnitId,
		);
	}

	#addPortalApertureResource(resource: StaticPortalApertureResource): void {
		this.#removePortalApertureResource(resource.apertureResourceId);
		const geometryResource = createPortalApertureGeometryResource(
			this.#gl,
			resource,
		);
		this.#portalApertureResources.set(
			resource.apertureResourceId,
			geometryResource,
		);
		for (const range of geometryResource.ranges) {
			this.#portalApertureRangesById.set(range.rangeId, {
				range,
				resource: geometryResource,
			});
		}
	}

	#emitFrameTelemetry(): void {
		const telemetry = this.#createFrameTelemetry();

		for (const listener of this.#telemetryListeners) {
			listener(telemetry);
		}
	}

	#removePortalApertureResource(apertureResourceId: string): void {
		const resource = this.#portalApertureResources.get(apertureResourceId);
		if (!resource) {
			return;
		}
		for (const range of resource.ranges) {
			this.#portalApertureRangesById.delete(range.rangeId);
		}
		resource.dispose();
		this.#portalApertureResources.delete(apertureResourceId);
	}

	#warnMissingPortalProjectionPortalApertureRange(
		edge: PortalProjectionFrameMaskEdgePlan,
	): void {
		if (this.#warnedMissingPortalApertureRangeIds.has(edge.apertureRangeId)) {
			return;
		}
		this.#warnedMissingPortalApertureRangeIds.add(edge.apertureRangeId);
		console.error(
			`Portal projection edge ${edge.linkId} references missing portal aperture range ${edge.apertureRangeId}; dropping mask draw.`,
			{
				apertureSourceId: edge.apertureSourceId,
				renderEntryId: edge.renderEntryId,
				renderLayer: edge.renderLayer,
				sourceEnvCellId: edge.sourceEnvCellId,
				sourceKind: edge.sourceKind,
				targetEnvCellId: edge.targetEnvCellId,
			},
		);
	}

	#warnMissingPortalProjectionOutdoorCrossingApertureRange(
		crossing: PortalProjectionFrameOutdoorCrossingPlan,
	): void {
		if (
			this.#warnedMissingPortalApertureRangeIds.has(crossing.apertureRangeId)
		) {
			return;
		}
		this.#warnedMissingPortalApertureRangeIds.add(crossing.apertureRangeId);
		console.error(
			`Portal projection outdoor crossing ${crossing.linkId} references missing portal aperture range ${crossing.apertureRangeId}; dropping outdoor scene copy.`,
			{
				apertureSourceId: crossing.apertureSourceId,
				crossingId: crossing.crossingId,
				outdoorLandblockId: crossing.outdoorLandblockId,
				targetEnvCellId: crossing.targetEnvCellId,
			},
		);
	}

	#warnTerrainLayeredFallback(resource: TerrainGeometryResource): void {
		if (this.#warnedLayeredFallbackDrawUnitIds.has(resource.drawUnitId)) {
			return;
		}
		this.#warnedLayeredFallbackDrawUnitIds.add(resource.drawUnitId);
		console.warn(
			`terrain draw unit ${resource.drawUnitId} rendered with terrain-debug-flat because its layered material could not be fully satisfied.`,
			{
				materialFamily: resource.materialFamily,
				reason:
					"Missing texture binding/residency, terrain role-page overflow, or a multi-page terrain role binding that the current WebGL2 shader cannot sample yet.",
			},
		);
	}

	#createResourceTranslation(
		resource:
				| TerrainGeometryResource
				| StaticObjectGeometryResource
				| StaticObjectVisualGeometryResource
				| DynamicVisualGeometryResource
				| StructuredInteriorGeometryResource,
	): readonly [number, number, number] {
		if (resource.landblockId === null) {
			return [0, 0, 0];
		}
		return this.#createLandblockTranslation(resource.landblockId);
	}

	#createResourceTransform(
		resource: StaticMaterialGeometryResource,
	): Float32Array {
		return createTranslationMatrix(this.#createResourceTranslation(resource));
	}

	#createStaticObjectInstanceTransform(
		instance: StaticObjectRenderInstance,
	): Float32Array {
		return multiplyMat4(
			createTranslationMatrix(
				this.#createLandblockTranslation(instance.landblockId),
			),
			instance.sourceToLandblockMatrix,
		);
	}

	#createLandblockTranslation(
		landblockId: number,
	): readonly [number, number, number] {
		return createOutdoorLandblockRootTranslation(
			landblockId,
			this.#staticRenderAnchorLandblockId,
		);
	}

	#computeStaticObjectSortDistanceSquared(
		resource: StaticObjectGeometryResource,
	): number {
		const translation = this.#createResourceTranslation(resource);
		const sortCenter = resource.localSortCenter;
		const cameraPosition = this.#frameState.camera.position;
		const deltaX = sortCenter[0] + translation[0] - cameraPosition[0];
		const deltaY = sortCenter[1] + translation[1] - cameraPosition[1];
		const deltaZ = sortCenter[2] + translation[2] - cameraPosition[2];

		return deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
	}

	#computeStaticObjectInstanceSortDistanceSquared(
		instance: StaticObjectRenderInstance,
	): number {
		const translation = this.#createLandblockTranslation(instance.landblockId);
		const sortCenter = instance.sortCenter;
		const cameraPosition = this.#frameState.camera.position;
		const deltaX = sortCenter.x + translation[0] - cameraPosition[0];
		const deltaY = sortCenter.y + translation[1] - cameraPosition[1];
		const deltaZ = sortCenter.z + translation[2] - cameraPosition[2];

		return deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
	}

	#ensureSceneDomainTargets(width: number, height: number): SceneDomainTargets {
		const current = this.#sceneDomainTargets;
		if (current && current.width === width && current.height === height) {
			return current;
		}

		current?.dispose();
		try {
			const targets = createSceneDomainTargets(this.#gl, width, height);
			this.#sceneDomainTargets = targets;
			return targets;
		} catch (error) {
			this.#sceneDomainTargets = null;
			console.error("Failed to allocate WebGL2 scene-domain targets.", error);
			throw error;
		}
	}

	#createSceneDomainTargetSnapshot(): SceneDomainTargetSnapshot {
		const directEnvCellFramePlan = this.#getEffectiveDirectEnvCellFramePlan();
		const directEnvCellFramePlanActive = directEnvCellFramePlan !== null;
		const directFramePlanUsesSceneTargets =
			directEnvCellFramePlan !== null &&
			(directEnvCellFramePlan.layeredGraph.baseEntry.scene.kind ===
				"outdoor-target" ||
				directEnvCellFramePlan.layeredGraph.outdoorCrossings.length > 0);
		return {
			active:
				directFramePlanUsesSceneTargets ||
				(!directEnvCellFramePlanActive &&
					this.#getEffectiveRenderPassPlan().kind === "portal-scene-domains"),
			apertureBatchDrawCalls: this.#lastCompositeApertureBatchDrawCalls,
			colorFormat: "rgb8",
			compositePasses: this.#lastCompositePasses,
			compositingMode: this.#lastCompositingMode,
			depthFormat: "depth24-stencil8",
			executedCompositeDepth: this.#lastExecutedCompositeDepth,
			envCellOutdoorCrossingColorBase:
				this.#lastEnvCellOutdoorCrossingColorBase,
			exteriorSuffixCompositeDepth: this.#lastExteriorSuffixCompositeDepth,
			exteriorSuffixCompositePasses: this.#lastExteriorSuffixCompositePasses,
			exteriorDrawCalls: this.#lastExteriorSceneDomainDrawCalls,
			height: this.#sceneDomainTargets?.height ?? 0,
			interiorDrawCalls: this.#lastInteriorSceneDomainDrawCalls,
			outdoorCrossingSource: this.#lastOutdoorCrossingSource,
			width: this.#sceneDomainTargets?.width ?? 0,
		};
	}

	#getEffectiveRenderPassPlan(): RenderPassPlan {
		if (this.#flatVisionModeEnabled) {
			return { kind: "single-surface-resident" };
		}
		return this.#renderPassPlan;
	}

	#getEffectiveDirectEnvCellFramePlan(): Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	> | null {
		if (
			this.#flatVisionModeEnabled ||
			this.#portalFrameWorkPlan.kind !== "direct-env-cell"
		) {
			return null;
		}
		return this.#portalFrameWorkPlan;
	}

	#configureDebugOverlayVertexArray(): void {
		const gl = this.#gl;
		gl.bindVertexArray(this.#debugOverlayVertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#debugOverlayVertexBuffer);
		const stride =
			DEBUG_OVERLAY_FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(
			1,
			4,
			gl.FLOAT,
			false,
			stride,
			3 * Float32Array.BYTES_PER_ELEMENT,
		);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		this.#stateCache.invalidate();
	}
}

interface TerrainGeometryProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly uColor: WebGLUniformLocation;
		readonly uCameraPosition: WebGLUniformLocation;
		readonly uColorAtlasSizes: WebGLUniformLocation;
		readonly uColorAtlasTextures: readonly WebGLUniformLocation[];
		readonly uDetailAtlasRect: WebGLUniformLocation;
		readonly uDetailAtlasSize: WebGLUniformLocation;
		readonly uDetailAtlasTexture: WebGLUniformLocation;
		readonly uDetailEnabled: WebGLUniformLocation;
		readonly uDetailFadeFar: WebGLUniformLocation;
		readonly uDetailFadeNear: WebGLUniformLocation;
		readonly uDetailTiling: WebGLUniformLocation;
		readonly uLayerBaseColorPages: WebGLUniformLocation;
		readonly uLayerBaseColorRects: WebGLUniformLocation;
		readonly uLayerBaseTilings: WebGLUniformLocation;
		readonly uLayerOverlayColorPages: WebGLUniformLocation;
		readonly uLayerOverlayColorRects: WebGLUniformLocation;
		readonly uLayerOverlayCounts: WebGLUniformLocation;
		readonly uLayerOverlayMaskPages: WebGLUniformLocation;
		readonly uLayerOverlayMaskRects: WebGLUniformLocation;
		readonly uLayerOverlayRotations: WebGLUniformLocation;
		readonly uLayerOverlayTilings: WebGLUniformLocation;
		readonly uLayerRoadColorPages: WebGLUniformLocation;
		readonly uLayerRoadColorRects: WebGLUniformLocation;
		readonly uLayerRoadCounts: WebGLUniformLocation;
		readonly uLayerRoadMaskPages: WebGLUniformLocation;
		readonly uLayerRoadMaskRects: WebGLUniformLocation;
		readonly uLayerRoadRotations: WebGLUniformLocation;
		readonly uLayerRoadTilings: WebGLUniformLocation;
		readonly uMaskAtlasSizes: WebGLUniformLocation;
		readonly uMaskAtlasTextures: readonly WebGLUniformLocation[];
		readonly uMaterialMode: WebGLUniformLocation;
		readonly uModelViewProjection: WebGLUniformLocation;
		readonly uPlacementTranslation: WebGLUniformLocation;
		readonly uTexture: WebGLUniformLocation;
		readonly uTextureRect: WebGLUniformLocation;
		readonly uTextureSize: WebGLUniformLocation;
		readonly uUseTexture: WebGLUniformLocation;
	};
	dispose(): void;
}

interface StaticObjectGeometryProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly uMaterialAlphaTests: WebGLUniformLocation;
		readonly uMaterialBaseColorPages: WebGLUniformLocation;
		readonly uMaterialBaseColorRects: WebGLUniformLocation;
		readonly uMaterialColors: WebGLUniformLocation;
		readonly uMaterialDetailEnabled: WebGLUniformLocation;
		readonly uMaterialDetailTexturePages: WebGLUniformLocation;
		readonly uMaterialDetailTextureRects: WebGLUniformLocation;
		readonly uMaterialDetailTilings: WebGLUniformLocation;
		readonly uMaterialEmissiveColors: WebGLUniformLocation;
		readonly uMaterialIndexedClipThresholds: WebGLUniformLocation;
		readonly uMaterialIndexedTextureFormats: WebGLUniformLocation;
		readonly uMaterialIndexTexturePages: WebGLUniformLocation;
		readonly uMaterialIndexTextureRects: WebGLUniformLocation;
		readonly uMaterialModes: WebGLUniformLocation;
		readonly uMaterialPaletteFirstIndices: WebGLUniformLocation;
		readonly uMaterialPaletteTexturePages: WebGLUniformLocation;
		readonly uMaterialPaletteTextureRects: WebGLUniformLocation;
		readonly uMaterialWrapModes: WebGLUniformLocation;
		readonly uModelViewProjection: WebGLUniformLocation;
		readonly uObjectTransform: WebGLUniformLocation;
		readonly uUseInstanceObjectTransform: WebGLUniformLocation;
		readonly uStaticBaseColorSizes: WebGLUniformLocation;
		readonly uStaticBaseColorTextures: readonly WebGLUniformLocation[];
		readonly uStaticDetailSizes: WebGLUniformLocation;
		readonly uStaticDetailTextures: readonly WebGLUniformLocation[];
		readonly uStaticIndexTextures: readonly WebGLUniformLocation[];
		readonly uStaticPaletteSizes: WebGLUniformLocation;
		readonly uStaticPaletteTextures: readonly WebGLUniformLocation[];
	};
	dispose(): void;
}

function createDynamicResourceCommitDiagnostics(
	commit: DynamicRendererResourceCommit,
): DynamicRendererResourceCommitDiagnostics {
	return {
		addedVisualResources: commit.addedVisualResources.length,
		removedVisualResources: commit.removedVisualResourceIds.length,
		revision: commit.revision,
		skippedMaterials: sumNumbers(
			commit.addedVisualResources.map(
				(resource) => resource.materialPlan.skipped.length,
			),
		),
		textureUses: sumNumbers(
			commit.addedVisualResources.map(
				(resource) => resource.materialPlan.textureUses.length,
			),
		),
	};
}

function appendBounded<T>(
	values: readonly T[],
	value: T,
	limit: number,
): T[] {
	return [...values, value].slice(-limit);
}

interface DebugOverlayProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly uModelViewProjection: WebGLUniformLocation;
	};
	dispose(): void;
}

interface TransitionApertureCompositeProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly uModelViewProjection: WebGLUniformLocation;
		readonly uPlacementTranslation: WebGLUniformLocation;
	};
	dispose(): void;
}

interface SourceSceneCopyProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly uSourceSceneColor: WebGLUniformLocation;
		readonly uSourceSceneDepth: WebGLUniformLocation;
	};
	dispose(): void;
}

interface DirectPortalDepthResetProgram {
	readonly program: WebGLProgram;
	dispose(): void;
}

interface TerrainGeometryResource {
	readonly vertexArray: WebGLVertexArrayObject;
	readonly positionBuffer: WebGLBuffer;
	readonly texCoordBuffer: WebGLBuffer;
	readonly layerSlotBuffer: WebGLBuffer;
	readonly indexBuffer: WebGLBuffer;
	readonly drawUnitId: string;
	readonly landblockId: TerrainGeometryStaticDrawUnit["landblockId"];
	readonly materialFamily: TerrainGeometryStaticDrawUnit["materialFamily"];
	readonly primaryTextureUseId: string | null;
	readonly preparedLayeredPayloadState: TerrainPreparedLayeredPayloadState;
	readonly terrainMaterialPlan: TerrainGeometryStaticDrawUnit["terrainMaterialPlan"];
	readonly indexCount: number;
	readonly indexType: GLenum;
	readonly triangleCount: number;
	dispose(): void;
}

interface StaticObjectGeometryResource {
	readonly vertexArray: WebGLVertexArrayObject;
	readonly positionBuffer: WebGLBuffer;
	readonly texCoordBuffer: WebGLBuffer;
	readonly materialSlotBuffer: WebGLBuffer;
	readonly indexBuffer: WebGLBuffer;
	readonly drawUnitId: string;
	readonly landblockId: StaticObjectGeometryStaticDrawUnit["landblockId"];
	readonly domain: StaticObjectGeometryStaticDrawUnit["domain"];
	readonly envCellIds: readonly number[];
	readonly materialFamily: StaticObjectGeometryStaticDrawUnit["materialFamily"];
	readonly materialPass: StaticObjectGeometryStaticDrawUnit["materialPass"];
	readonly materialEntries: StaticObjectGeometryStaticDrawUnit["materialEntries"];
	readonly preparedDrawPayloadState: StaticObjectPreparedDrawPayloadState;
	readonly renderState: StaticObjectRenderState;
	readonly localSortCenter: StaticObjectSortMetadata["center"];
	readonly sortPolicy: StaticObjectSortMetadata["policy"];
	readonly uploadedBufferBytes: number;
	readonly indexCount: number;
	readonly indexType: GLenum;
	readonly triangleCount: number;
	dispose(): void;
}

interface StaticObjectVisualGeometryResource {
	readonly vertexArray: WebGLVertexArrayObject;
	readonly positionBuffer: WebGLBuffer;
	readonly texCoordBuffer: WebGLBuffer;
	readonly materialSlotBuffer: WebGLBuffer;
	readonly indexBuffer: WebGLBuffer;
	readonly drawUnitId: string;
	readonly resourceId: StaticObjectVisualResource["resourceId"];
	readonly landblockId: number | null;
	readonly domain: "outdoor-detail";
	readonly materialFamily: StaticObjectVisualResource["materialFamily"];
	readonly materialPass: StaticObjectVisualResource["materialPass"];
	readonly materialEntries: StaticObjectVisualResource["materialEntries"];
	readonly preparedDrawPayloadState: StaticObjectPreparedDrawPayloadState;
	readonly renderState: StaticObjectRenderState;
	readonly uploadedBufferBytes: number;
	readonly indexCount: number;
	readonly indexType: GLenum;
	readonly triangleCount: number;
	dispose(): void;
}

interface DynamicVisualGeometryResource {
	readonly vertexArray: WebGLVertexArrayObject;
	readonly positionBuffer: WebGLBuffer;
	readonly texCoordBuffer: WebGLBuffer;
	readonly materialSlotBuffer: WebGLBuffer;
	readonly indexBuffer: WebGLBuffer;
	readonly drawUnitId: string;
	readonly dynamicResourceId: DynamicRendererVisualResource["resourceId"];
	readonly partIndex: DynamicRendererVisualPart["partIndex"];
	readonly landblockId: null;
	readonly materialFamily: DynamicRendererVisualPart["materialFamily"];
	readonly materialPass: DynamicRendererVisualPart["materialPass"];
	readonly materialEntries: DynamicRendererVisualPart["materialEntries"];
	readonly preparedDrawPayloadState: StaticObjectPreparedDrawPayloadState;
	readonly renderState: StaticObjectRenderState;
	readonly uploadedBufferBytes: number;
	readonly indexCount: number;
	readonly indexType: GLenum;
	readonly triangleCount: number;
	dispose(): void;
}

interface StaticObjectInstanceDrawResource {
	readonly instance: StaticObjectRenderInstance;
	readonly resource: StaticObjectVisualGeometryResource;
}

type SceneDomain = "exterior" | "interior";
type RenderStaticDomain = SceneDomain | "single-surface-resident";

function createStaticTextureBindingOwnerForResource(
	resource: StaticMaterialGeometryResource,
): TextureBindingOwner {
	if ("dynamicResourceId" in resource) {
		return {
			kind: "dynamic-visual-resource",
			resourceId: resource.dynamicResourceId,
		};
	}
	if ("resourceId" in resource) {
		return {
			kind: "static-object-visual-resource",
			resourceId: resource.resourceId,
		};
	}
	return {
		drawUnitId: resource.drawUnitId,
		kind: "draw-unit",
	};
}

function createEmptyStaticLayerResourceOwnership(): StaticLayerResourceOwnership {
	return {
		drawUnitIds: new Set<string>(),
		staticObjectRenderInstanceIds: new Set<string>(),
		staticObjectVisualResourceIds: new Set<string>(),
		portalApertureResourceIds: new Set<string>(),
		textureBindingOwnerKeys: new Set<string>(),
	};
}

function createEmptyStaticObjectMaterialPassDrawCallCounts(): StaticObjectMaterialPassDrawCallAccumulator {
	return {
		additive: 0,
		alphaTest: 0,
		opaque: 0,
		transparent: 0,
	};
}

function incrementStaticObjectMaterialPassDrawCallCounts(
	counts: StaticObjectMaterialPassDrawCallAccumulator,
	pass: StaticObjectGeometryStaticDrawUnit["materialPass"],
): void {
	switch (pass) {
		case "opaque":
			counts.opaque += 1;
			return;
		case "alpha-test":
			counts.alphaTest += 1;
			return;
		case "transparent":
			counts.transparent += 1;
			return;
		case "additive":
			counts.additive += 1;
			return;
	}
}

function staticLayerVisibilityEquals(
	left: RendererStaticLayerVisibility,
	right: RendererStaticLayerVisibility,
): boolean {
	return (
		left.envCellInteriors === right.envCellInteriors &&
		left.outdoorBuildings === right.outdoorBuildings &&
		left.outdoorDetail === right.outdoorDetail &&
		left.terrain === right.terrain
	);
}

type StaticMaterialGeometryResource =
	| StaticObjectGeometryResource
	| StaticObjectVisualGeometryResource
	| DynamicVisualGeometryResource
	| StructuredInteriorGeometryResource;

interface StructuredInteriorGeometryResource {
	readonly vertexArray: WebGLVertexArrayObject;
	readonly positionBuffer: WebGLBuffer;
	readonly texCoordBuffer: WebGLBuffer;
	readonly materialSlotBuffer: WebGLBuffer;
	readonly indexBuffer: WebGLBuffer;
	readonly drawUnitId: string;
	readonly landblockId: StructuredInteriorGeometryStaticDrawUnit["landblockId"];
	readonly envCellId: StructuredInteriorGeometryStaticDrawUnit["envCellId"];
	readonly materialFamily: StructuredInteriorGeometryStaticDrawUnit["materialFamily"];
	readonly materialEntries: StructuredInteriorGeometryStaticDrawUnit["materialEntries"];
	readonly preparedDrawPayloadState: StaticObjectPreparedDrawPayloadState;
	readonly renderState: StaticObjectRenderState;
	readonly indexCount: number;
	readonly indexType: GLenum;
	readonly triangleCount: number;
	dispose(): void;
}

interface PortalApertureGeometryResource {
	readonly vertexArray: WebGLVertexArrayObject;
	readonly positionBuffer: WebGLBuffer;
	readonly indexBuffer: WebGLBuffer;
	readonly apertureResourceId: string;
	readonly landblockId: number;
	readonly ranges: readonly StaticPortalApertureRange[];
	readonly indexCount: number;
	readonly indexType: GLenum;
	dispose(): void;
}

interface PortalApertureRangeResource {
	readonly resource: PortalApertureGeometryResource;
	readonly range: StaticPortalApertureRange;
}

interface SceneDomainTargets {
	readonly width: number;
	readonly height: number;
	readonly exterior: SceneDomainTarget;
	readonly interior: SceneDomainTarget;
	readonly compositePing: SceneDomainTarget;
	readonly compositePong: SceneDomainTarget;
	dispose(): void;
}

interface SceneDomainTarget {
	readonly label: string;
	readonly width: number;
	readonly height: number;
	readonly framebuffer: WebGLFramebuffer;
	readonly colorTexture: WebGLTexture;
	readonly depthTexture: WebGLTexture;
	dispose(): void;
}

interface SelectedOutdoorCompositeSource {
	readonly kind: "raw-exterior" | "exterior-suffix";
	readonly target: SceneDomainTarget;
}

interface RenderedTriangleResource {
	readonly triangleCount: number;
}

function createSceneDomainTargets(
	gl: WebGL2RenderingContext,
	width: number,
	height: number,
): SceneDomainTargets {
	const exterior = createSceneDomainTarget(gl, "exterior scene", width, height);
	try {
		const interior = createSceneDomainTarget(
			gl,
			"interior scene",
			width,
			height,
		);
		try {
			const compositePing = createSceneDomainTarget(
				gl,
				"composite ping",
				width,
				height,
			);
			try {
				const compositePong = createSceneDomainTarget(
					gl,
					"composite pong",
					width,
					height,
				);
				return {
					compositePing,
					compositePong,
					exterior,
					height,
					interior,
					width,
					dispose() {
						exterior.dispose();
						interior.dispose();
						compositePing.dispose();
						compositePong.dispose();
					},
				};
			} catch (error) {
				compositePing.dispose();
				throw error;
			}
		} catch (error) {
			interior.dispose();
			throw error;
		}
	} catch (error) {
		exterior.dispose();
		throw error;
	}
}

function createSceneDomainTarget(
	gl: WebGL2RenderingContext,
	label: string,
	width: number,
	height: number,
): SceneDomainTarget {
	const colorTexture = createSceneDomainColorTexture(gl, width, height);
	try {
		const depthTexture = createSceneDomainDepthTexture(gl, width, height);
		try {
			const framebuffer = gl.createFramebuffer();
			if (!framebuffer) {
				throw new Error(`Failed to create WebGL2 ${label} framebuffer.`);
			}
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
			gl.framebufferTexture2D(
				gl.FRAMEBUFFER,
				gl.COLOR_ATTACHMENT0,
				gl.TEXTURE_2D,
				colorTexture,
				0,
			);
			gl.framebufferTexture2D(
				gl.FRAMEBUFFER,
				gl.DEPTH_STENCIL_ATTACHMENT,
				gl.TEXTURE_2D,
				depthTexture,
				0,
			);
			const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			if (status !== gl.FRAMEBUFFER_COMPLETE) {
				gl.deleteFramebuffer(framebuffer);
				throw new Error(
					`WebGL2 ${label} framebuffer is incomplete: 0x${status.toString(16)}.`,
				);
			}

			return {
				colorTexture,
				depthTexture,
				framebuffer,
				height,
				label,
				width,
				dispose() {
					gl.deleteFramebuffer(framebuffer);
					gl.deleteTexture(colorTexture);
					gl.deleteTexture(depthTexture);
				},
			};
		} catch (error) {
			gl.deleteTexture(depthTexture);
			throw error;
		}
	} catch (error) {
		gl.deleteTexture(colorTexture);
		throw error;
	}
}

function createSceneDomainColorTexture(
	gl: WebGL2RenderingContext,
	width: number,
	height: number,
): WebGLTexture {
	const texture = createSceneDomainTexture(gl);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGB8,
		width,
		height,
		0,
		gl.RGB,
		gl.UNSIGNED_BYTE,
		null,
	);
	gl.bindTexture(gl.TEXTURE_2D, null);
	return texture;
}

function createSceneDomainDepthTexture(
	gl: WebGL2RenderingContext,
	width: number,
	height: number,
): WebGLTexture {
	const texture = createSceneDomainTexture(gl);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.DEPTH24_STENCIL8,
		width,
		height,
		0,
		gl.DEPTH_STENCIL,
		gl.UNSIGNED_INT_24_8,
		null,
	);
	gl.bindTexture(gl.TEXTURE_2D, null);
	return texture;
}

function createSceneDomainTexture(gl: WebGL2RenderingContext): WebGLTexture {
	const texture = gl.createTexture();
	if (!texture) {
		throw new Error("Failed to create WebGL2 scene-domain texture.");
	}
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return texture;
}

function shouldDrawStaticObjectResourceInDomain(
	resource: StaticObjectGeometryResource,
	domain: RenderStaticDomain,
	visibility: RendererStaticLayerVisibility,
): boolean {
	if (domain === "single-surface-resident") {
		if (resource.domain === "outdoor-buildings") {
			return visibility.outdoorBuildings;
		}
		if (resource.domain === "outdoor-detail") {
			return visibility.outdoorDetail;
		}
		return visibility.envCellInteriors;
	}
	const isInteriorStaticObject = resource.domain === "landblock-env-cells";
	if (domain === "interior") {
		return isInteriorStaticObject && visibility.envCellInteriors;
	}
	if (isInteriorStaticObject) {
		return false;
	}
	return resource.domain === "outdoor-buildings"
		? visibility.outdoorBuildings
		: visibility.outdoorDetail;
}

function shouldDrawDynamicInstanceInDomain(
	instance: DynamicRendererInstance,
	domain: RenderStaticDomain,
): boolean {
	if (domain === "single-surface-resident") {
		return true;
	}
	if (instance.renderResidence.kind === "env-cell") {
		return domain === "interior";
	}
	return domain === "exterior";
}

function createTerrainGeometryProgram(
	gl: WebGL2RenderingContext,
): TerrainGeometryProgram {
	const vertexShader = compileShader(
		gl,
		gl.VERTEX_SHADER,
		TERRAIN_VERTEX_SHADER,
	);
	const fragmentShader = compileShader(
		gl,
		gl.FRAGMENT_SHADER,
		TERRAIN_FRAGMENT_SHADER,
	);
	const program = gl.createProgram();
	if (!program) {
		throw new Error("Failed to create terrain geometry shader program.");
	}

	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(program) ?? "unknown link error";
		gl.deleteProgram(program);
		throw new Error(`Failed to link terrain geometry shader: ${message}`);
	}

	return {
		program,
		uniforms: {
			uCameraPosition: requireUniform(gl, program, "uCameraPosition"),
			uColor: requireUniform(gl, program, "uColor"),
			uColorAtlasSizes: requireUniform(gl, program, "uColorAtlasSizes"),
			uColorAtlasTextures: createRolePageTextureUniforms(
				gl,
				program,
				"uColorAtlasTexture",
				MAX_TERRAIN_COLOR_PAGES_PER_DRAW,
			),
			uDetailAtlasRect: requireUniform(gl, program, "uDetailAtlasRect"),
			uDetailAtlasSize: requireUniform(gl, program, "uDetailAtlasSize"),
			uDetailAtlasTexture: requireUniform(gl, program, "uDetailAtlasTexture"),
			uDetailEnabled: requireUniform(gl, program, "uDetailEnabled"),
			uDetailFadeFar: requireUniform(gl, program, "uDetailFadeFar"),
			uDetailFadeNear: requireUniform(gl, program, "uDetailFadeNear"),
			uDetailTiling: requireUniform(gl, program, "uDetailTiling"),
			uLayerBaseColorPages: requireUniform(gl, program, "uLayerBaseColorPages"),
			uLayerBaseColorRects: requireUniform(gl, program, "uLayerBaseColorRects"),
			uLayerBaseTilings: requireUniform(gl, program, "uLayerBaseTilings"),
			uLayerOverlayColorPages: requireUniform(
				gl,
				program,
				"uLayerOverlayColorPages",
			),
			uLayerOverlayColorRects: requireUniform(
				gl,
				program,
				"uLayerOverlayColorRects",
			),
			uLayerOverlayCounts: requireUniform(gl, program, "uLayerOverlayCounts"),
			uLayerOverlayMaskPages: requireUniform(
				gl,
				program,
				"uLayerOverlayMaskPages",
			),
			uLayerOverlayMaskRects: requireUniform(
				gl,
				program,
				"uLayerOverlayMaskRects",
			),
			uLayerOverlayRotations: requireUniform(
				gl,
				program,
				"uLayerOverlayRotations",
			),
			uLayerOverlayTilings: requireUniform(gl, program, "uLayerOverlayTilings"),
			uLayerRoadColorPages: requireUniform(gl, program, "uLayerRoadColorPages"),
			uLayerRoadColorRects: requireUniform(gl, program, "uLayerRoadColorRects"),
			uLayerRoadCounts: requireUniform(gl, program, "uLayerRoadCounts"),
			uLayerRoadMaskPages: requireUniform(gl, program, "uLayerRoadMaskPages"),
			uLayerRoadMaskRects: requireUniform(gl, program, "uLayerRoadMaskRects"),
			uLayerRoadRotations: requireUniform(gl, program, "uLayerRoadRotations"),
			uLayerRoadTilings: requireUniform(gl, program, "uLayerRoadTilings"),
			uMaskAtlasSizes: requireUniform(gl, program, "uMaskAtlasSizes"),
			uMaskAtlasTextures: createRolePageTextureUniforms(
				gl,
				program,
				"uMaskAtlasTexture",
				MAX_TERRAIN_MASK_PAGES_PER_DRAW,
			),
			uMaterialMode: requireUniform(gl, program, "uMaterialMode"),
			uModelViewProjection: requireUniform(gl, program, "uModelViewProjection"),
			uPlacementTranslation: requireUniform(
				gl,
				program,
				"uPlacementTranslation",
			),
			uTexture: requireUniform(gl, program, "uTexture"),
			uTextureRect: requireUniform(gl, program, "uTextureRect"),
			uTextureSize: requireUniform(gl, program, "uTextureSize"),
			uUseTexture: requireUniform(gl, program, "uUseTexture"),
		},
		dispose() {
			gl.deleteProgram(program);
		},
	};
}

function createStaticObjectGeometryProgram(
	gl: WebGL2RenderingContext,
): StaticObjectGeometryProgram {
	const vertexShader = compileShader(
		gl,
		gl.VERTEX_SHADER,
		STATIC_OBJECT_VERTEX_SHADER,
	);
	const fragmentShader = compileShader(
		gl,
		gl.FRAGMENT_SHADER,
		STATIC_OBJECT_FRAGMENT_SHADER,
	);
	const program = gl.createProgram();
	if (!program) {
		throw new Error("Failed to create static object geometry shader program.");
	}

	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(program) ?? "unknown link error";
		gl.deleteProgram(program);
		throw new Error(`Failed to link static object geometry shader: ${message}`);
	}

	return {
		program,
		uniforms: {
			uMaterialAlphaTests: requireUniform(
				gl,
				program,
				"uMaterialAlphaTests[0]",
			),
			uMaterialBaseColorPages: requireUniform(
				gl,
				program,
				"uMaterialBaseColorPages[0]",
			),
			uMaterialBaseColorRects: requireUniform(
				gl,
				program,
				"uMaterialBaseColorRects[0]",
			),
			uMaterialColors: requireUniform(gl, program, "uMaterialColors[0]"),
			uMaterialDetailEnabled: requireUniform(
				gl,
				program,
				"uMaterialDetailEnabled[0]",
			),
			uMaterialDetailTexturePages: requireUniform(
				gl,
				program,
				"uMaterialDetailTexturePages[0]",
			),
			uMaterialDetailTextureRects: requireUniform(
				gl,
				program,
				"uMaterialDetailTextureRects[0]",
			),
			uMaterialDetailTilings: requireUniform(
				gl,
				program,
				"uMaterialDetailTilings[0]",
			),
			uMaterialEmissiveColors: requireUniform(
				gl,
				program,
				"uMaterialEmissiveColors[0]",
			),
			uMaterialIndexedClipThresholds: requireUniform(
				gl,
				program,
				"uMaterialIndexedClipThresholds[0]",
			),
			uMaterialIndexedTextureFormats: requireUniform(
				gl,
				program,
				"uMaterialIndexedTextureFormats[0]",
			),
			uMaterialIndexTexturePages: requireUniform(
				gl,
				program,
				"uMaterialIndexTexturePages[0]",
			),
			uMaterialIndexTextureRects: requireUniform(
				gl,
				program,
				"uMaterialIndexTextureRects[0]",
			),
			uMaterialModes: requireUniform(gl, program, "uMaterialModes[0]"),
			uMaterialPaletteFirstIndices: requireUniform(
				gl,
				program,
				"uMaterialPaletteFirstIndices[0]",
			),
			uMaterialPaletteTexturePages: requireUniform(
				gl,
				program,
				"uMaterialPaletteTexturePages[0]",
			),
			uMaterialPaletteTextureRects: requireUniform(
				gl,
				program,
				"uMaterialPaletteTextureRects[0]",
			),
			uMaterialWrapModes: requireUniform(gl, program, "uMaterialWrapModes[0]"),
			uModelViewProjection: requireUniform(gl, program, "uModelViewProjection"),
			uObjectTransform: requireUniform(gl, program, "uObjectTransform"),
			uUseInstanceObjectTransform: requireUniform(
				gl,
				program,
				"uUseInstanceObjectTransform",
			),
			uStaticBaseColorSizes: requireUniform(
				gl,
				program,
				"uStaticBaseColorSizes[0]",
			),
			uStaticBaseColorTextures: createRolePageTextureUniforms(
				gl,
				program,
				"uStaticBaseColorTexture",
				MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW,
			),
			uStaticDetailSizes: requireUniform(gl, program, "uStaticDetailSizes[0]"),
			uStaticDetailTextures: createRolePageTextureUniforms(
				gl,
				program,
				"uStaticDetailTexture",
				MAX_STATIC_OBJECT_DETAIL_PAGES_PER_DRAW,
			),
			uStaticIndexTextures: createRolePageTextureUniforms(
				gl,
				program,
				"uStaticIndexTexture",
				MAX_STATIC_OBJECT_INDEX_PAGES_PER_DRAW,
			),
			uStaticPaletteSizes: requireUniform(
				gl,
				program,
				"uStaticPaletteSizes[0]",
			),
			uStaticPaletteTextures: createRolePageTextureUniforms(
				gl,
				program,
				"uStaticPaletteTexture",
				MAX_STATIC_OBJECT_PALETTE_PAGES_PER_DRAW,
			),
		},
		dispose() {
			gl.deleteProgram(program);
		},
	};
}

function createDebugOverlayProgram(
	gl: WebGL2RenderingContext,
): DebugOverlayProgram {
	const vertexShader = compileShader(
		gl,
		gl.VERTEX_SHADER,
		DEBUG_OVERLAY_VERTEX_SHADER,
	);
	const fragmentShader = compileShader(
		gl,
		gl.FRAGMENT_SHADER,
		DEBUG_OVERLAY_FRAGMENT_SHADER,
	);
	const program = gl.createProgram();
	if (!program) {
		throw new Error("Failed to create browser debug overlay shader program.");
	}

	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(program) ?? "unknown link error";
		gl.deleteProgram(program);
		throw new Error(`Failed to link browser debug overlay shader: ${message}`);
	}

	return {
		program,
		uniforms: {
			uModelViewProjection: requireUniform(gl, program, "uModelViewProjection"),
		},
		dispose() {
			gl.deleteProgram(program);
		},
	};
}

function createTransitionApertureCompositeProgram(
	gl: WebGL2RenderingContext,
): TransitionApertureCompositeProgram {
	const vertexShader = compileShader(
		gl,
		gl.VERTEX_SHADER,
		TRANSITION_APERTURE_COMPOSITE_VERTEX_SHADER,
	);
	const fragmentShader = compileShader(
		gl,
		gl.FRAGMENT_SHADER,
		TRANSITION_APERTURE_MASK_FRAGMENT_SHADER,
	);
	const program = gl.createProgram();
	if (!program) {
		throw new Error(
			"Failed to create browser transition aperture composite shader program.",
		);
	}

	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(program) ?? "unknown link error";
		gl.deleteProgram(program);
		throw new Error(
			`Failed to link browser transition aperture composite shader: ${message}`,
		);
	}

	return {
		program,
		uniforms: {
			uModelViewProjection: requireUniform(gl, program, "uModelViewProjection"),
			uPlacementTranslation: requireUniform(
				gl,
				program,
				"uPlacementTranslation",
			),
		},
		dispose() {
			gl.deleteProgram(program);
		},
	};
}

function createSourceSceneCopyProgram(
	gl: WebGL2RenderingContext,
): SourceSceneCopyProgram {
	const vertexShader = compileShader(
		gl,
		gl.VERTEX_SHADER,
		SOURCE_SCENE_COPY_VERTEX_SHADER,
	);
	const fragmentShader = compileShader(
		gl,
		gl.FRAGMENT_SHADER,
		SOURCE_SCENE_COPY_FRAGMENT_SHADER,
	);
	const program = gl.createProgram();
	if (!program) {
		throw new Error(
			"Failed to create browser source scene copy shader program.",
		);
	}

	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(program) ?? "unknown link error";
		gl.deleteProgram(program);
		throw new Error(
			`Failed to link browser source scene copy shader: ${message}`,
		);
	}

	return {
		program,
		uniforms: {
			uSourceSceneColor: requireUniform(gl, program, "uSourceSceneColor"),
			uSourceSceneDepth: requireUniform(gl, program, "uSourceSceneDepth"),
		},
		dispose() {
			gl.deleteProgram(program);
		},
	};
}

function createDirectPortalDepthResetProgram(
	gl: WebGL2RenderingContext,
): DirectPortalDepthResetProgram {
	const vertexShader = compileShader(
		gl,
		gl.VERTEX_SHADER,
		SOURCE_SCENE_COPY_VERTEX_SHADER,
	);
	const fragmentShader = compileShader(
		gl,
		gl.FRAGMENT_SHADER,
		DIRECT_PORTAL_DEPTH_RESET_FRAGMENT_SHADER,
	);
	const program = gl.createProgram();
	if (!program) {
		throw new Error(
			"Failed to create browser direct portal depth reset shader program.",
		);
	}

	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(program) ?? "unknown link error";
		gl.deleteProgram(program);
		throw new Error(
			`Failed to link browser direct portal depth reset shader: ${message}`,
		);
	}

	return {
		program,
		dispose() {
			gl.deleteProgram(program);
		},
	};
}

function createTerrainGeometryResource(
	gl: WebGL2RenderingContext,
	drawUnit: TerrainGeometryStaticDrawUnit,
): TerrainGeometryResource {
	const vertexArray = gl.createVertexArray();
	const positionBuffer = gl.createBuffer();
	const texCoordBuffer = gl.createBuffer();
	const layerSlotBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (
		!vertexArray ||
		!positionBuffer ||
		!texCoordBuffer ||
		!layerSlotBuffer ||
		!indexBuffer
	) {
		if (vertexArray) {
			gl.deleteVertexArray(vertexArray);
		}
		if (positionBuffer) {
			gl.deleteBuffer(positionBuffer);
		}
		if (texCoordBuffer) {
			gl.deleteBuffer(texCoordBuffer);
		}
		if (layerSlotBuffer) {
			gl.deleteBuffer(layerSlotBuffer);
		}
		if (indexBuffer) {
			gl.deleteBuffer(indexBuffer);
		}
		throw new Error(`Failed to create GPU buffers for ${drawUnit.drawUnitId}.`);
	}

	gl.bindVertexArray(vertexArray);
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, drawUnit.positions, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, drawUnit.texCoords, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(1);
	gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, layerSlotBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, drawUnit.layerSlots, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(2);
	gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, drawUnit.indices, gl.STATIC_DRAW);
	gl.bindVertexArray(null);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

	return {
		drawUnitId: drawUnit.drawUnitId,
		indexBuffer,
		indexCount: drawUnit.indices.length,
		indexType:
			drawUnit.indexType === "uint16" ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
		landblockId: drawUnit.landblockId,
		materialFamily: drawUnit.materialFamily,
		primaryTextureUseId: drawUnit.primaryTextureUseId,
		preparedLayeredPayloadState: createTerrainPreparedLayeredPayloadState(),
		terrainMaterialPlan: drawUnit.terrainMaterialPlan,
		layerSlotBuffer,
		positionBuffer,
		texCoordBuffer,
		triangleCount: drawUnit.triangleCount,
		vertexArray,
		dispose() {
			gl.deleteBuffer(positionBuffer);
			gl.deleteBuffer(texCoordBuffer);
			gl.deleteBuffer(layerSlotBuffer);
			gl.deleteBuffer(indexBuffer);
			gl.deleteVertexArray(vertexArray);
		},
	};
}

function createStaticObjectGeometryResource(
	gl: WebGL2RenderingContext,
	drawUnit: StaticObjectGeometryStaticDrawUnit,
): StaticObjectGeometryResource {
	const vertexArray = gl.createVertexArray();
	const positionBuffer = gl.createBuffer();
	const texCoordBuffer = gl.createBuffer();
	const materialSlotBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (
		!vertexArray ||
		!positionBuffer ||
		!texCoordBuffer ||
		!materialSlotBuffer ||
		!indexBuffer
	) {
		if (vertexArray) {
			gl.deleteVertexArray(vertexArray);
		}
		if (positionBuffer) {
			gl.deleteBuffer(positionBuffer);
		}
		if (texCoordBuffer) {
			gl.deleteBuffer(texCoordBuffer);
		}
		if (materialSlotBuffer) {
			gl.deleteBuffer(materialSlotBuffer);
		}
		if (indexBuffer) {
			gl.deleteBuffer(indexBuffer);
		}
		throw new Error(
			`Failed to create GPU buffers for static object ${drawUnit.drawUnitId}.`,
		);
	}

	gl.bindVertexArray(vertexArray);
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, drawUnit.positions, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, drawUnit.texCoords, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(1);
	gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, materialSlotBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, drawUnit.materialSlotIndices, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(2);
	gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, drawUnit.indices, gl.STATIC_DRAW);
	gl.bindVertexArray(null);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

	return {
		domain: drawUnit.domain,
		drawUnitId: drawUnit.drawUnitId,
		envCellIds:
			drawUnit.ownership.kind === "env-cell-static-object-seeds"
				? [...new Set(drawUnit.ownership.envCellIds)].sort(compareNumbers)
				: [],
		indexBuffer,
		indexCount: drawUnit.indices.length,
		indexType:
			drawUnit.indexType === "uint16" ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
		landblockId: drawUnit.landblockId,
		localSortCenter: drawUnit.sort.center,
		materialEntries: drawUnit.materialEntries,
		materialFamily: drawUnit.materialFamily,
		materialPass: drawUnit.materialPass,
		preparedDrawPayloadState: createStaticObjectPreparedDrawPayloadState(),
		materialSlotBuffer,
		positionBuffer,
		renderState: drawUnit.renderState,
		sortPolicy: drawUnit.sort.policy,
		texCoordBuffer,
		triangleCount: drawUnit.triangleCount,
		uploadedBufferBytes: estimateStaticObjectUploadedBufferBytes(drawUnit),
		vertexArray,
		dispose() {
			gl.deleteBuffer(positionBuffer);
			gl.deleteBuffer(texCoordBuffer);
			gl.deleteBuffer(materialSlotBuffer);
			gl.deleteBuffer(indexBuffer);
			gl.deleteVertexArray(vertexArray);
		},
	};
}

function createStaticObjectVisualGeometryResource(
	gl: WebGL2RenderingContext,
	resource: StaticObjectVisualResource,
): StaticObjectVisualGeometryResource {
	const vertexArray = gl.createVertexArray();
	const positionBuffer = gl.createBuffer();
	const texCoordBuffer = gl.createBuffer();
	const materialSlotBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (
		!vertexArray ||
		!positionBuffer ||
		!texCoordBuffer ||
		!materialSlotBuffer ||
		!indexBuffer
	) {
		if (vertexArray) {
			gl.deleteVertexArray(vertexArray);
		}
		if (positionBuffer) {
			gl.deleteBuffer(positionBuffer);
		}
		if (texCoordBuffer) {
			gl.deleteBuffer(texCoordBuffer);
		}
		if (materialSlotBuffer) {
			gl.deleteBuffer(materialSlotBuffer);
		}
		if (indexBuffer) {
			gl.deleteBuffer(indexBuffer);
		}
		throw new Error(
			`Failed to create GPU buffers for static object visual resource ${resource.resourceId}.`,
		);
	}

	gl.bindVertexArray(vertexArray);
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, resource.positions, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, resource.texCoords, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(1);
	gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, materialSlotBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, resource.materialSlotIndices, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(2);
	gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, resource.indices, gl.STATIC_DRAW);
	gl.bindVertexArray(null);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

	return {
		domain: "outdoor-detail",
		drawUnitId: resource.resourceId,
		indexBuffer,
		indexCount: resource.indices.length,
		indexType:
			resource.indexType === "uint16" ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
		landblockId: null,
		materialEntries: resource.materialEntries,
		materialFamily: resource.materialFamily,
		materialPass: resource.materialPass,
		materialSlotBuffer,
		positionBuffer,
		preparedDrawPayloadState: createStaticObjectPreparedDrawPayloadState(),
		renderState: resource.renderState,
		resourceId: resource.resourceId,
		texCoordBuffer,
		triangleCount: resource.triangleCount,
		uploadedBufferBytes:
			estimateStaticObjectVisualResourceUploadedBufferBytes(resource),
		vertexArray,
		dispose() {
			gl.deleteBuffer(positionBuffer);
			gl.deleteBuffer(texCoordBuffer);
			gl.deleteBuffer(materialSlotBuffer);
			gl.deleteBuffer(indexBuffer);
			gl.deleteVertexArray(vertexArray);
		},
		};
	}

function createDynamicVisualGeometryResource(
	gl: WebGL2RenderingContext,
	resource: DynamicRendererVisualResource,
	part: DynamicRendererVisualPart,
): DynamicVisualGeometryResource {
	const vertexArray = gl.createVertexArray();
	const positionBuffer = gl.createBuffer();
	const texCoordBuffer = gl.createBuffer();
	const materialSlotBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (
		!vertexArray ||
		!positionBuffer ||
		!texCoordBuffer ||
		!materialSlotBuffer ||
		!indexBuffer
	) {
		if (vertexArray) {
			gl.deleteVertexArray(vertexArray);
		}
		if (positionBuffer) {
			gl.deleteBuffer(positionBuffer);
		}
		if (texCoordBuffer) {
			gl.deleteBuffer(texCoordBuffer);
		}
		if (materialSlotBuffer) {
			gl.deleteBuffer(materialSlotBuffer);
		}
		if (indexBuffer) {
			gl.deleteBuffer(indexBuffer);
		}
		throw new Error(
			`Failed to create GPU buffers for dynamic visual resource ${resource.resourceId} part ${part.partIndex}.`,
		);
	}

	gl.bindVertexArray(vertexArray);
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, part.positions, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, part.texCoords, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(1);
	gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, materialSlotBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, part.materialSlotIndices, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(2);
	gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, part.indices, gl.STATIC_DRAW);
	gl.bindVertexArray(null);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

	return {
		drawUnitId: `${resource.resourceId}:part:${part.partIndex}`,
		dynamicResourceId: resource.resourceId,
		indexBuffer,
		indexCount: part.indices.length,
		indexType: part.indexType === "uint16" ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
		landblockId: null,
		materialEntries: part.materialEntries,
		materialFamily: part.materialFamily,
		materialPass: part.materialPass,
		materialSlotBuffer,
		partIndex: part.partIndex,
		positionBuffer,
		preparedDrawPayloadState: createStaticObjectPreparedDrawPayloadState(),
		renderState: part.renderState,
		texCoordBuffer,
		triangleCount: part.triangleCount,
		uploadedBufferBytes:
			part.positions.byteLength +
			part.texCoords.byteLength +
			part.materialSlotIndices.byteLength +
			part.indices.byteLength,
		vertexArray,
		dispose() {
			gl.deleteBuffer(positionBuffer);
			gl.deleteBuffer(texCoordBuffer);
			gl.deleteBuffer(materialSlotBuffer);
			gl.deleteBuffer(indexBuffer);
			gl.deleteVertexArray(vertexArray);
		},
	};
}

function createStructuredInteriorGeometryResource(
	gl: WebGL2RenderingContext,
	drawUnit: StructuredInteriorGeometryStaticDrawUnit,
): StructuredInteriorGeometryResource {
	const vertexArray = gl.createVertexArray();
	const positionBuffer = gl.createBuffer();
	const texCoordBuffer = gl.createBuffer();
	const materialSlotBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (
		!vertexArray ||
		!positionBuffer ||
		!texCoordBuffer ||
		!materialSlotBuffer ||
		!indexBuffer
	) {
		if (vertexArray) {
			gl.deleteVertexArray(vertexArray);
		}
		if (positionBuffer) {
			gl.deleteBuffer(positionBuffer);
		}
		if (texCoordBuffer) {
			gl.deleteBuffer(texCoordBuffer);
		}
		if (materialSlotBuffer) {
			gl.deleteBuffer(materialSlotBuffer);
		}
		if (indexBuffer) {
			gl.deleteBuffer(indexBuffer);
		}
		throw new Error(
			`Failed to create GPU buffers for structured interior ${drawUnit.drawUnitId}.`,
		);
	}
	if (drawUnit.materialEntries.length === 0) {
		gl.deleteVertexArray(vertexArray);
		gl.deleteBuffer(positionBuffer);
		gl.deleteBuffer(texCoordBuffer);
		gl.deleteBuffer(materialSlotBuffer);
		gl.deleteBuffer(indexBuffer);
		throw new Error(
			`Structured interior resource ${drawUnit.drawUnitId} has no material table entries.`,
		);
	}

	gl.bindVertexArray(vertexArray);
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, drawUnit.positions, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, drawUnit.texCoords, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(1);
	gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, materialSlotBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, drawUnit.materialSlotIndices, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(2);
	gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, drawUnit.indices, gl.STATIC_DRAW);
	gl.bindVertexArray(null);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

	return {
		drawUnitId: drawUnit.drawUnitId,
		envCellId: drawUnit.envCellId,
		indexBuffer,
		indexCount: drawUnit.indices.length,
		indexType:
			drawUnit.indexType === "uint16" ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
		landblockId: drawUnit.landblockId,
		materialEntries: drawUnit.materialEntries,
		materialFamily: drawUnit.materialFamily,
		materialSlotBuffer,
		positionBuffer,
		preparedDrawPayloadState: createStaticObjectPreparedDrawPayloadState(),
		renderState: drawUnit.renderState,
		texCoordBuffer,
		triangleCount: drawUnit.triangleCount,
		vertexArray,
		dispose() {
			gl.deleteBuffer(positionBuffer);
			gl.deleteBuffer(texCoordBuffer);
			gl.deleteBuffer(materialSlotBuffer);
			gl.deleteBuffer(indexBuffer);
			gl.deleteVertexArray(vertexArray);
		},
	};
}

function createPortalApertureGeometryResource(
	gl: WebGL2RenderingContext,
	resource: StaticPortalApertureResource,
): PortalApertureGeometryResource {
	const vertexArray = gl.createVertexArray();
	const positionBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (!vertexArray || !positionBuffer || !indexBuffer) {
		if (vertexArray) {
			gl.deleteVertexArray(vertexArray);
		}
		if (positionBuffer) {
			gl.deleteBuffer(positionBuffer);
		}
		if (indexBuffer) {
			gl.deleteBuffer(indexBuffer);
		}
		throw new Error(
			`Failed to create GPU buffers for portal aperture resource ${resource.apertureResourceId}.`,
		);
	}

	gl.bindVertexArray(vertexArray);
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		createStaticVec3PositionBuffer(resource.vertices),
		gl.STATIC_DRAW,
	);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(
		gl.ELEMENT_ARRAY_BUFFER,
		createPortalApertureIndexBuffer(resource),
		gl.STATIC_DRAW,
	);
	gl.bindVertexArray(null);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

	return {
		apertureResourceId: resource.apertureResourceId,
		indexBuffer,
		indexCount: resource.indices.length,
		indexType:
			getPortalApertureIndexType(resource) === "uint16"
				? gl.UNSIGNED_SHORT
				: gl.UNSIGNED_INT,
		landblockId: resource.landblockId,
		positionBuffer,
		ranges: resource.ranges,
		vertexArray,
		dispose() {
			gl.deleteBuffer(positionBuffer);
			gl.deleteBuffer(indexBuffer);
			gl.deleteVertexArray(vertexArray);
		},
	};
}

function createPortalApertureIndexBuffer(
	resource: StaticPortalApertureResource,
): Uint16Array | Uint32Array {
	return getPortalApertureIndexType(resource) === "uint16"
		? new Uint16Array(resource.indices)
		: new Uint32Array(resource.indices);
}

function getPortalApertureIndexType(
	resource: StaticPortalApertureResource,
): "uint16" | "uint32" {
	return resource.vertices.length > 0xffff ? "uint32" : "uint16";
}

function getIndexElementByteSize(
	indexType: GLenum,
	gl: WebGL2RenderingContext,
): number {
	if (indexType === gl.UNSIGNED_SHORT) {
		return Uint16Array.BYTES_PER_ELEMENT;
	}
	if (indexType === gl.UNSIGNED_INT) {
		return Uint32Array.BYTES_PER_ELEMENT;
	}
	throw new Error(`Unsupported portal aperture index type ${indexType}.`);
}

function createStaticVec3PositionBuffer(
	vertices: readonly {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	}[],
): Float32Array {
	const positions = new Float32Array(vertices.length * 3);
	for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
		const vertex = vertices[vertexIndex];
		const offset = vertexIndex * 3;
		positions[offset] = vertex.x;
		positions[offset + 1] = vertex.y;
		positions[offset + 2] = vertex.z;
	}
	return positions;
}

function uploadStaticObjectRolePageBindings(
	gl: WebGL2RenderingContext,
	stateCache: Webgl2StateCache,
	samplerUniforms: readonly WebGLUniformLocation[],
	sizeUniform: WebGLUniformLocation | null,
	pages: StaticObjectPreparedRolePageBindings,
	textureUnitBase: number,
): void {
	for (const [slot, uniform] of samplerUniforms.entries()) {
		const textureUnit = textureUnitBase + slot;
		stateCache.bindTexture2D(textureUnit, pages.textures[slot] ?? null);
		gl.uniform1i(uniform, textureUnit);
	}
	if (sizeUniform) {
		gl.uniform2fv(sizeUniform, pages.sizes);
	}
}

function uploadStaticObjectMaterialTableUniforms(
	gl: WebGL2RenderingContext,
	program: StaticObjectGeometryProgram,
	uniforms: StaticObjectPreparedMaterialUniforms,
): void {
	gl.uniform1fv(program.uniforms.uMaterialAlphaTests, uniforms.alphaTests);
	gl.uniform1iv(
		program.uniforms.uMaterialBaseColorPages,
		uniforms.baseColorPages,
	);
	gl.uniform4fv(
		program.uniforms.uMaterialBaseColorRects,
		uniforms.baseColorRects,
	);
	gl.uniform4fv(program.uniforms.uMaterialColors, uniforms.colors);
	gl.uniform1iv(
		program.uniforms.uMaterialDetailEnabled,
		uniforms.detailEnabled,
	);
	gl.uniform1iv(
		program.uniforms.uMaterialDetailTexturePages,
		uniforms.detailPages,
	);
	gl.uniform4fv(
		program.uniforms.uMaterialDetailTextureRects,
		uniforms.detailRects,
	);
	gl.uniform1fv(
		program.uniforms.uMaterialDetailTilings,
		uniforms.detailTilings,
	);
	gl.uniform3fv(
		program.uniforms.uMaterialEmissiveColors,
		uniforms.emissiveColors,
	);
	gl.uniform1fv(
		program.uniforms.uMaterialIndexedClipThresholds,
		uniforms.indexedClipThresholds,
	);
	gl.uniform1iv(
		program.uniforms.uMaterialIndexedTextureFormats,
		uniforms.indexedTextureFormats,
	);
	gl.uniform1iv(
		program.uniforms.uMaterialIndexTexturePages,
		uniforms.indexPages,
	);
	gl.uniform4fv(
		program.uniforms.uMaterialIndexTextureRects,
		uniforms.indexRects,
	);
	gl.uniform1iv(program.uniforms.uMaterialModes, uniforms.materialModes);
	gl.uniform1fv(
		program.uniforms.uMaterialPaletteFirstIndices,
		uniforms.paletteFirstIndices,
	);
	gl.uniform1iv(
		program.uniforms.uMaterialPaletteTexturePages,
		uniforms.palettePages,
	);
	gl.uniform4fv(
		program.uniforms.uMaterialPaletteTextureRects,
		uniforms.paletteRects,
	);
	gl.uniform1iv(program.uniforms.uMaterialWrapModes, uniforms.wrapModes);
}

function sumRenderedTriangles(
	resources: readonly RenderedTriangleResource[],
): number {
	return resources.reduce(
		(total, resource) => total + resource.triangleCount,
		0,
	);
}

function sumNumbers(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0);
}

function estimateStaticObjectUploadedBufferBytes(
	drawUnit: StaticObjectGeometryStaticDrawUnit,
): number {
	return (
		drawUnit.positions.byteLength +
		drawUnit.texCoords.byteLength +
		drawUnit.materialSlotIndices.byteLength +
		drawUnit.indices.byteLength
	);
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function estimateStaticObjectVisualResourceUploadedBufferBytes(
	resource: StaticObjectVisualResource,
): number {
	return (
		resource.positions.byteLength +
		resource.texCoords.byteLength +
		resource.materialSlotIndices.byteLength +
		resource.indices.byteLength
	);
}

function createStencilState(
	gl: WebGL2RenderingContext,
	enabled: boolean,
	writeMask: number,
	func: GLenum,
	ref: number,
	zpass: GLenum,
): Webgl2StencilState {
	return {
		enabled,
		fail: gl.KEEP,
		func,
		readMask: 0xff,
		ref,
		writeMask,
		zfail: gl.KEEP,
		zpass,
	};
}

function createEnvCellResourceKey(
	landblockId: number,
	envCellId: number,
): string {
	return `${landblockId >>> 0}:${envCellId >>> 0}`;
}

function addResourceMembership(
	membership: Map<string, Set<string>>,
	key: string,
	drawUnitId: string,
): void {
	const drawUnitIds = membership.get(key) ?? new Set<string>();
	drawUnitIds.add(drawUnitId);
	membership.set(key, drawUnitIds);
}

function removeResourceMembership(
	membership: Map<string, Set<string>>,
	key: string,
	drawUnitId: string,
): void {
	const drawUnitIds = membership.get(key);
	if (!drawUnitIds) {
		return;
	}
	drawUnitIds.delete(drawUnitId);
	if (drawUnitIds.size === 0) {
		membership.delete(key);
	}
}

function compareNumbers(left: number, right: number): number {
	return left - right;
}

export interface StaticObjectTransparentDrawSortEntry {
	readonly drawUnitId: string;
	readonly distanceSquared: number;
}

interface StaticObjectTransparentDrawEntry {
	resource: StaticMaterialGeometryResource | null;
	instance: StaticObjectRenderInstance | null;
	distanceSquared: number;
	drawUnitId: string;
}

function createStaticObjectTransparentDrawEntry(): StaticObjectTransparentDrawEntry {
	return {
		distanceSquared: 0,
		drawUnitId: "",
		instance: null,
		resource: null,
	};
}

export function compareStaticObjectTransparentDrawEntries(
	left: StaticObjectTransparentDrawSortEntry,
	right: StaticObjectTransparentDrawSortEntry,
): number {
	const distanceOrder = right.distanceSquared - left.distanceSquared;

	return distanceOrder === 0
		? left.drawUnitId.localeCompare(right.drawUnitId)
		: distanceOrder;
}

export function resolveStaticObjectBlendFactor(
	gl: WebGL2RenderingContext,
	factor: NonNullable<StaticObjectRenderState["blend"]["srcFactor"]>,
): GLenum {
	switch (factor) {
		case "one":
			return gl.ONE;
		case "src-alpha":
			return gl.SRC_ALPHA;
		case "one-minus-src-alpha":
			return gl.ONE_MINUS_SRC_ALPHA;
	}
}

function isTransparentStaticObjectResource(
	resource: StaticObjectGeometryResource | StaticObjectVisualGeometryResource,
): boolean {
	return (
		("sortPolicy" in resource &&
			resource.sortPolicy === "object-part-back-to-front") ||
		resource.materialPass === "transparent" ||
		resource.materialPass === "additive"
	);
}

function isTransparentStaticObjectInstanceDrawResource(
	resource: StaticObjectInstanceDrawResource,
): boolean {
	return isTransparentStaticObjectResource(resource.resource);
}

function isStaticObjectGeometryResource(
	resource: StaticMaterialGeometryResource,
): resource is StaticObjectGeometryResource {
	return "envCellIds" in resource;
}

function applyStaticObjectDepthWritingState(
	gl: WebGL2RenderingContext,
	stateCache: Webgl2StateCache,
): void {
	stateCache.setDepthState(createDepthState(gl, true, true));
	stateCache.setBlendState(createBlendState(gl, false, gl.ONE, gl.ZERO));
	stateCache.setCullState({ enabled: false, mode: gl.BACK });
}

function applyStaticObjectRenderState(
	gl: WebGL2RenderingContext,
	stateCache: Webgl2StateCache,
	renderState: StaticObjectRenderState,
): void {
	stateCache.setDepthState(createDepthState(gl, true, renderState.depthWrite));
	stateCache.setCullState({ enabled: false, mode: gl.BACK });
	if (!renderState.blend.enabled) {
		stateCache.setBlendState(createBlendState(gl, false, gl.ONE, gl.ZERO));
		return;
	}
	if (!renderState.blend.srcFactor || !renderState.blend.dstFactor) {
		throw new Error(
			`Static object blend mode ${renderState.blend.mode} is enabled without concrete blend factors.`,
		);
	}
	stateCache.setBlendState(
		createBlendState(
			gl,
			true,
			resolveStaticObjectBlendFactor(gl, renderState.blend.srcFactor),
			resolveStaticObjectBlendFactor(gl, renderState.blend.dstFactor),
		),
	);
}

function applyStructuredInteriorCullState(
	gl: WebGL2RenderingContext,
	stateCache: Webgl2StateCache,
	flatVisionModeEnabled: boolean,
): void {
	stateCache.setCullState({
		enabled: flatVisionModeEnabled,
		mode: gl.BACK,
	});
}

function restoreStaticObjectRenderState(
	gl: WebGL2RenderingContext,
	stateCache: Webgl2StateCache,
): void {
	stateCache.setDepthState(createDepthState(gl, true, true));
	stateCache.setBlendState(createBlendState(gl, false, gl.ONE, gl.ZERO));
	stateCache.setCullState({ enabled: false, mode: gl.BACK });
}

function applyDebugOverlayAlphaBlendState(
	gl: WebGL2RenderingContext,
	stateCache: Webgl2StateCache,
): void {
	stateCache.setBlendState(
		createBlendState(gl, true, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA),
	);
}

function restoreDebugOverlayRenderState(
	gl: WebGL2RenderingContext,
	stateCache: Webgl2StateCache,
): void {
	stateCache.setDepthState(createDepthState(gl, true, true));
	stateCache.setBlendState(createBlendState(gl, false, gl.ONE, gl.ZERO));
	stateCache.setCullState({ enabled: false, mode: gl.BACK });
}

function createDepthState(
	gl: WebGL2RenderingContext,
	enabled: boolean,
	write: boolean,
): Webgl2DepthState {
	return {
		enabled,
		func: gl.LESS,
		write,
	};
}

function createBlendState(
	gl: WebGL2RenderingContext,
	enabled: boolean,
	src: GLenum,
	dst: GLenum,
): Webgl2BlendState {
	return {
		dstAlpha: dst,
		dstRgb: dst,
		enabled,
		equationAlpha: gl.FUNC_ADD,
		equationRgb: gl.FUNC_ADD,
		srcAlpha: src,
		srcRgb: src,
	};
}

function createDebugOverlayVertices(
	primitives: readonly DebugOverlayPrimitive[],
): {
	readonly lineVertexCount: number;
	readonly triangleVertexCount: number;
	readonly vertices: Float32Array;
} {
	const triangleVertices: number[] = [];
	const lineVertices: number[] = [];
	for (const primitive of primitives) {
		if (primitive.kind === "aabb") {
			appendDebugOverlayAabb(lineVertices, primitive);
		} else {
			appendDebugOverlayTriangles(triangleVertices, primitive);
		}
	}

	const vertices = [...triangleVertices, ...lineVertices];
	return {
		lineVertexCount: lineVertices.length / DEBUG_OVERLAY_FLOATS_PER_VERTEX,
		triangleVertexCount:
			triangleVertices.length / DEBUG_OVERLAY_FLOATS_PER_VERTEX,
		vertices: new Float32Array(vertices),
	};
}

function appendDebugOverlayAabb(
	vertices: number[],
	primitive: Extract<DebugOverlayPrimitive, { readonly kind: "aabb" }>,
): void {
	const [minX, minY, minZ] = primitive.min;
	const [maxX, maxY, maxZ] = primitive.max;
	const corners = [
		[minX, minY, minZ],
		[maxX, minY, minZ],
		[maxX, maxY, minZ],
		[minX, maxY, minZ],
		[minX, minY, maxZ],
		[maxX, minY, maxZ],
		[maxX, maxY, maxZ],
		[minX, maxY, maxZ],
	] as const;
	const edges = [
		[0, 1],
		[1, 2],
		[2, 3],
		[3, 0],
		[4, 5],
		[5, 6],
		[6, 7],
		[7, 4],
		[0, 4],
		[1, 5],
		[2, 6],
		[3, 7],
	] as const;

	for (const [left, right] of edges) {
		appendDebugOverlayVertex(vertices, corners[left], primitive.color);
		appendDebugOverlayVertex(vertices, corners[right], primitive.color);
	}
}

function appendDebugOverlayTriangles(
	vertices: number[],
	primitive: Extract<DebugOverlayPrimitive, { readonly kind: "triangles" }>,
): void {
	for (const position of primitive.vertices) {
		appendDebugOverlayVertex(vertices, position, primitive.color);
	}
}

function appendDebugOverlayVertex(
	vertices: number[],
	position: readonly [number, number, number],
	color: readonly [number, number, number, number],
): void {
	vertices.push(
		position[0],
		position[1],
		position[2],
		color[0],
		color[1],
		color[2],
		color[3],
	);
}

function uploadTerrainLayeredUniforms(
	gl: WebGL2RenderingContext,
	stateCache: Webgl2StateCache,
	program: TerrainGeometryProgram,
	payload: TerrainPreparedLayeredPayload,
	frameState: FrameState,
): void {
	uploadTerrainRolePageBindings(
		gl,
		stateCache,
		program.uniforms.uColorAtlasTextures,
		program.uniforms.uColorAtlasSizes,
		payload.colorPages,
		TERRAIN_COLOR_TEXTURE_UNIT_BASE,
	);
	uploadTerrainRolePageBindings(
		gl,
		stateCache,
		program.uniforms.uMaskAtlasTextures,
		program.uniforms.uMaskAtlasSizes,
		payload.maskPages,
		TERRAIN_MASK_TEXTURE_UNIT_BASE,
	);
	stateCache.bindTexture2D(TERRAIN_DETAIL_TEXTURE_UNIT, payload.detail.texture);
	gl.uniform1i(
		program.uniforms.uDetailAtlasTexture,
		TERRAIN_DETAIL_TEXTURE_UNIT,
	);
	gl.uniform2fv(program.uniforms.uDetailAtlasSize, payload.detail.atlasSize);

	uploadTerrainLayerRectUniforms(gl, program, payload.layerRects);
	uploadTerrainDetailUniforms(gl, program, payload.detail);
	gl.uniform3f(
		program.uniforms.uCameraPosition,
		frameState.camera.position[0],
		frameState.camera.position[1],
		frameState.camera.position[2],
	);
}

function uploadTerrainRolePageBindings(
	gl: WebGL2RenderingContext,
	stateCache: Webgl2StateCache,
	samplerUniforms: readonly WebGLUniformLocation[],
	sizeUniform: WebGLUniformLocation,
	pages: TerrainPreparedRolePageBindings,
	textureUnitBase: number,
): void {
	for (const [slot, uniform] of samplerUniforms.entries()) {
		const textureUnit = textureUnitBase + slot;
		stateCache.bindTexture2D(textureUnit, pages.textures[slot] ?? null);
		gl.uniform1i(uniform, textureUnit);
	}
	gl.uniform2fv(sizeUniform, pages.sizes);
}

function uploadTerrainLayerRectUniforms(
	gl: WebGL2RenderingContext,
	program: TerrainGeometryProgram,
	layerRects: TerrainPreparedLayerRects,
): void {
	gl.uniform1iv(
		program.uniforms.uLayerBaseColorPages,
		layerRects.baseColorPages,
	);
	gl.uniform4fv(
		program.uniforms.uLayerBaseColorRects,
		layerRects.baseColorRects,
	);
	gl.uniform1fv(program.uniforms.uLayerBaseTilings, layerRects.baseTilings);
	gl.uniform1iv(
		program.uniforms.uLayerOverlayColorPages,
		layerRects.overlayColorPages,
	);
	gl.uniform4fv(
		program.uniforms.uLayerOverlayColorRects,
		layerRects.overlayColorRects,
	);
	gl.uniform1iv(
		program.uniforms.uLayerOverlayMaskPages,
		layerRects.overlayMaskPages,
	);
	gl.uniform4fv(
		program.uniforms.uLayerOverlayMaskRects,
		layerRects.overlayMaskRects,
	);
	gl.uniform1fv(
		program.uniforms.uLayerOverlayTilings,
		layerRects.overlayTilings,
	);
	gl.uniform1iv(
		program.uniforms.uLayerOverlayRotations,
		layerRects.overlayRotations,
	);
	gl.uniform1iv(program.uniforms.uLayerOverlayCounts, layerRects.overlayCounts);
	gl.uniform1iv(
		program.uniforms.uLayerRoadColorPages,
		layerRects.roadColorPages,
	);
	gl.uniform4fv(
		program.uniforms.uLayerRoadColorRects,
		layerRects.roadColorRects,
	);
	gl.uniform1iv(program.uniforms.uLayerRoadMaskPages, layerRects.roadMaskPages);
	gl.uniform4fv(program.uniforms.uLayerRoadMaskRects, layerRects.roadMaskRects);
	gl.uniform1fv(program.uniforms.uLayerRoadTilings, layerRects.roadTilings);
	gl.uniform1iv(program.uniforms.uLayerRoadRotations, layerRects.roadRotations);
	gl.uniform1iv(program.uniforms.uLayerRoadCounts, layerRects.roadCounts);
}

function uploadTerrainDetailUniforms(
	gl: WebGL2RenderingContext,
	program: TerrainGeometryProgram,
	detail: TerrainPreparedDetailUniforms,
): void {
	gl.uniform1i(program.uniforms.uDetailEnabled, detail.isEnabled ? 1 : 0);
	gl.uniform4fv(program.uniforms.uDetailAtlasRect, detail.atlasRect);
	gl.uniform1f(program.uniforms.uDetailTiling, detail.tiling);
	gl.uniform1f(program.uniforms.uDetailFadeNear, detail.fadeNear);
	gl.uniform1f(program.uniforms.uDetailFadeFar, detail.fadeFar);
}

function createTexturePage(
	gl: WebGL2RenderingContext,
	placement: TexturePlacementUpdate["placements"][number],
): WebGLTexture {
	const texture = gl.createTexture();
	if (!texture) {
		throw new Error(`Failed to create texture ${placement.textureRefId}.`);
	}

	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(
		gl.TEXTURE_2D,
		gl.TEXTURE_MIN_FILTER,
		getMinFilter(gl, placement.filteringMode, placement.mipmapsGenerated),
	);
	gl.texParameteri(
		gl.TEXTURE_2D,
		gl.TEXTURE_MAG_FILTER,
		getMagFilter(gl, placement.filteringMode),
	);
	gl.texParameteri(
		gl.TEXTURE_2D,
		gl.TEXTURE_WRAP_S,
		getWrapMode(gl, placement.wrapS),
	);
	gl.texParameteri(
		gl.TEXTURE_2D,
		gl.TEXTURE_WRAP_T,
		getWrapMode(gl, placement.wrapT),
	);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
	uploadTexturePixels(gl, placement);
	if (placement.mipmapsGenerated) {
		gl.generateMipmap(gl.TEXTURE_2D);
	}
	applyAnisotropy(gl, placement.anisotropy);
	gl.bindTexture(gl.TEXTURE_2D, null);

	return texture;
}

function uploadTexturePixels(
	gl: WebGL2RenderingContext,
	placement: TexturePlacementUpdate["placements"][number],
): void {
	switch (placement.format) {
		case "rgba8":
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA,
				placement.width,
				placement.height,
				0,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				placement.pixels,
			);
			return;
		case "r8":
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.R8,
				placement.width,
				placement.height,
				0,
				gl.RED,
				gl.UNSIGNED_BYTE,
				placement.pixels,
			);
			return;
		case "rg8":
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RG8,
				placement.width,
				placement.height,
				0,
				gl.RG,
				gl.UNSIGNED_BYTE,
				placement.pixels,
			);
			return;
	}
}

function applyTextureSamplerPolicy(
	gl: WebGL2RenderingContext,
	texture: WebGLTexture,
	policy: SamplerPolicyUpdate["policies"][number],
): void {
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(
		gl.TEXTURE_2D,
		gl.TEXTURE_MIN_FILTER,
		getMinFilter(gl, policy.filteringMode, policy.mipmapsGenerated),
	);
	gl.texParameteri(
		gl.TEXTURE_2D,
		gl.TEXTURE_MAG_FILTER,
		getMagFilter(gl, policy.filteringMode),
	);
	if (policy.mipmapsGenerated) {
		gl.generateMipmap(gl.TEXTURE_2D);
	}
	applyAnisotropy(gl, policy.anisotropy);
	gl.bindTexture(gl.TEXTURE_2D, null);
}

function getMinFilter(
	gl: WebGL2RenderingContext,
	filteringMode: TextureFilteringMode,
	generateMipmaps: boolean,
): GLenum {
	if (filteringMode === "nearest") {
		return gl.NEAREST;
	}

	return generateMipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR;
}

function getMagFilter(
	gl: WebGL2RenderingContext,
	filteringMode: TextureFilteringMode,
): GLenum {
	return filteringMode === "nearest" ? gl.NEAREST : gl.LINEAR;
}

function getWrapMode(
	gl: WebGL2RenderingContext,
	wrapMode: TextureWrapMode,
): GLenum {
	return wrapMode === "repeat" ? gl.REPEAT : gl.CLAMP_TO_EDGE;
}

function applyAnisotropy(gl: WebGL2RenderingContext, anisotropy: number): void {
	const extension =
		gl.getExtension("EXT_texture_filter_anisotropic") ??
		gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic") ??
		gl.getExtension("MOZ_EXT_texture_filter_anisotropic");
	if (!extension) {
		return;
	}

	const maxAnisotropy = gl.getParameter(
		extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT,
	) as number;
	gl.texParameterf(
		gl.TEXTURE_2D,
		extension.TEXTURE_MAX_ANISOTROPY_EXT,
		Math.min(Math.max(anisotropy, 1), maxAnisotropy),
	);
}

function compileShader(
	gl: WebGL2RenderingContext,
	shaderType: GLenum,
	source: string,
): WebGLShader {
	const shader = gl.createShader(shaderType);
	if (!shader) {
		throw new Error("Failed to create terrain geometry shader.");
	}
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const message = gl.getShaderInfoLog(shader) ?? "unknown compile error";
		gl.deleteShader(shader);
		throw new Error(`Failed to compile terrain geometry shader: ${message}`);
	}

	return shader;
}

function requireUniform(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	name: string,
): WebGLUniformLocation {
	const uniform =
		gl.getUniformLocation(program, name) ??
		gl.getUniformLocation(program, `${name}[0]`);
	if (!uniform) {
		throw new Error(`terrain geometry shader is missing uniform ${name}.`);
	}

	return uniform;
}

function createRolePageTextureUniforms(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	prefix: string,
	count: number,
): readonly WebGLUniformLocation[] {
	return Array.from({ length: count }, (_, slot) =>
		requireUniform(gl, program, `${prefix}${slot}`),
	);
}

function createModelViewProjectionMatrix(
	frameState: FrameState,
	aspectRatio: number,
): Float32Array {
	const projection = createPerspectiveMatrix(
		Math.PI / 3,
		aspectRatio,
		CAMERA_NEAR_PLANE,
		CAMERA_FAR_PLANE,
	);
	const view = createViewMatrix(frameState);
	return multiplyMat4(projection, view);
}

function createPerspectiveMatrix(
	fovyRadians: number,
	aspectRatio: number,
	near: number,
	far: number,
): Float32Array {
	const f = 1 / Math.tan(fovyRadians / 2);
	const rangeInv = 1 / (near - far);

	return new Float32Array([
		f / aspectRatio,
		0,
		0,
		0,
		0,
		f,
		0,
		0,
		0,
		0,
		(near + far) * rangeInv,
		-1,
		0,
		0,
		near * far * rangeInv * 2,
		0,
	]);
}

function createViewMatrix(frameState: FrameState): Float32Array {
	const [cameraX, cameraY, cameraZ] = frameState.camera.position;
	const pitch = frameState.camera.pitchRadians;
	const yaw = frameState.camera.yawRadians;
	const cosPitch = Math.cos(pitch);
	const forward = normalizeVec3([
		Math.sin(yaw) * cosPitch,
		Math.sin(pitch),
		-Math.cos(yaw) * cosPitch,
	]);
	const target = [
		cameraX + forward[0],
		cameraY + forward[1],
		cameraZ + forward[2],
	] as const;

	return createLookAtMatrix([cameraX, cameraY, cameraZ], target, [0, 1, 0]);
}

function createLookAtMatrix(
	eye: readonly [number, number, number],
	target: readonly [number, number, number],
	up: readonly [number, number, number],
): Float32Array {
	const zAxis = normalizeVec3([
		eye[0] - target[0],
		eye[1] - target[1],
		eye[2] - target[2],
	]);
	const xAxis = normalizeVec3(crossVec3(up, zAxis));
	const yAxis = crossVec3(zAxis, xAxis);

	return new Float32Array([
		xAxis[0],
		yAxis[0],
		zAxis[0],
		0,
		xAxis[1],
		yAxis[1],
		zAxis[1],
		0,
		xAxis[2],
		yAxis[2],
		zAxis[2],
		0,
		-dotVec3(xAxis, eye),
		-dotVec3(yAxis, eye),
		-dotVec3(zAxis, eye),
		1,
	]);
}

function multiplyMat4(left: Float32Array, right: Float32Array): Float32Array {
	const result = new Float32Array(16);

	for (let column = 0; column < 4; column += 1) {
		for (let row = 0; row < 4; row += 1) {
			result[column * 4 + row] =
				left[0 * 4 + row] * right[column * 4 + 0] +
				left[1 * 4 + row] * right[column * 4 + 1] +
				left[2 * 4 + row] * right[column * 4 + 2] +
				left[3 * 4 + row] * right[column * 4 + 3];
		}
	}

	return result;
}

function createTranslationMatrix(
	translation: readonly [number, number, number],
): Float32Array {
	return new Float32Array([
		1,
		0,
		0,
		0,
		0,
		1,
		0,
		0,
		0,
		0,
		1,
		0,
		translation[0],
		translation[1],
		translation[2],
		1,
	]);
}

function normalizeVec3(
	value: readonly [number, number, number],
): readonly [number, number, number] {
	const length = Math.hypot(value[0], value[1], value[2]);
	if (length === 0) {
		return [0, 0, 0];
	}

	return [value[0] / length, value[1] / length, value[2] / length];
}

function crossVec3(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): readonly [number, number, number] {
	return [
		left[1] * right[2] - left[2] * right[1],
		left[2] * right[0] - left[0] * right[2],
		left[0] * right[1] - left[1] * right[0],
	];
}

function dotVec3(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): number {
	return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}
