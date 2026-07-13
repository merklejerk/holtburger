const FLAT_COLOR_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uLocalToLandblock;
uniform vec3 uLandblockOffset;

void main() {
	vec3 landblockPosition = (uLocalToLandblock * vec4(aPosition, 1.0)).xyz;
	vec3 anchoredPosition = landblockPosition + uLandblockOffset;
	gl_Position = uProjection * uView * vec4(anchoredPosition, 1.0);
}
`;

const FLAT_COLOR_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec4 uColor;
out vec4 fragmentColor;

void main() {
	fragmentColor = uColor;
}
`;

/** Temporary flat-color program used by the initial terrain and object draw path. */
export interface WebGL2FlatColorProgram {
	/** Linked flat-color shader program. */
	readonly program: WebGLProgram;
	readonly uniforms: {
		/** Anchor-relative translation of the draw's resident landblock. */
		readonly landblockOffset: WebGLUniformLocation;
		/** Flattened resource-local to landblock-local transform. */
		readonly localToLandblock: WebGLUniformLocation;
		/** View projection component. */
		readonly projection: WebGLUniformLocation;
		/** Flat color assigned to the current draw. */
		readonly color: WebGLUniformLocation;
		/** Anchor-relative camera view transform. */
		readonly view: WebGLUniformLocation;
	};
}

export function createWebGL2FlatColorProgram(
	gl: WebGL2RenderingContext,
): WebGL2FlatColorProgram {
	const vertexShader = compileShader(
		gl,
		gl.VERTEX_SHADER,
		FLAT_COLOR_VERTEX_SHADER,
	);
	const fragmentShader = compileShader(
		gl,
		gl.FRAGMENT_SHADER,
		FLAT_COLOR_FRAGMENT_SHADER,
	);
	const program = gl.createProgram();
	if (!program) {
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
		throw new Error("Failed to allocate flat-color shader program.");
	}
	try {
		gl.attachShader(program, vertexShader);
		gl.attachShader(program, fragmentShader);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(
				`Failed to link flat-color shader program: ${gl.getProgramInfoLog(program) ?? "unknown error"}`,
			);
		}
		return {
			program,
			uniforms: {
				color: requireUniform(gl, program, "uColor"),
				landblockOffset: requireUniform(gl, program, "uLandblockOffset"),
				localToLandblock: requireUniform(gl, program, "uLocalToLandblock"),
				projection: requireUniform(gl, program, "uProjection"),
				view: requireUniform(gl, program, "uView"),
			},
		};
	} catch (error) {
		gl.deleteProgram(program);
		throw error;
	} finally {
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
	}
}

function compileShader(
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

function requireUniform(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	name: string,
): WebGLUniformLocation {
	const uniform = gl.getUniformLocation(program, name);
	if (!uniform)
		throw new Error(`Flat-color shader is missing uniform ${name}.`);
	return uniform;
}
