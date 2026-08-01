import { describe, expect, it } from "vitest";
import { transformPoint3 } from "../math/matrices";
import { Mat4, Vec3 } from "../math/types";
import { composeObjectPartTransform } from "./object-part-transform";

describe("composeObjectPartTransform", () => {
	it("scales pose translation without scaling its orientation", () => {
		const quarterTurnAroundZ = new Mat4(
			0,
			1,
			0,
			0,
			-1,
			0,
			0,
			0,
			0,
			0,
			1,
			0,
			1,
			2,
			3,
			1,
		);

		const transform = composeObjectPartTransform(
			quarterTurnAroundZ,
			new Vec3(2, 3, 4),
			new Vec3(5, 7, 11),
		);

		expect(transformPoint3(transform, Vec3.zero())).toEqual(new Vec3(2, 6, 12));
		// Local X is scaled by 10 and then rotated onto world Y. A world-axis pre-scale
		// would incorrectly make this displacement 15.
		expect(transformPoint3(transform, new Vec3(1, 0, 0))).toEqual(
			new Vec3(2, 16, 12),
		);
		// Local Y is scaled by 21 and then rotated onto negative world X.
		expect(transformPoint3(transform, new Vec3(0, 1, 0))).toEqual(
			new Vec3(-19, 6, 12),
		);
	});
});
