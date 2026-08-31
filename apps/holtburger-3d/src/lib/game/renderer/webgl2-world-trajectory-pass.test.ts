import { describe, expect, it } from "vitest";
import { sceneVec3 } from "../../assets/ac-frame";
import { Vec3 } from "../math/types";
import type { WorldTrajectoryInput } from "./renderer";
import { buildTrajectoryGeometry } from "./webgl2-world-trajectory-pass";

function trajectory(
	placements: WorldTrajectoryInput["placements"],
): WorldTrajectoryInput {
	return {
		revision: 7,
		color: [0.08, 0.48, 1, 0.9],
		origin: sceneVec3(new Vec3(10, 2, 30)),
		velocity: [8, 9, 0],
		acceleration: [0, -9.8, 0],
		durationSeconds: 2,
		placements,
	};
}

describe("world trajectory geometry", () => {
	it("tessellates a semantic curve independently of solver ticks", () => {
		const built = buildTrajectoryGeometry(
			trajectory([
				{
					startFraction: 0,
					endFraction: 1,
					renderScopeKey: "outdoor",
				},
			]),
		);

		expect(built.ranges).toEqual([
			{ renderScopeKey: "outdoor", firstInstance: 0, instanceCount: 12 },
		]);
		expect(built.records.length).toBe(12 * 8);
		expect([...built.records.slice(0, 3)]).toEqual([10, 2, 30]);
		expect(built.records.at(-5)).toBeCloseTo(26);
		expect(built.records.at(-4)).toBeCloseTo(0.4);
		expect(built.records.at(-3)).toBeCloseTo(30);
	});

	it("splits exact placement intervals while preserving global dash distance", () => {
		const built = buildTrajectoryGeometry(
			trajectory([
				{
					startFraction: 0,
					endFraction: 0.5,
					renderScopeKey: "outdoor",
				},
				{
					startFraction: 0.5,
					endFraction: 1,
					renderScopeKey: "0xda550100",
				},
			]),
		);

		expect(built.ranges).toEqual([
			{ renderScopeKey: "outdoor", firstInstance: 0, instanceCount: 6 },
			{ renderScopeKey: "0xda550100", firstInstance: 6, instanceCount: 6 },
		]);
		const firstScopeEndDistance = built.records[6 * 8 - 1];
		const secondScopeStartDistance = built.records[6 * 8 + 6];
		expect(secondScopeStartDistance).toBeCloseTo(firstScopeEndDistance ?? -1);
	});
});
