import { describe, expect, it } from "vitest";
import { Vec3 } from "./types";

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
