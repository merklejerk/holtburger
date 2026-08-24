import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../webgl/shader-program";

/** The single vertex attribute derived map surfaces carry. */
export const MAP_SURFACE_POSITION_ATTRIBUTE = 0;

/**
 * Flat-filled derived geometry: interior floors, building blockers, and doorway accents.
 *
 * One program serves all three because they differ only in fill colour and whether depth and fade
 * apply. Interiors are the only geometry that can overlap itself — a dungeon ramp passes over its
 * own corridor — so depth is anchor-relative and downward-first. The nearest floor at or below the
 * anchor wins; a floor above participates only where no lower floor covers that pixel. This keeps
 * an upper passage visible through genuine gaps without letting its floor hide a pit from a
 * top-down reader. Setting `uFadeSpan` to zero disables both fade and tint for geometry that has no
 * meaningful height relationship to the anchor, which is every outdoor blocker.
 */
const MAP_SURFACE_VERTEX_SHADER = `#version 300 es
layout(location = ${MAP_SURFACE_POSITION_ATTRIBUTE}) in vec3 aLocalPosition;

uniform mat2 uWorldToClip;
uniform vec2 uLandblockOrigin;
uniform vec2 uMapCenter;
uniform mat4 uLocalToLandblock;
uniform float uAnchorHeight;
uniform vec2 uOutlineCenter;
uniform float uOutlineExpansion;

out float vSignedHeightDelta;

void main() {
	// An outline pass pushes every vertex outward from the shape's own centre before placing it,
	// so the same mesh drawn twice leaves a rim of the first pass showing around the second. The
	// map deliberately owns no polygon boolean operations, and a true silhouette of a flattened
	// physics shell would need one; this approximates it for the compact footprints buildings
	// actually have. Zero expansion is the ordinary fill pass.
	vec3 local = aLocalPosition;
	vec2 fromCenter = local.xz - uOutlineCenter;
	float centerDistance = length(fromCenter);
	if (uOutlineExpansion > 0.0 && centerDistance > 1e-4) {
		local.xz += (fromCenter / centerDistance) * uOutlineExpansion;
	}
	vec3 landblockPosition = (uLocalToLandblock * vec4(local, 1.0)).xyz;
	vec2 worldOffset =
		uLandblockOrigin + landblockPosition.xz - uMapCenter;
	// Landblock origins carry no height, so landblock-local Y is already world Y.
	float signedDelta = landblockPosition.y - uAnchorHeight;
	vSignedHeightDelta = signedDelta;
	// The fragment shader owns depth because a ramp can cross the anchor plane within one triangle.
	gl_Position = vec4(uWorldToClip * worldOffset, 0.0, 1.0);
}
`;

const MAP_SURFACE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec3 uFillColor;
uniform vec3 uVoidColor;
uniform vec3 uAboveTint;
uniform vec3 uBelowTint;
uniform float uDepthSpan;
uniform float uFadeSpan;
uniform float uSameLevelBand;
uniform float uTintSpan;
uniform float uMaximumFade;

in float vSignedHeightDelta;
out vec4 fragmentColor;

// Keep the two priority ranges categorically separate after fixed-point depth quantization.
const float DEPTH_PARTITION_GAP = 0.002;
const float DEPTH_PARTITION_SPAN = (1.0 - DEPTH_PARTITION_GAP) / 2.0;
const float ABOVE_DEPTH_START = (1.0 + DEPTH_PARTITION_GAP) / 2.0;

void main() {
	// Reserve the near half of the depth buffer for floors at or below the anchor. Within each half,
	// distance still chooses the nearest floor. The small dead zone makes every below floor beat
	// every above floor even when both distances saturate at uDepthSpan.
	float relativeDepth = clamp(abs(vSignedHeightDelta) / uDepthSpan, 0.0, 1.0);
	gl_FragDepth = vSignedHeightDelta <= 0.0
		? relativeDepth * DEPTH_PARTITION_SPAN
		: ABOVE_DEPTH_START + relativeDepth * DEPTH_PARTITION_SPAN;
	if (uFadeSpan <= 0.0) {
		fragmentColor = vec4(uFillColor, 1.0);
		return;
	}
	float fade = clamp(abs(vSignedHeightDelta) / uFadeSpan, 0.0, 1.0);
	// A three-stop diverging ramp: below, your own level, above. Departure saturates over a much
	// shorter span than the fade, so which side of you a passage sits on is obvious before it dims.
	// The ramp is monotonic in lightness as well as hue, which is what carries direction for a
	// viewer who resolves no colour: brightest is here, mid is up, dark is down.
	float beyondBand = max(abs(vSignedHeightDelta) - uSameLevelBand, 0.0);
	float departure = clamp(beyondBand / max(uTintSpan - uSameLevelBand, 0.001), 0.0, 1.0);
	vec3 endpoint = vSignedHeightDelta >= 0.0 ? uAboveTint : uBelowTint;
	vec3 ramped = mix(uFillColor, endpoint, departure);
	fragmentColor = vec4(mix(ramped, uVoidColor, fade * uMaximumFade), 1.0);
}
`;

/** Compiled flat-surface program and every uniform it requires. */
export interface MapSurfaceProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly aboveTint: WebGLUniformLocation;
		readonly anchorHeight: WebGLUniformLocation;
		readonly belowTint: WebGLUniformLocation;
		readonly depthSpan: WebGLUniformLocation;
		readonly fadeSpan: WebGLUniformLocation;
		readonly fillColor: WebGLUniformLocation;
		readonly maximumFade: WebGLUniformLocation;
		readonly sameLevelBand: WebGLUniformLocation;
		readonly tintSpan: WebGLUniformLocation;
		readonly landblockOrigin: WebGLUniformLocation;
		readonly localToLandblock: WebGLUniformLocation;
		readonly mapCenter: WebGLUniformLocation;
		readonly outlineCenter: WebGLUniformLocation;
		readonly outlineExpansion: WebGLUniformLocation;
		readonly voidColor: WebGLUniformLocation;
		readonly worldToClip: WebGLUniformLocation;
	};
}

/** Compile the map's flat derived-surface program. */
export function createMapSurfaceProgram(
	gl: WebGL2RenderingContext,
): MapSurfaceProgram {
	const program = linkWebGL2Program(
		gl,
		"map surface",
		MAP_SURFACE_VERTEX_SHADER,
		MAP_SURFACE_FRAGMENT_SHADER,
	);
	return {
		program,
		uniforms: {
			aboveTint: requireWebGL2Uniform(gl, program, "uAboveTint"),
			anchorHeight: requireWebGL2Uniform(gl, program, "uAnchorHeight"),
			belowTint: requireWebGL2Uniform(gl, program, "uBelowTint"),
			depthSpan: requireWebGL2Uniform(gl, program, "uDepthSpan"),
			fadeSpan: requireWebGL2Uniform(gl, program, "uFadeSpan"),
			fillColor: requireWebGL2Uniform(gl, program, "uFillColor"),
			maximumFade: requireWebGL2Uniform(gl, program, "uMaximumFade"),
			sameLevelBand: requireWebGL2Uniform(gl, program, "uSameLevelBand"),
			tintSpan: requireWebGL2Uniform(gl, program, "uTintSpan"),
			landblockOrigin: requireWebGL2Uniform(gl, program, "uLandblockOrigin"),
			localToLandblock: requireWebGL2Uniform(gl, program, "uLocalToLandblock"),
			mapCenter: requireWebGL2Uniform(gl, program, "uMapCenter"),
			outlineCenter: requireWebGL2Uniform(gl, program, "uOutlineCenter"),
			outlineExpansion: requireWebGL2Uniform(gl, program, "uOutlineExpansion"),
			voidColor: requireWebGL2Uniform(gl, program, "uVoidColor"),
			worldToClip: requireWebGL2Uniform(gl, program, "uWorldToClip"),
		},
	};
}
