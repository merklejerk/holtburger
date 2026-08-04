import type { ResolvedSceneLighting } from "../environment/scene-environment";
import { POINT_LIGHT_FALLOFF_GLSL } from "../environment/point-light-falloff";
import {
	MAX_DYNAMIC_LIGHTS,
	type RuntimeLight,
} from "../environment/runtime-lights";

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

// Authored GfxObj normals may be exactly zero (2.6% of retail vertices). Retail never
// normalizes, validates, or derives a face normal for them, and its software sun term
// yields nothing because max(0, N.L) is zero. Returning zero reproduces that without
// letting a zero-length normalize poison the result with NaN.
vec3 safeNormal(vec3 normal) {
	float lengthSquared = dot(normal, normal);
	return lengthSquared > 0.0 ? normal * inversesqrt(lengthSquared) : vec3(0.0);
}

${POINT_LIGHT_FALLOFF_GLSL}

// Dynamic lights cannot be baked because they move, so they evaluate here using the same
// authored falloff the interior bake uses, including its per-channel clamp to the light's
// own colour. That clamp is what keeps an authored intensity of 100 from washing the
// surface to white instead of to lamp colour.
vec3 evaluateDynamicLights(vec3 position, vec3 unitNormal) {
	vec3 total = vec3(0.0);
	for (int index = 0; index < uDynamicLightCount; index += 1) {
		vec4 positionRange = uDynamicLightPositionRange[index];
		vec4 colorIntensity = uDynamicLightColorIntensity[index];
		float scale = pointLightFalloff(
			positionRange.xyz - position,
			unitNormal,
			positionRange.w,
			colorIntensity.a
		);
		if (scale <= 0.0) continue;
		total += min(scale * colorIntensity.rgb, colorIntensity.rgb);
	}
	return total;
}

// Retail's fixed-function vertex color sums emissive, ambient and the diffuse light terms
// before clamping once; burned-in interior lighting arrives through the emissive slot
// (FFEmissiveColorSource = FromVertex, acclient.c:434243), so it adds here rather than
// replacing the ambient term.
vec3 evaluateSceneLighting(vec3 position, vec3 normal, vec3 bakedLight) {
	vec3 unitNormal = safeNormal(normal);
	float sun = max(dot(unitNormal, uSunVector), 0.0);
	return min(
		uAmbientLevel * uAmbientColor
			+ sun * uSunColor
			+ bakedLight
			+ evaluateDynamicLights(position, unitNormal),
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
	scratch: {
		readonly positionRange: Float32Array;
		readonly colorIntensity: Float32Array;
	},
): void {
	const count = Math.min(lights.length, MAX_DYNAMIC_LIGHTS);
	gl.uniform1i(uniforms.dynamicLightCount, count);
	if (count === 0) return;
	for (let index = 0; index < count; index += 1) {
		const light = lights[index]!;
		const offset = index * 4;
		scratch.positionRange[offset] = light.position.x;
		scratch.positionRange[offset + 1] = light.position.y;
		scratch.positionRange[offset + 2] = light.position.z;
		scratch.positionRange[offset + 3] = light.range;
		scratch.colorIntensity[offset] = light.color.red;
		scratch.colorIntensity[offset + 1] = light.color.green;
		scratch.colorIntensity[offset + 2] = light.color.blue;
		scratch.colorIntensity[offset + 3] = light.intensity;
	}
	gl.uniform4fv(
		uniforms.dynamicLightPositionRange,
		scratch.positionRange,
		0,
		count * 4,
	);
	gl.uniform4fv(
		uniforms.dynamicLightColorIntensity,
		scratch.colorIntensity,
		0,
		count * 4,
	);
}

/** Reusable upload staging sized to the dynamic cap; the renderer owns one instance. */
export function createDynamicLightScratch(): {
	readonly positionRange: Float32Array;
	readonly colorIntensity: Float32Array;
} {
	return {
		positionRange: new Float32Array(MAX_DYNAMIC_LIGHTS * 4),
		colorIntensity: new Float32Array(MAX_DYNAMIC_LIGHTS * 4),
	};
}
