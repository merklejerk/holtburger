/** One inline segment of a plain-text chat message after entity-mention recognition. */
export type ChatEntityTextSpan =
	| {
			readonly kind: "text";
			/** Exact unmatched substring; coordinate recognition still applies during rendering. */
			readonly text: string;
	  }
	| {
			readonly kind: "entity";
			/** Parsed non-zero unsigned 32-bit entity GUID. */
			readonly guid: number;
			/** Trimmed display label captured from the bracketed portion of `[Label](0xHEX)`. */
			readonly text: string;
	  };

/** Markdown-style inline entity mention: `[Label](0xHEX)` with 1..=8 hex digits. */
const CHAT_ENTITY_MENTION_PATTERN =
	/\[([^[\]\r\n]+)\]\(0[xX]([0-9a-fA-F]{1,8})\)/g;

/**
 * Split plain chat text into literal runs and explicit `[Label](0xHEX)` entity mentions.
 * Invalid candidates (whitespace-only labels or zero GUIDs) remain literal text.
 */
export function chatEntityTextSpans(
	text: string,
): readonly ChatEntityTextSpan[] {
	const spans: ChatEntityTextSpan[] = [];
	let end = 0;
	for (const match of text.matchAll(CHAT_ENTITY_MENTION_PATTERN)) {
		const rawLabel = match[1];
		const hex = match[2];
		if (rawLabel === undefined || hex === undefined) continue;
		const label = rawLabel.trim();
		if (label.length === 0) continue;
		const guid = Number.parseInt(hex, 16) >>> 0;
		if (guid === 0) continue;
		if (match.index > end)
			spans.push({ kind: "text", text: text.slice(end, match.index) });
		spans.push({ kind: "entity", guid, text: label });
		end = match.index + match[0].length;
	}
	if (end < text.length) spans.push({ kind: "text", text: text.slice(end) });
	return spans;
}

/**
 * Format a non-zero unsigned 32-bit entity reference as `[Label](0xHEX)` for plain-text chat.
 * Callers must pass a non-zero entity GUID.
 */
export function formatChatEntityMention(name: string, guid: number): string {
	const label = name.replace(/[[\]\r\n]+/g, " ").trim() || "Entity";
	const hex = (guid >>> 0).toString(16).padStart(8, "0");
	return `[${label}](0x${hex})`;
}

/**
 * Insert a formatted mention into a chat draft, replacing `[selectionStart, selectionEnd)`.
 * Adds single-space separation from adjacent non-whitespace text and appends a trailing space
 * at end-of-draft so the user can continue typing immediately.
 */
export function insertChatMention(
	draft: string,
	selectionStart: number,
	selectionEnd: number,
	mention: string,
): { readonly message: string; readonly caret: number } {
	const clamp = (offset: number): number =>
		Math.max(0, Math.min(draft.length, Math.trunc(offset)));
	const start = clamp(Math.min(selectionStart, selectionEnd));
	const end = clamp(Math.max(selectionStart, selectionEnd));
	const before = draft.slice(0, start);
	const after = draft.slice(end);
	const leadingSpace = before.length > 0 && !/\s$/.test(before) ? " " : "";
	const trailingSpace = after.length === 0 || !/^\s/.test(after) ? " " : "";
	const inserted = `${leadingSpace}${mention}${trailingSpace}`;
	return {
		message: `${before}${inserted}${after}`,
		caret: before.length + inserted.length,
	};
}
