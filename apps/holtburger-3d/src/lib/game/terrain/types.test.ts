import { describe, expect, it } from "vitest";
import {
	resolveTerrainTextureFacts,
	selectTerrainMeshStride,
	selectTerrainTransitionDirection,
	type TerrainCompositionFacts,
} from "./types";

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
	regionNumber: 42,
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
	terrainTypes: [
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
	],
};

describe("terrain types", () => {
	it("derives ordered regional arrays and a standalone detail texture", () => {
		const facts = resolveTerrainTextureFacts(COMPOSITION);

		expect(facts.colors).toMatchObject({
			key: "texture-array:terrain-color:terrain-region:42",
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
			terrainTypes: [...COMPOSITION.terrainTypes],
		});

		expect(secondLandblockFacts).toEqual(firstLandblockFacts);
	});

	it("selects retail stride rings", () => {
		expect(selectTerrainMeshStride("0x1111ffff", "0x1111ffff")).toBe(1);
		expect(selectTerrainMeshStride("0x1311ffff", "0x1111ffff")).toBe(2);
		expect(selectTerrainMeshStride("0x1411ffff", "0x1111ffff")).toBe(4);
		expect(selectTerrainMeshStride("0x1611ffff", "0x1111ffff")).toBe(8);
	});

	it.each([
		["0x1111ffff", "viewer-block"],
		["0x1211ffff", "east"],
		["0x1210ffff", "northeast"],
		["0x1312ffff", "east"],
		["0x1213ffff", "south"],
		["0x1313ffff", "southeast"],
		["0x1411ffff", "viewer-block"],
		["0x1512ffff", "east"],
		["0x1415ffff", "south"],
		["0x1515ffff", "southeast"],
		["0x1611ffff", "viewer-block"],
	] as const)(
		"matches retail's transition ring for %s",
		(landblockId, transitionDirection) => {
			expect(
				selectTerrainTransitionDirection(landblockId, "0x1111ffff"),
			).toBe(transitionDirection);
		},
	);
});
