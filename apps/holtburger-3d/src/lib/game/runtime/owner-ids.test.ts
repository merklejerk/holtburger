import { describe, expect, it } from "vitest";
import { LandblockLayerKind } from "./scene-interest";
import {
	dynamicGenerationToResourceOwnerId,
	landblockLayerToOwnerId,
	parseLandblockLayerOwnerId,
} from "./owner-ids";
import type { LandblockOwnerId } from "../game-types";

describe("landblock-layer owner IDs", () => {
	it("round-trips the structured owner facts", () => {
		const landblockId = "0xda55ffff" as LandblockOwnerId;
		expect(
			parseLandblockLayerOwnerId(
				landblockLayerToOwnerId(landblockId, LandblockLayerKind.EnvCells),
			),
		).toEqual({ landblockId, layer: LandblockLayerKind.EnvCells });
	});

	it("derives a private resource owner for each dynamic generation", () => {
		const owner = landblockLayerToOwnerId(
			"0xda55ffff",
			LandblockLayerKind.Buildings,
		);
		expect(dynamicGenerationToResourceOwnerId(owner, 7)).toBe(
			"dynamic-generation:landblock-layer:0xda55ffff/buildings/7",
		);
	});
});
