import { describe, expect, it } from "vitest";
import {
	matchesSearchTerms,
	rankSearchTerms,
	textSearchWords,
} from "./text-search";

describe("ranked text search", () => {
	const rank = (name: string, query: string) =>
		rankSearchTerms(textSearchWords(name), textSearchWords(query));
	it("orders exact, prefix, substring and word-local subsequence matches", () => {
		const names = ["Oracle", "War Orc", "Orchid", "Orc"];
		expect(
			names.sort((a, b) => Number(rank(a, "orc")) - Number(rank(b, "orc"))),
		).toEqual(["Orc", "Orchid", "War Orc", "Oracle"]);
	});
	it("normalizes case, Unicode, punctuation and whitespace consistently", () => {
		expect(rank("Élan's—Acid!", " ÉLAN S acid ")).toBe(0);
	});
	it.each([
		{ query: "", matches: true },
		{ query: "...", matches: true },
		{ query: "oth amr", matches: true },
		{ query: "armor armor", matches: true },
		{ query: "armoth", matches: false },
		{ query: "acid", matches: false },
	])(
		"admits '$query': $matches in both filtering and ranking",
		({ query, matches }) => {
			const words = textSearchWords("Armor Other");
			const terms = textSearchWords(query);
			expect(matchesSearchTerms(words, terms)).toBe(matches);
			expect(rankSearchTerms(words, terms) !== null).toBe(matches);
		},
	);
});
