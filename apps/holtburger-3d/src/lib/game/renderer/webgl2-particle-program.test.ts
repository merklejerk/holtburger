import { describe, expect, it } from "vitest";
import { PARTICLE_TYPE } from "../behavior/particle-motion";
import {
	createWebGL2ParticleProgram,
	PARTICLE_TEXTURE_UNITS,
} from "./webgl2-particle-program";

describe("createWebGL2ParticleProgram", () => {
	it("binds its invariant sampler units exactly once", () => {
		const fixture = fakeGl();

		const program = createWebGL2ParticleProgram(fixture.gl);

		expect(fixture.samplerAssignments).toEqual([
			{ name: "uBase", unit: PARTICLE_TEXTURE_UNITS.base },
			{ name: "uPalette", unit: PARTICLE_TEXTURE_UNITS.palette },
		]);
		expect(program.uniforms.clockSeconds).toBeDefined();
	});

	it("fails loudly when the program does not link", () => {
		const fixture = fakeGl({ linkStatus: false });

		expect(() => createWebGL2ParticleProgram(fixture.gl)).toThrow(
			"Particle program failed to link",
		);
	});

	it("compiles a motion branch for every shipped particle type", () => {
		const fixture = fakeGl();
		createWebGL2ParticleProgram(fixture.gl);
		const vertexSource = fixture.sources[0] ?? "";

		// The GLSL interpolates PARTICLE_TYPE, so a type added to the CPU evaluator without a
		// matching shader branch shows up here rather than as silently motionless particles.
		const shipped = [
			PARTICLE_TYPE.still,
			PARTICLE_TYPE.localVelocity,
			PARTICLE_TYPE.globalVelocity,
			PARTICLE_TYPE.parabolicLvga,
			PARTICLE_TYPE.parabolicLvgaGr,
			PARTICLE_TYPE.parabolicLvla,
			PARTICLE_TYPE.parabolicLvlaLr,
			PARTICLE_TYPE.parabolicGvga,
			PARTICLE_TYPE.parabolicGvgaGr,
			PARTICLE_TYPE.swarm,
			PARTICLE_TYPE.explode,
			PARTICLE_TYPE.implode,
		];
		for (const type of shipped) {
			expect(vertexSource).toContain(`uMotionType == ${type}`);
		}
	});

	it("compiles 4-tap software bilinear filtering for paletted particle textures", () => {
		const fixture = fakeGl();
		createWebGL2ParticleProgram(fixture.gl);
		const fragmentSource = fixture.sources[1] ?? "";

		expect(fragmentSource).toContain("sampleIndexedPaletteLinear");
		expect(fragmentSource).toContain("paletteIndexAt");
		expect(fragmentSource).toContain("indexedColorAt");
	});
});

function fakeGl(options: { linkStatus?: boolean } = {}): {
	readonly gl: WebGL2RenderingContext;
	readonly sources: string[];
	readonly samplerAssignments: Array<{
		readonly name: string;
		readonly unit: number;
	}>;
} {
	const sources: string[] = [];
	const samplerAssignments: Array<{ name: string; unit: number }> = [];
	const gl = {
		COMPILE_STATUS: 1,
		FRAGMENT_SHADER: 2,
		LINK_STATUS: 3,
		VERTEX_SHADER: 4,
		attachShader: () => undefined,
		compileShader: () => undefined,
		createProgram: () => ({}) as WebGLProgram,
		createShader: () => ({}) as WebGLShader,
		deleteProgram: () => undefined,
		deleteShader: () => undefined,
		getProgramInfoLog: () => "",
		getProgramParameter: () => options.linkStatus ?? true,
		getShaderInfoLog: () => "",
		getShaderParameter: () => true,
		getUniformLocation: (_program: WebGLProgram, name: string) =>
			({ name }) as unknown as WebGLUniformLocation,
		linkProgram: () => undefined,
		shaderSource: (_shader: WebGLShader, source: string) => {
			sources.push(source);
		},
		uniform1i: (location: { readonly name: string }, unit: number) => {
			samplerAssignments.push({ name: location.name, unit });
		},
		useProgram: () => undefined,
	} as unknown as WebGL2RenderingContext;
	return { gl, samplerAssignments, sources };
}
