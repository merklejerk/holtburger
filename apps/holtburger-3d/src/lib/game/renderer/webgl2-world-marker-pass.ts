import { mat4ToFloat32Array } from "../math/matrices";
import type { Mat4, Vec3 } from "../math/types";
import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import {
	bindWebGL2PortalDeferredVisibilityProgram,
	PORTAL_DEFERRED_VISIBILITY_GLSL,
	type WebGL2PortalDeferredVisibilityUniforms,
} from "./portal-deferred-visibility-glsl";

const SEGMENT_COUNT = 48;
const VERTEX_COUNT = (SEGMENT_COUNT + 1) * 2;
const MARKER_VERTEX_ATTRIBUTE = 0;

interface MarkerProgram {
	readonly program: WebGLProgram;
	readonly portal: WebGL2PortalDeferredVisibilityUniforms | null;
	readonly uniforms: {
		readonly center: WebGLUniformLocation;
		readonly clipFromAnchor: WebGLUniformLocation;
		readonly color: WebGLUniformLocation;
		readonly normal: WebGLUniformLocation;
		readonly radius: WebGLUniformLocation;
	};
}

export interface WorldMarkerDrawInput {
	readonly center: Vec3;
	readonly clipFromAnchor: Mat4;
	readonly color: readonly [number, number, number, number];
	readonly normal: readonly [number, number, number];
	readonly radius: number;
}

export interface WorldMarkerPortalRouting {
	routeDeferredSubmission(
		renderScopeKey: string,
		uniforms: WebGL2PortalDeferredVisibilityUniforms,
	): void;
}

/** Renderer-owned static ring with no per-marker GPU allocation. */
export class WebGL2WorldMarkerPass {
	readonly #gl: WebGL2RenderingContext;
	readonly #matrix = new Float32Array(16);
	readonly #vertexBuffer: WebGLBuffer;
	readonly #vertexArray: WebGLVertexArrayObject;
	readonly #flatProgram: MarkerProgram;
	readonly #portalProgram: MarkerProgram;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		const vertexArray = gl.createVertexArray();
		if (!vertexArray)
			throw new Error("Failed to allocate world-marker vertex array.");
		const vertexBuffer = gl.createBuffer();
		if (!vertexBuffer) {
			gl.deleteVertexArray(vertexArray);
			throw new Error("Failed to allocate world-marker vertex buffer.");
		}
		this.#vertexArray = vertexArray;
		this.#vertexBuffer = vertexBuffer;
		gl.bindVertexArray(vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, createMarkerVertices(), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(MARKER_VERTEX_ATTRIBUTE);
		gl.vertexAttribPointer(MARKER_VERTEX_ATTRIBUTE, 2, gl.FLOAT, false, 0, 0);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		let flatProgram: MarkerProgram | null = null;
		let portalProgram: MarkerProgram | null = null;
		try {
			flatProgram = createMarkerProgram(gl, false);
			portalProgram = createMarkerProgram(gl, true);
		} catch (error) {
			if (flatProgram) gl.deleteProgram(flatProgram.program);
			if (portalProgram) gl.deleteProgram(portalProgram.program);
			gl.deleteBuffer(vertexBuffer);
			gl.deleteVertexArray(vertexArray);
			throw error;
		}
		this.#flatProgram = flatProgram;
		this.#portalProgram = portalProgram;
	}

	draw(
		input: WorldMarkerDrawInput,
		portal: {
			readonly key: string;
			readonly routing: WorldMarkerPortalRouting;
		} | null,
	): void {
		const gl = this.#gl;
		const program = portal ? this.#portalProgram : this.#flatProgram;
		gl.useProgram(program.program);
		gl.uniformMatrix4fv(
			program.uniforms.clipFromAnchor,
			false,
			mat4ToFloat32Array(input.clipFromAnchor, this.#matrix),
		);
		gl.uniform3f(
			program.uniforms.center,
			input.center.x,
			input.center.y,
			input.center.z,
		);
		gl.uniform3f(
			program.uniforms.normal,
			input.normal[0],
			input.normal[1],
			input.normal[2],
		);
		gl.uniform1f(program.uniforms.radius, input.radius);
		gl.uniform4f(program.uniforms.color, ...input.color);
		if (portal) {
			if (!program.portal)
				throw new Error(
					"Portal world-marker program has no visibility uniforms.",
				);
			portal.routing.routeDeferredSubmission(portal.key, program.portal);
		}
		gl.enable(gl.DEPTH_TEST);
		gl.depthMask(false);
		gl.disable(gl.CULL_FACE);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.bindVertexArray(this.#vertexArray);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, VERTEX_COUNT);
		gl.bindVertexArray(null);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
	}

	destroy(): void {
		this.#gl.deleteProgram(this.#flatProgram.program);
		this.#gl.deleteProgram(this.#portalProgram.program);
		this.#gl.deleteBuffer(this.#vertexBuffer);
		this.#gl.deleteVertexArray(this.#vertexArray);
	}
}

function createMarkerVertices(): Float32Array {
	const vertices = new Float32Array(VERTEX_COUNT * 2);
	for (let segment = 0; segment <= SEGMENT_COUNT; segment += 1) {
		const angle = (segment * Math.PI * 2) / SEGMENT_COUNT;
		const x = Math.cos(angle);
		const y = Math.sin(angle);
		const offset = segment * 4;
		vertices[offset] = x * 0.72;
		vertices[offset + 1] = y * 0.72;
		vertices[offset + 2] = x;
		vertices[offset + 3] = y;
	}
	return vertices;
}

function createMarkerProgram(
	gl: WebGL2RenderingContext,
	portal: boolean,
): MarkerProgram {
	const vertex = `#version 300 es
precision highp float;
layout(location = ${MARKER_VERTEX_ATTRIBUTE}) in vec2 aMarkerPosition;
uniform mat4 uMarkerClipFromAnchor;
uniform vec3 uCenter;
uniform vec3 uNormal;
uniform float uRadius;
void main() {
	vec3 normal = normalize(uNormal);
	vec3 reference = abs(normal.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
	vec3 tangent = normalize(cross(reference, normal));
	vec3 bitangent = cross(normal, tangent);
	vec3 point = uCenter + normal * 0.025 + uRadius * (aMarkerPosition.x * tangent + aMarkerPosition.y * bitangent);
	gl_Position = uMarkerClipFromAnchor * vec4(point, 1.0);
}`;
	const fragment = `#version 300 es
precision highp float;
precision highp int;
${portal ? PORTAL_DEFERRED_VISIBILITY_GLSL : ""}
uniform vec4 uColor;
out vec4 outColor;
void main() {
	${portal ? "if (!portalDeferredFragmentVisible()) discard;" : ""}
	outColor = uColor;
}`;
	const program = linkWebGL2Program(gl, "world marker", vertex, fragment);
	return {
		program,
		portal: portal
			? bindWebGL2PortalDeferredVisibilityProgram(gl, program)
			: null,
		uniforms: {
			center: requireWebGL2Uniform(gl, program, "uCenter"),
			clipFromAnchor: requireWebGL2Uniform(
				gl,
				program,
				"uMarkerClipFromAnchor",
			),
			color: requireWebGL2Uniform(gl, program, "uColor"),
			normal: requireWebGL2Uniform(gl, program, "uNormal"),
			radius: requireWebGL2Uniform(gl, program, "uRadius"),
		},
	};
}
