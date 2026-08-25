import type { LandblockId } from "./game-types";
import { Vec3 } from "./math/types";

/** Width and depth of one outdoor landblock in AC world units. */
export const OUTDOOR_LANDBLOCK_WORLD_SIZE = 192;
/** Number of authored terrain cells along either axis of an outdoor landblock. */
export const OUTDOOR_TERRAIN_GRID_CELLS = 8;
/** Number of authored terrain vertices along either axis of an outdoor landblock. */
export const OUTDOOR_TERRAIN_GRID_SIZE = OUTDOOR_TERRAIN_GRID_CELLS + 1;
/** Fixed world-space spacing between adjacent authored outdoor terrain vertices. */
export const OUTDOOR_TERRAIN_TILE_SIZE =
	OUTDOOR_LANDBLOCK_WORLD_SIZE / OUTDOOR_TERRAIN_GRID_CELLS;
/**
 * How far a road reaches from the authored line it is drawn along, in world units.
 *
 * A retail constant, not a preference: `LandDefs::get_vars` hands back a fixed 5.0
 * (acclient.c:446418), and `CLandBlock::on_road` tests plain distances against it to decide what
 * counts as road (acclient.c:337802-337960; ACE transcribes it as `Landblock.OnRoad`). A road line
 * is therefore ten units across, whatever the terrain grid around it looks like — which is the
 * fact a road drawn from grid interpolation cannot honour, because interpolation can only place an
 * edge as a fraction of a 24 unit cell.
 */
export const RETAIL_ROAD_WIDTH = 5;

/** Normalize one eight-digit landblock owner identity to its `FFFF` CellLandblock root. */
export function normalizeLandblockOwner(landblockId: LandblockId): LandblockId {
	const match = /^(?:0x)?([0-9a-fA-F]{4})ffff$/i.exec(landblockId);
	if (!match) {
		throw new Error(
			`Landblock owner must be an eight-digit FFFF id, received ${landblockId}.`,
		);
	}
	const ownerHex = match[1];
	if (ownerHex === undefined) {
		throw new Error(
			`Landblock owner must include its coordinate bytes, received ${landblockId}.`,
		);
	}
	return `0x${ownerHex.toLowerCase()}ffff`;
}

/** Outdoor grid coordinates encoded in the high two bytes of a landblock id. */
export interface LandblockCoordinates {
	/** East-west outdoor grid coordinate. */
	readonly x: number;
	/** North-south outdoor grid coordinate. */
	readonly y: number;
}

/**
 * Chebyshev (square-ring) distance in landblocks.
 *
 * The residency window is a Chebyshev square, so this is the distance that names which ring a
 * landblock sits on relative to the anchor.
 */
export function landblockChebyshevDistance(
	landblock: LandblockCoordinates,
	anchor: LandblockCoordinates,
): number {
	return Math.max(
		Math.abs(landblock.x - anchor.x),
		Math.abs(landblock.y - anchor.y),
	);
}

export function getLandblockCoordinates(
	landblockId: LandblockId,
): LandblockCoordinates {
	const hex = landblockId.startsWith("0x") ? landblockId.slice(2) : landblockId;
	if (hex.length !== 8) throw new Error(`Invalid landblock id ${landblockId}.`);
	const value = Number.parseInt(hex, 16) >>> 0;
	if (Number.isNaN(value))
		throw new Error(`Invalid landblock id ${landblockId}.`);
	return {
		x: (value >>> 24) & 0xff,
		y: (value >>> 16) & 0xff,
	};
}

/** Translation from a landblock frame into an anchor-relative render frame. */
export function createLandblockOffset(
	landblock: LandblockCoordinates,
	anchor: LandblockCoordinates,
	targetVec?: Vec3,
): Vec3 {
	const x = (landblock.x - anchor.x) * OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const z = -(landblock.y - anchor.y) * OUTDOOR_LANDBLOCK_WORLD_SIZE;
	if (targetVec) {
		targetVec.x = x;
		targetVec.y = 0;
		targetVec.z = z;
		return targetVec;
	}
	return new Vec3(x, 0, z);
}

/** Scene-space origin of one outdoor landblock's local coordinate frame. */
export function createLandblockWorldOrigin(
	landblock: LandblockId | LandblockCoordinates,
	targetVec?: Vec3,
): Vec3 {
	const coords =
		typeof landblock === "string"
			? getLandblockCoordinates(landblock)
			: landblock;
	const x = coords.x * OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const z = -coords.y * OUTDOOR_LANDBLOCK_WORLD_SIZE;
	if (targetVec) {
		targetVec.x = x;
		targetVec.y = 0;
		targetVec.z = z;
		return targetVec;
	}
	return new Vec3(x, 0, z);
}

/** Resolve the outdoor landblock containing one canonical scene-space point. */
export function landblockAtWorldPoint(point: Vec3): LandblockId | null {
	const x = Math.floor(point.x / OUTDOOR_LANDBLOCK_WORLD_SIZE);
	const y = Math.floor(-point.z / OUTDOOR_LANDBLOCK_WORLD_SIZE);
	if (x < 0 || x > 0xff || y < 0 || y > 0xff) return null;
	return `0x${x.toString(16).padStart(2, "0")}${y
		.toString(16)
		.padStart(2, "0")}ffff`;
}
