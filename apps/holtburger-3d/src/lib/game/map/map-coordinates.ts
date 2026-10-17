import type { Vec3 } from "../math/types";

declare const sceneMapSpace: unique symbol;

/** Retained horizontal position in canonical scene space; carries no elevation. */
export interface SceneMapPoint {
	readonly [sceneMapSpace]: true;
	/** East-positive world meters. */
	readonly x: number;
	/** South-positive world meters (north is negative Z). */
	readonly z: number;
}

/** Printed magnitudes retain hemisphere identity even at zero. */
export interface PrintedMapCoordinates {
	/** Latitude magnitude and its north/south hemisphere. */
	readonly latitude: {
		readonly magnitude: number;
		readonly hemisphere: "N" | "S";
	};
	/** Longitude magnitude and its east/west hemisphere. */
	readonly longitude: {
		readonly magnitude: number;
		readonly hemisphere: "E" | "W";
	};
}

/** Parsed coordinate intent, including entered precision for chat and tooltips. */
export interface ParsedMapCoordinates {
	/** Hemisphere-aware coordinates used for conversion. */
	readonly coordinates: PrintedMapCoordinates;
	/** Uppercase hemispheres and consistent separator; numeric precision is preserved. */
	readonly label: string;
}

/** Read only latitude/longitude; Explorer's additional residence grammar stays local. */
export function parsePrintedMapCoordinates(
	input: string,
): ParsedMapCoordinates | null {
	const match =
		/^\s*(\d+(?:\.\d+)?)\s*([ns])\s*,?\s*(\d+(?:\.\d+)?)\s*([ew])\s*$/i.exec(
			input,
		);
	if (match === null) return null;
	// The successful pattern has exactly four required captures; type that producer guarantee here.
	const [latitude, northSouth, longitude, eastWest] = match.slice(1) as [
		string,
		string,
		string,
		string,
	];
	const latitudeMagnitude = Number(latitude),
		longitudeMagnitude = Number(longitude);
	if (
		!Number.isFinite(latitudeMagnitude) ||
		!Number.isFinite(longitudeMagnitude)
	)
		return null;
	const latitudeHemisphere = northSouth.toUpperCase() === "N" ? "N" : "S";
	const longitudeHemisphere = eastWest.toUpperCase() === "E" ? "E" : "W";
	return {
		coordinates: {
			latitude: {
				magnitude: latitudeMagnitude,
				hemisphere: latitudeHemisphere,
			},
			longitude: {
				magnitude: longitudeMagnitude,
				hemisphere: longitudeHemisphere,
			},
		},
		label: `${latitude}${latitudeHemisphere}, ${longitude}${longitudeHemisphere}`,
	};
}

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
 * Resolve a representative point for printed notation, without clamping to the outdoor grid.
 * Unbias magnitude before applying hemisphere sign. Printed coordinates are quantized, so this
 * does not recover the original position; extra decimals retain the same printed convention.
 */
export function scenePointFromPrintedCoordinates(
	coordinates: PrintedMapCoordinates,
): SceneMapPoint {
	const latitude =
		(coordinates.latitude.magnitude + MAP_DEGREE_DISPLAY_BIAS) *
		(coordinates.latitude.hemisphere === "N" ? 1 : -1);
	const longitude =
		(coordinates.longitude.magnitude + MAP_DEGREE_DISPLAY_BIAS) *
		(coordinates.longitude.hemisphere === "E" ? 1 : -1);
	return {
		x: (longitude + MAP_DEGREE_ORIGIN) * METERS_PER_MAP_DEGREE,
		z: -(latitude + MAP_DEGREE_ORIGIN) * METERS_PER_MAP_DEGREE,
	} as SceneMapPoint;
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
