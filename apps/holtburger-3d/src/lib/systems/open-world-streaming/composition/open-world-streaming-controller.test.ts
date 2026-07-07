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
		expect(controller.createDiagnosticsSnapshot().frameBudget).toEqual({
			yieldedPasses: 5,
		});
	});

	it("keeps replacement source requests split by static layer domain", async () => {
		const renderer = new FixtureTerrainRenderer();
		const resolver = new FixtureTerrainResolver({
			generatedScenery: createGeneratedSceneryScopePayload(),
			terrain: createTerrainScopePayload(),
		});
		const controller = new OpenWorldStreamingController({
			assetReader: createUnusedAssetReader(),
			createDynamicVisualBaker: failIfDynamicWorkerFactoryIsCalled,
			createDynamicVisualRecipeResolver: failIfDynamicWorkerFactoryIsCalled,
			createStaticBaker: () => new FixtureTerrainBaker(),
			createStaticResolver: () => resolver,
			createTexturePacker: () => createUnusedTexturePacker(),
			renderer,
		});

		controller.updateStaticInterest({
			anchorLandblockId: 0xda55ffff,
			lod: {
				buildings: -1,
				envCells: -1,
				explicitObjects: -1,
				generatedScenery: 0,
				terrain: 0,
			},
			revision: 1,
		});
		await waitFor(() => resolver.sourceRequests.length === 2);

		expect(
			resolver.sourceRequests.map((request) =>
				request.requestedLayers.map((layer) => layer.kind),
			),
		).toEqual([["terrain"], ["outdoor-generated-scenery"]]);
		expect(resolver.sourceRequests.map((request) => request.sourceLod)).toEqual(
			[0, 3],
		);
	});
});

class FixtureTerrainRenderer {
	readonly anchorLandblockIds: (number | null)[] = [];
	readonly generatedSceneryLayers: Array<{
		readonly landblockId: number;
		readonly payload: unknown;
	}> = [];
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

	setOutdoorBuildingsLayer(): void {}

	setOutdoorExplicitObjectsLayer(): void {}

	setOutdoorGeneratedSceneryLayer(landblockId: number, payload: unknown): void {
		this.generatedSceneryLayers.push({ landblockId, payload });
	}

	setTerrainLayer(
		landblockId: number,
		payload: TerrainLayerPayload | null,
	): void {
		this.terrainLayers.push({ landblockId, payload });
	}
}

function failIfDynamicWorkerFactoryIsCalled(): never {
	throw new Error(
		"Dynamic worker factory should not be used by terrain slice test.",
	);
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
	readonly sourceRequests: StaticLandblockSceneLodSourceRequest[] = [];

	constructor(
		readonly payloads:
			| StaticScopePayload
			| {
					readonly generatedScenery: StaticScopePayload;
					readonly terrain: StaticScopePayload;
			  },
	) {}

	async resolveSource(
		request: StaticLandblockSceneLodSourceRequest,
	): Promise<StaticLandblockSceneLodResolution> {
		this.sourceRequests.push(request);
		const payload = this.#selectPayload(request);
		return {
			dynamicPlacements: [],
			dynamicRecipes: [],
			recipes: [
				{
					payload,
					targetOwnerKey: request.requestedLayers[0]!.targetOwnerKey,
				},
			],
			request,
		};
	}

	#selectPayload(
		request: StaticLandblockSceneLodSourceRequest,
	): StaticScopePayload {
		if (!("terrain" in this.payloads)) {
			return this.payloads;
		}
		const layerKind = request.requestedLayers[0]?.kind;
		if (layerKind === "terrain") {
			return this.payloads.terrain;
		}
		if (layerKind === "outdoor-generated-scenery") {
			return this.payloads.generatedScenery;
		}
		throw new Error(`Unexpected fixture layer kind ${layerKind ?? "<none>"}.`);
	}
}

class FixtureTerrainBaker implements StaticBaker {
	async bake(input: StaticBakeJobInput): Promise<StaticBakeJobResult> {
		return {
			atlasRegistryUpdates: [],
			buildRevision: input.payload.sourceRevision,
			domain: input.domain,
			drawUnits:
				input.domain === "outdoor-terrain"
					? [
							{
								drawUnitId: "terrain:draw:1",
								kind: "terrain-geometry",
								landblockId: 0xda55ffff,
								textureBindingIds: [],
							},
						]
					: [],
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

function createGeneratedSceneryScopePayload(): StaticScopePayload {
	return {
		job: {
			domain: "outdoor-generated-scenery",
			scope: {
				kind: "landblock",
				landblockId: 0xda55ffff,
			},
		},
		scope: {
			authoredDynamicPlacements: [],
			buildingTransitionApertures: [],
			domain: "outdoor-generated-scenery",
			landblock: {
				kind: "landblock-source",
				landblockId: 0xda55ffff,
				source: "outdoor",
			},
			kind: "outdoor-static-objects",
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
		},
		sourceRevision: 1,
	} as StaticScopePayload;
}

function createUnusedAssetReader(): PreparedAssetReader {
	return {
		async requestPreparedAsset(): Promise<never> {
			throw new Error("Fixture asset reader should not be used.");
		},
	};
}
