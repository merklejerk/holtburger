import { describe, expect, it } from "vitest";
import { Mat4, Vec3 } from "../math/types";
import {
	CELL_CONTAINMENT_EPSILON,
	cellContainsLandblockPoint,
} from "./cell-containment";

describe("CellStruct point containment", () => {
	it("matches retail's positive-chain boundary epsilon", () => {
		const planes = new Float32Array([1, 0, 0, 0]);

		expect(
			cellContainsLandblockPoint(
				planes,
				Mat4.identity(),
				new Vec3(-CELL_CONTAINMENT_EPSILON, 0, 0),
			),
		).toBe(true);
		expect(
			cellContainsLandblockPoint(
				planes,
				Mat4.identity(),
				new Vec3(-CELL_CONTAINMENT_EPSILON - 0.000_01, 0, 0),
			),
		).toBe(false);
	});

	it("converts renderer axes back to CellStruct-local AC axes", () => {
		const positiveAcY = new Float32Array([0, 1, 0, 0]);
		const positiveAcZ = new Float32Array([0, 0, 1, 0]);

		expect(
			cellContainsLandblockPoint(
				positiveAcY,
				Mat4.identity(),
				new Vec3(0, 0, -1),
			),
		).toBe(true);
		expect(
			cellContainsLandblockPoint(
				positiveAcZ,
				Mat4.identity(),
				new Vec3(0, 1, 0),
			),
		).toBe(true);
	});

	it("inverts rotated and translated EnvCell frames before containment", () => {
		const quarterTurnAndTranslation = new Mat4(
			0,
			0,
			-1,
			0,
			0,
			1,
			0,
			0,
			1,
			0,
			0,
			0,
			10,
			20,
			30,
			1,
		);
		const positiveLocalAcX = new Float32Array([1, 0, 0, 0]);

		expect(
			cellContainsLandblockPoint(
				positiveLocalAcX,
				quarterTurnAndTranslation,
				new Vec3(10, 20, 29),
			),
		).toBe(true);
		expect(
			cellContainsLandblockPoint(
				positiveLocalAcX,
				quarterTurnAndTranslation,
				new Vec3(10, 20, 31),
			),
		).toBe(false);
	});

	it("rejects non-rigid structure transforms", () => {
		const scaled = new Mat4(2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

		expect(() =>
			cellContainsLandblockPoint(new Float32Array(), scaled, Vec3.zero()),
		).toThrow("requires a rigid rotation and translation");
	});
});
