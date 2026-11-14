import { describe, expect, it } from "vitest";
import { AABB3, Mat4, Vec3 } from "../math/types";
import { retainsProjectedObjectFootprint } from "./object-footprint";

const base = {
	clipFromAnchor: Mat4.identity(),
	localToLandblock: Mat4.identity(),
	landblockOffsetX: 0,
	landblockOffsetY: 0,
	landblockOffsetZ: 0,
	viewportWidth: 100,
	viewportHeight: 100,
};

describe("object footprint", () => {
	it("accepts a large interior footprint while preserving small and outside rejection", () => {
		expect(
			retainsProjectedObjectFootprint(
				{
					...base,
					bounds: new AABB3(
						new Vec3(-0.5, -0.5, -0.5),
						new Vec3(0.5, 0.5, 0.5),
					),
				},
				64,
			),
		).toBe(true);
		expect(
			retainsProjectedObjectFootprint(
				{
					...base,
					bounds: new AABB3(
						new Vec3(-0.02, -0.02, -0.02),
						new Vec3(0.02, 0.02, 0.02),
					),
				},
				64,
			),
		).toBe(false);
		expect(
			retainsProjectedObjectFootprint(
				{
					...base,
					bounds: new AABB3(new Vec3(3, -0.5, -0.5), new Vec3(4, 0.5, 0.5)),
				},
				64,
			),
		).toBe(false);
	});
});
