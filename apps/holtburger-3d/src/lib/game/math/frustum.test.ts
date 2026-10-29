import { describe, expect, it } from "vitest";
import {
	createFrustum,
	createFrustumFromClipMatrix,
	filterFrustumPlanesForAABB,
	frustumIntersectsAABB,
	type Frustum,
	type FrustumPlane,
} from "./frustum";
import {
	createPerspectiveMat4,
	createViewMat4,
	multiplyMat4,
} from "./matrices";
import { AABB3, Quat, Vec3 } from "./types";

describe("frustum", () => {
	it("accepts boxes in front of the camera and rejects boxes behind or beyond range", () => {
		const projection = createPerspectiveMat4(90, 1, 1, 10);
		const view = createViewMat4(Vec3.zero(), Quat.identity());
		const frustum = createFrustum(projection, view, Vec3.zero());
		expect(
			createFrustumFromClipMatrix(multiplyMat4(projection, view), Vec3.zero()),
		).toEqual(frustum);
		expect(
			frustumIntersectsAABB(
				frustum,
				new AABB3(new Vec3(-1, -1, -3), new Vec3(1, 1, -2)),
				0,
				0,
				0,
			),
		).toBe(true);
		expect(
			frustumIntersectsAABB(
				frustum,
				new AABB3(new Vec3(-1, -1, 2), new Vec3(1, 1, 3)),
				0,
				0,
				0,
			),
		).toBe(false);
	});

	it("retains intersecting group planes in order and drops proven interior planes", () => {
		const above = { x: 0, y: 1, z: 0, constant: 0 };
		const diagonal = { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0, constant: 0 };
		const right = { x: 1, y: 0, z: 0, constant: 0 };
		const behind = { x: 0, y: 0, z: -1, constant: 0 };
		const frustum = {
			cameraPosition: Vec3.zero(),
			planes: [above, diagonal, right, behind],
		};
		const retained: FrustumPlane[] = [];
		expect(
			filterFrustumPlanesForAABB(
				frustum,
				new AABB3(new Vec3(-2, 1, -3), new Vec3(2, 3, -1)),
				0,
				0,
				0,
				retained,
			),
		).toBe(true);
		expect(retained).toEqual([diagonal, right]);
		expect(retained[0]).toBe(diagonal);
		expect(retained[1]).toBe(right);
	});

	it("rejects an outside group and clears partially retained scratch", () => {
		const frustum = {
			cameraPosition: Vec3.zero(),
			planes: [
				{ x: 1, y: 0, z: 0, constant: 0 },
				{ x: 0, y: 1, z: 0, constant: 0 },
			],
		};
		const retained = [...frustum.planes];
		expect(
			filterFrustumPlanesForAABB(
				frustum,
				new AABB3(new Vec3(-1, -3, -1), new Vec3(1, -2, 1)),
				0,
				0,
				0,
				retained,
			),
		).toBe(false);
		expect(retained).toEqual([]);
	});

	it("preserves offset member visibility when using the group's remaining planes", () => {
		const frustum = createFrustum(
			createPerspectiveMat4(90, 1, 1, 20),
			createViewMat4(Vec3.zero(), Quat.identity()),
			Vec3.zero(),
		);
		const retained: FrustumPlane[] = [];
		const offset = new Vec3(3, -1, 2);
		expect(
			filterFrustumPlanesForAABB(
				frustum,
				new AABB3(new Vec3(-4, -2, -10), new Vec3(6, 3, -3)),
				offset.x,
				offset.y,
				offset.z,
				retained,
			),
		).toBe(true);
		expect(retained.length).toBeLessThan(frustum.planes.length);
		const members: Frustum = {
			cameraPosition: frustum.cameraPosition,
			planes: retained,
		};
		const verdicts = new Set<boolean>();
		for (let x = -4; x < 6; x++) {
			for (let y = -2; y < 3; y++) {
				for (let z = -10; z < -3; z++) {
					const bounds = new AABB3(
						new Vec3(x, y, z),
						new Vec3(x + 1, y + 1, z + 1),
					);
					const expected = frustumIntersectsAABB(
						frustum,
						bounds,
						offset.x,
						offset.y,
						offset.z,
					);
					verdicts.add(expected);
					expect(
						frustumIntersectsAABB(
							members,
							bounds,
							offset.x,
							offset.y,
							offset.z,
						),
					).toBe(expected);
				}
			}
		}
		expect(verdicts).toEqual(new Set([true, false]));
	});

	it("allows filtering in place and includes boxes touching a plane", () => {
		const crossing = { x: 1, y: 0, z: 0, constant: 0 };
		const touching = { x: 0, y: 1, z: 0, constant: 0 };
		const planes = [touching, crossing];
		expect(
			filterFrustumPlanesForAABB(
				{ cameraPosition: Vec3.zero(), planes },
				new AABB3(new Vec3(-1, 0, -1), new Vec3(1, 2, 1)),
				0,
				0,
				0,
				planes,
			),
		).toBe(true);
		expect(planes).toEqual([crossing]);
	});

	it("keeps indeterminate planes conservative and accepts an unconstrained group", () => {
		const plane = { x: 0, y: 1, z: 0, constant: 0 };
		const retained: FrustumPlane[] = [];
		const bounds = new AABB3(
			new Vec3(-Infinity, 1, -1),
			new Vec3(Infinity, 2, 1),
		);
		expect(
			filterFrustumPlanesForAABB(
				{ cameraPosition: Vec3.zero(), planes: [plane] },
				bounds,
				0,
				0,
				0,
				retained,
			),
		).toBe(true);
		expect(retained).toEqual([plane]);
		expect(
			filterFrustumPlanesForAABB(
				{ cameraPosition: Vec3.zero(), planes: [] },
				bounds,
				0,
				0,
				0,
				retained,
			),
		).toBe(true);
		expect(retained).toEqual([]);
	});
});
