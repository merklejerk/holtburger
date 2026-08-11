import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "./webgl2-shader-utils";
import type { WebGL2FlatSceneTargetSet } from "./webgl2-flat-scene-target";

const SCENE_COLOR_TEXTURE_UNIT = 0;
const SCENE_DEPTH_TEXTURE_UNIT = 1;

const PRESENTATION_VERTEX_SHADER = `#version 300 es
precision highp float;

void main() {
	const vec2 positions[3] = vec2[3](
		vec2(-1.0, -1.0),
		vec2(3.0, -1.0),
		vec2(-1.0, 3.0)
	);
	vec2 position = positions[gl_VertexID];
	gl_Position = vec4(position, 0.0, 1.0);
}
`;

const PRESENTATION_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
layout(location = 0) out vec4 outColor;

void main() {
	ivec2 scenePixel = ivec2(gl_FragCoord.xy);
	outColor = texelFetch(uSceneColor, scenePixel, 0);
	gl_FragDepth = texelFetch(uSceneDepth, scenePixel, 0).r;
}
`;

/** Full-drawing-buffer color/depth presenter for the unconditional flat-scene target. */
export class WebGL2FlatScenePresentation {
	readonly #gl: WebGL2RenderingContext;
	readonly #program: WebGLProgram;
	readonly #vertexArray: WebGLVertexArrayObject;
	#destroyed = false;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		const previousProgram = gl.getParameter(
			gl.CURRENT_PROGRAM,
		) as WebGLProgram | null;
		let vertexShader: WebGLShader | null = null;
		let fragmentShader: WebGLShader | null = null;
		let program: WebGLProgram | null = null;
		try {
			vertexShader = compileWebGL2Shader(
				gl,
				gl.VERTEX_SHADER,
				PRESENTATION_VERTEX_SHADER,
			);
			fragmentShader = compileWebGL2Shader(
				gl,
				gl.FRAGMENT_SHADER,
				PRESENTATION_FRAGMENT_SHADER,
			);
			program = gl.createProgram();
			if (!program) {
				throw new Error("Failed to allocate flat scene presentation program.");
			}
			gl.attachShader(program, vertexShader);
			gl.attachShader(program, fragmentShader);
			gl.linkProgram(program);
			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
				throw new Error(
					`Failed to link flat scene presentation program: ${gl.getProgramInfoLog(program) ?? "unknown error"}`,
				);
			}
			gl.useProgram(program);
			gl.uniform1i(
				requireWebGL2Uniform(gl, program, "uSceneColor"),
				SCENE_COLOR_TEXTURE_UNIT,
			);
			gl.uniform1i(
				requireWebGL2Uniform(gl, program, "uSceneDepth"),
				SCENE_DEPTH_TEXTURE_UNIT,
			);
			this.#program = program;
		} catch (cause) {
			if (program) gl.deleteProgram(program);
			throw cause;
		} finally {
			if (vertexShader) gl.deleteShader(vertexShader);
			if (fragmentShader) gl.deleteShader(fragmentShader);
			gl.useProgram(previousProgram);
		}
		const vertexArray = gl.createVertexArray();
		if (!vertexArray) {
			gl.deleteProgram(this.#program);
			throw new Error(
				"Failed to allocate flat scene presentation vertex array.",
			);
		}
		this.#vertexArray = vertexArray;
	}

	/** Replace the default framebuffer with exact scene color and sampled opaque depth. */
	present(target: WebGL2FlatSceneTargetSet): void {
		if (this.#destroyed) {
			throw new Error("Flat scene presentation has been destroyed.");
		}
		const gl = this.#gl;
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
		gl.viewport(0, 0, target.extent.width, target.extent.height);
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.SCISSOR_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.stencilMask(0xff);
		gl.clearStencil(0);
		gl.clear(gl.STENCIL_BUFFER_BIT);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.ALWAYS);
		gl.useProgram(this.#program);
		gl.bindVertexArray(this.#vertexArray);
		gl.activeTexture(gl.TEXTURE0 + SCENE_COLOR_TEXTURE_UNIT);
		gl.bindTexture(gl.TEXTURE_2D, target.color);
		gl.activeTexture(gl.TEXTURE0 + SCENE_DEPTH_TEXTURE_UNIT);
		gl.bindTexture(gl.TEXTURE_2D, target.depth);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindVertexArray(null);
		gl.depthFunc(gl.LEQUAL);
	}

	/** Release the renderer-local program and vertex array exactly once. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#gl.deleteVertexArray(this.#vertexArray);
		this.#gl.deleteProgram(this.#program);
	}
}
