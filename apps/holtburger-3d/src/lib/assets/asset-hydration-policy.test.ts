import { describe, expect, it } from "vitest";

import {
	classifyAssetHydration,
	isSceneCoverageAssetId,
	isStaticRenderableAssetId,
} from "./asset-hydration-policy";

describe("asset hydration policy", () => {
	it("classifies landblock packs as direct scene coverage", () => {
		const assetId = "landblock-pack/da55ffff";
		expect(isSceneCoverageAssetId(assetId)).toBe(true);
		expect(classifyAssetHydration(assetId)).toBe("direct");
	});

	it.each([
		["landblock/da55ffff/terrain"],
		["landblock/da55ffff/scene"],
		["env-cell/da550100"],
	])("classifies granular scene root %s as direct hydration", (assetId) => {
		expect(isSceneCoverageAssetId(assetId)).toBe(true);
		expect(classifyAssetHydration(assetId)).toBe("direct");
	});

	it.each([["setup-model/020005a9"], ["gfx-obj/010016dc"]])(
		"classifies static renderable asset %s as direct hydration",
		(assetId) => {
			expect(isSceneCoverageAssetId(assetId)).toBe(false);
			expect(isStaticRenderableAssetId(assetId)).toBe(true);
			expect(classifyAssetHydration(assetId)).toBe("direct");
		},
	);

	it.each([["dependency-manifest/synthetic"], ["terrain-material/1"]])(
		"classifies %s as graph hydration",
		(assetId) => {
			expect(isSceneCoverageAssetId(assetId)).toBe(false);
			expect(classifyAssetHydration(assetId)).toBe("graph");
		},
	);
});
