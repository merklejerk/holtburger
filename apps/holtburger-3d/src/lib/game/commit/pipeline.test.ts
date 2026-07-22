import { describe, expect, it } from "vitest";
import type { AssetBridge } from "../../assets/asset-bridge";
import type { ResolvedTerrainLayerSource } from "../resolution/landblock-layer";
import {
	LandblockLayerKind,
	type LandblockIdLayer,
} from "../runtime/scene-interest";
import type {
	TexturePreparationServiceRequest,
	TexturePreparationServiceResponse,
} from "../textures/texture-preparer";
import { resolveTerrainTextureFacts } from "../terrain/types";
import { StandardCommitPipeline } from "./pipeline";

describe("StandardCommitPipeline", () => {
	it("commits terrain facts without preparing pixels or generated geometry", async () => {
		const source = createTerrainSource("0x0001ffff");
		const assets = new FakeAssetBridge(new Map([[source.landblockId, source]]));
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
			heightBytes: new Uint8Array(81),
			terrainSamples: new Uint16Array(81),
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

class FakeAssetBridge implements AssetBridge {
	constructor(
		readonly sources: ReadonlyMap<string, ResolvedTerrainLayerSource>,
	) {}

	async resolveLandblockLayer(layer: LandblockIdLayer) {
		const source = this.sources.get(layer.id);
		if (source === undefined) throw new Error(`Missing source ${layer.id}.`);
		return source;
	}

	async requestTexturePreparationAsset(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
		throw new Error(`Unexpected texture asset request ${request.kind}.`);
	}
}
