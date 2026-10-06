import { describe, expect, it } from "vitest";
import {
	prepareHousingSearchAreas,
	projectHousingSearchAreas,
	type HousingSearchArea,
} from "./client-housing-search-map";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../lib/game/landblocks";

const view = { centerX: 0, centerZ: 0, spanMeters: 100 };
const areas: readonly HousingSearchArea[] = [
	{ cell: 1, position: { x: 1, z: 1 } },
	{ cell: 2, position: { x: 2, z: 2 } },
];
describe("housing search area placement", () => {
	it("deduplicates and orders disclosed cells before computing their centers", () => {
		const result = prepareHousingSearchAreas([
			0xa9b40001, 0xa8b40001, 0xa9b40001,
		]);
		expect(result.map((area) => area.cell)).toEqual([0xa8b40001, 0xa9b40001]);
		expect(result[1].position.x - result[0].position.x).toBe(
			OUTDOOR_LANDBLOCK_WORLD_SIZE,
		);
	});
	it("clusters nearby areas with complete membership and separates them on zoom", () => {
		expect(projectHousingSearchAreas(areas, view, 100, 100, 20)).toEqual([
			{ areas: [1, 2], x: 51.5, y: 51.5 },
		]);
		expect(
			projectHousingSearchAreas(
				areas,
				{ ...view, spanMeters: 2 },
				100,
				100,
				20,
			),
		).toHaveLength(1);
		expect(
			projectHousingSearchAreas(
				areas,
				{ ...view, centerX: 1.5, centerZ: 1.5, spanMeters: 2 },
				100,
				100,
				20,
			).map((point) => point.areas),
		).toEqual([[1], [2]]);
	});
	it("culls areas beyond a marker gutter and handles empty or hidden surfaces", () => {
		const offscreen = [{ cell: 3, position: { x: 100, z: 0 } }];
		expect(projectHousingSearchAreas(offscreen, view, 100, 100, 20)).toEqual(
			[],
		);
		expect(projectHousingSearchAreas([], view, 100, 100, 20)).toEqual([]);
		expect(projectHousingSearchAreas(areas, view, 0, 100, 20)).toEqual([]);
	});
	it("groups dense areas by zoom-sized world buckets and adapts to resize", () => {
		const dense = Array.from({ length: 100 }, (_, cell) => ({
			cell,
			position: { x: cell / 100, z: cell / 100 },
		}));
		expect(projectHousingSearchAreas(dense, view, 100, 100, 20)).toHaveLength(
			1,
		);
		expect(projectHousingSearchAreas(areas, view, 200, 100, 20)[0].x).toBe(103);
	});
	it("keeps membership while panning and moves the centroid by the map translation", () => {
		const before = projectHousingSearchAreas(areas, view, 100, 100, 20);
		const after = projectHousingSearchAreas(
			areas,
			{ ...view, centerX: 10, centerZ: -7 },
			100,
			100,
			20,
		);
		expect(after).toEqual([
			{ areas: before[0].areas, x: before[0].x - 10, y: before[0].y + 7 },
		]);
	});
	it("includes offscreen members in the centroid instead of regrouping at viewport edges", () => {
		const edgeAreas = [
			{ cell: 1, position: { x: 59, z: 1 } },
			{ cell: 2, position: { x: 79, z: 1 } },
		];
		expect(projectHousingSearchAreas(edgeAreas, view, 100, 100, 40)).toEqual([
			{ areas: [1, 2], x: 119, y: 51 },
		]);
		expect(
			projectHousingSearchAreas(
				edgeAreas,
				{ ...view, centerX: 10 },
				100,
				100,
				40,
			),
		).toEqual([{ areas: [1, 2], x: 109, y: 51 }]);
	});
	it("keeps negative-coordinate buckets stable under panning", () => {
		const negative = [
			{ cell: 1, position: { x: -1, z: -1 } },
			{ cell: 2, position: { x: -2, z: -2 } },
		];
		expect(
			projectHousingSearchAreas(
				negative,
				{ ...view, centerX: -5 },
				100,
				100,
				20,
			),
		).toEqual([{ areas: [1, 2], x: 53.5, y: 48.5 }]);
	});
});
