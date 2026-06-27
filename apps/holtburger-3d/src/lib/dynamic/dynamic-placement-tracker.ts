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

export interface DynamicPlacementUpdate {
	readonly changed: boolean;
	readonly record: DynamicEntityRecord;
}

export interface DynamicPlacementTrackerOptions {
	readonly outdoorIndex?: OutdoorDynamicSpatialIndex;
}

/** Synchronizes dynamic current-frame bounds and outdoor spatial index membership. */
export class DynamicPlacementTracker {
	readonly #outdoorIndex: OutdoorDynamicSpatialIndex;

	constructor(options: DynamicPlacementTrackerOptions = {}) {
		this.#outdoorIndex =
			options.outdoorIndex ?? new OutdoorDynamicSpatialIndex();
	}

	update(record: DynamicEntityRecord): DynamicPlacementUpdate {
		const next = derivePlacedRecord(record, this.#outdoorIndex);
		return { changed: !sameBoundsAndResidence(record, next), record: next };
	}

	release(entityId: string): void {
		this.#outdoorIndex.remove(entityId);
	}

	releaseAll(): void {
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
}

function derivePlacedRecord(
	record: DynamicEntityRecord,
	outdoorIndex: OutdoorDynamicSpatialIndex,
): DynamicEntityRecord {
	if (
		record.sourceResidence.kind !== "outdoor-landblock" ||
		record.animation.playback.status !== "playing" ||
		record.resources.visual.status !== "ready"
	) {
		outdoorIndex.remove(record.id);
		return clearDynamicBounds(record);
	}

	const currentBounds = deriveCurrentBounds({
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
			indexed: indexedLandblockIds.length > 0,
			indexedLandblockIds,
			precision: currentBounds.precision,
		},
		effectiveResidence: {
			kind: "outdoor-landblock",
			landblockId: effectiveLandblockId,
		},
	};
}

function deriveCurrentBounds(options: {
	readonly record: DynamicEntityRecord;
	readonly sourceAssets: readonly StaticObjectSourceAssetFacts[];
	readonly sourceLandblockId: number;
}): DynamicEntityCurrentBounds | null {
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
			indexed: false,
			indexedLandblockIds: [],
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
