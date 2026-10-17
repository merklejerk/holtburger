import { describe, expect, it } from "vitest";
import { Vec3 } from "../math/types";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import {
	MAP_DEGREE_DISPLAY_BIAS,
	MAP_DEGREE_ORIGIN,
	METERS_PER_MAP_DEGREE,
	formatWorldMapCoordinates,
	parsePrintedMapCoordinates,
	scenePointFromPrintedCoordinates,
} from "./map-coordinates";

/** Place a world point on exact map degrees, so fixtures state intent rather than raw meters. */
function worldPointAt(latitude: number, longitude: number): Vec3 {
	return new Vec3(
		(longitude + MAP_DEGREE_ORIGIN) * METERS_PER_MAP_DEGREE,
		0,
		-(latitude + MAP_DEGREE_ORIGIN) * METERS_PER_MAP_DEGREE,
	);
}

describe("AC map coordinates", () => {
	it("prints the biased magnitude AC shows, not the raw degree", () => {
		expect(formatWorldMapCoordinates(worldPointAt(-33.55, 72.75))).toBe(
			"33.5S, 72.7E",
		);
		expect(formatWorldMapCoordinates(worldPointAt(11, 1))).toBe("10.9N, 0.9E");
	});

	it("keeps the hemisphere line readable instead of printing a negative magnitude", () => {
		expect(formatWorldMapCoordinates(worldPointAt(0, 0))).toBe("0.0N, 0.0E");
		expect(
			formatWorldMapCoordinates(
				worldPointAt(-MAP_DEGREE_DISPLAY_BIAS / 2, MAP_DEGREE_DISPLAY_BIAS / 2),
			),
		).toBe("0.0S, 0.0E");
	});

	it("round-trips a printed coordinate back to the landblock it was printed from", () => {
		for (const { latitude, longitude } of [
			{ latitude: -33.55, longitude: 72.75 },
			{ latitude: 33.65, longitude: -40.05 },
			{ latitude: 11, longitude: 1 },
		]) {
			const point = worldPointAt(latitude, longitude);
			const parsed = parsePrintedMapCoordinates(
				formatWorldMapCoordinates(point),
			);
			if (parsed === null) throw new Error("Fixture coordinate did not parse.");
			const printed = scenePointFromPrintedCoordinates(parsed.coordinates);
			expect(Math.floor(-printed.z / OUTDOOR_LANDBLOCK_WORLD_SIZE)).toBe(
				Math.floor(-point.z / OUTDOOR_LANDBLOCK_WORLD_SIZE),
			);
			expect(Math.floor(printed.x / OUTDOOR_LANDBLOCK_WORLD_SIZE)).toBe(
				Math.floor(point.x / OUTDOOR_LANDBLOCK_WORLD_SIZE),
			);
		}
	});
});

describe("printed coordinate parsing", () => {
	it.each(["N", "S"] as const)("preserves %s even at zero", (hemisphere) => {
		for (const longitude of ["E", "W"] as const) {
			const parsed = parsePrintedMapCoordinates(
				` 0.00${hemisphere.toLowerCase()}  0.0${longitude.toLowerCase()} `,
			);
			if (parsed === null) throw new Error("Fixture did not parse");
			expect(parsed.label).toBe(`0.00${hemisphere}, 0.0${longitude}`);
			const point = scenePointFromPrintedCoordinates(parsed.coordinates);
			expect(point.x).toBe(
				(MAP_DEGREE_ORIGIN +
					(longitude === "E" ? 1 : -1) * MAP_DEGREE_DISPLAY_BIAS) *
					METERS_PER_MAP_DEGREE,
			);
			expect(point.z).toBe(
				-(
					MAP_DEGREE_ORIGIN +
					(hemisphere === "N" ? 1 : -1) * MAP_DEGREE_DISPLAY_BIAS
				) * METERS_PER_MAP_DEGREE,
			);
		}
	});
	it("retains extra numeric precision", () => {
		const parsed = parsePrintedMapCoordinates("42.345N,12.7890W");
		if (parsed === null) throw new Error("Fixture did not parse");
		expect(parsed.label).toBe("42.345N, 12.7890W");
		expect(scenePointFromPrintedCoordinates(parsed.coordinates).x).toBe(
			(MAP_DEGREE_ORIGIN - 12.789 - MAP_DEGREE_DISPLAY_BIAS) *
				METERS_PER_MAP_DEGREE,
		);
	});
	it.each([
		"",
		"42 12",
		"42N",
		"42E 12N",
		"-42S 12E",
		"+42N 12W",
		"42N 12E 0Z",
		"42N 12E junk",
		"0xda55ffff",
		"InfinityN 12E",
		`${"9".repeat(400)}N 12E`,
	])("rejects %s", (input) => {
		expect(parsePrintedMapCoordinates(input)).toBeNull();
	});
});
