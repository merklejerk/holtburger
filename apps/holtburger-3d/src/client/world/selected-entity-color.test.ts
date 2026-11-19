import { describe, expect, it } from "vitest";
import { SHARED_FRONTEND_TUNING } from "../../lib/frontend-tuning";
import { CLIENT_TUNING } from "../settings/tuning";
import { selectedEntityNameColor } from "./selected-entity-color";

const names = SHARED_FRONTEND_TUNING.rendering.nameplates.appearance.fillColors;
const map = SHARED_FRONTEND_TUNING.map.blips.fillColors;

describe("selected entity name colors", () => {
	it("uses the ordinary player palette for summons without changing their category", () => {
		expect(
			selectedEntityNameColor(
				{ mapCategory: "mob", consumable: null },
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
					{ mapCategory, consumable: null },
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
					{ mapCategory, consumable: null },
					false,
					false,
				),
			).toBe(map[mapCategory]);
		},
	);
	it("refines the controlled player's name without overriding other categories", () => {
		expect(
			selectedEntityNameColor(
				{ mapCategory: "player", consumable: null },
				true,
				false,
			),
		).toBe(names.selfPlayer);
		expect(
			selectedEntityNameColor(
				{
					mapCategory: "npc",
					consumable: {
						identity: { wcid: 1, category: "healing-kit" },
						availability: "ready",
					},
				},
				true,
				false,
			),
		).toBe(names.npc);
	});
	it("reserves item accents for entities without an existing 3D category", () => {
		expect(
			selectedEntityNameColor(
				{
					mapCategory: "other",
					consumable: {
						identity: { wcid: 1, category: "healing-kit" },
						availability: "ready",
					},
				},
				false,
				false,
			),
		).toBe(CLIENT_TUNING.selectedEntityHud.healingKitColor);
		expect(
			selectedEntityNameColor(
				{
					mapCategory: "other",
					consumable: {
						identity: { wcid: 2, category: "charged-mana-stone" },
						availability: "exhausted",
					},
				},
				false,
				false,
			),
		).toBe(CLIENT_TUNING.selectedEntityHud.manaStoneColor);
		expect(
			selectedEntityNameColor(
				{
					mapCategory: "other",
					consumable: {
						identity: { wcid: 3, category: "food" },
						availability: "ready",
					},
				},
				false,
				false,
			),
		).toBe(names.other);
		expect(
			selectedEntityNameColor(
				{ mapCategory: "other", consumable: null },
				false,
				false,
			),
		).toBe(names.other);
	});
});
