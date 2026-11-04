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

/** Every query term must match one word; terms can match different text fields. */
export function matchesSearchTerms(
	words: readonly string[],
	terms: readonly string[],
): boolean {
	return terms.every((term) => words.some((word) => subsequence(term, word)));
}
