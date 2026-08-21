import { describe, expect, it } from "vitest";
import { FRONTEND_TUNING } from "../../frontend-tuning";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import {
	resolveTerrainCoverageFog,
	farTerrainCutoffLandblocks,
} from "./terrain-fog";

const AUTHORED_FOG = {
	near: 15,
	far: 150,
	color: { red: 0.1, green: 0.2, blue: 0.3, alpha: 1 },
} as const;

describe("resolveTerrainCoverageFog", () => {
	it("uses the terrain-interest radius as a stable fog range", () => {
		const fog = resolveTerrainCoverageFog(AUTHORED_FOG, { terrainRadius: 1 });

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

describe("farTerrainCutoffLandblocks", () => {
	it("converts the configured fog coverage into a whole landblock ring", () => {
		const fog = resolveTerrainCoverageFog(AUTHORED_FOG, { terrainRadius: 8 });
		if (fog === null) throw new Error("Coverage fog must resolve.");
		const coverage = FRONTEND_TUNING.rendering.farTerrainFogCoverage;

		expect(farTerrainCutoffLandblocks(fog)).toBe(
			Math.ceil(
				(fog.near + (fog.far - fog.near) * coverage) /
					OUTDOOR_LANDBLOCK_WORLD_SIZE,
			),
		);
	});

	it("keeps the ring inside the residency window it was derived from", () => {
		for (const terrainRadius of [0, 1, 2, 4, 8]) {
			const fog = resolveTerrainCoverageFog(AUTHORED_FOG, { terrainRadius });
			if (fog === null) throw new Error("Coverage fog must resolve.");
			expect(farTerrainCutoffLandblocks(fog)).toBeLessThanOrEqual(
				terrainRadius + 1,
			);
		}
	});

	it("grows the ring as the residency window grows", () => {
		const nearRing = farTerrainCutoffLandblocks(
			resolveTerrainCoverageFog(AUTHORED_FOG, { terrainRadius: 2 }),
		);
		const farRing = farTerrainCutoffLandblocks(
			resolveTerrainCoverageFog(AUTHORED_FOG, { terrainRadius: 8 }),
		);
		if (nearRing === null || farRing === null) {
			throw new Error("Coverage fog must resolve a ring.");
		}

		expect(nearRing).toBeLessThan(farRing);
	});

	it("never renders terrain flat when fog is disabled", () => {
		expect(farTerrainCutoffLandblocks(null)).toBeNull();
	});
});
