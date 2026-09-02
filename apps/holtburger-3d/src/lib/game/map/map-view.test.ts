import { describe, expect, it } from "vitest";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import {
	MAP_MAXIMUM_VIEW_DIAMETER,
	MAP_MINIMUM_VIEW_DIAMETER,
} from "./map-appearance";
import { Mat4 } from "../math/types";
import {
	type MapViewParameters,
	clampMapViewDiameter,
	computeMapWorldToClip,
	mapCenterAfterCanvasDrag,
	mapHeadingFromSceneTransform,
	projectMapWorldPoint,
} from "./map-view";

function view(overrides: Partial<MapViewParameters> = {}): MapViewParameters {
	return {
		anchor: {
			headingRadians: 0,
			residency: null,
			worldX: 100,
			worldY: 0,
			worldZ: -200,
		},
		center: { worldX: 100, worldZ: -200 },
		viewDiameter: OUTDOOR_LANDBLOCK_WORLD_SIZE,
		...overrides,
	};
}

describe("computeMapWorldToClip", () => {
	it("puts north up and east right on a square canvas", () => {
		const parameters = view();
		const matrix = computeMapWorldToClip(parameters, 256, 256);
		const radius = OUTDOOR_LANDBLOCK_WORLD_SIZE / 2;

		// One radius east reaches the right clip edge; one radius north reaches the top.
		const east = projectMapWorldPoint(matrix, parameters, 100 + radius, -200);
		expect(east[0]).toBeCloseTo(1);
		expect(east[1]).toBeCloseTo(0);
		const north = projectMapWorldPoint(matrix, parameters, 100, -200 - radius);
		expect(north[0]).toBeCloseTo(0);
		expect(north[1]).toBeCloseTo(1);
	});

	it("spans the requested diameter across the smaller canvas axis", () => {
		const parameters = view();
		const wide = computeMapWorldToClip(parameters, 512, 256);
		const radius = OUTDOOR_LANDBLOCK_WORLD_SIZE / 2;

		// The short axis still shows exactly one radius; the long axis reveals more world.
		const north = projectMapWorldPoint(wide, parameters, 100, -200 - radius);
		expect(north[1]).toBeCloseTo(1);
		const east = projectMapWorldPoint(wide, parameters, 100 + radius, -200);
		expect(east[0]).toBeCloseTo(0.5);
	});

	it("projects around the viewed centre independently of the subject", () => {
		const parameters = view({ center: { worldX: 25, worldZ: 50 } });
		const matrix = computeMapWorldToClip(parameters, 256, 256);

		expect(projectMapWorldPoint(matrix, parameters, 25, 50)).toEqual([0, 0]);
		const subject = projectMapWorldPoint(matrix, parameters, 100, -200);
		expect(subject[0]).toBeCloseTo(75 / 96);
		expect(subject[1]).toBeCloseTo(250 / 96);
	});

	it("rotates the anchor's facing direction to screen up when heading-up", () => {
		// Facing east: the map turns so east is up and south is right.
		const parameters = view({
			anchor: {
				headingRadians: Math.PI / 2,
				residency: null,
				worldX: 0,
				worldY: 0,
				worldZ: 0,
			},
			center: { worldX: 0, worldZ: 0 },
		});
		const matrix = computeMapWorldToClip(parameters, 256, 256);
		const radius = OUTDOOR_LANDBLOCK_WORLD_SIZE / 2;

		const east = projectMapWorldPoint(matrix, parameters, radius, 0);
		expect(east[0]).toBeCloseTo(0);
		expect(east[1]).toBeCloseTo(1);
		const south = projectMapWorldPoint(matrix, parameters, 0, radius);
		expect(south[0]).toBeCloseTo(1);
		expect(south[1]).toBeCloseTo(0);
	});

	it("keeps a north-facing anchor north-up, so the two agree at bearing zero", () => {
		const northFacing = view({
			anchor: {
				headingRadians: 0,
				residency: null,
				worldX: 0,
				worldY: 0,
				worldZ: 0,
			},
			center: { worldX: 0, worldZ: 0 },
		});
		const matrix = computeMapWorldToClip(northFacing, 256, 256);

		// East is clip +X and north is clip +Y, exactly as a north-up map would draw it.
		expect(matrix.m00).toBeGreaterThan(0);
		expect(matrix.m01).toBeCloseTo(0);
		expect(matrix.m10).toBeCloseTo(0);
		expect(matrix.m11).toBeLessThan(0);
	});

	it("rejects a canvas with no extent to project onto", () => {
		expect(() => computeMapWorldToClip(view(), 0, 256)).toThrow(
			/positive extent/,
		);
	});
});

describe("mapCenterAfterCanvasDrag", () => {
	it("moves the viewed centre opposite a north-up paper drag", () => {
		const parameters = view({ viewDiameter: 200 });

		expect(mapCenterAfterCanvasDrag(parameters, 200, 200, 25, 40)).toEqual({
			worldX: 75,
			worldZ: -240,
		});
	});

	it("uses the subject heading without moving the subject anchor", () => {
		const parameters = view({
			anchor: {
				...view().anchor,
				headingRadians: Math.PI / 2,
			},
			viewDiameter: 200,
		});

		// With east facing up, dragging upward moves the viewed centre west.
		const center = mapCenterAfterCanvasDrag(parameters, 200, 200, 0, -50);
		expect(center.worldX).toBeCloseTo(50);
		expect(center.worldZ).toBeCloseTo(-200);
		expect(parameters.anchor.worldX).toBe(100);
	});

	it("rejects non-finite pointer displacement", () => {
		expect(() =>
			mapCenterAfterCanvasDrag(view(), 200, 200, Number.NaN, 0),
		).toThrow(/finite/);
	});
});

describe("clampMapViewDiameter", () => {
	it("holds requested zoom inside the tunable bounds", () => {
		expect(clampMapViewDiameter(MAP_MINIMUM_VIEW_DIAMETER / 4)).toBe(
			MAP_MINIMUM_VIEW_DIAMETER,
		);
		expect(clampMapViewDiameter(MAP_MAXIMUM_VIEW_DIAMETER * 4)).toBe(
			MAP_MAXIMUM_VIEW_DIAMETER,
		);
		expect(clampMapViewDiameter(OUTDOOR_LANDBLOCK_WORLD_SIZE)).toBe(
			OUTDOOR_LANDBLOCK_WORLD_SIZE,
		);
		expect(clampMapViewDiameter(Number.NaN)).toBe(MAP_MINIMUM_VIEW_DIAMETER);
	});
});

describe("mapHeadingFromSceneTransform", () => {
	/** Build a transform whose third column is the given scene-space local Z axis. */
	function withZAxis(x: number, z: number): Mat4 {
		return new Mat4(1, 0, 0, 0, 0, 1, 0, 0, x, 0, z, 0, 0, 0, 0, 1);
	}

	it("reads a north-facing entity as bearing zero", () => {
		// An entity's forward is AC +Y, which converts to scene -Z, so an identity transform faces
		// north.
		expect(mapHeadingFromSceneTransform(Mat4.identity())).toBeCloseTo(0);
		expect(mapHeadingFromSceneTransform(withZAxis(0, 1))).toBeCloseTo(0);
	});

	it("reads quarter turns as bearings clockwise from north", () => {
		// Forward is the negated third column: facing east means that column points west.
		expect(mapHeadingFromSceneTransform(withZAxis(-1, 0))).toBeCloseTo(
			Math.PI / 2,
		);
		expect(
			Math.abs(mapHeadingFromSceneTransform(withZAxis(0, -1))),
		).toBeCloseTo(Math.PI);
		expect(mapHeadingFromSceneTransform(withZAxis(1, 0))).toBeCloseTo(
			-Math.PI / 2,
		);
	});
});
