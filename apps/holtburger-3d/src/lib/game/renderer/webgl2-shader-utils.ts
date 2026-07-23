/** Compile one shader stage and surface the driver diagnostic on failure. */
export function compileWebGL2Shader(
	gl: WebGL2RenderingContext,
	type: GLenum,
	source: string,
): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error("Failed to allocate WebGL shader.");
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
	const message = gl.getShaderInfoLog(shader) ?? "unknown error";
	gl.deleteShader(shader);
	throw new Error(`Failed to compile WebGL shader: ${message}`);
}

/** Resolve one required program uniform without allowing a silent null binding. */
export function requireWebGL2Uniform(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	name: string,
): WebGLUniformLocation {
	const uniform = gl.getUniformLocation(program, name);
	if (!uniform) throw new Error(`WebGL shader is missing uniform ${name}.`);
	return uniform;
}
