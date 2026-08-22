import { describe, expect, it } from "vitest";

import {
	decodeHostKinematicBoomTick,
	evaluateHostKinematicBoomPath,
	resolveKinematicBoomDirection,
} from "./host-kinematic-boom-path";

const worldPoint = (landblockId: number, x: number) => ({
	landblockId,
	coords: { x, y: 20, z: 3 },
});

const point = (landblockId: number, cameraX: number, pivotX: number) => ({
	position: worldPoint(landblockId, cameraX),
	visualPivot: worldPoint(landblockId, pivotX),
});

function advanced() {
	return {
		kind: "advanced",
		boomGeneration: 4,
		possessionGeneration: 3,
		guid: 0xf0000001,
		entityGeneration: 2,
		sequence: 5,
		targetSphereRole: "upper-constraint",
		effectiveCameraRadius: 0.2,
		desiredReach: 4.5,
		renderedReach: 3.75,
		path: {
			initial: point(0xda55ffff, 10, 20),
			legs: [
				{
					endFraction: 1,
					end: point(0xda550177, 14, 24),
				},
			],
		},
		diagnostics: {
			controlLegs: 1,
			radialCasts: 1,
			transitSubsteps: 2,
			contactPasses: 0,
		},
	} as const;
}

describe("host kinematic boom path", () => {
	it("maps camera-forward input to the opposite pivot-to-camera host direction", () => {
		expect(resolveKinematicBoomDirection([0.3, 0.5, -0.4])).toEqual([
			-0.3, -0.5, 0.4,
		]);
		expect(resolveKinematicBoomDirection([0, -1, 0])).toEqual([0, 1, 0]);
	});

	it("keeps starting residency over the half-open leg and commits the exact endpoint", () => {
		const tick = decodeHostKinematicBoomTick(advanced(), 32);
		if (tick.kind !== "advanced") throw new Error("fixture must advance");

		const middle = evaluateHostKinematicBoomPath(tick.path, 32, 16);
		const endpoint = evaluateHostKinematicBoomPath(tick.path, 32, 32);

		expect(middle.placement.residency).toEqual({
			envCellId: null,
			landblockId: "0xda55ffff",
		});
		expect(endpoint.placement.residency).toEqual({
			envCellId: "0xda550177",
			landblockId: "0xda55ffff",
		});
		expect(
			endpoint.placement.position.x - middle.placement.position.x,
		).toBeCloseTo(2);
		expect(endpoint.visualPivot.x - middle.visualPivot.x).toBeCloseTo(2);
	});

	it("rejects malformed work, radius, and path contracts before presentation", () => {
		expect(() =>
			decodeHostKinematicBoomTick(
				{
					...advanced(),
					effectiveCameraRadius: 0.3,
					desiredReach: 4.5,
					renderedReach: 3.75,
				},
				32,
			),
		).toThrow();
		expect(() =>
			decodeHostKinematicBoomTick(
				{
					...advanced(),
					path: { ...advanced().path, legs: [] },
				},
				32,
			),
		).toThrow();
		expect(() =>
			decodeHostKinematicBoomTick(
				{
					...advanced(),
					diagnostics: {
						...advanced().diagnostics,
						contactPasses: -1,
					},
				},
				32,
			),
		).toThrow();
	});

	it("accepts only a zero-reach stationary reseed path", () => {
		const stationary = point(0xda550178, 12, 18);
		const value = {
			...advanced(),
			kind: "reseeded",
			renderedReach: 0,
			reason: "placement-recovery",
			path: {
				initial: stationary,
				legs: [{ endFraction: 1, end: stationary }],
			},
		};
		expect(decodeHostKinematicBoomTick(value, 32).kind).toBe("reseeded");
		expect(() =>
			decodeHostKinematicBoomTick({ ...value, renderedReach: 0.1 }, 32),
		).toThrow();
		expect(() =>
			decodeHostKinematicBoomTick(
				{
					...value,
					path: {
						...value.path,
						legs: [
							{
								endFraction: 1,
								end: point(0xda550178, 13, 18),
							},
						],
					},
				},
				32,
			),
		).toThrow("must remain at its initial placement");
	});
});
