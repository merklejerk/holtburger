import type { ObjectBlendPolicy } from "./object-rendering-policy";

/** Shader modes that preserve authored additive RGB while deriving valid canvas coverage. */
export const TRANSPARENT_CANVAS_EMISSION_MODE = {
	none: 0,
	one: 1,
	"src-alpha": 2,
	"one-minus-src-alpha": 3,
} as const;

export type TransparentCanvasEmissionMode =
	(typeof TRANSPARENT_CANVAS_EMISSION_MODE)[keyof typeof TRANSPARENT_CANVAS_EMISSION_MODE];

/** All encoded emission is normalized by the shader and reconstructed with source alpha. */
export const TRANSPARENT_CANVAS_EMISSION_BLEND: ObjectBlendPolicy = {
	destination: "one",
	source: "src-alpha",
};

/** Return the additive source-factor encoding needed by a transparent canvas, or no conversion. */
export function transparentCanvasEmissionMode(
	policy: ObjectBlendPolicy,
): TransparentCanvasEmissionMode {
	if (policy.destination !== "one")
		return TRANSPARENT_CANVAS_EMISSION_MODE.none;
	return TRANSPARENT_CANVAS_EMISSION_MODE[policy.source];
}

/**
 * Convert additive light into a valid unpremultiplied source plus coverage pair.
 *
 * The blend stage reconstructs the original emitted RGB as `rgb * alpha` while alpha can use
 * source-over union for DOM composition. Black backing texels become `(0, 0, 0, 0)` rather than
 * opaque canvas coverage. Mode zero leaves ordinary object and particle output untouched.
 */
export const TRANSPARENT_CANVAS_EMISSION_GLSL = `
vec4 encodeTransparentCanvasEmission(vec4 color, int mode) {
	if (mode == 0) return color;
	float sourceFactor = mode == 1
		? 1.0
		: (mode == 2 ? color.a : (1.0 - color.a));
	vec3 emission = max(color.rgb * sourceFactor, vec3(0.0));
	float coverage = clamp(max(emission.r, max(emission.g, emission.b)), 0.0, 1.0);
	return coverage > 0.0
		? vec4(emission / coverage, coverage)
		: vec4(0.0);
}
`;
