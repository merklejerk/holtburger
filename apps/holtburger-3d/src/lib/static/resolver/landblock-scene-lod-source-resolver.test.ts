import { describe, expect, it } from "vitest";
import type {
	PreparedAsset,
	PreparedAssetReader,
} from "../../assets/contracts";
import { createHostAssetKey } from "../../assets/keys";
import type {
	StaticBakeBatchInput,
	StaticBakeTask,
	StaticBaker,
	StaticLandblockSceneLodSourceRequest,
	StaticLayerRecipe,
} from "../contracts";
import { EnvCellSystemBaker } from "../env-cells/bake/env-cell-system-baker";
import { createLayerOwnerKeyId } from "../layer-owners";
import { StaticObjectBatchBaker } from "../objects/bake/static-object-batch-baker";
import { TerrainGeometryStaticBaker } from "../terrain/bake/terrain-geometry-baker";
import { LandblockSceneLodSourceResolver } from "./landblock-scene-lod-source-resolver";

describe("landblock scene LoD source resolver", () => {
	it("fans one source payload out to requested owner-tagged layer recipes", async () => {
		const assetReader = new RecordingPreparedAssetReader([
			createPreparedAsset(
				"landblock-scene-lod",
				"da55ffff:4",
				createSceneLodPayload(),
			),
			createPreparedAsset(
				"terrain-material",
				2,
				createTerrainMaterialPayload(),
			),
			createPreparedAsset(
				"region-render-profile",
				2,
				createRegionRenderProfilePayload(),
			),
		]);
		const request = createSourceRequest();

		const resolution = await new LandblockSceneLodSourceResolver({
			assetService: assetReader,
		}).resolveSource(request);

		expect(resolution.request).toBe(request);
		expect(resolution.recipes.map((recipe) => recipe.targetOwnerKey)).toEqual([
			{ kind: "terrain", landblockId: 0xda55ffff },
			{ kind: "outdoor-buildings", landblockId: 0xda55ffff },
			{ kind: "outdoor-explicit-objects", landblockId: 0xda55ffff },
			{ kind: "outdoor-generated-scenery", landblockId: 0xda55ffff },
			{ kind: "env-cell-system", landblockId: 0xda55ffff },
		]);
		expect(
			resolution.recipes.map((recipe) => recipe.payload.job.domain),
		).toEqual([
			"outdoor-terrain",
			"outdoor-buildings",
			"outdoor-explicit-objects",
			"outdoor-generated-scenery",
			"env-cell-system",
		]);
		expect(assetReader.requestedKeys).toContain(
			"landblock-scene-lod:da55ffff:4",
		);
		expect(
			assetReader.requestedKeys.filter(
				(key) => key === "landblock-scene-lod:da55ffff:4",
			),
		).toHaveLength(1);
		expect(assetReader.requestedKeys).not.toContain(
			"landblock-scene-lod-outdoor-layer:da55ffff",
		);
		expect(assetReader.requestedKeys).not.toContain(
			"landblock-scene-lod-env-cell-layer:da55ffff",
		);
		const envCellRecipe = resolution.recipes.find(
			(recipe) => recipe.payload.job.domain === "env-cell-system",
		);
		expect(envCellRecipe?.payload.scope.kind).toBe("env-cell-system");
		if (envCellRecipe?.payload.scope.kind !== "env-cell-system") {
			throw new Error("Expected env-cell-system recipe.");
		}
		expect(envCellRecipe.payload.scope.portalApertureResources).toEqual([]);
		expect(envCellRecipe.payload.scope.portalConnectivityGraph).toEqual({
			edges: [],
			nodes: [],
		});
	});

	it("emits recipes that feed existing domain bake workers with owner keys", async () => {
		const resolution = await new LandblockSceneLodSourceResolver({
			assetService: new RecordingPreparedAssetReader([
				createPreparedAsset(
					"landblock-scene-lod",
					"da55ffff:4",
					createSceneLodPayload(),
				),
				createPreparedAsset(
					"terrain-material",
					2,
					createTerrainMaterialPayload(),
				),
				createPreparedAsset(
					"region-render-profile",
					2,
					createRegionRenderProfilePayload(),
				),
			]),
		}).resolveSource(createSourceRequest());

		for (const recipe of resolution.recipes) {
			await expect(
				bakerForRecipe(recipe).bake(createBakeInput(recipe)),
			).resolves.toMatchObject({
				bakeBatchId: `batch:${recipe.payload.job.domain}`,
			});
		}
	});

	it("emits static-authored dynamic recipes beside static layer recipes", async () => {
		const setupModelId = 0x02000010;
		const animationId = 0x03000010;
		const resolution = await new LandblockSceneLodSourceResolver({
			assetService: new RecordingPreparedAssetReader([
				createPreparedAsset(
					"landblock-scene-lod",
					"da55ffff:4",
					createSceneLodPayload({ dynamicBuilding: true }),
				),
				createPreparedAsset(
					"terrain-material",
					2,
					createTerrainMaterialPayload(),
				),
				createPreparedAsset(
					"region-render-profile",
					2,
					createRegionRenderProfilePayload(),
				),
				createPreparedAsset(
					"setup-model",
					setupModelId,
					createSetupModelPayload({ animationId, setupModelId }),
				),
				createPreparedAsset(
					"animation",
					animationId,
					createAnimationPayload(animationId),
				),
			]),
		}).resolveSource(createSourceRequest());

		expect(resolution.dynamicRecipes).toHaveLength(1);
		expect(resolution.dynamicRecipes[0]?.targetOwnerKey).toEqual({
			kind: "outdoor-buildings",
			landblockId: 0xda55ffff,
		});
		expect(resolution.dynamicRecipes[0]?.recipe).toMatchObject({
			animationSelection: { kind: "setup-default" },
			entityId:
				"static-authored-outdoor:outdoor-buildings:0xda55ffff:object:building:building-0:setup:02000010",
			source: {
				kind: "static-authored",
				placementId: "object:building:building-0:setup:02000010",
				sourceResidence: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
			},
			visual: {
				animation: {
					payload: {
						animationId,
					},
				},
				setupModel: {
					identity: {
						sourceAssetKind: "setup-model",
						sourceDid: setupModelId,
					},
				},
			},
		});
	});
});

class RecordingPreparedAssetReader implements PreparedAssetReader {
	readonly requestedKeys: string[] = [];
	readonly #assets: Map<string, PreparedAsset>;

	constructor(assets: readonly PreparedAsset[]) {
		this.#assets = new Map(assets.map((asset) => [assetKey(asset), asset]));
	}

	requestPreparedAsset(key: PreparedAsset["key"]): Promise<PreparedAsset> {
		const id = `${key.kind}:${key.id}`;
		this.requestedKeys.push(id);
		const asset = this.#assets.get(id);
		if (!asset) {
			return Promise.reject(new Error(`missing fixture asset ${id}`));
		}
		return Promise.resolve(asset);
	}
}

function createSourceRequest(): StaticLandblockSceneLodSourceRequest {
	return {
		context: "outdoor",
		landblockId: 0xda55ffff,
		requestedLayers: [
			{
				kind: "terrain",
				targetOwnerKey: { kind: "terrain", landblockId: 0xda55ffff },
			},
			{
				kind: "outdoor-buildings",
				targetOwnerKey: { kind: "outdoor-buildings", landblockId: 0xda55ffff },
			},
			{
				kind: "outdoor-explicit-objects",
				targetOwnerKey: {
					kind: "outdoor-explicit-objects",
					landblockId: 0xda55ffff,
				},
			},
			{
				kind: "outdoor-generated-scenery",
				targetOwnerKey: {
					kind: "outdoor-generated-scenery",
					landblockId: 0xda55ffff,
				},
			},
			{
				kind: "env-cell-system",
				targetOwnerKey: { kind: "env-cell-system", landblockId: 0xda55ffff },
			},
		],
		sourceLod: 4,
	};
}

function createPreparedAsset(
	kind: PreparedAsset["key"]["kind"],
	id: string | number,
	payload: unknown,
): PreparedAsset {
	return {
		key: createHostAssetKey(kind, id),
		payload,
		preparedAt: "2026-06-29T00:00:00.000Z",
		revision: 7,
		sourceAssetId: `${kind}:${id}`,
	};
}

function assetKey(asset: PreparedAsset): string {
	return `${asset.key.kind}:${asset.key.id}`;
}

function bakerForRecipe(recipe: StaticLayerRecipe): StaticBaker {
	if (recipe.payload.job.domain === "outdoor-terrain") {
		return new TerrainGeometryStaticBaker();
	}
	if (recipe.payload.job.domain === "env-cell-system") {
		return new EnvCellSystemBaker();
	}
	return new StaticObjectBatchBaker();
}

function createBakeInput(recipe: StaticLayerRecipe): StaticBakeBatchInput {
	const bakeBatchId = `batch:${recipe.payload.job.domain}`;
	const task: StaticBakeTask = {
		domain: recipe.payload.job.domain,
		ownerId: createLayerOwnerKeyId(recipe.targetOwnerKey),
		ownerKey: recipe.targetOwnerKey,
		revision: 1,
		scope: recipe.payload.job.scope,
		scopeKey: `landblock:${recipe.payload.job.scope.landblockId.toString(16).padStart(8, "0")}`,
		taskId: `task:${recipe.payload.job.domain}`,
	};
	return {
		attachments: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: [],
		},
		domain: recipe.payload.job.domain,
		items: [
			{
				payload: recipe.payload,
				task,
			},
		],
		revision: 1,
		bakeBatchId,
	};
}

function createSceneLodPayload(
	options: {
		readonly dynamicBuilding?: boolean;
	} = {},
) {
	return {
		diagnostics: createDiagnostics(),
		kind: "landblock-scene-lod",
		landblockId: 0xda55ffff,
		layers: [
			{
				kind: "terrain",
				terrain: createTerrain(),
			},
			{
				buildingTransitionApertures: [],
				kind: "outdoor-buildings",
				outdoorBvh: null,
				statics: options.dynamicBuilding ? [createDynamicBuildingStatic()] : [],
			},
			{
				kind: "outdoor-explicit-objects",
				outdoorBvh: null,
				statics: [],
			},
			{
				kind: "outdoor-generated-scenery",
				outdoorBvh: null,
				statics: [],
			},
			{
				diagnostics: createDiagnostics(),
				envCells: [],
				kind: "env-cell-system",
				envCellSystemBvh: { items: [], nodes: [] },
				landblockInfoId: 0xda55fffe,
				portalApertureResources: [],
				portalConnectivityGraph: { edges: [], nodes: [] },
				portalLinks: [],
			},
		],
		provenance: {
			detail: null,
			errorCode: null,
			source: "repo-local-hba",
			sourceAssetKind: "landblock-scene-lod",
		},
		regionId: 1,
		regionNumber: 2,
		source: { context: "outdoor", level: 4 },
	};
}

function createDynamicBuildingStatic() {
	return {
		building: { numLeaves: 1, portals: [] },
		generated: null,
		instanceBounds: null,
		instanceId: "building-0",
		kind: "building",
		localPlacement: createPlacement(),
		sourceAssetId: "setup-model/02000010",
		sourceBounds: null,
		sourceDid: 0x02000010,
		sourceIndex: 0,
		sourceScale: { x: 1, y: 1, z: 1 },
	};
}

function createSetupModelPayload(options: {
	readonly animationId: number;
	readonly setupModelId: number;
}) {
	return {
		collisionWitness: { cylSphereCount: 0, sphereCount: 0 },
		connectionPoints: [],
		defaultAnimation: options.animationId,
		defaultMotionTable: null,
		defaultScript: null,
		defaultScriptTable: null,
		defaultSoundTable: null,
		dependencies: { gfxObjAssetIds: [] },
		flags: null,
		height: null,
		holdingLocations: [],
		kind: "setup-model",
		lights: [],
		parts: [],
		placementSets: [],
		provenance: createProvenance("setup-model"),
		radius: null,
		residencyKind: "unknown",
		selectionSphere: null,
		setupModelId: options.setupModelId,
		sortingSphere: null,
		sourceAssetKind: "setup-model",
		stepDown: null,
		stepUp: null,
	};
}

function createAnimationPayload(animationId: number) {
	return {
		animationAssetId: `animation/${animationId.toString(16).padStart(8, "0")}`,
		animationId,
		dependencies: {},
		flags: null,
		frameCount: 1,
		kind: "animation",
		objectPositionFrames: [],
		partCount: 0,
		partFrames: [
			{
				frameIndex: 0,
				hooks: [],
				localPlacements: [],
			},
		],
		provenance: createProvenance("animation"),
		residencyKind: "unknown",
		sourceAssetKind: "animation",
	};
}

function createPlacement() {
	return {
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
	};
}

function createTerrain() {
	return {
		bounds: null,
		gridSize: 9,
		maxHeight: 0,
		minHeight: 0,
		quads: [],
		terrainBvh: {
			coordinateSpace: "landblock-render-local",
			items: [],
			nodes: [],
		},
		tileSize: 24,
		triangles: [],
		vertices: [],
	};
}

function createTerrainMaterialPayload() {
	return {
		dependencies: {
			paletteAssetIds: [],
			renderSurfaceAssetIds: [],
			surfaceTextureAssetIds: [],
		},
		kind: "terrain-material",
		materialKind: "tex-merge-table",
		pcodeEncoding: {
			roadCodeBits: 2,
			sizeBitMask: 0,
			terrainCodeBits: 5,
		},
		provenance: createProvenance("terrain-material"),
		regionNumber: 2,
		residencyKind: "unknown",
		roadAlphaMaps: [],
		sourceAssetKind: "terrain-material",
		terrainAlphaMaps: [],
		terrainTypes: [],
	};
}

function createRegionRenderProfilePayload() {
	return {
		detailRoles: {
			building: null,
			environment: null,
			landscape: null,
			object: null,
		},
		kind: "region-render-profile",
		provenance: createProvenance("region-render-profile"),
		regionId: 1,
		regionNumber: 2,
		residencyKind: "unknown",
		sourceAssetKind: "region-render-profile",
	};
}

function createDiagnostics() {
	return {
		errors: [],
		missingCells: [],
		missingEnvironments: [],
		missingGfxObjs: [],
		missingLandblocks: [],
		missingMaterials: [],
		missingPalettes: [],
		missingScenes: [],
		missingSetupModels: [],
	};
}

function createProvenance(sourceAssetKind: string) {
	return {
		detail: null,
		errorCode: null,
		source: "repo-local-hba",
		sourceAssetKind,
	};
}
