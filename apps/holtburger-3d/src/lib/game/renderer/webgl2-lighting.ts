import type { ResolvedSceneLighting } from "../environment/scene-environment";
import { POINT_LIGHT_FALLOFF_GLSL } from "../environment/point-light-falloff";
import {
	MAX_DYNAMIC_LIGHTS,
	MAX_STATIC_LIGHTS,
	type RuntimeLight,
} from "../environment/runtime-lights";

/**
 * Ceiling on one evaluated light's contribution, as a fraction of its own colour.
 *
 * The roll-off approaches this asymptotically without reaching it, so it caps peak brightness
 * independently of `intensityScale`, which instead governs how quickly a lamp climbs toward the
 * cap and therefore how large its bright region looks. Lower to dim the hottest point without
 * shrinking the pool; 1 is the plain `x / (1 + x)` curve.
 *
 * Lives here rather than in `FRONTEND_TUNING` because it crosses into GLSL: the shader validator
 * pins shader-facing numbers by reading them out of a module as literals, which it cannot do
 * through a nested object. Same reason the wrap constants sit in `point-light-falloff.ts`.
 *
 * Module-private: the only consumers are the GLSL below and the validator, which reads source
 * text rather than importing.
 */
const EVALUATED_LIGHT_ROLL_OFF_CEILING = 1;

/**
 * Shared vertex-stage lighting for terrain and objects.
 *
 * Retail evaluates the same shape in two places: `CLandBlockStruct::calc_lighting`
 * (acclient.c:339136) bakes it into landscape vertex colors, and the fixed-function
 * pipeline computes it per vertex for meshes. Both clamp; neither applies specular.
 *
 * The sun vector is deliberately unnormalized — its length carries the authored
 * directional brightness — so the diffuse term multiplies by it directly.
 *
 * Unlike the fog helper, the uniform declarations live here with the function: this block
 * is included verbatim by every lighting-aware vertex shader, so the uniform names have
 * exactly one owner.
 */
export const WEBGL2_SCENE_LIGHTING_GLSL = `
uniform vec3 uSunVector;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;
uniform float uAmbientLevel;
// Dynamic lights in anchor-relative space, packed as xyz = position, w = range and
// rgb = colour, a = intensity. A count of zero costs one comparison and no iteration.
uniform int uDynamicLightCount;
uniform vec4 uDynamicLightPositionRange[${MAX_DYNAMIC_LIGHTS}];
uniform vec4 uDynamicLightColorIntensity[${MAX_DYNAMIC_LIGHTS}];
// Authored outdoor lights for the landblock being drawn, packed identically. Interior draws
// bind a count of zero, because their static lighting is already baked into vertex colours.
uniform int uStaticLightCount;
uniform vec4 uStaticLightPositionRange[${MAX_STATIC_LIGHTS}];
uniform vec4 uStaticLightColorIntensity[${MAX_STATIC_LIGHTS}];

// Authored GfxObj normals may be exactly zero (2.6% of retail vertices). Retail never
// normalizes, validates, or derives a face normal for them, and its software sun term
// yields nothing because max(0, N.L) is zero. Returning zero reproduces that without
// letting a zero-length normalize poison the result with NaN.
vec3 safeNormal(vec3 normal) {
	float lengthSquared = dot(normal, normal);
	return lengthSquared > 0.0 ? normal * inversesqrt(lengthSquared) : vec3(0.0);
}

${POINT_LIGHT_FALLOFF_GLSL}

// RETAIL DIVERGENCE: evaluated lights share the authored falloff with the interior bake, but not its
// per-channel clamp. Retail clamps because it bakes into dense EnvCell vertices, where a vertex
// rarely lands on the peak and interpolation hides the resulting plateau. Terrain evaluates per
// pixel -- it must, since its vertices sit 24 units apart against lamps reaching 6 -- so that
// plateau becomes a literal flat disc on screen with a hard shoulder behind it.
//
// The roll-off k*x / (k + x) is smooth instead: it approaches k without ever reaching it, so
// there is no flat region at any radius, and it leaves the tail almost unchanged. Deliberately
// not retail behaviour, because retail has none here -- its outdoor pass binds only the sun and
// never lit terrain with an authored lamp at all. The bake keeps retail's clamp exactly, since
// that path is genuinely grounded.
//
// float() wraps the interpolated ceiling so the expression stays float-typed whether the value
// stringifies with a decimal point or without one.
vec3 accumulateLight(vec3 position, vec3 unitNormal, vec4 positionRange, vec4 colorIntensity) {
	float scale = pointLightFalloff(
		positionRange.xyz - position,
		unitNormal,
		positionRange.w,
		colorIntensity.a
	);
	if (scale <= 0.0) return vec3(0.0);
	float ceiling = float(${EVALUATED_LIGHT_ROLL_OFF_CEILING});
	return colorIntensity.rgb * (ceiling * scale / (ceiling + scale));
}

vec3 evaluateDynamicLights(vec3 position, vec3 unitNormal) {
	vec3 total = vec3(0.0);
	for (int index = 0; index < uDynamicLightCount; index += 1) {
		total += accumulateLight(
			position,
			unitNormal,
			uDynamicLightPositionRange[index],
			uDynamicLightColorIntensity[index]
		);
	}
	return total;
}

// Iterate one 32-light mask word, visiting only the slots whose bits are set. Terrain owns the
// only caller; objects evaluate their whole set and never pay this.
//
// findLSB is GLSL ES 3.10 and so unavailable here. Isolating the lowest set bit as
// bits & -bits leaves a power of two, whose base-2 logarithm is exactly its float exponent --
// lossless for every power of two through 2^31, which is the whole word.
//
// Bits ascend, so the first index at or past the live count ends the word: every later bit
// names a higher slot.
vec3 accumulateMaskedWord(vec3 position, vec3 unitNormal, uint bits, int base) {
	vec3 total = vec3(0.0);
	for (int iteration = 0; iteration < 32; iteration += 1) {
		if (bits == 0u) break;
		uint lowest = bits & (0u - bits);
		bits ^= lowest;
		int index = base + int((floatBitsToUint(float(lowest)) >> 23u) - 127u);
		if (index >= uStaticLightCount) break;
		total += accumulateLight(
			position,
			unitNormal,
			uStaticLightPositionRange[index],
			uStaticLightColorIntensity[index]
		);
	}
	return total;
}

vec3 evaluateStaticLights(vec3 position, vec3 unitNormal) {
	vec3 total = vec3(0.0);
	for (int index = 0; index < uStaticLightCount; index += 1) {
		total += accumulateLight(
			position,
			unitNormal,
			uStaticLightPositionRange[index],
			uStaticLightColorIntensity[index]
		);
	}
	return total;
}

vec3 evaluateRuntimeLights(vec3 position, vec3 unitNormal) {
	return evaluateDynamicLights(position, unitNormal)
		+ evaluateStaticLights(position, unitNormal);
}

// Retail's fixed-function vertex color sums emissive, ambient and the diffuse light terms
// before clamping once; burned-in interior lighting arrives through the emissive slot
// (FFEmissiveColorSource = FromVertex, acclient.c:434243), so it adds here rather than
// replacing the ambient term.
// Ambient and the sun are directional, so they interpolate correctly across even a very large
// triangle and stay in the vertex stage. Deliberately unclamped: callers that evaluate point
// lights separately must clamp the total once, not each part.
vec3 evaluateAmbientAndSun(vec3 normal) {
	float sun = max(dot(safeNormal(normal), uSunVector), 0.0);
	return uAmbientLevel * uAmbientColor + sun * uSunColor;
}

vec3 evaluateSceneLighting(vec3 position, vec3 normal, vec3 bakedLight) {
	vec3 unitNormal = safeNormal(normal);
	return min(
		evaluateAmbientAndSun(normal)
			+ bakedLight
			+ evaluateRuntimeLights(position, unitNormal),
		vec3(1.0)
	);
}
`;

/** Lighting uniform locations resolved by every lighting-aware renderer program. */
export interface WebGL2LightingUniforms {
	readonly ambientColor: WebGLUniformLocation;
	readonly ambientLevel: WebGLUniformLocation;
	readonly sunColor: WebGLUniformLocation;
	readonly sunVector: WebGLUniformLocation;
	readonly dynamicLightCount: WebGLUniformLocation;
	readonly dynamicLightPositionRange: WebGLUniformLocation;
	readonly dynamicLightColorIntensity: WebGLUniformLocation;
	readonly staticLightCount: WebGLUniformLocation;
	readonly staticLightPositionRange: WebGLUniformLocation;
	readonly staticLightColorIntensity: WebGLUniformLocation;
}

/** Reusable upload staging shared by both light arrays. */
export interface DynamicLightScratch {
	readonly positionRange: Float32Array;
	readonly colorIntensity: Float32Array;
}

/** Bind one draw's resolved lighting for its retail role. */
export function bindWebGL2SceneLighting(
	gl: WebGL2RenderingContext,
	uniforms: WebGL2LightingUniforms,
	lighting: ResolvedSceneLighting,
): void {
	gl.uniform3f(
		uniforms.sunVector,
		lighting.sunVector.x,
		lighting.sunVector.y,
		lighting.sunVector.z,
	);
	gl.uniform3f(
		uniforms.sunColor,
		lighting.sunColor.red,
		lighting.sunColor.green,
		lighting.sunColor.blue,
	);
	gl.uniform3f(
		uniforms.ambientColor,
		lighting.ambientColor.red,
		lighting.ambientColor.green,
		lighting.ambientColor.blue,
	);
	gl.uniform1f(uniforms.ambientLevel, lighting.ambientLevel);
}

/**
 * Bind one frame's dynamic lights.
 *
 * Uploads exactly the live count rather than the array capacity, so a frame with two lights
 * sends two lights' worth of data.
 */
export function bindWebGL2DynamicLights(
	gl: WebGL2RenderingContext,
	uniforms: WebGL2LightingUniforms,
	lights: readonly RuntimeLight[],
	anchorOrigin: LightAnchorOrigin,
	scratch: DynamicLightScratch,
): void {
	bindLightArray(
		gl,
		uniforms.dynamicLightCount,
		uniforms.dynamicLightPositionRange,
		uniforms.dynamicLightColorIntensity,
		lights,
		anchorOrigin,
		// Gameplay lighting, not authored scenery: the viewer light works at any hour.
		1,
		MAX_DYNAMIC_LIGHTS,
		scratch,
	);
}

/**
 * Bind one landblock's authored static lights; an empty list costs a single count upload.
 *
 * `response` fades authored lamps out as daylight rises. Dimming a lamp is exactly dimming its
 * colour: the shader clamps each channel to that same colour, so scaling it here scales both the
 * contribution and its ceiling, and needs no shader branch of its own.
 */
export function bindWebGL2StaticLights(
	gl: WebGL2RenderingContext,
	uniforms: WebGL2LightingUniforms,
	lights: readonly RuntimeLight[],
	anchorOrigin: LightAnchorOrigin,
	response: number,
	scratch: DynamicLightScratch,
): void {
	bindLightArray(
		gl,
		uniforms.staticLightCount,
		uniforms.staticLightPositionRange,
		uniforms.staticLightColorIntensity,
		lights,
		anchorOrigin,
		response,
		MAX_STATIC_LIGHTS,
		scratch,
	);
}

/**
 * Scene-space origin of the frame's anchor landblock.
 *
 * Shaders compute vertex positions relative to this, so every light position is rebased by it on
 * the way to the GPU. Only the horizontal components differ, since landblock origins share y.
 */
export interface LightAnchorOrigin {
	readonly x: number;
	readonly z: number;
}

function bindLightArray(
	gl: WebGL2RenderingContext,
	countUniform: WebGLUniformLocation,
	positionRangeUniform: WebGLUniformLocation,
	colorIntensityUniform: WebGLUniformLocation,
	lights: readonly RuntimeLight[],
	anchorOrigin: LightAnchorOrigin,
	colorScale: number,
	cap: number,
	scratch: DynamicLightScratch,
): void {
	const count = Math.min(lights.length, cap);
	gl.uniform1i(countUniform, count);
	if (count === 0) return;
	for (let index = 0; index < count; index += 1) {
		const light = lights[index]!;
		const offset = index * 4;
		scratch.positionRange[offset] = light.position.x - anchorOrigin.x;
		scratch.positionRange[offset + 1] = light.position.y;
		scratch.positionRange[offset + 2] = light.position.z - anchorOrigin.z;
		scratch.positionRange[offset + 3] = light.range;
		scratch.colorIntensity[offset] = light.color.red * colorScale;
		scratch.colorIntensity[offset + 1] = light.color.green * colorScale;
		scratch.colorIntensity[offset + 2] = light.color.blue * colorScale;
		scratch.colorIntensity[offset + 3] = light.intensity;
	}
	gl.uniform4fv(positionRangeUniform, scratch.positionRange, 0, count * 4);
	gl.uniform4fv(colorIntensityUniform, scratch.colorIntensity, 0, count * 4);
}

/** Reusable upload staging sized to the dynamic cap; the renderer owns one instance. */
export function createDynamicLightScratch(): DynamicLightScratch {
	const capacity = Math.max(MAX_DYNAMIC_LIGHTS, MAX_STATIC_LIGHTS) * 4;
	return {
		positionRange: new Float32Array(capacity),
		colorIntensity: new Float32Array(capacity),
	};
}
