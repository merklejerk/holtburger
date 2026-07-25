import type { ResolvedDistanceFog } from "../environment/scene-environment";

/** Shared GLSL function for terrain and opaque object distance fog. */
export const WEBGL2_DISTANCE_FOG_GLSL = `
vec3 applyDistanceFog(vec3 color, float horizontalDistance) {
	if (uFogEnabled == 0) return color;
	float linear = clamp((horizontalDistance - uFogNear) / max(uFogFar - uFogNear, 0.0001), 0.0, 1.0);
	float fog = linear * linear * (3.0 - 2.0 * linear);
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
