/** Normalize identically for names and queries; punctuation separates words. */
export function textSearchWords(text: string): readonly string[] {
	return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
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

/** Lower ranks win: normalized exact text, prefix, substring, then word-local subsequence.
 * Every term must match a word; terms may be reordered or match different fields.
 * An empty query matches all text at rank zero.
 */
export function rankSearchTerms(
	words: readonly string[],
	terms: readonly string[],
): number | null {
	if (!matchesSearchTerms(words, terms)) return null;
	if (terms.length === 0) return 0;
	const text = words.join(" ");
	const query = terms.join(" ");
	if (text === query) return 0;
	if (text.startsWith(query)) return 1;
	if (text.includes(query)) return 2;
	return 3;
}

/** Shared admission: every query term must match one word, possibly in different fields. */
export function matchesSearchTerms(
	words: readonly string[],
	terms: readonly string[],
): boolean {
	return terms.every((term) => words.some((word) => subsequence(term, word)));
}
