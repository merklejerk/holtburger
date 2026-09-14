import { expect, it } from "vitest";
import { entityFacts } from "./client-entity-mirror.test-support";
import { isBindingEquipment } from "./client-action-equipment";

it("admits owned equipment independently of whether it is currently worn", () => {
	const item = entityFacts(91, { ownedByPlayer: true });
	if (item.description.kind !== "known")
		throw new Error("Expected known fixture description");
	const equipment = {
		...item,
		description: { ...item.description, equipLocations: 1 },
	};
	expect(isBindingEquipment(equipment)).toBe(true);
	expect(
		isBindingEquipment({
			...equipment,
			location: { kind: "equipped", wearerGuid: 1, mask: 1 },
		}),
	).toBe(true);
	expect(isBindingEquipment({ ...equipment, ownedByPlayer: false })).toBe(
		false,
	);
	expect(
		isBindingEquipment({ ...equipment, description: { kind: "pending" } }),
	).toBe(false);
	expect(
		isBindingEquipment({
			...equipment,
			description: { ...equipment.description, equipLocations: 0 },
		}),
	).toBe(false);
	expect(isBindingEquipment(item)).toBe(false);
	expect(isBindingEquipment(undefined)).toBe(false);
});
