import type {
	ClientEntityFacts,
	ClientEntityLevel,
} from "./client-entity-mirror";

/** Protocol EquipMask::CASTER, distinct from the combined main-hand display slot. */
export const CASTER_EQUIP_MASK = 0x01000000;

/** Ammunition slot identity shared by the equipment strip and projectile HUD icon. */
export const AMMUNITION_SLOT = {
	mask: 0x00800000,
	label: "Ammunition",
	/** Compact loadout-builder caption; tooltips retain the full label. */
	compactLabel: "Ammo",
	symbol: "ammo",
} as const;

/** A currently wielded activation spell, independent of learned spellbook membership. */
export interface WieldedCasterSpell {
	/** Source instance sent with UseWithTarget. */
	readonly item: number;
	/** Public spell identity used to resolve local name and artwork. */
	readonly spell: number;
	/** Item name shown alongside its spell. */
	readonly name: string;
}

/** Consume confirmed ownership and placement; allowed equipment locations do not imply wielding. */
export function wieldedCasterSpell(
	item: ClientEntityFacts,
): WieldedCasterSpell | null {
	if (
		!item.ownedByPlayer ||
		item.location.kind !== "equipped" ||
		item.location.mask === null ||
		(item.location.mask & CASTER_EQUIP_MASK) === 0 ||
		item.description.kind !== "known" ||
		item.description.builtInSpell === null
	)
		return null;
	return {
		item: item.guid,
		spell: item.description.builtInSpell,
		name: item.description.name,
	};
}

/** Select the same confirmed wielded caster for HUD display and keyboard activation. */
export function findWieldedCasterSpell(
	items: Iterable<ClientEntityFacts>,
): WieldedCasterSpell | null {
	for (const item of items) {
		const caster = wieldedCasterSpell(item);
		if (caster !== null) return caster;
	}
	return null;
}

/** Display order and slot masks follow gmPaperDollUI::SetUIItemIntoLocation
 * (acclient.c:211927). Clothing uses chest/upper-leg anchors for shirt/pants:
 * raw clothing-location bits are not exclusive slots. ACE checks ClothingPriority
 * for conflicts (Creature_Equipment.cs:GetEquippedItems) and publishes full valid
 * locations (Player_Inventory.cs:DoHandleActionGetAndWieldItem).
 * Full labels name slots in tooltips; compactLabel supplies the loadout builder's visible captions.
 */
export const EQUIPMENT_SLOTS = [
	{
		mask: 0x03500000,
		label: "Main hand",
		compactLabel: "Main",
		symbol: "weapon",
	},
	{
		mask: 0x00200000,
		label: "Off hand",
		compactLabel: "Off",
		symbol: "shield",
	},
	AMMUNITION_SLOT,
	{ mask: 0x00000001, label: "Head", compactLabel: "Head", symbol: "head" },
	{
		mask: 0x00000200,
		label: "Chest armor",
		compactLabel: "Chest",
		symbol: "chest",
	},
	{
		mask: 0x00000400,
		label: "Abdomen armor",
		compactLabel: "Abd.",
		symbol: "abdomen",
	},
	{
		mask: 0x00000800,
		label: "Upper arm armor",
		compactLabel: "U. Arm",
		symbol: "arm",
	},
	{
		mask: 0x00001000,
		label: "Lower arm armor",
		compactLabel: "L. Arm",
		symbol: "forearm",
	},
	{ mask: 0x00000020, label: "Hands", compactLabel: "Hands", symbol: "hand" },
	{
		mask: 0x00002000,
		label: "Upper leg armor",
		compactLabel: "U. Leg",
		symbol: "leg",
	},
	{
		mask: 0x00004000,
		label: "Lower leg armor",
		compactLabel: "L. Leg",
		symbol: "shin",
	},
	{ mask: 0x00000100, label: "Feet", compactLabel: "Feet", symbol: "foot" },
	{ mask: 0x00000002, label: "Shirt", compactLabel: "Shirt", symbol: "chest" },
	{ mask: 0x00000040, label: "Pants", compactLabel: "Pants", symbol: "leg" },
	{ mask: 0x08000000, label: "Cloak", compactLabel: "Cloak", symbol: "cloak" },
	{ mask: 0x00008000, label: "Neck", compactLabel: "Neck", symbol: "neck" },
	{
		mask: 0x00010000,
		label: "Left wrist",
		compactLabel: "Wrist (L)",
		symbol: "wrist",
	},
	{
		mask: 0x00020000,
		label: "Right wrist",
		compactLabel: "Wrist (R)",
		symbol: "wrist",
	},
	{
		mask: 0x00040000,
		label: "Left ring",
		compactLabel: "Ring (L)",
		symbol: "ring",
	},
	{
		mask: 0x00080000,
		label: "Right ring",
		compactLabel: "Ring (R)",
		symbol: "ring",
	},
	{
		mask: 0x04000000,
		label: "Trinket",
		compactLabel: "Trinket",
		symbol: "trinket",
	},
	{
		mask: 0x10000000,
		label: "Blue aetheria",
		/** World-resolved activation field required by this sigil slot. */
		activation: "blue",
		compactLabel: "Aeth. (B)",
		symbol: "sigil",
	},
	{
		mask: 0x20000000,
		label: "Yellow aetheria",
		/** World-resolved activation field required by this sigil slot. */
		activation: "yellow",
		compactLabel: "Aeth. (Y)",
		symbol: "sigil",
	},
	{
		mask: 0x40000000,
		label: "Red aetheria",
		/** World-resolved activation field required by this sigil slot. */
		activation: "red",
		compactLabel: "Aeth. (R)",
		symbol: "sigil",
	},
] as const;

/** A row references the original entity; multi-slot items share that identity. */
export interface InventoryEquipmentRow {
	readonly slot: (typeof EQUIPMENT_SLOTS)[number];
	readonly item: ClientEntityFacts | null;
	/** Slot admission shown by the strip, independent of occupancy and item requirements. */
	readonly availability: "available" | "locked" | "pending";
}

/** Unknown locations keep the strip pending instead of claiming empty slots. */
export interface InventoryEquipment {
	readonly rows: readonly InventoryEquipmentRow[];
	readonly pending: boolean;
}

/** Resolve one slot against a coherent level for sampled display and current gesture admission. */
export function equipmentSlotAvailability(
	slot: InventoryEquipmentRow["slot"],
	level: ClientEntityLevel,
): InventoryEquipmentRow["availability"] {
	if (!("activation" in slot)) return "available";
	const player =
		level.playerGuid === null
			? undefined
			: level.entities.get(level.playerGuid);
	if (
		player?.description.kind !== "known" ||
		player.description.aetheriaActivation === null
	)
		return "pending";
	return player.description.aetheriaActivation[slot.activation]
		? "available"
		: "locked";
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
			return {
				slot,
				item: occupants[0]?.item ?? null,
				availability: equipmentSlotAvailability(slot, level),
			};
		}),
	};
}
