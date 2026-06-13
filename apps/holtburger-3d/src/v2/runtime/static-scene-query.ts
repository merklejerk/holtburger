import type {
	LandblockEnvCellsStaticScopePayload,
	OutdoorStaticObjectsScopePayload,
	StaticBounds,
	StaticObjectInstanceFacts,
	StaticPlacementTransform,
	StaticScopePayload,
	StaticVec3,
} from "../static/contracts";
import { createOutdoorLandblockRootTranslation } from "./static-placement";

export interface StaticSceneRay {
	readonly origin: StaticSceneVec3;
	readonly direction: StaticSceneVec3;
}

export type StaticScenePickContext =
	| {
			readonly kind: "outdoor";
	  }
	| {
			readonly kind: "env-cell";
			readonly landblockId: number;
			readonly envCellId: number;
			readonly acceptedEnvCellIds?: readonly number[];
	  };

export interface StaticScenePickRequest {
	readonly context: StaticScenePickContext;
	readonly ray: StaticSceneRay;
	readonly filters?: StaticScenePickFilters;
}

interface StaticScenePickFilters {
	readonly itemKinds?: readonly StaticScenePickHit["itemKind"][];
	readonly domains?: readonly StaticScenePickHit["domain"][];
	readonly ignoreContainingOrigin?: boolean;
}

export type StaticScenePickHit =
	| OutdoorStaticObjectScenePickHit
	| EnvCellStaticScenePickHit;

export interface OutdoorStaticObjectScenePickHit {
	readonly kind: "static-scene-pick-hit";
	readonly itemKind: "outdoor-static-object";
	readonly context: Extract<StaticScenePickContext, { readonly kind: "outdoor" }>;
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly distance: number;
	readonly hitPoint: StaticSceneVec3;
	readonly bounds: StaticBounds;
	readonly landblockId: number;
	readonly instanceId: string;
	readonly objectKind: StaticObjectInstanceFacts["identity"]["objectKind"];
	readonly source: StaticObjectInstanceFacts["source"];
	readonly sourceIndex: number;
	readonly sourceAssetId: string;
	readonly bvhItemIndex: number;
	readonly bvhItemKind: "static" | "building";
	readonly queryPath: "source-bvh";
}

export interface EnvCellStaticScenePickHit {
	readonly kind: "static-scene-pick-hit";
	readonly itemKind: "env-cell-static-object";
	readonly context: Extract<StaticScenePickContext, { readonly kind: "env-cell" }>;
	readonly domain: "landblock-env-cells";
	readonly distance: number;
	readonly hitPoint: StaticSceneVec3;
	readonly bounds: StaticBounds;
	readonly landblockId: number;
	readonly envCellId: number;
	readonly instanceId: string;
	readonly objectKind: "explicit-object" | "building" | "generated-scenery";
	readonly source: {
		readonly sourceAssetKind: "gfx-obj" | "setup-model" | "setup-appearance";
		readonly sourceDid: number;
	};
	readonly sourceIndex: number;
	readonly debugSourceAssetId: string;
	readonly bvhItemIndex: number | null;
	readonly queryPath: "source-bvh";
}

export interface StaticSceneQuerySnapshot {
	readonly outdoorRecordCount: number;
	readonly envCellRecordCount: number;
	readonly envCellLandblockCount: number;
}

export interface StaticSceneQuerySourcePayloadOptions {
	readonly outdoorAnchorLandblockId?: number | null;
}

interface StaticSceneVec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

type BvhNode = NonNullable<
	OutdoorStaticObjectsScopePayload["sourceSpatial"]["outdoorBvh"]
>["nodes"][number];

interface OutdoorStaticBvhRoot {
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly landblockId: number;
	readonly translation: readonly [number, number, number];
	readonly nodes: readonly BvhNode[];
	readonly items: readonly (OutdoorStaticBvhRuntimeItem | null)[];
}

interface OutdoorStaticBvhRuntimeItem {
	readonly bvhItemIndex: number;
	readonly kind: "static" | "building";
	readonly object: StaticObjectInstanceFacts;
}

interface EnvCellBvhRoot {
	readonly acceptedEnvCellIds: readonly number[];
	readonly envCellId: number;
	readonly landblockId: number;
	readonly placement: StaticPlacementTransform;
	readonly nodes: readonly BvhNode[];
	readonly items: readonly (EnvCellBvhRuntimeItem | null)[];
}

interface EnvCellLandblockBvhRoot {
	readonly acceptedEnvCellIds: readonly number[];
	readonly cellsByEnvCellId: ReadonlyMap<number, EnvCellBvhRoot>;
	readonly items: readonly (EnvCellLandblockBvhRuntimeItem | null)[];
	readonly landblockId: number;
	readonly nodes: readonly BvhNode[];
}

interface EnvCellLandblockBvhRuntimeItem {
	readonly bounds: StaticBounds;
	readonly envCellId: number;
	readonly memberId: string;
	readonly source: "env-cell-root" | "derived";
}

type EnvCellBvhRuntimeItem =
	| {
			readonly kind: "static";
			readonly bvhItemIndex: number;
			readonly seed: EnvCellStaticSeedRuntimeRecord;
	  }
	| {
			readonly kind: "cell-structure-geometry" | "portal";
			readonly bvhItemIndex: number;
			readonly sourceItem: unknown;
	  };

interface EnvCellStaticSeedRuntimeRecord {
	readonly bounds: StaticBounds;
	readonly envCellId: number;
	readonly hit: Omit<EnvCellStaticScenePickHit, "distance" | "hitPoint">;
}

export class StaticSceneQuery {
	readonly #outdoorBvhRootsByDomainAndLandblock = new Map<
		string,
		OutdoorStaticBvhRoot
	>();
	readonly #envCellRootsByLandblockId = new Map<
		number,
		EnvCellLandblockBvhRoot
	>();

	ingestSourcePayload(
		payload: StaticScopePayload,
		options: StaticSceneQuerySourcePayloadOptions = {},
	): void {
		if (payload.scope.kind === "outdoor-static-objects") {
			this.ingestOutdoorStaticObjects(
				payload.scope,
				options.outdoorAnchorLandblockId ?? null,
			);
			return;
		}

		if (payload.scope.kind === "landblock-env-cells") {
			this.ingestLandblockEnvCells(payload.scope);
		}
	}

	ingestOutdoorStaticObjects(
		payload: OutdoorStaticObjectsScopePayload,
		outdoorAnchorLandblockId: number | null = null,
	): void {
		const rootKey = createOutdoorRootKey(
			payload.domain,
			payload.landblock.landblockId,
		);
		const bvh = payload.sourceSpatial.outdoorBvh;
		if (!bvh || bvh.nodes.length === 0) {
			this.#outdoorBvhRootsByDomainAndLandblock.delete(rootKey);
			return;
		}

		const items = bvh.items.map((item): OutdoorStaticBvhRuntimeItem | null =>
			item.object
				? {
						bvhItemIndex: item.bvhItemIndex,
						kind: item.kind,
						object: item.object,
					}
				: null,
		);
		this.#outdoorBvhRootsByDomainAndLandblock.set(rootKey, {
			domain: payload.domain,
			items,
			landblockId: payload.landblock.landblockId,
			nodes: bvh.nodes,
			translation: createOutdoorLandblockRootTranslation(
				payload.landblock.landblockId,
				outdoorAnchorLandblockId,
			),
		});
	}

	ingestLandblockEnvCells(payload: LandblockEnvCellsStaticScopePayload): void {
		const acceptedEnvCellIds = new Set(payload.acceptedEnvCellIds);
		const cellsByEnvCellId = new Map<number, EnvCellBvhRoot>();

		for (const envCell of payload.envCells) {
			const envCellId = envCell.identity.envCellId;
			if (
				acceptedEnvCellIds.size > 0 &&
				!acceptedEnvCellIds.has(envCellId)
			) {
				continue;
			}

			const seedsByInstanceId = new Map(
				envCell.staticObjectSeeds.flatMap((seed): [
					string,
					EnvCellStaticSeedRuntimeRecord,
				][] => {
					if (!seed.instanceBounds) {
						return [];
					}
					return [
						[
							seed.identity.instanceId,
							{
								bounds: seed.instanceBounds,
								envCellId,
								hit: {
									bounds: transformBounds(seed.instanceBounds, envCell.localPlacement),
									bvhItemIndex: null,
									context: {
										acceptedEnvCellIds: payload.acceptedEnvCellIds,
										envCellId,
										kind: "env-cell",
										landblockId: payload.landblock.landblockId,
									},
									debugSourceAssetId: seed.debug.sourceAssetId,
									domain: "landblock-env-cells",
									envCellId,
									instanceId: seed.identity.instanceId,
									itemKind: "env-cell-static-object",
									kind: "static-scene-pick-hit",
									landblockId: payload.landblock.landblockId,
									objectKind: seed.identity.objectKind,
									queryPath: "source-bvh",
									source: seed.source,
									sourceIndex: seed.sourceIndex,
								},
							},
						],
					];
				}),
			);

			const bvh = envCell.localSpatial.localBvh;
			const items = bvh.items.map((item, bvhItemIndex): EnvCellBvhRuntimeItem | null => {
				if (item.kind === "static") {
					const seed = seedsByInstanceId.get(item.instanceId);
					if (seed) {
						return {
							bvhItemIndex,
							kind: "static",
							seed,
						};
					}
					return null;
				}

				return {
					bvhItemIndex,
					kind: item.kind,
					sourceItem: item,
				};
			});
			cellsByEnvCellId.set(envCellId, {
				acceptedEnvCellIds: payload.acceptedEnvCellIds,
				envCellId,
				items,
				landblockId: payload.landblock.landblockId,
				nodes: bvh.nodes,
				placement: envCell.localPlacement,
			});
		}

		const landblockBvh = payload.residencySpatial.landblockEnvCellBvh;
		if (landblockBvh.nodes.length === 0) {
			this.#envCellRootsByLandblockId.delete(payload.landblock.landblockId);
			return;
		}
		const items = landblockBvh.items.map((item) =>
			cellsByEnvCellId.has(item.identity.envCellId)
				? {
						bounds: item.bounds,
						envCellId: item.identity.envCellId,
						memberId: item.memberId,
						source: item.source,
					}
				: null,
		);

		this.#envCellRootsByLandblockId.set(payload.landblock.landblockId, {
			acceptedEnvCellIds: payload.acceptedEnvCellIds,
			cellsByEnvCellId,
			items,
			landblockId: payload.landblock.landblockId,
			nodes: landblockBvh.nodes,
		});
	}

	pickRay(request: StaticScenePickRequest): StaticScenePickHit | null {
		const ray = normalizeRay(request.ray);
		const hits =
			request.context.kind === "outdoor"
				? this.#pickOutdoor(ray, request)
				: this.#pickEnvCell(ray, request);

		return hits.sort(comparePickHits)[0] ?? null;
	}

	queryEnvCellAtPoint(options: {
		readonly acceptedEnvCellIds?: readonly number[];
		readonly landblockId: number;
		readonly point: StaticSceneVec3;
	}): number | null {
		const root = this.#envCellRootsByLandblockId.get(options.landblockId);
		if (!root) {
			return null;
		}

		const acceptedEnvCellIds = new Set(
			options.acceptedEnvCellIds ?? root.acceptedEnvCellIds,
		);
		const candidates = traverseBvhPoint(root.nodes, options.point)
			.flatMap((candidate) =>
				candidate.itemIndices.map((itemIndex) => ({
					item: root.items[itemIndex],
					nodeIndex: candidate.nodeIndex,
				})),
			)
			.filter(
				(candidate): candidate is {
					readonly item: EnvCellLandblockBvhRuntimeItem;
					readonly nodeIndex: number;
				} =>
					candidate.item !== null &&
					acceptedEnvCellIds.has(candidate.item.envCellId),
			)
			.sort(
				(left, right) =>
					left.item.envCellId - right.item.envCellId ||
					left.nodeIndex - right.nodeIndex,
			);

		return candidates[0]?.item.envCellId ?? null;
	}

	createSnapshot(): StaticSceneQuerySnapshot {
		let envCellRecordCount = 0;
		for (const root of this.#envCellRootsByLandblockId.values()) {
			for (const cellRoot of root.cellsByEnvCellId.values()) {
				envCellRecordCount +=
					cellRoot.items.filter((item) => item?.kind === "static").length;
			}
		}

		const outdoorBvhRecordCount = [...this.#outdoorBvhRootsByDomainAndLandblock.values()].reduce(
			(count, root) => count + root.items.filter(Boolean).length,
			0,
		);

		return {
			envCellLandblockCount: this.#envCellRootsByLandblockId.size,
			envCellRecordCount,
			outdoorRecordCount: outdoorBvhRecordCount,
		};
	}

	clear(): void {
		this.#outdoorBvhRootsByDomainAndLandblock.clear();
		this.#envCellRootsByLandblockId.clear();
	}

	#pickOutdoor(
		ray: StaticSceneRay,
		request: StaticScenePickRequest,
	): OutdoorStaticObjectScenePickHit[] {
		const hits: OutdoorStaticObjectScenePickHit[] = [];

		for (const root of this.#outdoorBvhRootsByDomainAndLandblock.values()) {
			const localRay = translateRay(ray, negateTranslation(root.translation));
			for (const candidate of traverseBvh(root.nodes, localRay)) {
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
						bvhItemIndex: item.bvhItemIndex,
						bvhItemKind: item.kind,
						context: { kind: "outdoor" },
						distance,
						domain: root.domain,
						hitPoint: pointOnRay(ray, distance),
						instanceId: item.object.identity.instanceId,
						itemKind: "outdoor-static-object",
						kind: "static-scene-pick-hit",
						landblockId: root.landblockId,
						objectKind: item.object.identity.objectKind,
						queryPath: "source-bvh",
						source: item.object.source,
						sourceAssetId: item.object.debug.sourceAssetId,
						sourceIndex: item.object.sourceIndex,
					};
					if (matchesFilters(hit, request.filters, ray.origin)) {
						hits.push(hit);
					}
				}
			}
		}

		return hits;
	}

	#pickEnvCell(
		ray: StaticSceneRay,
		request: StaticScenePickRequest,
	): EnvCellStaticScenePickHit[] {
		if (request.context.kind !== "env-cell") {
			return [];
		}

		const landblockRoot = this.#envCellRootsByLandblockId.get(
			request.context.landblockId,
		);
		if (!landblockRoot) {
			return [];
		}
		const acceptedEnvCellIds = new Set(
			request.context.acceptedEnvCellIds ?? [request.context.envCellId],
		);
		const hits: EnvCellStaticScenePickHit[] = [];

		for (const broadCandidate of traverseBvh(landblockRoot.nodes, ray)) {
			for (const landblockItemIndex of broadCandidate.itemIndices) {
				const landblockItem = landblockRoot.items[landblockItemIndex];
				if (
					!landblockItem ||
					!acceptedEnvCellIds.has(landblockItem.envCellId)
				) {
					continue;
				}
				const root = landblockRoot.cellsByEnvCellId.get(
					landblockItem.envCellId,
				);
				if (!root) {
					continue;
				}
				hits.push(...this.#pickEnvCellLocalRoot(ray, request, root));
			}
		}

		return hits;
	}

	#pickEnvCellLocalRoot(
		ray: StaticSceneRay,
		request: StaticScenePickRequest,
		root: EnvCellBvhRoot,
	): EnvCellStaticScenePickHit[] {
		const hits: EnvCellStaticScenePickHit[] = [];
		const localRay = transformRayToLocal(ray, root.placement);
		for (const candidate of traverseBvh(root.nodes, localRay)) {
			for (const itemIndex of candidate.itemIndices) {
				const item = root.items[itemIndex];
				if (item?.kind !== "static") {
					continue;
				}

				const distance = intersectRayBounds(localRay, item.seed.bounds);
				if (distance === null) {
					continue;
				}

				const hit: EnvCellStaticScenePickHit = {
					...item.seed.hit,
					bvhItemIndex: item.bvhItemIndex,
					distance,
					hitPoint: pointOnRay(ray, distance),
					queryPath: "source-bvh",
				};
				if (matchesFilters(hit, request.filters, ray.origin)) {
					hits.push(hit);
				}
			}
		}

		return hits;
	}
}

interface BvhCandidate {
	readonly distance: number;
	readonly itemIndices: readonly number[];
	readonly nodeIndex: number;
}

function traverseBvh(
	nodes: readonly BvhNode[],
	ray: StaticSceneRay,
): readonly BvhCandidate[] {
	if (nodes.length === 0) {
		return [];
	}

	const candidates: BvhCandidate[] = [];
	const stack = [0];
	while (stack.length > 0) {
		const nodeIndex = stack.pop() ?? 0;
		const node = nodes[nodeIndex];
		if (!node) {
			continue;
		}

		const distance = intersectRayBounds(ray, node.bounds);
		if (distance === null) {
			continue;
		}

		if (node.itemIndices.length > 0) {
			candidates.push({
				distance,
				itemIndices: node.itemIndices,
				nodeIndex,
			});
		}
		if (node.right !== null) {
			stack.push(node.right);
		}
		if (node.left !== null) {
			stack.push(node.left);
		}
	}

	return candidates.sort(
		(left, right) =>
			left.distance - right.distance || left.nodeIndex - right.nodeIndex,
	);
}

function traverseBvhPoint(
	nodes: readonly BvhNode[],
	point: StaticSceneVec3,
): readonly BvhCandidate[] {
	if (nodes.length === 0) {
		return [];
	}

	const candidates: BvhCandidate[] = [];
	const stack = [0];
	while (stack.length > 0) {
		const nodeIndex = stack.pop() ?? 0;
		const node = nodes[nodeIndex];
		if (!node || !containsPoint(node.bounds, point)) {
			continue;
		}

		if (node.itemIndices.length > 0) {
			candidates.push({
				distance: boundsCenterDistanceSquared(node.bounds, point),
				itemIndices: node.itemIndices,
				nodeIndex,
			});
		}
		if (node.right !== null) {
			stack.push(node.right);
		}
		if (node.left !== null) {
			stack.push(node.left);
		}
	}

	return candidates.sort(
		(left, right) =>
			left.distance - right.distance || left.nodeIndex - right.nodeIndex,
	);
}

function matchesFilters(
	hit: StaticScenePickHit,
	filters: StaticScenePickFilters | undefined,
	rayOrigin: StaticSceneVec3,
): boolean {
	return (
		(!filters?.itemKinds || filters.itemKinds.includes(hit.itemKind)) &&
		(!filters?.domains || filters.domains.includes(hit.domain)) &&
		(!filters?.ignoreContainingOrigin || !containsPoint(hit.bounds, rayOrigin))
	);
}

function comparePickHits(
	left: StaticScenePickHit,
	right: StaticScenePickHit,
): number {
	return (
		left.distance - right.distance ||
		left.itemKind.localeCompare(right.itemKind) ||
		describeHitStableId(left).localeCompare(describeHitStableId(right))
	);
}

function describeHitStableId(hit: StaticScenePickHit): string {
	if (hit.itemKind === "outdoor-static-object") {
		return `${hit.landblockId}:${hit.domain}:${hit.instanceId}`;
	}

	return `${hit.landblockId}:${hit.envCellId}:${hit.instanceId}`;
}

function createOutdoorRootKey(
	domain: OutdoorStaticObjectsScopePayload["domain"],
	landblockId: number,
): string {
	return `${domain}:${landblockId.toString(16)}`;
}

function normalizeRay(ray: StaticSceneRay): StaticSceneRay {
	return {
		direction: normalizeVec3(ray.direction),
		origin: ray.origin,
	};
}

function intersectRayBounds(
	ray: StaticSceneRay,
	bounds: StaticBounds,
): number | null {
	let tMin = Number.NEGATIVE_INFINITY;
	let tMax = Number.POSITIVE_INFINITY;

	for (const axis of ["x", "y", "z"] as const) {
		const origin = ray.origin[axis];
		const direction = ray.direction[axis];
		const min = bounds.min[axis];
		const max = bounds.max[axis];

		if (Math.abs(direction) < 1e-8) {
			if (origin < min || origin > max) {
				return null;
			}
			continue;
		}

		const inverse = 1 / direction;
		const t1 = (min - origin) * inverse;
		const t2 = (max - origin) * inverse;
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

function containsPoint(bounds: StaticBounds, point: StaticSceneVec3): boolean {
	return (
		point.x >= bounds.min.x &&
		point.x <= bounds.max.x &&
		point.y >= bounds.min.y &&
		point.y <= bounds.max.y &&
		point.z >= bounds.min.z &&
		point.z <= bounds.max.z
	);
}

function boundsCenterDistanceSquared(
	bounds: StaticBounds,
	point: StaticSceneVec3,
): number {
	const center = {
		x: (bounds.min.x + bounds.max.x) * 0.5,
		y: (bounds.min.y + bounds.max.y) * 0.5,
		z: (bounds.min.z + bounds.max.z) * 0.5,
	};
	const dx = center.x - point.x;
	const dy = center.y - point.y;
	const dz = center.z - point.z;
	return dx * dx + dy * dy + dz * dz;
}

function pointOnRay(ray: StaticSceneRay, distance: number): StaticSceneVec3 {
	return {
		x: ray.origin.x + ray.direction.x * distance,
		y: ray.origin.y + ray.direction.y * distance,
		z: ray.origin.z + ray.direction.z * distance,
	};
}

function translateRay(
	ray: StaticSceneRay,
	translation: readonly [number, number, number],
): StaticSceneRay {
	return {
		direction: ray.direction,
		origin: {
			x: ray.origin.x + translation[0],
			y: ray.origin.y + translation[1],
			z: ray.origin.z + translation[2],
		},
	};
}

function negateTranslation(
	translation: readonly [number, number, number],
): readonly [number, number, number] {
	return [-translation[0], -translation[1], -translation[2]];
}

function transformRayToLocal(
	ray: StaticSceneRay,
	placement: StaticPlacementTransform,
): StaticSceneRay {
	const translatedOrigin = {
		x: ray.origin.x - placement.origin.x,
		y: ray.origin.y - placement.origin.y,
		z: ray.origin.z - placement.origin.z,
	};
	return {
		direction: rotateVec3ByInverseQuaternion(
			ray.direction,
			placement.orientation,
		),
		origin: rotateVec3ByInverseQuaternion(
			translatedOrigin,
			placement.orientation,
		),
	};
}

function transformBounds(
	bounds: StaticBounds,
	placement: StaticPlacementTransform,
): StaticBounds {
	const corners: StaticSceneVec3[] = [];
	for (const x of [bounds.min.x, bounds.max.x]) {
		for (const y of [bounds.min.y, bounds.max.y]) {
			for (const z of [bounds.min.z, bounds.max.z]) {
				const rotated = rotateVec3ByQuaternion(
					{ x, y, z },
					placement.orientation,
				);
				corners.push({
					x: rotated.x + placement.origin.x,
					y: rotated.y + placement.origin.y,
					z: rotated.z + placement.origin.z,
				});
			}
		}
	}

	return boundsFromPoints(corners);
}

function translateBounds(
	bounds: StaticBounds,
	translation: readonly [number, number, number],
): StaticBounds {
	return {
		max: {
			x: bounds.max.x + translation[0],
			y: bounds.max.y + translation[1],
			z: bounds.max.z + translation[2],
		},
		min: {
			x: bounds.min.x + translation[0],
			y: bounds.min.y + translation[1],
			z: bounds.min.z + translation[2],
		},
	};
}

function boundsFromPoints(points: readonly StaticSceneVec3[]): StaticBounds {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;

	for (const point of points) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		minZ = Math.min(minZ, point.z);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
		maxZ = Math.max(maxZ, point.z);
	}

	return {
		max: { x: maxX, y: maxY, z: maxZ },
		min: { x: minX, y: minY, z: minZ },
	};
}

function rotateVec3ByQuaternion(
	vector: StaticVec3,
	quaternion: StaticPlacementTransform["orientation"],
): StaticSceneVec3 {
	const qx = quaternion.x;
	const qy = quaternion.y;
	const qz = quaternion.z;
	const qw = quaternion.w;
	const ix = qw * vector.x + qy * vector.z - qz * vector.y;
	const iy = qw * vector.y + qz * vector.x - qx * vector.z;
	const iz = qw * vector.z + qx * vector.y - qy * vector.x;
	const iw = -qx * vector.x - qy * vector.y - qz * vector.z;

	return {
		x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
		y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
		z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
	};
}

function rotateVec3ByInverseQuaternion(
	vector: StaticVec3,
	quaternion: StaticPlacementTransform["orientation"],
): StaticSceneVec3 {
	return rotateVec3ByQuaternion(vector, {
		w: quaternion.w,
		x: -quaternion.x,
		y: -quaternion.y,
		z: -quaternion.z,
	});
}

function normalizeVec3(vector: StaticSceneVec3): StaticSceneVec3 {
	const length = Math.hypot(vector.x, vector.y, vector.z);
	if (length === 0) {
		return { x: 0, y: 0, z: -1 };
	}

	return {
		x: vector.x / length,
		y: vector.y / length,
		z: vector.z / length,
	};
}
