import type { LandblockBuildingSource } from "../../assets/landblock-building-source";
import type { LandblockTerrainSource } from "../../assets/landblock-terrain-source";
import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import type { ResolvedTerrainLayerSource } from "../resolution/landblock-layer";
import {
	LandblockLayerKind,
	type LandblockIdLayer,
} from "../runtime/scene-interest";
import {
	CommitBundleSourceKind,
	type CommitBundle,
	type CommitPipeline,
	type StaticObjectLayerCommit,
	type StaticLandblockLayerCommitTerrain,
} from "./types";
import { assembleBuildingArtifact } from "./building-artifact";
import { prepareBuildingTextureInputs } from "./building-texture-inputs";
import { BuildingWorkers } from "./building-workers";

/** Composite source and worker dependencies owned by the standard landblock commit pipeline. */
export interface StandardCommitPipelineDependencies {
	readonly terrainSource: LandblockTerrainSource;
	readonly buildingSource?: LandblockBuildingSource;
	readonly texturePixelSource?: TexturePixelSource;
	readonly buildingWorkers?: BuildingWorkers;
}

export class StandardCommitPipeline implements CommitPipeline {
	readonly #terrainSource: LandblockTerrainSource;
	readonly #buildingSource: LandblockBuildingSource | null;
	readonly #texturePixelSource: TexturePixelSource | null;
	readonly #buildingWorkers: BuildingWorkers | null;
	#nextStaticNamespace = 0;

	protected constructor(dependencies: StandardCommitPipelineDependencies) {
		this.#terrainSource = dependencies.terrainSource;
		const hasBuildingDependencies =
			dependencies.buildingSource !== undefined || dependencies.texturePixelSource !== undefined;
		if (
			hasBuildingDependencies &&
			(dependencies.buildingSource === undefined || dependencies.texturePixelSource === undefined)
		) {
			throw new Error("Building commits require both building source and texture pixel capabilities.");
		}
		this.#buildingSource = dependencies.buildingSource ?? null;
		this.#texturePixelSource = dependencies.texturePixelSource ?? null;
		this.#buildingWorkers =
			dependencies.buildingWorkers ??
			(this.#buildingSource === null ? null : BuildingWorkers.build());
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

	async destroy(): Promise<void> {
		this.#buildingWorkers?.destroy();
	}

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
			throw new Error(`No typed source capability exists yet for ${describeLayer(layer)}.`);
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
		const source = await this.#requireBuildingSource().loadBuildingSource(layer.id);
		if (source === null) return null;
		if (source.kind !== LandblockLayerKind.Buildings || source.landblockId !== layer.id) {
			throw new Error(`Loaded ${source.landblockId}/${source.kind} for ${describeLayer(layer)}.`);
		}
		const resourceNamespace = `static-install:buildings:${layer.id}:${this.#nextStaticNamespace}` as const;
		this.#nextStaticNamespace += 1;
		// Pixel preparation starts before geometry transfer. It has collected every dependency before
		// its first await, so the geometry worker can take ownership of source buffers immediately.
		const textureInputs = prepareBuildingTextureInputs(this.#requireTexturePixelSource(), source);
		const geometry = this.#requireBuildingWorkers().bake({ resourceNamespace, source });
		const textures = textureInputs.then((inputs) =>
			this.#requireBuildingWorkers().pack({ inputs, resourceNamespace }),
		);
		const artifact = assembleBuildingArtifact({
			geometry: await geometry,
			resourceNamespace,
			source,
			textures: await textures,
		});
		const commit: StaticObjectLayerCommit = { staticObjects: artifact };
		return {
			commit,
			dynamicEntities: source.dynamicResidents,
			kind: CommitBundleSourceKind.LandblockLayer,
			landblockId: source.landblockId,
			layer: LandblockLayerKind.Buildings,
		};
	}

	#requireBuildingSource(): LandblockBuildingSource {
		if (this.#buildingSource === null) throw new Error("Building source capability is unavailable.");
		return this.#buildingSource;
	}

	#requireTexturePixelSource(): TexturePixelSource {
		if (this.#texturePixelSource === null) throw new Error("Building texture capability is unavailable.");
		return this.#texturePixelSource;
	}

	#requireBuildingWorkers(): BuildingWorkers {
		if (this.#buildingWorkers === null) throw new Error("Building workers are unavailable.");
		return this.#buildingWorkers;
	}
}

function describeLayer(layer: LandblockIdLayer): string {
	return `landblock ${layer.id} layer ${layer.layer}`;
}
