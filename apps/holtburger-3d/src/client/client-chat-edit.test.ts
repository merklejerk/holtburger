import { expect, it } from "vitest";
import { chatWordDeletionStart } from "./client-chat-edit";

it.each([
	["hello world", 11, 11, "hello "],
	["hello world   ", 14, 14, "hello "],
	["hello world", 9, 9, "hello ld"],
	["hello world", 6, 11, "hello "],
	["hello world", 0, 0, "hello world"],
	["   ", 3, 3, ""],
	["/tell player,name", 17, 17, "/tell "],
	["hello 世界🌸", 10, 10, "hello "],
])(
	"deletes selected text or the previous word in %s",
	(text, start, end, expected) => {
		const boundary = chatWordDeletionStart(text, start, end);
		expect(text.slice(0, boundary) + text.slice(end)).toBe(expected);
	},
);
