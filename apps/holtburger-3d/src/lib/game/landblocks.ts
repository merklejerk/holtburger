import type { LandblockId } from "./game-types";
import { AABB2, Vec2, Vec3 } from "./math/types";

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

/**
 * Return the canonical scene X/Z footprint of the terrain window retained around an outdoor
 * anchor.  The world-edge clamp matches scene-interest construction.
 */
export function createOutdoorTerrainWindowBounds(
	anchorLandblockId: LandblockId,
	terrainRadius: number,
): AABB2 {
	if (!Number.isInteger(terrainRadius) || terrainRadius < 0) {
		throw new Error("Outdoor terrain radius must be a non-negative integer.");
	}
	const anchor = getLandblockCoordinates(anchorLandblockId);
	const minX = Math.max(0, anchor.x - terrainRadius);
	const maxX = Math.min(0xff, anchor.x + terrainRadius);
	const minY = Math.max(0, anchor.y - terrainRadius);
	const maxY = Math.min(0xff, anchor.y + terrainRadius);
	return new AABB2(
		new Vec2(
			minX * OUTDOOR_LANDBLOCK_WORLD_SIZE,
			-(maxY + 1) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		),
		new Vec2(
			(maxX + 1) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
			minY === 0 ? 0 : -minY * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		),
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
