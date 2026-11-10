import { describe, expect, it } from "vitest";
import { SHARED_FRONTEND_TUNING } from "../lib/frontend-tuning";
import { CLIENT_TUNING } from "./client-tuning";
import { selectedEntityNameColor } from "./client-selected-entity-color";

const names = SHARED_FRONTEND_TUNING.rendering.nameplates.appearance.fillColors;
const map = SHARED_FRONTEND_TUNING.map.blips.fillColors;

describe("selected entity name colors", () => {
	it("uses the ordinary player palette for summons without changing their category", () => {
		expect(
			selectedEntityNameColor(
				{ mapCategory: "mob", objectFlags: 0, itemType: 0 },
				false,
				true,
			),
		).toBe(names.player);
	});
	it.each(["player", "npc", "mob", "portal"] as const)(
		"uses the nameplate palette for %s",
		(mapCategory) => {
			expect(
				selectedEntityNameColor(
					{ mapCategory, objectFlags: 0, itemType: 0 },
					false,
					false,
				),
			).toBe(names[mapCategory]);
		},
	);
	it.each(["lifestone", "door", "door-no-direct-use", "switch"] as const)(
		"preserves the map distinction for %s",
		(mapCategory) => {
			expect(
				selectedEntityNameColor(
					{ mapCategory, objectFlags: 0, itemType: 0 },
					false,
					false,
				),
			).toBe(map[mapCategory]);
		},
	);
	it("refines the controlled player's name without overriding other categories", () => {
		expect(
			selectedEntityNameColor(
				{ mapCategory: "player", objectFlags: 0, itemType: 0 },
				true,
				false,
			),
		).toBe(names.selfPlayer);
		expect(
			selectedEntityNameColor(
				{ mapCategory: "npc", objectFlags: 0x10000, itemType: 0x80000 },
				true,
				false,
			),
		).toBe(names.npc);
	});
	it("reserves item accents for entities without an existing 3D category", () => {
		expect(
			selectedEntityNameColor(
				{ mapCategory: "other", objectFlags: 0x10000, itemType: 0 },
				false,
				false,
			),
		).toBe(CLIENT_TUNING.selectedEntityHud.healingKitColor);
		expect(
			selectedEntityNameColor(
				{ mapCategory: "other", objectFlags: 0, itemType: 0x80000 },
				false,
				false,
			),
		).toBe(CLIENT_TUNING.selectedEntityHud.manaStoneColor);
		expect(
			selectedEntityNameColor(
				{ mapCategory: "other", objectFlags: 0, itemType: 1 },
				false,
				false,
			),
		).toBe(names.other);
	});
});
