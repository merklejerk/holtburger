import { describe, expect, it, vi } from "vitest";
import type { ParticleDrawCohort } from "../systems/particle-emitter-runtime";
import type { DatAssetId } from "../game-types";
import {
	WebGL2ParticlePass,
	type ParticleDrawGeometry,
} from "./webgl2-particle-pass";

const MESH = "0x01000ff4" as DatAssetId;

function cohort(
	motionType: number,
	particleCount: number,
	hwGfxObjId: DatAssetId = MESH,
): ParticleDrawCohort {
	return {
		hwGfxObjId,
		motionType,
		particles: Array.from({ length: particleCount }, () => ({
			a: [1, 0, 0] as const,
			b: [0, 0, 0] as const,
			birthTime: 0,
			c: [0, 0, 0] as const,
			finalScale: 1,
			finalTranslucency: 1,
			lifespan: 4,
			offset: [0, 0, 0] as const,
			origin: [0, 0, 0] as const,
			startScale: 1,
			startTranslucency: 0,
		})),
	};
}

const GEOMETRY: ParticleDrawGeometry = {
	alphaTest: 0,
	baseTexture: {} as WebGLTexture,
	indexCount: 6,
	indexOffsetBytes: 0,
	lockedAxis: [0, 0, 1],
	materialKind: 0,
	orientation: 1,
	paletteTexture: null,
	vertexArray: {} as WebGLVertexArrayObject,
};

function fakeGl() {
	const draws: number[] = [];
	const intUniforms: Array<[string, number]> = [];
	const gl = {
		ARRAY_BUFFER: 1,
		BLEND: 2,
		COMPILE_STATUS: 3,
		DEPTH_TEST: 4,
		DYNAMIC_DRAW: 5,
		FLOAT: 6,
		FRAGMENT_SHADER: 7,
		LINK_STATUS: 8,
		TEXTURE0: 9,
		TEXTURE1: 10,
		TEXTURE_2D: 11,
		TRIANGLES: 12,
		UNSIGNED_INT: 13,
		VERTEX_SHADER: 14,
		activeTexture: () => undefined,
		attachShader: () => undefined,
		bindBuffer: () => undefined,
		bindTexture: () => undefined,
		bindVertexArray: () => undefined,
		bufferData: () => undefined,
		bufferSubData: () => undefined,
		compileShader: () => undefined,
		createBuffer: () => ({}) as WebGLBuffer,
		createProgram: () => ({}) as WebGLProgram,
		createShader: () => ({}) as WebGLShader,
		deleteBuffer: () => undefined,
		deleteProgram: () => undefined,
		deleteShader: () => undefined,
		depthMask: () => undefined,
		disable: () => undefined,
		drawElementsInstanced: (
			_mode: number,
			_count: number,
			_type: number,
			_offset: number,
			instanceCount: number,
		) => draws.push(instanceCount),
		enable: () => undefined,
		enableVertexAttribArray: () => undefined,
		getProgramInfoLog: () => "",
		getProgramParameter: () => true,
		getShaderInfoLog: () => "",
		getShaderParameter: () => true,
		getUniformLocation: (_p: WebGLProgram, name: string) =>
			({ name }) as unknown as WebGLUniformLocation,
		linkProgram: () => undefined,
		shaderSource: () => undefined,
		uniform1f: () => undefined,
		uniform1i: (location: { name: string }, value: number) =>
			intUniforms.push([location.name, value]),
		uniform3f: () => undefined,
		uniformMatrix4fv: () => undefined,
		useProgram: () => undefined,
		vertexAttribDivisor: () => undefined,
		vertexAttribPointer: () => undefined,
	} as unknown as WebGL2RenderingContext;
	return { draws, gl, intUniforms };
}

const context = (gl: WebGL2RenderingContext) => ({
	cameraPosition: [0, 0, 0] as const,
	clockSeconds: 1,
	gl,
	projection: new Float32Array(16),
	view: new Float32Array(16),
});

describe("WebGL2ParticlePass", () => {
	it("draws one instanced call per cohort", () => {
		const { draws, gl } = fakeGl();
		const pass = new WebGL2ParticlePass(() => GEOMETRY);

		pass.draw(context(gl), [cohort(2, 3), cohort(5, 7)]);

		// One call per cohort regardless of particle count; retail's per-part ceiling is not inherited.
		expect(draws).toEqual([3, 7]);
		expect(pass.getDiagnostics()).toMatchObject({
			drawnCohortCount: 2,
			drawnParticleCount: 10,
		});
	});

	it("binds motion type as a per-cohort constant", () => {
		const { gl, intUniforms } = fakeGl();
		const pass = new WebGL2ParticlePass(() => GEOMETRY);

		pass.draw(context(gl), [cohort(6, 1)]);

		expect(intUniforms).toContainEqual(["uMotionType", 6]);
		expect(intUniforms).toContainEqual(["uOrientation", 1]);
	});

	it("counts a cohort whose mesh is not resident instead of dropping it silently", () => {
		const { draws, gl } = fakeGl();
		const pass = new WebGL2ParticlePass(() => null);

		pass.draw(context(gl), [cohort(2, 4)]);

		expect(draws).toEqual([]);
		expect(pass.getDiagnostics().unresolvedCohortCount).toBe(1);
	});

	it("does not create a program for an empty frame", () => {
		const { gl } = fakeGl();
		const createProgram = vi.spyOn(gl, "createProgram");
		const pass = new WebGL2ParticlePass(() => GEOMETRY);

		pass.draw(context(gl), []);
		pass.draw(context(gl), [cohort(2, 0)]);

		// A scene with no live particles must cost nothing, including no lazy GPU allocation.
		expect(createProgram).not.toHaveBeenCalled();
		expect(pass.getDiagnostics().drawnCohortCount).toBe(0);
	});
});
