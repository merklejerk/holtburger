import { describe, expect, it } from "vitest";

import { Mat4, AABB3, Vec3 } from "../math/types";
import { resolveNameplateAnchor } from "./nameplate-anchor";

const ANCHOR_PADDING = 0.25;

describe("nameplate anchor", () => {
	it("uses the Y-up rigid top and applies entity and landblock translation once", () => {
		const bounds = new AABB3(new Vec3(-2, -1, -4), new Vec3(6, 7, 8));
		const localToLandblock = Mat4.identity();
		localToLandblock.m41 = 10;
		localToLandblock.m42 = 20;
		localToLandblock.m43 = 30;
		const camera = new Vec3(12, 27 + ANCHOR_PADDING, 32);

		const resolved = resolveNameplateAnchor(
			bounds,
			localToLandblock,
			new Vec3(100, 200, 300),
			camera,
			ANCHOR_PADDING,
		);

		expect(resolved.anchor).toEqual(new Vec3(112, 227 + ANCHOR_PADDING, 332));
		expect(resolved.distanceSquared).toBe(100 ** 2 + 200 ** 2 + 300 ** 2);
	});
});
