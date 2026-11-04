import { describe, expect, it } from "vitest";
import { entityDisplayName } from "./entity-display-name";

describe("entity display names", () => {
	it.each(["", " \t\n"])("identifies unnamed entities for %j", (name) => {
		expect(entityDisplayName(name, 0x7c5a9007)).toBe("[Unnamed · 0x7C5A9007]");
		expect(entityDisplayName(name, 7)).toBe("[Unnamed · 0x00000007]");
	});

	it.each(["Drudge", "Unnamed entity", "  Authored name  "])(
		"preserves authored text %j",
		(name) => expect(entityDisplayName(name, 7)).toBe(name),
	);
});
