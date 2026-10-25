import { describe, expect, it } from "vitest";
import {
	characterConfirmationName,
	characterDeletionNameMatches,
} from "./client-character-selection";

describe("character deletion confirmation", () => {
	it("omits ACE's privileged-name decoration", () => {
		expect(characterConfirmationName("+Sho-Girl")).toBe("Sho-Girl");
		expect(characterDeletionNameMatches("  sHo-GiRl  ", "+Sho-Girl")).toBe(
			true,
		);
	});
	it("preserves meaningful punctuation and internal spacing", () => {
		expect(characterDeletionNameMatches("Sho Girl", "Sho-Girl")).toBe(false);
		expect(characterDeletionNameMatches("OBrien", "O'Brien")).toBe(false);
		expect(characterDeletionNameMatches("Sho  Girl", "Sho Girl")).toBe(false);
		expect(characterDeletionNameMatches("Other", "Sho Girl")).toBe(false);
	});
});
