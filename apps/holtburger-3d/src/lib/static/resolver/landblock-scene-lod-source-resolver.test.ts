import { describe, expect, it } from "vitest";
import type {
	PreparedAsset,
	PreparedAssetReader,
} from "../../assets/contracts";
import { createHostAssetKey } from "../../assets/keys";
import type {
	StaticBakeBatchInput,
	StaticBaker,
	StaticLandblockSceneLodSourceRequest,
	StaticLayerRecipe,
} from "../contracts";
import { EnvCellSystemBaker } from "../env-cells/bake/env-cell-system-baker";
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
				createPreparedAsset("terrain-material", 2, createTerrainMaterialPayload()),
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
				staticBatchId: `batch:${recipe.payload.job.domain}`,
			});
		}
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
	const staticBatchId = `batch:${recipe.payload.job.domain}`;
	return {
		atlasSnapshot: {
			domain: recipe.payload.job.domain,
			placements: [],
			staticBatchId,
			textureUses: [],
		},
		attachments: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: [],
		},
		domain: recipe.payload.job.domain,
		items: [
			{
				payload: recipe.payload,
				targetOwnerKey: recipe.targetOwnerKey,
				work: {
					job: recipe.payload.job,
					priority: 0,
					revision: 1,
					staticWorkId: `work:${recipe.payload.job.domain}`,
				},
			},
		],
		revision: 1,
		staticBatchId,
	};
}

function createSceneLodPayload() {
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
				statics: [],
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
