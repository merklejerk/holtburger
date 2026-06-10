import { describe, expect, it } from "vitest";
import {
	createStaticWorkCommandFromLocation,
	inferV2LandblockInputMode,
	isV2LandblockPrefixInput,
	parseV2LocationInput,
} from "./location-input";

describe("V2 browser location input", () => {
	it("parses landblock prefixes as outdoor or dungeon focus by mode", () => {
		expect(parseV2LocationInput("0xda55", "outdoor")).toEqual({
			kind: "outdoor-landblock",
			label: "Outdoor landblock 0xda55ffff",
			landblockId: 0xda55ffff,
		});
		expect(parseV2LocationInput("0xda55", "dungeon")).toEqual({
			envCellId: 0xda550100,
			kind: "interior-cell",
			label: "Env cell 0xda550100 in 0xda55ffff",
			landblockId: 0xda55ffff,
		});
	});

	it("parses full landblock ids as outdoor or dungeon focus by mode", () => {
		expect(parseV2LocationInput("da55ffff", "outdoor")).toMatchObject({
			kind: "outdoor-landblock",
			landblockId: 0xda55ffff,
		});
		expect(parseV2LocationInput("da55ffff", "dungeon")).toMatchObject({
			envCellId: 0xda550100,
			kind: "interior-cell",
			landblockId: 0xda55ffff,
		});
	});

	it("parses full non-landblock cell ids as interior regardless of mode", () => {
		expect(parseV2LocationInput("0xda550123", "outdoor")).toEqual({
			envCellId: 0xda550123,
			kind: "interior-cell",
			label: "Env cell 0xda550123 in 0xda55ffff",
			landblockId: 0xda55ffff,
		});
		expect(parseV2LocationInput("0xda550123", "dungeon")).toMatchObject({
			envCellId: 0xda550123,
			kind: "interior-cell",
			landblockId: 0xda55ffff,
		});
	});

	it("parses coordinate inputs into outdoor landblock focus", () => {
		expect(parseV2LocationInput("33.50S, 72.80E, 0.0Z", "dungeon")).toEqual({
			kind: "outdoor-landblock",
			label: "Outdoor landblock 0xda55ffff",
			landblockId: 0xda55ffff,
		});
	});

	it("converts parsed locations into static work commands", () => {
		const outdoor = parseV2LocationInput("0xda55ffff", "outdoor");
		const interior = parseV2LocationInput("0xda550123", "outdoor");
		if (!outdoor || !interior) {
			throw new Error("expected parsed locations");
		}

		expect(createStaticWorkCommandFromLocation(outdoor, ["terrain"])).toEqual({
			domains: ["terrain"],
			landblockId: "0xda55ffff",
			locationKind: "outdoor-landblock",
		});
		expect(createStaticWorkCommandFromLocation(interior, ["terrain"])).toEqual({
			domains: ["topology"],
			envCellId: "0xda550123",
			landblockId: "0xda55ffff",
			locationKind: "interior-cell",
		});
	});

	it("identifies landblock prefix inputs for mode switching", () => {
		expect(isV2LandblockPrefixInput("0xda55")).toBe(true);
		expect(isV2LandblockPrefixInput("da55ffff")).toBe(false);
		expect(isV2LandblockPrefixInput("33.50S, 72.80E")).toBe(false);
	});

	it("infers focus mode from unambiguous valid input formats", () => {
		expect(inferV2LandblockInputMode("0xda550123", "outdoor")).toBe("dungeon");
		expect(inferV2LandblockInputMode("0xda55ffff", "dungeon")).toBe("outdoor");
		expect(inferV2LandblockInputMode("33.50S, 72.80E", "dungeon")).toBe(
			"outdoor",
		);
		expect(inferV2LandblockInputMode("0xda55", "dungeon")).toBe("dungeon");
		expect(inferV2LandblockInputMode("not valid", "outdoor")).toBe("outdoor");
	});
});
