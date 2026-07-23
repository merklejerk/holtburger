import { describe, expect, it } from "vitest";
import { parseResidenceInput } from "./world-input";

describe("parseResidenceInput", () => {
	it("normalizes landblock prefixes and complete outdoor ids", () => {
		expect(parseResidenceInput("da55")?.residency).toEqual({
			envCellId: null,
			landblockId: "0xda55ffff",
		});
		expect(parseResidenceInput("0xDA55FFFF")?.residency).toEqual({
			envCellId: null,
			landblockId: "0xda55ffff",
		});
	});

	it("derives an environment cell's containing outdoor landblock", () => {
		expect(parseResidenceInput("da550123")?.residency).toEqual({
			envCellId: "0xda550123",
			landblockId: "0xda55ffff",
		});
	});

	it("rejects malformed ids", () => {
		expect(parseResidenceInput("da5")).toBeNull();
		expect(parseResidenceInput("0xda55ffff trailing")).toBeNull();
	});
});
