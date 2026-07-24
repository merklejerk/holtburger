import type { EnvCellId, LandblockId } from "../lib/game/game-types";
import type { SceneResidency } from "../lib/game/scene";

const HEX_PREFIX_PATTERN = /^(?:0x)?([0-9a-f]{4})$/i;
const HEX_CELL_PATTERN = /^(?:0x)?([0-9a-f]{8})$/i;
const MAP_COORDINATE_PATTERN =
	/^\s*(\d+(?:\.\d+)?)\s*([ns])\s*,?\s*(\d+(?:\.\d+)?)\s*([ew])(?:\s*,?\s*-?\d+(?:\.\d+)?\s*z?)?\s*$/i;
const MAP_COORDINATE_ORIGIN = 102;
const MAP_COORDINATE_LANDBLOCKS_PER_DEGREE = 240 / 192;
const MAX_OUTDOOR_LANDBLOCK_AXIS = 0xfe;

/** Parsed residence explicitly supplied by Explorer's world controls. */
export interface ParsedResidenceInput {
	/** Human-readable normalized target shown beside the form input. */
	readonly label: string;
	/** Authoritative residence encoded by the submitted identifier. */
	readonly residency: SceneResidency;
}

/**
 * Parse an outdoor map coordinate, landblock prefix, outdoor landblock id, or
 * environment-cell id. Map coordinates use AC's `N/S E/W` notation; elevation,
 * when supplied, does not alter the outdoor landblock target.
 */
export function parseResidenceInput(
	input: string,
): ParsedResidenceInput | null {
	const value = input.trim();
	const prefixMatch = HEX_PREFIX_PATTERN.exec(value);
	if (prefixMatch) {
		return createResidence(`${prefixMatch[1]}ffff`);
	}
	const cellMatch = HEX_CELL_PATTERN.exec(value);
	if (cellMatch) return createResidence(cellMatch[1]!);

	const coordinateMatch = MAP_COORDINATE_PATTERN.exec(value);
	return coordinateMatch
		? createOutdoorResidenceFromMapCoordinates({
				eastWest: Number.parseFloat(coordinateMatch[3]!),
				eastWestHemisphere: coordinateMatch[4]!.toUpperCase() as "E" | "W",
				northSouth: Number.parseFloat(coordinateMatch[1]!),
				northSouthHemisphere: coordinateMatch[2]!.toUpperCase() as "N" | "S",
			})
		: null;
}

function createResidence(rawId: string): ParsedResidenceInput {
	const canonicalId = `0x${rawId.toLowerCase()}`;
	const prefix = canonicalId.slice(0, 6);
	const suffix = canonicalId.slice(6);
	const landblockId = `${prefix}ffff` as LandblockId;
	if (suffix === "ffff") {
		return {
			label: `Outdoor landblock ${landblockId}`,
			residency: { envCellId: null, landblockId },
		};
	}
	const envCellId = canonicalId as EnvCellId;
	return {
		label: `Environment cell ${envCellId}`,
		residency: { envCellId, landblockId },
	};
}

function createOutdoorResidenceFromMapCoordinates(coordinates: {
	readonly northSouth: number;
	readonly northSouthHemisphere: "N" | "S";
	readonly eastWest: number;
	readonly eastWestHemisphere: "E" | "W";
}): ParsedResidenceInput {
	const latitude =
		coordinates.northSouthHemisphere === "N"
			? coordinates.northSouth
			: -coordinates.northSouth;
	const longitude =
		coordinates.eastWestHemisphere === "E"
			? coordinates.eastWest
			: -coordinates.eastWest;
	const x = mapCoordinateToLandblockAxis(longitude);
	const y = mapCoordinateToLandblockAxis(latitude);
	return createResidence(
		`${x.toString(16).padStart(2, "0")}${y.toString(16).padStart(2, "0")}ffff`,
	);
}

function mapCoordinateToLandblockAxis(coordinate: number): number {
	const axis = Math.floor(
		(coordinate + MAP_COORDINATE_ORIGIN) * MAP_COORDINATE_LANDBLOCKS_PER_DEGREE,
	);
	return Math.max(0, Math.min(MAX_OUTDOOR_LANDBLOCK_AXIS, axis));
}
