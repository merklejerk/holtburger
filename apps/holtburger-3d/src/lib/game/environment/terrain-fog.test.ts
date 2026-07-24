import { describe, expect, it } from "vitest";
import { resolveTerrainCoverageFog } from "./terrain-fog";

const AUTHORED_FOG = {
	near: 15,
	far: 150,
	color: { red: 0.1, green: 0.2, blue: 0.3, alpha: 1 },
} as const;

describe("resolveTerrainCoverageFog", () => {
	it("uses the terrain-interest radius as a stable fog range", () => {
		const fog = resolveTerrainCoverageFog(
			AUTHORED_FOG,
			{ terrainRadius: 1 },
		);

		expect(fog).toMatchObject({ near: 28.8, far: 288 });
	});

	it("preserves a half-landblock fog range at terrain radius zero", () => {
		const fog = resolveTerrainCoverageFog(AUTHORED_FOG, {
			terrainRadius: 0,
		});

		expect(fog).toMatchObject({ far: 96 });
		expect(fog?.near).toBeCloseTo(9.6);
	});

	it("rejects invalid terrain-interest radii", () => {
		expect(() =>
			resolveTerrainCoverageFog(AUTHORED_FOG, { terrainRadius: -1 }),
		).toThrow("non-negative integer radius");
		expect(() =>
			resolveTerrainCoverageFog(AUTHORED_FOG, { terrainRadius: 1.5 }),
		).toThrow("non-negative integer radius");
	});
});
