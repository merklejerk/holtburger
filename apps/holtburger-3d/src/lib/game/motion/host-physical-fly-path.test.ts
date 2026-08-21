import { describe, expect, it } from "vitest";
import { Vec3 } from "../math/types";
import {
	evaluateHostPhysicalFlyPath,
	resolvePhysicalFlyViewDirection,
	resolvePhysicalFlyVelocity,
	resolvePhysicalFlyWheelDisplacement,
	type HostPhysicalFlyPath,
} from "./host-physical-fly-path";

function path(
	overrides: Partial<HostPhysicalFlyPath> = {},
): HostPhysicalFlyPath {
	return {
		session: 1,
		sequence: 0,
		durationMs: 100,
		initial: {
			residency: {
				envCellId: null,
				landblockId: "0xda55ffff",
			},
			origin: [10, 20, 30],
		},
		legs: [
			{
				endFraction: 1,
				end: {
					residency: {
						envCellId: null,
						landblockId: "0xda55ffff",
					},
					origin: [10, 20, 30],
				},
			},
		],
		status: "solved",
		sceneResidency: { state: "resident" },
		groundState: "airborne",
		constraintCount: 0,
		substeps: 1,
		contactPasses: 1,
		solveDurationMs: 0.1,
		...overrides,
	};
}

describe("evaluateHostPhysicalFlyPath", () => {
	it("interpolates da55 landblock-local AC motion in canonical scene space", () => {
		const placement = evaluateHostPhysicalFlyPath(
			path({
				initial: {
					residency: {
						envCellId: "0xda550103",
						landblockId: "0xda55ffff",
					},
					origin: [10, 20, 30],
				},
				legs: [
					{
						endFraction: 1,
						end: {
							residency: {
								envCellId: "0xda550103",
								landblockId: "0xda55ffff",
							},
							origin: [10.2, 20.4, 30.6],
						},
					},
				],
			}),
			50,
		);
		expect(placement.position).toEqual(
			new Vec3(0xda * 192 + 10.1, 30.3, -(0x55 * 192 + 20.2)),
		);
		expect(placement.residency).toEqual({
			envCellId: "0xda550103",
			landblockId: "0xda55ffff",
		});
	});

	it("switches residency atomically at a host-supplied thin-cell boundary", () => {
		const crossing = path({
			legs: [
				{
					endFraction: 0.25,
					end: {
						residency: {
							envCellId: "0xda55010b",
							landblockId: "0xda55ffff",
						},
						origin: [10.25, 20, 30],
					},
				},
				{
					endFraction: 0.75,
					end: {
						residency: {
							envCellId: null,
							landblockId: "0xda55ffff",
						},
						origin: [10.75, 20, 30],
					},
				},
				{
					endFraction: 1,
					end: {
						residency: {
							envCellId: null,
							landblockId: "0xda55ffff",
						},
						origin: [11, 20, 30],
					},
				},
			],
		});
		expect(evaluateHostPhysicalFlyPath(crossing, 24.999).residency).toEqual({
			envCellId: null,
			landblockId: "0xda55ffff",
		});
		expect(evaluateHostPhysicalFlyPath(crossing, 25).residency).toEqual({
			envCellId: "0xda55010b",
			landblockId: "0xda55ffff",
		});
		expect(evaluateHostPhysicalFlyPath(crossing, 75).residency).toEqual({
			envCellId: null,
			landblockId: "0xda55ffff",
		});
	});

	it("holds exact endpoints during starvation and never rewinds", () => {
		const moving = path({
			legs: [
				{
					endFraction: 1,
					end: {
						residency: {
							envCellId: null,
							landblockId: "0xdb55ffff",
						},
						origin: [1, 20, 30],
					},
				},
			],
		});
		expect(evaluateHostPhysicalFlyPath(moving, -1_000).position.x).toBe(
			0xda * 192 + 10,
		);
		expect(evaluateHostPhysicalFlyPath(moving, 10_000)).toEqual(
			evaluateHostPhysicalFlyPath(moving, 100),
		);
	});

	it("rejects malformed paths before presentation", () => {
		expect(() =>
			evaluateHostPhysicalFlyPath(path({ durationMs: 0 }), 0),
		).toThrow("duration");
		expect(() =>
			evaluateHostPhysicalFlyPath(
				path({
					legs: [
						{
							endFraction: 0.5,
							end: path().initial,
						},
					],
				}),
				0,
			),
		).toThrow("end at tick fraction one");
	});
});

describe("resolvePhysicalFlyVelocity", () => {
	const basis = {
		forward: [0, 0, -1] as const,
		right: [1, 0, 0] as const,
		up: [0, 1, 0] as const,
	};

	it("maps scene north and up onto AC north and up", () => {
		expect(
			resolvePhysicalFlyVelocity({ forward: 1, right: 0, up: 0 }, basis, 12),
		).toEqual([0, 12, 0]);
		expect(
			resolvePhysicalFlyVelocity({ forward: 0, right: 0, up: 1 }, basis, 12),
		).toEqual([0, 0, 12]);
	});

	it("normalizes diagonal input", () => {
		const velocity = resolvePhysicalFlyVelocity(
			{ forward: 1, right: 1, up: 0 },
			basis,
			10,
		);
		expect(Math.hypot(...velocity)).toBeCloseTo(10);
	});
});

describe("resolvePhysicalFlyWheelDisplacement", () => {
	it("preserves wheel distance along the pitched local-up axis", () => {
		const displacement = resolvePhysicalFlyWheelDisplacement(
			{
				forward: [0, 0.8, -0.6],
				right: [1, 0, 0],
				up: [0, 0.6, 0.8],
			},
			5,
		);

		expect(displacement).toEqual([0, -4, 3]);
		expect(Math.hypot(...displacement)).toBe(5);
	});
});

describe("resolvePhysicalFlyViewDirection", () => {
	it("preserves pitch while mapping canonical south back to AC north", () => {
		expect(
			resolvePhysicalFlyViewDirection({
				forward: [0.3, 0.4, -0.5],
				right: [1, 0, 0],
				up: [0, 1, 0],
			}),
		).toEqual([0.3, 0.5, 0.4]);
	});
});
