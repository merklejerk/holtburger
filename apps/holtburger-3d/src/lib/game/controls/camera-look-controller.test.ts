import { describe, expect, it } from "vitest";

import { CameraLookController } from "./camera-look-controller";

describe("CameraLookController", () => {
	it("applies reusable orbit deltas while bounding pitch only", () => {
		const look = new CameraLookController({ pitchRadians: 0, yawRadians: 0 });

		expect(look.rotate(10, 100, 0.1, 0.1, 1)).toEqual({
			pitchRadians: 1,
			yawRadians: -1,
		});
	});
});
