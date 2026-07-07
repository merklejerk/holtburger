import { describe, expect, it } from "vitest";

import type { PreparedAssetReader } from "../../../assets/contracts";
import type {
	TerrainLayerPayload,
	TexturePlacementUpdate,
} from "../../../renderer/types";
import type {
	StaticBakeJobInput,
	StaticBakeJobResult,
	StaticBaker,
	StaticLandblockSceneLodResolution,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticScopePayload,
	TerrainStaticScopePayload,
} from "../../../static/contracts";
import type { TexturePacker } from "../../../textures/packing/packer";
import { OpenWorldStreamingController } from "./open-world-streaming-controller";

describe("OpenWorldStreamingController terrain slice", () => {
	it("applies terrain commits to renderer and exposes native progress", async () => {
		const renderer = new FixtureTerrainRenderer();
		const controller = new OpenWorldStreamingController({
			assetReader: createUnusedAssetReader(),
			createDynamicVisualBaker: failIfDynamicWorkerFactoryIsCalled,
			createDynamicVisualRecipeResolver: failIfDynamicWorkerFactoryIsCalled,
			createStaticBaker: () => new FixtureTerrainBaker(),
			createStaticResolver: () =>
				new FixtureTerrainResolver(createTerrainScopePayload()),
			createTexturePacker: () => createUnusedTexturePacker(),
			renderer,
		});

		controller.updateTerrainInterest({
			anchorLandblockId: 0xda55ffff,
			radius: 0,
			revision: 1,
		});
		await waitFor(() => controller.createSnapshot().terrain.committed === 1);

		expect(renderer.anchorLandblockIds).toEqual([0xda55ffff]);
		expect(renderer.textureUpdates).toHaveLength(0);
		expect(renderer.terrainLayers).toEqual([
			expect.objectContaining({
				landblockId: 0xda55ffff,
				payload: expect.objectContaining({
					drawUnits: [
						expect.objectContaining({ drawUnitId: "terrain:draw:1" }),
					],
				}),
			}),
		]);
		expect(controller.createSnapshot().terrain).toMatchObject({
			committed: 1,
			installedDrawUnits: 1,
			requested: 1,
			resolving: 0,
			sourceDrawUnits: 1,
		});
		expect(controller.createDiagnosticsSnapshot().sceneCommits).toEqual({
			applied: 1,
			pending: 0,
		});
	});
});

class FixtureTerrainRenderer {
	readonly anchorLandblockIds: (number | null)[] = [];
	readonly terrainLayers: Array<{
		readonly landblockId: number;
		readonly payload: TerrainLayerPayload | null;
	}> = [];
	readonly textureUpdates: TexturePlacementUpdate[] = [];

	applyTexturePlacementUpdate(update: TexturePlacementUpdate): void {
		this.textureUpdates.push(update);
	}

	commitDynamicResources(): void {}

	commitDynamicInstances(): void {}

	setStaticRenderAnchorLandblockId(anchorLandblockId: number | null): void {
		this.anchorLandblockIds.push(anchorLandblockId);
	}

	setTerrainLayer(
		landblockId: number,
		payload: TerrainLayerPayload | null,
	): void {
		this.terrainLayers.push({ landblockId, payload });
	}
}

function failIfDynamicWorkerFactoryIsCalled(): never {
	throw new Error("Dynamic worker factory should not be used by terrain slice test.");
}

function createUnusedTexturePacker(): TexturePacker {
	return {
		pack() {
			throw new Error(
				"Texture packer should not be used by terrain slice test.",
			);
		},
	};
}

class FixtureTerrainResolver implements StaticLandblockSceneLodSourceResolver {
	constructor(readonly payload: StaticScopePayload) {}

	async resolveSource(
		request: StaticLandblockSceneLodSourceRequest,
	): Promise<StaticLandblockSceneLodResolution> {
		return {
			dynamicPlacements: [],
			dynamicRecipes: [],
			recipes: [
				{
					payload: this.payload,
					targetOwnerKey: request.requestedLayers[0]!.targetOwnerKey,
				},
			],
			request,
		};
	}
}

class FixtureTerrainBaker implements StaticBaker {
	async bake(input: StaticBakeJobInput): Promise<StaticBakeJobResult> {
		return {
			atlasRegistryUpdates: [],
			buildRevision: input.payload.sourceRevision,
			domain: "outdoor-terrain",
			drawUnits: [
				{
					drawUnitId: "terrain:draw:1",
					kind: "terrain-geometry",
					landblockId: 0xda55ffff,
					textureBindingIds: [],
				},
			],
			envCellStaticObjectPlacementRecords: [],
			materialCoverage: [],
			objectVisualInstallSet: {
				directDrawUnits: [],
				instancedRenderInstances: [],
				instancedResources: [],
				visualResources: [],
			},
			portalApertureResources: [],
			revision: input.revision,
			staticObjectBakeDiagnostics: [],
			staticPortalGraphs: [],
			staticPortalInteriorRecords: [],
			staticSourceMappings: [],
			staticSpatialRecords: [],
			staticVisibilityRecords: [],
			task: input.task,
			textureDependencies: [],
			textureUses: [],
		} as StaticBakeJobResult;
	}
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const startedAt = Date.now();
	while (!predicate()) {
		if (Date.now() - startedAt > 1000) {
			throw new Error("Timed out waiting for condition.");
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

function createTerrainScopePayload(): StaticScopePayload {
	return {
		job: {
			domain: "outdoor-terrain",
			scope: {
				kind: "landblock",
				landblockId: 0xda55ffff,
			},
		},
		scope: {
			kind: "terrain",
			landblock: {
				kind: "landblock-source",
				landblockId: 0xda55ffff,
				source: "outdoor",
			},
			mesh: {
				quadCount: 0,
				quads: [],
				triangleCount: 0,
				triangles: [],
				vertexCount: 0,
				vertices: [],
			},
			missingRefs: [],
			regionRenderProfile: {
				detailRoles: [],
				identity: {
					kind: "region-render-profile",
					regionNumber: 1,
				},
			},
			sourceSpatial: {
				terrainBvh: {
					items: [],
					nodes: [],
				},
			},
			terrainMaterial: {
				alphaMapCount: 0,
				identity: {
					kind: "terrain-material",
					regionNumber: 1,
				},
				materialKind: "terrain-material",
				pcodeEncoding: "unknown",
				roadAlphaMapCount: 0,
				roadAlphaMaps: [],
				terrainAlphaMaps: [],
				terrainTypeCount: 0,
				terrainTypes: [],
			},
			textureUses: [],
		} as TerrainStaticScopePayload,
		sourceRevision: 1,
	};
}

function createUnusedAssetReader(): PreparedAssetReader {
	return {
		async requestPreparedAsset(): Promise<never> {
			throw new Error("Fixture asset reader should not be used.");
		},
	};
}
