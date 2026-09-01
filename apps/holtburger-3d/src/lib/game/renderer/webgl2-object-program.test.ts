import { describe, expect, it } from "vitest";
import {
	createObjectFragmentShader,
	createObjectVertexShader,
	createWebGL2ObjectProgram,
	OBJECT_TEXTURE_UNITS,
} from "./webgl2-object-program";
import { MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER } from "./entity-shadow-policy";

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

describe("outdoor PSSM object variant", () => {
	it("keeps the ordinary program free of receiver work", () => {
		const source = `${createObjectVertexShader(true)}\n${createObjectFragmentShader(true)}`;
		expect(source).not.toContain("uOutdoorPssmDepth");
		expect(source).not.toContain("vLightingWithoutSun");
		expect(source).toContain("color.rgb *= min(vLighting +");
	});

	it("samples per fragment and blends only between full and sun-removed lighting", () => {
		const vertex = createObjectVertexShader(true, "uniform", true);
		const fragment = createObjectFragmentShader(true, true);
		expect(vertex).toContain("vLightingWithoutSun = min(lightingWithoutSun");
		expect(vertex).toContain(
			"vLighting = min(lightingWithoutSun + evaluateSun",
		);
		expect(vertex).toContain("vOutdoorPssmViewDepth = -viewPosition.z");
		expect(fragment).toContain("evaluateOutdoorPssmVisibility(");
		expect(fragment).toContain(
			"mix(\n\t\tvLightingWithoutSun,\n\t\tvLighting,",
		);
		expect(fragment).not.toContain("vLighting * evaluateOutdoorPssmVisibility");
	});
});

describe("EnvCell grounding object variant", () => {
	it("keeps ordinary and instanced programs free of grounding work", () => {
		const source = `${createObjectVertexShader(true)}\n${createObjectFragmentShader(true)}`;
		expect(source).not.toContain("uGroundingCasterCount");
		expect(source).not.toContain("vGroundingPosition");
	});

	it("carries shell receiver facts and applies grounding after detail but before fog", () => {
		const vertex = createObjectVertexShader(
			true,
			"uniform",
			false,
			"env-cell-shell",
		);
		const fragment = createObjectFragmentShader(true, false, "env-cell-shell");
		expect(vertex).toContain("vGroundingPosition = anchoredPosition");
		expect(vertex).toContain("vGroundingUpFacing = dot(");
		expect(fragment).toContain(
			`MAX_ENTITY_GROUNDING_CASTERS = ${MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER}`,
		);
		expect(fragment).toContain(
			"uGroundingCasters[MAX_ENTITY_GROUNDING_CASTERS]",
		);
		expect(fragment).toContain(
			"strongest = max(strongest, radial * (1.0 - dropRatio));",
		);
		expect(
			fragment.indexOf("color.rgb *= 1.0 - evaluateEntityGrounding"),
		).toBeGreaterThan(fragment.indexOf("if (uUseDetail != 0)"));
		expect(
			fragment.indexOf("color.rgb *= 1.0 - evaluateEntityGrounding"),
		).toBeLessThan(fragment.indexOf("color.rgb = applyDistanceFog"));
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
