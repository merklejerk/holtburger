import { describe, expect, it } from "vitest";
import { makeOutdoorLandblockId } from "../../lib/landblocks";
import type { StaticBounds } from "../static/contracts";
import { OutdoorDynamicSpatialIndex } from "./outdoor-dynamic-spatial-index";

describe("outdoor dynamic spatial index", () => {
	it("indexes source bounds into each effective landblock with landblock-local bounds", () => {
		const sourceLandblockId = makeOutdoorLandblockId(0xda, 0x55);
		const eastLandblockId = makeOutdoorLandblockId(0xdb, 0x55);
		const index = new OutdoorDynamicSpatialIndex();

		const landblockIds = index.upsert({
			bounds: createBounds({
				max: { x: 205, y: 3, z: -70 },
				min: { x: 180, y: 1, z: -90 },
			}),
			entityId: "dynamic-cross-boundary",
			landblockIds: [sourceLandblockId, eastLandblockId],
			precision: "current-frame-source-part-bounds-aabb",
			sourceLandblockId,
		});

		expect(landblockIds).toEqual([sourceLandblockId, eastLandblockId]);
		expect(
			index.search(
				sourceLandblockId,
				createBounds({
					max: { x: 190, y: 10, z: -60 },
					min: { x: 170, y: -10, z: -100 },
				}),
			),
		).toMatchObject([
			{
				bounds: {
					max: { x: 205, y: 3, z: -70 },
					min: { x: 180, y: 1, z: -90 },
				},
				entityId: "dynamic-cross-boundary",
				landblockId: sourceLandblockId,
				sourceLandblockId,
			},
		]);
		expect(
			index.search(
				eastLandblockId,
				createBounds({
					max: { x: 20, y: 10, z: -60 },
					min: { x: -20, y: -10, z: -100 },
				}),
			),
		).toMatchObject([
			{
				bounds: {
					max: { x: 13, y: 3, z: -70 },
					min: { x: -12, y: 1, z: -90 },
				},
				entityId: "dynamic-cross-boundary",
				landblockId: eastLandblockId,
				sourceBounds: {
					max: { x: 205, y: 3, z: -70 },
					min: { x: 180, y: 1, z: -90 },
				},
				sourceLandblockId,
			},
		]);
	});

	it("removes all landblock entries for an entity", () => {
		const sourceLandblockId = makeOutdoorLandblockId(0xda, 0x55);
		const eastLandblockId = makeOutdoorLandblockId(0xdb, 0x55);
		const index = new OutdoorDynamicSpatialIndex();
		index.upsert({
			bounds: createBounds({
				max: { x: 205, y: 3, z: -70 },
				min: { x: 180, y: 1, z: -90 },
			}),
			entityId: "dynamic-cross-boundary",
			landblockIds: [sourceLandblockId, eastLandblockId],
			precision: "current-frame-source-part-bounds-aabb",
			sourceLandblockId,
		});

		index.remove("dynamic-cross-boundary");

		expect(index.records()).toEqual([]);
		expect(index.landblockIdsForEntity("dynamic-cross-boundary")).toEqual([]);
	});

	it("lists indexed landblocks without exposing records", () => {
		const sourceLandblockId = makeOutdoorLandblockId(0xda, 0x55);
		const eastLandblockId = makeOutdoorLandblockId(0xdb, 0x55);
		const index = new OutdoorDynamicSpatialIndex();

		index.upsert({
			bounds: createBounds({
				max: { x: 205, y: 3, z: -70 },
				min: { x: 180, y: 1, z: -90 },
			}),
			entityId: "dynamic-cross-boundary",
			landblockIds: [eastLandblockId, sourceLandblockId],
			precision: "current-frame-source-part-bounds-aabb",
			sourceLandblockId,
		});

		expect(index.landblockIds()).toEqual([sourceLandblockId, eastLandblockId]);
	});
});

function createBounds(bounds: StaticBounds): StaticBounds {
	return bounds;
}
