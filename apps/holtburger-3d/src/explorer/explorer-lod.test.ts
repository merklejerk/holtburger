import { describe, expect, it } from "vitest";
import { FRONTEND_TUNING } from "../lib/frontend-tuning";
import {
	countExplorerLodLandblocks,
	updateExplorerLodRadius,
} from "./explorer-lod";

describe("Explorer LoD controls", () => {
	it("clamps every dependent radius when terrain coverage shrinks", () => {
		const configured = {
			buildingRadius: 4,
			envCellRadius: 6,
			explicitObjectRadius: 3,
			generatedObjectRadius: 4,
			terrainRadius: 6,
		};

		expect(updateExplorerLodRadius(configured, "terrain", 2)).toEqual({
			buildingRadius: 2,
			envCellRadius: 2,
			explicitObjectRadius: 2,
			generatedObjectRadius: 2,
			terrainRadius: 2,
		});
	});

	it("keeps detail layers beneath buildings and disables them with buildings", () => {
		let config = updateExplorerLodRadius(
			FRONTEND_TUNING.explorer.lod.defaultRadii,
			"buildings",
			2,
		);
		config = updateExplorerLodRadius(config, "explicitObjects", 8);
		config = updateExplorerLodRadius(config, "generatedObjects", 1);

		expect(config.explicitObjectRadius).toBe(2);
		expect(config.generatedObjectRadius).toBe(1);
		expect(updateExplorerLodRadius(config, "buildings", null)).toMatchObject({
			buildingRadius: null,
			explicitObjectRadius: null,
			generatedObjectRadius: null,
		});
	});

	it("reports square landblock coverage for each outdoor radius", () => {
		expect(countExplorerLodLandblocks(0)).toBe(1);
		expect(countExplorerLodLandblocks(2)).toBe(25);
	});
});
