import {
	formatHex32,
	makeOutdoorLandblockId,
	normalizeOutdoorLandblockId,
} from "../../lib/landblocks";
import type { StaticWorkCommand } from "../runtime/client-runtime";
import type { StaticLodRadii } from "../static/contracts";

export type V2LandblockInputMode = "outdoor" | "dungeon";

export type V2ParsedLocationInput =
	| {
			readonly kind: "outdoor-landblock";
			readonly landblockId: number;
			readonly label: string;
	  }
	| {
			readonly kind: "interior-cell";
			readonly landblockId: number;
			readonly envCellId: number;
			readonly label: string;
	  };

const LOCATION_INPUT_PATTERN =
	/^\s*(\d+(?:\.\d+)?)\s*([NS])\s*,?\s*(\d+(?:\.\d+)?)\s*([EW])(?:\s*,?\s*(-?\d+(?:\.\d+)?)\s*Z?)?\s*$/i;
const CELL_ID_INPUT_PATTERN = /^\s*(?:0x)?([0-9a-f]{8})\s*$/i;
const LANDBLOCK_PREFIX_INPUT_PATTERN = /^\s*(?:0x)?([0-9a-f]{4})\s*$/i;

export function parseV2LocationInput(
	value: string,
	mode: V2LandblockInputMode,
): V2ParsedLocationInput | null {
	const landblockPrefixMatch = value.match(LANDBLOCK_PREFIX_INPUT_PATTERN);
	if (landblockPrefixMatch) {
		const prefix = Number.parseInt(landblockPrefixMatch[1], 16) >>> 0;
		const landblockId = ((prefix << 16) | 0xffff) >>> 0;
		return createLandblockModeLocation(landblockId, mode);
	}

	const cellIdMatch = value.match(CELL_ID_INPUT_PATTERN);
	if (cellIdMatch) {
		const cellId = Number.parseInt(cellIdMatch[1], 16) >>> 0;
		const landblockId = normalizeOutdoorLandblockId(cellId);
		if ((cellId & 0xffff) === 0xffff) {
			return createLandblockModeLocation(landblockId, mode);
		}

		return createInteriorCellLocation(cellId, landblockId);
	}

	const locationMatch = value.match(LOCATION_INPUT_PATTERN);
	if (locationMatch) {
		const landblockId = browserLocationInputToLandblockId({
			eastWest: Number.parseFloat(locationMatch[3]),
			eastWestHemisphere: locationMatch[4].toUpperCase() as "E" | "W",
			northSouth: Number.parseFloat(locationMatch[1]),
			northSouthHemisphere: locationMatch[2].toUpperCase() as "N" | "S",
		});
		return createOutdoorLandblockLocation(landblockId);
	}

	return null;
}

export function inferV2LandblockInputMode(
	value: string,
	currentMode: V2LandblockInputMode,
): V2LandblockInputMode {
	if (LANDBLOCK_PREFIX_INPUT_PATTERN.test(value)) {
		return currentMode;
	}

	const cellIdMatch = value.match(CELL_ID_INPUT_PATTERN);
	if (cellIdMatch) {
		const cellId = Number.parseInt(cellIdMatch[1], 16) >>> 0;
		return (cellId & 0xffff) === 0xffff ? "outdoor" : "dungeon";
	}

	if (LOCATION_INPUT_PATTERN.test(value)) {
		return "outdoor";
	}

	return currentMode;
}

export function createStaticWorkCommandFromLocation(
	location: V2ParsedLocationInput,
	domains: readonly StaticWorkCommand["domains"][number][],
	lod?: Partial<StaticLodRadii>,
): StaticWorkCommand {
	if (location.kind === "interior-cell") {
		return {
			domains: ["env-cells"],
			envCellId: `0x${formatHex32(location.envCellId)}`,
			landblockId: `0x${formatHex32(location.landblockId)}`,
			locationKind: "interior-cell",
		};
	}

	return {
		domains,
		landblockId: `0x${formatHex32(location.landblockId)}`,
		...(lod ? { lod } : {}),
		locationKind: "outdoor-landblock",
	};
}

export function isV2LandblockPrefixInput(value: string): boolean {
	return LANDBLOCK_PREFIX_INPUT_PATTERN.test(value);
}

function createLandblockModeLocation(
	landblockId: number,
	mode: V2LandblockInputMode,
): V2ParsedLocationInput {
	if (mode === "dungeon") {
		return createInteriorCellLocation(
			((normalizeOutdoorLandblockId(landblockId) & 0xffff0000) | 0x0100) >>> 0,
			normalizeOutdoorLandblockId(landblockId),
		);
	}

	return createOutdoorLandblockLocation(landblockId);
}

function createOutdoorLandblockLocation(
	landblockId: number,
): V2ParsedLocationInput {
	const normalizedLandblockId = normalizeOutdoorLandblockId(landblockId);
	return {
		kind: "outdoor-landblock",
		label: `Outdoor landblock 0x${formatHex32(normalizedLandblockId)}`,
		landblockId: normalizedLandblockId,
	};
}

function createInteriorCellLocation(
	envCellId: number,
	landblockId: number,
): V2ParsedLocationInput {
	const normalizedLandblockId = normalizeOutdoorLandblockId(landblockId);
	return {
		envCellId: envCellId >>> 0,
		kind: "interior-cell",
		label: `Env cell 0x${formatHex32(envCellId)} in 0x${formatHex32(normalizedLandblockId)}`,
		landblockId: normalizedLandblockId,
	};
}

function browserLocationInputToLandblockId(location: {
	readonly northSouth: number;
	readonly northSouthHemisphere: "N" | "S";
	readonly eastWest: number;
	readonly eastWestHemisphere: "E" | "W";
}): number {
	const signedLatitude =
		location.northSouthHemisphere === "N"
			? location.northSouth
			: -location.northSouth;
	const signedLongitude =
		location.eastWestHemisphere === "E"
			? location.eastWest
			: -location.eastWest;
	const landblockX = clampLandblockAxis(
		Math.floor(((signedLongitude + 102) * 240) / 192),
	);
	const landblockY = clampLandblockAxis(
		Math.floor(((signedLatitude + 102) * 240) / 192),
	);

	return makeOutdoorLandblockId(landblockX, landblockY);
}

function clampLandblockAxis(value: number): number {
	return Math.max(0, Math.min(0xfe, value));
}
