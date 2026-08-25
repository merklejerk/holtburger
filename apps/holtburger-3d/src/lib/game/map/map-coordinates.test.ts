import { describe, expect, it } from "vitest";
import { Vec3 } from "../math/types";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import {
	MAP_DEGREE_DISPLAY_BIAS,
	MAP_DEGREE_ORIGIN,
	METERS_PER_MAP_DEGREE,
	formatWorldMapCoordinates,
	landblockAxisFromPrintedDegree,
} from "./map-coordinates";

/** Place a world point on exact map degrees, so fixtures state intent rather than raw meters. */
function worldPointAt(latitude: number, longitude: number): Vec3 {
	return new Vec3(
		(longitude + MAP_DEGREE_ORIGIN) * METERS_PER_MAP_DEGREE,
		0,
		-(latitude + MAP_DEGREE_ORIGIN) * METERS_PER_MAP_DEGREE,
	);
}

/** Read AC's printed notation back into signed degrees, as a viewer retyping it would. */
function signedDegrees(printed: string): {
	readonly latitude: number;
	readonly longitude: number;
} {
	const match = /^(\d+\.\d)([NS]), (\d+\.\d)([EW])$/.exec(printed);
	if (match === null) {
		throw new Error(`Printed map coordinate is unreadable: ${printed}`);
	}
	const [, latitude, latitudeHemisphere, longitude, longitudeHemisphere] =
		match;
	return {
		latitude: Number(latitude) * (latitudeHemisphere === "S" ? -1 : 1),
		longitude: Number(longitude) * (longitudeHemisphere === "W" ? -1 : 1),
	};
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
			const printed = signedDegrees(formatWorldMapCoordinates(point));
			expect(landblockAxisFromPrintedDegree(printed.latitude)).toBe(
				Math.floor(-point.z / OUTDOOR_LANDBLOCK_WORLD_SIZE),
			);
			expect(landblockAxisFromPrintedDegree(printed.longitude)).toBe(
				Math.floor(point.x / OUTDOOR_LANDBLOCK_WORLD_SIZE),
			);
		}
	});
});
