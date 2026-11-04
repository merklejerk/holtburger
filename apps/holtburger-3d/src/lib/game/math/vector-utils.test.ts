import { describe, expect, it } from "vitest";
import { Vec3 } from "./types";
import {
	clamp,
	crossVec3,
	normalizeVec3,
	scaleVec3,
	subtractVec3,
} from "./vector-utils";

describe("vector utilities", () => {
	it("performs immutable vector arithmetic", () => {
		const left = new Vec3(2, 3, 5);
		const right = new Vec3(7, 11, 13);

		expect(left.add(right)).toEqual(new Vec3(9, 14, 18));
		expect(subtractVec3(right, left)).toEqual(new Vec3(5, 8, 8));
		expect(scaleVec3(left, 2)).toEqual(new Vec3(4, 6, 10));
		expect(left).toEqual(new Vec3(2, 3, 5));
	});

	it("normalizes directions, computes right-handed crosses, and clamps scalars", () => {
		const normalized = normalizeVec3(new Vec3(3, 0, 4));
		expect(normalized.x).toBeCloseTo(0.6);
		expect(normalized.y).toBe(0);
		expect(normalized.z).toBeCloseTo(0.8);
		expect(crossVec3(new Vec3(1, 0, 0), new Vec3(0, 1, 0))).toEqual(
			new Vec3(0, 0, 1),
		);
		expect(clamp(12, 0, 10)).toBe(10);
		expect(() => normalizeVec3(Vec3.zero())).toThrow("zero-length vector");
	});
});
