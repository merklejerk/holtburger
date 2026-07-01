import { describe, expect, it } from "vitest";

import {
	createObjectVisualMissingDependenciesResolution,
	createObjectVisualReadyResolution,
	createObjectVisualRecipeKeyRegistry,
	isRenderableObjectVisualMaterialRecipe,
	objectVisualGeometryBufferKey,
	objectVisualGeometryRecipeKey,
	objectVisualMaterialRecipeKey,
	objectVisualPartRecipeKey,
	objectVisualTextureRecipeKey,
	type ObjectVisualGeometryBuffer,
	type ObjectVisualGeometryRecipe,
	type ObjectVisualMaterialRecipe,
	type ObjectVisualPartRecipe,
	type ObjectVisualRecipeBundle,
	type ObjectVisualTextureRecipe,
} from "./object-visual-recipe-bundle";

describe("object visual recipe bundle contracts", () => {
	it("builds deterministic dense numeric ids from semantic key tables", () => {
		const first = createObjectVisualRecipeKeyRegistry({
			geometryBufferKeys: [
				objectVisualGeometryBufferKey("buffer:cell-2"),
				objectVisualGeometryBufferKey("buffer:cell-1"),
				objectVisualGeometryBufferKey("buffer:cell-1"),
			],
			geometryRecipeKeys: [
				objectVisualGeometryRecipeKey("geom:gfx:02000001"),
				objectVisualGeometryRecipeKey("geom:embedded:cell-1"),
			],
			materialRecipeKeys: [
				objectVisualMaterialRecipeKey("mat:texture:2"),
				objectVisualMaterialRecipeKey("mat:texture:1"),
			],
			partRecipeKeys: [
				objectVisualPartRecipeKey("part:tree"),
				objectVisualPartRecipeKey("part:boulder"),
			],
			textureRecipeKeys: [
				objectVisualTextureRecipeKey("tex:surface:06000002"),
				objectVisualTextureRecipeKey("tex:surface:06000001"),
			],
		});
		const second = createObjectVisualRecipeKeyRegistry({
			geometryBufferKeys: [
				objectVisualGeometryBufferKey("buffer:cell-1"),
				objectVisualGeometryBufferKey("buffer:cell-2"),
			],
			geometryRecipeKeys: [
				objectVisualGeometryRecipeKey("geom:embedded:cell-1"),
				objectVisualGeometryRecipeKey("geom:gfx:02000001"),
			],
			materialRecipeKeys: [
				objectVisualMaterialRecipeKey("mat:texture:1"),
				objectVisualMaterialRecipeKey("mat:texture:2"),
			],
			partRecipeKeys: [
				objectVisualPartRecipeKey("part:boulder"),
				objectVisualPartRecipeKey("part:tree"),
			],
			textureRecipeKeys: [
				objectVisualTextureRecipeKey("tex:surface:06000001"),
				objectVisualTextureRecipeKey("tex:surface:06000002"),
			],
		});

		expect(first.recipeKeys).toEqual(second.recipeKeys);
		expect(
			first.textureRecipeIdsByKey.get(
				objectVisualTextureRecipeKey("tex:surface:06000001"),
			),
		).toBe(0);
		expect(
			first.materialRecipeIdsByKey.get(
				objectVisualMaterialRecipeKey("mat:texture:2"),
			),
		).toBe(1);
		expect(
			first.partRecipeIdsByKey.get(objectVisualPartRecipeKey("part:tree")),
		).toBe(1);
	});

	it("keeps missing dependencies distinct from an empty ready bundle", () => {
		expect(() => createObjectVisualMissingDependenciesResolution([])).toThrow(
			"Object visual missing-dependencies resolution requires at least one missing dependency.",
		);

		const missing = createObjectVisualMissingDependenciesResolution([
			{ sourceId: "gfx-obj/01000001", sourceKind: "gfx-obj" },
		]);

		expect(missing).toEqual({
			kind: "missing-dependencies",
			missingDependencies: [
				{ sourceId: "gfx-obj/01000001", sourceKind: "gfx-obj" },
			],
		});
	});

	it("models unsupported materials as non-renderable recipe records", () => {
		const unsupported: ObjectVisualMaterialRecipe = {
			family: "unsupported",
			pass: "opaque",
			reason: "material family is not implemented",
		};
		const renderable: ObjectVisualMaterialRecipe = {
			diffuseColor: [1, 1, 1, 1],
			family: "direct-color",
			pass: "opaque",
		};

		expect(isRenderableObjectVisualMaterialRecipe(unsupported)).toBe(false);
		expect(isRenderableObjectVisualMaterialRecipe(renderable)).toBe(true);
	});

	it("lets ready bundles reference source-local embedded geometry sidecars", () => {
		const keys = createObjectVisualRecipeKeyRegistry({
			geometryBufferKeys: [objectVisualGeometryBufferKey("buffer:cell")],
			geometryRecipeKeys: [objectVisualGeometryRecipeKey("geom:cell")],
			materialRecipeKeys: [objectVisualMaterialRecipeKey("mat:white")],
			partRecipeKeys: [objectVisualPartRecipeKey("part:wall")],
			textureRecipeKeys: [objectVisualTextureRecipeKey("tex:white")],
		});
		const bufferId = keys.geometryBufferIdsByKey.get(
			objectVisualGeometryBufferKey("buffer:cell"),
		);
		const geometryRecipeId = keys.geometryRecipeIdsByKey.get(
			objectVisualGeometryRecipeKey("geom:cell"),
		);
		const materialRecipeId = keys.materialRecipeIdsByKey.get(
			objectVisualMaterialRecipeKey("mat:white"),
		);
		const partRecipeId = keys.partRecipeIdsByKey.get(
			objectVisualPartRecipeKey("part:wall"),
		);
		const textureRecipeId = keys.textureRecipeIdsByKey.get(
			objectVisualTextureRecipeKey("tex:white"),
		);
		if (
			bufferId === undefined ||
			geometryRecipeId === undefined ||
			materialRecipeId === undefined ||
			partRecipeId === undefined ||
			textureRecipeId === undefined
		) {
			throw new Error("Fixture key registry did not create dense ids.");
		}
		const geometryBuffer: ObjectVisualGeometryBuffer = {
			bounds: {
				max: { x: 1, y: 1, z: 0 },
				min: { x: 0, y: 0, z: 0 },
			},
			bufferId,
			coordinateSpace: "source-local",
			normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
			positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
			texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
			triangleCount: 1,
			triangles: [
				{
					firstVertex: 0,
					materialVariantSignature: null,
					polygonId: 42,
					surfaceId: 7,
				},
			],
			vertexCount: 3,
		};
		const geometryRecipe: ObjectVisualGeometryRecipe = {
			bufferId,
			kind: "embedded-geometry",
		};
		const partRecipe: ObjectVisualPartRecipe = {
			geometryRecipeId,
			materialBindings: [
				{
					geometrySurfaceId: 7,
					materialRecipeId,
					materialSlot: 0,
					polygonIds: [42],
				},
			],
		};
		const textureRecipe: ObjectVisualTextureRecipe = {
			source: {
				kind: "render-surface",
				renderSurfaceId: 0x06000001,
				surfaceTextureId: null,
			},
			usage: "object-base-color",
		};
		const bundle: ObjectVisualRecipeBundle = {
			geometryBufferRefs: new Map([
				[
					bufferId,
					{
						coordinateSpace: "source-local",
						sourceKey: "env-cell:00010001",
						sourceKind: "embedded-geometry",
						triangleCount: 1,
						vertexCount: 3,
					},
				],
			]),
			geometryRecipes: new Map([[geometryRecipeId, geometryRecipe]]),
			materialRecipes: new Map([
				[
					materialRecipeId,
					{
						diffuseColor: [1, 1, 1, 1],
						family: "direct-color",
						pass: "opaque",
					},
				],
			]),
			partInstances: [
				{
					instanceId: "env-cell:00010001:part:wall",
					partRecipeId,
					residency: {
						envCellId: 0x00010001,
						kind: "env-cell",
						landblockId: 0x0001ffff,
					},
					transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
				},
			],
			partRecipes: new Map([[partRecipeId, partRecipe]]),
			recipeKeys: keys.recipeKeys,
			textureRecipes: new Map([[textureRecipeId, textureRecipe]]),
		};

		expect(geometryBuffer.coordinateSpace).toBe("source-local");
		expect(geometryBuffer.triangles).toEqual([
			{
				firstVertex: 0,
				materialVariantSignature: null,
				polygonId: 42,
				surfaceId: 7,
			},
		]);
		expect(createObjectVisualReadyResolution(bundle)).toEqual({
			bundle,
			kind: "ready",
		});
		expect(bundle.geometryBufferRefs.get(bufferId)?.sourceKind).toBe(
			"embedded-geometry",
		);
	});
});
