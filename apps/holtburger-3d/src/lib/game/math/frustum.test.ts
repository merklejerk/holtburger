import { describe, expect, it } from "vitest";
import { createFrustum, frustumIntersectsAABB } from "./frustum";
import { createPerspectiveMat4, createViewMat4 } from "./matrices";
import { AABB3, Quat, Vec3 } from "./types";

describe("frustum", () => {
	it("accepts boxes in front of the camera and rejects boxes behind or beyond range", () => {
		const frustum = createFrustum(
			createPerspectiveMat4(90, 1, 1, 10),
			createViewMat4(Vec3.zero(), Quat.identity()),
			Vec3.zero(),
		);
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
});
