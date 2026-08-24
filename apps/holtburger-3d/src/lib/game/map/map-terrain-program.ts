import { TERRAIN_TYPE_COUNT } from "../terrain/pcode";
import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../webgl/shader-program";

/** Vertex attribute slots shared by the map terrain buffers and program. */
export const MAP_TERRAIN_ATTRIBUTES = {
	localPosition: 0,
	normal: 1,
	terrainCode: 2,
	roadCoverage: 3,
	walkable: 4,
} as const;

/**
 * Orthographic top-down terrain shading.
 *
 * `uWorldToClip` folds zoom, rotation, canvas aspect, and the world-to-screen axis flip into one
 * CPU-computed 2x2, so the shader holds no orientation policy and the map can be reoriented without
 * touching GLSL. Depth is deliberately absent: outdoor terrain tiles without overlap, so Phase 1
 * draws with the depth test off. The anchor-relative depth rule arrives with the interior program,
 * which is the first geometry that can overlap itself.
 */
const MAP_TERRAIN_VERTEX_SHADER = `#version 300 es
layout(location = ${MAP_TERRAIN_ATTRIBUTES.localPosition}) in vec3 aLocalPosition;
layout(location = ${MAP_TERRAIN_ATTRIBUTES.normal}) in vec3 aNormal;
layout(location = ${MAP_TERRAIN_ATTRIBUTES.terrainCode}) in uint aTerrainCode;
layout(location = ${MAP_TERRAIN_ATTRIBUTES.roadCoverage}) in float aRoadCoverage;
layout(location = ${MAP_TERRAIN_ATTRIBUTES.walkable}) in float aWalkable;

uniform mat2 uWorldToClip;
uniform vec2 uLandblockOrigin;
uniform vec2 uMapCenter;

// A terrain type describes a whole patch of ground, so it is flat; the mesh gives every corner of
// a triangle the same resolved type, which makes that independent of the provoking-vertex
// convention. Road coverage and normals interpolate, because a road edge and a hillside are both
// continuous, and the fragment stage decides where the road edge actually falls.
flat out uint vTerrainCode;
// Walkability is a fact about one triangle's own face, decided on the CPU from its geometric
// normal, so it must not be smeared across the face by interpolation.
flat out float vWalkable;
out float vRoadCoverage;
out float vHeight;
out vec3 vNormal;

void main() {
	vec2 worldOffset =
		uLandblockOrigin + vec2(aLocalPosition.x, aLocalPosition.z) - uMapCenter;
	vTerrainCode = aTerrainCode;
	vRoadCoverage = aRoadCoverage;
	vWalkable = aWalkable;
	// Landblock origins carry no height, so local Y is already world height.
	vHeight = aLocalPosition.y;
	vNormal = aNormal;
	gl_Position = vec4(uWorldToClip * worldOffset, 0.0, 1.0);
}
`;

const MAP_TERRAIN_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec3 uTerrainPalette[${TERRAIN_TYPE_COUNT}];
uniform vec3 uRoadColor;
uniform float uRoadTintStrength;
uniform vec3 uSunDirection;
uniform float uAmbientLevel;
uniform vec3 uSteepColor;
uniform float uSteepHatchPeriodPixels;
uniform float uSteepHatchStrength;
uniform vec3 uContourSameLevelColor;
uniform vec3 uContourAboveColor;
uniform vec3 uContourBelowColor;
uniform float uContourInterval;
uniform float uContourStrength;
uniform float uContourMinimumClimbPerPixel;
uniform float uContourHeightSpan;
uniform vec3 uContourHaloColor;
uniform float uAnchorHeight;
uniform float uReliefExaggeration;

flat in uint vTerrainCode;
flat in float vWalkable;
in float vRoadCoverage;
in float vHeight;
in vec3 vNormal;
out vec4 fragmentColor;

void main() {
	vec3 normal = normalize(vNormal);
	vec3 base = uTerrainPalette[int(vTerrainCode)];
	// The road edge falls halfway between an authored road vertex and its neighbour, which keeps
	// the boundary crisp while placing it from every corner rather than from one of them. This
	// approximates retail's authored road alpha masks, which the map deliberately does not load.
	float road = step(0.5, vRoadCoverage);
	vec3 color = mix(base, uRoadColor, road * uRoadTintStrength);
	// Shade an exaggerated surface, but classify the real one: the steep test below reads the
	// unexaggerated normal so it keeps meaning what retail means.
	vec3 reliefNormal = normalize(
		vec3(normal.x * uReliefExaggeration, normal.y, normal.z * uReliefExaggeration)
	);
	float lambert = max(dot(reliefNormal, uSunDirection), 0.0);
	vec3 shaded = color * (uAmbientLevel + (1.0 - uAmbientLevel) * lambert);
	// Contours first, so hatching sits on top of them where the two coincide: on a cliff, "cannot
	// climb this" outranks "and it is this high".
	float contours = vHeight / uContourInterval;
	float contourDistance =
		abs(fract(contours - 0.5) - 0.5) / max(fwidth(contours), 1e-5);
	// A contour is a *crossing*, so it needs the ground to change height across the pixel. A flat
	// face sitting exactly on a multiple of the interval is a level set with area rather than a
	// curve: the distance above is zero across the whole face, and the guard on the denominator
	// turns "no variation" into "tiny variation", so the face floods with line colour. AC's
	// quantised terrain heights put whole landblocks and shelves on exact multiples — Holtburg's
	// ground is flat at 20 m, two intervals exactly — which makes this the common case rather than
	// a corner case.
	//
	// The test reads the pixel's own height span rather than the surface normal, because the normal
	// is a smoothed central difference and reads as tilted on a flat shelf beside a cliff, which is
	// exactly where the flooding is. Gating on it left the flood untouched. Measured on 0x2E36:
	// flooded faces span 0 m per pixel while ordinary ground spans about 5 mm, so this separates
	// two populations that do not overlap rather than trimming a continuum.
	float crossing =
		smoothstep(0.0, uContourMinimumClimbPerPixel, fwidth(vHeight));
	float contour = crossing * (1.0 - smoothstep(0.0, 1.0, contourDistance));
	// A wider dark halo under a narrower coloured core. Without it a "below" line lands green on
	// green grass and disappears exactly where the ground is most like it; haloing is how paper
	// maps keep a coloured line readable over any ground it crosses.
	float halo = crossing * (1.0 - smoothstep(0.0, 2.0, contourDistance));
	// Lines carry the same height ramp the interior floors use, so one contour says both how high
	// the ground is and whether it stands above or below the reader.
	float relativeHeight = vHeight - uAnchorHeight;
	float departure = clamp(abs(relativeHeight) / uContourHeightSpan, 0.0, 1.0);
	vec3 endpoint =
		relativeHeight >= 0.0 ? uContourAboveColor : uContourBelowColor;
	vec3 contourColor = mix(uContourSameLevelColor, endpoint, departure);
	vec3 withHalo = mix(shaded, uContourHaloColor, halo * uContourStrength);
	vec3 withContours = mix(withHalo, contourColor, contour * uContourStrength);

	// Screen-space diagonal hatching, so stripe spacing stays readable at every zoom rather than
	// collapsing into solid fill when the map pulls back. The stripes are the whole marking:
	// ground between them keeps its own colour, so a slope reads as hatched rather than as merely
	// darker.
	float steep = 1.0 - vWalkable;
	float hatchPhase =
		(gl_FragCoord.x + gl_FragCoord.y) / max(uSteepHatchPeriodPixels, 1.0);
	float hatch = step(0.5, fract(hatchPhase));
	fragmentColor = vec4(
		mix(withContours, uSteepColor, steep * hatch * uSteepHatchStrength),
		1.0
	);
}
`;

/** Compiled map terrain program and every uniform it requires. */
export interface MapTerrainProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly ambientLevel: WebGLUniformLocation;
		readonly landblockOrigin: WebGLUniformLocation;
		readonly mapCenter: WebGLUniformLocation;
		readonly palette: WebGLUniformLocation;
		readonly roadColor: WebGLUniformLocation;
		readonly roadTintStrength: WebGLUniformLocation;
		readonly anchorHeight: WebGLUniformLocation;
		readonly contourAboveColor: WebGLUniformLocation;
		readonly contourBelowColor: WebGLUniformLocation;
		readonly contourHaloColor: WebGLUniformLocation;
		readonly contourHeightSpan: WebGLUniformLocation;
		readonly contourInterval: WebGLUniformLocation;
		readonly contourSameLevelColor: WebGLUniformLocation;
		readonly contourStrength: WebGLUniformLocation;
		readonly contourMinimumClimbPerPixel: WebGLUniformLocation;
		readonly steepColor: WebGLUniformLocation;
		readonly steepHatchPeriodPixels: WebGLUniformLocation;
		readonly steepHatchStrength: WebGLUniformLocation;
		readonly sunDirection: WebGLUniformLocation;
		readonly reliefExaggeration: WebGLUniformLocation;
		readonly worldToClip: WebGLUniformLocation;
	};
}

/** Compile the map's terrain draw program. */
export function createMapTerrainProgram(
	gl: WebGL2RenderingContext,
): MapTerrainProgram {
	const program = linkWebGL2Program(
		gl,
		"map terrain",
		MAP_TERRAIN_VERTEX_SHADER,
		MAP_TERRAIN_FRAGMENT_SHADER,
	);
	return {
		program,
		uniforms: {
			ambientLevel: requireWebGL2Uniform(gl, program, "uAmbientLevel"),
			landblockOrigin: requireWebGL2Uniform(gl, program, "uLandblockOrigin"),
			mapCenter: requireWebGL2Uniform(gl, program, "uMapCenter"),
			palette: requireWebGL2Uniform(gl, program, "uTerrainPalette[0]"),
			roadColor: requireWebGL2Uniform(gl, program, "uRoadColor"),
			roadTintStrength: requireWebGL2Uniform(gl, program, "uRoadTintStrength"),
			anchorHeight: requireWebGL2Uniform(gl, program, "uAnchorHeight"),
			contourAboveColor: requireWebGL2Uniform(
				gl,
				program,
				"uContourAboveColor",
			),
			contourBelowColor: requireWebGL2Uniform(
				gl,
				program,
				"uContourBelowColor",
			),
			contourHaloColor: requireWebGL2Uniform(gl, program, "uContourHaloColor"),
			contourHeightSpan: requireWebGL2Uniform(
				gl,
				program,
				"uContourHeightSpan",
			),
			contourInterval: requireWebGL2Uniform(gl, program, "uContourInterval"),
			contourSameLevelColor: requireWebGL2Uniform(
				gl,
				program,
				"uContourSameLevelColor",
			),
			contourStrength: requireWebGL2Uniform(gl, program, "uContourStrength"),
			contourMinimumClimbPerPixel: requireWebGL2Uniform(
				gl,
				program,
				"uContourMinimumClimbPerPixel",
			),
			steepColor: requireWebGL2Uniform(gl, program, "uSteepColor"),
			steepHatchPeriodPixels: requireWebGL2Uniform(
				gl,
				program,
				"uSteepHatchPeriodPixels",
			),
			steepHatchStrength: requireWebGL2Uniform(
				gl,
				program,
				"uSteepHatchStrength",
			),
			sunDirection: requireWebGL2Uniform(gl, program, "uSunDirection"),
			reliefExaggeration: requireWebGL2Uniform(
				gl,
				program,
				"uReliefExaggeration",
			),
			worldToClip: requireWebGL2Uniform(gl, program, "uWorldToClip"),
		},
	};
}
