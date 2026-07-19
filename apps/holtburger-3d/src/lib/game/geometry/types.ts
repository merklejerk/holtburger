import type { LandblockId } from "../game-types";

declare const terrainGeometryKeyBrand: unique symbol;
declare const staticGeometryKeyBrand: unique symbol;

/** Stable geometry resource containing every generated terrain variant for one landblock. */
export type TerrainGeometryKey = `terrain-geometry:${LandblockId}` & {
	readonly [terrainGeometryKeyBrand]: true;
};

/** Stable baked geometry resource identity supplied by a static-content producer. */
export type StaticGeometryKey = `static-geometry:${string}` & {
	readonly [staticGeometryKeyBrand]: true;
};

/** Logical identity for a complete device-backed geometry resource. */
export type GeometryKey = TerrainGeometryKey | StaticGeometryKey;

/** Build the canonical generated terrain-geometry identity for one landblock. */
export function createTerrainGeometryKey(
	landblockId: LandblockId,
): TerrainGeometryKey {
	return `terrain-geometry:${landblockId}` as TerrainGeometryKey;
}

/** Build one deterministic baked static-geometry identity. */
export function createStaticGeometryKey(source: string): StaticGeometryKey {
	if (source.length === 0) {
		throw new Error("Static geometry source identity cannot be empty.");
	}
	return `static-geometry:${source}` as StaticGeometryKey;
}
