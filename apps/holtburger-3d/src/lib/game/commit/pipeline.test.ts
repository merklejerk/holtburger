import { describe, expect, it } from "vitest";
import type { LandblockTerrainSource } from "../../assets/landblock-terrain-source";
import type { ResolvedTerrainLayerSource } from "../resolution/landblock-layer";
import {
	LandblockLayerKind,
	type LandblockIdLayer,
} from "../runtime/scene-interest";
import { resolveTerrainTextureFacts } from "../terrain/types";
import { StandardCommitPipeline } from "./pipeline";

describe("StandardCommitPipeline", () => {
	it("commits terrain facts without preparing pixels or generated geometry", async () => {
		const source = createTerrainSource("0x0001ffff");
		const assets = new FakeTerrainSource(
			new Map([[source.landblockId, source]]),
		);
		const pipeline = await StandardCommitPipeline.build(assets);

		const [bundle] = await pipeline.prepareLandblockLayers(
			new Set([terrainLayer(source.landblockId)]),
		);

		expect(bundle).toMatchObject({
			commit: {
				generation: source.generation,
				presentation: source.presentation,
			},
			kind: 0,
			landblockId: source.landblockId,
			layer: LandblockLayerKind.Terrain,
		});
		await pipeline.destroy();
	});
});

function terrainLayer(id: string): LandblockIdLayer {
	return { id, layer: LandblockLayerKind.Terrain };
}

function createTerrainSource(landblockId: string): ResolvedTerrainLayerSource {
	const composition = {
		cornerTerrainAlphaMaps: [
			{ blendMaskTextureId: "0x05000002", terrainCode: 1 },
		],
		landscapeDetail: { textureId: "0x05000004", tiling: 1 },
		regionNumber: 1,
		roadAlphaMaps: [
			{
				roadMaskTextureId: "0x05000003",
				roadCode: 1,
			},
		],
		sideTerrainAlphaMaps: [
			{ blendMaskTextureId: "0x05000002", terrainCode: 3 },
		],
		terrainTypes: [
			{
				colorTextureId: "0x05000001",
				colorVariation: TERRAIN_VARIATION,
				terrainType: 0,
				tiling: 1,
			},
		],
	} as const;
	return {
		generation: {
			gridSize: 9,
			heightIndices: new Uint8Array(81),
			heights: new Float32Array(81),
			landblockId,
			terrainSamples: new Uint16Array(81),
			tileSize: 24,
		},
		kind: LandblockLayerKind.Terrain,
		landblockId,
		presentation: {
			composition,
			textures: resolveTerrainTextureFacts(composition),
		},
	};
}

const TERRAIN_VARIATION = {
	maxVertexBrightness: 0,
	maxVertexHue: 0,
	maxVertexSaturation: 0,
	minVertexBrightness: 0,
	minVertexHue: 0,
	minVertexSaturation: 0,
} as const;

class FakeTerrainSource implements LandblockTerrainSource {
	constructor(
		readonly sources: ReadonlyMap<string, ResolvedTerrainLayerSource>,
	) {}

	async loadTerrainSource(landblockId: string) {
		const source = this.sources.get(landblockId);
		if (source === undefined) throw new Error(`Missing source ${landblockId}.`);
		return source;
	}
}
