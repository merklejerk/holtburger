import { describe, expect, it } from "vitest";
import {
	createSceneInterestFromLocation,
	inferLandblockInputMode,
	isLandblockPrefixInput,
	parseLocationInput,
} from "./location-input";

describe("browser location input", () => {
	it("parses landblock prefixes as outdoor or dungeon focus by mode", () => {
		expect(parseLocationInput("0xda55", "outdoor")).toEqual({
			kind: "outdoor-landblock",
			label: "Outdoor landblock 0xda55ffff",
			landblockId: 0xda55ffff,
		});
		expect(parseLocationInput("0xda55", "dungeon")).toEqual({
			envCellId: 0xda550100,
			kind: "interior-cell",
			label: "Env cell 0xda550100 in 0xda55ffff",
			landblockId: 0xda55ffff,
		});
	});

	it("parses full landblock ids as outdoor or dungeon focus by mode", () => {
		expect(parseLocationInput("da55ffff", "outdoor")).toMatchObject({
			kind: "outdoor-landblock",
			landblockId: 0xda55ffff,
		});
		expect(parseLocationInput("da55ffff", "dungeon")).toMatchObject({
			envCellId: 0xda550100,
			kind: "interior-cell",
			landblockId: 0xda55ffff,
		});
	});

	it("parses full non-landblock cell ids as interior regardless of mode", () => {
		expect(parseLocationInput("0xda550123", "outdoor")).toEqual({
			envCellId: 0xda550123,
			kind: "interior-cell",
			label: "Env cell 0xda550123 in 0xda55ffff",
			landblockId: 0xda55ffff,
		});
		expect(parseLocationInput("0xda550123", "dungeon")).toMatchObject({
			envCellId: 0xda550123,
			kind: "interior-cell",
			landblockId: 0xda55ffff,
		});
	});

	it("parses coordinate inputs into outdoor landblock focus", () => {
		expect(parseLocationInput("33.50S, 72.80E, 0.0Z", "dungeon")).toEqual({
			kind: "outdoor-landblock",
			label: "Outdoor landblock 0xda55ffff",
			landblockId: 0xda55ffff,
		});
	});

	it("converts parsed locations into scene interest commands", () => {
		const outdoor = parseLocationInput("0xda55ffff", "outdoor");
		const interior = parseLocationInput("0xda550123", "outdoor");
		if (!outdoor || !interior) {
			throw new Error("expected parsed locations");
		}

		expect(createSceneInterestFromLocation(outdoor, ["terrain"])).toEqual({
			anchorLandblockId: 0xda55ffff,
			domains: ["terrain"],
			kind: "outdoor-anchor",
			source: "manual",
		});
		expect(createSceneInterestFromLocation(interior, ["terrain"])).toEqual({
			envCellId: 0xda550123,
			kind: "interior-cell",
			landblockId: 0xda55ffff,
			source: "manual",
		});
	});

	it("identifies landblock prefix inputs for mode switching", () => {
		expect(isLandblockPrefixInput("0xda55")).toBe(true);
		expect(isLandblockPrefixInput("da55ffff")).toBe(false);
		expect(isLandblockPrefixInput("33.50S, 72.80E")).toBe(false);
	});

	it("infers focus mode from unambiguous valid input formats", () => {
		expect(inferLandblockInputMode("0xda550123", "outdoor")).toBe("dungeon");
		expect(inferLandblockInputMode("0xda55ffff", "dungeon")).toBe("outdoor");
		expect(inferLandblockInputMode("33.50S, 72.80E", "dungeon")).toBe(
			"outdoor",
		);
		expect(inferLandblockInputMode("0xda55", "dungeon")).toBe("dungeon");
		expect(inferLandblockInputMode("not valid", "outdoor")).toBe("outdoor");
	});
});
