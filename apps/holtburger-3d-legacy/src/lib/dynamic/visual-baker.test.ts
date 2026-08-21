import { describe, expect, it } from "vitest";
import type {
	StaticObjectMaterialSourceFacts,
	StaticObjectSourceAssetFacts,
	StaticObjectSourceGeometrySidecar,
	StaticObjectSourceIdentity,
	StaticObjectTextureRefFacts,
	StaticLayerPeerRecordOwner,
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
import { objectVisualGeometryBufferId } from "../visual/object-visual-recipe-bundle";
import { createDynamicObjectVisualRecipePlan } from "./object-visual-bundle-producer";

describe("dynamic visual baker", () => {
	it("bakes setup-backed dynamic recipes into material slots, texture requirements, and render parts", () => {
		const recipe = createRecipe({
			materialSources: [createTexturedMaterial()],
			textureRefs: createTextureRefs(),
		});
		const texturePlanning = createDynamicVisualTexturePlanning(recipe);
		const objectVisualRecipePlan = createDynamicObjectVisualRecipePlan(recipe);
		const result = bakeDynamicVisuals({
			recipe,
			revision: 12,
			sourceGeometry: [createGeometrySidecar()],
			texturePlacementSnapshot: createPlacementSnapshotForRecipe(recipe),
			texturePlanning,
		});

		expect(result.failures).toEqual([]);
		const product = result.product;
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
		expect(
			texturePlanning.textureRequirements.map((requirement) => ({
				dataUse: requirement.dataUse,
				wrapMode:
					requirement.samplingPolicy.wrapS === "repeat" ? "repeat" : "clamp",
			})),
		).toEqual(
			[...objectVisualRecipePlan.textureRecipes.values()].map(
				(textureRecipe) => ({
					dataUse: textureRecipe.dataUse,
					wrapMode: textureRecipe.wrapMode,
				}),
			),
		);
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
		expect(product.resource.renderParts[0]?.textureBindingIds).toEqual([
			product.resource.textureRequirements[0]?.bindingId,
		]);
		expect(
			product.resource.objectVisual?.geometryBuffers.has(
				objectVisualGeometryBufferId(0),
			),
		).toBe(true);
		expect(product.resource.objectVisual?.resolution.kind).toBe("ready");
		if (product.resource.objectVisual?.resolution.kind !== "ready") {
			throw new Error("Expected dynamic object visual bundle resolution.");
		}
		expect(
			product.resource.objectVisual.resolution.bundle.partInstances,
		).toMatchObject([
			{
				residency: {
					kind: "runtime-entity",
					runtimeEntityId: "runtime:test",
				},
				sourcePartIndex: 0,
			},
		]);
	});

	it("uses canonical texture identity for content-stable static-authored dynamic textures", () => {
		const first = createStaticAuthoredRecipe({
			entityId: "static-authored-outdoor:first",
			placementId: "generated:first",
		});
		const second = createStaticAuthoredRecipe({
			entityId: "static-authored-outdoor:second",
			placementId: "generated:second",
		});

		const firstPlanning = createDynamicVisualTexturePlanning(first);
		const secondPlanning = createDynamicVisualTexturePlanning(second);
		const firstRequirement = firstPlanning.textureRequirements[0];
		const secondRequirement = secondPlanning.textureRequirements[0];

		expect(firstRequirement?.textureKey).toBe(secondRequirement?.textureKey);
		expect(firstRequirement?.textureKey).toBe(
			"texture|source=src=render-surface|id=06000010|usage=rgba-color|format=rgba8|sample=rgba-color",
		);
		expect(firstRequirement?.textureKey).not.toContain("src=runtime");
		expect(firstRequirement?.ownerIds).not.toEqual(secondRequirement?.ownerIds);
		expect(firstPlanning.placementIntents[0]?.placementPolicy).toEqual({
			bucketScope: { kind: "static-domain" },
			sourceStability: { kind: "content-stable" },
		});
	});

	it("keeps runtime-authored dynamic texture identity scoped to the runtime owner", () => {
		const first = createRecipe({
			entityId: "runtime:first",
			materialSources: [createTexturedMaterial()],
			textureRefs: createTextureRefs(),
		});
		const second = createRecipe({
			entityId: "runtime:second",
			materialSources: [createTexturedMaterial()],
			textureRefs: createTextureRefs(),
		});

		const firstPlanning = createDynamicVisualTexturePlanning(first);
		const secondPlanning = createDynamicVisualTexturePlanning(second);
		const firstRequirement = firstPlanning.textureRequirements[0];
		const secondRequirement = secondPlanning.textureRequirements[0];

		expect(firstRequirement?.textureKey).not.toBe(
			secondRequirement?.textureKey,
		);
		expect(firstRequirement?.textureKey).toContain("src=runtime");
		expect(secondRequirement?.textureKey).toContain("src=runtime");
		expect(firstPlanning.placementIntents[0]?.placementPolicy).toEqual({
			bucketScope: {
				kind: "runtime-owner",
				ownerId: "runtime:first",
			},
			sourceStability: {
				kind: "owner-specific",
				reason: "runtime-customized",
			},
		});
	});

	it("supports the async baker interface", async () => {
		const baker = new LocalDynamicVisualBaker();
		const recipe = createRecipe({ materialSources: [createSolidMaterial()] });
		const input: DynamicVisualBakeInput = {
			recipe,
			revision: 13,
			sourceGeometry: [createGeometrySidecar()],
			texturePlacementSnapshot: createEmptyPlacementSnapshot(),
			texturePlanning: createDynamicVisualTexturePlanning(recipe),
		};

		await expect(baker.bake(input)).resolves.toMatchObject({
			failures: [],
			revision: 13,
		});
	});

	it("projects shared object visual render parts while preserving source partIndex", () => {
		const sourceAsset = createSourceAsset({ surfaceIds: [7, 8] });
		const recipe = createRecipe({
			materialSources: [
				createTexturedMaterial({
					materialId: 0x08000001,
					renderSurfaceId: 0x06000010,
					surfaceId: 7,
					surfaceTextureId: 0x05000010,
				}),
				createTexturedMaterial({
					materialId: 0x08000002,
					renderSurfaceId: 0x06000011,
					surfaceId: 8,
					surfaceTextureId: 0x05000011,
				}),
			],
			sourceAsset,
			textureRefs: createTextureRefs([0x06000010, 0x06000011]),
		});
		const placementSnapshot = createPlacementSnapshotForRecipe(recipe, {
			textureRefIdsByItemIndex: ["texture-ref-a", "texture-ref-b"],
		});

		const result = bakeDynamicVisuals({
			recipe,
			revision: 16,
			sourceGeometry: [createGeometrySidecar({ surfaceIds: [7, 8] })],
			texturePlacementSnapshot: placementSnapshot,
			texturePlanning: createDynamicVisualTexturePlanning(recipe),
		});

		expect(result.failures).toEqual([]);
		const product = result.product;
		expect(product?.kind).toBe("baked");
		if (product?.kind !== "baked") {
			throw new Error("Expected baked product.");
		}
		expect(product.resource.renderParts).toHaveLength(2);
		expect(
			product.resource.renderParts.map((part) => ({
				partIndex: part.partIndex,
				renderPartId: part.renderPartId,
				textureBindingIds: part.textureBindingIds,
			})),
		).toEqual([
			{
				partIndex: 0,
				renderPartId: "dynamic-visual-resource:runtime:test:render-part:0",
				textureBindingIds: [product.resource.textureRequirements[0]?.bindingId],
			},
			{
				partIndex: 0,
				renderPartId: "dynamic-visual-resource:runtime:test:render-part:1",
				textureBindingIds: [product.resource.textureRequirements[1]?.bindingId],
			},
		]);
	});

	it("skips recipes with resolver-owned missing dependencies", () => {
		const missingRefs: readonly StaticResourceIdentity[] = [
			{
				kind: "static-object-source",
				sourceAssetKind: "gfx-obj",
				sourceDid: 0x01000099,
			},
		];
		const recipe = createRecipe({
			materialSources: [createSolidMaterial()],
			missingRefs,
		});
		const result = bakeDynamicVisuals({
			recipe,
			revision: 14,
			sourceGeometry: [createGeometrySidecar()],
			texturePlacementSnapshot: createEmptyPlacementSnapshot(),
			texturePlanning: createDynamicVisualTexturePlanning(recipe),
		});

		expect(result.failures).toEqual([]);
		expect(result.product).toEqual({
			entityId: "runtime:test",
			kind: "skipped",
			reason: {
				kind: "missing-dependencies",
				missingRefs,
			},
		});
	});

	it("reports missing source geometry as a render-part extraction failure", () => {
		const recipe = createRecipe({ materialSources: [createSolidMaterial()] });
		const result = bakeDynamicVisuals({
			recipe,
			revision: 15,
			sourceGeometry: [],
			texturePlacementSnapshot: createEmptyPlacementSnapshot(),
			texturePlanning: createDynamicVisualTexturePlanning(recipe),
		});

		expect(result.product).toBeNull();
		expect(result.failures).toEqual([
			{
				entityId: "runtime:test",
				message:
					"Dynamic object visual bundle missing dependencies: static-object-source-geometry:static-object-canonical-geometry|gfx-obj:16777217|part:0",
				stage: "render-part-extraction",
			},
		]);
	});
});

function createRecipe(options: {
	readonly entityId?: string;
	readonly materialSources: readonly StaticObjectMaterialSourceFacts[];
	readonly materialPolicy?: DynamicVisualMaterialPolicy;
	readonly missingRefs?: readonly StaticResourceIdentity[];
	readonly source?: DynamicEntityRecipe["source"];
	readonly sourceAsset?: StaticObjectSourceAssetFacts;
	readonly textureRefs?: readonly StaticObjectTextureRefFacts[];
}): DynamicEntityRecipe {
	const entityId = options.entityId ?? "runtime:test";
	const sourceAsset = options.sourceAsset ?? createSourceAsset();
	return {
		animationSelection: { kind: "none" },
		baseTransform: {
			baseLocalPlacement: {
				orientation: { w: 1, x: 0, y: 0, z: 0 },
				origin: { x: 0, y: 0, z: 0 },
			},
			sourceScale: { x: 1, y: 1, z: 1 },
		},
		entityId,
		source: options.source ?? {
			kind: "runtime-authored",
			runtimeEntityId: entityId,
			sourceResidence: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
		},
		visual: {
			animation: null,
			materialPolicy: options.materialPolicy ?? createMaterialPolicy(entityId),
			materialSources: options.materialSources,
			missingRefs: options.missingRefs ?? [],
			paletteSources: [],
			setupModel: sourceAsset,
			sourceAssets: [sourceAsset],
			textureRefs: options.textureRefs ?? [],
		},
	};
}

function createStaticAuthoredRecipe(options: {
	readonly entityId: string;
	readonly placementId: string;
}): DynamicEntityRecipe {
	const owner: StaticLayerPeerRecordOwner = {
		domain: "outdoor-generated-scenery",
		key: {
			kind: "outdoor-generated-scenery",
			landblockId: 0xda55ffff,
		},
		kind: "layer-owner",
		ownerId: "outdoor-generated-scenery:0xda55ffff",
	};
	return createRecipe({
		entityId: options.entityId,
		materialPolicy: createMaterialPolicy(
			options.entityId,
			"outdoor-generated-scenery",
			{
				domain: "outdoor-generated-scenery",
				kind: "static-domain",
			},
		),
		materialSources: [createTexturedMaterial()],
		source: {
			kind: "static-authored",
			owner,
			placementId: options.placementId,
			sourceResidence: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
		},
		textureRefs: createTextureRefs(),
	});
}

function createPlacementSnapshotForRecipe(
	recipe: DynamicEntityRecipe,
	options: {
		readonly textureRefIdsByItemIndex?: readonly string[];
	} = {},
): DynamicVisualBakeInput["texturePlacementSnapshot"] {
	const intents = createDynamicVisualTexturePlanning(recipe).placementIntents;
	const placementsByItemId = new Map(
		intents.map((intent, index) => [
			intent.itemId,
			{
				height: 16,
				itemId: intent.itemId,
				ownerIds: intent.ownerIds,
				pageId: `${intent.purpose}:page:${index}`,
				pageClass: intent.pageClass,
				purpose: intent.purpose,
				rect: [0, 0, 16, 16] as const,
				textureKey: intent.textureKey,
				textureRefId:
					options.textureRefIdsByItemIndex?.[index] ??
					`${intent.purpose}:texture-ref:${index}`,
				width: 16,
			},
		]),
	);
	return {
		itemIdsByBindingId: new Map(
			intents.map((intent) => [intent.bindingId, intent.itemId]),
		),
		placementsByBindingId: new Map(
			intents.map((intent) => [
				intent.bindingId,
				{
					bindingId: intent.bindingId,
					placement: placementsByItemId.get(intent.itemId)!,
				},
			]),
		),
		placementsByItemId,
	};
}

function createEmptyPlacementSnapshot(): DynamicVisualBakeInput["texturePlacementSnapshot"] {
	return {
		itemIdsByBindingId: new Map(),
		placementsByBindingId: new Map(),
		placementsByItemId: new Map(),
	};
}

function createSourceAsset(
	options: {
		readonly surfaceIds?: readonly number[];
	} = {},
): StaticObjectSourceAssetFacts {
	const source = createSetupSourceIdentity();
	const gfxObj = createGfxObjSourceIdentity();
	const surfaceIds = options.surfaceIds ?? [7];
	return {
		bounds: null,
		debug: { sourceAssetId: "setup-model/020003e5" },
		defaultAnimation: null,
		identity: source,
		invalidPolygonCount: 0,
		materialSlotCount: surfaceIds.length,
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
				materialSlotCount: surfaceIds.length,
				materialSlots: surfaceIds.map((surfaceId, index) => ({
					geometrySurfaceId: surfaceId,
					material: {
						kind: "static-material-source",
						materialId: 0x08000001 + index,
					},
					materialSurfaceId: surfaceId,
					materialVariantSignature: null,
					paletteOverride: null,
					paletteViews: [],
					slotIndex: index,
				})),
				partIndex: 0,
				physicsPolygonCount: 0,
				renderTriangleCount: surfaceIds.length,
				scale: { x: 1, y: 1, z: 1 },
				skippedPolygonCount: 0,
				source,
				triangles: surfaceIds.map((surfaceId, index) => ({
					firstVertex: index * 3,
					geometrySurfaceId: surfaceId,
					materialVariantSignature: null,
					polygonId: index + 1,
				})),
			},
		],
		physicsPolygonCount: 0,
		renderTriangleCount: surfaceIds.length,
		skippedPolygonCount: 0,
		sourceAssetKind: "setup-model",
	};
}

function createGeometrySidecar(
	options: {
		readonly surfaceIds?: readonly number[];
		readonly triangleCount?: number;
	} = {},
): StaticObjectSourceGeometrySidecar {
	const triangleCount =
		options.surfaceIds?.length ?? options.triangleCount ?? 1;
	const positions = new Float32Array(triangleCount * 9);
	const texCoords = new Float32Array(triangleCount * 6);
	for (let triangle = 0; triangle < triangleCount; triangle += 1) {
		const positionOffset = triangle * 9;
		positions.set([0, 0, 0, 1, 0, 0, 0, 1, 0], positionOffset);
		const texCoordOffset = triangle * 6;
		texCoords.set([0, 0, 1, 0, 0, 1], texCoordOffset);
	}
	return {
		buffer: {
			bounds: null,
			bufferId: objectVisualGeometryBufferId(0),
			coordinateSpace: "source-local",
			normals: new Float32Array(triangleCount * 9),
			positions,
			texCoords,
			triangleCount,
			triangles: Array.from({ length: triangleCount }, (_, triangle) => ({
				firstVertex: triangle * 3,
				materialVariantSignature: null,
				polygonId: triangle,
				surfaceId: options.surfaceIds?.[triangle] ?? 7,
			})),
			vertexCount: triangleCount * 3,
		},
		identity: {
			gfxObj: createGfxObjSourceIdentity(),
			kind: "static-object-canonical-geometry",
			partIndex: 0,
		},
	};
}

function createSolidMaterial(
	options: {
		readonly materialId?: number;
		readonly surfaceId?: number;
	} = {},
): StaticObjectMaterialSourceFacts {
	const surfaceId = options.surfaceId ?? 7;
	return {
		diffuse: 1,
		identity: {
			kind: "static-material-source",
			materialId: options.materialId ?? 0x08000001,
		},
		luminosity: 0,
		source: {
			argb: 0xff336699,
			kind: "solid-color",
		},
		surfaceId,
		surfaceType: 0,
		translucency: 0,
	};
}

function createTexturedMaterial(
	options: {
		readonly materialId?: number;
		readonly renderSurfaceId?: number;
		readonly surfaceId?: number;
		readonly surfaceTextureId?: number;
	} = {},
): StaticObjectMaterialSourceFacts {
	return {
		...createSolidMaterial({
			materialId: options.materialId,
			surfaceId: options.surfaceId,
		}),
		source: {
			kind: "texture",
			palette: null,
			renderSurfaceDefaultPalettes: [],
			selectedRenderSurface: {
				kind: "render-surface",
				renderSurfaceId: options.renderSurfaceId ?? 0x06000010,
			},
			texture: {
				kind: "surface-texture",
				surfaceTextureId: options.surfaceTextureId ?? 0x05000010,
			},
		},
	};
}

function createTextureRefs(
	renderSurfaceIds: readonly number[] = [0x06000010],
): readonly StaticObjectTextureRefFacts[] {
	return renderSurfaceIds.flatMap((renderSurfaceId, index) => [
		{
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId,
			},
			role: "surface-texture",
			texture: {
				kind: "surface-texture",
				surfaceTextureId: 0x05000010 + index,
			},
		},
		{
			format: "rgba",
			formatRaw: 1,
			height: 32,
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId,
			},
			role: "render-surface",
			width: 64,
		},
	]);
}

function createMaterialPolicy(
	entityId = "runtime:test",
	materialPlanningDomain: DynamicVisualMaterialPolicy["materialPlanningDomain"] = "outdoor-explicit-objects",
	detailRolePolicy: DynamicVisualMaterialPolicy["detailRolePolicy"] = {
		kind: "runtime-authored-none",
	},
): DynamicVisualMaterialPolicy {
	return {
		detailRolePolicy,
		materialPlanningDomain,
		visualObject: {
			entityId,
			kind: "dynamic-visual-object",
			resourceId: createDynamicVisualResourceId(entityId),
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
