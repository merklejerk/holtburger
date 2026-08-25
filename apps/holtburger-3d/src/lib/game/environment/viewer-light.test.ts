import { describe, expect, it } from "vitest";

import { acFrameTransform, sceneVec3 } from "../../assets/ac-frame";
import { FRONTEND_TUNING } from "../../frontend-tuning";
import { createLandblockWorldOrigin } from "../landblocks";
import { Vec3 } from "../math/types";
import type { ScenePlacement } from "../scene";
import { resolveViewerLightOrigin } from "./viewer-light";

const LANDBLOCK = "0x2020ffff";
const CARRY_HEIGHT = FRONTEND_TUNING.rendering.viewerLight.carryHeight;

/** One spawned-entity placement built exactly as the dynamic feed builds them. */
function carrierAt(
	acOrigin: readonly [number, number, number],
	acOrientation: readonly [number, number, number, number],
): ScenePlacement {
	return {
		envCellId: null,
		landblockId: LANDBLOCK,
		localTransform: acFrameTransform(
			{ origin: acOrigin, orientation: acOrientation },
			[1, 1, 1],
		),
	};
}

describe("resolveViewerLightOrigin", () => {
	it("leaves the light on the camera when no body carries it", () => {
		const camera = sceneVec3(new Vec3(4, 9, -16));

		expect(resolveViewerLightOrigin(null, camera)).toBe(camera);
	});

	it("lifts the light above an upright carrier in canonical scene space", () => {
		const origin = createLandblockWorldOrigin(LANDBLOCK);

		const light = resolveViewerLightOrigin(
			carrierAt([12, 30, 5], [1, 0, 0, 0]),
			sceneVec3(new Vec3(0, 0, 0)),
		);

		// AC (x, y, z) becomes scene (x, z, -y), and the carry offset rides the scene's up axis.
		expect(light.x).toBeCloseTo(origin.x + 12);
		expect(light.y).toBeCloseTo(5 + CARRY_HEIGHT);
		expect(light.z).toBeCloseTo(origin.z - 30);
	});

	it("tilts the carry offset with the carrier's own frame", () => {
		const origin = createLandblockWorldOrigin(LANDBLOCK);
		const quarterTurn = Math.SQRT1_2;

		// A quarter turn about the carrier's AC x axis lays its up axis onto scene +Z.
		const light = resolveViewerLightOrigin(
			carrierAt([12, 30, 5], [quarterTurn, quarterTurn, 0, 0]),
			sceneVec3(new Vec3(0, 0, 0)),
		);

		expect(light.x).toBeCloseTo(origin.x + 12);
		expect(light.y).toBeCloseTo(5);
		expect(light.z).toBeCloseTo(origin.z - 30 + CARRY_HEIGHT);
	});
});
