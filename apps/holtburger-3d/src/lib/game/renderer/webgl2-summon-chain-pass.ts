import { scopeKey } from "../scene/scope";
import { createSummonChainLink } from "./summon-chain-geometry";
import type { SummonLeashInput } from "../runtime/summon-presentation";
import type { Mat4, Vec3 } from "../math/types";
import { mat4ToFloat32Array } from "../math/matrices";
import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import {
	bindWebGL2PortalDeferredVisibilityProgram,
	PORTAL_DEFERRED_VISIBILITY_GLSL,
	type WebGL2PortalDeferredVisibilityUniforms,
} from "./portal-deferred-visibility-glsl";
import type { WorldMarkerPortalRouting } from "./webgl2-world-marker-pass";

/** Both programs share geometry and differ only in deferred portal visibility. */
interface ChainProgram {
	readonly handle: WebGLProgram;
	readonly portal: WebGL2PortalDeferredVisibilityUniforms | null;
	readonly matrix: WebGLUniformLocation;
	readonly start: WebGLUniformLocation;
	readonly end: WebGLUniformLocation;
	readonly shape: WebGLUniformLocation;
	readonly color: WebGLUniformLocation;
	readonly shell: WebGLUniformLocation;
}

/** One reusable oval mesh; the vertex shader places alternating links using gl_InstanceID. */
export class WebGL2SummonChainPass {
	readonly #gl: WebGL2RenderingContext;
	readonly #buffer: WebGLBuffer;
	readonly #vao: WebGLVertexArrayObject;
	readonly #flat: ChainProgram;
	readonly #portal: ChainProgram;
	readonly #vertexCount: number;
	readonly #matrix = new Float32Array(16);

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		const vao = gl.createVertexArray();
		if (vao === null)
			throw new Error("Failed to allocate summon chain vertex array.");
		const buffer = gl.createBuffer();
		if (buffer === null) {
			gl.deleteVertexArray(vao);
			throw new Error("Failed to allocate summon chain geometry.");
		}
		this.#vao = vao;
		this.#buffer = buffer;
		const vertices = createSummonChainLink();
		this.#vertexCount = vertices.length / 3;
		let flat: ChainProgram | null = null;
		try {
			gl.bindVertexArray(vao);
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
			gl.bindVertexArray(null);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
			flat = createProgram(gl, false);
			this.#portal = createProgram(gl, true);
			this.#flat = flat;
		} catch (error) {
			if (flat !== null) gl.deleteProgram(flat.handle);
			gl.deleteBuffer(buffer);
			gl.deleteVertexArray(vao);
			throw error;
		}
	}

	draw(
		input: SummonLeashInput,
		anchor: Vec3,
		matrix: Mat4,
		portal: WorldMarkerPortalRouting | null,
	): void {
		const dx = input.end.x - input.start.x;
		const dy = input.end.y - input.start.y;
		const dz = input.end.z - input.start.z;
		const distance = Math.hypot(dx, dy, dz);
		const tuning = input.tuning;
		if (distance <= tuning.linkRadius || distance >= tuning.maximumDistance)
			return;
		const opacity =
			input.color[3] *
			Math.min(1, (tuning.maximumDistance - distance) / tuning.fadeDistance);
		// Sag is deliberately shallow: chord length gives adequate approximate link spacing.
		const count = Math.max(2, Math.ceil(distance / tuning.linkSpacing));
		const gl = this.#gl;
		const program = portal === null ? this.#flat : this.#portal;
		gl.useProgram(program.handle);
		gl.uniformMatrix4fv(
			program.matrix,
			false,
			mat4ToFloat32Array(matrix, this.#matrix),
		);
		gl.uniform3f(
			program.start,
			input.start.x - anchor.x,
			input.start.y - anchor.y,
			input.start.z - anchor.z,
		);
		gl.uniform3f(
			program.end,
			input.end.x - anchor.x,
			input.end.y - anchor.y,
			input.end.z - anchor.z,
		);
		gl.uniform3f(
			program.shape,
			count,
			tuning.linkRadius,
			distance * tuning.sagFraction,
		);
		if (portal !== null) {
			if (program.portal === null)
				throw new Error(
					"Summon chain portal program is missing visibility uniforms.",
				);
			portal.routeDeferredSubmission(
				scopeKey(input.renderScope),
				program.portal,
			);
		}
		gl.enable(gl.DEPTH_TEST);
		gl.depthMask(false);
		gl.disable(gl.CULL_FACE);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
		gl.bindVertexArray(this.#vao);
		gl.uniform1f(program.shell, tuning.glowScale);
		gl.uniform4f(
			program.color,
			input.color[0],
			input.color[1],
			input.color[2],
			opacity * tuning.glowOpacity,
		);
		gl.drawArraysInstanced(gl.TRIANGLES, 0, this.#vertexCount, count);
		gl.uniform1f(program.shell, 1);
		gl.uniform4f(
			program.color,
			input.color[0],
			input.color[1],
			input.color[2],
			opacity,
		);
		gl.drawArraysInstanced(gl.TRIANGLES, 0, this.#vertexCount, count);
		gl.bindVertexArray(null);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
	}

	destroy(): void {
		this.#gl.deleteProgram(this.#flat.handle);
		this.#gl.deleteProgram(this.#portal.handle);
		this.#gl.deleteBuffer(this.#buffer);
		this.#gl.deleteVertexArray(this.#vao);
	}
}

function createProgram(
	gl: WebGL2RenderingContext,
	portal: boolean,
): ChainProgram {
	const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 aVertex;
uniform mat4 uMatrix;
uniform vec3 uStart;
uniform vec3 uEnd;
uniform vec3 uShape;
uniform float uShell;
void main() {
    float t = float(gl_InstanceID) / (uShape.x - 1.0);
    vec3 direction = uEnd - uStart;
    vec3 center = mix(uStart, uEnd, t) - vec3(0.0, 4.0 * uShape.z * t * (1.0 - t), 0.0);
    vec3 derivative = direction - vec3(0.0, 4.0 * uShape.z * (1.0 - 2.0 * t), 0.0);
    vec3 tangent = normalize(dot(derivative, derivative) > 0.000001 ? derivative : direction);
    vec3 reference = abs(normalize(direction).y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 normal = normalize(cross(tangent, reference));
    vec3 binormal = cross(tangent, normal);
    if (gl_InstanceID % 2 == 1) { vec3 previous = normal; normal = binormal; binormal = -previous; }
    vec3 point = center + uShape.y * uShell * (tangent * aVertex.x + normal * aVertex.y + binormal * aVertex.z);
    gl_Position = uMatrix * vec4(point, 1.0);
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
	const handle = linkWebGL2Program(gl, "summon chain", vertex, fragment);
	try {
		return {
			handle,
			portal: portal
				? bindWebGL2PortalDeferredVisibilityProgram(gl, handle)
				: null,
			matrix: requireWebGL2Uniform(gl, handle, "uMatrix"),
			start: requireWebGL2Uniform(gl, handle, "uStart"),
			end: requireWebGL2Uniform(gl, handle, "uEnd"),
			shape: requireWebGL2Uniform(gl, handle, "uShape"),
			color: requireWebGL2Uniform(gl, handle, "uColor"),
			shell: requireWebGL2Uniform(gl, handle, "uShell"),
		};
	} catch (error) {
		gl.deleteProgram(handle);
		throw error;
	}
}
