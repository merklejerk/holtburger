import { describe, expect, it } from "vitest";
import type { ResolvedObjectResident } from "./landblock-layer";
import { Mat4, Vec3 } from "../math/types";
import { classifyObjectResidents } from "./object-resident-classifier";

describe("classifyObjectResidents", () => {
	it("partitions complete residents using only the default-animation predicate", () => {
		const staticResident = resident("static", null);
		const dynamicResident = resident("dynamic", "0x030005cf");
		const classified = classifyObjectResidents([
			staticResident,
			dynamicResident,
		]);

		expect(classified.staticResidents).toEqual([staticResident]);
		expect(classified.dynamicResidents).toEqual([dynamicResident]);
		expect(
			new Set([...classified.staticResidents, ...classified.dynamicResidents])
				.size,
		).toBe(2);
	});
});

function resident(
	id: string,
	animationId: string | null,
): ResolvedObjectResident {
	return {
		identity: { kind: "authored", sourceId: id },
		presentation: {
			id: `presentation:${id}`,
			sourceAssetId: `gfx-obj/0x0100000${id === "static" ? "1" : "2"}`,
			parts: [],
			holdingLocations: new Map(),
			placementPoses: new Map(),
			motion: null,
			effects: {
				animationId,
				physicsScriptId: null,
				physicsScriptTableId: null,
				soundTableId: null,
			},
			selectionBounds: null,
			sortingBounds: null,
		},
		placement: {
			envCellId: null,
			landblockId: "0xda55ffff",
			localTransform: Mat4.identity(),
		},
		scale: new Vec3(1, 1, 1),
		localBounds: null,
		appearance: null,
	};
}
