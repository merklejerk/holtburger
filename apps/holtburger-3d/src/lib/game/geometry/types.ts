import type { LandblockId } from "../game-types";
import type { StaticGeometryKey } from "../systems/static-resources";

declare const terrainGeometryKeyBrand: unique symbol;
declare const objectGeometryKeyBrand: unique symbol;

/** Stable geometry resource containing every generated terrain variant for one landblock. */
export type TerrainGeometryKey = `terrain-geometry:${LandblockId}` & {
	readonly [terrainGeometryKeyBrand]: true;
};

export type { StaticGeometryKey } from "../systems/static-resources";

/** Reusable object-local geometry selected by a resolved object presentation. */
export type ObjectGeometryKey = `object-geometry:${string}` & {
	readonly [objectGeometryKeyBrand]: true;
};

/** Logical identity for a complete device-backed geometry resource. */
export type GeometryKey =
	| TerrainGeometryKey
	| StaticGeometryKey
	| ObjectGeometryKey;

/** Build the canonical generated terrain-geometry identity for one landblock. */
export function createTerrainGeometryKey(
	landblockId: LandblockId,
): TerrainGeometryKey {
	return `terrain-geometry:${landblockId}` as TerrainGeometryKey;
}

/** Build a globally semantic object geometry identity from resolved source facts. */
export function createObjectGeometryKey(source: string): ObjectGeometryKey {
	if (source.length === 0) {
		throw new Error("Object geometry source identity cannot be empty.");
	}
	return `object-geometry:${source}` as ObjectGeometryKey;
}
