import type { ResolvedSceneLighting } from "../environment/scene-environment";

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
// Viewer headlamp in anchor-relative space, then its effective range and intensity. Zero
// intensity means the headlamp is off.
uniform vec3 uViewerLightPosition;
uniform vec2 uViewerLightRangeIntensity;

// Authored GfxObj normals may be exactly zero (2.6% of retail vertices). Retail never
// normalizes, validates, or derives a face normal for them, and its software sun term
// yields nothing because max(0, N.L) is zero. Returning zero reproduces that without
// letting a zero-length normalize poison the result with NaN.
vec3 safeNormal(vec3 normal) {
	float lengthSquared = dot(normal, normal);
	return lengthSquared > 0.0 ? normal * inversesqrt(lengthSquared) : vec3(0.0);
}

// Retail's fixed-function vertex color sums emissive, ambient and the diffuse light terms
// before clamping once; burned-in interior lighting arrives through the emissive slot
// (FFEmissiveColorSource = FromVertex, acclient.c:434243), so it adds here rather than
// replacing the ambient term.
// The headlamp moves with the camera, so it cannot be baked. Retail registers it as a
// *dynamic* light, which takes the fixed-function hardware path rather than the burn-in:
// Diffuse = color * intensity, Att0/1/2 = 0/1/0 giving pure 1/d, and a hard cutoff at
// Range (acclient.c:432845-432906). That is a different shape from calc_point_light's
// half-Lambert wrap, which applies only to burned-in static light.
float evaluateViewerLight(vec3 position, vec3 unitNormal) {
	float intensity = uViewerLightRangeIntensity.y;
	if (intensity <= 0.0) return 0.0;
	vec3 delta = uViewerLightPosition - position;
	float distance = length(delta);
	if (distance >= uViewerLightRangeIntensity.x || distance <= 0.0) return 0.0;
	return max(dot(unitNormal, delta / distance), 0.0) * intensity / distance;
}

vec3 evaluateSceneLighting(vec3 position, vec3 normal, vec3 bakedLight) {
	vec3 unitNormal = safeNormal(normal);
	float sun = max(dot(unitNormal, uSunVector), 0.0);
	return min(
		uAmbientLevel * uAmbientColor
			+ sun * uSunColor
			+ bakedLight
			+ vec3(evaluateViewerLight(position, unitNormal)),
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
	readonly viewerLightRangeIntensity: WebGLUniformLocation;
	readonly viewerLightPosition: WebGLUniformLocation;
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
	gl.uniform3f(
		uniforms.viewerLightPosition,
		lighting.viewerLight.position.x,
		lighting.viewerLight.position.y,
		lighting.viewerLight.position.z,
	);
	gl.uniform2f(
		uniforms.viewerLightRangeIntensity,
		lighting.viewerLight.range,
		lighting.viewerLight.intensity,
	);
}
