import { describe, expect, it } from "vitest";
import { Vec3 } from "../math/types";
import {
	PORTAL_QUERY_EPSILON,
	intersectSegmentPlane,
	pointInTriangulatedAperture,
	signedPlaneDistance,
	type PlanarAperture,
} from "./planar-aperture";

const TRIANGLE: PlanarAperture = {
	indices: new Uint32Array([0, 1, 2]),
	plane: { d: 0, normal: new Vec3(0, 0, 1) },
	vertices: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
};

describe("planar aperture queries", () => {
	it("retains authored signed plane side", () => {
		expect(signedPlaneDistance(TRIANGLE.plane, new Vec3(0, 0, 3))).toBe(3);
		expect(signedPlaneDistance(TRIANGLE.plane, new Vec3(0, 0, -3))).toBe(-3);
	});

	it("returns forward segment intersection and coplanar provenance", () => {
		expect(
			intersectSegmentPlane(
				new Vec3(0, 0, 2),
				new Vec3(0, 0, -2),
				TRIANGLE.plane,
			),
		).toEqual({
			kind: "point",
			point: Vec3.zero(),
			t: 0.5,
		});
		expect(
			intersectSegmentPlane(
				new Vec3(0, 0, 0),
				new Vec3(1, 0, 0),
				TRIANGLE.plane,
			),
		).toEqual({ kind: "coplanar" });
	});

	it("accepts arbitrary triangle interiors and epsilon-close edges", () => {
		expect(pointInTriangulatedAperture(new Vec3(0.5, 0.5, 0), TRIANGLE)).toBe(
			true,
		);
		expect(
			pointInTriangulatedAperture(
				new Vec3(1, 1 + PORTAL_QUERY_EPSILON * 0.5, 0),
				TRIANGLE,
			),
		).toBe(true);
		expect(
			pointInTriangulatedAperture(
				new Vec3(1, 1 + PORTAL_QUERY_EPSILON * 2, 0),
				TRIANGLE,
			),
		).toBe(false);
	});

	it("rejects points inside the bounds but outside a non-rectangular aperture", () => {
		expect(pointInTriangulatedAperture(new Vec3(1.5, 1.5, 0), TRIANGLE)).toBe(
			false,
		);
	});
});
