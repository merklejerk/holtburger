import type { StaticResidencyDelta } from "../renderer/types";
import type {
	LandblockEnvCellsStaticScopePayload,
	StaticBounds,
	StaticObjectGeometryStaticDrawUnit,
	StaticScopePayload,
} from "../static/contracts";

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
}

export type StaticScenePickHit =
	| OutdoorStaticScenePickHit
	| EnvCellStaticScenePickHit;

export interface OutdoorStaticScenePickHit {
	readonly kind: "static-scene-pick-hit";
	readonly itemKind: "outdoor-static-draw-unit";
	readonly context: Extract<StaticScenePickContext, { readonly kind: "outdoor" }>;
	readonly domain: StaticObjectGeometryStaticDrawUnit["domain"];
	readonly distance: number;
	readonly hitPoint: StaticSceneVec3;
	readonly bounds: StaticBounds;
	readonly drawUnitId: string;
	readonly landblockId: number;
	readonly materialFamily: StaticObjectGeometryStaticDrawUnit["materialFamily"];
	readonly materialPass: StaticObjectGeometryStaticDrawUnit["materialPass"];
	readonly materialIds: readonly number[];
	readonly alphaTest: number;
	readonly renderState: StaticObjectGeometryStaticDrawUnit["renderState"];
	readonly textureUseIds: readonly string[];
	readonly sourceMappingRecords: readonly string[];
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
}

export interface StaticSceneQuerySnapshot {
	readonly outdoorRecordCount: number;
	readonly envCellRecordCount: number;
	readonly envCellLandblockCount: number;
}

interface StaticSceneVec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

interface OutdoorStaticQueryRecord {
	readonly bounds: StaticBounds;
	readonly context: Extract<StaticScenePickContext, { readonly kind: "outdoor" }>;
	readonly drawUnit: StaticObjectGeometryStaticDrawUnit;
}

interface EnvCellStaticQueryRecord {
	readonly bounds: StaticBounds;
	readonly envCellId: number;
	readonly hit: Omit<EnvCellStaticScenePickHit, "distance" | "hitPoint">;
}

export class StaticSceneQuery {
	readonly #outdoorRecordsByDrawUnitId = new Map<
		string,
		OutdoorStaticQueryRecord
	>();
	readonly #envCellRecordsByLandblockId = new Map<
		number,
		readonly EnvCellStaticQueryRecord[]
	>();

	ingestStaticResidencyDelta(delta: StaticResidencyDelta): void {
		for (const drawUnitId of delta.removedDrawUnitIds) {
			this.#outdoorRecordsByDrawUnitId.delete(drawUnitId);
		}

		for (const placement of delta.addedDrawUnitPlacements) {
			const drawUnit = placement.drawUnit;
			if (drawUnit.kind !== "static-object-geometry") {
				continue;
			}

			const localBounds =
				drawUnit.sort.bounds ?? computePositionBounds(drawUnit.positions);
			if (!localBounds) {
				continue;
			}

			this.#outdoorRecordsByDrawUnitId.set(drawUnit.drawUnitId, {
				bounds: translateBounds(localBounds, placement.translation),
				context: { kind: "outdoor" },
				drawUnit,
			});
		}
	}

	ingestSourcePayload(payload: StaticScopePayload): void {
		if (payload.scope.kind !== "landblock-env-cells") {
			return;
		}

		this.ingestLandblockEnvCells(payload.scope);
	}

	ingestLandblockEnvCells(payload: LandblockEnvCellsStaticScopePayload): void {
		const acceptedEnvCellIds = new Set(payload.acceptedEnvCellIds);
		const records: EnvCellStaticQueryRecord[] = [];

		for (const envCell of payload.envCells) {
			const envCellId = envCell.identity.envCellId;
			if (
				acceptedEnvCellIds.size > 0 &&
				!acceptedEnvCellIds.has(envCellId)
			) {
				continue;
			}

			for (const seed of envCell.staticObjectSeeds) {
				if (!seed.instanceBounds) {
					continue;
				}

				records.push({
					bounds: seed.instanceBounds,
					envCellId,
					hit: {
						bounds: seed.instanceBounds,
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
						source: seed.source,
						sourceIndex: seed.sourceIndex,
					},
				});
			}
		}

		this.#envCellRecordsByLandblockId.set(
			payload.landblock.landblockId,
			records,
		);
	}

	pickRay(request: StaticScenePickRequest): StaticScenePickHit | null {
		const ray = normalizeRay(request.ray);
		const hits =
			request.context.kind === "outdoor"
				? this.#pickOutdoor(ray, request)
				: this.#pickEnvCell(ray, request);

		return hits.sort(comparePickHits)[0] ?? null;
	}

	createSnapshot(): StaticSceneQuerySnapshot {
		let envCellRecordCount = 0;
		for (const records of this.#envCellRecordsByLandblockId.values()) {
			envCellRecordCount += records.length;
		}

		return {
			envCellLandblockCount: this.#envCellRecordsByLandblockId.size,
			envCellRecordCount,
			outdoorRecordCount: this.#outdoorRecordsByDrawUnitId.size,
		};
	}

	clear(): void {
		this.#outdoorRecordsByDrawUnitId.clear();
		this.#envCellRecordsByLandblockId.clear();
	}

	#pickOutdoor(
		ray: StaticSceneRay,
		request: StaticScenePickRequest,
	): OutdoorStaticScenePickHit[] {
		const hits: OutdoorStaticScenePickHit[] = [];
		for (const record of this.#outdoorRecordsByDrawUnitId.values()) {
			const distance = intersectRayBounds(ray, record.bounds);
			if (distance === null) {
				continue;
			}

			const hit: OutdoorStaticScenePickHit = {
				alphaTest: record.drawUnit.alphaTest,
				bounds: record.bounds,
				context: record.context,
				distance,
				domain: record.drawUnit.domain,
				drawUnitId: record.drawUnit.drawUnitId,
				hitPoint: pointOnRay(ray, distance),
				itemKind: "outdoor-static-draw-unit",
				kind: "static-scene-pick-hit",
				landblockId: record.drawUnit.landblockId,
				materialFamily: record.drawUnit.materialFamily,
				materialIds: record.drawUnit.materialIds,
				materialPass: record.drawUnit.materialPass,
				renderState: record.drawUnit.renderState,
				sourceMappingRecords: record.drawUnit.sourceMappingRecords,
				textureUseIds: record.drawUnit.textureUseIds,
			};
			if (matchesFilters(hit, request.filters)) {
				hits.push(hit);
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

		const records =
			this.#envCellRecordsByLandblockId.get(request.context.landblockId) ?? [];
		const acceptedEnvCellIds = new Set(
			request.context.acceptedEnvCellIds ?? [request.context.envCellId],
		);
		const hits: EnvCellStaticScenePickHit[] = [];

		for (const record of records) {
			if (!acceptedEnvCellIds.has(record.envCellId)) {
				continue;
			}

			const distance = intersectRayBounds(ray, record.bounds);
			if (distance === null) {
				continue;
			}

			const hit: EnvCellStaticScenePickHit = {
				...record.hit,
				distance,
				hitPoint: pointOnRay(ray, distance),
			};
			if (matchesFilters(hit, request.filters)) {
				hits.push(hit);
			}
		}

		return hits;
	}
}

function matchesFilters(
	hit: StaticScenePickHit,
	filters: StaticScenePickFilters | undefined,
): boolean {
	return (
		(!filters?.itemKinds || filters.itemKinds.includes(hit.itemKind)) &&
		(!filters?.domains || filters.domains.includes(hit.domain))
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
	return hit.itemKind === "outdoor-static-draw-unit"
		? hit.drawUnitId
		: `${hit.landblockId}:${hit.envCellId}:${hit.instanceId}`;
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

function pointOnRay(ray: StaticSceneRay, distance: number): StaticSceneVec3 {
	return {
		x: ray.origin.x + ray.direction.x * distance,
		y: ray.origin.y + ray.direction.y * distance,
		z: ray.origin.z + ray.direction.z * distance,
	};
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

function computePositionBounds(positions: Float32Array): StaticBounds | null {
	if (positions.length < 3) {
		return null;
	}

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;

	for (let index = 0; index < positions.length; index += 3) {
		const x = positions[index] ?? 0;
		const y = positions[index + 1] ?? 0;
		const z = positions[index + 2] ?? 0;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		minZ = Math.min(minZ, z);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
		maxZ = Math.max(maxZ, z);
	}

	return {
		max: { x: maxX, y: maxY, z: maxZ },
		min: { x: minX, y: minY, z: minZ },
	};
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
