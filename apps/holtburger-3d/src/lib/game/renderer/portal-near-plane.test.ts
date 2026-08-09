import { sceneVec3 } from "../../assets/ac-frame";
import { describe, expect, it } from "vitest";
import { Mat4, Quat, Vec3 } from "../math/types";
import type { Camera } from "../runtime/types";
import type { PlanarAperture } from "../scene/planar-aperture";
import {
	apertureIntersectsCameraNearClipVolume,
	createCameraNearClipVolume,
} from "./portal-near-plane";
import { preparePortalApertureProjectionInput } from "./portal-view-window";
import { PortalWindowArena } from "./portal-window-arena";

const CAMERA: Camera = {
	far: 100,
	fov: 90,
	near: 1,
	placement: {
		envCellId: null,
		landblockId: "0x0000ffff",
		position: sceneVec3(Vec3.zero()),
		rotation: Quat.identity(),
	},
};

describe("finite portal near-clip-volume intersection", () => {
	it("constructs the exact finite quad from active projection facts", () => {
		const near = createCameraNearClipVolume(CAMERA, CAMERA.placement, 2);

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
		expect(near.clippingPlanes[0].normal.x).toBeCloseTo(0);
		expect(near.clippingPlanes[0].normal.y).toBeCloseTo(0);
		expect(near.clippingPlanes[0].normal.z).toBeCloseTo(-1);
		expect(near.clippingPlanes[0].d).toBeCloseTo(-1);
	});

	it("accepts crossings through actual aperture triangles", () => {
		const near = createCameraNearClipVolume(CAMERA, CAMERA.placement, 1);
		const crossing = triangleAperture(
			[new Vec3(-0.5, 0, -2), new Vec3(0.5, 0, 0), new Vec3(0, 1, -2)],
			new Vec3(0, -1, 0),
			0,
		);

		expect(apertureIntersectsCameraNearClipVolume(near, crossing)).toBe(true);
	});

	it("rejects plane intersections outside the finite aperture", () => {
		const near = createCameraNearClipVolume(CAMERA, CAMERA.placement, 1);
		const outside = triangleAperture(
			[new Vec3(3, 0, -2), new Vec3(4, 0, 0), new Vec3(3, 1, -2)],
			new Vec3(0, -1, 0),
			0,
		);

		expect(apertureIntersectsCameraNearClipVolume(near, outside)).toBe(false);
	});

	it("accepts apertures inside the clipped volume without requiring cap contact", () => {
		const near = createCameraNearClipVolume(CAMERA, CAMERA.placement, 1);
		const faceOn = triangleAperture(
			[
				new Vec3(-0.25, -0.25, -0.5),
				new Vec3(0.25, -0.25, -0.5),
				new Vec3(0, 0.25, -0.5),
			],
			new Vec3(0, 0, 1),
			0.5,
		);
		const oblique = triangleAperture(
			[
				new Vec3(0.2, -0.1, -0.2),
				new Vec3(0.2, 0.1, -0.2),
				new Vec3(0.2, 0, -0.8),
			],
			new Vec3(1, 0, 0),
			-0.2,
		);

		expect(apertureIntersectsCameraNearClipVolume(near, faceOn)).toBe(true);
		expect(apertureIntersectsCameraNearClipVolume(near, oblique)).toBe(true);
	});

	it("rejects apertures beyond the near cap", () => {
		const near = createCameraNearClipVolume(CAMERA, CAMERA.placement, 1);
		const beyondCap = triangleAperture(
			[
				new Vec3(-0.2, -0.2, -1.5),
				new Vec3(0.2, -0.2, -1.5),
				new Vec3(0, 0.2, -1.5),
			],
			new Vec3(0, 0, 1),
			1.5,
		);

		expect(apertureIntersectsCameraNearClipVolume(near, beyondCap)).toBe(false);
	});

	it("treats exact cap edges and coplanar overlap as renderer straddles", () => {
		const near = createCameraNearClipVolume(CAMERA, CAMERA.placement, 1);
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

		expect(apertureIntersectsCameraNearClipVolume(near, edgeTouch)).toBe(true);
		expect(
			apertureIntersectsCameraNearClipVolume(near, crossingEdgesOnly),
		).toBe(true);
	});

	it("does not manufacture a straddle while clipping across the contact band", () => {
		const near = createCameraNearClipVolume(CAMERA, CAMERA.placement, 1);
		const grazingOutside = triangleApertureFromPoints([
			new Vec3(1.000_483_8, -0.000_148_9, -1.000_195_4),
			new Vec3(1.000_297_3, -0.000_958_2, -0.999_950_4),
			new Vec3(1.000_497_8, 0.000_285_4, -1.000_201_7),
		]);

		expect(apertureIntersectsCameraNearClipVolume(near, grazingOutside)).toBe(
			false,
		);
	});

	it("handles rotated cameras without reducing the quad to an AABB", () => {
		const halfYaw = Math.PI / 4;
		const near = createCameraNearClipVolume(
			CAMERA,
			{
				position: CAMERA.placement.position,
				rotation: new Quat(Math.cos(halfYaw), 0, Math.sin(halfYaw), 0),
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

		expect(apertureIntersectsCameraNearClipVolume(near, aperture)).toBe(true);
	});

	it("constructs clip planes independently of the camera's world scale", () => {
		for (const near of [0.000_001, 1_000_000]) {
			const volume = createCameraNearClipVolume(
				{ ...CAMERA, near },
				CAMERA.placement,
				1,
			);
			for (const plane of volume.clippingPlanes) {
				expect(
					Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z),
				).toBeCloseTo(1);
			}
		}
	});

	it("rejects invalid projection facts loudly", () => {
		expect(() =>
			createCameraNearClipVolume({ ...CAMERA, near: 0 }, CAMERA.placement, 1),
		).toThrow("projection facts");
	});

	it("matches the immutable classifier across the near-volume boundary corpus", () => {
		const near = createCameraNearClipVolume(CAMERA, CAMERA.placement, 1);
		const apertures = [
			triangleApertureFromPoints([
				new Vec3(-0.5, 0, -2),
				new Vec3(0.5, 0, 0),
				new Vec3(0, 1, -2),
			]),
			triangleApertureFromPoints([
				new Vec3(3, 0, -2),
				new Vec3(4, 0, 0),
				new Vec3(3, 1, -2),
			]),
			triangleApertureFromPoints([
				new Vec3(-0.2, -0.2, -1.5),
				new Vec3(0.2, -0.2, -1.5),
				new Vec3(0, 0.2, -1.5),
			]),
			triangleApertureFromPoints([
				new Vec3(1, -0.5, -1),
				new Vec3(2, 0, -1),
				new Vec3(1, 0.5, -1),
			]),
			triangleApertureFromPoints([
				new Vec3(-2, -0.1, -1),
				new Vec3(2, -0.1, -1),
				new Vec3(0, 0.1, -1),
			]),
			triangleApertureFromPoints([
				new Vec3(1.000_483_8, -0.000_148_9, -1.000_195_4),
				new Vec3(1.000_297_3, -0.000_958_2, -0.999_950_4),
				new Vec3(1.000_497_8, 0.000_285_4, -1.000_201_7),
			]),
		];
		const arena = nearClassifierArena();
		for (const aperture of apertures) {
			expect(
				arena.apertureIntersectsNearClip(
					near,
					preparePortalApertureProjectionInput({
						aperture,
						landblockCoordinates: { x: 0, y: 0 },
					}),
					{
						anchorCoordinates: { x: 0, y: 0 },
						clipFromAnchor: Mat4.identity(),
					},
					null,
				),
			).toBe(apertureIntersectsCameraNearClipVolume(near, aperture));
		}
	});
});

function nearClassifierArena(): PortalWindowArena {
	return new PortalWindowArena({
		maximumApertureVertexCount: 16,
		maximumFragmentCount: 16,
		maximumTemporaryFragmentCount: 16,
		maximumTemporaryVertexCount: 128,
		maximumVertexCount: 128,
		maximumVerticesPerFragment: 16,
		maximumWindowCount: 16,
	});
}

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

function triangleApertureFromPoints(
	points: readonly [Vec3, Vec3, Vec3],
): PlanarAperture {
	const firstEdge = new Vec3(
		points[1].x - points[0].x,
		points[1].y - points[0].y,
		points[1].z - points[0].z,
	);
	const secondEdge = new Vec3(
		points[2].x - points[0].x,
		points[2].y - points[0].y,
		points[2].z - points[0].z,
	);
	const normal = new Vec3(
		firstEdge.y * secondEdge.z - firstEdge.z * secondEdge.y,
		firstEdge.z * secondEdge.x - firstEdge.x * secondEdge.z,
		firstEdge.x * secondEdge.y - firstEdge.y * secondEdge.x,
	);
	const length = Math.hypot(normal.x, normal.y, normal.z);
	const normalized = new Vec3(
		normal.x / length,
		normal.y / length,
		normal.z / length,
	);
	return triangleAperture(
		points,
		normalized,
		-(
			normalized.x * points[0].x +
			normalized.y * points[0].y +
			normalized.z * points[0].z
		),
	);
}
