import { describe, expect, it, vi } from "vitest";
import { sceneVec3 } from "../../../assets/ac-frame";
import { Mat4, Vec3 } from "../../math/types";
import { WebGL2TransformGizmoPass } from "./webgl2-transform-gizmo-pass";

function createFakeGl() {
	let nextId = 1;
	const createdPrograms: WebGLProgram[] = [];
	const deletedPrograms: WebGLProgram[] = [];
	const deletedBuffers: WebGLBuffer[] = [];
	const deletedArrays: WebGLVertexArrayObject[] = [];
	const disabledCaps: number[] = [];
	const enabledCaps: number[] = [];
	const cullFaceModes: number[] = [];
	const drawCalls: Array<{ first: number; count: number }> = [];
	const colorUniforms: Array<readonly [number, number, number, number]> = [];
	const ringBackAlphas: number[] = [];
	const uniformLocations = new Map<string, WebGLUniformLocation>();

	const gl = {
		ARRAY_BUFFER: 1,
		BACK: 20,
		BLEND: 2,
		COMPILE_STATUS: 4,
		CULL_FACE: 5,
		DEPTH_TEST: 6,
		FLOAT: 7,
		FRAGMENT_SHADER: 8,
		LINK_STATUS: 11,
		ONE_MINUS_SRC_ALPHA: 12,
		SRC_ALPHA: 14,
		STATIC_DRAW: 15,
		TRIANGLES: 23,
		VERTEX_SHADER: 25,
		attachShader: vi.fn(),
		bindBuffer: vi.fn(),
		bindVertexArray: vi.fn(),
		blendFunc: vi.fn(),
		bufferData: vi.fn(),
		compileShader: vi.fn(),
		createBuffer: vi.fn(() => ({ id: nextId++ }) as unknown as WebGLBuffer),
		createProgram: vi.fn(() => {
			const program = { id: nextId++ } as unknown as WebGLProgram;
			createdPrograms.push(program);
			return program;
		}),
		createShader: vi.fn(() => ({ id: nextId++ }) as unknown as WebGLShader),
		createVertexArray: vi.fn(
			() => ({ id: nextId++ }) as unknown as WebGLVertexArrayObject,
		),
		cullFace: vi.fn((mode: number) => cullFaceModes.push(mode)),
		deleteBuffer: vi.fn((buffer: WebGLBuffer) => deletedBuffers.push(buffer)),
		deleteProgram: vi.fn((program: WebGLProgram) =>
			deletedPrograms.push(program),
		),
		deleteShader: vi.fn(),
		deleteVertexArray: vi.fn((array: WebGLVertexArrayObject) =>
			deletedArrays.push(array),
		),
		depthMask: vi.fn(),
		disable: vi.fn((cap: number) => disabledCaps.push(cap)),
		drawArrays: vi.fn((_mode: number, first: number, count: number) => {
			drawCalls.push({ first, count });
		}),
		enable: vi.fn((cap: number) => enabledCaps.push(cap)),
		enableVertexAttribArray: vi.fn(),
		getProgramInfoLog: vi.fn(() => ""),
		getProgramParameter: vi.fn(() => true),
		getShaderInfoLog: vi.fn(() => ""),
		getShaderParameter: vi.fn(() => true),
		getUniformLocation: vi.fn((_program: WebGLProgram, name: string) => {
			let loc = uniformLocations.get(name);
			if (loc === undefined) {
				loc = { name } as unknown as WebGLUniformLocation;
				uniformLocations.set(name, loc);
			}
			return loc;
		}),
		linkProgram: vi.fn(),
		shaderSource: vi.fn(),
		uniform1f: vi.fn((loc: WebGLUniformLocation, value: number) => {
			if (loc === uniformLocations.get("uRingBackAlpha")) {
				ringBackAlphas.push(value);
			}
		}),
		uniform3f: vi.fn(),
		uniform4f: vi.fn(
			(
				loc: WebGLUniformLocation,
				r: number,
				g: number,
				b: number,
				a: number,
			) => {
				if (loc === uniformLocations.get("uColor")) {
					colorUniforms.push([r, g, b, a]);
				}
			},
		),
		uniformMatrix4fv: vi.fn(),
		useProgram: vi.fn(),
		vertexAttribPointer: vi.fn(),
	} as unknown as WebGL2RenderingContext;

	return {
		gl,
		createdPrograms,
		deletedPrograms,
		deletedBuffers,
		deletedArrays,
		disabledCaps,
		enabledCaps,
		cullFaceModes,
		drawCalls,
		colorUniforms,
		ringBackAlphas,
	};
}

describe("WebGL2TransformGizmoPass", () => {
	it("uploads static geometry once, sets BACK culling, draws 7 sub-meshes, and restores GL state", () => {
		const fake = createFakeGl();
		const pass = new WebGL2TransformGizmoPass(fake.gl);

		expect(fake.gl.bufferData).toHaveBeenCalledTimes(1);
		expect(fake.createdPrograms).toHaveLength(1);

		pass.draw(
			{
				position: sceneVec3(new Vec3(1, 2, 3)),
				scale: 1.5,
				hovered: null,
				active: null,
			},
			new Vec3(1, 2, 3),
			new Vec3(1, 3, 10),
			Mat4.identity(),
		);

		// 3 rotate rings + 3 translate arrows + 1 center hub = 7 draw calls, zero extra buffer uploads.
		expect(fake.drawCalls).toHaveLength(7);
		expect(fake.gl.bufferData).toHaveBeenCalledTimes(1);
		expect(fake.cullFaceModes).toEqual([fake.gl.BACK]);
		expect(fake.disabledCaps).toContain(fake.gl.DEPTH_TEST);
		expect(fake.disabledCaps).toContain(fake.gl.CULL_FACE);
		expect(fake.disabledCaps).toContain(fake.gl.BLEND);
		expect(fake.enabledCaps).toContain(fake.gl.DEPTH_TEST);
		// Inactive rings dim back hemisphere (< 1.0), arrows and hub stay 1.0.
		expect(fake.ringBackAlphas.filter((a) => a < 1)).toHaveLength(3);

		pass.destroy();
		expect(fake.deletedPrograms).toHaveLength(1);
		expect(fake.deletedBuffers).toHaveLength(1);
		expect(fake.deletedArrays).toHaveLength(1);
	});

	it("draws active handle last (above center hub) in yellow with full ring alpha and dimmed peers", () => {
		const fake = createFakeGl();
		const pass = new WebGL2TransformGizmoPass(fake.gl);

		pass.draw(
			{
				position: sceneVec3(new Vec3(0, 0, 0)),
				scale: 2,
				hovered: { kind: "rotate", axis: "z" },
				active: { kind: "rotate", axis: "z" },
			},
			new Vec3(0, 0, 0),
			new Vec3(0, 5, 5),
			Mat4.identity(),
		);

		// Only 2 rings dim their back hemisphere; active rotate ring stays full alpha (1.0).
		expect(fake.ringBackAlphas.filter((a) => a < 1)).toHaveLength(2);
		// Exactly one handle (the active one, drawn last) has full alpha 1.0 and yellow tint.
		const fullAlphaColors = fake.colorUniforms.filter((c) => c[3] === 1.0);
		expect(fullAlphaColors).toHaveLength(1);
		const lastColor = fake.colorUniforms[fake.colorUniforms.length - 1];
		expect(lastColor?.[3]).toBe(1.0);
		expect(lastColor?.[0]).toBeCloseTo(1.0);
		expect(lastColor?.[1]).toBeGreaterThan(0.8);

		pass.destroy();
	});

	it("skips drawing cleanly when scale is non-positive or non-finite", () => {
		const fake = createFakeGl();
		const pass = new WebGL2TransformGizmoPass(fake.gl);
		pass.draw(
			{
				position: sceneVec3(new Vec3(0, 0, 0)),
				scale: 0,
				hovered: null,
				active: null,
			},
			new Vec3(0, 0, 0),
			new Vec3(0, 0, 10),
			Mat4.identity(),
		);
		expect(fake.drawCalls).toHaveLength(0);
		pass.destroy();
	});
});
