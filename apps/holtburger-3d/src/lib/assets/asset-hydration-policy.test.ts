import { describe, expect, it } from "vitest";

import {
	classifyAssetHydration,
	isSceneCoverageAssetId,
} from "./asset-hydration-policy";

describe("asset hydration policy", () => {
	it("classifies landblock packs as direct scene coverage", () => {
		const assetId = "landblock-pack/da55ffff";
		expect(isSceneCoverageAssetId(assetId)).toBe(true);
		expect(classifyAssetHydration(assetId)).toBe("direct");
	});

	it.each([
		["terrain/da55ffff"],
		["outdoor-static-scene/da55ffff"],
		["indoor-env-cell/da55012e"],
		["environment/0d000355"],
		["setup-model/020005a9"],
		["gfx-obj/010016dc"],
		["dependency-manifest/synthetic"],
	])("classifies %s as graph hydration", (assetId) => {
		expect(isSceneCoverageAssetId(assetId)).toBe(false);
		expect(classifyAssetHydration(assetId)).toBe("graph");
	});
});
