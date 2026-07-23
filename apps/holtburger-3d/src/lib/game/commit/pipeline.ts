import type { LandblockTerrainSource } from "../../assets/landblock-terrain-source";
import type { ResolvedTerrainLayerSource } from "../resolution/landblock-layer";
import {
	LandblockLayerKind,
	type LandblockIdLayer,
} from "../runtime/scene-interest";
import {
	CommitBundleSourceKind,
	type CommitBundle,
	type CommitPipeline,
	type StaticLandblockLayerCommitTerrain,
} from "./types";

export class StandardCommitPipeline implements CommitPipeline {
	readonly #terrainSource: LandblockTerrainSource;

	protected constructor(terrainSource: LandblockTerrainSource) {
		this.#terrainSource = terrainSource;
	}

	static async build(
		terrainSource: LandblockTerrainSource,
	): Promise<StandardCommitPipeline> {
		return new StandardCommitPipeline(terrainSource);
	}

	async prepareLandblockLayers(
		layers: ReadonlySet<LandblockIdLayer>,
	): Promise<readonly CommitBundle[]> {
		const bundles = await Promise.all(
			[...layers].map((layer) => this.#prepareLandblockLayer(layer)),
		);
		return bundles.filter((bundle): bundle is CommitBundle => bundle !== null);
	}

	async destroy(): Promise<void> {}

	async #prepareLandblockLayer(
		layer: LandblockIdLayer,
	): Promise<CommitBundle | null> {
		if (layer.layer !== LandblockLayerKind.Terrain) {
			throw new Error(
				`No typed source capability exists yet for ${describeLayer(layer)}.`,
			);
		}
		const source = await this.#terrainSource.loadTerrainSource(layer.id);
		if (source === null) return null;
		if (
			source.kind !== LandblockLayerKind.Terrain ||
			source.landblockId !== layer.id
		) {
			throw new Error(
				`Loaded ${source.landblockId}/${source.kind} for ${describeLayer(layer)}.`,
			);
		}
		return this.#prepareTerrainLayer(source);
	}

	#prepareTerrainLayer(source: ResolvedTerrainLayerSource): CommitBundle {
		return {
			commit: this.#createTerrainSourceCommit(source),
			dynamicEntities: [],
			kind: CommitBundleSourceKind.LandblockLayer,
			landblockId: source.landblockId,
			layer: LandblockLayerKind.Terrain,
		};
	}

	#createTerrainSourceCommit(
		source: ResolvedTerrainLayerSource,
	): StaticLandblockLayerCommitTerrain {
		return {
			generation: source.generation,
			presentation: source.presentation,
		};
	}
}

function describeLayer(layer: LandblockIdLayer): string {
	return `landblock ${layer.id} layer ${layer.layer}`;
}
