import { describe, expect, it } from "vitest";
import { Mat4, Vec3 } from "../math/types";
import { preparePortalApertureProjectionInput } from "./portal-view-window";
import {
	NO_PORTAL_ARENA_WINDOW,
	PortalWindowArena,
	type PortalTraversalMeter,
} from "./portal-window-arena";

const PROJECTION = {
	anchorCoordinates: { x: 0, y: 0 },
	clipFromAnchor: Mat4.identity(),
};
const METER: PortalTraversalMeter = { consume: () => {} };
function arena() {
	return new PortalWindowArena(
		{
			maximumApertureVertexCount: 4,
			maximumVerticesPerFragment: 16,
			maximumWindowCount: 16,
		},
		4,
	);
}
function aperture(left: number, right: number) {
	return preparePortalApertureProjectionInput({
		landblockCoordinates: { x: 0, y: 0 },
		aperture: {
			vertices: new Float32Array([
				left,
				-0.5,
				0,
				right,
				-0.5,
				0,
				right,
				0.5,
				0,
				left,
				0.5,
				0,
			]),
			indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
			plane: { normal: new Vec3(0, 0, 1), d: 0 },
		},
	});
}
function bounds(storage: PortalWindowArena, handle: number) {
	return [
		storage.minimumNdcX(handle),
		storage.minimumNdcY(handle),
		storage.maximumNdcX(handle),
		storage.maximumNdcY(handle),
	];
}

describe("portal rectangle windows", () => {
	it("propagates gaps introduced by enclosing coverage unions", () => {
		const storage = arena();
		const root = storage.reset();
		expect(
			storage.projectAndAdmit(
				root,
				NO_PORTAL_ARENA_WINDOW,
				PROJECTION,
				aperture(-0.75, -0.25),
				false,
				0,
				0,
				METER,
			),
		).toBe(true);
		const first = storage.admittedCoverage;
		expect(
			storage.projectAndAdmit(
				root,
				first,
				PROJECTION,
				aperture(0.25, 0.75),
				false,
				1,
				0,
				METER,
			),
		).toBe(true);
		const enlarged = storage.admittedCoverage;
		expect(bounds(storage, enlarged)).toEqual([-0.75, -0.5, 0.75, 0.5]);
		expect(
			storage.projectAndAdmit(
				enlarged,
				NO_PORTAL_ARENA_WINDOW,
				PROJECTION,
				aperture(-0.125, 0.125),
				false,
				2,
				0,
				METER,
			),
		).toBe(true);
	});
	it("restores old coverage handles without recomputing view-stable aperture bounds", () => {
		const storage = arena();
		const root = storage.reset();
		const firstAperture = aperture(-0.75, -0.25);
		storage.projectAndAdmit(
			root,
			NO_PORTAL_ARENA_WINDOW,
			PROJECTION,
			firstAperture,
			false,
			0,
			0,
			METER,
		);
		const first = storage.admittedCoverage;
		const checkpoint = storage.checkpoint();
		storage.projectAndAdmit(
			root,
			first,
			PROJECTION,
			aperture(0.25, 0.75),
			false,
			1,
			0,
			METER,
		);
		const removed = storage.admittedCoverage;
		storage.rollback(checkpoint);
		expect(bounds(storage, first)).toEqual([-0.75, -0.5, -0.25, 0.5]);
		expect(() => bounds(storage, removed)).toThrow(
			"Unavailable portal rectangle",
		);
		expect(
			storage.projectAndAdmit(
				root,
				first,
				PROJECTION,
				firstAperture,
				false,
				0,
				0,
				METER,
			),
		).toBe(false);
		expect(storage.trace.projectionCacheHitCount).toBe(1);
	});
	it("recomputes cached bounds when the next view changes its projection", () => {
		const storage = arena();
		const opening = aperture(-0.5, 0.5);
		storage.projectAndAdmit(
			storage.reset(),
			NO_PORTAL_ARENA_WINDOW,
			PROJECTION,
			opening,
			false,
			0,
			0,
			METER,
		);
		expect(bounds(storage, storage.admittedCoverage)).toEqual([
			-0.5, -0.5, 0.5, 0.5,
		]);
		const shifted = Mat4.identity();
		shifted.m41 = 0.25;
		storage.projectAndAdmit(
			storage.reset(),
			NO_PORTAL_ARENA_WINDOW,
			{ ...PROJECTION, clipFromAnchor: shifted },
			opening,
			false,
			0,
			0,
			METER,
		);
		expect(bounds(storage, storage.admittedCoverage)).toEqual([
			-0.25, -0.5, 0.75, 0.5,
		]);
		expect(storage.trace.projectedApertureCount).toBe(1);
		expect(storage.trace.projectionCacheHitCount).toBe(0);
	});
	it("charges rectangle writes before committing coverage", () => {
		const storage = arena();
		const root = storage.reset();
		const meter: PortalTraversalMeter = {
			consume(kind) {
				if (kind === "rectangleWriteCount") throw new Error("budget");
			},
		};
		expect(() =>
			storage.projectAndAdmit(
				root,
				NO_PORTAL_ARENA_WINDOW,
				PROJECTION,
				aperture(-0.5, 0.5),
				false,
				0,
				0,
				meter,
			),
		).toThrow("budget");
		expect(storage.admittedCoverage).toBe(NO_PORTAL_ARENA_WINDOW);
		expect(storage.checkpoint()).toBe(1);
	});
	it("keeps the projected bounding rectangle for a diagonal thin opening", () => {
		const storage = arena();
		const opening = preparePortalApertureProjectionInput({
			landblockCoordinates: { x: 0, y: 0 },
			aperture: {
				vertices: new Float32Array([
					-0.75, -0.75, 0, 0.75, 0.75, 0, 0.75, 0.74, 0,
				]),
				indices: new Uint32Array([0, 1, 2]),
				plane: { normal: new Vec3(0, 0, -1), d: 0 },
			},
		});
		expect(
			storage.projectAndAdmit(
				storage.reset(),
				NO_PORTAL_ARENA_WINDOW,
				PROJECTION,
				opening,
				false,
				0,
				0.1,
				METER,
			),
		).toBe(true);
		expect(bounds(storage, storage.admittedCoverage)).toEqual([
			-0.75, -0.75, 0.75, 0.75,
		]);
	});
});
