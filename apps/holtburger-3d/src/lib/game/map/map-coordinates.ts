import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import type { Vec3 } from "../math/types";

/**
 * World-space meters spanned by one AC map degree.
 *
 * ACE `PositionExtensions.GetMapCoords` divides the global position by 240, and states the
 * relationship directly: one map unit is 1.25 landblocks, or 240 meters.
 */
export const METERS_PER_MAP_DEGREE = 240;

/**
 * Map-degree offset of the world origin.
 *
 * Dereth spans 204 map degrees, -102 to +102, so raw degrees are the scaled global position
 * shifted by half that span (ACE `PositionExtensions.GetMapCoords`).
 */
export const MAP_DEGREE_ORIGIN = 102;

/**
 * Magnitude AC shaves off a coordinate before printing it.
 *
 * ACE `GetMapCoordStr` prints `abs(degrees) - 0.05`, and its inverse `Position(Vector2)` adds
 * 101.95 rather than 102. The bias is exactly half a terrain cell (24 m against 240 m per degree),
 * but the retail decompile does not cover this display path, so only the arithmetic is reproduced
 * here and the geometric reading stays a hypothesis.
 */
export const MAP_DEGREE_DISPLAY_BIAS = 0.05;

/** Format a canonical world-space point the way AC prints outdoor map coordinates. */
export function formatWorldMapCoordinates(
	position: Pick<Vec3, "x" | "z">,
): string {
	const latitude = -position.z / METERS_PER_MAP_DEGREE - MAP_DEGREE_ORIGIN;
	const longitude = position.x / METERS_PER_MAP_DEGREE - MAP_DEGREE_ORIGIN;
	return `${formatDegree(latitude, "N", "S")}, ${formatDegree(
		longitude,
		"E",
		"W",
	)}`;
}

/**
 * Resolve the outdoor landblock axis containing a printed map degree.
 *
 * This is the exact inverse of `formatWorldMapCoordinates`. ACE's own inverse is asymmetric — it
 * shifts the signed value, which only inverts its display in the southern and western hemispheres
 * — so this un-biases the magnitude instead and round-trips on all four.
 */
export function landblockAxisFromPrintedDegree(printed: number): number {
	// Printing discards everything finer than the bias, so aim at the middle of the printed band.
	const degrees = printed + Math.sign(printed) * MAP_DEGREE_DISPLAY_BIAS;
	const meters = (degrees + MAP_DEGREE_ORIGIN) * METERS_PER_MAP_DEGREE;
	return Math.floor(meters / OUTDOOR_LANDBLOCK_WORLD_SIZE);
}

function formatDegree(
	degrees: number,
	positiveHemisphere: string,
	negativeHemisphere: string,
): string {
	const hemisphere = degrees < 0 ? negativeHemisphere : positiveHemisphere;
	// Within half a band of a hemisphere line the bias would print a negative magnitude, which ACE
	// does not guard against. Clamping keeps that 12 m reading at "0.0" instead of "-0.1".
	const magnitude = Math.max(0, Math.abs(degrees) - MAP_DEGREE_DISPLAY_BIAS);
	return `${magnitude.toFixed(1)}${hemisphere}`;
}
