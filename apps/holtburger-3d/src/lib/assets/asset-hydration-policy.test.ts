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

	it("classifies setup appearance variants as direct renderable hydration", () => {
		const assetId =
			"setup-appearance/020005a9/obj-desc/pal-04000001/sub-04000002-10-8/tex-00-05000001-05000002/anim-01-01000003";

		expect(isSetupAppearanceAssetId(assetId)).toBe(true);
		expect(isStaticRenderableAssetId(assetId)).toBe(true);
		expect(classifyAssetHydration(assetId)).toBe("direct");
	});

	it.each([["dependency-manifest/synthetic"], ["terrain-material/1"]])(
		"classifies %s as graph hydration",
		(assetId) => {
			expect(isDirectSceneRootAssetId(assetId)).toBe(false);
			expect(classifyAssetHydration(assetId)).toBe("graph");
		},
	);
});
