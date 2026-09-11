// Individual flags from ACE/Source/ACE.Entity/Enum/ItemType.cs; composite masks
// describe targeting groups, so display their constituent types instead.
const itemTypeLabels: readonly (readonly [number, string])[] = [
	[0x00000001, "Melee weapon"],
	[0x00000002, "Armor"],
	[0x00000004, "Clothing"],
	[0x00000008, "Jewelry"],
	[0x00000010, "Creature"],
	[0x00000020, "Food"],
	[0x00000040, "Money"],
	[0x00000080, "Miscellaneous"],
	[0x00000100, "Missile weapon"],
	[0x00000200, "Container"],
	[0x00000400, "Useless"],
	[0x00000800, "Gem"],
	[0x00001000, "Spell components"],
	[0x00002000, "Writable"],
	[0x00004000, "Key"],
	[0x00008000, "Caster"],
	[0x00010000, "Portal"],
	[0x00020000, "Lockable"],
	[0x00040000, "Promissory note"],
	[0x00080000, "Mana stone"],
	[0x00100000, "Service"],
	[0x00200000, "Magic wieldable"],
	[0x00400000, "Craft cooking base"],
	[0x00800000, "Craft alchemy base"],
	[0x02000000, "Craft fletching base"],
	[0x04000000, "Craft alchemy intermediate"],
	[0x08000000, "Craft fletching intermediate"],
	[0x10000000, "Life stone"],
	[0x20000000, "Tinkering tool"],
	[0x40000000, "Tinkering material"],
	[0x80000000, "Gameboard"],
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
