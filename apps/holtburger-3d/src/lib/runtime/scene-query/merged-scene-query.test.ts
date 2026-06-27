import { describe, expect, it } from "vitest";
import { makeOutdoorLandblockId } from "../../landblocks";
import type { OutdoorDynamicSpatialIndexRecord } from "../../dynamic/outdoor-dynamic-spatial-index";
import type { StaticBounds } from "../../static/contracts";
import type { StaticScenePickHit } from "./contracts";
import { pickMergedSceneRay, type MergedSceneQuerySources } from "./merged-scene-query";

describe("merged scene query", () => {
	it("orders dynamic AABB hits with static hits by nearest distance", () => {
		const landblockId = makeOutdoorLandblockId(0xda, 0x55);
		const hit = pickMergedSceneRay(
			createSources({
				dynamicRecords: [
					createDynamicRecord({
						bounds: createBounds({
							max: { x: 1, y: 1, z: -4 },
							min: { x: -1, y: -1, z: -5 },
						}),
						landblockId,
						sourceLandblockId: landblockId,
					}),
				],
				staticHit: createStaticHit({ distance: 10 }),
			}),
			{
				context: { kind: "outdoor" },
				mode: "debug-inspection",
				ray: {
					direction: { x: 0, y: 0, z: -1 },
					origin: { x: 0, y: 0, z: 0 },
				},
			},
		);

		expect(hit).toMatchObject({
			distance: 4,
			entityId: "dynamic-test-entity",
			source: "dynamic",
		});
	});

	it("excludes dynamic scenery from default selection while keeping it queryable for debug", () => {
		const landblockId = makeOutdoorLandblockId(0xda, 0x55);
		const sources = createSources({
			dynamicRecords: [
				createDynamicRecord({
					bounds: createBounds({
						max: { x: 1, y: 1, z: -4 },
						min: { x: -1, y: -1, z: -5 },
					}),
					landblockId,
					sourceLandblockId: landblockId,
				}),
			],
			staticHit: null,
		});
		const request = {
			context: { kind: "outdoor" as const },
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 0, y: 0, z: 0 },
			},
		};

		expect(
			pickMergedSceneRay(sources, {
				...request,
				mode: "default-selection",
			}),
		).toBeNull();
		expect(
			pickMergedSceneRay(sources, {
				...request,
				mode: "debug-inspection",
			}),
		).toMatchObject({
			defaultSelectable: false,
			entityId: "dynamic-test-entity",
			source: "dynamic",
		});
	});

	it("translates indexed dynamic bounds into render space before ray narrowing", () => {
		const anchorLandblockId = makeOutdoorLandblockId(0xda, 0x55);
		const eastLandblockId = makeOutdoorLandblockId(0xdb, 0x55);
		const hit = pickMergedSceneRay(
			createSources({
				dynamicRecords: [
					createDynamicRecord({
						bounds: createBounds({
							max: { x: 1, y: 1, z: -4 },
							min: { x: -1, y: -1, z: -5 },
						}),
						landblockId: eastLandblockId,
						sourceLandblockId: anchorLandblockId,
					}),
				],
				outdoorAnchorLandblockId: anchorLandblockId,
				staticHit: null,
			}),
			{
				context: { kind: "outdoor" },
				mode: "diagnostics",
				ray: {
					direction: { x: 0, y: 0, z: -1 },
					origin: { x: 192, y: 0, z: 0 },
				},
			},
		);

		expect(hit).toMatchObject({
			bounds: {
				max: { x: 193, y: 1, z: -4 },
				min: { x: 191, y: -1, z: -5 },
			},
			distance: 4,
			source: "dynamic",
		});
	});

	it("keeps env-cell dynamic records out until an env-cell dynamic query path exists", () => {
		let dynamicLandblockQueries = 0;
		const hit = pickMergedSceneRay(
			createSources({
				dynamicLandblockQuery: () => {
					dynamicLandblockQueries += 1;
					return [makeOutdoorLandblockId(0xda, 0x55)];
				},
				staticHit: null,
			}),
			{
				context: {
					envCellId: 0xda550100,
					kind: "env-cell",
					landblockId: 0xda55ffff,
				},
				mode: "debug-inspection",
				ray: {
					direction: { x: 0, y: 0, z: -1 },
					origin: { x: 0, y: 0, z: 0 },
				},
			},
		);

		expect(hit).toBeNull();
		expect(dynamicLandblockQueries).toBe(0);
	});
});

function createSources(options: {
	readonly dynamicLandblockQuery?: () => readonly number[];
	readonly dynamicRecords?: readonly OutdoorDynamicSpatialIndexRecord[];
	readonly outdoorAnchorLandblockId?: number | null;
	readonly staticHit?: StaticScenePickHit | null;
}): MergedSceneQuerySources {
	const dynamicRecords = options.dynamicRecords ?? [];
	return {
		outdoorAnchorLandblockId: options.outdoorAnchorLandblockId ?? null,
		pickStaticRay: () => options.staticHit ?? null,
		queryOutdoorDynamicBounds: (query) =>
			dynamicRecords.filter((record) => record.landblockId === query.landblockId),
		queryOutdoorDynamicLandblockIds:
			options.dynamicLandblockQuery ??
			(() => [...new Set(dynamicRecords.map((record) => record.landblockId))]),
	};
}

function createStaticHit(options: { readonly distance: number }): StaticScenePickHit {
	return {
		bounds: createBounds({
			max: { x: 1, y: 1, z: -9 },
			min: { x: -1, y: -1, z: -10 },
		}),
		distance: options.distance,
		hitPoint: { x: 0, y: 0, z: -options.distance },
		kind: "static-scene-pick-hit",
		selectionKey: {
			domain: "outdoor-terrain",
			itemKind: "terrain-quad",
			landblockId: makeOutdoorLandblockId(0xda, 0x55),
			quadIndex: 0,
		},
	};
}

function createDynamicRecord(
	options: Pick<
		OutdoorDynamicSpatialIndexRecord,
		"bounds" | "landblockId" | "sourceLandblockId"
	>,
): OutdoorDynamicSpatialIndexRecord {
	return {
		...options,
		entityId: "dynamic-test-entity",
		precision: "current-frame-source-part-bounds-aabb",
		sourceBounds: options.bounds,
	};
}

function createBounds(bounds: StaticBounds): StaticBounds {
	return bounds;
}
