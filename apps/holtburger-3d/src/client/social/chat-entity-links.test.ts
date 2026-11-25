import { describe, expect, it } from "vitest";
import {
	chatEntityTextSpans,
	formatChatEntityMention,
	insertChatMention,
} from "./chat-entity-links";

describe("chatEntityTextSpans", () => {
	it("returns an empty array for empty text", () => {
		expect(chatEntityTextSpans("")).toEqual([]);
	});

	it("returns a single text span when no mentions exist", () => {
		expect(chatEntityTextSpans("Meet at 42.3N, 15.8E")).toEqual([
			{ kind: "text", text: "Meet at 42.3N, 15.8E" },
		]);
	});

	it("parses multiple mentions alongside surrounding text and coordinates", () => {
		expect(
			chatEntityTextSpans(
				"Bring [Key](0x80000001) to [Chest (Locked)](0X00abcdef) at 42.3N, 15.8E!",
			),
		).toEqual([
			{ kind: "text", text: "Bring " },
			{ kind: "entity", guid: 0x80000001, text: "Key" },
			{ kind: "text", text: " to " },
			{ kind: "entity", guid: 0x00abcdef, text: "Chest (Locked)" },
			{ kind: "text", text: " at 42.3N, 15.8E!" },
		]);
	});

	it("supports full unsigned 32-bit GUIDs, padded labels, and Unicode labels", () => {
		expect(chatEntityTextSpans("[Max](0xffffffff)")).toEqual([
			{ kind: "entity", guid: 0xffffffff, text: "Max" },
		]);
		expect(chatEntityTextSpans("[  Portal  ](0x1a)")).toEqual([
			{ kind: "entity", guid: 0x1a, text: "Portal" },
		]);
		expect(chatEntityTextSpans("[Aun'Merkle — ★](0x50000003)")).toEqual([
			{ kind: "entity", guid: 0x50000003, text: "Aun'Merkle — ★" },
		]);
	});

	it("leaves zero GUIDs, over-wide hex values, and blank labels as plain text", () => {
		const text =
			"[Zero](0x0) [Zero8](0x00000000) [Wide](0x123456789) [   ](0x80000001) [](0x80000001)";
		expect(chatEntityTextSpans(text)).toEqual([{ kind: "text", text }]);
	});

	it("preserves adjacent invalid candidates without blocking a following valid mention", () => {
		expect(chatEntityTextSpans("[Zero](0x0)[Valid](0x1)")).toEqual([
			{ kind: "text", text: "[Zero](0x0)" },
			{ kind: "entity", guid: 0x1, text: "Valid" },
		]);
	});

	it("matches only the innermost bracketed segment when stray brackets precede a mention", () => {
		expect(chatEntityTextSpans("[outer [Inner](0x80000042)")).toEqual([
			{ kind: "text", text: "[outer " },
			{ kind: "entity", guid: 0x80000042, text: "Inner" },
		]);
	});
});

describe("formatChatEntityMention", () => {
	it("formats an entity name and zero-padded 8-digit lowercase hex GUID", () => {
		expect(formatChatEntityMention("Portal to Arwic", 0x00012a3f)).toBe(
			"[Portal to Arwic](0x00012a3f)",
		);
		expect(formatChatEntityMention("Olthoi Noble", 0x80001234)).toBe(
			"[Olthoi Noble](0x80001234)",
		);
	});

	it("strips brackets and newlines from labels and falls back to Entity if blank", () => {
		expect(formatChatEntityMention("[Weird]\nName", 0x1234)).toBe(
			"[Weird Name](0x00001234)",
		);
		expect(formatChatEntityMention("  []  ", 0x1234)).toBe(
			"[Entity](0x00001234)",
		);
	});
});

describe("insertChatMention", () => {
	it("inserts into an empty draft with a trailing space", () => {
		expect(insertChatMention("", 0, 0, "[Portal](0x80000001)")).toEqual({
			message: "[Portal](0x80000001) ",
			caret: 21,
		});
	});

	it("adds a separating space when appending directly after text", () => {
		expect(insertChatMention("/f check", 8, 8, "[Portal](0x80000001)")).toEqual(
			{
				message: "/f check [Portal](0x80000001) ",
				caret: 30,
			},
		);
	});

	it("replaces a highlighted selection range cleanly", () => {
		expect(
			insertChatMention("check target now", 6, 12, "[Portal](0x80000001)"),
		).toEqual({
			message: "check [Portal](0x80000001) now",
			caret: 26,
		});
	});

	it("handles start-of-draft, mid-word, existing spaces, and clamped offsets", () => {
		expect(insertChatMention("look", 0, 0, "[M](0x1)")).toEqual({
			message: "[M](0x1) look",
			caret: 9,
		});
		expect(insertChatMention("abcd", 2, 2, "[M](0x1)")).toEqual({
			message: "ab [M](0x1) cd",
			caret: 12,
		});
		expect(insertChatMention("foo bar", 3, 3, "[M](0x1)")).toEqual({
			message: "foo [M](0x1) bar",
			caret: 12,
		});
		expect(insertChatMention("look  now", 5, 5, "[M](0x1)")).toEqual({
			message: "look [M](0x1) now",
			caret: 13,
		});
		expect(insertChatMention("hi", 99, -5, "[M](0x1)")).toEqual({
			message: "[M](0x1) ",
			caret: 9,
		});
	});
});
