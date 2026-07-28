import { describe, expect, it } from "vitest";
import { Quat, Vec3 } from "../math/types";
import type { Camera } from "../runtime/types";
import type { PlanarAperture } from "../scene/planar-aperture";
import {
	cameraNearPlaneIntersectsAperture,
	createCameraNearPlaneQuad,
	triangulatedPlanarAperturesIntersect,
} from "./portal-near-plane";

const CAMERA: Camera = {
	far: 100,
	fov: 90,
	near: 1,
	placement: {
		envCellId: null,
		landblockId: "0x0000ffff",
		position: Vec3.zero(),
		rotation: Quat.identity(),
	},
};

describe("finite portal near-plane intersection", () => {
	it("constructs the exact finite quad from active projection facts", () => {
		const near = createCameraNearPlaneQuad(CAMERA, 2);

		const expected = [
			new Vec3(-2, -1, -1),
			new Vec3(2, -1, -1),
			new Vec3(2, 1, -1),
			new Vec3(-2, 1, -1),
		];
		for (const [index, corner] of near.corners.entries()) {
			expect(corner.x).toBeCloseTo(expected[index]!.x);
			expect(corner.y).toBeCloseTo(expected[index]!.y);
			expect(corner.z).toBeCloseTo(expected[index]!.z);
		}
		expect(near.aperture.plane.normal).toEqual(new Vec3(0, 0, -1));
		expect(near.aperture.plane.d).toBeCloseTo(-1);
	});

	it("accepts crossings through actual aperture triangles", () => {
		const near = createCameraNearPlaneQuad(CAMERA, 1);
		const crossing = triangleAperture(
			[new Vec3(-0.5, 0, -2), new Vec3(0.5, 0, 0), new Vec3(0, 1, -2)],
			new Vec3(0, -1, 0),
			0,
		);

		expect(cameraNearPlaneIntersectsAperture(near, crossing)).toBe(true);
	});

	it("rejects plane intersections outside the finite aperture", () => {
		const near = createCameraNearPlaneQuad(CAMERA, 1);
		const outside = triangleAperture(
			[new Vec3(3, 0, -2), new Vec3(4, 0, 0), new Vec3(3, 1, -2)],
			new Vec3(0, -1, 0),
			0,
		);

		expect(cameraNearPlaneIntersectsAperture(near, outside)).toBe(false);
	});

	it("treats exact edges and coplanar overlap as renderer straddles", () => {
		const near = createCameraNearPlaneQuad(CAMERA, 1);
		const edgeTouch = triangleAperture(
			[new Vec3(1, -0.5, -1), new Vec3(2, 0, -1), new Vec3(1, 0.5, -1)],
			new Vec3(0, 0, -1),
			-1,
		);
		const crossingEdgesOnly = triangleAperture(
			[new Vec3(-2, -0.1, -1), new Vec3(2, -0.1, -1), new Vec3(0, 0.1, -1)],
			new Vec3(0, 0, -1),
			-1,
		);

		expect(triangulatedPlanarAperturesIntersect(near.aperture, edgeTouch)).toBe(
			true,
		);
		expect(
			triangulatedPlanarAperturesIntersect(near.aperture, crossingEdgesOnly),
		).toBe(true);
	});

	it("handles rotated cameras without reducing the quad to an AABB", () => {
		const halfYaw = Math.PI / 4;
		const near = createCameraNearPlaneQuad(
			{
				...CAMERA,
				placement: {
					...CAMERA.placement,
					rotation: new Quat(Math.cos(halfYaw), 0, Math.sin(halfYaw), 0),
				},
			},
			1,
		);
		const aperture = triangleAperture(
			[
				new Vec3(-1, -0.5, -0.25),
				new Vec3(-1, 0.5, 0.25),
				new Vec3(-1, 0, -0.25),
			],
			new Vec3(1, 0, 0),
			1,
		);

		expect(cameraNearPlaneIntersectsAperture(near, aperture)).toBe(true);
	});

	it("rejects invalid projection facts loudly", () => {
		expect(() => createCameraNearPlaneQuad({ ...CAMERA, near: 0 }, 1)).toThrow(
			"projection facts",
		);
	});
});

function triangleAperture(
	points: readonly [Vec3, Vec3, Vec3],
	normal: Vec3,
	d: number,
): PlanarAperture {
	return {
		indices: new Uint32Array([0, 1, 2]),
		plane: { d, normal },
		vertices: new Float32Array(
			points.flatMap((point) => [point.x, point.y, point.z]),
		),
	};
}
