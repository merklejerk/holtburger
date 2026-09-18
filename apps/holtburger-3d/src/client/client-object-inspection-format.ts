import type {
	CharacterIdentity,
	ItemInspection,
} from "./client-object-inspection-contract";

type WieldRequirement = ItemInspection["wieldRequirements"][number];
type ItemEffect = ItemInspection["effects"][number];
/** Shared retail appraisal color class; semantic polarity is computed by the world layer. */
export function inspectionEnchantmentClass(value: {
	readonly enchantment: "beneficial" | "harmful" | null;
}): string | undefined {
	return value.enchantment === null
		? undefined
		: `inspection-enchantment-${value.enchantment}`;
}

const damageTypes = [
	[0x0000_0001, "Slashing"],
	[0x0000_0002, "Piercing"],
	[0x0000_0004, "Bludgeoning"],
	[0x0000_0008, "Cold"],
	[0x0000_0010, "Fire"],
	[0x0000_0020, "Acid"],
	[0x0000_0040, "Electric"],
	[0x0000_0080, "Health"],
	[0x0000_0100, "Stamina"],
	[0x0000_0200, "Mana"],
	[0x0000_0400, "Nether"],
	[0x1000_0000, "Base"],
] as const;

const imbuedEffects = [
	[0x0000_0001, "Critical Strike"],
	[0x0000_0002, "Crippling Blow"],
	[0x0000_0004, "Armor Rending"],
	[0x0000_0008, "Slash Rending"],
	[0x0000_0010, "Pierce Rending"],
	[0x0000_0020, "Bludgeon Rending"],
	[0x0000_0040, "Acid Rending"],
	[0x0000_0080, "Cold Rending"],
	[0x0000_0100, "Electric Rending"],
	[0x0000_0200, "Fire Rending"],
	[0x0000_0400, "+1 Melee Defense"],
	[0x0000_0800, "+1 Missile Defense"],
	[0x0000_1000, "+1 Magic Defense"],
	[0x0000_2000, "Spellbook"],
	[0x0000_4000, "Nether Rending"],
	[0x2000_0000, "Ignore Some Magic Projectile Damage"],
	[0x4000_0000, "Always Critical"],
	[0x8000_0000, "Ignore All Armor"],
] as const;

const inspectionNumberFormat = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 1,
});

function formatFlagNames(
	bits: number,
	known: readonly (readonly [number, string])[],
	unknownLabel: string,
): readonly string[] {
	let remainder = bits >>> 0;
	const names: string[] = [];
	for (const [flag, name] of known) {
		if ((remainder & flag) === 0) continue;
		names.push(name);
		remainder = (remainder & ~flag) >>> 0;
	}
	if (remainder !== 0)
		names.push(`${unknownLabel} 0x${remainder.toString(16).padStart(8, "0")}`);
	return names;
}

/** Human-readable fallback for open shared semantic-enum names. */
export function humanizeInspectionName(value: string): string {
	const spaced = value
		.replaceAll("_", "-")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replaceAll("-", " ")
		.trim();
	return spaced.replace(/\b\w/g, (character) => character.toUpperCase());
}

/** Exact user-facing label for retail's public-flag character classification. */
export function formatPlayerKillerStatus(
	status: CharacterIdentity["playerKillerStatus"],
): string {
	switch (status) {
		case "non-player-killer":
			return "Non-Player Killer";
		case "player-killer-lite":
			return "Player Killer Lite";
		case "player-killer":
			return "Player Killer";
	}
}

/** Preserve all known and future damage bits instead of collapsing mixed damage. */
export function formatInspectionDamageTypes(bits: number): string {
	const names = formatFlagNames(bits, damageTypes, "Unknown damage bits");
	return names.length === 0 ? "Unspecified" : names.join(" / ");
}

/** Decode the complete appraisal mask while retaining visible diagnostics for future bits. */
export function formatInspectionImbuedEffects(bits: number): readonly string[] {
	return formatFlagNames(bits, imbuedEffects, "Unknown imbue bits");
}

export function formatInspectionNumber(value: number): string {
	return inspectionNumberFormat.format(value);
}

export function formatInspectionPercent(value: number): string {
	const percent = value * 100;
	return `${formatInspectionNumber(percent)}%`;
}

export function formatInspectionDuration(seconds: number): string {
	const rounded = Math.round(seconds);
	const sign = rounded < 0 ? "−" : "";
	const total = Math.abs(rounded);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const remainder = total % 60;
	const parts: string[] = [];
	if (hours > 0) {
		parts.push(`${hours}h`);
		if (minutes > 0) parts.push(`${minutes}m`);
		return sign + parts.join(" ");
	}
	if (minutes > 0) parts.push(`${minutes}m`);
	if (remainder > 0 || parts.length === 0) parts.push(`${remainder}s`);
	return sign + parts.join(" ");
}

/** Prefer a word-boundary collapse, splitting only an uninterrupted token. */
export function truncateInspectionDescription(
	description: string,
	maximumCharacters: number,
): string | null {
	if (description.length <= maximumCharacters) return null;
	const prefix = description.slice(0, maximumCharacters);
	if (/\s/u.test(description[maximumCharacters] ?? "")) return prefix.trimEnd();
	const partialWord = prefix.search(/\s+\S*$/u);
	return partialWord > 0 ? prefix.slice(0, partialWord).trimEnd() : prefix;
}

/** Wield clauses are already semantic; this layer owns only user-facing phrasing. */
export function formatWieldRequirement(requirement: WieldRequirement): string {
	const { type, data } = requirement;
	switch (type) {
		case "skill":
			return `${humanizeInspectionName(data.skill)}: ${formatInspectionNumber(data.difficulty)}`;
		case "raw-skill":
			return `Base ${humanizeInspectionName(data.skill)}: ${formatInspectionNumber(data.difficulty)}`;
		case "attribute":
			return `${humanizeInspectionName(data.attribute)}: ${formatInspectionNumber(data.difficulty)}`;
		case "raw-attribute":
			return `Base ${humanizeInspectionName(data.attribute)}: ${formatInspectionNumber(data.difficulty)}`;
		case "vital":
			return `${humanizeInspectionName(data.vital)}: ${formatInspectionNumber(data.difficulty)}`;
		case "raw-vital":
			return `Base ${humanizeInspectionName(data.vital)}: ${formatInspectionNumber(data.difficulty)}`;
		case "level":
			return `Level: ${formatInspectionNumber(data.level)}`;
		case "training":
			return `${humanizeInspectionName(data.skill)}: ${humanizeInspectionName(data.level)}`;
		case "int-stat":
			return `PropertyInt ${data.property}: ${formatInspectionNumber(data.value)}`;
		case "bool-stat":
			return `PropertyBool ${data.property}: ${data.value}`;
		case "creature-type":
			return `Creature Type: ${humanizeInspectionName(data.creatureType)}`;
		case "heritage":
			return `Heritage: ${humanizeInspectionName(data.heritage)}`;
	}
}

export function formatInspectionEffect(effect: ItemEffect): string {
	switch (effect.type) {
		case "biting-strike":
		case "crushing-blow":
			return `${humanizeInspectionName(effect.type)}: ${formatInspectionPercent(effect.data)}`;
		case "slayer":
			return `Slayer: ${humanizeInspectionName(effect.data.creatureType)} (${formatInspectionPercent(effect.data.bonus)})`;
		case "cleaving":
			return `Cleaving: ${formatInspectionNumber(effect.data)}`;
		default:
			return humanizeInspectionName(effect.type);
	}
}

export function formatItemStatuses(
	status: ItemInspection["status"],
): readonly string[] {
	const values: string[] = [];
	if (status.bonded !== null && status.bonded !== "normal")
		values.push(humanizeInspectionName(status.bonded));
	if (status.attuned !== null && status.attuned !== "Normal")
		values.push(humanizeInspectionName(status.attuned));
	if (status.isOpen !== null) values.push(status.isOpen ? "Open" : "Closed");
	if (status.retained === true) values.push("Retained");
	if (status.isLocked !== null)
		values.push(status.isLocked ? "Locked" : "Unlocked");
	if (status.sellable === false) values.push("Not sellable");
	if (status.ivoryable === true) values.push("Ivoryable");
	if (status.unenchantable === true) values.push("Unenchantable");
	return values;
}

export function inspectionBonusLabel(
	kind: ItemInspection["bonuses"][number]["kind"],
): string {
	return {
		attack: "Attack Bonus",
		defense: "Defense Bonus",
		missileDefense: "Missile Defense Bonus",
		magicDefense: "Magic Defense Bonus",
		elementalDamage: "Elemental Damage",
		manaConversion: "Mana Conversion",
		criticalFrequency: "Critical Frequency",
	}[kind];
}
