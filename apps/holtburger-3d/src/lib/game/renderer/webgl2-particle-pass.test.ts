import { acVector3, renderVector3 } from "../../assets/ac-frame";
import { describe, expect, it, vi } from "vitest";
import type { ParticleDrawCohort } from "../systems/particle-system";
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
			a: acVector3([1, 0, 0]),
			b: acVector3([0, 0, 0]),
			birthTime: 0,
			c: acVector3([0, 0, 0]),
			finalScale: 1,
			finalTranslucency: 1,
			lifespan: 4,
			offset: acVector3([0, 0, 0]),
			origin: renderVector3([0, 0, 0]),
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
	lockedAxis: renderVector3([0, 0, 1]),
	// 1 is direct colour in the encoding now shared with the object program.
	materialKind: 1,
	orientation: 1,
	paletteTexture: null,
	palettedClipMap: false,
	rawSurfaceFlags: 0,
	vertexArray: {} as WebGLVertexArrayObject,
};

function fakeGl() {
	const draws: number[] = [];
	const blendFuncs: Array<[number, number]> = [];
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
		ONE: 15,
		ONE_MINUS_SRC_ALPHA: 16,
		SRC_ALPHA: 17,
		activeTexture: () => undefined,
		attachShader: () => undefined,
		bindBuffer: () => undefined,
		bindTexture: () => undefined,
		bindVertexArray: () => undefined,
		blendFunc: (source: number, destination: number) =>
			blendFuncs.push([source, destination]),
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
	return { calls: { blendFuncs }, draws, gl, intUniforms };
}

const context = (gl: WebGL2RenderingContext) => ({
	cameraPosition: renderVector3([0, 0, 0]),
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

	it("selects a blend mode per cohort instead of inheriting one", () => {
		const { calls, gl } = fakeGl();
		const pass = new WebGL2ParticlePass(() => GEOMETRY);

		pass.draw(context(gl), [cohort(2, 1)]);

		// Enabling BLEND without a func leaves whatever the previous pass bound, which renders
		// particles opaque over their own black backing.
		expect(calls.blendFuncs).toHaveLength(1);
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
