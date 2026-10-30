import { describe, expect, it } from "vitest";
import type { MinimapFrame, MinimapSubject } from "../../../app/minimap-frame";
import { worldMapPlayer } from "./view";

const view = { centerX: 120, centerZ: -240, spanMeters: 600 };
const anchor = {
	worldX: 120,
	worldY: 30,
	worldZ: -240,
	headingRadians: Math.PI / 2,
	residency: { landblockId: "0x0100ffff", envCellId: "0x01000100" },
} as const;
const player = { kind: "controlled-entity", guid: 1, anchor } as const;

function placement(
	subject: MinimapSubject | null,
	surfaceMapEligible: MinimapFrame["surfaceMapEligible"],
) {
	return worldMapPlayer({ subject, surfaceMapEligible }, view, 600, 400);
}

describe("world-map player marker", () => {
	it("projects mixed-interior position and heading identically to outdoor placement", () => {
		const expected = { position: [300, 200], headingDegrees: 90 };
		expect(placement(player, true)).toEqual(expected);
		expect(
			placement(
				{
					...player,
					anchor: {
						...anchor,
						residency: { ...anchor.residency, envCellId: null },
					},
				},
				true,
			),
		).toEqual(expected);
	});
	it("hides dungeon-only and unresolved scene placements", () => {
		expect(placement(player, false)).toBeNull();
		expect(
			placement({ ...player, anchor: { ...anchor, residency: null } }, true),
		).toBeNull();
	});
	it("requires a controlled player", () => {
		expect(placement(null, true)).toBeNull();
		expect(placement({ kind: "free-camera", anchor }, true)).toBeNull();
	});
});
