/** A recalled entry keeps the unsent draft available after the newest entry. */
export interface ChatInputRecall {
	/** Zero-based position in the app-owned sent history. */
	readonly index: number;
	/** Unsent text restored when navigation passes the newest entry. */
	readonly draft: string;
}

/** Retain locally queued input in order, including repeats, up to a nonnegative entry limit. */
export function recordSentChat(
	history: readonly string[],
	message: string,
	limit: number,
): readonly string[] {
	return [...history, message].slice(Math.max(0, history.length + 1 - limit));
}

function entryAt(history: readonly string[], index: number): string {
	const entry = history[index];
	if (entry === undefined) throw new Error("Chat history position is invalid.");
	return entry;
}

/** Move through sent input, with null recall representing the live draft. */
export function navigateSentChat(
	history: readonly string[],
	recall: ChatInputRecall | null,
	currentMessage: string,
	direction: "older" | "newer",
): {
	readonly recall: ChatInputRecall | null;
	readonly message: string;
} | null {
	if (history.length === 0) return null;
	if (recall === null) {
		if (direction === "newer") return null;
		return {
			recall: { index: history.length - 1, draft: currentMessage },
			message: entryAt(history, history.length - 1),
		};
	}
	if (direction === "newer" && recall.index === history.length - 1)
		return { recall: null, message: recall.draft };
	const index = Math.max(
		0,
		Math.min(
			history.length - 1,
			recall.index + (direction === "older" ? -1 : 1),
		),
	);
	return { recall: { ...recall, index }, message: entryAt(history, index) };
}
