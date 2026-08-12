import { describe, expect, it } from "vitest";
import { Vec3 } from "../math/types";
import {
	evaluateHostPhysicalCameraSegment,
	MAX_EXTRAPOLATION_FACTOR,
	resolveGroundedWalkVelocity,
	resolvePhysicalCameraViewDirection,
	resolvePhysicalFlyVelocity,
	type HostPhysicalCameraSegment,
} from "./host-physical-camera-path";

function segment(
	overrides: Partial<HostPhysicalCameraSegment> = {},
): HostPhysicalCameraSegment {
	return {
		session: 1,
		sequence: 0,
		mode: "physical-fly",
		residency: {
			envCellId: null,
			landblockId: "0xda55ffff",
		},
		origin: [10, 20, 30],
		velocity: [0, 0, 0],
		horizonMs: 100,
		status: "solved",
		grounded: false,
		constraintCount: 0,
		missingLandblocks: [],
		outsideWorld: false,
		substeps: 1,
		contactPasses: 1,
		solveDurationMs: 0.1,
		...overrides,
	};
}

describe("evaluateHostPhysicalCameraSegment", () => {
	it("converts da55 landblock-local AC motion into canonical scene space", () => {
		const placement = evaluateHostPhysicalCameraSegment(
			segment({
				residency: {
					envCellId: "0xda550103",
					landblockId: "0xda55ffff",
				},
				velocity: [2, 4, 6],
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

	it("bounds extrapolation when the event stream is starved", () => {
		const moving = segment({ velocity: [10, 0, 0] });
		const atCap = evaluateHostPhysicalCameraSegment(
			moving,
			moving.horizonMs * MAX_EXTRAPOLATION_FACTOR,
		);
		const stale = evaluateHostPhysicalCameraSegment(moving, 10_000);
		expect(stale).toEqual(atCap);
	});

	it("does not rewind before the solved origin", () => {
		const origin = evaluateHostPhysicalCameraSegment(
			segment({ velocity: [10, 0, 0] }),
			-1_000,
		);
		expect(origin.position.x).toBe(0xda * 192 + 10);
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

describe("resolvePhysicalCameraViewDirection", () => {
	it("preserves pitch while mapping canonical south back to AC north", () => {
		expect(
			resolvePhysicalCameraViewDirection({
				forward: [0.3, 0.4, -0.5],
				right: [1, 0, 0],
				up: [0, 1, 0],
			}),
		).toEqual([0.3, 0.5, 0.4]);
	});
});

describe("resolveGroundedWalkVelocity", () => {
	it("uses yaw while ignoring camera pitch and vertical input", () => {
		const pitchedBasis = {
			forward: [0, 0.8, -0.6] as const,
			right: [1, 0, 0] as const,
			up: [0, 0.6, 0.8] as const,
		};
		expect(
			resolveGroundedWalkVelocity(
				{ forward: 1, right: 0, up: 1 },
				pitchedBasis,
				4,
			),
		).toEqual([0, 4, 0]);
	});

	it("normalizes diagonal walking input on the horizontal plane", () => {
		const velocity = resolveGroundedWalkVelocity(
			{ forward: 1, right: 1, up: 0 },
			{
				forward: [0, 0, -1],
				right: [1, 0, 0],
				up: [0, 1, 0],
			},
			4,
		);
		expect(Math.hypot(...velocity)).toBeCloseTo(4);
		expect(velocity[2]).toBe(0);
	});
});
