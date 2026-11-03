import { describe, expect, it } from "vitest";
import { AABB3, Mat4, Vec3 } from "../math/types";
import { selectionBoxDistanceSquared } from "./entity-selection-volume";
import type { FrustumPlane } from "../math/frustum";

const ORIGIN = Vec3.zero();
const UNIT = new AABB3(Vec3.zero(), new Vec3(1, 1, 1));
const HALF_ANGLE = Math.PI / 6;
const CONE: readonly FrustumPlane[] = [
	{ x: 1, y: 0, z: 0, constant: 0 },
	{ x: Math.sin(HALF_ANGLE), y: 0, z: Math.cos(HALF_ANGLE), constant: 0 },
	{ x: Math.sin(HALF_ANGLE), y: 0, z: -Math.cos(HALF_ANGLE), constant: 0 },
];

describe("posed box volume distance", () => {
	it("distinguishes containment, zero-thickness surfaces, lines and points", () => {
		expect(
			selectionBoxDistanceSquared(
				UNIT,
				Mat4.identity(),
				new Vec3(0.5, 0.5, 0.5),
				[],
			),
		).toBe(0);
		for (const bounds of [
			new AABB3(new Vec3(1, -1, -1), new Vec3(1, 1, 1)),
			new AABB3(new Vec3(1, 0, -1), new Vec3(1, 0, 1)),
			new AABB3(new Vec3(1, 0, 0), new Vec3(1, 0, 0)),
		])
			expect(
				selectionBoxDistanceSquared(bounds, Mat4.identity(), ORIGIN, []),
			).toBe(1);
	});
	it("measures world distances after nonuniform scale, shear, reflection and translation", () => {
		const scaled = Mat4.identity();
		scaled.m11 = 2;
		expect(
			selectionBoxDistanceSquared(UNIT, scaled, new Vec3(3, 0, 0), []),
		).toBe(1);
		const sheared = Mat4.identity();
		sheared.m21 = 1;
		expect(
			selectionBoxDistanceSquared(UNIT, sheared, new Vec3(0, 1, 0), []),
		).toBeCloseTo(0.5);
		const reflected = Mat4.identity();
		reflected.m11 = -2;
		reflected.m41 = 3;
		expect(
			selectionBoxDistanceSquared(UNIT, reflected, new Vec3(2, 0.5, 0.5), []),
		).toBe(0);
		expect(selectionBoxDistanceSquared(UNIT, reflected, ORIGIN, [])).toBe(1);
		const rotated = Mat4.identity();
		rotated.m11 = 0;
		rotated.m12 = 1;
		rotated.m21 = -1;
		rotated.m22 = 0;
		rotated.m41 = 3;
		expect(selectionBoxDistanceSquared(UNIT, rotated, ORIGIN, [])).toBe(4);
	});
	it("retains a cone intersection even when no original corner is admitted", () => {
		const box = new AABB3(new Vec3(1, -1, -2), new Vec3(2, 1, 2));
		expect(
			selectionBoxDistanceSquared(box, Mat4.identity(), ORIGIN, CONE),
		).toBeCloseTo(1);
	});
	it("measures new cap faces rather than only surviving original surfaces", () => {
		const box = new AABB3(new Vec3(-2, -2, -2), new Vec3(2, 2, 2));
		expect(
			selectionBoxDistanceSquared(box, Mat4.identity(), ORIGIN, [
				{ x: 1, y: 0, z: 0, constant: -0.5 },
			]),
		).toBeCloseTo(0.25);
	});
	it("returns empty when no single point meets all restrictions", () => {
		const box = new AABB3(new Vec3(0.1, -1, 0.9), new Vec3(0.3, 1, 1.1));
		expect(
			selectionBoxDistanceSquared(box, Mat4.identity(), ORIGIN, CONE),
		).toBeNull();
		expect(
			selectionBoxDistanceSquared(UNIT, Mat4.identity(), ORIGIN, [
				{ x: 1, y: 0, z: 0, constant: -2 },
			]),
		).toBeNull();
	});
	it("supports planar intersections, a ray-width cone and tangent points", () => {
		const box = new AABB3(new Vec3(1, 0, -2), new Vec3(2, 0, 2));
		const rayCone: FrustumPlane[] = [
			{ x: 1, y: 0, z: 0, constant: 0 },
			{ x: 0, y: 0, z: 1, constant: 0 },
			{ x: 0, y: 0, z: -1, constant: 0 },
		];
		expect(
			selectionBoxDistanceSquared(box, Mat4.identity(), ORIGIN, rayCone),
		).toBeCloseTo(1);
		expect(
			selectionBoxDistanceSquared(UNIT, Mat4.identity(), new Vec3(-1, 0, 0), [
				{ x: -1, y: 0, z: 0, constant: 0 },
			]),
		).toBe(1);
	});
	it("does not round a strict range boundary inward", () => {
		const box = new AABB3(new Vec3(2.5, -1, -1), new Vec3(3, 1, 1));
		expect(
			selectionBoxDistanceSquared(box, Mat4.identity(), ORIGIN, CONE),
		).toBe(2.5 ** 2);
	});
	it("rejects malformed bounds, nonfinite transforms and unusable restrictions", () => {
		expect(() =>
			selectionBoxDistanceSquared(
				new AABB3(new Vec3(2, 0, 0), new Vec3(1, 1, 1)),
				Mat4.identity(),
				ORIGIN,
				[],
			),
		).toThrow("ordered bounds");
		const transform = Mat4.identity();
		transform.m11 = Infinity;
		expect(() =>
			selectionBoxDistanceSquared(UNIT, transform, ORIGIN, []),
		).toThrow("finite points");
		expect(() =>
			selectionBoxDistanceSquared(UNIT, Mat4.identity(), ORIGIN, [
				{ x: 1, y: 0, z: 0, constant: NaN },
			]),
		).toThrow("finite plane coefficients");
		expect(() =>
			selectionBoxDistanceSquared(UNIT, Mat4.identity(), ORIGIN, [
				{ x: 0, y: 0, z: 0, constant: 0 },
			]),
		).toThrow("non-degenerate planes");
	});
});
