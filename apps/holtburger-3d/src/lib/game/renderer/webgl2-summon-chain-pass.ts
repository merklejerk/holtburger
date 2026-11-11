import { createSummonChainLink } from "./summon-chain-geometry";
import type { SummonLeashInput } from "../runtime/summon-presentation";
import type { Mat4, Vec3 } from "../math/types";
import { mat4ToFloat32Array } from "../math/matrices";
import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../webgl/shader-program";

/** Uniforms for the depth-tested procedural chain. */
interface ChainProgram {
	readonly handle: WebGLProgram;
	readonly matrix: WebGLUniformLocation;
	readonly start: WebGLUniformLocation;
	readonly end: WebGLUniformLocation;
	readonly shape: WebGLUniformLocation;
	readonly color: WebGLUniformLocation;
	readonly shell: WebGLUniformLocation;
	readonly startBounds: WebGLUniformLocation;
	readonly endBounds: WebGLUniformLocation;
	readonly motion: WebGLUniformLocation;
	readonly pulse: WebGLUniformLocation;
	readonly fadePower: WebGLUniformLocation;
}

/** One reusable oval mesh; the vertex shader places alternating links using gl_InstanceID. */
export class WebGL2SummonChainPass {
	readonly #gl: WebGL2RenderingContext;
	readonly #buffer: WebGLBuffer;
	readonly #vao: WebGLVertexArrayObject;
	readonly #program: ChainProgram;
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
		try {
			gl.bindVertexArray(vao);
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
			gl.bindVertexArray(null);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
			this.#program = createProgram(gl);
		} catch (error) {
			gl.deleteBuffer(buffer);
			gl.deleteVertexArray(vao);
			throw error;
		}
	}

	draw(input: SummonLeashInput, anchor: Vec3, matrix: Mat4): void {
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
		const program = this.#program;
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
			tuning.linkSpacing,
			tuning.linkRadius,
			distance * tuning.sagFraction,
		);
		gl.uniform3f(
			program.startBounds,
			input.startHalfExtents.x,
			input.startHalfExtents.y,
			input.startHalfExtents.z,
		);
		gl.uniform3f(
			program.endBounds,
			input.endHalfExtents.x,
			input.endHalfExtents.y,
			input.endHalfExtents.z,
		);
		// Wrap on the CPU to preserve sub-second motion precision over long sessions.
		gl.uniform2f(
			program.motion,
			tuning.swayAmplitude,
			((input.timeSeconds * tuning.swayHertz) % 1) * Math.PI * 2,
		);
		gl.uniform3f(
			program.pulse,
			((input.timeSeconds * tuning.pulseHertz) % 1) * Math.PI * 2,
			tuning.pulseWavelength,
			tuning.pulseStrength,
		);
		gl.uniform1f(program.fadePower, tuning.endpointFadePower);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
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
		this.#gl.deleteProgram(this.#program.handle);
		this.#gl.deleteBuffer(this.#buffer);
		this.#gl.deleteVertexArray(this.#vao);
	}
}

function createProgram(gl: WebGL2RenderingContext): ChainProgram {
	const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 aVertex;
uniform mat4 uMatrix;
uniform vec3 uStart;
uniform vec3 uEnd;
uniform vec3 uShape;
uniform float uShell;
uniform vec2 uMotion;
out vec3 vPoint;
flat out float vTerminalFade;
void main() {
    vec3 direction = uEnd - uStart;
    float distance = length(direction);
    // Fixed spacing keeps existing links stationary when endpoint motion changes the instance count.
    float along = float(gl_InstanceID) * uShape.x;
    float t = min(along / distance, 1.0);
    // A new terminal link starts invisible rather than popping in at a count threshold.
    vTerminalFade = smoothstep(0.0, uShape.y, distance - along);
    vec3 chord = normalize(direction);
    vec3 reference = abs(chord.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 lateral = normalize(cross(chord, reference));
    // Fixed endpoints; a shallow standing wave keeps the chain alive even at rest.
    float wave = sin(uMotion.y + t * 3.14159265);
    float envelope = sin(t * 3.14159265);
    vec3 sway = lateral * uMotion.x * envelope * wave;
    vec3 swayDerivative = lateral * uMotion.x * 3.14159265 * (cos(t * 3.14159265) * wave + envelope * cos(uMotion.y + t * 3.14159265));
    vec3 center = mix(uStart, uEnd, t) - vec3(0.0, 4.0 * uShape.z * t * (1.0 - t), 0.0) + sway;
    vec3 derivative = direction - vec3(0.0, 4.0 * uShape.z * (1.0 - 2.0 * t), 0.0) + swayDerivative;
    vec3 tangent = normalize(dot(derivative, derivative) > 0.000001 ? derivative : direction);
    vec3 normal = normalize(cross(tangent, reference));
    vec3 binormal = cross(tangent, normal);
    if (gl_InstanceID % 2 == 1) { vec3 previous = normal; normal = binormal; binormal = -previous; }
    vec3 point = center + uShape.y * uShell * (tangent * aVertex.x + normal * aVertex.y + binormal * aVertex.z);
    vPoint = point;
    gl_Position = uMatrix * vec4(point, 1.0);
}`;
	const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform vec4 uColor;
uniform vec3 uStart;
uniform vec3 uEnd;
uniform vec3 uStartBounds;
uniform vec3 uEndBounds;
uniform vec3 uPulse;
uniform vec3 uShape;
uniform float uFadePower;
in vec3 vPoint;
flat in float vTerminalFade;
out vec4 outColor;
float bodyFade(vec3 offset, vec3 halfSize) {
    // Collapsed bounds still fade over a tiny, finite interval.
    vec3 relative = abs(offset) / max(halfSize, vec3(0.0001));
    return pow(smoothstep(0.0, 1.0, max(relative.x, max(relative.y, relative.z))), uFadePower);
}
void main() {
    vec3 chord = normalize(uEnd - uStart);
    // Oval geometry extends beyond its centre; trim the terminal overhang.
    float fromStart = dot(vPoint - uStart, chord);
    float fromEnd = dot(uEnd - vPoint, chord);
    if (fromStart <= 0.0 || fromEnd <= 0.0) discard;
    float fade = bodyFade(vPoint - uStart, uStartBounds) * bodyFade(vPoint - uEnd, uEndBounds);
    float crest = pow(0.5 + 0.5 * cos(6.2831853 * fromEnd / uPulse.y - uPulse.x), 4.0);
    fade *= smoothstep(0.0, uShape.y, fromStart) * smoothstep(0.0, uShape.y, fromEnd);
    // Modulate the additive contribution, preserving saturated theme RGB before blending.
    outColor = vec4(uColor.rgb, uColor.a * (1.0 + uPulse.z * crest) * fade * vTerminalFade);
}`;
	const handle = linkWebGL2Program(gl, "summon chain", vertex, fragment);
	try {
		return {
			handle,
			matrix: requireWebGL2Uniform(gl, handle, "uMatrix"),
			start: requireWebGL2Uniform(gl, handle, "uStart"),
			end: requireWebGL2Uniform(gl, handle, "uEnd"),
			shape: requireWebGL2Uniform(gl, handle, "uShape"),
			color: requireWebGL2Uniform(gl, handle, "uColor"),
			shell: requireWebGL2Uniform(gl, handle, "uShell"),
			startBounds: requireWebGL2Uniform(gl, handle, "uStartBounds"),
			endBounds: requireWebGL2Uniform(gl, handle, "uEndBounds"),
			motion: requireWebGL2Uniform(gl, handle, "uMotion"),
			pulse: requireWebGL2Uniform(gl, handle, "uPulse"),
			fadePower: requireWebGL2Uniform(gl, handle, "uFadePower"),
		};
	} catch (error) {
		gl.deleteProgram(handle);
		throw error;
	}
}
