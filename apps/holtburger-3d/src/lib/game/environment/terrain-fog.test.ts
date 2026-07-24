import { describe, expect, it } from "vitest";
import { Vec3 } from "../math/types";
import { resolveTerrainCoverageFog } from "./terrain-fog";

const AUTHORED_FOG = {
	near: 15,
	far: 150,
	color: { red: 0.1, green: 0.2, blue: 0.3, alpha: 1 },
} as const;

describe("resolveTerrainCoverageFog", () => {
	it("uses the camera's horizontal distance to the terrain-window edge", () => {
		const fog = resolveTerrainCoverageFog(
			AUTHORED_FOG,
			{ anchorLandblockId: "0x1010ffff", terrainRadius: 1 },
			new Vec3(16.5 * 192, 40, -16.5 * 192),
		);

		expect(fog).toMatchObject({ near: 28.8, far: 288 });
	});

	it("ignores camera altitude when deriving the effective fog range", () => {
		const coverage = {
			anchorLandblockId: "0x1010ffff",
			terrainRadius: 1,
		} as const;
		const atTerrainHeight = resolveTerrainCoverageFog(
			AUTHORED_FOG,
			coverage,
			new Vec3(16.5 * 192, 0, -16.5 * 192),
		);
		const highAboveTerrain = resolveTerrainCoverageFog(
			AUTHORED_FOG,
			coverage,
			new Vec3(16.5 * 192, 50_000, -16.5 * 192),
		);

		expect(highAboveTerrain).toEqual(atTerrainHeight);
	});

	it("shrinks fog to the remaining coverage when the camera approaches an edge", () => {
		const fog = resolveTerrainCoverageFog(
			AUTHORED_FOG,
			{ anchorLandblockId: "0x1010ffff", terrainRadius: 1 },
			new Vec3(18 * 192 - 12, 0, -16.5 * 192),
		);

		expect(fog?.near).toBeCloseTo(1.2);
		expect(fog?.far).toBe(12);
	});

	it("fully fogs terrain once the camera leaves the retained window", () => {
		expect(
			resolveTerrainCoverageFog(
				AUTHORED_FOG,
				{ anchorLandblockId: "0x1010ffff", terrainRadius: 0 },
				new Vec3(18 * 192, 0, -16.5 * 192),
			),
		).toMatchObject({ near: 0, far: 0 });
	});
});
