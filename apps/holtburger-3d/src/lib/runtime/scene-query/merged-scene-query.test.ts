import { describe, expect, it } from "vitest";
import { makeOutdoorLandblockId } from "../../landblocks";
import type { EnvCellDynamicSpatialIndexRecord } from "../../dynamic/dynamic-placement-tracker";
import type { OutdoorDynamicSpatialIndexRecord } from "../../dynamic/outdoor-dynamic-spatial-index";
import type { StaticBounds } from "../../static/contracts";
import type { StaticScenePickHit } from "./contracts";
import {
	pickMergedSceneRay,
	type MergedSceneQuerySources,
} from "./merged-scene-query";

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

	it("returns dynamic scenery for default browser selection and debug inspection", () => {
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
		).toMatchObject({
			defaultSelectable: true,
			entityId: "dynamic-test-entity",
			source: "dynamic",
		});
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

	it("returns env-cell dynamic hits through default browser selection and debug modes", () => {
		const sources = createSources({
			envCellDynamicRecords: [
				createEnvCellDynamicRecord({
					bounds: createBounds({
						max: { x: 1, y: 1, z: -4 },
						min: { x: -1, y: -1, z: -5 },
					}),
					envCellId: 0xda550100,
					landblockId: 0xda55ffff,
				}),
			],
			staticHit: null,
		});
		const request = {
			context: {
				envCellId: 0xda550100,
				kind: "env-cell" as const,
				landblockId: 0xda55ffff,
			},
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
		).toMatchObject({
			defaultSelectable: true,
			distance: 4,
			entityId: "dynamic-test-entity",
			source: "dynamic",
		});
		expect(
			pickMergedSceneRay(sources, {
				...request,
				mode: "debug-inspection",
			}),
		).toMatchObject({
			defaultSelectable: false,
			distance: 4,
			entityId: "dynamic-test-entity",
			source: "dynamic",
			sourceResidence: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
		});
	});

	it("filters env-cell dynamic hits through accepted env-cell visibility", () => {
		const hit = pickMergedSceneRay(
			createSources({
				envCellDynamicRecords: [
					createEnvCellDynamicRecord({
						bounds: createBounds({
							max: { x: 1, y: 1, z: -4 },
							min: { x: -1, y: -1, z: -5 },
						}),
						envCellId: 0xda550101,
						landblockId: 0xda55ffff,
					}),
				],
				staticHit: null,
			}),
			{
				context: {
					acceptedEnvCellIds: [0xda550100],
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
	});
});

function createSources(options: {
	readonly dynamicLandblockQuery?: () => readonly number[];
	readonly dynamicRecords?: readonly OutdoorDynamicSpatialIndexRecord[];
	readonly envCellDynamicRecords?: readonly EnvCellDynamicSpatialIndexRecord[];
	readonly outdoorAnchorLandblockId?: number | null;
	readonly staticHit?: StaticScenePickHit | null;
}): MergedSceneQuerySources {
	const dynamicRecords = options.dynamicRecords ?? [];
	const envCellDynamicRecords = options.envCellDynamicRecords ?? [];
	return {
		outdoorAnchorLandblockId: options.outdoorAnchorLandblockId ?? null,
		pickStaticRay: () => options.staticHit ?? null,
		queryEnvCellDynamicBounds: (query) =>
			envCellDynamicRecords.filter(
				(record) =>
					record.landblockId === query.landblockId &&
					query.envCellIds.includes(record.envCellId),
			),
		queryOutdoorDynamicBounds: (query) =>
			dynamicRecords.filter(
				(record) => record.landblockId === query.landblockId,
			),
		queryOutdoorDynamicLandblockIds:
			options.dynamicLandblockQuery ??
			(() => [...new Set(dynamicRecords.map((record) => record.landblockId))]),
	};
}

function createStaticHit(options: {
	readonly distance: number;
}): StaticScenePickHit {
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

function createEnvCellDynamicRecord(
	options: Pick<
		EnvCellDynamicSpatialIndexRecord,
		"bounds" | "envCellId" | "landblockId"
	>,
): EnvCellDynamicSpatialIndexRecord {
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
