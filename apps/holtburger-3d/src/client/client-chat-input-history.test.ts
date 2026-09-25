import { describe, expect, it } from "vitest";

import { navigateSentChat, recordSentChat } from "./client-chat-input-history";

function expectNavigation(
	value: ReturnType<typeof navigateSentChat>,
): NonNullable<ReturnType<typeof navigateSentChat>> {
	if (value === null) throw new Error("Expected a history navigation result.");
	return value;
}

describe("sent chat input history", () => {
	it.each([
		{ limit: 0, expected: [] },
		{ limit: 1, expected: ["repeated"] },
		{ limit: 2, expected: ["repeated", "repeated"] },
		{ limit: 3, expected: ["second", "repeated", "repeated"] },
		{ limit: 5, expected: ["first", "second", "repeated", "repeated"] },
	])(
		"retains ordered input, including repeats, with limit $limit",
		({ limit, expected }) => {
			let history: readonly string[] = [];
			for (const message of ["first", "second", "repeated", "repeated"])
				history = recordSentChat(history, message, limit);
			expect(history).toEqual(expected);
		},
	);

	it("walks older sends and restores the unsent draft after the newest", () => {
		const history = ["first", "second"];
		const latest = expectNavigation(
			navigateSentChat(history, null, "unsent", "older"),
		);
		expect(latest).toEqual({
			recall: { index: 1, draft: "unsent" },
			message: "second",
		});
		const older = expectNavigation(
			navigateSentChat(history, latest.recall, latest.message, "older"),
		);
		expect(older).toEqual({
			recall: { index: 0, draft: "unsent" },
			message: "first",
		});
		expect(navigateSentChat(history, older.recall, "first", "older")).toEqual(
			older,
		);
		expect(navigateSentChat(history, older.recall, "first", "newer")).toEqual(
			latest,
		);
		expect(navigateSentChat(history, latest.recall, "second", "newer")).toEqual(
			{ recall: null, message: "unsent" },
		);
		expect(navigateSentChat(history, null, "unsent", "newer")).toBeNull();
		expect(navigateSentChat([], null, "unsent", "older")).toBeNull();
	});
});
