import { describe, expect, it } from "vitest";

import {
	classifyAssetHydration,
	isDirectSceneRootAssetId,
	isSetupAppearanceAssetId,
	isStaticRenderableAssetId,
} from "./asset-hydration-policy";

describe("asset hydration policy", () => {
	it.each([
		["landblock/da55ffff/outdoor"],
		["landblock/da55ffff/topology"],
		["env-cell/da550100"],
	])("classifies granular scene root %s as direct hydration", (assetId) => {
		expect(isDirectSceneRootAssetId(assetId)).toBe(true);
		expect(classifyAssetHydration(assetId)).toBe("direct");
	});

	it.each([["setup-model/020005a9"], ["gfx-obj/010016dc"]])(
		"classifies static renderable asset %s as direct hydration",
		(assetId) => {
			expect(isDirectSceneRootAssetId(assetId)).toBe(false);
			expect(isStaticRenderableAssetId(assetId)).toBe(true);
			expect(classifyAssetHydration(assetId)).toBe("direct");
		},
	);

	it("classifies only base setup appearances as direct renderable hydration", () => {
		expect(isSetupAppearanceAssetId("setup-appearance/020005a9")).toBe(true);
		expect(isStaticRenderableAssetId("setup-appearance/020005a9")).toBe(true);
		expect(classifyAssetHydration("setup-appearance/020005a9")).toBe("direct");
		expect(
			isSetupAppearanceAssetId(
				"setup-appearance/020005a9/obj-desc/tex-00-05000001-05000002",
			),
		).toBe(false);
	});

	it.each([["terrain-material/1"], ["setup-appearance/020005a9/obj-desc"]])(
		"classifies %s as graph hydration",
		(assetId) => {
			expect(isDirectSceneRootAssetId(assetId)).toBe(false);
			expect(classifyAssetHydration(assetId)).toBe("graph");
		},
	);
});
