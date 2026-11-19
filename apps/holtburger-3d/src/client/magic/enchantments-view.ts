import { z } from "zod";
import { groupCooldownSchema } from "../world/entity-mirror";
import { textSearchWords } from "../../app/text-search";
import type { SpellRow } from "./spells";
import {
	matchesSpellSearch,
	spellFilterGroups,
	type SpellSearch,
} from "./spell-search";

const u16 = z.number().int().nonnegative().max(0xffff);
const u32 = z.number().int().nonnegative().max(0xffff_ffff);

const enchantmentKeySchema = z.object({ spellId: u16, layer: u16 }).strict();

/** Shared world-owned affected-stat identity, independent of display labels. */
const affectedStatSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("attribute"), key: u32 }).strict(),
	z.object({ kind: z.literal("vital"), key: u32 }).strict(),
	z.object({ kind: z.literal("skill"), key: u32 }).strict(),
	z
		.object({
			kind: z.literal("resistance"),
			key: z.enum([
				"slash",
				"pierce",
				"bludgeon",
				"fire",
				"cold",
				"acid",
				"electric",
				"nether",
			]),
		})
		.strict(),
	z.object({ kind: z.literal("intProperty"), key: u32 }).strict(),
	z.object({ kind: z.literal("floatProperty"), key: u32 }).strict(),
	z.object({ kind: z.literal("armor") }).strict(),
	z.object({ kind: z.literal("damage") }).strict(),
	z.object({ kind: z.literal("damageVariance") }).strict(),
	z.object({ kind: z.literal("other"), key: z.tuple([u32, u32]) }).strict(),
]);

const enchantmentInstanceSchema = z
	.object({
		key: enchantmentKeySchema,
		spellCategory: u16,
		powerLevel: u32,
		kind: z.enum(["beneficial", "harmful", "vitae"]),
		remainingSeconds: z.number().finite().nonnegative().nullable(),
		statModType: u32,
		statModKey: u32,
		statModValue: z.number().finite(),
	})
	.strict();

const enchantmentGroupSchema = z
	.object({
		affectedStat: affectedStatSchema,
		/** Authoritative display label formatted by world. */
		statLabel: z.string().min(1),
		operation: z.enum(["additive", "multiplicative", "other"]),
		channel: z.enum(["ordinary", "attackSkills", "defenseSkills"]),
		spellCategory: u16,
		effective: enchantmentKeySchema,
		overridden: z.array(enchantmentKeySchema),
	})
	.strict();

export const resolvedEnchantmentsSchema = z
	.object({
		instances: z.array(enchantmentInstanceSchema),
		groups: z.array(enchantmentGroupSchema),
		cooldowns: z.array(groupCooldownSchema),
	})
	.strict();

export type ResolvedEnchantments = z.infer<typeof resolvedEnchantmentsSchema>;

export function decodeResolvedEnchantments(
	value: unknown,
): ResolvedEnchantments {
	return resolvedEnchantmentsSchema.parse(value);
}

type Instance = ResolvedEnchantments["instances"][number];
type Group = ResolvedEnchantments["groups"][number];
type Stat = Group["affectedStat"];

/** One repeated view of a live instance under a contributing stat. */
export interface EnchantmentDisplayRow {
	readonly instance: Instance;
	readonly spell: SpellRow | null;
}

/** An effective spell with its overridden children, or a standalone vitae record. */
interface EnchantmentDisplayGroup {
	readonly id: string;
	readonly effective: EnchantmentDisplayRow;
	readonly overridden: readonly EnchantmentDisplayRow[];
	/** Search matched a child, so its effective parent is retained for context. */
	readonly contextualParent: boolean;
}

/** Stable affected-stat heading with independently effective roots. */
export interface EnchantmentDisplaySection {
	readonly id: string;
	readonly label: string;
	/** Display-only vitae percentage; the spell remains a distinct registry record. */
	readonly value?: string;
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

/** Visibility and animation identity are computed together by the tray presentation owner. */
interface EnchantmentTrayStatus {
	/** Only effective ordinary effects and vitae make the category visible. */
	readonly visible: boolean;
	/** Sorted registry/contribution identity; local countdown display never changes it. */
	readonly identity: string;
}

/** One presentation snapshot for each enchantment tray button. */
export interface EnchantmentTrayPresentation {
	readonly beneficial: EnchantmentTrayStatus;
	readonly harmful: EnchantmentTrayStatus;
}

/** Keep retail visibility policy while observing changes to each category's registry. */
export function presentEnchantmentTray(
	resolved: ResolvedEnchantments | null,
): EnchantmentTrayPresentation {
	const instances = new Map(
		(resolved?.instances ?? []).map((instance) => [
			enchantmentKey(instance.key),
			instance,
		]),
	);
	const project = (kind: "beneficial" | "harmful"): EnchantmentTrayStatus => {
		const belongs = (instance: Instance) =>
			instance.kind === kind ||
			(kind === "harmful" && instance.kind === "vitae");
		const records = [...instances.values()].filter(belongs);
		const contributions = (resolved?.groups ?? []).filter((group) => {
			const instance = instances.get(enchantmentKey(group.effective));
			if (instance === undefined)
				throw new Error(
					`Enchantment group references missing instance ${enchantmentKey(group.effective)}`,
				);
			return belongs(instance);
		});
		// RETAIL DIVERGENCE: counts all ordinary registry insertions. Showing effective
		// contributions only affects client presentation, not game content. The local DAT
		// census has 4,375 definitions; no live population census was available. RETAIL
		// DIVERGENCE: gives vitae its own indicator. Grouping it under Harmful keeps the panel
		// reachable for vitae alone; restoring that icon removes this route. The DAT census
		// found spell 666, without live population data.
		return {
			visible:
				contributions.length > 0 ||
				records.some((instance) => instance.kind === "vitae"),
			identity: JSON.stringify([
				records
					.map(
						({
							key,
							spellCategory,
							powerLevel,
							kind,
							statModType,
							statModKey,
							statModValue,
						}) =>
							JSON.stringify([
								enchantmentKey(key),
								spellCategory,
								powerLevel,
								kind,
								statModType,
								statModKey,
								statModValue,
							]),
					)
					.sort(),
				contributions
					.map((group) =>
						JSON.stringify([
							statId(group.affectedStat),
							group.operation,
							group.channel,
							group.spellCategory,
							enchantmentKey(group.effective),
						]),
					)
					.sort(),
			]),
		};
	};
	return { beneficial: project("beneficial"), harmful: project("harmful") };
}

function statId(stat: Stat): string {
	return stat.kind === "other"
		? `${stat.kind}:${stat.key[0]}:${stat.key[1]}`
		: "key" in stat
			? `${stat.kind}:${stat.key}`
			: stat.kind;
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
	const terms = textSearchWords(search.text);
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
		const tags = new Set<string>([
			item.instance.kind === "vitae" ? "harmful" : item.instance.kind,
		]);
		if (item.spell?.details !== null && item.spell?.details !== undefined) {
			if (item.spell.details.school.kind === "known")
				tags.add(`school:${item.spell.details.school.school}`);
		}
		return matchesSpellSearch(
			{ words: [...statWords, ...textSearchWords(rowName(item))], tags },
			terms,
			pills,
		);
	};
	const sections = new Map<
		string,
		{
			label: string;
			value?: string;
			words: readonly string[];
			groups: EnchantmentDisplayGroup[];
		}
	>();
	for (const group of resolved.groups) {
		const id = statId(group.affectedStat);
		let section = sections.get(id);
		if (section === undefined) {
			const label = group.statLabel;
			section = { label, words: textSearchWords(label), groups: [] };
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
			effective,
			overridden,
			contextualParent: !parentMatches,
		});
	}
	const vitae = resolved.instances.filter(
		(instance) => instance.kind === "vitae",
	);
	if (vitae.length > 0) {
		const label = "Vitae penalty";
		const words = textSearchWords(label);
		const groups = vitae.flatMap((instance): EnchantmentDisplayGroup[] => {
			const effective = row(instance.key);
			return matches(effective, words)
				? [
						{
							id: `vitae:${enchantmentKey(instance.key)}`,
							effective,
							overridden: [],
							contextualParent: false,
						},
					]
				: [];
		});
		// ACE maintains one vitae record. Avoid inventing an aggregate percentage
		// if a custom server sends several independently classified records.
		const [singleVitae, secondVitae] = vitae;
		const value =
			singleVitae !== undefined && secondVitae === undefined
				? `${Math.round((1 - singleVitae.statModValue) * 100)}%`
				: undefined;
		sections.set("vitae", { label, value, words, groups });
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
				: [
						{
							id,
							label: section.label,
							value: section.value,
							groups: [first, ...rest],
						},
					];
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
