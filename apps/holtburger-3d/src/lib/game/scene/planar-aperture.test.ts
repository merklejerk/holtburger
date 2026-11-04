import { describe, expect, it } from "vitest";
import { Vec3 } from "../math/types";
import { signedPlaneDistance } from "./planar-aperture";

describe("planar aperture geometry", () => {
	it("retains authored signed plane side", () => {
		const plane = { d: 0, normal: new Vec3(0, 0, 1) };
		expect(signedPlaneDistance(plane, new Vec3(0, 0, 3))).toBe(3);
		expect(signedPlaneDistance(plane, new Vec3(0, 0, -3))).toBe(-3);
	});
});
