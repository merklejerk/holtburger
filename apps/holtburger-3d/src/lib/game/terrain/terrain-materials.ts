import { TERRAIN_MATERIAL_CODES } from "./pcode";
import type { TerrainMaterialTable, TerrainMaterialType } from "./types";

/** Resolve every addressable terrain code once using the active region's first-entry fallback. */
export function resolveTerrainMaterialTable(
	authored: readonly TerrainMaterialType[],
): TerrainMaterialTable {
	const fallback = authored[0];
	if (!fallback) {
		throw new Error(
			"Installed active region has no terrain descriptor fallback.",
		);
	}
	const authoredByCode = new Map<number, TerrainMaterialType>();
	for (const material of authored) {
		// Preserve the original composition lookup's first-authored match if malformed content
		// repeats a terrain code; later duplicates must not silently change regional appearance.
		if (!authoredByCode.has(material.terrainType)) {
			authoredByCode.set(material.terrainType, material);
		}
	}
	return {
		authored: Object.freeze([...authored]),
		byCode: Object.freeze(
			Object.fromEntries(
				TERRAIN_MATERIAL_CODES.map((terrainCode) => [
					terrainCode,
					authoredByCode.get(terrainCode) ?? fallback,
				]),
			) as TerrainMaterialTable["byCode"],
		),
	};
}
