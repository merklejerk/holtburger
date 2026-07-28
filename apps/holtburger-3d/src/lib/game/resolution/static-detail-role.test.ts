import { describe, expect, it } from "vitest";
import { LandblockLayerKind } from "../runtime/scene-interest";
import { staticDetailRoleForLayer } from "./static-detail-role";

describe("static detail render domains", () => {
	it.each([
		[LandblockLayerKind.Buildings, "building"],
		[LandblockLayerKind.EnvCells, "environment"],
		[LandblockLayerKind.Generated, "object"],
		[LandblockLayerKind.Objects, "object"],
	] as const)("maps %s to the %s role", (layer, role) => {
		expect(staticDetailRoleForLayer(layer)).toBe(role);
	});
});
