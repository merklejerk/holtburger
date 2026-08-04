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
vec3 evaluateSceneLighting(vec3 normal, vec3 bakedLight) {
	float sun = max(dot(safeNormal(normal), uSunVector), 0.0);
	return min(uAmbientLevel * uAmbientColor + sun * uSunColor + bakedLight, vec3(1.0));
}
`;

/** Lighting uniform locations resolved by every lighting-aware renderer program. */
export interface WebGL2LightingUniforms {
	readonly ambientColor: WebGLUniformLocation;
	readonly ambientLevel: WebGLUniformLocation;
	readonly sunColor: WebGLUniformLocation;
	readonly sunVector: WebGLUniformLocation;
}

/** Bind one draw's resolved lighting. Neutral values reproduce unlit output exactly. */
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
