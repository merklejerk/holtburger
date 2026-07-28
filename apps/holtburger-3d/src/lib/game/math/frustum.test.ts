import { describe, expect, it } from "vitest";
import {
	createFrustum,
	createFrustumFromClipMatrix,
	frustumIntersectsAABB,
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
});
