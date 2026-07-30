import { describe, expect, it } from "vitest";
import type { ResolvedStaticObjectLayerSource } from "./landblock-layer";
import { LandblockLayerKind } from "../runtime/scene-interest";
import { staticObjectDetailRoleForSource } from "./static-detail-role";

describe("static detail render domains", () => {
	it.each([
		[LandblockLayerKind.Buildings, "building"],
		[LandblockLayerKind.EnvCells, null],
		[LandblockLayerKind.Generated, null],
		[LandblockLayerKind.Objects, null],
	] as const)("maps %s to the %s role", (layer, role) => {
		expect(staticObjectDetailRoleForSource(source(layer))).toBe(role);
	});
});

function source(
	kind: ResolvedStaticObjectLayerSource["kind"],
): ResolvedStaticObjectLayerSource {
	const common = {
		dynamicResidents: [],
		landblockId: "0xda55ffff" as const,
		staticResidents: [],
	};
	return kind === LandblockLayerKind.EnvCells
		? {
				...common,
				envCellId: "0xda550101",
				kind,
			}
		: { ...common, kind };
}
