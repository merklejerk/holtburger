import { describe, expect, it } from "vitest";
import type {
	PreparedAsset,
	PreparedAssetReader,
} from "../../assets/contracts";
import { createHostAssetKey } from "../../assets/keys";
import type { StaticLandblockSceneLodSourceRequest } from "../contracts";
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
			"landblock-env-cells",
		]);
		expect(assetReader.requestedKeys).toContain(
			"landblock-scene-lod:da55ffff:4",
		);
		expect(
			assetReader.requestedKeys.filter(
				(key) => key === "landblock-scene-lod:da55ffff:4",
			),
		).toHaveLength(1);
		expect(
			assetReader.requestedKeys.some(
				(key) =>
					key.startsWith("landblock-outdoor:") ||
					key.startsWith("landblock-env-cells:"),
			),
		).toBe(false);
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
				landblockEnvCellBvh: { items: [], nodes: [] },
				landblockInfoId: 0xda55fffe,
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
