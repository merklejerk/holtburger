import { describe, expect, it } from "vitest";
import {
	TERRAIN_COMPOSITION_TABLE_HEIGHT,
	compileTerrainCompositionTable,
} from "./composition-table";
import {
	resolveTerrainTextureFacts,
	type TerrainCompositionFacts,
} from "./types";
import { resolveTerrainMaterialTable } from "./terrain-materials";

const VARIATION = {
	maxVertexBrightness: 12,
	maxVertexHue: 16,
	maxVertexSaturation: 14,
	minVertexBrightness: 11,
	minVertexHue: 15,
	minVertexSaturation: 13,
} as const;

describe("compileTerrainCompositionTable", () => {
	it("normalizes terrain fallbacks and preserves grouped ordered mask records", () => {
		const composition: TerrainCompositionFacts = {
			cornerTerrainAlphaMaps: [
				{ blendMaskTextureId: "0x05000003", terrainCode: 1 },
			],
			landscapeDetail: { textureId: "0x05000006", tiling: 7 },
			activeRegionKey: "test-region",
			roadAlphaMaps: [{ roadCode: 3, roadMaskTextureId: "0x05000005" }],
			sideTerrainAlphaMaps: [
				{ blendMaskTextureId: "0x05000004", terrainCode: 9 },
			],
			terrainMaterials: resolveTerrainMaterialTable([
				{
					colorTextureId: "0x05000001",
					colorVariation: VARIATION,
					terrainType: 0,
					tiling: 2,
				},
				{
					colorTextureId: "0x05000002",
					colorVariation: VARIATION,
					terrainType: 2,
					tiling: 3,
				},
			]),
		};

		const table = compileTerrainCompositionTable(
			composition,
			resolveTerrainTextureFacts(composition),
		);

		expect(table.width).toBe(33);
		expect(table.texels.length).toBe(33 * TERRAIN_COMPOSITION_TABLE_HEIGHT * 4);
		// Terrain-type rows carry only the color layer and tiling: retail's authored vertex
		// colour variation is dead data, so it is never uploaded.
		expect(record(table, 0, 0)).toEqual([0, 2, 0, 0]);
		expect(record(table, 2, 0)).toEqual([1, 3, 0, 0]);
		expect(record(table, 32, 0)).toEqual([0, 2, 0, 0]);
		expect(record(table, 0, 1)).toEqual([0, 1, 0, 0]);
		expect(record(table, 0, 2)).toEqual([1, 9, 0, 0]);
		expect(record(table, 0, 3)).toEqual([0, 3, 0, 0]);
		expect(record(table, 0, 4)).toEqual([1, 1, 1, 7]);
	});
});

function record(
	table: { readonly width: number; readonly texels: Uint32Array },
	column: number,
	row: number,
): number[] {
	const offset = (row * table.width + column) * 4;
	return Array.from(table.texels.slice(offset, offset + 4));
}
