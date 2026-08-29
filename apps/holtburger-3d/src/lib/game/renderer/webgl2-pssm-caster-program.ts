import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "../webgl/shader-program";

/** Material-free attribute-instanced vertex shader for outdoor actor depth. */
export function createPssmCasterVertexShader(): string {
	return `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 3) in mat4 aSourceToLandblock;

uniform mat4 uLightClip;
uniform vec3 uLandblockOffset;

void main() {
	vec3 landblockPosition = (aSourceToLandblock * vec4(aPosition, 1.0)).xyz;
	gl_Position = uLightClip * vec4(landblockPosition + uLandblockOffset, 1.0);
}
`;
}

/** Empty color stage; the target framebuffer owns depth only. */
export function createPssmCasterFragmentShader(): string {
	return `#version 300 es
precision highp float;

void main() {}
`;
}

/** Linked depth-only caster program and its complete uniform contract. */
export interface WebGL2PssmCasterProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly landblockOffset: WebGLUniformLocation;
		readonly lightClip: WebGLUniformLocation;
	};
}

/** Compile the one material-agnostic outdoor actor caster program. */
export function createWebGL2PssmCasterProgram(
	gl: WebGL2RenderingContext,
): WebGL2PssmCasterProgram {
	const vertexShader = compileWebGL2Shader(
		gl,
		gl.VERTEX_SHADER,
		createPssmCasterVertexShader(),
	);
	const fragmentShader = compileWebGL2Shader(
		gl,
		gl.FRAGMENT_SHADER,
		createPssmCasterFragmentShader(),
	);
	const program = gl.createProgram();
	if (!program)
		throw new Error("Failed to allocate outdoor shadow caster program.");
	try {
		gl.attachShader(program, vertexShader);
		gl.attachShader(program, fragmentShader);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(
				`Failed to link outdoor shadow caster program: ${gl.getProgramInfoLog(program) ?? "unknown error"}`,
			);
		}
		return {
			program,
			uniforms: {
				landblockOffset: requireWebGL2Uniform(gl, program, "uLandblockOffset"),
				lightClip: requireWebGL2Uniform(gl, program, "uLightClip"),
			},
		};
	} catch (cause) {
		gl.deleteProgram(program);
		throw cause;
	} finally {
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
	}
}
