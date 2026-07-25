import type { LandblockBuildingSource } from "../../assets/landblock-building-source";
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

/** Composite source and worker dependencies owned by the standard landblock commit pipeline. */
export interface StandardCommitPipelineDependencies {
	readonly terrainSource: LandblockTerrainSource;
	readonly buildingSource?: LandblockBuildingSource;
}

export class StandardCommitPipeline implements CommitPipeline {
	readonly #terrainSource: LandblockTerrainSource;
	readonly #buildingSource: LandblockBuildingSource | null;

	protected constructor(dependencies: StandardCommitPipelineDependencies) {
		this.#terrainSource = dependencies.terrainSource;
		this.#buildingSource = dependencies.buildingSource ?? null;
	}

	static async build(
		dependencies: StandardCommitPipelineDependencies,
	): Promise<StandardCommitPipeline> {
		return new StandardCommitPipeline(dependencies);
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
		if (layer.layer === LandblockLayerKind.Terrain) {
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
		if (layer.layer !== LandblockLayerKind.Buildings) {
			throw new Error(
				`No typed source capability exists yet for ${describeLayer(layer)}.`,
			);
		}
		return this.#prepareBuildingLayer(layer);
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

	async #prepareBuildingLayer(
		layer: LandblockIdLayer,
	): Promise<CommitBundle | null> {
		const source = await this.#requireBuildingSource().loadBuildingSource(
			layer.id,
		);
		if (source === null) return null;
		if (
			source.kind !== LandblockLayerKind.Buildings ||
			source.landblockId !== layer.id
		) {
			throw new Error(
				`Loaded ${source.landblockId}/${source.kind} for ${describeLayer(layer)}.`,
			);
		}
		return {
			commit: { source },
			dynamicEntities: source.dynamicResidents,
			kind: CommitBundleSourceKind.LandblockLayer,
			landblockId: source.landblockId,
			layer: LandblockLayerKind.Buildings,
		};
	}

	#requireBuildingSource(): LandblockBuildingSource {
		if (this.#buildingSource === null)
			throw new Error("Building source capability is unavailable.");
		return this.#buildingSource;
	}
}

function describeLayer(layer: LandblockIdLayer): string {
	return `landblock ${layer.id} layer ${layer.layer}`;
}
