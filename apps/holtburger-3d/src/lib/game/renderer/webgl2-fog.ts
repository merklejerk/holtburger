import type { ResolvedDistanceFog } from "../environment/scene-environment";

/** Shared GLSL function for terrain and opaque object distance fog. */
export const WEBGL2_DISTANCE_FOG_GLSL = `
// Retail runs D3DFOG_LINEAR with D3DRS_RANGEFOGENABLE (acclient.c:440257, 440357): a straight
// ramp over true radial distance to the eye, not a smoothstep over horizontal distance.
vec3 applyDistanceFog(vec3 color, float viewerDistance) {
	if (uFogEnabled == 0) return color;
	float fog = clamp((viewerDistance - uFogNear) / max(uFogFar - uFogNear, 0.0001), 0.0, 1.0);
	return mix(color, uFogColor, fog);
}
`;

/** Common uniform names supplied by terrain and object renderer programs. */
export interface WebGL2FogUniforms {
	readonly fogColor: WebGLUniformLocation;
	readonly fogEnabled: WebGLUniformLocation;
	readonly fogFar: WebGLUniformLocation;
	readonly fogNear: WebGLUniformLocation;
}

/** Bind one frame's already-coverage-adjusted fog state identically for every opaque pass. */
export function bindWebGL2DistanceFog(
	gl: WebGL2RenderingContext,
	uniforms: WebGL2FogUniforms,
	fog: ResolvedDistanceFog | null,
): void {
	gl.uniform1i(uniforms.fogEnabled, fog ? 1 : 0);
	gl.uniform1f(uniforms.fogNear, fog?.near ?? 0);
	gl.uniform1f(uniforms.fogFar, fog?.far ?? 1);
	gl.uniform3f(
		uniforms.fogColor,
		fog?.color.red ?? 0,
		fog?.color.green ?? 0,
		fog?.color.blue ?? 0,
	);
}
