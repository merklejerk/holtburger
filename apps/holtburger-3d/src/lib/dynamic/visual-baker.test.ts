import { describe, expect, it } from "vitest";
import type {
	StaticObjectMaterialSourceFacts,
	StaticObjectSourceAssetFacts,
	StaticObjectSourceGeometryAttachment,
	StaticObjectSourceIdentity,
	StaticObjectTextureRefFacts,
	StaticResourceIdentity,
} from "../static/contracts";
import {
	bakeDynamicVisuals,
	createDynamicVisualTexturePlanning,
	LocalDynamicVisualBaker,
} from "./visual-baker";
import {
	createDynamicVisualResourceId,
	type DynamicEntityRecipe,
	type DynamicVisualBakeInput,
	type DynamicVisualMaterialPolicy,
} from "./contracts";

describe("dynamic visual baker", () => {
	it("bakes setup-backed dynamic recipes into material slots, texture requirements, and render parts", () => {
		const recipe = createRecipe({
			materialSources: [createTexturedMaterial()],
			textureRefs: createTextureRefs(),
		});
		const result = bakeDynamicVisuals({
			batchId: "dynamic-visual-batch:test",
			recipes: [recipe],
			revision: 12,
			sourceGeometry: [createGeometryAttachment()],
			texturePlacementSnapshot: createPlacementSnapshotForRecipe(recipe),
		});

		expect(result.failures).toEqual([]);
		expect(result.products).toHaveLength(1);
		const product = result.products[0];
		expect(product?.kind).toBe("baked");
		if (product?.kind !== "baked") {
			throw new Error("Expected baked product.");
		}

		expect(product.resource).toMatchObject({
			entityId: "runtime:test",
			resourceId: createDynamicVisualResourceId("runtime:test"),
		});
		expect(product.resource.materialSlots).toHaveLength(1);
		expect(product.resource.textureRequirements).toHaveLength(1);
		expect(product.resource.renderParts).toHaveLength(1);
		expect(product.resource.renderParts[0]).toMatchObject({
			indexType: "uint16",
			materialFamily: "texture-rgba",
			partIndex: 0,
			sourceAssetId: "gfx-obj/01000001",
			triangleCount: 1,
			vertexCount: 3,
		});
		expect([...(product.resource.renderParts[0]?.positions ?? [])]).toEqual([
			0, 0, 0, 1, 0, 0, 0, 1, 0,
		]);
		expect(product.resource.renderParts[0]?.textureUseIds).toEqual([
			product.resource.textureRequirements[0]?.textureUseId,
		]);
	});

	it("supports the async baker interface", async () => {
		const baker = new LocalDynamicVisualBaker();
		const input: DynamicVisualBakeInput = {
			batchId: "dynamic-visual-batch:async",
			recipes: [createRecipe({ materialSources: [createSolidMaterial()] })],
			revision: 13,
			sourceGeometry: [createGeometryAttachment()],
			texturePlacementSnapshot: createEmptyPlacementSnapshot(),
		};

		await expect(baker.bake(input)).resolves.toMatchObject({
			batchId: "dynamic-visual-batch:async",
			failures: [],
			revision: 13,
		});
	});

	it("skips recipes with resolver-owned missing dependencies", () => {
		const missingRefs: readonly StaticResourceIdentity[] = [
			{
				kind: "static-object-source",
				sourceAssetKind: "gfx-obj",
				sourceDid: 0x01000099,
			},
		];
		const result = bakeDynamicVisuals({
			batchId: "dynamic-visual-batch:missing",
			recipes: [
				createRecipe({
					materialSources: [createSolidMaterial()],
					missingRefs,
				}),
			],
			revision: 14,
			sourceGeometry: [createGeometryAttachment()],
			texturePlacementSnapshot: createEmptyPlacementSnapshot(),
		});

		expect(result.failures).toEqual([]);
		expect(result.products).toEqual([
			{
				entityId: "runtime:test",
				kind: "skipped",
				reason: {
					kind: "missing-dependencies",
					missingRefs,
				},
			},
		]);
	});

	it("reports missing source geometry as a render-part extraction failure", () => {
		const result = bakeDynamicVisuals({
			batchId: "dynamic-visual-batch:geometry",
			recipes: [createRecipe({ materialSources: [createSolidMaterial()] })],
			revision: 15,
			sourceGeometry: [],
			texturePlacementSnapshot: createEmptyPlacementSnapshot(),
		});

		expect(result.products).toEqual([]);
		expect(result.failures).toEqual([
			{
				entityId: "runtime:test",
				message:
					"Dynamic render part 0 missing source geometry static-object-canonical-geometry|gfx-obj:16777217|part:0 for source part static-object-source-geometry|setup-model:33555429|static-object-canonical-geometry|gfx-obj:16777217|part:0.",
				stage: "render-part-extraction",
			},
		]);
	});
});

function createRecipe(options: {
	readonly materialSources: readonly StaticObjectMaterialSourceFacts[];
	readonly missingRefs?: readonly StaticResourceIdentity[];
	readonly textureRefs?: readonly StaticObjectTextureRefFacts[];
}): DynamicEntityRecipe {
	const sourceAsset = createSourceAsset();
	return {
		animationSelection: { kind: "none" },
		baseTransform: {
			baseLocalPlacement: {
				orientation: { w: 1, x: 0, y: 0, z: 0 },
				origin: { x: 0, y: 0, z: 0 },
			},
			sourceScale: { x: 1, y: 1, z: 1 },
		},
		entityId: "runtime:test",
		source: {
			kind: "runtime-authored",
			runtimeEntityId: "runtime:test",
			sourceResidence: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
		},
		visual: {
			animation: null,
			materialPolicy: createMaterialPolicy(),
			materialSources: options.materialSources,
			missingRefs: options.missingRefs ?? [],
			paletteSources: [],
			setupModel: sourceAsset,
			sourceAssets: [sourceAsset],
			textureRefs: options.textureRefs ?? [],
		},
	};
}

function createPlacementSnapshotForRecipe(
	recipe: DynamicEntityRecipe,
): DynamicVisualBakeInput["texturePlacementSnapshot"] {
	const placementsByItemId = new Map(
		createDynamicVisualTexturePlanning(recipe).placementIntents.map(
			(intent, index) => [
				intent.itemId,
				{
					height: 16,
					itemId: intent.itemId,
					pageId: `${intent.purpose}:page:${index}`,
					pool: intent.pool,
					purpose: intent.purpose,
					rect: [0, 0, 16, 16] as const,
					width: 16,
				},
			],
		),
	);
	return { placementsByItemId };
}

function createEmptyPlacementSnapshot(): DynamicVisualBakeInput["texturePlacementSnapshot"] {
	return { placementsByItemId: new Map() };
}

function createSourceAsset(): StaticObjectSourceAssetFacts {
	const source = createSetupSourceIdentity();
	const gfxObj = createGfxObjSourceIdentity();
	return {
		bounds: null,
		debug: { sourceAssetId: "setup-model/020003e5" },
		defaultAnimation: null,
		identity: source,
		invalidPolygonCount: 0,
		materialSlotCount: 1,
		partCount: 1,
		parts: [
			{
				bounds: null,
				defaultPlacements: [],
				geometry: {
					canonical: {
						gfxObj,
						kind: "static-object-canonical-geometry",
						partIndex: 0,
					},
					kind: "static-object-source-geometry",
					source,
				},
				gfxObj,
				invalidPolygonCount: 0,
				materialSlotCount: 1,
				materialSlots: [
					{
						geometrySurfaceId: 7,
						material: {
							kind: "static-material-source",
							materialId: 0x08000001,
						},
						materialSurfaceId: 7,
						materialVariantSignature: null,
						paletteOverride: null,
						paletteViews: [],
						slotIndex: 0,
					},
				],
				partIndex: 0,
				physicsPolygonCount: 0,
				renderTriangleCount: 1,
				scale: { x: 1, y: 1, z: 1 },
				skippedPolygonCount: 0,
				source,
				triangles: [
					{
						firstVertex: 0,
						geometrySurfaceId: 7,
						materialVariantSignature: null,
						polygonId: 1,
					},
				],
			},
		],
		physicsPolygonCount: 0,
		renderTriangleCount: 1,
		skippedPolygonCount: 0,
		sourceAssetKind: "setup-model",
	};
}

function createGeometryAttachment(): StaticObjectSourceGeometryAttachment {
	return {
		identity: {
			gfxObj: createGfxObjSourceIdentity(),
			kind: "static-object-canonical-geometry",
			partIndex: 0,
		},
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
	};
}

function createSolidMaterial(): StaticObjectMaterialSourceFacts {
	return {
		diffuse: 1,
		identity: {
			kind: "static-material-source",
			materialId: 0x08000001,
		},
		luminosity: 0,
		source: {
			argb: 0xff336699,
			kind: "solid-color",
		},
		surfaceId: 7,
		surfaceType: 0,
		translucency: 0,
	};
}

function createTexturedMaterial(): StaticObjectMaterialSourceFacts {
	return {
		...createSolidMaterial(),
		source: {
			kind: "texture",
			palette: null,
			renderSurfaceDefaultPalettes: [],
			selectedRenderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000010,
			},
			texture: {
				kind: "surface-texture",
				surfaceTextureId: 0x05000010,
			},
		},
	};
}

function createTextureRefs(): readonly StaticObjectTextureRefFacts[] {
	return [
		{
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000010,
			},
			role: "surface-texture",
			texture: {
				kind: "surface-texture",
				surfaceTextureId: 0x05000010,
			},
		},
		{
			format: "rgba",
			formatRaw: 1,
			height: 32,
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000010,
			},
			role: "render-surface",
			width: 64,
		},
	];
}

function createMaterialPolicy(): DynamicVisualMaterialPolicy {
	return {
		detailRolePolicy: {
			kind: "runtime-authored-none",
		},
		materialPlanningDomain: "outdoor-explicit-objects",
		visualObject: {
			entityId: "runtime:test",
			kind: "dynamic-visual-object",
			resourceId: createDynamicVisualResourceId("runtime:test"),
		},
	};
}

function createSetupSourceIdentity(): StaticObjectSourceIdentity {
	return {
		kind: "static-object-source",
		sourceAssetKind: "setup-model",
		sourceDid: 0x020003e5,
	};
}

function createGfxObjSourceIdentity(): StaticObjectSourceIdentity {
	return {
		kind: "static-object-source",
		sourceAssetKind: "gfx-obj",
		sourceDid: 0x01000001,
	};
}
