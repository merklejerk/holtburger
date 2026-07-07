import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../../../lib/landblocks";
import {
	createRenderCellKey,
	createRenderCellKeysForBounds,
	gridCellAt,
	LAND_BLOCK_GRID_EPSILON,
	parseRenderCellKey,
	projectLandblockIdToRenderCell,
} from "../outdoor-landblock-grid";
import type { StaticBounds } from "../../static/contracts";
import type { StaticSceneRay } from "./contracts";
import { intersectRayBounds, pointOnRay, translateBounds } from "./geometry";
import type {
	LandblockSpatialBucket,
	LandblockSpatialCandidate,
	EnvCellLandblockBvhRoot,
	OutdoorStaticBvhRoot,
	TerrainBvhRoot,
} from "./static-query-state";

export interface LandblockGridRayBounds {
	readonly maxCellX: number;
	readonly maxCellZ: number;
	readonly minCellX: number;
	readonly minCellZ: number;
}

export interface LandblockGridRayCell {
	readonly cellX: number;
	readonly cellZ: number;
	readonly distance: number;
}

export interface LandblockGridRayTraceOptions {
	readonly cellSize?: number;
	readonly getMaxDistance?: () => number | null;
}

/** Outdoor render-cell index that maps retained static roots to ray traversal candidates. */
export class LandblockGridSpatialIndex {
	#outdoorAnchorLandblockId: number | null = null;
	readonly #bucketsByLandblockId = new Map<number, LandblockSpatialBucket>();
	readonly #bucketsByRenderCell = new Map<string, LandblockSpatialBucket[]>();

	get bucketCount(): number {
		return this.#bucketsByLandblockId.size;
	}

	setOutdoorAnchorLandblockId(outdoorAnchorLandblockId: number | null): void {
		if (this.#outdoorAnchorLandblockId === outdoorAnchorLandblockId) {
			return;
		}

		this.#outdoorAnchorLandblockId = outdoorAnchorLandblockId;
		this.#rebuildRenderCellIndex();
	}

	upsertTerrainRoot(root: TerrainBvhRoot): void {
		const bucket = this.#getOrCreateBucket(root.landblockId);
		this.#setBucket(root.landblockId, {
			...bucket,
			terrainRoot: root,
		});
	}

	deleteTerrainRoot(landblockId: number): void {
		const bucket = this.#bucketsByLandblockId.get(landblockId);
		if (!bucket) {
			return;
		}

		this.#setOrDeleteBucket({
			...bucket,
			terrainRoot: null,
		});
	}

	upsertOutdoorRoot(root: OutdoorStaticBvhRoot): void {
		const bucket = this.#getOrCreateBucket(root.landblockId);
		const outdoorRootsByDomain = new Map(bucket.outdoorRootsByDomain);
		outdoorRootsByDomain.set(root.domain, root);
		this.#setBucket(root.landblockId, {
			...bucket,
			outdoorRootsByDomain,
		});
	}

	deleteOutdoorRoot(
		domain: OutdoorStaticBvhRoot["domain"],
		landblockId: number,
	): void {
		const bucket = this.#bucketsByLandblockId.get(landblockId);
		if (!bucket) {
			return;
		}

		const outdoorRootsByDomain = new Map(bucket.outdoorRootsByDomain);
		outdoorRootsByDomain.delete(domain);
		this.#setOrDeleteBucket({
			...bucket,
			outdoorRootsByDomain,
		});
	}

	upsertEnvCellRoot(root: EnvCellLandblockBvhRoot): void {
		const bucket = this.#getOrCreateBucket(root.landblockId);
		this.#setBucket(root.landblockId, {
			...bucket,
			envCellRoot: root,
		});
	}

	*traceOutdoorRay(
		ray: StaticSceneRay,
		options: {
			readonly getMaxDistance: () => number | null;
		},
	): Iterable<LandblockSpatialCandidate> {
		if (this.#outdoorAnchorLandblockId === null) {
			for (const bucket of [...this.#bucketsByLandblockId.values()].sort(
				compareLandblockSpatialBuckets,
			)) {
				const candidate = createLandblockSpatialCandidate(bucket, 0);
				if (candidate) {
					yield candidate;
				}
			}
			return;
		}

		const bounds = this.#createRenderCellBounds();
		if (!bounds) {
			return;
		}

		const visitedLandblockIds = new Set<number>();
		for (const cell of traceLandblockGridRayCells(ray, bounds, {
			cellSize: OUTDOOR_LANDBLOCK_WORLD_SIZE,
			getMaxDistance: options.getMaxDistance,
		})) {
			const buckets = this.#bucketsByRenderCell.get(
				createRenderCellKey(cell.cellX, cell.cellZ),
			);
			if (!buckets) {
				continue;
			}
			for (const bucket of buckets) {
				if (visitedLandblockIds.has(bucket.landblockId)) {
					continue;
				}
				visitedLandblockIds.add(bucket.landblockId);
				const candidateDistance = estimateLandblockSpatialCandidateDistance(
					ray,
					bucket,
				);
				const maxDistance = options.getMaxDistance();
				if (
					candidateDistance === null ||
					(maxDistance !== null && candidateDistance > maxDistance)
				) {
					continue;
				}
				const candidate = createLandblockSpatialCandidate(
					bucket,
					candidateDistance,
				);
				if (candidate) {
					yield candidate;
				}
			}
		}
	}

	clear(): void {
		this.#outdoorAnchorLandblockId = null;
		this.#bucketsByLandblockId.clear();
		this.#bucketsByRenderCell.clear();
	}

	#createRenderCellBounds(): LandblockGridRayBounds | null {
		if (this.#bucketsByRenderCell.size === 0) {
			return null;
		}

		let minCellX = Number.POSITIVE_INFINITY;
		let minCellZ = Number.POSITIVE_INFINITY;
		let maxCellX = Number.NEGATIVE_INFINITY;
		let maxCellZ = Number.NEGATIVE_INFINITY;

		for (const key of this.#bucketsByRenderCell.keys()) {
			const cell = parseRenderCellKey(key);
			minCellX = Math.min(minCellX, cell.cellX);
			minCellZ = Math.min(minCellZ, cell.cellZ);
			maxCellX = Math.max(maxCellX, cell.cellX);
			maxCellZ = Math.max(maxCellZ, cell.cellZ);
		}

		return { maxCellX, maxCellZ, minCellX, minCellZ };
	}

	#getOrCreateBucket(landblockId: number): LandblockSpatialBucket {
		return (
			this.#bucketsByLandblockId.get(landblockId) ?? {
				envCellRoot: null,
				landblockId,
				outdoorRootsByDomain: new Map(),
				terrainRoot: null,
			}
		);
	}

	#setOrDeleteBucket(bucket: LandblockSpatialBucket): void {
		if (
			bucket.envCellRoot === null &&
			bucket.outdoorRootsByDomain.size === 0 &&
			bucket.terrainRoot === null
		) {
			this.#bucketsByLandblockId.delete(bucket.landblockId);
			this.#rebuildRenderCellIndex();
			return;
		}

		this.#setBucket(bucket.landblockId, bucket);
	}

	#setBucket(landblockId: number, bucket: LandblockSpatialBucket): void {
		this.#bucketsByLandblockId.set(landblockId, bucket);
		this.#rebuildRenderCellIndex();
	}

	#rebuildRenderCellIndex(): void {
		this.#bucketsByRenderCell.clear();
		if (this.#outdoorAnchorLandblockId === null) {
			return;
		}

		for (const bucket of this.#bucketsByLandblockId.values()) {
			for (const cellKey of createBucketRenderCellKeys(
				bucket,
				this.#outdoorAnchorLandblockId,
			)) {
				const buckets = this.#bucketsByRenderCell.get(cellKey) ?? [];
				buckets.push(bucket);
				this.#bucketsByRenderCell.set(cellKey, buckets);
			}
		}
	}
}

function createLandblockSpatialCandidate(
	bucket: LandblockSpatialBucket,
	distance: number,
): LandblockSpatialCandidate | null {
	const outdoorRoots = [...bucket.outdoorRootsByDomain.values()].sort(
		(left, right) => left.domain.localeCompare(right.domain),
	);
	if (
		bucket.envCellRoot === null &&
		outdoorRoots.length === 0 &&
		bucket.terrainRoot === null
	) {
		return null;
	}
	return {
		distance,
		envCellRoot: bucket.envCellRoot,
		landblockId: bucket.landblockId,
		outdoorRoots,
		terrainRoot: bucket.terrainRoot,
	};
}

function compareLandblockSpatialBuckets(
	left: LandblockSpatialBucket,
	right: LandblockSpatialBucket,
): number {
	return left.landblockId - right.landblockId;
}

function createBucketRenderCellKeys(
	bucket: LandblockSpatialBucket,
	outdoorAnchorLandblockId: number,
): readonly string[] {
	const cellKeys = new Set<string>();
	const baseCell = projectLandblockIdToRenderCell(
		bucket.landblockId,
		outdoorAnchorLandblockId,
	);
	cellKeys.add(createRenderCellKey(baseCell.cellX, baseCell.cellZ));

	for (const bounds of getBucketOutdoorRenderBounds(bucket)) {
		for (const cellKey of createRenderCellKeysForBounds(bounds)) {
			cellKeys.add(cellKey);
		}
	}

	return [...cellKeys].sort();
}

function getBucketOutdoorRenderBounds(
	bucket: LandblockSpatialBucket,
): readonly StaticBounds[] {
	const bounds: StaticBounds[] = [];
	for (const root of bucket.outdoorRootsByDomain.values()) {
		const rootBounds = root.nodes[0]?.bounds;
		if (rootBounds) {
			bounds.push(translateBounds(rootBounds, root.translation));
		}
	}
	const terrainBounds = bucket.terrainRoot?.nodes[0]?.bounds;
	if (terrainBounds && bucket.terrainRoot) {
		bounds.push(translateBounds(terrainBounds, bucket.terrainRoot.translation));
	}
	const envCellBounds = bucket.envCellRoot?.nodes[0]?.bounds;
	if (envCellBounds && bucket.envCellRoot) {
		bounds.push(translateBounds(envCellBounds, bucket.envCellRoot.translation));
	}
	return bounds;
}

function estimateLandblockSpatialCandidateDistance(
	ray: StaticSceneRay,
	bucket: LandblockSpatialBucket,
): number | null {
	let distance: number | null = null;
	for (const bounds of getBucketOutdoorRenderBounds(bucket)) {
		const boundsDistance = intersectRayBounds(ray, bounds);
		if (boundsDistance === null) {
			continue;
		}
		distance =
			distance === null ? boundsDistance : Math.min(distance, boundsDistance);
	}
	return distance;
}

export function* traceLandblockGridRayCells(
	ray: StaticSceneRay,
	bounds: LandblockGridRayBounds,
	options: LandblockGridRayTraceOptions = {},
): Iterable<LandblockGridRayCell> {
	const cellSize = options.cellSize ?? OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const startDistance = intersectRayGridBounds(ray, bounds, cellSize);
	if (startDistance === null) {
		return;
	}

	const startPoint = pointOnRay(ray, startDistance);
	let cellX = gridCellAt(startPoint.x, ray.direction.x, cellSize);
	let cellZ = gridCellAt(startPoint.z, ray.direction.z, cellSize);
	const stepX = Math.sign(ray.direction.x);
	const stepZ = Math.sign(ray.direction.z);

	let nextDistanceX = nextGridBoundaryDistance(
		startPoint.x,
		ray.direction.x,
		cellX,
		stepX,
		cellSize,
	);
	let nextDistanceZ = nextGridBoundaryDistance(
		startPoint.z,
		ray.direction.z,
		cellZ,
		stepZ,
		cellSize,
	);
	const deltaDistanceX =
		stepX === 0
			? Number.POSITIVE_INFINITY
			: cellSize / Math.abs(ray.direction.x);
	const deltaDistanceZ =
		stepZ === 0
			? Number.POSITIVE_INFINITY
			: cellSize / Math.abs(ray.direction.z);

	let currentDistance = startDistance;
	while (containsGridCell(bounds, cellX, cellZ)) {
		const maxDistance = options.getMaxDistance?.();
		if (maxDistance !== undefined && maxDistance !== null) {
			const nextCellDistance = normalizeDistanceZero(currentDistance);
			if (nextCellDistance > maxDistance) {
				return;
			}
		}

		yield {
			cellX,
			cellZ,
			distance: normalizeDistanceZero(currentDistance),
		};

		const nextDistance = Math.min(nextDistanceX, nextDistanceZ);
		if (!Number.isFinite(nextDistance)) {
			return;
		}

		const advanceX = nextDistanceX <= nextDistance + LAND_BLOCK_GRID_EPSILON;
		const advanceZ = nextDistanceZ <= nextDistance + LAND_BLOCK_GRID_EPSILON;
		currentDistance = nextDistance;
		if (advanceX) {
			cellX += stepX;
			nextDistanceX += deltaDistanceX;
		}
		if (advanceZ) {
			cellZ += stepZ;
			nextDistanceZ += deltaDistanceZ;
		}
	}
}

function intersectRayGridBounds(
	ray: StaticSceneRay,
	bounds: LandblockGridRayBounds,
	cellSize: number,
): number | null {
	let tMin = Number.NEGATIVE_INFINITY;
	let tMax = Number.POSITIVE_INFINITY;
	const minX = bounds.minCellX * cellSize;
	const maxX = (bounds.maxCellX + 1) * cellSize;
	const minZ = bounds.minCellZ * cellSize;
	const maxZ = (bounds.maxCellZ + 1) * cellSize;

	for (const slab of [
		{ direction: ray.direction.x, max: maxX, min: minX, origin: ray.origin.x },
		{ direction: ray.direction.z, max: maxZ, min: minZ, origin: ray.origin.z },
	]) {
		if (Math.abs(slab.direction) < LAND_BLOCK_GRID_EPSILON) {
			if (slab.origin < slab.min || slab.origin > slab.max) {
				return null;
			}
			continue;
		}

		const inverse = 1 / slab.direction;
		const t1 = (slab.min - slab.origin) * inverse;
		const t2 = (slab.max - slab.origin) * inverse;
		tMin = Math.max(tMin, Math.min(t1, t2));
		tMax = Math.min(tMax, Math.max(t1, t2));
		if (tMin > tMax) {
			return null;
		}
	}

	if (tMax < 0) {
		return null;
	}

	return Math.max(tMin, 0);
}

function nextGridBoundaryDistance(
	origin: number,
	direction: number,
	cell: number,
	step: number,
	cellSize: number,
): number {
	if (step === 0) {
		return Number.POSITIVE_INFINITY;
	}

	const boundary = (step > 0 ? cell + 1 : cell) * cellSize;
	return (boundary - origin) / direction;
}

function containsGridCell(
	bounds: LandblockGridRayBounds,
	cellX: number,
	cellZ: number,
): boolean {
	return (
		cellX >= bounds.minCellX &&
		cellX <= bounds.maxCellX &&
		cellZ >= bounds.minCellZ &&
		cellZ <= bounds.maxCellZ
	);
}

function normalizeDistanceZero(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}
