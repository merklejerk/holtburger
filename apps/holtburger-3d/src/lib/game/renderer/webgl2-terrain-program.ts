import { OUTDOOR_TERRAIN_GRID_CELLS } from "../landblocks";
import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import { WEBGL2_DISTANCE_FOG_GLSL } from "./webgl2-fog";
import { WEBGL2_SCENE_LIGHTING_GLSL } from "./webgl2-lighting";

/** Integer attribute carrying one authored terrain type code per terrain vertex. */
export const TERRAIN_COLOR_CODE_ATTRIBUTE = 3;

const TERRAIN_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTextureCoordinate;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uLocalToLandblock;
uniform vec3 uLandblockOffset;
uniform vec3 uCameraPosition;
// Maps ordinary camera clip coordinates into the active scope-atlas tile. Flat rendering uses
// (1, 1, 0, 0); the viewport supplies the tile's hard raster boundary in portal mode.
uniform vec4 uClipTransform;

${WEBGL2_SCENE_LIGHTING_GLSL}

out vec2 vGridUv;
out float vViewDepth;
out float vViewerDistance;
out vec3 vAmbientSun;
out vec3 vAnchoredPosition;
out vec3 vSurfaceNormal;

void main() {
	vec3 landblockPosition = (uLocalToLandblock * vec4(aPosition, 1.0)).xyz;
	vec3 anchoredPosition = landblockPosition + uLandblockOffset;
	vec4 viewPosition = uView * vec4(anchoredPosition, 1.0);
	vGridUv = aTextureCoordinate;
	// This renderer looks down camera-local -Z. Retail's detail fade uses positive
	// camera-forward depth rather than radial distance from the camera.
	vViewDepth = -viewPosition.z;
	vViewerDistance = length(anchoredPosition - uCameraPosition);
	// Retail bakes landscape lighting into vertex colors; evaluating the identical formula
	// here keeps time-of-day changes a uniform update instead of a landblock re-bake.
	//
	// Only the directional terms stay per vertex. Landscape vertices sit 24 units apart while a
	// typical authored lamp reaches 9, so a per-vertex point light would touch at most one corner
	// of a quad and smear a gradient across it instead of producing a pool. Point lights are
	// therefore evaluated per pixel in the fragment stage, which needs the surface position and
	// normal interpolated across the triangle.
	vAmbientSun = evaluateAmbientAndSun(mat3(uLocalToLandblock) * aNormal);
	vAnchoredPosition = anchoredPosition;
	vSurfaceNormal = mat3(uLocalToLandblock) * aNormal;
	vec4 clipPosition = uProjection * viewPosition;
	clipPosition.xy = clipPosition.xy * uClipTransform.xy
		+ clipPosition.ww * uClipTransform.zw;
	gl_Position = clipPosition;
}
`;

const TERRAIN_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
precision highp usampler2D;

uniform usampler2D uSurfaceField;
uniform usampler2D uComposition;
// Per-cell static light masks, one RG32UI texel per terrain cell. Bit n of the pair names slot n
// of the static light uniform array.
uniform usampler2D uStaticLightMask;
uniform sampler2DArray uColors;
uniform sampler2DArray uBlendMasks;
uniform sampler2DArray uRoadMasks;
uniform sampler2D uDetail;
uniform float uDetailFadeNear;
uniform float uDetailFadeFar;
uniform int uFogEnabled;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;

${WEBGL2_DISTANCE_FOG_GLSL}
${WEBGL2_SCENE_LIGHTING_GLSL}

in vec2 vGridUv;
in float vViewDepth;
in float vViewerDistance;
in vec3 vAmbientSun;
in vec3 vAnchoredPosition;
in vec3 vSurfaceNormal;
out vec4 fragmentColor;

const uint ROAD_TERRAIN_TYPE = 32u;
const int LIGHT_GRID_CELLS = ${OUTDOOR_TERRAIN_GRID_CELLS};

/**
 * The two terrain surface coordinates a fragment needs, both in surface-field cell units.
 *
 * \`cell\` is cell-local [0,1) and addresses the per-cell alpha masks, whose rotation and flip math
 * is only defined inside one cell. \`field\` is the landblock-wide coordinate of the same point, and
 * it is what tiled color lookups must use: the two differ by a whole number of cells, so a
 * repeat-wrapped sampler reads the identical texel while screen-space derivatives stay continuous
 * across cell boundaries. Tiling from \`cell\` instead makes every boundary pixel quad report a
 * full-texture derivative, collapse to the 1x1 mip, and draw a flat one-pixel seam.
 */
struct TerrainUv {
	vec2 cell;
	vec2 field;
};

// The light grid is the landblock's authored 8x8, kept as its own constant rather than derived from
// the surface field's dimensions even though both are 8x8 today. They answer different questions --
// one is how finely lamps are bucketed, the other how finely terrain is composited -- so tying the
// lamp bucket to the composition grid would silently change lighting if either were ever retuned.
vec3 evaluateMaskedStaticLights(vec3 position, vec3 unitNormal) {
	ivec2 cell = clamp(
		ivec2(vGridUv * float(LIGHT_GRID_CELLS)),
		ivec2(0),
		ivec2(LIGHT_GRID_CELLS - 1)
	);
	uvec2 mask = texelFetch(uStaticLightMask, cell, 0).rg;
	return accumulateMaskedWord(position, unitNormal, mask.x, 0)
		+ accumulateMaskedWord(position, unitNormal, mask.y, 32);
}

uvec4 compositionRecord(int column, int row) {
	return texelFetch(uComposition, ivec2(column, row), 0);
}

uint terrainCodeAt(uint pcode, int corner) {
	if (corner == 0) return (pcode >> 15u) & 31u;
	if (corner == 1) return (pcode >> 10u) & 31u;
	if (corner == 2) return (pcode >> 5u) & 31u;
	return pcode & 31u;
}

uint roadCodeAt(uint pcode, int corner) {
	if (corner == 0) return (pcode >> 26u) & 3u;
	if (corner == 1) return (pcode >> 24u) & 3u;
	if (corner == 2) return (pcode >> 22u) & 3u;
	return (pcode >> 20u) & 3u;
}

uint rotateCode(uint code) {
	uint doubled = code * 2u;
	return doubled >= 16u ? doubled - 15u : doubled;
}

int rotationsToMatch(uint canonicalCode, uint requestedCode) {
	uint candidate = canonicalCode;
	for (int rotations = 0; rotations < 4; rotations += 1) {
		if (candidate == requestedCode) return rotations;
		candidate = rotateCode(candidate);
	}
	return -1;
}

// This is floor((pcode hash) * count / 2^32), computed with 16-bit pieces so
// WebGL2's 32-bit integer operations preserve the retail selection exactly.
uint variationIndex(uint pcode, uint count) {
	uint hash = 1379576222u * pcode - 1372186442u;
	uint high = hash >> 16u;
	uint low = hash & 65535u;
	uint scaled = high * count + ((low * count) >> 16u);
	return scaled >> 16u;
}

vec2 sourceAlphaUv(vec2 uv) {
	return vec2(uv.x, 1.0 - uv.y);
}

vec2 rotateSourceAlphaUv(vec2 uv, int rotation) {
	if (rotation == 1) return vec2(1.0 - uv.y, uv.x);
	if (rotation == 2) return vec2(1.0 - uv.x, 1.0 - uv.y);
	if (rotation == 3) return vec2(uv.y, 1.0 - uv.x);
	return uv;
}

vec4 sampleTerrainColor(uint terrainCode, TerrainUv uv) {
	uvec4 record = compositionRecord(int(terrainCode), 0);
	return texture(uColors, vec3(uv.field * float(record.y), float(record.x)));
}

ivec2 findTerrainMap(uint pcode, uint shapeCode) {
	bool cornerShape = shapeCode == 1u || shapeCode == 2u || shapeCode == 4u || shapeCode == 8u;
	int row = cornerShape ? 1 : 2;
	uint count = compositionRecord(0, 4)[cornerShape ? 0 : 1];
	if (count == 0u) return ivec2(-1, 0);
	uvec4 map = compositionRecord(int(variationIndex(pcode, count)), row);
	int rotations = rotationsToMatch(map.y, shapeCode);
	return rotations < 0 ? ivec2(-1, 0) : ivec2(int(map.x), rotations);
}

ivec2 findRoadMap(uint pcode, uint roadCode) {
	uint count = compositionRecord(0, 4).z;
	if (count == 0u) return ivec2(-1, 0);
	uint first = variationIndex(pcode, count);
	for (uint offset = 0u; offset < count; offset += 1u) {
		uvec4 map = compositionRecord(int((first + offset) % count), 3);
		int rotations = rotationsToMatch(map.y, roadCode);
		if (rotations >= 0) return ivec2(int(map.x), rotations);
	}
	return ivec2(-1, 0);
}

vec3 applyTerrainOverlay(vec3 color, uint pcode, uint terrainCode, uint shapeCode, TerrainUv uv) {
	ivec2 map = findTerrainMap(pcode, shapeCode);
	if (map.x < 0) return color;
	float mask = texture(uBlendMasks, vec3(rotateSourceAlphaUv(sourceAlphaUv(uv.cell), map.y), float(map.x))).r;
	return mix(color, sampleTerrainColor(terrainCode, uv).rgb, clamp(1.0 - mask, 0.0, 1.0));
}

vec3 composeTerrain(uint pcode, TerrainUv uv) {
	uint codes[4];
	for (int corner = 0; corner < 4; corner += 1) codes[corner] = terrainCodeAt(pcode, corner);
	int baseIndex = -1;
	for (int first = 0; first < 3 && baseIndex < 0; first += 1) {
		for (int second = first + 1; second < 4; second += 1) {
			if (codes[first] == codes[second]) {
				baseIndex = first;
				break;
			}
		}
	}
	if (baseIndex < 0) {
		vec3 color = sampleTerrainColor(codes[0], uv).rgb;
		color = applyTerrainOverlay(color, pcode, codes[1], 2u, uv);
		color = applyTerrainOverlay(color, pcode, codes[2], 4u, uv);
		return applyTerrainOverlay(color, pcode, codes[3], 8u, uv);
	}

	uint baseCode = codes[baseIndex];
	vec3 color = sampleTerrainColor(baseCode, uv).rgb;
	int firstOverlayIndex = -1;
	uint firstShape = 0u;
	for (int corner = 0; corner < 4; corner += 1) {
		if (codes[corner] == baseCode) continue;
		if (firstOverlayIndex < 0) {
			firstOverlayIndex = corner;
			firstShape = 1u << uint(corner);
			continue;
		}
		if (codes[corner] == codes[firstOverlayIndex] && firstOverlayIndex == corner - 1) {
			firstShape += 1u << uint(corner);
			continue;
		}
		color = applyTerrainOverlay(color, pcode, codes[firstOverlayIndex], firstShape, uv);
		return applyTerrainOverlay(color, pcode, codes[corner], 1u << uint(corner), uv);
	}
	if (firstOverlayIndex >= 0) {
		color = applyTerrainOverlay(color, pcode, codes[firstOverlayIndex], firstShape, uv);
	}
	return color;
}

vec3 applyRoads(vec3 color, uint pcode, TerrainUv uv) {
	uint mask = 0u;
	for (int corner = 0; corner < 4; corner += 1) {
		if (roadCodeAt(pcode, corner) != 0u) mask |= 1u << uint(corner);
	}
	if (mask == 0u) return color;
	vec3 roadColor = sampleTerrainColor(ROAD_TERRAIN_TYPE, uv).rgb;
	if (mask == 15u) return roadColor;
	uint codes[2];
	int count = 1;
	codes[0] = mask;
	if (mask == 14u) { codes[0] = 6u; codes[1] = 12u; count = 2; }
	else if (mask == 13u) { codes[0] = 9u; codes[1] = 12u; count = 2; }
	else if (mask == 11u) { codes[0] = 9u; codes[1] = 3u; count = 2; }
	else if (mask == 7u) { codes[0] = 3u; codes[1] = 6u; count = 2; }
	float product = 1.0;
	for (int index = 0; index < 2; index += 1) {
		if (index >= count) break;
		ivec2 map = findRoadMap(pcode, codes[index]);
		if (map.x < 0) continue;
		product *= texture(uRoadMasks, vec3(rotateSourceAlphaUv(sourceAlphaUv(uv.cell), map.y), float(map.x))).r;
	}
	return mix(color, roadColor, clamp(1.0 - product, 0.0, 1.0));
}

void main() {
	ivec2 fieldSize = textureSize(uSurfaceField, 0);
	TerrainUv uv;
	uv.field = vGridUv * vec2(fieldSize);
	uv.cell = fract(uv.field);
	ivec2 cell = min(ivec2(uv.field), fieldSize - ivec2(1));
	uint pcode = texelFetch(uSurfaceField, cell, 0).r;
	vec3 color = applyRoads(composeTerrain(pcode, uv), pcode, uv);
	uvec4 metadata = compositionRecord(0, 4);
	vec4 detail = texture(uDetail, uv.field * float(metadata.w));
	float fade = clamp((uDetailFadeFar - vViewDepth) / max(uDetailFadeFar - uDetailFadeNear, 0.0001), 0.0, 1.0);
	color = mix(color, detail.rgb, clamp(detail.a * fade, 0.0, 1.0));
	// Lighting modulates the complete surface albedo, then fog applies as a raster stage. The
	// directional terms arrive interpolated; point lights evaluate here so a lamp produces a pool
	// rather than a whole-quad gradient.
	vec3 surfaceNormal = safeNormal(vSurfaceNormal);
	color *= min(
		vAmbientSun
			+ evaluateDynamicLights(vAnchoredPosition, surfaceNormal)
			+ evaluateMaskedStaticLights(vAnchoredPosition, surfaceNormal),
		vec3(1.0)
	);
	color = applyDistanceFog(color, vViewerDistance);
	fragmentColor = vec4(color, 1.0);
}
`;

/** Linked GPU program that composes one terrain cell directly from canonical source resources. */
export interface WebGL2NearTerrainProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly ambientColor: WebGLUniformLocation;
		readonly dynamicLightCount: WebGLUniformLocation;
		readonly dynamicLightPositionRange: WebGLUniformLocation;
		readonly dynamicLightColorIntensity: WebGLUniformLocation;
		readonly staticLightCount: WebGLUniformLocation;
		readonly staticLightPositionRange: WebGLUniformLocation;
		readonly staticLightColorIntensity: WebGLUniformLocation;
		readonly ambientLevel: WebGLUniformLocation;
		readonly blendMasks: WebGLUniformLocation;
		readonly cameraPosition: WebGLUniformLocation;
		readonly clipTransform: WebGLUniformLocation;
		readonly colors: WebGLUniformLocation;
		readonly composition: WebGLUniformLocation;
		readonly detail: WebGLUniformLocation;
		readonly detailFadeFar: WebGLUniformLocation;
		readonly detailFadeNear: WebGLUniformLocation;
		readonly fogColor: WebGLUniformLocation;
		readonly fogEnabled: WebGLUniformLocation;
		readonly fogFar: WebGLUniformLocation;
		readonly fogNear: WebGLUniformLocation;
		readonly landblockOffset: WebGLUniformLocation;
		readonly localToLandblock: WebGLUniformLocation;
		readonly projection: WebGLUniformLocation;
		readonly roadMasks: WebGLUniformLocation;
		readonly sunColor: WebGLUniformLocation;
		readonly sunVector: WebGLUniformLocation;
		readonly staticLightMask: WebGLUniformLocation;
		readonly surfaceField: WebGLUniformLocation;
		readonly view: WebGLUniformLocation;
	};
}

/** Compile the canonical terrain-composition draw program. */
export function createWebGL2NearTerrainProgram(
	gl: WebGL2RenderingContext,
): WebGL2NearTerrainProgram {
	const vertexShader = compileWebGL2Shader(
		gl,
		gl.VERTEX_SHADER,
		TERRAIN_VERTEX_SHADER,
	);
	const fragmentShader = compileWebGL2Shader(
		gl,
		gl.FRAGMENT_SHADER,
		TERRAIN_FRAGMENT_SHADER,
	);
	const program = gl.createProgram();
	if (!program) {
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
		throw new Error("Failed to allocate terrain shader program.");
	}
	try {
		gl.attachShader(program, vertexShader);
		gl.attachShader(program, fragmentShader);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(
				`Failed to link terrain shader program: ${gl.getProgramInfoLog(program) ?? "unknown error"}`,
			);
		}
		return {
			program,
			uniforms: {
				ambientColor: requireWebGL2Uniform(gl, program, "uAmbientColor"),
				dynamicLightCount: requireWebGL2Uniform(
					gl,
					program,
					"uDynamicLightCount",
				),
				dynamicLightPositionRange: requireWebGL2Uniform(
					gl,
					program,
					"uDynamicLightPositionRange[0]",
				),
				dynamicLightColorIntensity: requireWebGL2Uniform(
					gl,
					program,
					"uDynamicLightColorIntensity[0]",
				),
				staticLightCount: requireWebGL2Uniform(
					gl,
					program,
					"uStaticLightCount",
				),
				staticLightPositionRange: requireWebGL2Uniform(
					gl,
					program,
					"uStaticLightPositionRange[0]",
				),
				staticLightColorIntensity: requireWebGL2Uniform(
					gl,
					program,
					"uStaticLightColorIntensity[0]",
				),
				ambientLevel: requireWebGL2Uniform(gl, program, "uAmbientLevel"),
				blendMasks: requireWebGL2Uniform(gl, program, "uBlendMasks"),
				cameraPosition: requireWebGL2Uniform(gl, program, "uCameraPosition"),
				clipTransform: requireWebGL2Uniform(gl, program, "uClipTransform"),
				colors: requireWebGL2Uniform(gl, program, "uColors"),
				composition: requireWebGL2Uniform(gl, program, "uComposition"),
				detail: requireWebGL2Uniform(gl, program, "uDetail"),
				detailFadeFar: requireWebGL2Uniform(gl, program, "uDetailFadeFar"),
				detailFadeNear: requireWebGL2Uniform(gl, program, "uDetailFadeNear"),
				fogColor: requireWebGL2Uniform(gl, program, "uFogColor"),
				fogEnabled: requireWebGL2Uniform(gl, program, "uFogEnabled"),
				fogFar: requireWebGL2Uniform(gl, program, "uFogFar"),
				fogNear: requireWebGL2Uniform(gl, program, "uFogNear"),
				landblockOffset: requireWebGL2Uniform(gl, program, "uLandblockOffset"),
				localToLandblock: requireWebGL2Uniform(
					gl,
					program,
					"uLocalToLandblock",
				),
				projection: requireWebGL2Uniform(gl, program, "uProjection"),
				roadMasks: requireWebGL2Uniform(gl, program, "uRoadMasks"),
				sunColor: requireWebGL2Uniform(gl, program, "uSunColor"),
				sunVector: requireWebGL2Uniform(gl, program, "uSunVector"),
				staticLightMask: requireWebGL2Uniform(gl, program, "uStaticLightMask"),
				surfaceField: requireWebGL2Uniform(gl, program, "uSurfaceField"),
				view: requireWebGL2Uniform(gl, program, "uView"),
			},
		};
	} catch (error) {
		gl.deleteProgram(program);
		throw error;
	} finally {
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
	}
}
