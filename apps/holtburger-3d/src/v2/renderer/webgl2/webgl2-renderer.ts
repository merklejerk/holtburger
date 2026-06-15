import type {
	DebugOverlayPrimitive,
	FrameState,
	Renderer,
	RendererSnapshot,
	RendererSnapshotListener,
	SamplerPolicyUpdate,
	StaticResidencyDelta,
	TextureDrawUnitBinding,
	TexturePlacementUpdate,
} from "../types";
import {
	MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW,
	MAX_STATIC_OBJECT_DETAIL_PAGES_PER_DRAW,
	MAX_STATIC_OBJECT_INDEX_PAGES_PER_DRAW,
	MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
	MAX_STATIC_OBJECT_PALETTE_PAGES_PER_DRAW,
	MAX_TERRAIN_COLOR_PAGES_PER_DRAW,
	MAX_TERRAIN_MASK_PAGES_PER_DRAW,
} from "../types";
import type {
	StaticObjectGeometryStaticDrawUnit,
	StaticObjectRenderState,
	StaticObjectSortMetadata,
	TerrainGeometryStaticDrawUnit,
	TerrainMaterialTextureRoleBinding,
} from "../../static/contracts";
import {
	type TextureFilteringMode,
	type TextureWrapMode,
} from "../../textures/sampling-policy";
import { createOutdoorLandblockRootTranslation } from "../../static/placement";
import {
	createStaticObjectPreparedDrawPayloadState,
	markStaticObjectPreparedDrawPayloadDirty,
	prepareStaticObjectDrawPayloadState,
	type StaticObjectPreparedMaterialUniforms,
	type StaticObjectPreparedDrawPayload,
	type StaticObjectPreparedDrawPayloadState,
	type StaticObjectPreparedRolePageBindings,
} from "./webgl2-static-object-payloads";

const TERRAIN_LAYERED_MAX_LAYER_ENTRIES = 8;
const TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER = 3;
const TERRAIN_LAYERED_MAX_ROADS_PER_LAYER = 2;
const TERRAIN_ATLAS_MIP_GRADIENT_SCALE = 0.5;
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
const DEBUG_OVERLAY_FLOATS_PER_VERTEX = 7;
const EMPTY_TEXTURE_DRAW_UNIT_BINDINGS: ReadonlyMap<
	string,
	TextureDrawUnitBinding
> = new Map();
const DEFAULT_TEXTURE_RECT = [0, 0, 1, 1] as const;

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

uniform mat4 uModelViewProjection;
uniform vec3 uPlacementTranslation;

out vec2 vTexCoord;
flat out int vMaterialSlot;

void main() {
	vTexCoord = texCoord;
	vMaterialSlot = int(materialSlot);
	gl_Position = uModelViewProjection * vec4(position + uPlacementTranslation, 1.0);
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
	fragColor = vec4(vec3(1.0), vColor.a);
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
		antialias: true,
		depth: true,
		stencil: false,
	});

	if (!gl) {
		throw new Error("WebGL2 is not available in this browser.");
	}

	return new Webgl2Renderer(canvas, gl);
}

class Webgl2Renderer implements Renderer {
	readonly #canvas: HTMLCanvasElement;
	readonly #gl: WebGL2RenderingContext;
	readonly #listeners = new Set<RendererSnapshotListener>();
	readonly #terrainResources = new Map<string, TerrainGeometryResource>();
	readonly #staticObjectResources = new Map<
		string,
		StaticObjectGeometryResource
	>();
	readonly #textures = new Map<string, WebGLTexture>();
	readonly #textureBindings = new Map<
		string,
		Map<string, TextureDrawUnitBinding>
	>();
	readonly #warnedLayeredFallbackDrawUnitIds = new Set<string>();
	readonly #terrainProgram: TerrainGeometryProgram;
	readonly #staticObjectProgram: StaticObjectGeometryProgram;
	readonly #debugOverlayProgram: DebugOverlayProgram;
	readonly #debugOverlayVertexArray: WebGLVertexArrayObject;
	readonly #debugOverlayVertexBuffer: WebGLBuffer;
	#animationFrameId: number | null = null;
	#disposed = false;
	#frameCount = 0;
	#frameHandlerMs = 0;
	#frameState = defaultFrameState;
	#staticRenderAnchorLandblockId: number | null = null;
	#debugOverlayPrimitiveCount = 0;
	#debugOverlayVertexCount = 0;
	#error: string | null = null;

	constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
		this.#canvas = canvas;
		this.#gl = gl;
		this.#terrainProgram = createTerrainGeometryProgram(gl);
		this.#staticObjectProgram = createStaticObjectGeometryProgram(gl);
		this.#debugOverlayProgram = createDebugOverlayProgram(gl);
		const vertexArray = gl.createVertexArray();
		const vertexBuffer = gl.createBuffer();
		if (!vertexArray || !vertexBuffer) {
			throw new Error("Failed to create V2 debug overlay resources.");
		}
		this.#debugOverlayVertexArray = vertexArray;
		this.#debugOverlayVertexBuffer = vertexBuffer;
		this.#configureDebugOverlayVertexArray();
		this.#startFrameLoop();
	}

	applyStaticDelta(delta: StaticResidencyDelta): void {
		for (const drawUnitId of delta.removedDrawUnitIds) {
			const terrainResource = this.#terrainResources.get(drawUnitId);
			if (terrainResource) {
				terrainResource.dispose();
				this.#terrainResources.delete(drawUnitId);
				this.#warnedLayeredFallbackDrawUnitIds.delete(drawUnitId);
			}
			const staticObjectResource = this.#staticObjectResources.get(drawUnitId);
			if (staticObjectResource) {
				staticObjectResource.dispose();
				this.#staticObjectResources.delete(drawUnitId);
			}
			this.#textureBindings.delete(drawUnitId);
		}

		for (const drawUnit of delta.addedDrawUnits) {
			this.#terrainResources.get(drawUnit.drawUnitId)?.dispose();
			this.#staticObjectResources.get(drawUnit.drawUnitId)?.dispose();
			this.#terrainResources.delete(drawUnit.drawUnitId);
			this.#staticObjectResources.delete(drawUnit.drawUnitId);

			if (drawUnit.kind === "terrain-geometry") {
				this.#terrainResources.set(
					drawUnit.drawUnitId,
					createTerrainGeometryResource(this.#gl, drawUnit),
				);
			} else if (drawUnit.kind === "static-object-geometry") {
				this.#staticObjectResources.set(
					drawUnit.drawUnitId,
					createStaticObjectGeometryResource(this.#gl, drawUnit),
				);
			}
		}

		this.#emit();
	}

	applyDynamicDelta(): void {
		// Dynamic renderer residency starts after static pipeline contracts are proven.
	}

	setStaticRenderAnchorLandblockId(anchorLandblockId: number | null): void {
		this.#staticRenderAnchorLandblockId = anchorLandblockId;
		this.#emit();
	}

	setDebugOverlayPrimitives(
		primitives: readonly DebugOverlayPrimitive[],
	): void {
		const vertices = createDebugOverlayVertices(primitives);
		const gl = this.#gl;
		gl.bindVertexArray(this.#debugOverlayVertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#debugOverlayVertexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		this.#debugOverlayPrimitiveCount = primitives.length;
		this.#debugOverlayVertexCount =
			vertices.length / DEBUG_OVERLAY_FLOATS_PER_VERTEX;
		this.#emit();
	}

	applyTexturePlacementUpdate(update: TexturePlacementUpdate): void {
		const gl = this.#gl;
		let shouldMarkAllStaticPayloadsDirty = update.removedTextureRefIds.length > 0;
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
		}

		for (const binding of update.drawUnitBindings) {
			const bindings =
				this.#textureBindings.get(binding.drawUnitId) ?? new Map();
			bindings.set(binding.textureUseId, binding);
			this.#textureBindings.set(binding.drawUnitId, bindings);
			this.#markStaticObjectPreparedPayloadDirty(binding.drawUnitId);
		}

		if (shouldMarkAllStaticPayloadsDirty) {
			// Prepared static payloads hold WebGLTexture handles. Without a reverse
			// texture-ref owner map, texture page adds/replacements/removals must
			// conservatively dirty all live static payloads.
			this.#markAllStaticObjectPreparedPayloadsDirty();
		}
	}

	applySamplerPolicyUpdate(update: SamplerPolicyUpdate): void {
		const gl = this.#gl;
		for (const policy of update.policies) {
			const texture = this.#textures.get(policy.textureRefId);
			if (!texture) {
				continue;
			}
			applyTextureSamplerPolicy(gl, texture, policy);
		}
	}

	updateFrameState(state: FrameState): void {
		this.#frameState = state;
	}

	subscribe(listener: RendererSnapshotListener): () => void {
		this.#listeners.add(listener);
		listener(this.#createSnapshot());

		return () => {
			this.#listeners.delete(listener);
		};
	}

	dispose(): void {
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
		for (const texture of this.#textures.values()) {
			this.#gl.deleteTexture(texture);
		}
		this.#terrainResources.clear();
		this.#staticObjectResources.clear();
		this.#textures.clear();
		this.#textureBindings.clear();
		this.#warnedLayeredFallbackDrawUnitIds.clear();
		this.#terrainProgram.dispose();
		this.#staticObjectProgram.dispose();
		this.#debugOverlayProgram.dispose();
		this.#gl.deleteBuffer(this.#debugOverlayVertexBuffer);
		this.#gl.deleteVertexArray(this.#debugOverlayVertexArray);
		this.#listeners.clear();
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
				this.#emit();
				this.dispose();
				return;
			}
			this.#frameHandlerMs = performance.now() - startedAt;
			this.#emit();

			this.#animationFrameId = requestAnimationFrame(renderFrame);
		};

		this.#animationFrameId = requestAnimationFrame(renderFrame);
	}

	#render(timeSeconds: number): void {
		this.#resizeToDisplaySize();

		const gl = this.#gl;
		const frameTime = this.#frameState.timeSeconds || timeSeconds;
		const pulse = 0.5 + Math.sin(frameTime * 0.7) * 0.5;

		gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
		gl.enable(gl.DEPTH_TEST);
		gl.clearColor(0.025 + pulse * 0.015, 0.045, 0.065 + pulse * 0.025, 1);
		gl.clearDepth(1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		this.#drawTerrain();
		this.#drawStaticObjects();
		this.#drawDebugOverlay();

		this.#frameCount += 1;
	}

	#drawTerrain(): void {
		if (this.#terrainResources.size === 0) {
			return;
		}

		const gl = this.#gl;
		const mvp = createModelViewProjectionMatrix(
			this.#frameState,
			gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight),
		);

		gl.useProgram(this.#terrainProgram.program);
		gl.uniformMatrix4fv(
			this.#terrainProgram.uniforms.uModelViewProjection,
			false,
			mvp,
		);
		gl.uniform4f(this.#terrainProgram.uniforms.uColor, 0.22, 0.72, 0.42, 1);

		for (const resource of this.#terrainResources.values()) {
			const bindings =
				this.#textureBindings.get(resource.drawUnitId) ??
				EMPTY_TEXTURE_DRAW_UNIT_BINDINGS;
			const binding = resource.primaryTextureUseId
				? bindings.get(resource.primaryTextureUseId)
				: undefined;
			const texture = binding
				? (this.#textures.get(binding.textureRefId) ?? null)
				: null;
			const useTexture =
				resource.materialFamily === "terrain-single-base-color" &&
				texture !== null;
			const useLayered =
				resource.materialFamily === "terrain-layered" &&
				uploadTerrainLayeredUniforms(
					gl,
					this.#terrainProgram,
					resource,
					bindings,
					this.#textures,
					this.#frameState,
				);
			if (resource.materialFamily === "terrain-layered" && !useLayered) {
				this.#warnTerrainLayeredFallback(resource);
			}
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, useTexture ? texture : null);
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
			gl.bindVertexArray(resource.vertexArray);
			gl.drawElements(gl.TRIANGLES, resource.indexCount, resource.indexType, 0);
		}

		gl.bindVertexArray(null);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	#drawStaticObjects(): void {
		if (this.#staticObjectResources.size === 0) {
			return;
		}

		const gl = this.#gl;
		const mvp = createModelViewProjectionMatrix(
			this.#frameState,
			gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight),
		);

		gl.useProgram(this.#staticObjectProgram.program);
		gl.uniformMatrix4fv(
			this.#staticObjectProgram.uniforms.uModelViewProjection,
			false,
			mvp,
		);

		applyStaticObjectDepthWritingState(gl);
		for (const resource of this.#staticObjectResources.values()) {
			if (isTransparentStaticObjectResource(resource)) {
				continue;
			}
			this.#drawStaticObjectResource(resource);
		}

		const transparentResources = Array.from(
			this.#staticObjectResources.values(),
		)
			.filter(isTransparentStaticObjectResource)
			.sort((left, right) =>
				compareStaticObjectTransparentDrawOrder(
					{
						drawUnitId: left.drawUnitId,
						sortCenter: this.#createStaticObjectSortCenter(left),
					},
					{
						drawUnitId: right.drawUnitId,
						sortCenter: this.#createStaticObjectSortCenter(right),
					},
					this.#frameState.camera.position,
				),
			);
		for (const resource of transparentResources) {
			applyStaticObjectRenderState(gl, resource.renderState);
			this.#drawStaticObjectResource(resource);
		}

		gl.bindVertexArray(null);
		gl.bindTexture(gl.TEXTURE_2D, null);
		restoreStaticObjectRenderState(gl);
	}

	#drawDebugOverlay(): void {
		if (this.#debugOverlayVertexCount === 0) {
			return;
		}

		const gl = this.#gl;
		const mvp = createModelViewProjectionMatrix(
			this.#frameState,
			gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight),
		);

		gl.useProgram(this.#debugOverlayProgram.program);
		gl.uniformMatrix4fv(
			this.#debugOverlayProgram.uniforms.uModelViewProjection,
			false,
			mvp,
		);
		gl.disable(gl.DEPTH_TEST);
		gl.depthMask(false);
		applyDebugOverlayInvertBlendState(gl);
		gl.lineWidth(1);
		gl.bindVertexArray(this.#debugOverlayVertexArray);
		gl.drawArrays(gl.LINES, 0, this.#debugOverlayVertexCount);
		gl.bindVertexArray(null);
		restoreDebugOverlayRenderState(gl);
	}

	#drawStaticObjectResource(resource: StaticObjectGeometryResource): void {
		const gl = this.#gl;
		const { materialUniforms, rolePages } =
			this.#getStaticObjectPreparedPayload(resource);

		uploadStaticObjectRolePageBindings(
			gl,
			this.#staticObjectProgram.uniforms.uStaticBaseColorTextures,
			this.#staticObjectProgram.uniforms.uStaticBaseColorSizes,
			rolePages.baseColor,
			STATIC_OBJECT_BASE_COLOR_TEXTURE_UNIT_BASE,
		);
		uploadStaticObjectRolePageBindings(
			gl,
			this.#staticObjectProgram.uniforms.uStaticIndexTextures,
			null,
			rolePages.index,
			STATIC_OBJECT_INDEX_TEXTURE_UNIT_BASE,
		);
		uploadStaticObjectRolePageBindings(
			gl,
			this.#staticObjectProgram.uniforms.uStaticPaletteTextures,
			this.#staticObjectProgram.uniforms.uStaticPaletteSizes,
			rolePages.palette,
			STATIC_OBJECT_PALETTE_TEXTURE_UNIT_BASE,
		);
		uploadStaticObjectRolePageBindings(
			gl,
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
		gl.uniform3f(
			this.#staticObjectProgram.uniforms.uPlacementTranslation,
			...this.#createResourceTranslation(resource),
		);
		gl.bindVertexArray(resource.vertexArray);
		gl.drawElements(gl.TRIANGLES, resource.indexCount, resource.indexType, 0);
	}

	#getStaticObjectPreparedPayload(
		resource: StaticObjectGeometryResource,
	): StaticObjectPreparedDrawPayload {
		const bindings =
			this.#textureBindings.get(resource.drawUnitId) ??
			EMPTY_TEXTURE_DRAW_UNIT_BINDINGS;

		return prepareStaticObjectDrawPayloadState(
			resource.preparedDrawPayloadState,
			resource,
			bindings,
			this.#textures,
		);
	}

	#markStaticObjectPreparedPayloadDirty(drawUnitId: string): void {
		const resource = this.#staticObjectResources.get(drawUnitId);
		if (!resource) {
			return;
		}
		markStaticObjectPreparedDrawPayloadDirty(resource.preparedDrawPayloadState);
	}

	#markAllStaticObjectPreparedPayloadsDirty(): void {
		for (const resource of this.#staticObjectResources.values()) {
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
		return {
			backend: "webgl2",
			canvasWidth: this.#canvas.width,
			canvasHeight: this.#canvas.height,
			debugOverlayPrimitives: this.#debugOverlayPrimitiveCount,
			error: this.#error,
			frameCount: this.#frameCount,
			frameHandlerMs: this.#frameHandlerMs,
			isRunning: !this.#disposed,
			renderedTriangles: sumRenderedTriangles([
				...this.#terrainResources.values(),
				...this.#staticObjectResources.values(),
			]),
			staticDrawUnits:
				this.#terrainResources.size + this.#staticObjectResources.size,
			terrainDrawUnits: this.#terrainResources.size,
		};
	}

	#emit(): void {
		const snapshot = this.#createSnapshot();

		for (const listener of this.#listeners) {
			listener(snapshot);
		}
	}

	#warnTerrainLayeredFallback(resource: TerrainGeometryResource): void {
		if (this.#warnedLayeredFallbackDrawUnitIds.has(resource.drawUnitId)) {
			return;
		}
		this.#warnedLayeredFallbackDrawUnitIds.add(resource.drawUnitId);
		console.warn(
			`V2 terrain draw unit ${resource.drawUnitId} rendered with terrain-debug-flat because its layered material could not be fully satisfied.`,
			{
				materialFamily: resource.materialFamily,
				reason:
					"Missing texture binding/residency, terrain role-page overflow, or a multi-page terrain role binding that the current WebGL2 shader cannot sample yet.",
			},
		);
	}

	#createResourceTranslation(
		resource: TerrainGeometryResource | StaticObjectGeometryResource,
	): readonly [number, number, number] {
		return createOutdoorLandblockRootTranslation(
			resource.landblockId,
			this.#staticRenderAnchorLandblockId,
		);
	}

	#createStaticObjectSortCenter(
		resource: StaticObjectGeometryResource,
	): readonly [number, number, number] {
		return translatePoint(
			resource.localSortCenter,
			this.#createResourceTranslation(resource),
		);
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
		readonly uPlacementTranslation: WebGLUniformLocation;
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

interface DebugOverlayProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly uModelViewProjection: WebGLUniformLocation;
	};
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
	readonly materialFamily: StaticObjectGeometryStaticDrawUnit["materialFamily"];
	readonly materialPass: StaticObjectGeometryStaticDrawUnit["materialPass"];
	readonly materialEntries: StaticObjectGeometryStaticDrawUnit["materialEntries"];
	readonly preparedDrawPayloadState: StaticObjectPreparedDrawPayloadState;
	readonly renderState: StaticObjectRenderState;
	readonly localSortCenter: StaticObjectSortMetadata["center"];
	readonly sortPolicy: StaticObjectSortMetadata["policy"];
	readonly indexCount: number;
	readonly indexType: GLenum;
	readonly triangleCount: number;
	dispose(): void;
}

interface RenderedTriangleResource {
	readonly triangleCount: number;
}

interface TerrainLayeredPageBindings {
	readonly color: (TerrainLayeredPageBinding | null)[];
	readonly mask: (TerrainLayeredPageBinding | null)[];
}

interface TerrainLayeredPageBinding {
	readonly binding: TextureDrawUnitBinding;
	readonly texture: WebGLTexture;
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
		throw new Error("Failed to create V2 terrain geometry shader program.");
	}

	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(program) ?? "unknown link error";
		gl.deleteProgram(program);
		throw new Error(`Failed to link V2 terrain geometry shader: ${message}`);
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
		throw new Error(
			"Failed to create V2 static object geometry shader program.",
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
			`Failed to link V2 static object geometry shader: ${message}`,
		);
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
			uPlacementTranslation: requireUniform(
				gl,
				program,
				"uPlacementTranslation",
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
		throw new Error("Failed to create V2 debug overlay shader program.");
	}

	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(program) ?? "unknown link error";
		gl.deleteProgram(program);
		throw new Error(`Failed to link V2 debug overlay shader: ${message}`);
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
		drawUnitId: drawUnit.drawUnitId,
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

function uploadStaticObjectRolePageBindings(
	gl: WebGL2RenderingContext,
	samplerUniforms: readonly WebGLUniformLocation[],
	sizeUniform: WebGLUniformLocation | null,
	pages: StaticObjectPreparedRolePageBindings,
	textureUnitBase: number,
): void {
	for (const [slot, uniform] of samplerUniforms.entries()) {
		const textureUnit = textureUnitBase + slot;
		gl.activeTexture(gl.TEXTURE0 + textureUnit);
		gl.bindTexture(gl.TEXTURE_2D, pages.textures[slot] ?? null);
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

function translatePoint(
	point: readonly [number, number, number],
	translation: readonly [number, number, number],
): readonly [number, number, number] {
	return [
		point[0] + translation[0],
		point[1] + translation[1],
		point[2] + translation[2],
	];
}

function sumRenderedTriangles(
	resources: readonly RenderedTriangleResource[],
): number {
	return resources.reduce(
		(total, resource) => total + resource.triangleCount,
		0,
	);
}

interface StaticObjectDrawOrderResource {
	readonly drawUnitId: string;
	readonly sortCenter: readonly [number, number, number];
}

export function compareStaticObjectTransparentDrawOrder(
	left: StaticObjectDrawOrderResource,
	right: StaticObjectDrawOrderResource,
	cameraPosition: readonly [number, number, number],
): number {
	const leftDistance = distanceSquared(left.sortCenter, cameraPosition);
	const rightDistance = distanceSquared(right.sortCenter, cameraPosition);
	const distanceOrder = rightDistance - leftDistance;

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

function distanceSquared(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): number {
	const deltaX = left[0] - right[0];
	const deltaY = left[1] - right[1];
	const deltaZ = left[2] - right[2];

	return deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
}

function isTransparentStaticObjectResource(
	resource: StaticObjectGeometryResource,
): boolean {
	return (
		resource.sortPolicy === "object-part-back-to-front" ||
		resource.materialPass === "transparent" ||
		resource.materialPass === "additive"
	);
}

function applyStaticObjectDepthWritingState(gl: WebGL2RenderingContext): void {
	gl.enable(gl.DEPTH_TEST);
	gl.depthMask(true);
	gl.disable(gl.BLEND);
}

function applyStaticObjectRenderState(
	gl: WebGL2RenderingContext,
	renderState: StaticObjectRenderState,
): void {
	gl.enable(gl.DEPTH_TEST);
	gl.depthMask(renderState.depthWrite);
	if (!renderState.blend.enabled) {
		gl.disable(gl.BLEND);
		return;
	}
	if (!renderState.blend.srcFactor || !renderState.blend.dstFactor) {
		throw new Error(
			`Static object blend mode ${renderState.blend.mode} is enabled without concrete blend factors.`,
		);
	}
	gl.enable(gl.BLEND);
	gl.blendFunc(
		resolveStaticObjectBlendFactor(gl, renderState.blend.srcFactor),
		resolveStaticObjectBlendFactor(gl, renderState.blend.dstFactor),
	);
}

function restoreStaticObjectRenderState(gl: WebGL2RenderingContext): void {
	gl.depthMask(true);
	gl.disable(gl.BLEND);
	gl.blendEquation(gl.FUNC_ADD);
	gl.blendFunc(gl.ONE, gl.ZERO);
}

function applyDebugOverlayInvertBlendState(gl: WebGL2RenderingContext): void {
	gl.enable(gl.BLEND);
	gl.blendEquationSeparate(gl.FUNC_SUBTRACT, gl.FUNC_ADD);
	gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
}

function restoreDebugOverlayRenderState(gl: WebGL2RenderingContext): void {
	gl.enable(gl.DEPTH_TEST);
	gl.depthMask(true);
	gl.disable(gl.BLEND);
	gl.blendEquation(gl.FUNC_ADD);
	gl.blendFunc(gl.ONE, gl.ZERO);
}

function createDebugOverlayVertices(
	primitives: readonly DebugOverlayPrimitive[],
): Float32Array {
	const vertices: number[] = [];
	for (const primitive of primitives) {
		if (primitive.kind === "aabb") {
			appendDebugOverlayAabb(vertices, primitive);
		}
	}

	return new Float32Array(vertices);
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
	program: TerrainGeometryProgram,
	resource: TerrainGeometryResource,
	bindings: ReadonlyMap<string, TextureDrawUnitBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
	frameState: FrameState,
): boolean {
	const plan = resource.terrainMaterialPlan;
	if (!plan) {
		return false;
	}

	const pageBindings = createTerrainLayeredPageBindings();
	let detailBinding: TextureDrawUnitBinding | null = null;

	for (const entry of plan.layerEntries) {
		if (!collectPageBinding(entry.base, bindings, textures, pageBindings)) {
			return false;
		}
		for (const overlay of entry.overlays) {
			if (
				!collectPageBinding(
					overlay.terrain,
					bindings,
					textures,
					pageBindings,
				) ||
				!collectPageBinding(overlay.alpha, bindings, textures, pageBindings)
			) {
				return false;
			}
		}
		for (const road of entry.roads) {
			if (
				!collectPageBinding(road.road, bindings, textures, pageBindings) ||
				!collectPageBinding(road.alpha, bindings, textures, pageBindings)
			) {
				return false;
			}
		}
	}

	for (const detailRole of plan.detailRoles) {
		const binding = detailRole.texture.textureUseId
			? bindings.get(detailRole.texture.textureUseId)
			: undefined;
		if (!binding) {
			return false;
		}
		if (detailBinding && detailBinding.textureRefId !== binding.textureRefId) {
			return false;
		}
		detailBinding = binding;
	}

	const detailTexture = detailBinding
		? (textures.get(detailBinding.textureRefId) ?? null)
		: null;
	if (detailBinding && !detailTexture) {
		return false;
	}

	uploadTerrainRolePageBindings(
		gl,
		program.uniforms.uColorAtlasTextures,
		program.uniforms.uColorAtlasSizes,
		pageBindings.color,
		TERRAIN_COLOR_TEXTURE_UNIT_BASE,
	);
	uploadTerrainRolePageBindings(
		gl,
		program.uniforms.uMaskAtlasTextures,
		program.uniforms.uMaskAtlasSizes,
		pageBindings.mask,
		TERRAIN_MASK_TEXTURE_UNIT_BASE,
	);
	gl.activeTexture(gl.TEXTURE0 + TERRAIN_DETAIL_TEXTURE_UNIT);
	gl.bindTexture(gl.TEXTURE_2D, detailTexture);
	gl.uniform1i(
		program.uniforms.uDetailAtlasTexture,
		TERRAIN_DETAIL_TEXTURE_UNIT,
	);
	gl.uniform2f(
		program.uniforms.uDetailAtlasSize,
		detailBinding?.textureWidth ?? 1,
		detailBinding?.textureHeight ?? 1,
	);

	uploadTerrainLayerRectUniforms(gl, program, plan, bindings);
	uploadTerrainDetailUniforms(gl, program, plan, bindings, detailBinding);
	gl.uniform3f(
		program.uniforms.uCameraPosition,
		frameState.camera.position[0],
		frameState.camera.position[1],
		frameState.camera.position[2],
	);

	return true;
}

function collectPageBinding(
	role: TerrainMaterialTextureRoleBinding,
	bindings: ReadonlyMap<string, TextureDrawUnitBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
	pageBindings: TerrainLayeredPageBindings,
): boolean {
	if (!role.textureUseId) {
		return false;
	}
	const binding = bindings.get(role.textureUseId);
	if (!binding) {
		return false;
	}
	const texture = textures.get(binding.textureRefId);
	if (!texture) {
		return false;
	}
	const pages =
		binding.rolePage.kind === "mask" ? pageBindings.mask : pageBindings.color;
	const maxSlots =
		binding.rolePage.kind === "mask"
			? MAX_TERRAIN_MASK_PAGES_PER_DRAW
			: MAX_TERRAIN_COLOR_PAGES_PER_DRAW;
	if (binding.rolePage.slot < 0 || binding.rolePage.slot >= maxSlots) {
		return false;
	}
	const existing = pages[binding.rolePage.slot] ?? null;
	if (existing && existing.binding.textureRefId !== binding.textureRefId) {
		return false;
	}
	pages[binding.rolePage.slot] = {
		binding,
		texture,
	};
	return true;
}

function createTerrainLayeredPageBindings(): TerrainLayeredPageBindings {
	return {
		color: Array.from({ length: MAX_TERRAIN_COLOR_PAGES_PER_DRAW }, () => null),
		mask: Array.from({ length: MAX_TERRAIN_MASK_PAGES_PER_DRAW }, () => null),
	};
}

function uploadTerrainRolePageBindings(
	gl: WebGL2RenderingContext,
	samplerUniforms: readonly WebGLUniformLocation[],
	sizeUniform: WebGLUniformLocation,
	pages: readonly (TerrainLayeredPageBinding | null)[],
	textureUnitBase: number,
): void {
	const sizes = new Float32Array(pages.length * 2);
	for (const [slot, uniform] of samplerUniforms.entries()) {
		const page = pages[slot] ?? null;
		const textureUnit = textureUnitBase + slot;
		gl.activeTexture(gl.TEXTURE0 + textureUnit);
		gl.bindTexture(gl.TEXTURE_2D, page?.texture ?? null);
		gl.uniform1i(uniform, textureUnit);
		sizes[slot * 2] = page?.binding.textureWidth ?? 1;
		sizes[slot * 2 + 1] = page?.binding.textureHeight ?? 1;
	}
	gl.uniform2fv(sizeUniform, sizes);
}

function uploadTerrainLayerRectUniforms(
	gl: WebGL2RenderingContext,
	program: TerrainGeometryProgram,
	plan: NonNullable<TerrainGeometryResource["terrainMaterialPlan"]>,
	bindings: ReadonlyMap<string, TextureDrawUnitBinding>,
): void {
	const baseColorRects = new Float32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES * 4,
	);
	const baseColorPages = new Int32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES);
	const baseTilings = new Float32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES);
	const overlayColorRects = new Float32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES *
			TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER *
			4,
	);
	const overlayColorPages = new Int32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER,
	);
	const overlayMaskRects = new Float32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES *
			TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER *
			4,
	);
	const overlayMaskPages = new Int32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER,
	);
	const overlayTilings = new Float32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER,
	);
	const overlayRotations = new Int32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER,
	);
	const overlayCounts = new Int32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES);
	const roadColorRects = new Float32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES * 4,
	);
	const roadColorPages = new Int32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES);
	const roadMaskRects = new Float32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_ROADS_PER_LAYER * 4,
	);
	const roadMaskPages = new Int32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_ROADS_PER_LAYER,
	);
	const roadTilings = new Float32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES);
	const roadRotations = new Int32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_ROADS_PER_LAYER,
	);
	const roadCounts = new Int32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES);

	for (const layer of plan.layerEntries) {
		baseColorRects.set(
			resolveBindingRect(bindings, layer.base),
			layer.slot * 4,
		);
		baseColorPages[layer.slot] = resolveBindingPage(bindings, layer.base);
		baseTilings[layer.slot] = layer.base.tiling;
		overlayCounts[layer.slot] = Math.min(
			layer.overlays.length,
			TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER,
		);
		for (const [overlayIndex, overlay] of layer.overlays
			.slice(0, TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER)
			.entries()) {
			const index =
				layer.slot * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER + overlayIndex;
			overlayColorRects.set(
				resolveBindingRect(bindings, overlay.terrain),
				index * 4,
			);
			overlayColorPages[index] = resolveBindingPage(bindings, overlay.terrain);
			overlayMaskRects.set(
				resolveBindingRect(bindings, overlay.alpha),
				index * 4,
			);
			overlayMaskPages[index] = resolveBindingPage(bindings, overlay.alpha);
			overlayTilings[index] = overlay.terrain.tiling;
			overlayRotations[index] = overlay.rotation;
		}
		roadCounts[layer.slot] = Math.min(
			layer.roads.length,
			TERRAIN_LAYERED_MAX_ROADS_PER_LAYER,
		);
		const roadTexture = layer.roads[0]?.road ?? null;
		if (roadTexture) {
			roadColorRects.set(
				resolveBindingRect(bindings, roadTexture),
				layer.slot * 4,
			);
			roadColorPages[layer.slot] = resolveBindingPage(bindings, roadTexture);
			roadTilings[layer.slot] = roadTexture.tiling;
		}
		for (const [roadIndex, road] of layer.roads
			.slice(0, TERRAIN_LAYERED_MAX_ROADS_PER_LAYER)
			.entries()) {
			const index =
				layer.slot * TERRAIN_LAYERED_MAX_ROADS_PER_LAYER + roadIndex;
			roadMaskRects.set(resolveBindingRect(bindings, road.alpha), index * 4);
			roadMaskPages[index] = resolveBindingPage(bindings, road.alpha);
			roadRotations[index] = road.rotation;
		}
	}

	gl.uniform1iv(program.uniforms.uLayerBaseColorPages, baseColorPages);
	gl.uniform4fv(program.uniforms.uLayerBaseColorRects, baseColorRects);
	gl.uniform1fv(program.uniforms.uLayerBaseTilings, baseTilings);
	gl.uniform1iv(program.uniforms.uLayerOverlayColorPages, overlayColorPages);
	gl.uniform4fv(program.uniforms.uLayerOverlayColorRects, overlayColorRects);
	gl.uniform1iv(program.uniforms.uLayerOverlayMaskPages, overlayMaskPages);
	gl.uniform4fv(program.uniforms.uLayerOverlayMaskRects, overlayMaskRects);
	gl.uniform1fv(program.uniforms.uLayerOverlayTilings, overlayTilings);
	gl.uniform1iv(program.uniforms.uLayerOverlayRotations, overlayRotations);
	gl.uniform1iv(program.uniforms.uLayerOverlayCounts, overlayCounts);
	gl.uniform1iv(program.uniforms.uLayerRoadColorPages, roadColorPages);
	gl.uniform4fv(program.uniforms.uLayerRoadColorRects, roadColorRects);
	gl.uniform1iv(program.uniforms.uLayerRoadMaskPages, roadMaskPages);
	gl.uniform4fv(program.uniforms.uLayerRoadMaskRects, roadMaskRects);
	gl.uniform1fv(program.uniforms.uLayerRoadTilings, roadTilings);
	gl.uniform1iv(program.uniforms.uLayerRoadRotations, roadRotations);
	gl.uniform1iv(program.uniforms.uLayerRoadCounts, roadCounts);
}

function uploadTerrainDetailUniforms(
	gl: WebGL2RenderingContext,
	program: TerrainGeometryProgram,
	plan: NonNullable<TerrainGeometryResource["terrainMaterialPlan"]>,
	bindings: ReadonlyMap<string, TextureDrawUnitBinding>,
	detailBinding: TextureDrawUnitBinding | null,
): void {
	const detailRole = plan.detailRoles[0] ?? null;
	const detailRect = detailRole
		? resolveBindingRect(bindings, detailRole.texture)
		: DEFAULT_TEXTURE_RECT;
	gl.uniform1i(
		program.uniforms.uDetailEnabled,
		detailRole && detailBinding ? 1 : 0,
	);
	gl.uniform4fv(program.uniforms.uDetailAtlasRect, detailRect);
	gl.uniform1f(program.uniforms.uDetailTiling, detailRole?.texture.tiling ?? 1);
	gl.uniform1f(program.uniforms.uDetailFadeNear, detailRole?.fadeNear ?? 0);
	gl.uniform1f(program.uniforms.uDetailFadeFar, detailRole?.fadeFar ?? 1);
}

function resolveBindingRect(
	bindings: ReadonlyMap<string, TextureDrawUnitBinding>,
	role: TerrainMaterialTextureRoleBinding,
): readonly [number, number, number, number] {
	if (!role.textureUseId) {
		return DEFAULT_TEXTURE_RECT;
	}

	return bindings.get(role.textureUseId)?.rect ?? DEFAULT_TEXTURE_RECT;
}

function resolveBindingPage(
	bindings: ReadonlyMap<string, TextureDrawUnitBinding>,
	role: TerrainMaterialTextureRoleBinding,
): number {
	if (!role.textureUseId) {
		return 0;
	}

	return bindings.get(role.textureUseId)?.rolePage.slot ?? 0;
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
		throw new Error("Failed to create V2 terrain geometry shader.");
	}
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const message = gl.getShaderInfoLog(shader) ?? "unknown compile error";
		gl.deleteShader(shader);
		throw new Error(`Failed to compile V2 terrain geometry shader: ${message}`);
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
		throw new Error(`V2 terrain geometry shader is missing uniform ${name}.`);
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
	const projection = createPerspectiveMatrix(Math.PI / 3, aspectRatio, 1, 5000);
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
