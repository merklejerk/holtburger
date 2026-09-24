import type { SpellRow } from "./client-spells";
import type { ResolvedEnchantments } from "./client-enchantments-contract";
import {
	matchesSpellSearch,
	spellFilterGroups,
	spellSearchWords,
	type SpellSearch,
} from "./client-spell-search";

type Instance = ResolvedEnchantments["instances"][number];
type Group = ResolvedEnchantments["groups"][number];
type Stat = Group["affectedStat"];

/** One repeated view of a live instance under a contributing stat. */
export interface EnchantmentDisplayRow {
	readonly instance: Instance;
	readonly spell: SpellRow | null;
}

/** One effective category/query family and the children it overrides. */
interface EnchantmentDisplayGroup {
	readonly id: string;
	readonly source: Group;
	readonly effective: EnchantmentDisplayRow;
	readonly overridden: readonly EnchantmentDisplayRow[];
	/** Search matched a child, so its effective parent is retained for context. */
	readonly contextualParent: boolean;
}

/** Stable affected-stat heading with independently effective roots. */
export interface EnchantmentDisplaySection {
	readonly id: string;
	readonly label: string;
	/** Empty headings are omitted; the first group supplies the heading's sort priority. */
	readonly groups: readonly [
		EnchantmentDisplayGroup,
		...EnchantmentDisplayGroup[],
	];
}

export type EnchantmentSortField = "name" | "power" | "duration";

export function enchantmentKey(id: {
	readonly spellId: number;
	readonly layer: number;
}): string {
	return `${id.spellId}:${id.layer}`;
}

/** Presence counts unique effective ordinary instances, not repeated stat rows. */
export function effectiveEnchantmentKinds(
	resolved: ResolvedEnchantments | null,
): { readonly beneficial: boolean; readonly harmful: boolean } {
	if (resolved === null) return { beneficial: false, harmful: false };
	const instances = new Map(
		resolved.instances.map((instance) => [
			enchantmentKey(instance.key),
			instance,
		]),
	);
	// RETAIL DIVERGENCE: acclient.c:425784-425812 counts every ordinary registry insertion.
	// These icons show only effective contributions, a client-only presentation choice;
	// game content cannot observe the indicator count. The local DAT census contains 4,375
	// enchantment definitions, but no live-registry population census was available.
	let beneficial = false;
	let harmful = false;
	for (const group of resolved.groups) {
		const kind = instances.get(enchantmentKey(group.effective))?.kind;
		if (kind === "beneficial") beneficial = true;
		if (kind === "harmful") harmful = true;
	}
	return { beneficial, harmful };
}

function statId(stat: Stat): string {
	return stat.kind === "other"
		? `${stat.kind}:${stat.key[0]}:${stat.key[1]}`
		: "key" in stat
			? `${stat.kind}:${stat.key}`
			: stat.kind;
}

const PROPERTY_LABELS: Readonly<Record<string, string>> = {
	HealthRate: "Health regeneration rate",
	StaminaRate: "Stamina regeneration rate",
	ManaRate: "Mana regeneration rate",
};

function propertyLabel(symbol: string): string {
	const words = symbol
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
	const label = words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
	if (!label.startsWith("Resist ")) return label;
	const damageType = label.slice("Resist ".length);
	return `${damageType.charAt(0).toUpperCase()}${damageType.slice(1)} resistance`;
}

/** UI wording for shared stat names; unknown keys retain their numeric identity. */
function enchantmentStatLabel(stat: Stat, statName?: string): string {
	switch (stat.kind) {
		case "attribute":
			return statName ?? `Attribute ${stat.key}`;
		case "vital":
			return statName?.startsWith("Max")
				? `Maximum ${statName.slice(3).toLowerCase()}`
				: (statName ?? `Vital ${stat.key}`);
		case "skill":
			return statName ?? `Skill ${stat.key}`;
		case "intProperty":
			return statName === undefined
				? `Integer property ${stat.key}`
				: (PROPERTY_LABELS[statName] ?? propertyLabel(statName));
		case "floatProperty":
			return statName === undefined
				? `Float property ${stat.key}`
				: (PROPERTY_LABELS[statName] ?? propertyLabel(statName));
		case "armor":
			return "Armor";
		case "damage":
			return "Damage";
		case "damageVariance":
			return "Damage variance";
		case "other":
			return `Other effect ${stat.key[0]} / ${stat.key[1]}`;
	}
}

function rowName(row: EnchantmentDisplayRow): string {
	return row.spell?.name ?? `Spell ${row.instance.key.spellId}`;
}

function compareRemainingSeconds(a: number | null, b: number | null): number {
	// Soonest expiration first; permanent effects follow timed effects.
	if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
	return a - b;
}

function compareRows(
	a: EnchantmentDisplayRow,
	b: EnchantmentDisplayRow,
	field: EnchantmentSortField,
): number {
	let order = 0;
	switch (field) {
		case "name":
			order = rowName(a).localeCompare(rowName(b));
			break;
		case "power":
			order = b.instance.powerLevel - a.instance.powerLevel;
			break;
		case "duration":
			order = compareRemainingSeconds(
				a.instance.remainingSeconds,
				b.instance.remainingSeconds,
			);
			break;
	}
	return (
		order ||
		a.instance.key.spellId - b.instance.key.spellId ||
		a.instance.key.layer - b.instance.key.layer
	);
}

/** Apply known-spell name matching and live disposition/school pills to shared groups. */
export function projectEnchantmentSections(
	resolved: ResolvedEnchantments,
	spells: ReadonlyMap<number, SpellRow>,
	search: SpellSearch,
	sortField: EnchantmentSortField,
): readonly EnchantmentDisplaySection[] {
	const instances = new Map(
		resolved.instances.map((instance) => [
			enchantmentKey(instance.key),
			instance,
		]),
	);
	const terms = spellSearchWords(search.text);
	const pills = spellFilterGroups(search.tags);
	const row = (key: Group["effective"]): EnchantmentDisplayRow => {
		const instance = instances.get(enchantmentKey(key));
		if (instance === undefined)
			throw new Error(
				`Enchantment group references missing instance ${enchantmentKey(key)}`,
			);
		return { instance, spell: spells.get(key.spellId) ?? null };
	};
	const matches = (
		item: EnchantmentDisplayRow,
		statWords: readonly string[],
	): boolean => {
		const tags = new Set<string>([item.instance.kind]);
		if (item.spell?.details !== null && item.spell?.details !== undefined)
			tags.add(`school:${item.spell.details.school}`);
		return matchesSpellSearch(
			{ words: [...statWords, ...spellSearchWords(rowName(item))], tags },
			terms,
			pills,
		);
	};
	const sections = new Map<
		string,
		{
			label: string;
			words: readonly string[];
			groups: EnchantmentDisplayGroup[];
		}
	>();
	for (const group of resolved.groups) {
		const id = statId(group.affectedStat);
		let section = sections.get(id);
		if (section === undefined) {
			const label = enchantmentStatLabel(group.affectedStat, group.statName);
			section = { label, words: spellSearchWords(label), groups: [] };
			sections.set(id, section);
		}
		const effective = row(group.effective);
		const parentMatches = matches(effective, section.words);
		const overridden = group.overridden
			.map(row)
			.filter((child) => matches(child, section.words));
		if (!parentMatches && overridden.length === 0) continue;
		section.groups.push({
			id: `${id}:${group.operation}:${group.channel}:${group.spellCategory}`,
			source: group,
			effective,
			overridden,
			contextualParent: !parentMatches,
		});
	}
	return [...sections.entries()]
		.flatMap(([id, section]): EnchantmentDisplaySection[] => {
			const [first, ...rest] = section.groups.sort(
				(a, b) =>
					compareRows(a.effective, b.effective, sortField) ||
					a.id.localeCompare(b.id),
			);
			return first === undefined
				? []
				: [{ id, label: section.label, groups: [first, ...rest] }];
		})
		.sort((a, b) => {
			const byLabel =
				a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
			if (sortField === "name") return byLabel;
			// Rows are already sorted: their first effect has the highest power or
			// the shortest remaining duration among this heading's effective spells.
			const aLead = a.groups[0];
			const bLead = b.groups[0];
			const aInstance = aLead.effective.instance;
			const bInstance = bLead.effective.instance;
			const byEffect =
				sortField === "power"
					? bInstance.powerLevel - aInstance.powerLevel
					: compareRemainingSeconds(
							aInstance.remainingSeconds,
							bInstance.remainingSeconds,
						);
			return byEffect || byLabel;
		});
}
