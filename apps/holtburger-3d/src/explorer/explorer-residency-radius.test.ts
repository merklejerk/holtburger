import { describe, expect, it } from "vitest";
import { EXPLORER_TUNING } from "./explorer-tuning";
import {
	countResidentLandblocks,
	updateExplorerResidencyRadius,
} from "./explorer-residency-radius";

describe("Explorer residency-radius controls", () => {
	it("clamps every dependent radius when terrain coverage shrinks", () => {
		const configured = {
			buildingRadius: 4,
			envCellRadius: 6,
			explicitObjectRadius: 3,
			generatedObjectRadius: 4,
			terrainRadius: 6,
		};

		expect(updateExplorerResidencyRadius(configured, "terrain", 2)).toEqual({
			buildingRadius: 2,
			envCellRadius: 2,
			explicitObjectRadius: 2,
			generatedObjectRadius: 2,
			terrainRadius: 2,
		});
	});

	it("keeps detail layers beneath buildings and disables them with buildings", () => {
		let config = updateExplorerResidencyRadius(
			EXPLORER_TUNING.residency.defaultRadii,
			"buildings",
			2,
		);
		config = updateExplorerResidencyRadius(config, "explicitObjects", 8);
		config = updateExplorerResidencyRadius(config, "generatedObjects", 1);

		expect(config.explicitObjectRadius).toBe(2);
		expect(config.generatedObjectRadius).toBe(1);
		expect(
			updateExplorerResidencyRadius(config, "buildings", null),
		).toMatchObject({
			buildingRadius: null,
			explicitObjectRadius: null,
			generatedObjectRadius: null,
		});
	});

	it("reports square landblock coverage for each outdoor radius", () => {
		expect(countResidentLandblocks(0)).toBe(1);
		expect(countResidentLandblocks(2)).toBe(25);
	});
});
