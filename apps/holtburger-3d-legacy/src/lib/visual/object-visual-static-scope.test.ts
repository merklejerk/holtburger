import { describe, expect, it } from "vitest";

import type {
	EnvCellSystemStaticScopePayload,
	OutdoorStaticObjectsScopePayload,
} from "../static/contracts";
import {
	createObjectVisualMissingDependenciesResolution,
	createObjectVisualReadyResolution,
	objectVisualGeometryBufferId,
	type ObjectVisualGeometryBuffer,
	type ObjectVisualGeometryRecipeId,
	type ObjectVisualMaterialRecipeBase,
	type ObjectVisualMaterialRecipeId,
	type ObjectVisualPartRecipeId,
	type ObjectVisualRecipeBundle,
} from "./object-visual-recipe-bundle";
import { createObjectVisualStaticPublicationMetadata } from "./object-visual-static-publication";
import { createObjectVisualStaticScope } from "./object-visual-static-scope";

const TEST_BUFFER_ID = objectVisualGeometryBufferId(0);
const TEST_GEOMETRY_RECIPE_ID = 0 as ObjectVisualGeometryRecipeId;
const TEST_MATERIAL_RECIPE_ID = 0 as ObjectVisualMaterialRecipeId;
const TEST_PART_RECIPE_ID = 0 as ObjectVisualPartRecipeId;
const TEST_LANDBLOCK_ID = 0xda55ffff;

describe("object visual static scope contract", () => {
	it("wraps outdoor visual resolution with sidecars outside the recipe graph", () => {
		const bundle = createReadyBundle("outdoor");
		const sidecars = createOutdoorSidecars();
		const scope = createObjectVisualStaticScope({
			domain: "outdoor-explicit-objects",
			kind: "outdoor-object-visual-static-scope",
			landblock: sidecars.landblock,
			sidecars,
			visual: {
				geometryBuffers: new Map([[TEST_BUFFER_ID, createGeometryBuffer()]]),
				publicationMetadata: createObjectVisualStaticPublicationMetadata({
					partInstanceCount: bundle.partInstances.length,
				}),
				resolution: createObjectVisualReadyResolution(bundle),
			},
		});

		expect(scope.visual.resolution.kind).toBe("ready");
		expect(scope.sidecars.authoredDynamicPlacements).toEqual([]);
		expect(scope.sidecars.buildingTransitionApertures).toEqual([]);
		expect(scope.visual.resolution.bundle.partInstances[0]?.residency).toEqual({
			kind: "outdoor-landblock",
			landblockId: TEST_LANDBLOCK_ID,
		});
	});

	it("wraps env-cell visual resolution with portal and residency sidecars", () => {
		const bundle = createReadyBundle("env-cell");
		const sidecars = createEnvCellSidecars();
		const scope = createObjectVisualStaticScope({
			kind: "env-cell-system-object-visual-static-scope",
			landblock: sidecars.landblock,
			sidecars,
			visual: {
				geometryBuffers: new Map([[TEST_BUFFER_ID, createGeometryBuffer()]]),
				publicationMetadata: createObjectVisualStaticPublicationMetadata({
					partInstanceCount: bundle.partInstances.length,
				}),
				resolution: createObjectVisualReadyResolution(bundle),
			},
		});

		expect(scope.visual.resolution.kind).toBe("ready");
		expect(scope.sidecars.portalLinks).toEqual([]);
		expect(scope.sidecars.acceptedEnvCellIds).toEqual([0xda550100]);
		expect(scope.visual.resolution.bundle.partInstances[0]?.residency).toEqual({
			envCellId: 0xda550100,
			kind: "env-cell",
			landblockId: TEST_LANDBLOCK_ID,
		});
	});

	it("rejects ready scopes without geometry buffer sidecars", () => {
		const bundle = createReadyBundle("outdoor");
		const sidecars = createOutdoorSidecars();

		expect(() =>
			createObjectVisualStaticScope({
				domain: "outdoor-explicit-objects",
				kind: "outdoor-object-visual-static-scope",
				landblock: sidecars.landblock,
				sidecars,
				visual: {
					geometryBuffers: new Map(),
					publicationMetadata: createObjectVisualStaticPublicationMetadata({
						partInstanceCount: bundle.partInstances.length,
					}),
					resolution: createObjectVisualReadyResolution(bundle),
				},
			}),
		).toThrow("references geometry buffer 0");
	});

	it("rejects missing-dependencies scopes with partial visual products", () => {
		const sidecars = createOutdoorSidecars();

		expect(() =>
			createObjectVisualStaticScope({
				domain: "outdoor-explicit-objects",
				kind: "outdoor-object-visual-static-scope",
				landblock: sidecars.landblock,
				sidecars,
				visual: {
					geometryBuffers: new Map([[TEST_BUFFER_ID, createGeometryBuffer()]]),
					publicationMetadata: null,
					resolution: createObjectVisualMissingDependenciesResolution([
						{ sourceId: "gfx-obj/01000001", sourceKind: "gfx-obj" },
					]),
				},
			}),
		).toThrow("cannot carry geometry buffers");
	});

	it("rejects static part instances with runtime residency", () => {
		const bundle = createReadyBundle("runtime");
		const sidecars = createOutdoorSidecars();

		expect(() =>
			createObjectVisualStaticScope({
				domain: "outdoor-explicit-objects",
				kind: "outdoor-object-visual-static-scope",
				landblock: sidecars.landblock,
				sidecars,
				visual: {
					geometryBuffers: new Map([[TEST_BUFFER_ID, createGeometryBuffer()]]),
					publicationMetadata: createObjectVisualStaticPublicationMetadata({
						partInstanceCount: bundle.partInstances.length,
					}),
					resolution: createObjectVisualReadyResolution(bundle),
				},
			}),
		).toThrow("invalid residency runtime-entity");
	});
});

function createReadyBundle(
	residency: "env-cell" | "outdoor" | "runtime",
): ObjectVisualRecipeBundle {
	return {
		geometryBufferRefs: new Map([
			[
				TEST_BUFFER_ID,
				{
					coordinateSpace: "source-local",
					sourceKey: "fixture",
					sourceKind: "embedded-geometry",
					triangleCount: 1,
					vertexCount: 3,
				},
			],
		]),
		geometryRecipes: new Map([
			[
				TEST_GEOMETRY_RECIPE_ID,
				{
					bufferId: TEST_BUFFER_ID,
					kind: "embedded-geometry",
				},
			],
		]),
		materialRecipes: new Map([
			[
				TEST_MATERIAL_RECIPE_ID,
				{
					...createMaterialRecipeBase(),
					family: "direct-color",
				},
			],
		]),
		partInstances: [
			{
				instanceId: "part-instance:0",
				partRecipeId: TEST_PART_RECIPE_ID,
				residency:
					residency === "outdoor"
						? {
								kind: "outdoor-landblock",
								landblockId: TEST_LANDBLOCK_ID,
							}
						: residency === "env-cell"
							? {
									envCellId: 0xda550100,
									kind: "env-cell",
									landblockId: TEST_LANDBLOCK_ID,
								}
							: {
									kind: "runtime-entity",
									runtimeEntityId: "dynamic:0",
								},
				sourcePartIndex: null,
				transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
			},
		],
		partRecipes: new Map([
			[
				TEST_PART_RECIPE_ID,
				{
					geometryRecipeId: TEST_GEOMETRY_RECIPE_ID,
					materialBindings: [
						{
							geometrySurfaceId: 1,
							materialRecipeId: TEST_MATERIAL_RECIPE_ID,
							materialSlot: 0,
							polygonIds: [1],
						},
					],
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

function createGeometryBuffer(): ObjectVisualGeometryBuffer {
	return {
		bounds: null,
		bufferId: TEST_BUFFER_ID,
		coordinateSpace: "source-local",
		normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		triangleCount: 1,
		triangles: [
			{
				firstVertex: 0,
				materialVariantSignature: null,
				polygonId: 1,
				surfaceId: 1,
			},
		],
		vertexCount: 3,
	};
}

function createOutdoorSidecars(): OutdoorStaticObjectsScopePayload {
	return {
		authoredDynamicPlacements: [],
		buildingTransitionApertures: [],
		domain: "outdoor-explicit-objects",
		kind: "outdoor-static-objects",
		landblock: {
			kind: "landblock-source",
			landblockId: TEST_LANDBLOCK_ID,
			source: "outdoor",
		},
		materialSlots: [],
		materialSources: [],
		missingRefs: [],
		objects: [],
		paletteSources: [],
		regionRenderProfile: {
			detailRoles: [],
			identity: {
				kind: "region-render-profile",
				regionNumber: 1,
			},
		},
		sourceAssets: [],
		sourceSpatial: {
			bounds: null,
			coordinateSpace: "landblock-render-local",
			outdoorBvh: null,
			outdoorBvhItemCount: 0,
			outdoorBvhNodeCount: 0,
		},
		textureRefs: [],
	};
}

function createEnvCellSidecars(): EnvCellSystemStaticScopePayload {
	return {
		acceptedEnvCellIds: [0xda550100],
		envCells: [],
		kind: "env-cell-system",
		landblock: {
			kind: "landblock-source",
			landblockId: TEST_LANDBLOCK_ID,
			source: "env-cells",
		},
		materialSources: [],
		missingRefs: [],
		paletteSources: [],
		portalApertureResources: [],
		portalConnectivityGraph: {
			edges: [],
			nodes: [],
		},
		portalLinks: [],
		regionRenderProfile: {
			detailRoles: [],
			identity: {
				kind: "region-render-profile",
				regionNumber: 1,
			},
		},
		residencySpatial: {
			envCellSystemBvh: {
				items: [],
				nodes: [],
			},
			envCellSystemBvhItemCount: 0,
			envCellSystemBvhNodeCount: 0,
		},
		sourceAssets: [],
		textureRefs: [],
		visibilityDiagnostics: [],
	};
}

function createMaterialRecipeBase(): Omit<
	ObjectVisualMaterialRecipeBase,
	"family"
> {
	return {
		alphaTest: 0,
		detailTextureTiling: 1,
		indexedClipThreshold: 0,
		materialColor: [1, 1, 1, 1],
		materialEmissiveColor: [0, 0, 0],
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
	};
}
