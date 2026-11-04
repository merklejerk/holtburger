import { describe, expect, it } from "vitest";
import { parseResidenceInput } from "./world-input";

describe("parseResidenceInput", () => {
	it("normalizes landblock prefixes and complete outdoor ids", () => {
		expect(parseResidenceInput("da55")?.target).toEqual({
			kind: "automatic-landblock",
			landblockId: "0xda55ffff",
		});
		expect(parseResidenceInput("0xDA55FFFF")?.target).toEqual({
			kind: "outdoor",
			landblockId: "0xda55ffff",
		});
		expect(parseResidenceInput("0xDA55FFFF")?.residency).toEqual({
			envCellId: null,
			landblockId: "0xda55ffff",
		});
		expect(parseResidenceInput("0xDA55FFFF")?.residency).toEqual({
			envCellId: null,
			landblockId: "0xda55ffff",
		});
	});

	it("derives an environment cell's containing outdoor landblock", () => {
		expect(parseResidenceInput("da550123")?.target).toEqual({
			envCellId: "0xda550123",
			kind: "env-cell",
			landblockId: "0xda55ffff",
		});
	});

	it("converts AC map coordinates to an outdoor landblock", () => {
		expect(parseResidenceInput("33.50S, 72.80E, 0.0Z")?.residency).toEqual({
			envCellId: null,
			landblockId: "0xda55ffff",
		});
		expect(parseResidenceInput("33.6N 40W")?.residency).toEqual({
			envCellId: null,
			landblockId: "0x4da9ffff",
		});
	});

	it("rejects malformed ids", () => {
		expect(parseResidenceInput("da5")).toBeNull();
		expect(parseResidenceInput("0xda55ffff trailing")).toBeNull();
		expect(parseResidenceInput("33.6 40W")).toBeNull();
	});
});
