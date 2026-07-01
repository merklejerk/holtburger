import { describe, expect, it, vi } from "vitest";

import {
	objectVisualGeometryBufferId,
	type ObjectVisualGeometryBuffer,
	type ObjectVisualGeometryRecipeId,
	type ObjectVisualMaterialRecipe,
	type ObjectVisualMaterialRecipeBase,
	type ObjectVisualMaterialRecipeId,
	type ObjectVisualPartMaterialBinding,
	type ObjectVisualPartRecipeId,
	type ObjectVisualRecipeBundle,
	type ObjectVisualTextureRecipeId,
} from "./object-visual-recipe-bundle";
import { bakeObjectVisuals } from "./object-visual-baker";

const IDENTITY_TRANSFORM = [
	1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
] as const;

describe("object visual baker", () => {
	it("batches static-like direct-color bundle primitives into shared visual payloads", () => {
		const materialOneId = materialRecipeId(1);
		const materialTwoId = materialRecipeId(2);
		const bundle = createBundle({
			materialBindings: [
				{
					geometrySurfaceId: 10,
					materialRecipeId: materialOneId,
					materialSlot: 0,
				},
				{
					geometrySurfaceId: 20,
					materialRecipeId: materialTwoId,
					materialSlot: 1,
				},
			],
			materialRecipes: new Map([
				[materialOneId, createDirectColorMaterialRecipe([1, 0, 0, 1])],
				[materialTwoId, createDirectColorMaterialRecipe([0, 1, 0, 1])],
			]),
			sourcePartIndex: null,
		});

		const result = bakeObjectVisuals({
			bundle,
			geometryBuffers: new Map([[TEST_BUFFER.bufferId, TEST_BUFFER]]),
			renderPartIdPrefix: "static-fixture",
		});

		expect(result.renderParts).toHaveLength(1);
		expect(result.renderParts[0]?.materialFamily).toBe("flat-color");
		expect(result.renderParts[0]?.materialEntries).toHaveLength(2);
		expect(result.renderParts[0]?.triangleCount).toBe(2);
		expect([...result.renderParts[0]!.materialSlotIndices]).toEqual([
			0, 0, 0, 1, 1, 1,
		]);
		expect(result.animationPartBindings).toEqual([]);
	});

	it("uses recipe-owned material table facts instead of pass-derived defaults", () => {
		const materialId = materialRecipeId(1);
		const bundle = createBundle({
			materialBindings: [
				{
					geometrySurfaceId: 10,
					materialRecipeId: materialId,
					materialSlot: 0,
				},
			],
			materialRecipes: new Map([
				[
					materialId,
					createDirectColorMaterialRecipe([0.25, 0.5, 0.75, 0.5], {
						alphaTest: 0.625,
						detailTextureTiling: 3,
						indexedClipThreshold: 7,
						materialEmissiveColor: [0.1, 0.2, 0.3],
						primaryTextureWrapMode: "clamp",
						renderState: createTransparentRenderState(),
					}),
				],
			]),
			sourcePartIndex: null,
		});

		const result = bakeObjectVisuals({
			bundle,
			geometryBuffers: new Map([[TEST_BUFFER.bufferId, TEST_BUFFER]]),
			renderPartIdPrefix: "material-facts-fixture",
		});

		expect(result.renderParts).toHaveLength(1);
		expect(result.renderParts[0]?.renderState).toEqual(
			createTransparentRenderState(),
		);
		expect(result.renderParts[0]?.materialEntries[0]).toMatchObject({
			alphaTest: 0.625,
			detailTextureTiling: 3,
			indexedClipThreshold: 7,
			materialColor: [0.25, 0.5, 0.75, 0.5],
			materialEmissiveColor: [0.1, 0.2, 0.3],
			primaryTextureWrapMode: "clamp",
		});
	});

	it("separates render parts by recipe texture role schema", () => {
		const materialOneId = materialRecipeId(1);
		const materialTwoId = materialRecipeId(2);
		const bundle = createBundle({
			materialBindings: [
				{
					geometrySurfaceId: 10,
					materialRecipeId: materialOneId,
					materialSlot: 0,
				},
				{
					geometrySurfaceId: 20,
					materialRecipeId: materialTwoId,
					materialSlot: 0,
				},
			],
			materialRecipes: new Map([
				[
					materialOneId,
					createDirectColorMaterialRecipe([1, 0, 0, 1], {
						textureRoleLayoutKey: "base-color:layout:a",
						textureRoleSchemaKey: "base-color:schema:a",
					}),
				],
				[
					materialTwoId,
					createDirectColorMaterialRecipe([0, 1, 0, 1], {
						textureRoleLayoutKey: "base-color:layout:b",
						textureRoleSchemaKey: "base-color:schema:b",
					}),
				],
			]),
			sourcePartIndex: null,
		});

		const result = bakeObjectVisuals({
			bundle,
			geometryBuffers: new Map([[TEST_BUFFER.bufferId, TEST_BUFFER]]),
			renderPartIdPrefix: "role-schema-fixture",
		});

		expect(result.renderParts).toHaveLength(2);
		expect(result.renderParts.map((part) => part.triangleCount)).toEqual([
			1, 1,
		]);
	});

	it("maps indexed and rgba texture recipe roles into material table entries", () => {
		const indexedMaterialId = materialRecipeId(1);
		const rgbaMaterialId = materialRecipeId(2);
		const indexTextureRecipeId = textureRecipeId(1);
		const paletteTextureRecipeId = textureRecipeId(2);
		const rgbaTextureRecipeId = textureRecipeId(3);
		const detailTextureRecipeId = textureRecipeId(4);
		const bundle = createBundle({
			materialBindings: [
				{
					geometrySurfaceId: 10,
					materialRecipeId: indexedMaterialId,
					materialSlot: 0,
				},
				{
					geometrySurfaceId: 20,
					materialRecipeId: rgbaMaterialId,
					materialSlot: 0,
				},
			],
			materialRecipes: new Map([
				[
					indexedMaterialId,
					{
						...createMaterialRecipeBase({
							indexedClipThreshold: 8,
							materialColor: [0.9, 0.9, 0.9, 1],
							paletteFirstIndex: 32,
						}),
						colorTextureRecipeId: indexTextureRecipeId,
						family: "indexed-color",
						indexedTextureFormat: "index16",
						paletteTextureRecipeId,
					},
				],
				[
					rgbaMaterialId,
					{
						...createMaterialRecipeBase({
							detailTextureTiling: 5,
							primaryTextureWrapMode: "clamp",
						}),
						detailTextureRecipeId,
						family: "texture-rgba",
						rgbaTextureRecipeId,
					},
				],
			]),
			sourcePartIndex: null,
		});

		const result = bakeObjectVisuals({
			bundle,
			geometryBuffers: new Map([[TEST_BUFFER.bufferId, TEST_BUFFER]]),
			renderPartIdPrefix: "texture-role-fixture",
			textureBindings: new Map([
				[indexTextureRecipeId, createTextureBinding("index-use")],
				[paletteTextureRecipeId, createTextureBinding("palette-use")],
				[rgbaTextureRecipeId, createTextureBinding("rgba-use")],
				[detailTextureRecipeId, createTextureBinding("detail-use")],
			]),
		});

		const indexedPart = result.renderParts.find(
			(part) => part.materialFamily === "indexed-paletted",
		);
		const rgbaPart = result.renderParts.find(
			(part) => part.materialFamily === "texture-rgba",
		);

		expect(indexedPart?.materialEntries[0]).toMatchObject({
			indexTextureUseId: "index-use",
			indexedClipThreshold: 8,
			indexedTextureFormat: "index16",
			materialColor: [0.9, 0.9, 0.9, 1],
			paletteFirstIndex: 32,
			paletteTextureUseId: "palette-use",
		});
		expect(rgbaPart?.materialEntries[0]).toMatchObject({
			detailTextureTiling: 5,
			detailTextureUseId: "detail-use",
			primaryTextureUseId: "rgba-use",
			primaryTextureWrapMode: "clamp",
		});
		expect(
			result.textureDependencies.map((dependency) => dependency.resourceId),
		).toEqual(["detail-use", "index-use", "palette-use", "rgba-use"]);
	});

	it("splits dynamic source parts by material table budget and emits animation bindings", () => {
		const materialOneId = materialRecipeId(1);
		const materialTwoId = materialRecipeId(2);
		const bundle = createBundle({
			materialBindings: [
				{
					geometrySurfaceId: 10,
					materialRecipeId: materialOneId,
					materialSlot: 0,
				},
				{
					geometrySurfaceId: 20,
					materialRecipeId: materialTwoId,
					materialSlot: 1,
				},
			],
			materialRecipes: new Map([
				[materialOneId, createDirectColorMaterialRecipe([1, 0, 0, 1])],
				[materialTwoId, createDirectColorMaterialRecipe([0, 1, 0, 1])],
			]),
			sourcePartIndex: 4,
		});

		const result = bakeObjectVisuals({
			bundle,
			geometryBuffers: new Map([[TEST_BUFFER.bufferId, TEST_BUFFER]]),
			maxMaterialEntriesPerRenderPart: 1,
			renderPartIdPrefix: "dynamic-fixture",
		});

		expect(result.renderParts).toHaveLength(2);
		expect(result.renderParts.map((part) => part.sourcePartIndices)).toEqual([
			[4],
			[4],
		]);
		expect(result.animationPartBindings).toEqual([
			{
				renderPartIds: [
					"dynamic-fixture:render-part:0",
					"dynamic-fixture:render-part:1",
				],
				sourcePartIndex: 4,
			},
		]);
	});

	it("resolves gfx-obj recipes through explicit geometry sidecar buffers", () => {
		const materialId = materialRecipeId(1);
		const bundle = createBundle({
			geometryKind: "gfx-obj",
			materialBindings: [
				{
					geometrySurfaceId: 10,
					materialRecipeId: materialId,
					materialSlot: 0,
				},
			],
			materialRecipes: new Map([
				[materialId, createDirectColorMaterialRecipe([1, 1, 1, 1])],
			]),
			sourcePartIndex: 0,
		});

		const result = bakeObjectVisuals({
			bundle,
			geometryBuffers: new Map([[TEST_BUFFER.bufferId, TEST_BUFFER]]),
			renderPartIdPrefix: "gfx-fixture",
		});

		expect(result.renderParts).toHaveLength(1);
		expect([...result.renderParts[0]!.positions.slice(0, 9)]).toEqual([
			0, 0, 0, 1, 0, 0, 0, 1, 0,
		]);
	});

	it("complains in the console and skips unsupported material families", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const materialId = materialRecipeId(1);
		const bundle = createBundle({
			materialBindings: [
				{
					geometrySurfaceId: 10,
					materialRecipeId: materialId,
					materialSlot: 0,
				},
			],
			materialRecipes: new Map([
				[
					materialId,
					{
						...createMaterialRecipeBase(),
						family: "unsupported",
						pass: "opaque",
						reason: "fixture unsupported material",
					},
				],
			]),
			sourcePartIndex: null,
		});

		try {
			const result = bakeObjectVisuals({
				bundle,
				geometryBuffers: new Map([[TEST_BUFFER.bufferId, TEST_BUFFER]]),
				renderPartIdPrefix: "unsupported-fixture",
			});

			expect(result.renderParts).toEqual([]);
			expect(result.animationPartBindings).toEqual([]);
		} finally {
			warn.mockRestore();
		}
	});
});

const TEST_BUFFER_ID = objectVisualGeometryBufferId(1);
const TEST_GEOMETRY_RECIPE_ID = 1 as ObjectVisualGeometryRecipeId;
const TEST_PART_RECIPE_ID = 1 as ObjectVisualPartRecipeId;

const TEST_BUFFER: ObjectVisualGeometryBuffer = {
	bounds: {
		max: { x: 1, y: 1, z: 0 },
		min: { x: 0, y: 0, z: 0 },
	},
	bufferId: TEST_BUFFER_ID,
	coordinateSpace: "source-local",
	normals: new Float32Array([
		0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
	]),
	positions: new Float32Array([
		0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0,
	]),
	texCoords: new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
	triangleCount: 2,
	triangles: [
		{
			firstVertex: 0,
			materialVariantSignature: null,
			polygonId: 100,
			surfaceId: 10,
		},
		{
			firstVertex: 3,
			materialVariantSignature: null,
			polygonId: 200,
			surfaceId: 20,
		},
	],
	vertexCount: 6,
};

function createBundle(options: {
	readonly geometryKind?: "embedded-geometry" | "gfx-obj";
	readonly materialBindings: readonly ObjectVisualPartMaterialBinding[];
	readonly materialRecipes: ObjectVisualRecipeBundle["materialRecipes"];
	readonly sourcePartIndex: number | null;
}): ObjectVisualRecipeBundle {
	return {
		geometryBufferRefs: new Map([
			[
				TEST_BUFFER_ID,
				{
					coordinateSpace: "source-local",
					sourceKey: "fixture",
					sourceKind:
						options.geometryKind === "gfx-obj"
							? "gfx-obj"
							: "embedded-geometry",
					triangleCount: TEST_BUFFER.triangleCount,
					vertexCount: TEST_BUFFER.vertexCount,
				},
			],
		]),
		geometryRecipes: new Map([
			[
				TEST_GEOMETRY_RECIPE_ID,
				options.geometryKind === "gfx-obj"
					? {
							bufferId: TEST_BUFFER_ID,
							kind: "gfx-obj",
							sourceDid: 0x01000001,
						}
					: {
							bufferId: TEST_BUFFER_ID,
							kind: "embedded-geometry",
						},
			],
		]),
		materialRecipes: options.materialRecipes,
		partInstances: [
			{
				instanceId: "fixture-instance",
				partRecipeId: TEST_PART_RECIPE_ID,
				residency: {
					kind: "runtime-entity",
					runtimeEntityId: "fixture-entity",
				},
				sourcePartIndex: options.sourcePartIndex,
				transform: IDENTITY_TRANSFORM,
			},
		],
		partRecipes: new Map([
			[
				TEST_PART_RECIPE_ID,
				{
					geometryRecipeId: TEST_GEOMETRY_RECIPE_ID,
					materialBindings: options.materialBindings,
				},
			],
		]),
		recipeKeys: {
			geometryBufferKeys: [],
			geometryRecipeKeys: [],
			materialRecipeKeys: [],
			partRecipeKeys: [],
			textureRecipeKeys: [],
		},
		textureRecipes: new Map(),
	};
}

function materialRecipeId(id: number): ObjectVisualMaterialRecipeId {
	return id as ObjectVisualMaterialRecipeId;
}

function createDirectColorMaterialRecipe(
	materialColor: readonly [number, number, number, number],
	overrides: Partial<Omit<ObjectVisualMaterialRecipeBase, "family">> = {},
): ObjectVisualMaterialRecipe {
	return {
		...createMaterialRecipeBase(overrides),
		family: "direct-color",
		materialColor,
		pass: "opaque",
	};
}

function createMaterialRecipeBase(
	overrides: Partial<Omit<ObjectVisualMaterialRecipeBase, "family">> = {},
): Omit<ObjectVisualMaterialRecipeBase, "family"> {
	return {
		alphaTest: 0,
		detailTextureTiling: 1,
		indexedClipThreshold: 0,
		materialColor: [1, 1, 1, 1],
		materialEmissiveColor: [0, 0, 0],
		paletteFirstIndex: 0,
		pass: "opaque",
		primaryTextureWrapMode: "repeat",
		renderState: {
			blend: {
				dstFactor: null,
				enabled: false,
				mode: "opaque",
				srcFactor: null,
			},
			depthTest: true,
			depthWrite: true,
		},
		textureRoleLayoutKey: "none",
		textureRoleSchemaKey: "none",
		...overrides,
	};
}

function createTransparentRenderState(): ObjectVisualMaterialRecipeBase["renderState"] {
	return {
		blend: {
			dstFactor: "one-minus-src-alpha",
			enabled: true,
			mode: "alpha",
			srcFactor: "src-alpha",
		},
		depthTest: true,
		depthWrite: false,
	};
}

function createTextureBinding(textureUseId: string) {
	return {
		dependency: {
			resourceId: textureUseId,
			roles: [],
		},
		textureUseId,
	};
}

function textureRecipeId(id: number): ObjectVisualTextureRecipeId {
	return id as ObjectVisualTextureRecipeId;
}
