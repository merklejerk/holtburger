import { describe, expect, it, vi } from "vitest";

import {
	objectVisualGeometryBufferId,
	type ObjectVisualGeometryBuffer,
	type ObjectVisualGeometryRecipeId,
	type ObjectVisualMaterialRecipeId,
	type ObjectVisualPartMaterialBinding,
	type ObjectVisualPartRecipeId,
	type ObjectVisualRecipeBundle,
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
				[
					materialOneId,
					{
						diffuseColor: [1, 0, 0, 1],
						family: "direct-color",
						pass: "opaque",
					},
				],
				[
					materialTwoId,
					{
						diffuseColor: [0, 1, 0, 1],
						family: "direct-color",
						pass: "opaque",
					},
				],
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
				[
					materialOneId,
					{
						diffuseColor: [1, 0, 0, 1],
						family: "direct-color",
						pass: "opaque",
					},
				],
				[
					materialTwoId,
					{
						diffuseColor: [0, 1, 0, 1],
						family: "direct-color",
						pass: "opaque",
					},
				],
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
				[
					materialId,
					{
						diffuseColor: [1, 1, 1, 1],
						family: "direct-color",
						pass: "opaque",
					},
				],
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
