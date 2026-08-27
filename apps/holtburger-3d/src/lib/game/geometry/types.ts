import type { LandblockOwnerId } from "../game-types";
import type { RenderGeometryData } from "../renderer/geometry";
import type { StaticGeometryKey } from "../systems/static-resources";

declare const terrainGeometryKeyBrand: unique symbol;
declare const objectGeometryKeyBrand: unique symbol;
declare const portalGeometryKeyBrand: unique symbol;

/** Stable geometry resource containing every generated terrain variant for one landblock. */
export type TerrainGeometryKey = `terrain-geometry:${LandblockOwnerId}` & {
	readonly [terrainGeometryKeyBrand]: true;
};

export type { StaticGeometryKey } from "../systems/static-resources";

/** Reusable object-local geometry selected by a resolved object presentation. */
export type ObjectGeometryKey = `object-geometry:${string}` & {
	readonly [objectGeometryKeyBrand]: true;
};

/** Material-free aperture geometry selected by portal traversal and mask rendering. */
export type PortalGeometryKey = `portal-geometry:${string}` & {
	readonly [portalGeometryKeyBrand]: true;
};

/** Logical identity for a complete device-backed geometry resource. */
export type GeometryKey =
	| TerrainGeometryKey
	| StaticGeometryKey
	| ObjectGeometryKey
	| PortalGeometryKey;

/** Complete geometry payload published by a baker or runtime generator. */
export interface GeometrySource {
	readonly key: GeometryKey;
	readonly geometry: RenderGeometryData;
}

/** Build the canonical generated terrain-geometry identity for one landblock. */
export function createTerrainGeometryKey(
	landblockId: LandblockOwnerId,
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

/** Build one stable geometry identity from an authored portal-aperture identity. */
export function createPortalGeometryKey(source: string): PortalGeometryKey {
	if (source.length === 0) {
		throw new Error("Portal geometry source identity cannot be empty.");
	}
	return `portal-geometry:${source}` as PortalGeometryKey;
}
