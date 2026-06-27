import RBush from "rbush";
import type { StaticBounds } from "../static/contracts";
import { createOutdoorLandblockRootTranslation } from "../static/placement";
import type {
	DynamicEntityBoundsPrecision,
	DynamicEntityId,
} from "./contracts";

interface OutdoorDynamicSpatialTreeItem {
	readonly bounds: StaticBounds;
	readonly entityId: DynamicEntityId;
	readonly landblockId: number;
	readonly maxX: number;
	readonly maxY: number;
	readonly minX: number;
	readonly minY: number;
	readonly precision: DynamicEntityBoundsPrecision;
	readonly sourceBounds: StaticBounds;
	readonly sourceLandblockId: number;
}

export interface OutdoorDynamicSpatialIndexRecord {
	readonly bounds: StaticBounds;
	readonly entityId: DynamicEntityId;
	readonly landblockId: number;
	readonly precision: DynamicEntityBoundsPrecision;
	readonly sourceBounds: StaticBounds;
	readonly sourceLandblockId: number;
}

export interface OutdoorDynamicSpatialIndexUpsert {
	readonly bounds: StaticBounds;
	readonly entityId: DynamicEntityId;
	readonly landblockIds: readonly number[];
	readonly precision: DynamicEntityBoundsPrecision;
	readonly sourceLandblockId: number;
}

/** Per-landblock mutable AABB broadphase for outdoor dynamic entity bounds. */
export class OutdoorDynamicSpatialIndex {
	readonly #itemsByEntityId = new Map<
		DynamicEntityId,
		readonly OutdoorDynamicSpatialTreeItem[]
	>();
	readonly #treesByLandblockId = new Map<
		number,
		RBush<OutdoorDynamicSpatialTreeItem>
	>();

	upsert(update: OutdoorDynamicSpatialIndexUpsert): readonly number[] {
		this.remove(update.entityId);
		const items = uniqueSortedNumbers(update.landblockIds).map((landblockId) =>
			createTreeItem({
				bounds: translateSourceBoundsToLandblock({
					bounds: update.bounds,
					sourceLandblockId: update.sourceLandblockId,
					targetLandblockId: landblockId,
				}),
				entityId: update.entityId,
				landblockId,
				precision: update.precision,
				sourceBounds: update.bounds,
				sourceLandblockId: update.sourceLandblockId,
			}),
		);
		for (const item of items) {
			this.#getOrCreateTree(item.landblockId).insert(item);
		}
		this.#itemsByEntityId.set(update.entityId, items);
		return items.map((item) => item.landblockId);
	}

	remove(entityId: DynamicEntityId): void {
		const existingItems = this.#itemsByEntityId.get(entityId);
		if (!existingItems) {
			return;
		}
		for (const item of existingItems) {
			const tree = this.#treesByLandblockId.get(item.landblockId);
			tree?.remove(item);
			if (tree && tree.all().length === 0) {
				this.#treesByLandblockId.delete(item.landblockId);
			}
		}
		this.#itemsByEntityId.delete(entityId);
	}

	search(
		landblockId: number,
		bounds: Pick<StaticBounds, "min" | "max">,
	): readonly OutdoorDynamicSpatialIndexRecord[] {
		const tree = this.#treesByLandblockId.get(landblockId);
		if (!tree) {
			return [];
		}
		return tree.search(createSearchBox(bounds)).map(createIndexRecord);
	}

	records(): readonly OutdoorDynamicSpatialIndexRecord[] {
		return [...this.#treesByLandblockId.entries()]
			.sort(([left], [right]) => left - right)
			.flatMap(([, tree]) =>
				tree
					.all()
					.map(createIndexRecord)
					.sort((left, right) => left.entityId.localeCompare(right.entityId)),
			);
	}

	landblockIds(): readonly number[] {
		return [...this.#treesByLandblockId.keys()].sort((left, right) => left - right);
	}

	landblockIdsForEntity(entityId: DynamicEntityId): readonly number[] {
		return (
			this.#itemsByEntityId.get(entityId)?.map((item) => item.landblockId) ?? []
		);
	}

	#getOrCreateTree(landblockId: number): RBush<OutdoorDynamicSpatialTreeItem> {
		const existing = this.#treesByLandblockId.get(landblockId);
		if (existing) {
			return existing;
		}
		const tree = new RBush<OutdoorDynamicSpatialTreeItem>();
		this.#treesByLandblockId.set(landblockId, tree);
		return tree;
	}
}

function createTreeItem(
	record: OutdoorDynamicSpatialIndexRecord,
): OutdoorDynamicSpatialTreeItem {
	return {
		...record,
		maxX: record.bounds.max.x,
		maxY: record.bounds.max.z,
		minX: record.bounds.min.x,
		minY: record.bounds.min.z,
	};
}

function createSearchBox(bounds: Pick<StaticBounds, "min" | "max">): {
	readonly maxX: number;
	readonly maxY: number;
	readonly minX: number;
	readonly minY: number;
} {
	return {
		maxX: bounds.max.x,
		maxY: bounds.max.z,
		minX: bounds.min.x,
		minY: bounds.min.z,
	};
}

function createIndexRecord(
	item: OutdoorDynamicSpatialTreeItem,
): OutdoorDynamicSpatialIndexRecord {
	return {
		bounds: item.bounds,
		entityId: item.entityId,
		landblockId: item.landblockId,
		precision: item.precision,
		sourceBounds: item.sourceBounds,
		sourceLandblockId: item.sourceLandblockId,
	};
}

function translateSourceBoundsToLandblock(options: {
	readonly bounds: StaticBounds;
	readonly sourceLandblockId: number;
	readonly targetLandblockId: number;
}): StaticBounds {
	const translation = createOutdoorLandblockRootTranslation(
		options.targetLandblockId,
		options.sourceLandblockId,
	);
	return {
		max: {
			x: options.bounds.max.x - translation[0],
			y: options.bounds.max.y - translation[1],
			z: options.bounds.max.z - translation[2],
		},
		min: {
			x: options.bounds.min.x - translation[0],
			y: options.bounds.min.y - translation[1],
			z: options.bounds.min.z - translation[2],
		},
	};
}

function uniqueSortedNumbers(values: readonly number[]): readonly number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}
