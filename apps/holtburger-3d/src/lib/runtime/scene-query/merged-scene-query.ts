import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../../../lib/landblocks";
import type { EnvCellDynamicSpatialIndexRecord } from "../../dynamic/dynamic-placement-tracker";
import type { OutdoorDynamicSpatialIndexRecord } from "../../dynamic/outdoor-dynamic-spatial-index";
import type { StaticBounds } from "../../static/contracts";
import { createOutdoorLandblockRootTranslation } from "../static-placement";
import type { StaticScenePickHit, StaticScenePickRequest } from "./contracts";
import {
	intersectRayBounds,
	normalizeRay,
	pointOnRay,
	translateBounds,
} from "./geometry";
import type { ScenePickHit, ScenePickRequest } from "./merged-scene-query-contracts";
import { compareStaticSceneSelectionKeys } from "./static-selection-keys";

const DYNAMIC_LANDBLOCK_SEARCH_BOUNDS: StaticBounds = {
	max: {
		x: OUTDOOR_LANDBLOCK_WORLD_SIZE * 2,
		y: Number.POSITIVE_INFINITY,
		z: OUTDOOR_LANDBLOCK_WORLD_SIZE,
	},
	min: {
		x: -OUTDOOR_LANDBLOCK_WORLD_SIZE,
		y: Number.NEGATIVE_INFINITY,
		z: -OUTDOOR_LANDBLOCK_WORLD_SIZE * 2,
	},
};

export interface MergedSceneQuerySources {
	readonly outdoorAnchorLandblockId: number | null;
	readonly pickStaticRay: (request: StaticScenePickRequest) => StaticScenePickHit | null;
	readonly queryOutdoorDynamicBounds: (options: {
		readonly landblockId: number;
		readonly bounds: StaticBounds;
	}) => readonly OutdoorDynamicSpatialIndexRecord[];
	readonly queryOutdoorDynamicLandblockIds: () => readonly number[];
	readonly queryEnvCellDynamicBounds: (options: {
		readonly envCellIds: readonly number[];
		readonly landblockId: number;
	}) => readonly EnvCellDynamicSpatialIndexRecord[];
}

export function pickMergedSceneRay(
	sources: MergedSceneQuerySources,
	request: ScenePickRequest,
): ScenePickHit | null {
	const hits: ScenePickHit[] = [];
	const staticHit = sources.pickStaticRay({
		context: request.context,
		filters: request.filters,
		ray: request.ray,
	});
	if (staticHit) {
		hits.push({
			bounds: staticHit.bounds,
			distance: staticHit.distance,
			hitPoint: staticHit.hitPoint,
			kind: "scene-pick-hit",
			source: "static",
			staticHit,
		});
	}
	hits.push(...pickOutdoorDynamicHits(sources, request));
	hits.push(...pickEnvCellDynamicHits(sources, request));

	return hits.sort(compareScenePickHits)[0] ?? null;
}

function pickOutdoorDynamicHits(
	sources: MergedSceneQuerySources,
	request: ScenePickRequest,
): readonly ScenePickHit[] {
	if (request.context.kind !== "outdoor" || request.mode === "default-selection") {
		return [];
	}
	const ray = normalizeRay(request.ray);
	const hitsByEntityId = new Map<string, ScenePickHit>();
	for (const landblockId of sources.queryOutdoorDynamicLandblockIds()) {
		for (const record of sources.queryOutdoorDynamicBounds({
			bounds: DYNAMIC_LANDBLOCK_SEARCH_BOUNDS,
			landblockId,
		})) {
			const translation = createOutdoorLandblockRootTranslation(
				record.landblockId,
				sources.outdoorAnchorLandblockId,
			);
			const bounds = translateBounds(record.bounds, translation);
			const distance = intersectRayBounds(ray, bounds);
			if (distance === null) {
				continue;
			}
			const hit: ScenePickHit = {
				bounds,
				defaultSelectable: false,
				distance,
				entityId: record.entityId,
				hitPoint: pointOnRay(ray, distance),
				kind: "scene-pick-hit",
				precision: record.precision,
				source: "dynamic",
				sourceResidence: {
					kind: "outdoor-landblock",
					landblockId: record.sourceLandblockId,
				},
			};
			const existing = hitsByEntityId.get(record.entityId);
			if (!existing || compareScenePickHits(hit, existing) < 0) {
				hitsByEntityId.set(record.entityId, hit);
			}
		}
	}

	return [...hitsByEntityId.values()];
}

function pickEnvCellDynamicHits(
	sources: MergedSceneQuerySources,
	request: ScenePickRequest,
): readonly ScenePickHit[] {
	if (request.context.kind !== "env-cell" || request.mode === "default-selection") {
		return [];
	}
	const acceptedEnvCellIds =
		request.context.acceptedEnvCellIds ?? [request.context.envCellId];
	const ray = normalizeRay(request.ray);
	return sources
		.queryEnvCellDynamicBounds({
			envCellIds: acceptedEnvCellIds,
			landblockId: request.context.landblockId,
		})
		.flatMap((record): readonly ScenePickHit[] => {
			const distance = intersectRayBounds(ray, record.bounds);
			if (distance === null) {
				return [];
			}
			return [
				{
					bounds: record.bounds,
					defaultSelectable: false,
					distance,
					entityId: record.entityId,
					hitPoint: pointOnRay(ray, distance),
					kind: "scene-pick-hit",
					precision: record.precision,
					source: "dynamic",
					sourceResidence: {
						envCellId: record.envCellId,
						kind: "env-cell",
						landblockId: record.landblockId,
					},
				},
			];
		});
}

function compareScenePickHits(left: ScenePickHit, right: ScenePickHit): number {
	return (
		left.distance - right.distance ||
		left.source.localeCompare(right.source) ||
		compareScenePickHitIdentity(left, right)
	);
}

function compareScenePickHitIdentity(left: ScenePickHit, right: ScenePickHit): number {
	if (left.source === "static" && right.source === "static") {
		return compareStaticSceneSelectionKeys(
			left.staticHit.selectionKey,
			right.staticHit.selectionKey,
		);
	}
	if (left.source === "dynamic" && right.source === "dynamic") {
		return left.entityId.localeCompare(right.entityId);
	}
	return left.source.localeCompare(right.source);
}
