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

const PARENT: Vector3 = [10, 20, 30];

function spawn(
	overrides: Partial<ParticleSpawnConstants> = {},
): ParticleSpawnConstants {
	return {
		a: [0, 0, 0],
		b: [0, 0, 0],
		c: [0, 0, 0],
		finalScale: 1,
		finalTranslucency: 1,
		lifespan: 4,
		offset: [1, 2, 3],
		startScale: 1,
		startTranslucency: 0,
		...overrides,
	};
}

/** Every formula is anchored on `parent + offset`; assert that once here. */
const BASE: Vector3 = [11, 22, 33];

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
		const constants = spawn({ a: [1, 2, 3] });

		expect(
			particlePosition(PARTICLE_TYPE.localVelocity, constants, PARENT, 2),
		).toEqual([13, 26, 39]);
		// The Global variant differs only in how its constants were built, never in arithmetic.
		expect(
			particlePosition(PARTICLE_TYPE.globalVelocity, constants, PARENT, 2),
		).toEqual([13, 26, 39]);
	});

	it("applies half b t squared for every parabolic variant, spin included", () => {
		const constants = spawn({ a: [1, 0, 0], b: [4, 0, 0] });
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

	it("uses sine on y but cosine on x and z for Swarm", () => {
		// The asymmetry is authored, not a transcription slip: proving it stops a later "cleanup".
		const constants = spawn({ b: [1, 1, 1], c: [1, 1, 1] });
		const t = Math.PI / 2;

		const position = particlePosition(
			PARTICLE_TYPE.swarm,
			constants,
			PARENT,
			t,
		)!;

		expect(position[0]).toBeCloseTo(11 + Math.cos(t));
		expect(position[1]).toBeCloseTo(22 + Math.sin(t));
		expect(position[2]).toBeCloseTo(33 + Math.cos(t));
		// cos(pi/2) is 0 and sin(pi/2) is 1, so y separates from x and z.
		expect(position[1] - 22).toBeCloseTo(1);
		expect(position[0] - 11).toBeCloseTo(0);
	});

	it("reproduces both authored Explode quirks exactly", () => {
		// a = (2, 99, 5): if any axis used its own `a` component, y would move with 99.
		const constants = spawn({ a: [2, 99, 5], b: [0, 0, 0], c: [1, 1, 1] });

		const position = particlePosition(
			PARTICLE_TYPE.explode,
			constants,
			PARENT,
			1,
		)!;

		// Every axis multiplies c by a.x (2), never by its own component.
		expect(position[0]).toBeCloseTo(11 + 2);
		expect(position[1]).toBeCloseTo(22 + 2);
		// z additionally carries `+ a.z` (5) inside the parenthesis.
		expect(position[2]).toBeCloseTo(33 + 2 + 5);
	});

	it("drives Implode's single cosine from a.x across all three axes", () => {
		const constants = spawn({ a: [1, 50, 50], b: [0, 0, 0], c: [1, 2, 3] });
		const wave = Math.cos(1 * 2);

		const position = particlePosition(
			PARTICLE_TYPE.implode,
			constants,
			PARENT,
			2,
		)!;

		expect(position[0]).toBeCloseTo(11 + wave * 1);
		expect(position[1]).toBeCloseTo(22 + wave * 2);
		expect(position[2]).toBeCloseTo(33 + wave * 3);
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
