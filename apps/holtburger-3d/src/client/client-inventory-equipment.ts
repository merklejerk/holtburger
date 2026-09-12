import type {
	ClientEntityFacts,
	ClientEntityLevel,
} from "./client-entity-mirror";

/** Display order and slot masks follow gmPaperDollUI::SetUIItemIntoLocation
 * (acclient.c:211927). Clothing uses chest/upper-leg anchors for shirt/pants:
 * raw clothing-location bits are not exclusive slots. ACE checks ClothingPriority
 * for conflicts (Creature_Equipment.cs:GetEquippedItems) and publishes full valid
 * locations (Player_Inventory.cs:DoHandleActionGetAndWieldItem).
 */
export const EQUIPMENT_SLOTS = [
	{ mask: 0x03500000, label: "Main hand", symbol: "weapon" },
	{ mask: 0x00200000, label: "Off hand", symbol: "shield" },
	{ mask: 0x00800000, label: "Ammunition", symbol: "ammo" },
	{ mask: 0x00000001, label: "Head", symbol: "head" },
	{ mask: 0x00000200, label: "Chest armor", symbol: "chest" },
	{ mask: 0x00000400, label: "Abdomen armor", symbol: "abdomen" },
	{ mask: 0x00000800, label: "Upper arm armor", symbol: "arm" },
	{ mask: 0x00001000, label: "Lower arm armor", symbol: "forearm" },
	{ mask: 0x00000020, label: "Hands", symbol: "hand" },
	{ mask: 0x00002000, label: "Upper leg armor", symbol: "leg" },
	{ mask: 0x00004000, label: "Lower leg armor", symbol: "shin" },
	{ mask: 0x00000100, label: "Feet", symbol: "foot" },
	{ mask: 0x00000002, label: "Shirt", symbol: "chest" },
	{ mask: 0x00000040, label: "Pants", symbol: "leg" },
	{ mask: 0x08000000, label: "Cloak", symbol: "cloak" },
	{ mask: 0x00008000, label: "Neck", symbol: "neck" },
	{ mask: 0x00010000, label: "Left wrist", symbol: "wrist" },
	{ mask: 0x00020000, label: "Right wrist", symbol: "wrist" },
	{ mask: 0x00040000, label: "Left ring", symbol: "ring" },
	{ mask: 0x00080000, label: "Right ring", symbol: "ring" },
	{ mask: 0x04000000, label: "Trinket", symbol: "trinket" },
	{ mask: 0x10000000, label: "Blue aetheria", symbol: "sigil" },
	{ mask: 0x20000000, label: "Yellow aetheria", symbol: "sigil" },
	{ mask: 0x40000000, label: "Red aetheria", symbol: "sigil" },
] as const;

/** A row references the original entity; multi-slot items share that identity. */
export interface InventoryEquipmentRow {
	readonly slot: (typeof EQUIPMENT_SLOTS)[number];
	readonly item: ClientEntityFacts | null;
}

/** Unknown locations keep the strip pending instead of claiming empty slots. */
export interface InventoryEquipment {
	readonly rows: readonly InventoryEquipmentRow[];
	readonly pending: boolean;
}

/** Occupancy uses accepted current locations, never allowed locations or visuals. */
export function inventoryEquipment(
	level: ClientEntityLevel,
): InventoryEquipment {
	const equipped = [...level.entities.values()].flatMap((entity) =>
		entity.location.kind === "equipped" &&
		entity.location.wearerGuid === level.playerGuid
			? [{ item: entity, mask: entity.location.mask }]
			: [],
	);
	return {
		pending:
			level.playerGuid === null || equipped.some(({ mask }) => mask === null),
		rows: EQUIPMENT_SLOTS.map((slot) => {
			const occupants = equipped.filter(
				({ mask }) => mask !== null && (mask & slot.mask) !== 0,
			);
			if (occupants.length > 1)
				throw new Error(`Multiple equipped items occupy ${slot.label}`);
			return { slot, item: occupants[0]?.item ?? null };
		}),
	};
}
