import type {
	EnvCellPortalScenePickHit,
	EnvCellStaticScenePickHit,
	OutdoorStaticObjectScenePickHit,
	StaticScenePickFilters,
	StaticScenePickHit,
	StaticScenePickRequest,
	StaticSceneRay,
	TerrainQuadScenePickHit,
	Vec3,
} from "./contracts";
import type { EnvCellCommittedRecordStore } from "./env-cell-committed-records";
import {
	createAcceptedEnvCellSet,
	isAcceptedEnvCellId,
} from "./env-cell-residency";
import {
	containsPoint,
	intersectRayBounds,
	negateTranslation,
	normalizeRay,
	pointOnRay,
	translateBounds,
	translateRay,
	traverseBvhNearest,
} from "./geometry";
import { queryEnvCellPortalPickTargets } from "./env-cell-portal-picking";
import type { LandblockGridSpatialIndex } from "./landblock-grid-spatial-index";
import type {
	EnvCellBvhRoot,
	EnvCellLandblockBvhRoot,
	OutdoorStaticBvhRoot,
	TerrainBvhRoot,
} from "./static-query-state";
import {
	compareStaticSceneSelectionKeys,
	createEnvCellStaticObjectSelectionKey,
	createOutdoorStaticObjectSelectionKey,
	createTerrainQuadSelectionKey,
} from "./static-selection-keys";

export interface StaticScenePickingDependencies {
	/** Committed env-cell roots and static object bounds used for env-cell static picking. */
	readonly envCellCommittedRecords: EnvCellCommittedRecordStore;
	/** Outdoor grid index used to trace terrain, outdoor static, and env-cell candidates. */
	readonly landblockGridIndex: LandblockGridSpatialIndex;
	/** Current render anchor used to translate portal aperture points into render space. */
	readonly outdoorAnchorLandblockId: number | null;
}

export function pickStaticSceneRay(
	dependencies: StaticScenePickingDependencies,
	request: StaticScenePickRequest,
): StaticScenePickHit | null {
	const ray = normalizeRay(request.ray);
	const hits =
		request.context.kind === "outdoor"
			? pickOutdoorScene(dependencies, ray, request)
			: pickEnvCell(dependencies, ray, request);
	if (request.filters?.includeEnvCellPortals) {
		hits.push(...pickEnvCellPortals(dependencies, ray, request));
	}

	return hits.sort(comparePickHits)[0] ?? null;
}

function pickOutdoorScene(
	dependencies: StaticScenePickingDependencies,
	ray: StaticSceneRay,
	request: StaticScenePickRequest,
): StaticScenePickHit[] {
	let nearestHit: StaticScenePickHit | null = null;

	for (const candidate of dependencies.landblockGridIndex.traceOutdoorRay(ray, {
		getMaxDistance: () => nearestHit?.distance ?? null,
	})) {
		if (candidate.terrainRoot) {
			nearestHit = selectNearestHit(
				nearestHit,
				pickTerrainRoot(ray, request, candidate.terrainRoot, nearestHit),
			);
		}

		for (const root of candidate.outdoorRoots) {
			nearestHit = selectNearestHit(
				nearestHit,
				pickOutdoorRoot(ray, request, root, nearestHit),
			);
		}

		if (candidate.envCellRoot) {
			const envCellHit = pickEnvCellLandblockRoot(
				dependencies,
				ray,
				request,
				candidate.envCellRoot,
				createAcceptedEnvCellSet(candidate.envCellRoot.acceptedEnvCellIds),
				nearestHit,
			);
			nearestHit = selectNearestHit(nearestHit, envCellHit);
		}
	}

	return nearestHit ? [nearestHit] : [];
}

function pickOutdoorRoot(
	ray: StaticSceneRay,
	request: StaticScenePickRequest,
	root: OutdoorStaticBvhRoot,
	currentNearestHit: StaticScenePickHit | null,
): OutdoorStaticObjectScenePickHit | null {
	let nearestHit: OutdoorStaticObjectScenePickHit | null =
		isOutdoorStaticObjectScenePickHit(currentNearestHit)
			? currentNearestHit
			: null;
	const localRay = translateRay(ray, negateTranslation(root.translation));
	traverseBvhNearest(root.nodes, localRay, {
		getMaxDistance: () =>
			currentNearestHit === null
				? (nearestHit?.distance ?? null)
				: Math.min(
						currentNearestHit.distance,
						nearestHit?.distance ?? Number.POSITIVE_INFINITY,
					),
		visitCandidate: (candidate) => {
			for (const itemIndex of candidate.itemIndices) {
				const item = root.items[itemIndex];
				if (!item?.object.instanceBounds) {
					continue;
				}

				const distance = intersectRayBounds(
					localRay,
					item.object.instanceBounds,
				);
				if (distance === null) {
					continue;
				}

				const hit: OutdoorStaticObjectScenePickHit = {
					bounds: translateBounds(item.object.instanceBounds, root.translation),
					distance,
					hitPoint: pointOnRay(ray, distance),
					kind: "static-scene-pick-hit",
					selectionKey: createOutdoorStaticObjectSelectionKey({
						domain: root.domain,
						instanceId: item.object.identity.instanceId,
						landblockId: root.landblockId,
					}),
				};
				if (matchesFilters(hit, request.filters, ray.origin)) {
					nearestHit =
						nearestHit === null || comparePickHits(hit, nearestHit) < 0
							? hit
							: nearestHit;
				}
			}
		},
	});

	return nearestHit === currentNearestHit ? null : nearestHit;
}

function pickTerrainRoot(
	ray: StaticSceneRay,
	request: StaticScenePickRequest,
	root: TerrainBvhRoot,
	currentNearestHit: StaticScenePickHit | null,
): TerrainQuadScenePickHit | null {
	let nearestHit: TerrainQuadScenePickHit | null = isTerrainQuadScenePickHit(
		currentNearestHit,
	)
		? currentNearestHit
		: null;
	const localRay = translateRay(ray, negateTranslation(root.translation));
	traverseBvhNearest(root.nodes, localRay, {
		getMaxDistance: () =>
			currentNearestHit === null
				? (nearestHit?.distance ?? null)
				: Math.min(
						currentNearestHit.distance,
						nearestHit?.distance ?? Number.POSITIVE_INFINITY,
					),
		visitCandidate: (candidate) => {
			for (const itemIndex of candidate.itemIndices) {
				const item = root.items[itemIndex];
				if (!item) {
					continue;
				}

				const distance = intersectRayBounds(localRay, item.quad.bounds);
				if (distance === null) {
					continue;
				}

				const hit: TerrainQuadScenePickHit = {
					bounds: translateBounds(item.quad.bounds, root.translation),
					distance,
					hitPoint: pointOnRay(ray, distance),
					kind: "static-scene-pick-hit",
					selectionKey: createTerrainQuadSelectionKey({
						landblockId: root.landblockId,
						quadIndex: item.quad.quadIndex,
					}),
				};
				if (matchesFilters(hit, request.filters, ray.origin)) {
					nearestHit =
						nearestHit === null || comparePickHits(hit, nearestHit) < 0
							? hit
							: nearestHit;
				}
			}
		},
	});

	return nearestHit === currentNearestHit ? null : nearestHit;
}

function pickEnvCell(
	dependencies: StaticScenePickingDependencies,
	ray: StaticSceneRay,
	request: StaticScenePickRequest,
): EnvCellStaticScenePickHit[] {
	if (request.context.kind !== "env-cell") {
		return [];
	}

	const landblockRoot = dependencies.envCellCommittedRecords.envCellRoot(
		request.context.landblockId,
	);
	if (!landblockRoot) {
		return [];
	}
	const acceptedEnvCellIds = new Set(
		request.context.acceptedEnvCellIds ?? [request.context.envCellId],
	);
	const nearestHit = pickEnvCellLandblockRoot(
		dependencies,
		ray,
		request,
		landblockRoot,
		acceptedEnvCellIds,
		null,
	);

	return nearestHit ? [nearestHit] : [];
}

function pickEnvCellLandblockRoot(
	dependencies: StaticScenePickingDependencies,
	ray: StaticSceneRay,
	request: StaticScenePickRequest,
	landblockRoot: EnvCellLandblockBvhRoot,
	acceptedEnvCellIds: ReadonlySet<number>,
	currentNearestHit: StaticScenePickHit | null,
): EnvCellStaticScenePickHit | null {
	let nearestHit: EnvCellStaticScenePickHit | null =
		isEnvCellStaticScenePickHit(currentNearestHit) ? currentNearestHit : null;
	const localRay = translateRay(
		ray,
		negateTranslation(landblockRoot.translation),
	);

	traverseBvhNearest(landblockRoot.nodes, localRay, {
		getMaxDistance: () => nearestHit?.distance ?? null,
		visitCandidate: (broadCandidate) => {
			for (const landblockItemIndex of broadCandidate.itemIndices) {
				const landblockItem = landblockRoot.items[landblockItemIndex];
				if (!landblockItem) {
					continue;
				}
				if (!isAcceptedEnvCellId(acceptedEnvCellIds, landblockItem.envCellId)) {
					continue;
				}
				const root = landblockRoot.cellsByEnvCellId.get(
					landblockItem.envCellId,
				);
				if (!root) {
					continue;
				}
				const hit = pickEnvCellStaticObjects(
					dependencies,
					ray,
					localRay,
					landblockRoot.translation,
					request,
					root,
					nearestHit,
				);
				nearestHit =
					hit !== null &&
					(nearestHit === null || comparePickHits(hit, nearestHit) < 0)
						? hit
						: nearestHit;
			}
		},
	});

	return nearestHit === currentNearestHit ? null : nearestHit;
}

function pickEnvCellStaticObjects(
	dependencies: StaticScenePickingDependencies,
	renderRay: StaticSceneRay,
	localRay: StaticSceneRay,
	landblockTranslation: readonly [number, number, number],
	request: StaticScenePickRequest,
	root: EnvCellBvhRoot,
	currentNearestHit: EnvCellStaticScenePickHit | null,
): EnvCellStaticScenePickHit | null {
	let nearestHit = currentNearestHit;
	for (const item of root.items) {
		const bounds =
			dependencies.envCellCommittedRecords.getEnvCellStaticPlacementBounds(
				root,
				item.placement,
			);
		if (!bounds) {
			continue;
		}
		const distance = intersectRayBounds(localRay, bounds);
		if (distance === null) {
			continue;
		}
		const renderBounds = translateBounds(bounds, landblockTranslation);
		const hit: EnvCellStaticScenePickHit = {
			bounds: renderBounds,
			distance,
			hitPoint: pointOnRay(renderRay, distance),
			kind: "static-scene-pick-hit",
			selectionKey: createEnvCellStaticObjectSelectionKey({
				envCellId: item.placement.envCellId,
				instanceId: item.placement.placement.identity.instanceId,
				landblockId: root.landblockId,
			}),
		};
		if (matchesFilters(hit, request.filters, renderRay.origin)) {
			nearestHit =
				nearestHit === null || comparePickHits(hit, nearestHit) < 0
					? hit
					: nearestHit;
		}
	}

	return nearestHit === currentNearestHit ? null : nearestHit;
}

function selectNearestHit(
	left: StaticScenePickHit | null,
	right: StaticScenePickHit | null,
): StaticScenePickHit | null {
	if (!right) {
		return left;
	}
	if (!left) {
		return right;
	}

	return comparePickHits(right, left) < 0 ? right : left;
}

function pickEnvCellPortals(
	dependencies: StaticScenePickingDependencies,
	ray: StaticSceneRay,
	request: StaticScenePickRequest,
): EnvCellPortalScenePickHit[] {
	const hits: EnvCellPortalScenePickHit[] = [];
	for (const target of queryEnvCellPortalPickTargets({
		envCellCommittedRecords: dependencies.envCellCommittedRecords,
		outdoorAnchorLandblockId: dependencies.outdoorAnchorLandblockId,
		request,
	})) {
		if (!matchesFiltersForKey(target.selectionKey, request.filters)) {
			continue;
		}
		if (
			request.filters?.ignoreContainingOrigin &&
			containsPoint(target.bounds, ray.origin)
		) {
			continue;
		}
		for (let index = 0; index < target.vertices.length; index += 3) {
			const first = target.vertices[index];
			const second = target.vertices[index + 1];
			const third = target.vertices[index + 2];
			if (!first || !second || !third) {
				throw new Error(
					`Env-cell portal ${target.selectionKey.portalId} did not triangulate to complete triangles.`,
				);
			}
			const distance = intersectRayTriangle(ray, first, second, third);
			if (distance === null) {
				continue;
			}
			hits.push({
				bounds: target.bounds,
				distance,
				hitPoint: pointOnRay(ray, distance),
				kind: "static-scene-pick-hit",
				selectionKey: target.selectionKey,
			});
		}
	}
	return hits;
}

function isOutdoorStaticObjectScenePickHit(
	hit: StaticScenePickHit | null,
): hit is OutdoorStaticObjectScenePickHit {
	return hit?.selectionKey.itemKind === "outdoor-static-object";
}

function isTerrainQuadScenePickHit(
	hit: StaticScenePickHit | null,
): hit is TerrainQuadScenePickHit {
	return hit?.selectionKey.itemKind === "terrain-quad";
}

function isEnvCellStaticScenePickHit(
	hit: StaticScenePickHit | null,
): hit is EnvCellStaticScenePickHit {
	return hit?.selectionKey.itemKind === "env-cell-static-object";
}

function matchesFilters(
	hit: StaticScenePickHit,
	filters: StaticScenePickFilters | undefined,
	rayOrigin: Vec3,
): boolean {
	return (
		matchesFiltersForKey(hit.selectionKey, filters) &&
		(!filters?.ignoreContainingOrigin || !containsPoint(hit.bounds, rayOrigin))
	);
}

function matchesFiltersForKey(
	selectionKey: StaticScenePickHit["selectionKey"],
	filters: StaticScenePickFilters | undefined,
): boolean {
	return (
		(!filters?.itemKinds ||
			filters.itemKinds.includes(selectionKey.itemKind)) &&
		(!filters?.domains || filters.domains.includes(selectionKey.domain))
	);
}

function comparePickHits(
	left: StaticScenePickHit,
	right: StaticScenePickHit,
): number {
	return (
		left.distance - right.distance ||
		left.selectionKey.itemKind.localeCompare(right.selectionKey.itemKind) ||
		compareStaticSceneSelectionKeys(left.selectionKey, right.selectionKey)
	);
}

function intersectRayTriangle(
	ray: StaticSceneRay,
	first: readonly [number, number, number],
	second: readonly [number, number, number],
	third: readonly [number, number, number],
): number | null {
	const epsilon = 1e-6;
	const edge1 = subtractTuple(second, first);
	const edge2 = subtractTuple(third, first);
	const pvec = cross(ray.direction, edge2);
	const determinant = dot(edge1, pvec);
	if (Math.abs(determinant) < epsilon) {
		return null;
	}

	const inverseDeterminant = 1 / determinant;
	const tvec = subtractVec3Tuple(ray.origin, first);
	const u = dot(tvec, pvec) * inverseDeterminant;
	if (u < -epsilon || u > 1 + epsilon) {
		return null;
	}

	const qvec = cross(tvec, edge1);
	const v = dot(ray.direction, qvec) * inverseDeterminant;
	if (v < -epsilon || u + v > 1 + epsilon) {
		return null;
	}

	const distance = dot(edge2, qvec) * inverseDeterminant;
	return distance >= epsilon ? distance : null;
}

function subtractTuple(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): Vec3 {
	return {
		x: left[0] - right[0],
		y: left[1] - right[1],
		z: left[2] - right[2],
	};
}

function subtractVec3Tuple(
	left: Vec3,
	right: readonly [number, number, number],
): Vec3 {
	return {
		x: left.x - right[0],
		y: left.y - right[1],
		z: left.z - right[2],
	};
}

function cross(left: Vec3, right: Vec3): Vec3 {
	return {
		x: left.y * right.z - left.z * right.y,
		y: left.z * right.x - left.x * right.z,
		z: left.x * right.y - left.y * right.x,
	};
}

function dot(left: Vec3, right: Vec3): number {
	return left.x * right.x + left.y * right.y + left.z * right.z;
}
