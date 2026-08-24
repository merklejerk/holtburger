/**
 * Context-neutral WebGL2 program construction.
 *
 * These helpers know about shaders and programs and nothing about any particular renderer, so both
 * the scene renderer and the overhead map compile through them without either depending on the
 * other. Keep renderer concepts — passes, scenes, frames, resources — out of this module; anything
 * that needs them belongs in the renderer that owns them.
 */

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

/**
 * Compile, link, and validate one complete program, naming it in every diagnostic.
 *
 * Shaders are deleted once linked whether or not linking succeeded, so a caller that throws here
 * leaks neither shader nor program.
 */
export function linkWebGL2Program(
	gl: WebGL2RenderingContext,
	label: string,
	vertexSource: string,
	fragmentSource: string,
): WebGLProgram {
	const vertexShader = compileWebGL2Shader(gl, gl.VERTEX_SHADER, vertexSource);
	let fragmentShader: WebGLShader;
	try {
		fragmentShader = compileWebGL2Shader(
			gl,
			gl.FRAGMENT_SHADER,
			fragmentSource,
		);
	} catch (error) {
		gl.deleteShader(vertexShader);
		throw error;
	}
	const program = gl.createProgram();
	if (!program) {
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
		throw new Error(`Failed to allocate ${label} shader program.`);
	}
	try {
		gl.attachShader(program, vertexShader);
		gl.attachShader(program, fragmentShader);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(
				`Failed to link ${label} shader program: ${gl.getProgramInfoLog(program) ?? "unknown error"}`,
			);
		}
		return program;
	} catch (error) {
		gl.deleteProgram(program);
		throw error;
	} finally {
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
	}
}
