import { describe, expect, it } from "vitest";
import type { LandblockBuildingSource } from "../../assets/landblock-building-source";
import type { LandblockTerrainSource } from "../../assets/landblock-terrain-source";
import { LandblockLayerKind } from "../runtime/scene-interest";
import type {
	ResolvedObjectLayerSource,
	ResolvedTerrainLayerSource,
} from "../resolution/landblock-layer";
import { StandardCommitPipeline } from "./pipeline";

describe("StandardCommitPipeline", () => {
	it("hands resolved building source to the runtime without preparing pixels or geometry", async () => {
		const source = {
			dynamicResidents: [],
			kind: LandblockLayerKind.Buildings,
			landblockId: "0xda55ffff",
			staticResidents: [],
		} as unknown as ResolvedObjectLayerSource;
		const pipeline = await StandardCommitPipeline.build({
			buildingSource: new BuildingSource(source),
			terrainSource: new TerrainSource(),
		});

		await expect(
			pipeline.prepareLandblockLayers(
				new Set([
					{ id: source.landblockId, layer: LandblockLayerKind.Buildings },
				]),
			),
		).resolves.toEqual([
			{
				commit: { source },
				dynamicEntities: [],
				kind: 0,
				landblockId: source.landblockId,
				layer: LandblockLayerKind.Buildings,
			},
		]);
	});
});

class BuildingSource implements LandblockBuildingSource {
	constructor(private readonly source: ResolvedObjectLayerSource) {}
	async loadBuildingSource(): Promise<ResolvedObjectLayerSource> {
		return this.source;
	}
}

class TerrainSource implements LandblockTerrainSource {
	async loadTerrainSource(): Promise<ResolvedTerrainLayerSource | null> {
		return null;
	}
}
