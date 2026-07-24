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

/** Outdoor grid coordinates encoded in the high two bytes of a landblock id. */
export interface LandblockCoordinates {
	/** East-west outdoor grid coordinate. */
	readonly x: number;
	/** North-south outdoor grid coordinate. */
	readonly y: number;
}

export function getLandblockCoordinates(
	landblockId: LandblockId,
): LandblockCoordinates {
	const match = /^(?:0x)?([0-9a-fA-F]{8})$/.exec(landblockId);
	if (!match) throw new Error(`Invalid landblock id ${landblockId}.`);
	const value = Number.parseInt(match[1]!, 16) >>> 0;
	return {
		x: (value >>> 24) & 0xff,
		y: (value >>> 16) & 0xff,
	};
}

/** Translation from a landblock frame into an anchor-relative render frame. */
export function createLandblockOffset(
	landblockId: LandblockId,
	anchorLandblockId: LandblockId,
): Vec3 {
	const landblock = getLandblockCoordinates(landblockId);
	const anchor = getLandblockCoordinates(anchorLandblockId);
	return new Vec3(
		(landblock.x - anchor.x) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		0,
		-(landblock.y - anchor.y) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
	);
}

/** Scene-space origin of one outdoor landblock's local coordinate frame. */
export function createLandblockWorldOrigin(landblockId: LandblockId): Vec3 {
	const landblock = getLandblockCoordinates(landblockId);
	return new Vec3(
		landblock.x * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		0,
		-landblock.y * OUTDOOR_LANDBLOCK_WORLD_SIZE,
	);
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
