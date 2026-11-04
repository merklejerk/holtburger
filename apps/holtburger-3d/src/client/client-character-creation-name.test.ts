import { describe, expect, it } from "vitest";
import {
	creationNameSchema,
	MAX_CREATION_NAME_LENGTH,
} from "./client-character-creation-name";
import { characterCreationDraftSchema } from "./client-character-creation-contract";

describe("creator name screening", () => {
	it.each(["Amy", "Éowyn", "O'Brien", "Al-Mu'alim", "Lady Amy", "MiXeD CaSe"])(
		"accepts supported name %s without changing case",
		(name) => expect(creationNameSchema.parse(name)).toBe(name),
	);
	it("trims boundary spaces for submission while preserving internal spacing", () => {
		expect(creationNameSchema.parse("  Lady  Amy  ")).toBe("Lady  Amy");
	});
	it.each(["", "   "])("rejects an empty name %j", (name) => {
		const result = creationNameSchema.safeParse(name);
		expect(result.success).toBe(false);
		if (!result.success)
			expect(result.error.issues[0].message).toBe("Enter a character name.");
	});
	it("accepts the length boundary and rejects the next character", () => {
		const name = "A".repeat(MAX_CREATION_NAME_LENGTH);
		expect(creationNameSchema.parse(name)).toBe(name);
		expect(creationNameSchema.safeParse(`${name}A`).success).toBe(false);
	});
	it.each([
		"Amy1",
		"+Admin",
		"Amy_Lee",
		"Amy\nLee",
		"Amy\t",
		"Amy\0",
		"Amy😀",
		"李",
		"Œwyn",
		"Amy×",
		"Amy÷",
	])("rejects unsupported name %j", (name) =>
		expect(creationNameSchema.safeParse(name).success).toBe(false),
	);
	it("uses the same rules at the submission contract boundary", () => {
		const name = characterCreationDraftSchema.shape.name;
		expect(name.parse("  O'Brien  ")).toBe("O'Brien");
		expect(name.safeParse("+Admin").success).toBe(false);
	});
});
