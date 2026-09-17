import { describe, expect, it } from "vitest";
import { entityFacts } from "./client-entity-mirror.test-support";
import type { ClientEntityFacts } from "./client-entity-mirror";
import {
	EQUIPMENT_SLOTS,
	inventoryEquipment,
} from "./client-inventory-equipment";

const slotMask = (label: string) => {
	const slot = EQUIPMENT_SLOTS.find((slot) => slot.label === label);
	if (!slot) throw new Error(`Missing slot fixture: ${label}`);
	return slot.mask;
};
const equipped = (guid: number, mask: number | null, wearerGuid = 1) =>
	entityFacts(guid, {
		ownedByPlayer: wearerGuid === 1,
		location: { kind: "equipped", wearerGuid, mask },
	});
const project = (...entities: ClientEntityFacts[]) =>
	inventoryEquipment({
		worldContainer: { kind: "closed" },
		playerGuid: 1,
		revision: 1,
		entities: new Map(entities.map((entity) => [entity.guid, entity])),
	});

describe("inventory equipment rows", () => {
	it("repeats multi-slot armor while keeping clothing separate and empty rows present", () => {
		const armor = equipped(
			2,
			slotMask("Chest armor") | slotMask("Upper arm armor"),
		);
		const shirt = equipped(3, slotMask("Shirt"));
		const result = project(armor, shirt, equipped(4, slotMask("Head"), 9));
		expect(result.pending).toBe(false);
		expect(
			result.rows
				.filter((row) => row.item === armor)
				.map((row) => row.slot.label),
		).toEqual(["Chest armor", "Upper arm armor"]);
		expect(result.rows.find((row) => row.slot.label === "Shirt")?.item).toBe(
			shirt,
		);
		expect(
			result.rows.find((row) => row.slot.label === "Head")?.item,
		).toBeNull();
	});
	it("groups weapon locations into main hand while off hand and ammo stay independent", () => {
		// Protocol EquipMask::TWO_HANDED; grouping must accept a single constituent bit.
		const weapon = equipped(2, 0x02000000);
		const ammo = equipped(3, slotMask("Ammunition"));
		expect(
			project(weapon, ammo)
				.rows.filter((row) => row.item !== null)
				.map((row) => row.slot.label),
		).toEqual(["Main hand", "Ammunition"]);
	});
	it("preserves known placement before description hydration and marks unknown placement pending", () => {
		const item = {
			...equipped(2, slotMask("Head")),
			description: { kind: "pending" as const },
		};
		expect(
			project(item).rows.find((row) => row.slot.label === "Head")?.item,
		).toBe(item);
		expect(project(equipped(2, null)).pending).toBe(true);
		expect(project().pending).toBe(false);
	});
	it("places shirt and pants independently when their clothing location masks overlap", () => {
		// EquipMask clothing regions: chest, abdomen, arms / abdomen, legs.
		const shirt = equipped(2, 0x0000001e);
		const pants = equipped(3, 0x000000c4);
		const rows = project(shirt, pants).rows.filter((row) => row.item !== null);
		expect(rows.map((row) => [row.slot.label, row.item?.guid])).toEqual([
			["Shirt", shirt.guid],
			["Pants", pants.guid],
		]);
	});
	it("rejects competing occupants of the same display slot", () => {
		expect(() =>
			project(equipped(2, slotMask("Head")), equipped(3, slotMask("Head"))),
		).toThrow("Multiple equipped items occupy Head");
	});
});
