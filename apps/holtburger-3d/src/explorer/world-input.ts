import type { EnvCellId, LandblockId } from "../lib/game/game-types";
import type { SceneResidency } from "../lib/game/scene";
import type { SceneInterestTarget } from "../lib/game/runtime/scene-target";
import { landblockAxisFromPrintedDegree } from "../lib/game/map/map-coordinates";

const HEX_PREFIX_PATTERN = /^(?:0x)?([0-9a-f]{4})$/i;
const HEX_CELL_PATTERN = /^(?:0x)?([0-9a-f]{8})$/i;
const MAP_COORDINATE_PATTERN =
	/^\s*(\d+(?:\.\d+)?)\s*([ns])\s*,?\s*(\d+(?:\.\d+)?)\s*([ew])(?:\s*,?\s*-?\d+(?:\.\d+)?\s*z?)?\s*$/i;
const MAX_OUTDOOR_LANDBLOCK_AXIS = 0xfe;

/** Parsed residence explicitly supplied by Explorer's world controls. */
export interface ParsedResidenceInput {
	/** Human-readable normalized target shown beside the form input. */
	readonly label: string;
	/** Authoritative residence encoded by the submitted identifier. */
	readonly residency: SceneResidency;
	/** Syntactic target intent retained for shared profile resolution. */
	readonly target: SceneInterestTarget;
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
		const prefix = prefixMatch[1];
		if (prefix === undefined) return null;
		return createAutomaticResidence(prefix);
	}
	const cellMatch = HEX_CELL_PATTERN.exec(value);
	if (cellMatch) {
		const cell = cellMatch[1];
		if (cell === undefined) return null;
		return createResidence(cell);
	}

	const coordinateMatch = MAP_COORDINATE_PATTERN.exec(value);
	if (coordinateMatch === null) return null;
	const northSouth = coordinateMatch[1];
	const northSouthHemisphere = coordinateMatch[2];
	const eastWest = coordinateMatch[3];
	const eastWestHemisphere = coordinateMatch[4];
	if (
		northSouth === undefined ||
		northSouthHemisphere === undefined ||
		eastWest === undefined ||
		eastWestHemisphere === undefined
	) {
		return null;
	}
	return createOutdoorResidenceFromMapCoordinates({
		eastWest: Number.parseFloat(eastWest),
		eastWestHemisphere: eastWestHemisphere.toUpperCase() as "E" | "W",
		northSouth: Number.parseFloat(northSouth),
		northSouthHemisphere: northSouthHemisphere.toUpperCase() as "N" | "S",
	});
}

function createAutomaticResidence(prefix: string): ParsedResidenceInput {
	const landblockId = `0x${prefix.toLowerCase()}ffff` as LandblockId;
	return {
		label: `Landblock ${landblockId}`,
		residency: { envCellId: null, landblockId },
		target: { kind: "automatic-landblock", landblockId },
	};
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
			target: { kind: "outdoor", landblockId },
		};
	}
	const envCellId = canonicalId as EnvCellId;
	return {
		label: `Environment cell ${envCellId}`,
		residency: { envCellId, landblockId },
		target: { envCellId, kind: "env-cell", landblockId },
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

/**
 * Clamp a printed degree onto AC's finite outdoor landblock grid.
 *
 * The input pattern accepts more decimals than AC ever prints, and they are still read as printed
 * notation, so a hand-typed extra digit lands up to the display bias away from where it reads.
 */
function mapCoordinateToLandblockAxis(coordinate: number): number {
	const axis = landblockAxisFromPrintedDegree(coordinate);
	return Math.max(0, Math.min(MAX_OUTDOOR_LANDBLOCK_AXIS, axis));
}
