import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
	createStaticObjectSourceScaleMatrix,
	multiplyMat4,
	transformBoundsByMat4,
	type RenderMat4,
} from "../math/ac-placement-transform";
import type {
	StaticBounds,
	StaticObjectPartSourceFacts,
	StaticObjectSourceAssetFacts,
} from "../static/contracts";
import { outdoorLandblockIdsForSourceLocalBounds } from "../runtime/outdoor-landblock-grid";
import type {
	DynamicEntityCurrentBounds,
	DynamicEntityPartBounds,
	DynamicEntityRecord,
	DynamicEntityBoundsPrecision,
} from "./contracts";
import {
	OutdoorDynamicSpatialIndex,
	type OutdoorDynamicSpatialIndexRecord,
} from "./outdoor-dynamic-spatial-index";

const CURRENT_FRAME_BOUNDS_PRECISION =
	"current-frame-source-part-bounds-aabb" as const;

const IDENTITY_OBJECT_ROOT_POSE = {
	orientation: { w: 1, x: 0, y: 0, z: 0 },
	origin: { x: 0, y: 0, z: 0 },
} as const;

export interface EnvCellDynamicSpatialIndexRecord {
	readonly bounds: StaticBounds;
	readonly entityId: string;
	readonly envCellId: number;
	readonly landblockId: number;
	readonly precision: DynamicEntityBoundsPrecision;
	readonly sourceBounds: StaticBounds;
}

export interface DynamicPlacementUpdate {
	readonly changed: boolean;
	readonly record: DynamicEntityRecord;
}

export interface DynamicPlacementTrackerOptions {
	readonly outdoorIndex?: OutdoorDynamicSpatialIndex;
}

/** Synchronizes dynamic current-frame bounds and residence-specific index membership. */
export class DynamicPlacementTracker {
	readonly #envCellRecordsByEntityId = new Map<
		string,
		EnvCellDynamicSpatialIndexRecord
	>();
	readonly #outdoorIndex: OutdoorDynamicSpatialIndex;

	constructor(options: DynamicPlacementTrackerOptions = {}) {
		this.#outdoorIndex =
			options.outdoorIndex ?? new OutdoorDynamicSpatialIndex();
	}

	update(record: DynamicEntityRecord): DynamicPlacementUpdate {
		const next = derivePlacedRecord(
			record,
			this.#outdoorIndex,
			this.#envCellRecordsByEntityId,
		);
		return { changed: !sameBoundsAndResidence(record, next), record: next };
	}

	release(entityId: string): void {
		this.#envCellRecordsByEntityId.delete(entityId);
		this.#outdoorIndex.remove(entityId);
	}

	releaseAll(): void {
		this.#envCellRecordsByEntityId.clear();
		for (const record of this.#outdoorIndex.records()) {
			this.#outdoorIndex.remove(record.entityId);
		}
	}

	outdoorIndex(): OutdoorDynamicSpatialIndex {
		return this.#outdoorIndex;
	}

	queryOutdoorBounds(options: {
		readonly landblockId: number;
		readonly bounds: StaticBounds;
	}): readonly OutdoorDynamicSpatialIndexRecord[] {
		return this.#outdoorIndex.search(options.landblockId, options.bounds);
	}

	outdoorLandblockIds(): readonly number[] {
		return this.#outdoorIndex.landblockIds();
	}

	queryEnvCellBounds(options: {
		readonly envCellIds: readonly number[];
		readonly landblockId: number;
	}): readonly EnvCellDynamicSpatialIndexRecord[] {
		const acceptedEnvCellIds = new Set(options.envCellIds);
		return [...this.#envCellRecordsByEntityId.values()]
			.filter(
				(record) =>
					record.landblockId === options.landblockId &&
					acceptedEnvCellIds.has(record.envCellId),
			)
			.sort((left, right) => left.entityId.localeCompare(right.entityId));
	}
}

function derivePlacedRecord(
	record: DynamicEntityRecord,
	outdoorIndex: OutdoorDynamicSpatialIndex,
	envCellRecordsByEntityId: Map<string, EnvCellDynamicSpatialIndexRecord>,
): DynamicEntityRecord {
	if (
		record.animation.playback.status !== "playing" ||
		record.resources.visual.status !== "ready"
	) {
		outdoorIndex.remove(record.id);
		envCellRecordsByEntityId.delete(record.id);
		return clearDynamicBounds(record);
	}

	if (record.sourceResidence.kind === "env-cell") {
		return deriveEnvCellPlacedRecord(record, outdoorIndex, envCellRecordsByEntityId);
	}

	return deriveOutdoorPlacedRecord(record, outdoorIndex, envCellRecordsByEntityId);
}

function deriveOutdoorPlacedRecord(
	record: DynamicEntityRecord,
	outdoorIndex: OutdoorDynamicSpatialIndex,
	envCellRecordsByEntityId: Map<string, EnvCellDynamicSpatialIndexRecord>,
): DynamicEntityRecord {
	envCellRecordsByEntityId.delete(record.id);
	if (record.resources.visual.status !== "ready") {
		throw new Error("Cannot derive outdoor dynamic placement without visual resources.");
	}

	const currentBounds = deriveOutdoorCurrentBounds({
		record,
		sourceAssets: record.resources.visual.sourceAssets,
		sourceLandblockId: record.sourceResidence.landblockId,
	});
	if (currentBounds === null) {
		outdoorIndex.remove(record.id);
		return clearDynamicBounds(record);
	}

	const indexedLandblockIds = outdoorIndex.upsert({
		bounds: currentBounds.bounds,
		entityId: record.id,
		landblockIds: currentBounds.effectiveOutdoorLandblockIds,
		precision: currentBounds.precision,
		sourceLandblockId: currentBounds.sourceLandblockId,
	});
	const effectiveLandblockId = resolvePrimaryEffectiveLandblockId({
		effectiveOutdoorLandblockIds: currentBounds.effectiveOutdoorLandblockIds,
		sourceLandblockId: record.sourceResidence.landblockId,
	});

	return {
		...record,
		bounds: {
			currentBounds,
			indexMembership: {
				kind: "outdoor-landblocks",
				landblockIds: indexedLandblockIds,
			},
			indexed: indexedLandblockIds.length > 0,
			precision: currentBounds.precision,
		},
		effectiveResidence: {
			kind: "outdoor-landblock",
			landblockId: effectiveLandblockId,
		},
	};
}

function deriveEnvCellPlacedRecord(
	record: DynamicEntityRecord,
	outdoorIndex: OutdoorDynamicSpatialIndex,
	envCellRecordsByEntityId: Map<string, EnvCellDynamicSpatialIndexRecord>,
): DynamicEntityRecord {
	outdoorIndex.remove(record.id);
	if (record.sourceResidence.kind !== "env-cell") {
		throw new Error("Cannot derive env-cell dynamic placement for outdoor record.");
	}
	if (record.resources.visual.status !== "ready") {
		throw new Error("Cannot derive env-cell dynamic placement without visual resources.");
	}
	const partBounds = derivePartBounds({
		record,
		sourceAssets: record.resources.visual.sourceAssets,
	});
	if (partBounds.length === 0) {
		envCellRecordsByEntityId.delete(record.id);
		return clearDynamicBounds(record);
	}
	const currentBounds: DynamicEntityCurrentBounds = {
		bounds: unionBounds(partBounds.map((part) => part.bounds)),
		coordinateSpace: "env-cell-landblock-render-local",
		envCellId: record.sourceResidence.envCellId,
		kind: "env-cell",
		landblockId: record.sourceResidence.landblockId,
		partBounds,
		precision: CURRENT_FRAME_BOUNDS_PRECISION,
	};
	envCellRecordsByEntityId.set(record.id, {
		bounds: currentBounds.bounds,
		entityId: record.id,
		envCellId: record.sourceResidence.envCellId,
		landblockId: record.sourceResidence.landblockId,
		precision: currentBounds.precision,
		sourceBounds: currentBounds.bounds,
	});

	return {
		...record,
		bounds: {
			currentBounds,
			indexMembership: {
				envCellIds: [record.sourceResidence.envCellId],
				kind: "env-cells",
				landblockId: record.sourceResidence.landblockId,
			},
			indexed: true,
			precision: currentBounds.precision,
		},
		effectiveResidence: record.sourceResidence,
	};
}

function deriveOutdoorCurrentBounds(options: {
	readonly record: DynamicEntityRecord;
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	readonly sourceLandblockId: number;
}): Extract<DynamicEntityCurrentBounds, { readonly kind: "outdoor-landblock" }> | null {
	const partBounds = derivePartBounds({
		record: options.record,
		sourceAssets: options.sourceAssets,
	});
	if (partBounds.length === 0) {
		return null;
	}

	const bounds = unionBounds(partBounds.map((part) => part.bounds));
	const effectiveOutdoorLandblockIds = outdoorLandblockIdsForSourceLocalBounds(
		options.sourceLandblockId,
		bounds,
	);
	if (effectiveOutdoorLandblockIds.length === 0) {
		return null;
	}

	return {
		bounds,
		coordinateSpace: "source-landblock-local",
		effectiveOutdoorLandblockIds,
		kind: "outdoor-landblock",
		partBounds,
		precision: CURRENT_FRAME_BOUNDS_PRECISION,
		sourceLandblockId: options.sourceLandblockId,
	};
}

function derivePartBounds(options: {
	readonly record: DynamicEntityRecord;
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
}): readonly DynamicEntityPartBounds[] {
	const sourceAsset = selectSourceAsset(options.sourceAssets);
	if (!sourceAsset) {
		return [];
	}

	const partByIndex = new Map(
		sourceAsset.parts.map((part) => [part.partIndex, part] as const),
	);
	return options.record.animation.playback.status === "playing"
		? options.record.animation.playback.partPoses.flatMap((pose) => {
				const sourcePart = partByIndex.get(pose.partIndex);
				if (!sourcePart?.bounds) {
					return [];
				}
				return [
					{
						bounds: transformBoundsByMat4(
							sourcePart.bounds,
							createPartMatrix(
								options.record,
								sourcePart,
								pose.localPlacement,
							),
						),
						partIndex: pose.partIndex,
						sourceBounds: sourcePart.bounds,
					},
				];
			})
		: [];
}

function createPartMatrix(
	record: DynamicEntityRecord,
	sourcePart: StaticObjectPartSourceFacts,
	partPlacement: StaticObjectPartSourceFacts["defaultPlacements"][number],
): RenderMat4 {
	if (record.animation.playback.status !== "playing") {
		throw new Error("Cannot derive a dynamic part matrix without playback.");
	}

	const baseMatrix = buildAcPlacementMatrix(
		record.baseTransform.baseLocalPlacement,
		AC_UNIT_SCALE,
	);
	const objectRootMatrix = buildAcPlacementMatrix(
		record.animation.playback.objectRootPose,
		AC_UNIT_SCALE,
	);
	const omegaMatrix = buildAcPlacementMatrix(
		record.animation.playback.transformEffects.activeOmega === null
			? IDENTITY_OBJECT_ROOT_POSE
			: {
					orientation:
						record.animation.playback.transformEffects.activeOmega
							.objectRootRotation,
					origin: IDENTITY_OBJECT_ROOT_POSE.origin,
				},
		AC_UNIT_SCALE,
	);
	const partMatrix = buildAcPlacementMatrix(partPlacement, AC_UNIT_SCALE);
	const scaleMatrix = createStaticObjectSourceScaleMatrix({
		x: record.baseTransform.sourceScale.x * sourcePart.scale.x,
		y: record.baseTransform.sourceScale.y * sourcePart.scale.y,
		z: record.baseTransform.sourceScale.z * sourcePart.scale.z,
	});

	return [objectRootMatrix, omegaMatrix, partMatrix, scaleMatrix].reduce(
		(matrix, next) => multiplyMat4(matrix, next),
		baseMatrix,
	);
}

function selectSourceAsset(
	sourceAssets: readonly StaticObjectSourceAssetFacts[],
): StaticObjectSourceAssetFacts | null {
	return sourceAssets[0] ?? null;
}

function clearDynamicBounds(record: DynamicEntityRecord): DynamicEntityRecord {
	return {
		...record,
		bounds: {
			currentBounds: null,
			indexMembership: { kind: "none" },
			indexed: false,
			precision: "none",
		},
		effectiveResidence: record.sourceResidence,
	};
}

function unionBounds(bounds: readonly StaticBounds[]): StaticBounds {
	const first = bounds[0];
	if (!first) {
		throw new Error("Cannot create dynamic bounds union without bounds.");
	}

	return bounds.slice(1).reduce(
		(accumulator, next) => ({
			max: {
				x: Math.max(accumulator.max.x, next.max.x),
				y: Math.max(accumulator.max.y, next.max.y),
				z: Math.max(accumulator.max.z, next.max.z),
			},
			min: {
				x: Math.min(accumulator.min.x, next.min.x),
				y: Math.min(accumulator.min.y, next.min.y),
				z: Math.min(accumulator.min.z, next.min.z),
			},
		}),
		first,
	);
}

function resolvePrimaryEffectiveLandblockId(options: {
	readonly effectiveOutdoorLandblockIds: readonly number[];
	readonly sourceLandblockId: number;
}): number {
	return options.effectiveOutdoorLandblockIds.includes(
		options.sourceLandblockId,
	)
		? options.sourceLandblockId
		: (options.effectiveOutdoorLandblockIds[0] ?? options.sourceLandblockId);
}

function sameBoundsAndResidence(
	left: DynamicEntityRecord,
	right: DynamicEntityRecord,
): boolean {
	return (
		JSON.stringify(left.bounds) === JSON.stringify(right.bounds) &&
		JSON.stringify(left.effectiveResidence) ===
			JSON.stringify(right.effectiveResidence)
	);
}
