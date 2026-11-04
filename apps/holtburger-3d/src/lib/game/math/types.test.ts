import { describe, expect, it } from "vitest";
import { AABB3, Vec3 } from "./types";

describe("Vec3", () => {
	it("adds without mutating either operand", () => {
		const left = new Vec3(1, 2, 3);
		const right = new Vec3(4, 5, 6);

		expect(left.add(right)).toEqual(new Vec3(5, 7, 9));
		expect(left).toEqual(new Vec3(1, 2, 3));
		expect(right).toEqual(new Vec3(4, 5, 6));
	});

	it("computes squared distance without a square root", () => {
		expect(new Vec3(1, 2, 3).distanceSquaredTo(new Vec3(4, 6, 3))).toBe(25);
	});
});

describe("AABB3", () => {
	it("unions another bounds in place without mutating it", () => {
		const bounds = new AABB3(new Vec3(-4, 2, -1), new Vec3(3, 6, 8));
		const other = new AABB3(new Vec3(-2, -5, 0), new Vec3(10, 4, 12));

		expect(bounds.union(other)).toBe(bounds);
		expect(bounds).toEqual(
			new AABB3(new Vec3(-4, -5, -1), new Vec3(10, 6, 12)),
		);
		expect(other).toEqual(new AABB3(new Vec3(-2, -5, 0), new Vec3(10, 4, 12)));
	});
});
