import type { SpellDetails } from "../app/spell-references";

/** Typed frontend pill identities; shared classification fields remain the source facts. */
export type SpellFilterTag = (typeof SPELL_FILTER_OPTIONS)[number][0];

/** A cold panel query retained by the character's app-local spell owner. */
export interface SpellSearch {
	/** Unnormalized text shown in the search input. */
	readonly text: string;
	/** Selected pills; union within a category, intersection across categories. */
	readonly tags: readonly SpellFilterTag[];
}

/** UI-owned vocabulary; the content contract supplies facts rather than labels. */
export const SPELL_FILTER_OPTIONS = [
	["beneficial", "Beneficial", "disposition"],
	["harmful", "Harmful", "disposition"],
	["self-target", "Self", "target"],
	["other", "Other", "target"],
	["item-target", "Item target", "target"],
	["untargeted", "Untargeted", "target"],
	["fellowship", "Fellowship", "target"],
	["school:4", "Creature", "school"],
	["school:2", "Life", "school"],
	["school:3", "Item", "school"],
	["school:1", "War", "school"],
	["school:5", "Void", "school"],
	["direct", "Direct", "damage"],
	["acid", "Acid", "damage"],
	["bludgeoning", "Bludgeoning", "damage"],
	["frost", "Frost", "damage"],
	["lightning", "Lightning", "damage"],
	["fire", "Fire", "damage"],
	["piercing", "Piercing", "damage"],
	["slashing", "Slashing", "damage"],
	["nether", "Nether", "damage"],
	["level:1", "Level I", "level"],
	["level:2", "Level II", "level"],
	["level:3", "Level III", "level"],
	["level:4", "Level IV", "level"],
	["level:5", "Level V", "level"],
	["level:6", "Level VI", "level"],
	["level:7", "Level VII", "level"],
	["level:8", "Level VIII", "level"],
] as const;

/** Normalize identically for names and queries; punctuation separates words. */
export function spellSearchWords(text: string): readonly string[] {
	return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Precomputed search data for one reference publication, independent of icons. */
export interface SpellSearchEntry {
	/** Normalized name words, created once per reference publication. */
	readonly words: readonly string[];
	/** Pill identities derived from available static classification facts. */
	readonly tags: ReadonlySet<string>;
}

/** Turn static facts into the frontend's pill identities once per row. */
export function spellSearchEntry(
	name: string,
	details: SpellDetails | null,
): SpellSearchEntry {
	const tags = new Set<string>();
	if (details !== null) {
		const { classification } = details;
		tags.add(classification.beneficial ? "beneficial" : "harmful");
		tags.add(`school:${details.school}`);
		if (classification.level !== null)
			tags.add(`level:${classification.level}`);
		if (classification.target !== null) tags.add(classification.target);
		if (classification.damage !== null) tags.add(classification.damage);
		if (classification.fellowship) tags.add("fellowship");
	}
	return { words: spellSearchWords(name), tags };
}

/** Characters may be skipped within a word, but may never cross word boundaries. */
function subsequence(term: string, word: string): boolean {
	const remaining = term[Symbol.iterator]();
	let next = remaining.next();
	for (const character of word) {
		if (character !== next.value) continue;
		next = remaining.next();
		if (next.done) return true;
	}
	return false;
}

/** Group selected pills once per query change, using the same categories as their colors. */
export function spellFilterGroups(
	tags: readonly SpellFilterTag[],
): readonly (readonly SpellFilterTag[])[] {
	const groups = new Map<string, SpellFilterTag[]>();
	for (const [tag, , category] of SPELL_FILTER_OPTIONS) {
		if (!tags.includes(tag)) continue;
		const group = groups.get(category);
		if (group === undefined) groups.set(category, [tag]);
		else group.push(tag);
	}
	return [...groups.values()];
}

/** Match any pill in each selected category, and every normalized search term. */
export function matchesSpellSearch(
	entry: SpellSearchEntry,
	terms: readonly string[],
	groups: readonly (readonly SpellFilterTag[])[],
): boolean {
	return (
		groups.every((tags) => tags.some((tag) => entry.tags.has(tag))) &&
		terms.every((term) => entry.words.some((word) => subsequence(term, word)))
	);
}
