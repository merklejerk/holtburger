// Individual public ItemType flags; composite masks describe targeting groups,
// so display their constituent types instead.
export const ITEM_TYPE_FLAGS = {
	MELEE_WEAPON: 0x00000001,
	ARMOR: 0x00000002,
	CLOTHING: 0x00000004,
	JEWELRY: 0x00000008,
	CREATURE: 0x00000010,
	FOOD: 0x00000020,
	MONEY: 0x00000040,
	MISCELLANEOUS: 0x00000080,
	MISSILE_WEAPON: 0x00000100,
	CONTAINER: 0x00000200,
	USELESS: 0x00000400,
	GEM: 0x00000800,
	SPELL_COMPONENTS: 0x00001000,
	WRITABLE: 0x00002000,
	KEY: 0x00004000,
	CASTER: 0x00008000,
	PORTAL: 0x00010000,
	LOCKABLE: 0x00020000,
	PROMISSORY_NOTE: 0x00040000,
	MANA_STONE: 0x00080000,
	SERVICE: 0x00100000,
	MAGIC_WIELDABLE: 0x00200000,
	CRAFT_COOKING_BASE: 0x00400000,
	CRAFT_ALCHEMY_BASE: 0x00800000,
	CRAFT_FLETCHING_BASE: 0x02000000,
	CRAFT_ALCHEMY_INTERMEDIATE: 0x04000000,
	CRAFT_FLETCHING_INTERMEDIATE: 0x08000000,
	LIFE_STONE: 0x10000000,
	TINKERING_TOOL: 0x20000000,
	TINKERING_MATERIAL: 0x40000000,
	GAMEBOARD: 0x80000000,
} as const;

const itemTypeLabels: readonly (readonly [number, string])[] = [
	[ITEM_TYPE_FLAGS.MELEE_WEAPON, "Melee weapon"],
	[ITEM_TYPE_FLAGS.ARMOR, "Armor"],
	[ITEM_TYPE_FLAGS.CLOTHING, "Clothing"],
	[ITEM_TYPE_FLAGS.JEWELRY, "Jewelry"],
	[ITEM_TYPE_FLAGS.CREATURE, "Creature"],
	[ITEM_TYPE_FLAGS.FOOD, "Food"],
	[ITEM_TYPE_FLAGS.MONEY, "Money"],
	[ITEM_TYPE_FLAGS.MISCELLANEOUS, "Miscellaneous"],
	[ITEM_TYPE_FLAGS.MISSILE_WEAPON, "Missile weapon"],
	[ITEM_TYPE_FLAGS.CONTAINER, "Container"],
	[ITEM_TYPE_FLAGS.USELESS, "Useless"],
	[ITEM_TYPE_FLAGS.GEM, "Gem"],
	[ITEM_TYPE_FLAGS.SPELL_COMPONENTS, "Spell components"],
	[ITEM_TYPE_FLAGS.WRITABLE, "Writable"],
	[ITEM_TYPE_FLAGS.KEY, "Key"],
	[ITEM_TYPE_FLAGS.CASTER, "Caster"],
	[ITEM_TYPE_FLAGS.PORTAL, "Portal"],
	[ITEM_TYPE_FLAGS.LOCKABLE, "Lockable"],
	[ITEM_TYPE_FLAGS.PROMISSORY_NOTE, "Promissory note"],
	[ITEM_TYPE_FLAGS.MANA_STONE, "Mana stone"],
	[ITEM_TYPE_FLAGS.SERVICE, "Service"],
	[ITEM_TYPE_FLAGS.MAGIC_WIELDABLE, "Magic wieldable"],
	[ITEM_TYPE_FLAGS.CRAFT_COOKING_BASE, "Craft cooking base"],
	[ITEM_TYPE_FLAGS.CRAFT_ALCHEMY_BASE, "Craft alchemy base"],
	[ITEM_TYPE_FLAGS.CRAFT_FLETCHING_BASE, "Craft fletching base"],
	[ITEM_TYPE_FLAGS.CRAFT_ALCHEMY_INTERMEDIATE, "Craft alchemy intermediate"],
	[
		ITEM_TYPE_FLAGS.CRAFT_FLETCHING_INTERMEDIATE,
		"Craft fletching intermediate",
	],
	[ITEM_TYPE_FLAGS.LIFE_STONE, "Life stone"],
	[ITEM_TYPE_FLAGS.TINKERING_TOOL, "Tinkering tool"],
	[ITEM_TYPE_FLAGS.TINKERING_MATERIAL, "Tinkering material"],
	[ITEM_TYPE_FLAGS.GAMEBOARD, "Gameboard"],
];

/** Human-readable flag names, preserving unrecognized bits for diagnostics. */
export function formatItemType(itemType: number): string {
	return formatFlags(itemType, itemTypeLabels);
}

// Public ObjectDescriptionFlag values from holtburger-common/properties/object.rs.
const objectFlagLabels: readonly (readonly [number, string])[] = [
	[0x00000001, "Openable"],
	[0x00000002, "Inscribable"],
	[0x00000004, "Stuck"],
	[0x00000008, "Player"],
	[0x00000010, "Attackable"],
	[0x00000020, "Player killer"],
	[0x00000040, "Hidden admin"],
	[0x00000080, "UI hidden"],
	[0x00000100, "Book"],
	[0x00000200, "Vendor"],
	[0x00000400, "PK switch"],
	[0x00000800, "NPK switch"],
	[0x00001000, "Door"],
	[0x00002000, "Corpse"],
	[0x00004000, "Life stone"],
	[0x00008000, "Food"],
	[0x00010000, "Healer"],
	[0x00020000, "Lockpick"],
	[0x00040000, "Portal"],
	[0x00100000, "Admin"],
	[0x00200000, "Free pk status"],
	[0x00400000, "Immune cell restrictions"],
	[0x00800000, "Requires pack slot"],
	[0x01000000, "Retained"],
	[0x02000000, "PK lite status"],
	[0x04000000, "Includes second header"],
	[0x08000000, "Bind stone"],
	[0x10000000, "Volatile rare"],
	[0x20000000, "Wield on use"],
	[0x40000000, "Wield left"],
];

/** Public object flags, including any unrecognized bits. */
export function formatObjectFlags(flags: number): string {
	return formatFlags(flags, objectFlagLabels);
}

function formatFlags(
	bits: number,
	labelsByFlag: readonly (readonly [number, string])[],
): string {
	if (bits === 0) return "None";
	const labels: string[] = [];
	let remaining = bits;
	for (const [flag, label] of labelsByFlag) {
		if ((bits & flag) === 0) continue;
		labels.push(label);
		remaining &= ~flag;
	}
	if (remaining !== 0)
		labels.push(
			`Unknown (0x${(remaining >>> 0).toString(16).padStart(8, "0")})`,
		);
	return labels.join(", ");
}
