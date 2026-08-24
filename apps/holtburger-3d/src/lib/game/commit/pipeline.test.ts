import { describe, expect, it } from "vitest";
import type {
	LandblockSourceBatch,
	LandblockSourceBatchSource,
	LandblockSourceLayer,
} from "../../assets/landblock-source-batch";
import { LandblockLayerKind } from "../runtime/scene-interest";
import type {
	ResolvedObjectLayerSource,
	ResolvedTerrainLayerSource,
} from "../resolution/landblock-layer";
import { StandardCommitPipeline } from "./pipeline";

describe("StandardCommitPipeline", () => {
	it("hands resolved building source to the runtime without preparing pixels or geometry", async () => {
		const source = {
			dynamicSources: [],
			mapBlockers: new Map(),
			kind: LandblockLayerKind.Buildings,
			landblockId: "0xda55ffff",
			staticResidents: [],
		} as unknown as ResolvedObjectLayerSource;
		const pipeline = await StandardCommitPipeline.build({
			sourceBatch: new SourceBatch(source),
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
				landblockId: source.landblockId,
				layer: LandblockLayerKind.Buildings,
			},
		]);
	});

	it("acquires terrain and buildings in one same-landblock source batch", async () => {
		const landblockId = "0xda55ffff" as const;
		const terrain = {
			kind: LandblockLayerKind.Terrain,
			landblockId,
		} as unknown as ResolvedTerrainLayerSource;
		const buildings = {
			dynamicSources: [],
			mapBlockers: new Map(),
			kind: LandblockLayerKind.Buildings,
			landblockId,
			staticResidents: [],
		} as unknown as ResolvedObjectLayerSource;
		const sourceBatch = new RecordingSourceBatch(
			new Map<
				LandblockSourceLayer,
				ResolvedTerrainLayerSource | ResolvedObjectLayerSource | null
			>([
				[LandblockLayerKind.Terrain, terrain],
				[LandblockLayerKind.Buildings, buildings],
			]),
		);
		const pipeline = await StandardCommitPipeline.build({ sourceBatch });

		const bundles = await pipeline.prepareLandblockLayers(
			new Set([
				{ id: landblockId, layer: LandblockLayerKind.Terrain },
				{ id: landblockId, layer: LandblockLayerKind.Buildings },
			]),
		);

		expect(bundles).toHaveLength(2);
		expect(sourceBatch.requests).toEqual([
			{
				landblockId,
				layers: [LandblockLayerKind.Terrain, LandblockLayerKind.Buildings],
			},
		]);
	});

	it("fans all same-landblock source layers into independent commits", async () => {
		const landblockId = "0xda55ffff" as const;
		const terrain = {
			kind: LandblockLayerKind.Terrain,
			landblockId,
		} as unknown as ResolvedTerrainLayerSource;
		const buildings = outdoorSource(landblockId, LandblockLayerKind.Buildings);
		const objects = outdoorSource(landblockId, LandblockLayerKind.Objects);
		const generated = outdoorSource(landblockId, LandblockLayerKind.Generated);
		const sourceBatch = new RecordingSourceBatch(
			new Map<
				LandblockSourceLayer,
				ResolvedTerrainLayerSource | ResolvedObjectLayerSource | null
			>([
				[LandblockLayerKind.Terrain, terrain],
				[LandblockLayerKind.Buildings, buildings],
				[LandblockLayerKind.Objects, objects],
				[LandblockLayerKind.Generated, generated],
			]),
		);
		const pipeline = await StandardCommitPipeline.build({ sourceBatch });

		const bundles = await pipeline.prepareLandblockLayers(
			new Set([
				{ id: landblockId, layer: LandblockLayerKind.Terrain },
				{ id: landblockId, layer: LandblockLayerKind.Buildings },
				{ id: landblockId, layer: LandblockLayerKind.Objects },
				{ id: landblockId, layer: LandblockLayerKind.Generated },
			]),
		);

		expect(sourceBatch.requests).toEqual([
			{
				landblockId,
				layers: [
					LandblockLayerKind.Terrain,
					LandblockLayerKind.Buildings,
					LandblockLayerKind.Objects,
					LandblockLayerKind.Generated,
				],
			},
		]);
		expect(bundles).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					commit: { source: buildings },
					layer: LandblockLayerKind.Buildings,
				}),
				expect.objectContaining({
					commit: { source: objects },
					layer: LandblockLayerKind.Objects,
				}),
				expect.objectContaining({
					commit: { source: generated },
					layer: LandblockLayerKind.Generated,
				}),
			]),
		);
	});
});

function outdoorSource(
	landblockId: string,
	kind:
		| LandblockLayerKind.Buildings
		| LandblockLayerKind.Objects
		| LandblockLayerKind.Generated,
): ResolvedObjectLayerSource {
	return {
		dynamicSources: [],
		mapBlockers: new Map(),
		kind,
		landblockId,
		staticResidents: [],
	};
}

class SourceBatch implements LandblockSourceBatchSource {
	constructor(private readonly source: ResolvedObjectLayerSource) {}
	async loadLandblockSourceBatch(
		landblockId: string,
		layers: ReadonlySet<LandblockSourceLayer>,
	): Promise<LandblockSourceBatch> {
		return {
			landblockId,
			records: new Map(
				[...layers].map((layer) => [
					layer,
					layer === LandblockLayerKind.Buildings ? this.source : null,
				]),
			),
		};
	}
}

class RecordingSourceBatch implements LandblockSourceBatchSource {
	readonly requests: {
		readonly landblockId: string;
		readonly layers: readonly LandblockSourceLayer[];
	}[] = [];

	constructor(
		private readonly records: ReadonlyMap<
			LandblockSourceLayer,
			ResolvedTerrainLayerSource | ResolvedObjectLayerSource | null
		>,
	) {}

	async loadLandblockSourceBatch(
		landblockId: string,
		layers: ReadonlySet<LandblockSourceLayer>,
	): Promise<LandblockSourceBatch> {
		this.requests.push({ landblockId, layers: [...layers] });
		return { landblockId, records: this.records };
	}
}
