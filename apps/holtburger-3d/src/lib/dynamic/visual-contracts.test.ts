import { describe, expect, it } from "vitest";
import type { StaticLayerPeerRecordOwner } from "../static/contracts";
import {
	createDynamicVisualResourceId,
	type BakedDynamicVisualResource,
	type DynamicEntityRecipe,
	type DynamicEntityTransformState,
	type DynamicVisualBakeInput,
	type DynamicVisualBakeResult,
	type DynamicVisualMaterialPolicy,
	type DynamicVisualRecipe,
} from "./contracts";
import {
	createRuntimeAuthoredDynamicTexturePlacementBucketKey,
	createStaticAuthoredDynamicTexturePlacementBucketKey,
} from "../textures/placement";

describe("dynamic visual contracts", () => {
	it("keeps static-authored and runtime-authored recipes isomorphic at the visual boundary", () => {
		const visual = createVisualRecipe("dynamic-visual-resource:shared");
		const staticRecipe = createStaticAuthoredRecipe(visual);
		const runtimeRecipe = createRuntimeAuthoredRecipe(visual);

		expect(staticRecipe.source.kind).toBe("static-authored");
		expect(runtimeRecipe.source.kind).toBe("runtime-authored");
		expect(Object.keys(staticRecipe.visual).sort()).toEqual(
			Object.keys(runtimeRecipe.visual).sort(),
		);
		expect(staticRecipe.visual).toBe(runtimeRecipe.visual);
	});

	it("uses dynamic-owned texture placement bucket identities", () => {
		expect(
			createStaticAuthoredDynamicTexturePlacementBucketKey({
				domain: "outdoor-buildings",
				ownerId: "outdoor-buildings:0xda55ffff",
				purpose: "object-base-color",
			}),
		).toBe(
			"texture-placement-bucket|outdoor-buildings|object-base-color|static-authored-dynamic:outdoor-buildings:0xda55ffff",
		);
		expect(
			createRuntimeAuthoredDynamicTexturePlacementBucketKey({
				entityId: "runtime-dynamic:1",
				purpose: "object-base-color",
			}),
		).toBe(
			"texture-placement-bucket|runtime-object-material|object-base-color|runtime-authored-dynamic:runtime-dynamic:1",
		);
	});

	it("models visual bake output as baked resources or entity-local skips", () => {
		const recipe = createRuntimeAuthoredRecipe(
			createVisualRecipe("dynamic-visual-resource:shared"),
		);
		const input: DynamicVisualBakeInput = {
			recipe,
			revision: 1,
			sourceGeometry: [],
			texturePlacementSnapshot: {
				itemIdsByTextureUseId: new Map(),
				placementsByItemId: new Map(),
			},
			texturePlanning: {
				entityId: recipe.entityId,
				materialPlan: null,
				placementIntents: [],
				textureRequirements: [],
			},
		};
		const baked: BakedDynamicVisualResource = {
			entityId: "runtime-dynamic:1",
			materialSlots: [],
			materialSources: [],
			paletteSources: [],
			renderParts: [],
			resourceId: createDynamicVisualResourceId("runtime-dynamic:1"),
			sourceAssets: [],
			textureDependencies: [],
			textureRefs: [],
			textureRequirements: [],
		};
		const result: DynamicVisualBakeResult = {
			failures: [],
			product: {
				kind: "baked",
				resource: baked,
			},
			revision: 1,
		};

		const skipped: DynamicVisualBakeResult = {
			failures: [],
			product: {
				entityId: "runtime-dynamic:2",
				kind: "skipped",
				reason: {
					kind: "missing-dependencies",
					missingRefs: [],
				},
			},
			revision: 1,
		};

		expect(input.sourceGeometry).toEqual([]);
		expect(result.product?.kind).toBe("baked");
		expect(skipped.product?.kind).toBe("skipped");
	});
});

function createStaticAuthoredRecipe(
	visual: DynamicVisualRecipe,
): DynamicEntityRecipe {
	const owner: StaticLayerPeerRecordOwner = {
		domain: "outdoor-buildings",
		key: {
			kind: "outdoor-buildings",
			landblockId: 0xda55ffff,
		},
		kind: "layer-owner",
		ownerId: "outdoor-buildings:0xda55ffff",
	};
	return {
		animationSelection: {
			kind: "setup-default",
		},
		baseTransform: createTransform(),
		entityId: "static-authored-outdoor:test",
		source: {
			kind: "static-authored",
			owner,
			placementId: "outdoor:windmill-0",
			sourceResidence: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
		},
		visual,
	};
}

function createRuntimeAuthoredRecipe(
	visual: DynamicVisualRecipe,
): DynamicEntityRecipe {
	return {
		animationSelection: {
			kind: "setup-default",
		},
		baseTransform: createTransform(),
		entityId: "runtime-dynamic:1",
		source: {
			kind: "runtime-authored",
			runtimeEntityId: "runtime-dynamic:1",
			sourceResidence: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
		},
		visual,
	};
}

function createVisualRecipe(resourceId: string): DynamicVisualRecipe {
	return {
		animation: null,
		materialPolicy: createMaterialPolicy(resourceId),
		materialSources: [],
		missingRefs: [],
		paletteSources: [],
		setupModel: createSetupModelFacts(),
		sourceAssets: [createSetupModelFacts()],
		textureRefs: [],
	};
}

function createMaterialPolicy(resourceId: string): DynamicVisualMaterialPolicy {
	return {
		detailRolePolicy: {
			domain: "outdoor-buildings",
			kind: "static-domain",
		},
		materialPlanningDomain: "outdoor-buildings",
		visualObject: {
			entityId: "dynamic-entity:test",
			kind: "dynamic-visual-object",
			resourceId,
		},
	};
}

function createSetupModelFacts(): DynamicVisualRecipe["setupModel"] {
	return {
		bounds: null,
		debug: {
			sourceAssetId: "setup:020003e5",
		},
		defaultAnimation: 0x0300061b,
		identity: {
			kind: "static-object-source",
			sourceAssetKind: "setup-model",
			sourceDid: 0x020003e5,
		},
		invalidPolygonCount: 0,
		materialSlotCount: 0,
		partCount: 0,
		parts: [],
		physicsPolygonCount: 0,
		renderTriangleCount: 0,
		skippedPolygonCount: 0,
		sourceAssetKind: "setup-model",
	};
}

function createTransform(): DynamicEntityTransformState {
	return {
		baseLocalPlacement: {
			orientation: {
				w: 1,
				x: 0,
				y: 0,
				z: 0,
			},
			origin: {
				x: 0,
				y: 0,
				z: 0,
			},
		},
		sourceScale: {
			x: 1,
			y: 1,
			z: 1,
		},
	};
}
