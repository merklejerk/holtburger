import { describe, expect, it } from "vitest";

import { sceneVec3 } from "../lib/assets/ac-frame";
import type { LandblockOwnerId } from "../lib/game/game-types";
import { AABB3, Mat4, Quat, Vec3 } from "../lib/game/math/types";
import type { SelectedDynamicEntityFrame } from "../lib/game/runtime/game-presentation-runtime";
import type { PrimaryCameraView } from "../lib/game/runtime/types";
import { clientSelectedEntityDistance } from "./client-selection-tracking";

const CAMERA_LANDBLOCK = "0x0000ffff" as LandblockOwnerId;
const EAST_LANDBLOCK = "0x0100ffff" as LandblockOwnerId;
const VIEW: PrimaryCameraView = {
	camera: {
		far: 2_000,
		fov: 75,
		near: 0.1,
		placement: {
			envCellId: null,
			landblockId: CAMERA_LANDBLOCK,
			position: sceneVec3(Vec3.zero()),
			rotation: Quat.identity(),
		},
	},
	extent: { height: 720, width: 1_280 },
};

describe("client selection tracking", () => {
	it("measures to the nearest point of the transformed visual bound", () => {
		const transform = Mat4.identity();
		transform.m41 = 200;
		expect(
			clientSelectedEntityDistance(VIEW, frame(CAMERA_LANDBLOCK, transform)),
		).toBe(199);
	});

	it("accounts for the selected entity's landblock frame", () => {
		expect(
			clientSelectedEntityDistance(
				VIEW,
				frame(EAST_LANDBLOCK, Mat4.identity()),
			),
		).toBe(191);
	});
});

function frame(
	landblockId: LandblockOwnerId,
	localToLandblock: Mat4,
): SelectedDynamicEntityFrame {
	return {
		guid: 7,
		localBounds: new AABB3(new Vec3(-1, -1, -1), new Vec3(1, 1, 1)),
		placement: {
			envCellId: null,
			landblockId,
			localToLandblock,
			scope: { kind: "outdoor" },
		},
	};
}
