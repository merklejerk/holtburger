import type {
	ClientSoulEmotes,
	SoulEmoteReference,
} from "./client-soul-emotes";

/** App-owned social shortcuts. The full catalog remains available through chat. */
export const EMOTE_CATEGORIES = [
	{
		label: "Greetings",
		aliases: ["wave", "bow", "curtsey", "salute", "blow kiss", "be seeing you"],
	},
	{
		label: "Reactions",
		aliases: ["laugh", "cheer", "clap", "cry", "shrug", "smack head"],
	},
	{
		label: "Signals",
		aliases: ["nod", "shake head", "beckon", "point", "shoo", "surrender"],
	},
	{
		label: "Attitude",
		aliases: [
			"cross arms",
			"shake fist",
			"mock",
			"plead",
			"tap foot",
			"talk to hand",
		],
	},
	{
		label: "Relax & play",
		aliases: ["sit", "lean", "meditate", "read", "drudge dance", "ymca"],
	},
] as const;

/** Friendly names and deterministic command spelling shared by wheel, Recent, and completion. */
export function presentSoulEmote(reference: SoulEmoteReference): {
	readonly alias: string;
	readonly label: string;
} {
	const preferred = EMOTE_CATEGORIES.flatMap((category) => [
		...category.aliases,
	]).find((alias) =>
		reference.aliases.some((candidate) => candidate.toLowerCase() === alias),
	);
	const alias = preferred ?? reference.aliases[0];
	const label =
		alias === "be seeing you"
			? "Farewell"
			: alias === "ymca"
				? "YMCA"
				: alias.charAt(0).toUpperCase() + alias.slice(1);
	return { alias, label };
}

/** A missing curated alias keeps its position and diagnostic rather than changing category layout. */
export type EmoteWheelEntry =
	| {
			readonly kind: "category";
			readonly label: string;
			readonly index: number;
			readonly disabled: boolean;
	  }
	| {
			readonly kind: "emote";
			readonly label: string;
			readonly alias: string;
			readonly reference: SoulEmoteReference;
	  }
	| {
			readonly kind: "missing";
			readonly label: string;
			readonly detail: string;
	  };

export function emoteWheelEntries(
	catalog: ClientSoulEmotes,
	recent: readonly string[],
	category: number | null,
): readonly EmoteWheelEntry[] {
	if (category === null)
		return [
			...EMOTE_CATEGORIES.map((entry, index) => ({
				kind: "category" as const,
				label: entry.label,
				index,
				disabled: false,
			})),
			{
				kind: "category",
				label: "Recent",
				index: EMOTE_CATEGORIES.length,
				disabled: recent.length === 0,
			},
		];
	if (category === EMOTE_CATEGORIES.length)
		return recent.map((id) => {
			const reference = catalog.pose(id);
			if (reference === undefined)
				throw new Error(`Recent soul-emote identity is missing: ${id}`);
			return { kind: "emote", reference, ...presentSoulEmote(reference) };
		});
	const definition = EMOTE_CATEGORIES[category];
	if (definition === undefined)
		throw new Error(`Unknown emote category: ${category}`);
	return definition.aliases.map((alias) => {
		const reference = catalog.resolve(alias);
		return reference === undefined
			? {
					kind: "missing",
					label: alias,
					detail: `Emote *${alias}* is missing from the mounted catalog.`,
				}
			: { kind: "emote", reference, ...presentSoulEmote(reference) };
	});
}

export function emoteEntryEnabled(entry: EmoteWheelEntry): boolean {
	return (
		entry.kind !== "missing" && (entry.kind !== "category" || !entry.disabled)
	);
}

/** Cyclic visual-order keyboard navigation skips unavailable wedges. */
export function nextEmoteEntry(
	entries: readonly EmoteWheelEntry[],
	current: number,
	direction: -1 | 1,
): number {
	for (let step = 1; step <= entries.length; step++) {
		const index =
			(current + direction * step + entries.length) % entries.length;
		if (emoteEntryEnabled(entries[index])) return index;
	}
	return current;
}
