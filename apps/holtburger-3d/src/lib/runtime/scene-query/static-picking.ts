import type {
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

				const distance = intersectRayBounds(localRay, item.object.instanceBounds);
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
	const localRay = translateRay(ray, negateTranslation(landblockRoot.translation));

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
			dependencies.envCellCommittedRecords.getEnvCellStaticSeedBounds(
				root,
				item.seed,
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
				envCellId: item.seed.envCellId,
				instanceId: item.seed.seed.identity.instanceId,
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
		(!filters?.itemKinds ||
			filters.itemKinds.includes(hit.selectionKey.itemKind)) &&
		(!filters?.domains || filters.domains.includes(hit.selectionKey.domain)) &&
		(!filters?.ignoreContainingOrigin || !containsPoint(hit.bounds, rayOrigin))
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
