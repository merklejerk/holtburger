import type {
	LandblockSourceBatch,
	LandblockSourceBatchSource,
	LandblockSourceLayer,
	LandblockSourceRecord,
} from "../../lib/assets/landblock-source-batch";
import type { LandblockOwnerId } from "../../lib/game/game-types";
import { LandblockLayerKind } from "../../lib/game/runtime/scene-interest";

/** Harness-only source decorator that retains terrain and authored dynamics but strips outdoor statics. */
export class DynamicOnlyLandblockSource implements LandblockSourceBatchSource {
	readonly #source: LandblockSourceBatchSource;

	constructor(source: LandblockSourceBatchSource) {
		this.#source = source;
	}

	async loadLandblockSourceBatch(
		landblockId: LandblockOwnerId,
		layers: ReadonlySet<LandblockSourceLayer>,
	): Promise<LandblockSourceBatch> {
		const batch = await this.#source.loadLandblockSourceBatch(
			landblockId,
			layers,
		);
		return {
			...batch,
			records: new Map(
				[...batch.records].map(([layer, record]) => [
					layer,
					stripOutdoorStaticResidents(record),
				]),
			),
		};
	}
}

/** Harness-only source decorator that removes promoted dynamics while retaining outdoor statics. */
export class WithoutAuthoredDynamicsLandblockSource implements LandblockSourceBatchSource {
	readonly #source: LandblockSourceBatchSource;

	constructor(source: LandblockSourceBatchSource) {
		this.#source = source;
	}

	async loadLandblockSourceBatch(
		landblockId: LandblockOwnerId,
		layers: ReadonlySet<LandblockSourceLayer>,
	): Promise<LandblockSourceBatch> {
		const batch = await this.#source.loadLandblockSourceBatch(
			landblockId,
			layers,
		);
		return {
			...batch,
			records: new Map(
				[...batch.records].map(([layer, record]) => [
					layer,
					stripAuthoredDynamics(record),
				]),
			),
		};
	}
}

function stripOutdoorStaticResidents(
	record: LandblockSourceRecord,
): LandblockSourceRecord {
	if (record === null) return record;
	switch (record.kind) {
		case LandblockLayerKind.Buildings:
		case LandblockLayerKind.Objects:
		case LandblockLayerKind.Generated:
			return { ...record, staticResidents: [] };
		case LandblockLayerKind.Terrain:
		case LandblockLayerKind.EnvCells:
			return record;
	}
}

function stripAuthoredDynamics(
	record: LandblockSourceRecord,
): LandblockSourceRecord {
	if (record === null) return record;
	switch (record.kind) {
		case LandblockLayerKind.Buildings:
		case LandblockLayerKind.Objects:
		case LandblockLayerKind.Generated:
			return { ...record, dynamicSources: [] };
		case LandblockLayerKind.Terrain:
		case LandblockLayerKind.EnvCells:
			return record;
	}
}
