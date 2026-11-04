import { describe, expect, it } from "vitest";
import {
	createProjectionClearanceRevision,
	resolveNearPlaneHalfExtents,
	resolveProjectionClearanceRadius,
} from "./projection-clearance";

const PROJECTION = Object.freeze({ fov: 75, near: 0.5 });

describe("camera projection clearance", () => {
	it("materializes one immutable revision from the exact drawing extent", () => {
		const revision = createProjectionClearanceRevision(7, PROJECTION, {
			height: 1_080,
			width: 1_920,
		});

		expect(revision).toEqual({
			...PROJECTION,
			clearanceRadius: resolveProjectionClearanceRadius(PROJECTION, 16 / 9),
			extent: { height: 1_080, width: 1_920 },
			revision: 7,
		});
		expect(Object.isFrozen(revision)).toBe(true);
		expect(Object.isFrozen(revision.extent)).toBe(true);
	});

	it.each([
		["portrait", 9 / 16],
		["4:3", 4 / 3],
		["16:9", 16 / 9],
		["21:9", 21 / 9],
	])("contains every %s near-plane corner", (_label, aspectRatio) => {
		const half = resolveNearPlaneHalfExtents(PROJECTION, aspectRatio);
		const radius = resolveProjectionClearanceRadius(PROJECTION, aspectRatio);
		const corners = [
			[-half.width, -half.height, -PROJECTION.near],
			[half.width, -half.height, -PROJECTION.near],
			[half.width, half.height, -PROJECTION.near],
			[-half.width, half.height, -PROJECTION.near],
		] as const;

		for (const corner of corners) {
			expect(Math.hypot(...corner)).toBeCloseTo(radius, 12);
		}
	});

	it("grows monotonically with FOV and aspect and linearly with near distance", () => {
		const baseline = resolveProjectionClearanceRadius(PROJECTION, 16 / 9);
		expect(
			resolveProjectionClearanceRadius({ ...PROJECTION, fov: 90 }, 16 / 9),
		).toBeGreaterThan(baseline);
		expect(
			resolveProjectionClearanceRadius(PROJECTION, 21 / 9),
		).toBeGreaterThan(baseline);
		expect(
			resolveProjectionClearanceRadius(
				{ ...PROJECTION, near: PROJECTION.near / 5 },
				16 / 9,
			),
		).toBeCloseTo(baseline / 5, 12);
	});

	it("proves the current Explorer projection needs substantially more than axial clearance", () => {
		expect(resolveProjectionClearanceRadius(PROJECTION, 16 / 9)).toBeCloseTo(
			0.928_663,
			5,
		);
	});

	it.each([
		[{ ...PROJECTION, near: 0 }, 1],
		[{ ...PROJECTION, near: Number.NaN }, 1],
		[{ ...PROJECTION, fov: 0 }, 1],
		[{ ...PROJECTION, fov: 180 }, 1],
		[PROJECTION, 0],
		[PROJECTION, Number.POSITIVE_INFINITY],
	])("rejects invalid projection facts", (projection, aspectRatio) => {
		expect(() =>
			resolveProjectionClearanceRadius(projection, aspectRatio),
		).toThrow("projection facts");
	});

	it("rejects invalid revision and extent facts", () => {
		expect(() =>
			createProjectionClearanceRevision(0, PROJECTION, {
				height: 1,
				width: 1,
			}),
		).toThrow("projection revision");
		expect(() =>
			createProjectionClearanceRevision(1, PROJECTION, {
				height: 0,
				width: 1,
			}),
		).toThrow("extent");
	});
});
