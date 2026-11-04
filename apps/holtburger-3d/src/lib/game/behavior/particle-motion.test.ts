import { acVector3, renderVector3 } from "../../assets/ac-frame";
import { describe, expect, it } from "vitest";
import {
	PARTICLE_TYPE,
	particleLifeProgress,
	particlePosition,
	particleScale,
	particleTranslucency,
	type ParticleSpawnConstants,
	type Vector3,
} from "./particle-motion";

const PARENT: Vector3 = renderVector3([10, 20, 30]);

function spawn(
	overrides: Partial<ParticleSpawnConstants> = {},
): ParticleSpawnConstants {
	return {
		a: acVector3([0, 0, 0]),
		b: acVector3([0, 0, 0]),
		c: acVector3([0, 0, 0]),
		finalScale: 1,
		finalTranslucency: 1,
		lifespan: 4,
		offset: acVector3([1, 2, 3]),
		startScale: 1,
		startTranslucency: 0,
		...overrides,
	};
}

/**
 * Every formula is anchored on `parent + acToRender(offset)`.
 *
 * The authored offset `(1, 2, 3)` is AC's x/north/up, so it reaches render axes as `(1, 3, -2)`.
 * Spelling that out once is what makes the axis-sensitive assertions below readable.
 */
const BASE: Vector3 = renderVector3([11, 23, 28]);

describe("particlePosition", () => {
	it("holds a Still particle at parent plus offset for all time", () => {
		expect(particlePosition(PARTICLE_TYPE.still, spawn(), PARENT, 0)).toEqual(
			BASE,
		);
		expect(particlePosition(PARTICLE_TYPE.still, spawn(), PARENT, 99)).toEqual(
			BASE,
		);
	});

	it("advances a velocity particle linearly", () => {
		const constants = spawn({ a: acVector3([1, 2, 3]) });

		// AC displacement (1,2,3) + (1,2,3)*2 = (3,6,9), which reaches render axes as (3, 9, -6).
		expect(
			particlePosition(PARTICLE_TYPE.localVelocity, constants, PARENT, 2),
		).toEqual(renderVector3([13, 29, 24]));
		// The Global variant differs only in how its constants were built, never in arithmetic.
		expect(
			particlePosition(PARTICLE_TYPE.globalVelocity, constants, PARENT, 2),
		).toEqual(renderVector3([13, 29, 24]));
	});

	it("applies half b t squared for every parabolic variant, spin included", () => {
		const constants = spawn({
			a: acVector3([1, 0, 0]),
			b: acVector3([4, 0, 0]),
		});
		const expected = 11 + 1 * 2 + 0.5 * 4 * 4;

		for (const type of [
			PARTICLE_TYPE.parabolicLvga,
			PARTICLE_TYPE.parabolicLvla,
			PARTICLE_TYPE.parabolicGvga,
			PARTICLE_TYPE.parabolicLvgaGr,
			PARTICLE_TYPE.parabolicLvlaLr,
			PARTICLE_TYPE.parabolicGvgaGr,
		]) {
			expect(particlePosition(type, constants, PARENT, 2)![0]).toBeCloseTo(
				expected,
			);
		}
	});

	it("uses sine on AC's y but cosine on AC's x and z for Swarm", () => {
		// The asymmetry is authored, not a transcription slip: proving it stops a later "cleanup".
		const constants = spawn({
			b: acVector3([1, 1, 1]),
			c: acVector3([1, 1, 1]),
		});
		const t = Math.PI / 2;

		const position = particlePosition(
			PARTICLE_TYPE.swarm,
			constants,
			PARENT,
			t,
		)!;

		// cos(pi/2) is 0 and sin(pi/2) is 1. The sine belongs to AC's y, which is the *north* axis,
		// so it must land on render z — negated — and never on render y, which is up. Evaluating
		// this against converted vectors put the sine on up instead.
		expect(position[0]).toBeCloseTo(BASE[0] + Math.cos(t));
		expect(position[1]).toBeCloseTo(BASE[1] + Math.cos(t));
		expect(position[2]).toBeCloseTo(BASE[2] - Math.sin(t));
		expect(position[2] - BASE[2]).toBeCloseTo(-1);
		expect(position[1] - BASE[1]).toBeCloseTo(0);
	});

	it("reproduces both authored Explode quirks exactly", () => {
		// a = (2, 99, 5): if any axis used its own `a` component, y would move with 99.
		const constants = spawn({
			a: acVector3([2, 99, 5]),
			b: acVector3([0, 0, 0]),
			c: acVector3([1, 1, 1]),
		});

		const position = particlePosition(
			PARTICLE_TYPE.explode,
			constants,
			PARENT,
			1,
		)!;

		// Every axis multiplies c by a.x (2), never by its own component.
		expect(position[0]).toBeCloseTo(BASE[0] + 2);
		// AC's z is *up*, so its extra `+ a.z` (5) must reach render y. This is the assertion that
		// fails when the law is evaluated against converted vectors: the upward push lands on the
		// horizontal axis instead, which is a flame drifting sideways rather than rising.
		expect(position[1]).toBeCloseTo(BASE[1] + 2 + 5);
		// AC's y is north, which reaches render z negated and carries no extra term.
		expect(position[2]).toBeCloseTo(BASE[2] - 2);
	});

	it("drives Implode's single cosine from a.x across all three axes", () => {
		const constants = spawn({
			a: acVector3([1, 50, 50]),
			b: acVector3([0, 0, 0]),
			c: acVector3([1, 2, 3]),
		});
		const wave = Math.cos(1 * 2);

		const position = particlePosition(
			PARTICLE_TYPE.implode,
			constants,
			PARENT,
			2,
		)!;

		// Symmetric, so it survives the axis permutation: c reaches render axes as (1, 3, -2).
		expect(position[0]).toBeCloseTo(BASE[0] + wave * 1);
		expect(position[1]).toBeCloseTo(BASE[1] + wave * 3);
		expect(position[2]).toBeCloseTo(BASE[2] - wave * 2);
	});

	it("reports a motion type shipped content never authors", () => {
		// Returning null lets the caller report; a zero vector would render at the world origin.
		expect(
			particlePosition(PARTICLE_TYPE.unknown, spawn(), PARENT, 1),
		).toBeNull();
		expect(particlePosition(42, spawn(), PARENT, 1)).toBeNull();
	});
});

describe("particle life progress", () => {
	it("clamps past the lifespan instead of wrapping", () => {
		const constants = spawn({ lifespan: 4 });

		expect(particleLifeProgress(constants, 2)).toBe(0.5);
		expect(particleLifeProgress(constants, 4)).toBe(1);
		expect(particleLifeProgress(constants, 400)).toBe(1);
	});

	it("treats a zero lifespan as already complete rather than dividing by zero", () => {
		expect(particleLifeProgress(spawn({ lifespan: 0 }), 0)).toBe(1);
	});

	it("interpolates scale and translucency on that same progress", () => {
		const constants = spawn({
			finalScale: 3,
			finalTranslucency: 1,
			lifespan: 4,
			startScale: 1,
			startTranslucency: 0,
		});

		expect(particleScale(constants, 2)).toBeCloseTo(2);
		expect(particleScale(constants, 99)).toBeCloseTo(3);
		expect(particleTranslucency(constants, 2)).toBeCloseTo(0.5);
	});
});
