import { describe, expect, it } from "vitest";
import {
	resolveTerrainTextureFacts,
	type TerrainCompositionFacts,
} from "./types";
import { resolveTerrainMaterialTable } from "./terrain-materials";
import { TERRAIN_COLOR_CODES } from "./pcode";
import { MAXIMUM_TERRAIN_CODE } from "./terrain-sample";

const VARIATION = {
	maxVertexBrightness: 2,
	maxVertexHue: 6,
	maxVertexSaturation: 4,
	minVertexBrightness: 1,
	minVertexHue: 5,
	minVertexSaturation: 3,
} as const;

const COMPOSITION: TerrainCompositionFacts = {
	cornerTerrainAlphaMaps: [
		{
			blendMaskTextureId: "0x05000003",
			terrainCode: 1,
		},
	],
	landscapeDetail: { textureId: "0x05000005", tiling: 1 },
	activeRegionKey: "test-region",
	roadAlphaMaps: [
		{
			roadMaskTextureId: "0x05000004",
			roadCode: 1,
		},
	],
	sideTerrainAlphaMaps: [
		{
			blendMaskTextureId: "0x05000006",
			terrainCode: 3,
		},
	],
	terrainMaterials: resolveTerrainMaterialTable([
		{
			colorTextureId: "0x05000001",
			colorVariation: VARIATION,
			terrainType: 0,
			tiling: 1,
		},
		{
			colorTextureId: "0x05000002",
			colorVariation: VARIATION,
			terrainType: 1,
			tiling: 1,
		},
	]),
};

describe("terrain types", () => {
	it("preserves the first authored descriptor for duplicate and missing codes", () => {
		const first = COMPOSITION.terrainMaterials.authored[0];
		if (!first) throw new Error("Terrain fixture has no fallback descriptor.");
		const duplicateCode = TERRAIN_COLOR_CODES[0];
		const duplicate = {
			...first,
			colorTextureId: "0x05000009" as const,
			terrainType: duplicateCode,
		};
		const materials = resolveTerrainMaterialTable([
			first,
			duplicate,
			...COMPOSITION.terrainMaterials.authored.slice(1),
		]);

		expect(materials.byCode[duplicateCode]).toBe(first);
		expect(materials.byCode[MAXIMUM_TERRAIN_CODE]).toBe(first);
	});

	it("derives ordered regional arrays and a standalone detail texture", () => {
		const facts = resolveTerrainTextureFacts(COMPOSITION);

		expect(facts.colors).toMatchObject({
			key: "texture-array:terrain-color:terrain-active-region:test-region",
			sourceAssetIds: ["0x05000001", "0x05000002"],
		});
		expect(facts.blendMasks.sourceAssetIds).toEqual([
			"0x05000003",
			"0x05000006",
		]);
		expect(facts.roadMasks.sourceAssetIds).toEqual(["0x05000004"]);
		expect(facts.detail).toMatchObject({
			key: "asset-texture:terrain-detail:0x05000005",
			sourceAssetId: "0x05000005",
		});
	});

	it("uses the same texture identities for distinct landblocks in one region", () => {
		const firstLandblockFacts = resolveTerrainTextureFacts(COMPOSITION);
		const secondLandblockFacts = resolveTerrainTextureFacts({
			...COMPOSITION,
			terrainMaterials: resolveTerrainMaterialTable([
				...COMPOSITION.terrainMaterials.authored,
			]),
		});

		expect(secondLandblockFacts).toEqual(firstLandblockFacts);
	});
});
