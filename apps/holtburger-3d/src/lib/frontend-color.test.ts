import { describe, expect, it } from "vitest";
import {
	hexRgb,
	hexRgba,
	normalizedRgbColor,
	normalizedRgbaColor,
} from "./frontend-color";

describe("frontend hex colors", () => {
	it("decodes RGB bytes into normalized channels", () => {
		expect(normalizedRgbColor(hexRgb("#0080ff"))).toEqual({
			red: 0,
			green: 128 / 255,
			blue: 1,
		});
	});

	it("decodes RGBA alpha independently from color", () => {
		expect(normalizedRgbaColor(hexRgba("#ff800040"))).toEqual({
			red: 1,
			green: 128 / 255,
			blue: 0,
			alpha: 64 / 255,
		});
	});

	it("rejects shorthand and mismatched alpha shapes", () => {
		expect(() => hexRgb("#fff")).toThrow("Expected a #RRGGBB color");
		expect(() => hexRgb("#ffffffff")).toThrow("Expected a #RRGGBB color");
		expect(() => hexRgba("#ffffff")).toThrow("Expected a #RRGGBBAA color");
	});
});
