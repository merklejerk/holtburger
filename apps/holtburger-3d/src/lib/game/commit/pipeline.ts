import type {
	LandblockSourceBatch,
	LandblockSourceBatchSource,
	LandblockSourceRecord,
	LandblockSourceLayer,
} from "../../assets/landblock-source-batch";
import type {
	ResolvedOutdoorStaticLayerSource,
	ResolvedTerrainLayerSource,
} from "../resolution/landblock-layer";
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
	readonly sourceBatch: LandblockSourceBatchSource;
}

export class StandardCommitPipeline implements CommitPipeline {
	readonly #sourceBatch: LandblockSourceBatchSource;

	protected constructor(dependencies: StandardCommitPipelineDependencies) {
		this.#sourceBatch = dependencies.sourceBatch;
	}

	static async build(
		dependencies: StandardCommitPipelineDependencies,
	): Promise<StandardCommitPipeline> {
		return new StandardCommitPipeline(dependencies);
	}

	async prepareLandblockLayers(
		layers: ReadonlySet<LandblockIdLayer>,
	): Promise<readonly CommitBundle[]> {
		const byLandblock = new Map<string, LandblockIdLayer[]>();
		for (const layer of layers) {
			const group = byLandblock.get(layer.id);
			if (group) group.push(layer);
			else byLandblock.set(layer.id, [layer]);
		}
		const bundles = await Promise.all(
			[...byLandblock.values()].map((group) =>
				this.#prepareLandblockBatch(group),
			),
		);
		return bundles.flat();
	}

	async destroy(): Promise<void> {}

	async #prepareLandblockBatch(
		layers: readonly LandblockIdLayer[],
	): Promise<readonly CommitBundle[]> {
		const landblockId = layers[0]?.id;
		if (!landblockId) return [];
		if (layers.some((layer) => layer.id !== landblockId)) {
			throw new Error(
				"Landblock source batches must contain one landblock identity.",
			);
		}
		const requestedLayers = new Set<LandblockSourceLayer>();
		for (const layer of layers) {
			if (
				layer.layer !== LandblockLayerKind.Terrain &&
				layer.layer !== LandblockLayerKind.Buildings
			) {
				throw new Error(
					`No typed source capability exists yet for ${describeLayer(layer)}.`,
				);
			}
			requestedLayers.add(layer.layer);
		}
		const sourceBatch = await this.#sourceBatch.loadLandblockSourceBatch(
			landblockId,
			requestedLayers,
		);
		if (sourceBatch.landblockId !== landblockId) {
			throw new Error(
				`Loaded source batch for ${sourceBatch.landblockId} instead of ${landblockId}.`,
			);
		}
		return layers.flatMap((layer) =>
			this.#prepareSourceRecord(sourceBatch, layer),
		);
	}

	#prepareSourceRecord(
		batch: LandblockSourceBatch,
		layer: LandblockIdLayer,
	): CommitBundle | [] {
		if (
			layer.layer !== LandblockLayerKind.Terrain &&
			layer.layer !== LandblockLayerKind.Buildings
		) {
			throw new Error(
				`No typed source capability exists yet for ${describeLayer(layer)}.`,
			);
		}
		const source = batch.records.get(layer.layer);
		if (source === undefined) {
			throw new Error(`Source batch omitted ${describeLayer(layer)}.`);
		}
		if (layer.layer === LandblockLayerKind.Terrain) {
			if (source === null) return [];
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
		if (source === null) {
			throw new Error(
				`Source batch returned no source for ${describeLayer(layer)}.`,
			);
		}
		if (!isBuildingsSource(source) || source.landblockId !== layer.id) {
			throw new Error(
				`Loaded ${source.landblockId}/${source.kind} for ${describeLayer(layer)}.`,
			);
		}
		return this.#prepareBuildingLayer(source);
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

	#prepareBuildingLayer(
		source: ResolvedOutdoorStaticLayerSource,
	): CommitBundle {
		return {
			commit: { source },
			dynamicEntities: source.dynamicResidents,
			kind: CommitBundleSourceKind.LandblockLayer,
			landblockId: source.landblockId,
			layer: LandblockLayerKind.Buildings,
		};
	}
}

function describeLayer(layer: LandblockIdLayer): string {
	return `landblock ${layer.id} layer ${layer.layer}`;
}

function isBuildingsSource(
	source: Exclude<LandblockSourceRecord, null>,
): source is ResolvedOutdoorStaticLayerSource & {
	readonly kind: LandblockLayerKind.Buildings;
} {
	return source.kind === LandblockLayerKind.Buildings;
}
