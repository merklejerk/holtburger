import { describe, expect, it } from "vitest";

import {
	deriveStaticRenderableBatchBvhBinding,
	deriveStaticRenderablePartBvhItemKey,
	staticRenderableBatchId,
} from "./static-renderable-bvh-bindings";
import { createBaseMaterialAppearanceContext } from "./material-appearance";
import { WORLD_RENDER_DOMAIN } from "./render-domains";
import type { StaticRenderablePart } from "./static-renderables";

describe("static renderable BVH bindings", () => {
	it("maps outdoor static parts to source-landblock scoped item keys", () => {
		const part = staticPart({
			kind: "generated-scenery",
			instanceId: "generated/7",
			owningLandblockId: 0x0203ffff,
			owningEnvCellId: null,
		});

		expect(deriveStaticRenderablePartBvhItemKey(part)).toBe(
			"outdoor-static:landblock:0203ffff:instance:generated/7",
		);
	});

	it("maps indoor static parts to env-cell scoped item keys", () => {
		const part = staticPart({
			kind: "indoor-static",
			instanceId: "chair",
			owningEnvCellId: 0x02030100,
		});

		expect(deriveStaticRenderablePartBvhItemKey(part)).toBe(
			"env-static:cell:02030100:instance:chair",
		);
	});

	it("deduplicates item keys for a static render batch", () => {
		const binding = deriveStaticRenderableBatchBvhBinding("group/a", [
			staticPart({ instanceId: "tree" }),
			staticPart({ instanceId: "tree" }),
			staticPart({ instanceId: "rock" }),
		]);

		expect(binding).toEqual({
			batchId: "static-renderable:group/a",
			itemKeys: [
				"outdoor-static:landblock:0203ffff:instance:tree",
				"outdoor-static:landblock:0203ffff:instance:rock",
			],
			fallbackReason: null,
		});
	});

	it("marks a batch as fallback when any part cannot be keyed", () => {
		const binding = deriveStaticRenderableBatchBvhBinding("group/indoor", [
			staticPart({
				kind: "indoor-static",
				instanceId: "chair",
				owningEnvCellId: null,
			}),
		]);

		expect(binding.itemKeys).toEqual([]);
		expect(binding.fallbackReason).toBe(
			"static render batch group/indoor contains an unkeyed indoor-static part",
		);
	});

	it("formats stable static render batch ids", () => {
		expect(staticRenderableBatchId("group/a")).toBe("static-renderable:group/a");
	});
});

function staticPart(
	overrides: Partial<StaticRenderablePart> = {},
): StaticRenderablePart {
	return {
		renderKey: "part/a",
		renderDomain: WORLD_RENDER_DOMAIN.exteriorStatic,
		instanceId: "tree",
		sourceAssetId: "landblock/0203ffff/outdoor",
		sourceDid: 1,
		owningLandblockId: 0x0203ffff,
		regionNumber: 1,
		owningEnvCellId: null,
		renderChunk: {
			chunkKey: "landblock/0203ffff",
			chunkLandblockId: 0x0203ffff,
		},
		kind: "scenery",
		partIndex: 0,
		gfxObjId: 1,
		gfxObjAssetId: "gfx/1",
		materialAppearanceContext: createBaseMaterialAppearanceContext("base"),
		materialSlots: [],
		materialSignature: "material",
		parentPlacements: [],
		chunkLocalInstancePlacement: {
			position: { x: 0, y: 0, z: 0 },
			rotation: { w: 1, x: 0, y: 0, z: 0 },
		},
		partPlacements: [],
		scale: { x: 1, y: 1, z: 1 },
		debugColorKey: "debug",
		textureVelocity: null,
		textureVelocitySignature: "none",
		detailRoleKind: "object",
		detailSignature: "base",
		...overrides,
	};
}
