import type {
	LandblockSourceBatch,
	LandblockSourceBatchSource,
	LandblockSourceRecord,
	LandblockSourceLayer,
} from "../../assets/landblock-source-batch";
import type {
	ResolvedEnvCellLayerSource,
	ResolvedOutdoorStaticLayerSource,
	ResolvedTerrainLayerSource,
} from "../resolution/landblock-layer";
import {
	groupLandblockLayers,
	isOutdoorStaticLayer,
	LandblockLayerKind,
	type LandblockIdLayer,
	type OutdoorStaticLayerKind,
} from "../runtime/scene-interest";
import type {
	CommitPipeline,
	LandblockLayerCommit,
	StaticLandblockLayerCommitTerrain,
} from "./types";
import { planEnvCellMaterialization } from "./env-cell-materialization";

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
	): Promise<readonly LandblockLayerCommit[]> {
		const bundles = await Promise.all(
			[...groupLandblockLayers(layers).values()].map((group) =>
				this.#prepareLandblockBatch(group),
			),
		);
		return bundles.flat();
	}

	async destroy(): Promise<void> {}

	async #prepareLandblockBatch(
		layers: readonly LandblockIdLayer[],
	): Promise<readonly LandblockLayerCommit[]> {
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
				layer.layer !== LandblockLayerKind.EnvCells &&
				!isOutdoorStaticLayer(layer.layer)
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
	): LandblockLayerCommit | [] {
		if (
			layer.layer !== LandblockLayerKind.Terrain &&
			layer.layer !== LandblockLayerKind.EnvCells &&
			!isOutdoorStaticLayer(layer.layer)
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
		if (layer.layer === LandblockLayerKind.EnvCells) {
			if (source === null) return [];
			if (!isEnvCellSource(source) || source.landblockId !== layer.id) {
				throw new Error(
					`Loaded ${source.landblockId}/${source.kind} for ${describeLayer(layer)}.`,
				);
			}
			return this.#prepareEnvCellLayer(source);
		}
		if (source === null) {
			throw new Error(
				`Source batch returned no source for ${describeLayer(layer)}.`,
			);
		}
		if (
			!isOutdoorStaticSource(source, layer.layer) ||
			source.landblockId !== layer.id
		) {
			throw new Error(
				`Loaded ${source.landblockId}/${source.kind} for ${describeLayer(layer)}.`,
			);
		}
		return this.#prepareOutdoorStaticLayer(source);
	}

	#prepareTerrainLayer(
		source: ResolvedTerrainLayerSource,
	): LandblockLayerCommit {
		return {
			commit: this.#createTerrainSourceCommit(source),
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

	#prepareOutdoorStaticLayer(
		source: ResolvedOutdoorStaticLayerSource,
	): LandblockLayerCommit {
		switch (source.kind) {
			case LandblockLayerKind.Buildings:
				return {
					commit: { source },
					landblockId: source.landblockId,
					layer: source.kind,
				};
			case LandblockLayerKind.Objects:
				return {
					commit: { source },
					landblockId: source.landblockId,
					layer: source.kind,
				};
			case LandblockLayerKind.Generated:
				return {
					commit: { source },
					landblockId: source.landblockId,
					layer: source.kind,
				};
		}
	}

	#prepareEnvCellLayer(
		source: ResolvedEnvCellLayerSource,
	): LandblockLayerCommit {
		const plan = planEnvCellMaterialization(source);
		return {
			commit: { plan },
			landblockId: source.landblockId,
			layer: LandblockLayerKind.EnvCells,
		};
	}
}

function isEnvCellSource(
	source: Exclude<LandblockSourceRecord, null>,
): source is ResolvedEnvCellLayerSource {
	return source.kind === LandblockLayerKind.EnvCells;
}

function describeLayer(layer: LandblockIdLayer): string {
	return `landblock ${layer.id} layer ${layer.layer}`;
}

function isOutdoorStaticSource<TLayer extends OutdoorStaticLayerKind>(
	source: Exclude<LandblockSourceRecord, null>,
	layer: TLayer,
): source is Extract<
	ResolvedOutdoorStaticLayerSource,
	{ readonly kind: TLayer }
> {
	return source.kind === layer;
}
