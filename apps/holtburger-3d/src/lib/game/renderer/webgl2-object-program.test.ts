import { describe, expect, it } from "vitest";
import {
	createWebGL2ObjectProgram,
	OBJECT_TEXTURE_UNITS,
} from "./webgl2-object-program";

describe("createWebGL2ObjectProgram", () => {
	it("initializes invariant sampler units exactly once for every program variant", () => {
		const fixture = fakeGl();

		createWebGL2ObjectProgram(fixture.gl);
		createWebGL2ObjectProgram(fixture.gl, {
			distanceFog: true,
			transformSource: "attribute",
		});
		createWebGL2ObjectProgram(fixture.gl, { distanceFog: false });
		createWebGL2ObjectProgram(fixture.gl, {
			distanceFog: false,
			transformSource: "attribute",
		});

		expect(fixture.programs).toHaveLength(4);
		for (const program of fixture.programs) {
			expect(
				fixture.samplerAssignments.filter(
					(assignment) => assignment.program === program,
				),
			).toEqual([
				{ name: "uBase", program, unit: OBJECT_TEXTURE_UNITS.base },
				{ name: "uPalette", program, unit: OBJECT_TEXTURE_UNITS.palette },
				{ name: "uDetail", program, unit: OBJECT_TEXTURE_UNITS.detail },
			]);
		}
	});
});

function fakeGl(): {
	readonly gl: WebGL2RenderingContext;
	readonly programs: WebGLProgram[];
	readonly samplerAssignments: Array<{
		readonly name: string;
		readonly program: WebGLProgram;
		readonly unit: number;
	}>;
} {
	const programs: WebGLProgram[] = [];
	const samplerAssignments: Array<{
		name: string;
		program: WebGLProgram;
		unit: number;
	}> = [];
	let activeProgram: WebGLProgram | null = null;
	const gl = {
		COMPILE_STATUS: 1,
		FRAGMENT_SHADER: 2,
		LINK_STATUS: 3,
		VERTEX_SHADER: 4,
		attachShader: () => undefined,
		compileShader: () => undefined,
		createProgram: () => {
			const program = {} as WebGLProgram;
			programs.push(program);
			return program;
		},
		createShader: () => ({}) as WebGLShader,
		deleteProgram: () => undefined,
		deleteShader: () => undefined,
		getProgramInfoLog: () => "",
		getProgramParameter: () => true,
		getShaderInfoLog: () => "",
		getShaderParameter: () => true,
		getUniformLocation: (_program: WebGLProgram, name: string) =>
			({ name }) as unknown as WebGLUniformLocation,
		linkProgram: () => undefined,
		shaderSource: () => undefined,
		uniform1i: (location: { readonly name: string }, unit: number) => {
			if (!activeProgram)
				throw new Error("Sampler initialized without a program.");
			samplerAssignments.push({
				name: location.name,
				program: activeProgram,
				unit,
			});
		},
		useProgram: (program: WebGLProgram) => {
			activeProgram = program;
		},
	} as unknown as WebGL2RenderingContext;
	return { gl, programs, samplerAssignments };
}
