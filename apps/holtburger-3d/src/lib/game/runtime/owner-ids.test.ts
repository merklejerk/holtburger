import { describe, expect, it } from "vitest";
import { LandblockLayerKind } from "./scene-interest";
import {
	landblockLayerToOwnerId,
	parseLandblockLayerOwnerId,
} from "./owner-ids";
import type { LandblockId } from "../game-types";

describe("landblock-layer owner IDs", () => {
	it("round-trips the structured owner facts", () => {
		const landblockId = "0xda55ffff" as LandblockId;
		expect(
			parseLandblockLayerOwnerId(
				landblockLayerToOwnerId(landblockId, LandblockLayerKind.EnvCells),
			),
		).toEqual({ landblockId, layer: LandblockLayerKind.EnvCells });
	});

	it("rejects spawned owners at the landblock-layer boundary", () => {
		expect(() => parseLandblockLayerOwnerId("spawned:fixture")).toThrow(
			"not a landblock-layer owner",
		);
	});
});
