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
	StaticLandblockSceneLodSourceProjectionEvent,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticMaterialCoverageReport,
	StaticObjectBakeDiagnostics,
	StaticScopePayload,
	TerrainGeometryStaticDrawUnit,
	TerrainStaticScopePayload,
} from "../../../static/contracts";
import type { OpenWorldTexturePageBuilder } from "../texture-residency/page-build/worker-client";
import type { OpenWorldObjectVisualAtlasBuilder } from "../texture-residency/atlas-build/object-visual-atlas-builder";
import { OpenWorldStreamingController } from "./open-world-streaming-controller";

describe("OpenWorldStreamingController terrain slice", () => {
	it("applies terrain commits to renderer and exposes native progress", async () => {
		const renderer = new FixtureTerrainRenderer();
		const controller = new OpenWorldStreamingController({
			assetReader: createUnusedAssetReader(),
			createDynamicVisualPrepper: failIfDynamicWorkerFactoryIsCalled,
			createDynamicVisualRecipeResolver: failIfDynamicWorkerFactoryIsCalled,
			createObjectVisualAtlasBuilder: createUnusedObjectVisualAtlasBuilder,
			createStaticBaker: () => new FixtureTerrainBaker(),
			createStaticResolver: () =>
				new FixtureTerrainResolver(createTerrainScopePayload()),
			createTexturePageBuilder: createUnusedTexturePageBuilder,
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
		expect(
			controller.createDiagnosticsSnapshot().texturePageBuildTasks.summary,
		).toEqual({
			accepted: 0,
			active: 0,
			committed: 0,
			failed: 0,
			queued: 0,
			staleRejected: 0,
		});
		expect(controller.createDiagnosticsSnapshot().textureResidency).toMatchObject({
			byteEstimate: {
				approximateBytes: null,
				reason: "page-size-not-yet-canonical",
			},
			ownerlessPagePolicy: {
				pendingRendererRemovalPageCount: 0,
				rendererRemoval: {
					kind: "deferred-until-measured-pressure",
					pressureThresholdBytes: null,
				},
				residentDisposition: "cached-for-reuse",
			},
			ownerlessPages: {
				building: 0,
				planned: 0,
				resident: 0,
				total: 0,
			},
		});
	});

	it("keeps source delivery split by domain and reports direct source work", async () => {
		const renderer = new FixtureTerrainRenderer();
		const resolver = new FixtureTerrainResolver({
			buildings: createOutdoorObjectsScopePayload("outdoor-buildings"),
			generatedScenery: createOutdoorObjectsScopePayload(
				"outdoor-generated-scenery",
			),
			terrain: createTerrainScopePayload(),
		});
		const controller = new OpenWorldStreamingController({
			assetReader: createUnusedAssetReader(),
			createDynamicVisualPrepper: failIfDynamicWorkerFactoryIsCalled,
			createDynamicVisualRecipeResolver: failIfDynamicWorkerFactoryIsCalled,
			createObjectVisualAtlasBuilder: createUnusedObjectVisualAtlasBuilder,
			createStaticBaker: () => new FixtureTerrainBaker(),
			createStaticResolver: () => resolver,
			createTexturePageBuilder: createUnusedTexturePageBuilder,
			renderer,
		});

		controller.updateStaticInterest({
			anchorLandblockId: 0xda55ffff,
			lod: {
				buildings: 0,
				envCells: -1,
				explicitObjects: -1,
				generatedScenery: 0,
				terrain: 0,
			},
			revision: 1,
		});
		await waitFor(
			() =>
				controller.createSnapshot().terrain.committed === 1 &&
				renderer.generatedSceneryLayers.length === 1,
		);

		expect(resolver.sourceRequests).toHaveLength(3);
		expect(
			resolver.sourceRequests.map((request) =>
				request.requestedLayers.map((layer) => layer.kind),
			),
		).toEqual([
			["terrain"],
			["outdoor-buildings"],
			["outdoor-generated-scenery"],
		]);
		expect(resolver.sourceRequests.map((request) => request.sourceLod)).toEqual(
			[0, 1, 3],
		);
		expect(controller.createDiagnosticsSnapshot().sourceResolution).toEqual({
			directRequests: 3,
			maxProjectedAssimilationMs: 0,
			maxProjectedDeliveryMs: 0,
			maxProjectedMs: 0,
			maxProjectedWaitersReleased: 0,
			projectedAssimilationMs: 0,
			projectedDeliveryMs: 0,
			projectedDynamicPlacementCount: 0,
			projectedDynamicRecipeCount: 0,
			projectedMs: 0,
			projectedRecipeCount: 0,
			projectedResults: 0,
			projectedWaiterReleaseCount: 0,
			reusedRequests: 0,
			sourceStreamRequests: 0,
		});
	});

	it("evicts static owners when static interest is cleared", async () => {
		const renderer = new FixtureTerrainRenderer();
		const controller = new OpenWorldStreamingController({
			assetReader: createUnusedAssetReader(),
			createDynamicVisualPrepper: failIfDynamicWorkerFactoryIsCalled,
			createDynamicVisualRecipeResolver: failIfDynamicWorkerFactoryIsCalled,
			createObjectVisualAtlasBuilder: createUnusedObjectVisualAtlasBuilder,
			createStaticBaker: () => new FixtureTerrainBaker(),
			createStaticResolver: () =>
				new FixtureTerrainResolver(createTerrainScopePayload()),
			createTexturePageBuilder: createUnusedTexturePageBuilder,
			renderer,
		});

		controller.updateTerrainInterest({
			anchorLandblockId: 0xda55ffff,
			radius: 0,
			revision: 1,
		});
		await waitFor(() => controller.createSnapshot().terrain.committed === 1);

		controller.updateStaticInterest(null);

		expect(renderer.anchorLandblockIds).toEqual([0xda55ffff, null]);
		expect(controller.createDiagnosticsSnapshot().owners).toEqual({
			current: 0,
			evicted: 1,
		});
	});

	it("streams broad source work as domain-specific runner results", async () => {
		const renderer = new FixtureTerrainRenderer();
		const resolver = new FixtureStreamingTerrainResolver({
			buildings: createOutdoorObjectsScopePayload("outdoor-buildings"),
			generatedScenery: createOutdoorObjectsScopePayload(
				"outdoor-generated-scenery",
			),
			terrain: createTerrainScopePayload(),
		});
		const controller = new OpenWorldStreamingController({
			assetReader: createUnusedAssetReader(),
			createDynamicVisualPrepper: failIfDynamicWorkerFactoryIsCalled,
			createDynamicVisualRecipeResolver: failIfDynamicWorkerFactoryIsCalled,
			createObjectVisualAtlasBuilder: createUnusedObjectVisualAtlasBuilder,
			createStaticBaker: () => new FixtureTerrainBaker(),
			createStaticResolver: () => resolver,
			createTexturePageBuilder: createUnusedTexturePageBuilder,
			renderer,
		});

		controller.updateStaticInterest({
			anchorLandblockId: 0xda55ffff,
			lod: {
				buildings: 0,
				envCells: -1,
				explicitObjects: -1,
				generatedScenery: 0,
				terrain: 0,
			},
			revision: 1,
		});
		await waitFor(
			() =>
				controller.createSnapshot().terrain.committed === 1 &&
				renderer.generatedSceneryLayers.length === 1,
		);

		expect(resolver.sourceRequests).toHaveLength(0);
		expect(resolver.streamRequests).toHaveLength(1);
		expect(
			resolver.streamRequests[0]?.requestedLayers.map((layer) => layer.kind),
		).toEqual(["terrain", "outdoor-buildings", "outdoor-generated-scenery"]);
		expect(controller.createDiagnosticsSnapshot().sourceResolution).toEqual({
			directRequests: 0,
			maxProjectedAssimilationMs: expect.any(Number),
			maxProjectedDeliveryMs: 0,
			maxProjectedMs: 1,
			maxProjectedWaitersReleased: 0,
			projectedAssimilationMs: expect.any(Number),
			projectedDeliveryMs: 0,
			projectedDynamicPlacementCount: 0,
			projectedDynamicRecipeCount: 0,
			projectedMs: 3,
			projectedRecipeCount: 3,
			projectedResults: 3,
			projectedWaiterReleaseCount: 0,
			reusedRequests: 2,
			sourceStreamRequests: 1,
		});
	});

	it("reports replacement material readiness issues from static coverage evidence", async () => {
		const controller = new OpenWorldStreamingController({
			assetReader: createUnusedAssetReader(),
			createDynamicVisualPrepper: failIfDynamicWorkerFactoryIsCalled,
			createDynamicVisualRecipeResolver: failIfDynamicWorkerFactoryIsCalled,
			createObjectVisualAtlasBuilder: createUnusedObjectVisualAtlasBuilder,
			createStaticBaker: () =>
				new FixtureTerrainBaker([createUnsupportedMaterialCoverage()]),
			createStaticResolver: () =>
				new FixtureTerrainResolver(createTerrainScopePayload()),
			createTexturePageBuilder: createUnusedTexturePageBuilder,
			renderer: new FixtureTerrainRenderer(),
		});

		controller.updateTerrainInterest({
			anchorLandblockId: 0xda55ffff,
			radius: 0,
			revision: 1,
		});
		await waitFor(() => controller.createSnapshot().terrain.committed === 1);

		expect(
			controller.createDiagnosticsSnapshot().materialReadiness,
		).toMatchObject({
			recentIssues: [
				{
					kind: "unsupported-source-material",
					materialFamily: "unsupported",
					reasonCodes: ["fixture-unsupported"],
					sourceEvidence: {
						kind: "static-material-coverage",
						reportKey: "fixture:coverage",
						reportKind: "terrain",
					},
					taskId: "1:landblock:da55ffff:outdoor-terrain",
				},
			],
			summary: {
				unsupportedSourceMaterialIssueCount: 1,
			},
		});
	});

	it("does not treat rendered material coverage as a readiness issue", async () => {
		const controller = new OpenWorldStreamingController({
			assetReader: createUnusedAssetReader(),
			createDynamicVisualPrepper: failIfDynamicWorkerFactoryIsCalled,
			createDynamicVisualRecipeResolver: failIfDynamicWorkerFactoryIsCalled,
			createObjectVisualAtlasBuilder: createUnusedObjectVisualAtlasBuilder,
			createStaticBaker: () =>
				new FixtureTerrainBaker([createRenderedMaterialCoverage()]),
			createStaticResolver: () =>
				new FixtureTerrainResolver(createTerrainScopePayload()),
			createTexturePageBuilder: createUnusedTexturePageBuilder,
			renderer: new FixtureTerrainRenderer(),
		});

		controller.updateTerrainInterest({
			anchorLandblockId: 0xda55ffff,
			radius: 0,
			revision: 1,
		});
		await waitFor(() => controller.createSnapshot().terrain.committed === 1);

		expect(
			controller.createDiagnosticsSnapshot().materialReadiness,
		).toMatchObject({
			recentIssues: [],
			summary: {
				deferredRendererCapabilityIssueCount: 0,
				unsupportedSourceMaterialIssueCount: 0,
			},
		});
	});

	it("reports terrain material fallback reasons as replacement readiness issues", async () => {
		const controller = new OpenWorldStreamingController({
			assetReader: createUnusedAssetReader(),
			createDynamicVisualPrepper: failIfDynamicWorkerFactoryIsCalled,
			createDynamicVisualRecipeResolver: failIfDynamicWorkerFactoryIsCalled,
			createObjectVisualAtlasBuilder: createUnusedObjectVisualAtlasBuilder,
			createStaticBaker: () =>
				new FixtureTerrainBaker({
					terrainDrawUnits: [createTerrainFallbackDrawUnit()],
				}),
			createStaticResolver: () =>
				new FixtureTerrainResolver(createTerrainScopePayload()),
			createTexturePageBuilder: createUnusedTexturePageBuilder,
			renderer: new FixtureTerrainRenderer(),
		});

		controller.updateTerrainInterest({
			anchorLandblockId: 0xda55ffff,
			radius: 0,
			revision: 1,
		});
		await waitFor(() => controller.createSnapshot().terrain.committed === 1);

		expect(
			controller.createDiagnosticsSnapshot().materialReadiness,
		).toMatchObject({
			recentIssues: [
				{
					code: "unsupported-material-binding",
					drawUnitId: "terrain:draw:fallback",
					kind: "terrain-material-issue",
					message: "fixture terrain role unsupported",
					taskId: "1:landblock:da55ffff:outdoor-terrain",
					textureId: 0x05000010,
				},
			],
			summary: {
				terrainMaterialIssueCount: 1,
			},
		});
	});

	it("reports skipped static object partitions as replacement material readiness issues", async () => {
		const renderer = new FixtureTerrainRenderer();
		const controller = new OpenWorldStreamingController({
			assetReader: createUnusedAssetReader(),
			createDynamicVisualPrepper: failIfDynamicWorkerFactoryIsCalled,
			createDynamicVisualRecipeResolver: failIfDynamicWorkerFactoryIsCalled,
			createObjectVisualAtlasBuilder: createUnusedObjectVisualAtlasBuilder,
			createStaticBaker: () =>
				new FixtureTerrainBaker({
					staticObjectBakeDiagnostics: [
						createSkippedStaticObjectBakeDiagnostic(),
					],
				}),
			createStaticResolver: () =>
				new FixtureTerrainResolver({
					buildings: createOutdoorObjectsScopePayload("outdoor-buildings"),
					generatedScenery: createOutdoorObjectsScopePayload(
						"outdoor-generated-scenery",
					),
					terrain: createTerrainScopePayload(),
				}),
			createTexturePageBuilder: createUnusedTexturePageBuilder,
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
		await waitFor(
			() =>
				controller.createSnapshot().terrain.committed === 1 &&
				renderer.generatedSceneryLayers.length === 1,
		);

		expect(
			controller.createDiagnosticsSnapshot().materialReadiness,
		).toMatchObject({
			recentIssues: [
				{
					kind: "skipped-geometry",
					materialFamily: "indexed-paletted",
					reason: "fixture deferred material",
					sliceId: "fixture:partition",
					taskId: "1:landblock:da55ffff:outdoor-generated-scenery",
				},
			],
			summary: {
				skippedGeometryIssueCount: 1,
			},
		});
	});

	it("does not report no-part-instance recipe skips as material readiness issues", async () => {
		const renderer = new FixtureTerrainRenderer();
		const controller = new OpenWorldStreamingController({
			assetReader: createUnusedAssetReader(),
			createDynamicVisualPrepper: failIfDynamicWorkerFactoryIsCalled,
			createDynamicVisualRecipeResolver: failIfDynamicWorkerFactoryIsCalled,
			createObjectVisualAtlasBuilder: createUnusedObjectVisualAtlasBuilder,
			createStaticBaker: () =>
				new FixtureTerrainBaker({
					staticObjectBakeDiagnostics: [
						createNoPartInstancesStaticObjectBakeDiagnostic(),
					],
				}),
			createStaticResolver: () =>
				new FixtureTerrainResolver({
					buildings: createOutdoorObjectsScopePayload("outdoor-buildings"),
					generatedScenery: createOutdoorObjectsScopePayload(
						"outdoor-generated-scenery",
					),
					terrain: createTerrainScopePayload(),
				}),
			createTexturePageBuilder: createUnusedTexturePageBuilder,
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
		await waitFor(
			() =>
				controller.createSnapshot().terrain.committed === 1 &&
				renderer.generatedSceneryLayers.length === 1,
		);

		expect(
			controller.createDiagnosticsSnapshot().materialReadiness,
		).toMatchObject({
			recentIssues: [],
			summary: {
				pipelineBugIssueCount: 0,
			},
		});
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

	applySamplerPolicyUpdate(): void {}

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

function createUnusedObjectVisualAtlasBuilder(): OpenWorldObjectVisualAtlasBuilder {
	return {
		planAtlasPlacement(): Promise<never> {
			return Promise.reject(
				new Error("Texture layout builder should not be used by this test."),
			);
		},
	};
}

function createUnusedTexturePageBuilder(): OpenWorldTexturePageBuilder {
	return {
		buildPage(): Promise<never> {
			return Promise.reject(
				new Error("Texture page builder should not be used by this test."),
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
					readonly buildings: StaticScopePayload;
					readonly terrain: StaticScopePayload;
			  },
	) {}

	async resolveSource(
		request: StaticLandblockSceneLodSourceRequest,
	): Promise<StaticLandblockSceneLodResolution> {
		this.sourceRequests.push(request);
		return {
			dynamicPlacements: [],
			dynamicRecipes: [],
			recipes: request.requestedLayers.map((layer) => ({
				payload: this.selectPayloadForLayer(layer.kind),
				targetOwnerKey: layer.targetOwnerKey,
			})),
			request,
		};
	}

	protected selectPayloadForLayer(
		layerKind: StaticLandblockSceneLodSourceRequest["requestedLayers"][number]["kind"],
	): StaticScopePayload {
		if (!("terrain" in this.payloads)) {
			return this.payloads;
		}
		if (layerKind === "terrain") {
			return this.payloads.terrain;
		}
		if (layerKind === "outdoor-buildings") {
			return this.payloads.buildings;
		}
		if (layerKind === "outdoor-generated-scenery") {
			return this.payloads.generatedScenery;
		}
		throw new Error(`Unexpected fixture layer kind ${layerKind ?? "<none>"}.`);
	}
}

class FixtureStreamingTerrainResolver extends FixtureTerrainResolver {
	readonly streamRequests: StaticLandblockSceneLodSourceRequest[] = [];

	override async resolveProjectedSources(
		request: StaticLandblockSceneLodSourceRequest,
		onProjection: (event: StaticLandblockSceneLodSourceProjectionEvent) => void,
	): Promise<void> {
		this.streamRequests.push(request);
		for (const layer of request.requestedLayers) {
			onProjection({
				diagnostics: {
					dynamicPlacementCount: 0,
					dynamicRecipeCount: 0,
					projectionMs: 1,
					recipeCount: 1,
				},
				kind: "landblock-scene-lod-source-projected",
				resolution: {
					dynamicPlacements: [],
					dynamicRecipes: [],
					recipes: [
						{
							payload: this.selectPayloadForLayer(layer.kind),
							targetOwnerKey: layer.targetOwnerKey,
						},
					],
					request: {
						...request,
						requestedLayers: [layer],
						sourceLod: sourceLodForFixtureLayer(layer.kind),
					},
				},
			});
		}
	}
}

class FixtureTerrainBaker implements StaticBaker {
	readonly materialCoverage: readonly StaticMaterialCoverageReport[];
	readonly staticObjectBakeDiagnostics: readonly StaticObjectBakeDiagnostics[];
	readonly terrainDrawUnits: readonly TerrainGeometryStaticDrawUnit[];

	constructor(
		options:
			| readonly StaticMaterialCoverageReport[]
			| {
					readonly materialCoverage?: readonly StaticMaterialCoverageReport[];
					readonly staticObjectBakeDiagnostics?: readonly StaticObjectBakeDiagnostics[];
					readonly terrainDrawUnits?: readonly TerrainGeometryStaticDrawUnit[];
			  } = {},
	) {
		if (Array.isArray(options)) {
			this.materialCoverage = options;
			this.staticObjectBakeDiagnostics = [];
			this.terrainDrawUnits = [createTerrainDrawUnit()];
			return;
		}
		this.materialCoverage = options.materialCoverage ?? [];
		this.staticObjectBakeDiagnostics =
			options.staticObjectBakeDiagnostics ?? [];
		this.terrainDrawUnits = options.terrainDrawUnits ?? [
			createTerrainDrawUnit(),
		];
	}

	async bake(input: StaticBakeJobInput): Promise<StaticBakeJobResult> {
		return {
			atlasRegistryUpdates: [],
			buildRevision: input.payload.sourceRevision,
			domain: input.domain,
			drawUnits:
				input.domain === "outdoor-terrain" ? this.terrainDrawUnits : [],
			envCellStaticObjectPlacementRecords: [],
			materialCoverage: this.materialCoverage,
			objectVisualInstallSet: {
				directDrawUnits: [],
				renderInstances: [],
				instancedResources: [],
				visualResources: [],
			},
			portalApertureResources: [],
			revision: input.revision,
			staticObjectBakeDiagnostics: this.staticObjectBakeDiagnostics,
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

function createUnsupportedMaterialCoverage(): StaticMaterialCoverageReport {
	return {
		buckets: [
			{
				family: "unsupported",
				filteringMode: "none",
				materialCount: 1,
				outcome: "unsupported",
				partitionCount: 1,
				pass: "opaque",
				textureRoleCount: 0,
				triangleCount: 12,
			},
		],
		coverageKey: "fixture:coverage",
		coverageKind: "terrain",
		deferredTriangleCount: 0,
		detailRoleCount: 0,
		domain: "outdoor-terrain",
		fallbackReasonCount: 1,
		fallbackReasonCounts: [{ code: "fixture-unsupported", count: 1 }],
		landblockId: 0xda55ffff,
		materialCount: 1,
		partitionCount: 1,
		renderedTriangleCount: 0,
		triangleCount: 12,
		unrenderedBuckets: [
			{
				family: "unsupported",
				materialCount: 1,
				outcome: "unsupported",
				partitionCount: 1,
				pass: "opaque",
				reasonCodes: ["fixture-unsupported"],
				triangleCount: 12,
			},
		],
		unsupportedTriangleCount: 12,
	};
}

function createRenderedMaterialCoverage(): StaticMaterialCoverageReport {
	return {
		buckets: [
			{
				family: "texture-rgba",
				filteringMode: "none",
				materialCount: 1,
				outcome: "rendered",
				partitionCount: 1,
				pass: "opaque",
				textureRoleCount: 1,
				triangleCount: 12,
			},
		],
		coverageKey: "fixture:rendered-coverage",
		coverageKind: "terrain",
		deferredTriangleCount: 0,
		detailRoleCount: 0,
		domain: "outdoor-terrain",
		fallbackReasonCount: 0,
		fallbackReasonCounts: [],
		landblockId: 0xda55ffff,
		materialCount: 1,
		partitionCount: 1,
		renderedTriangleCount: 12,
		triangleCount: 12,
		unrenderedBuckets: [],
		unsupportedTriangleCount: 0,
	};
}

function createTerrainDrawUnit(
	options: Partial<TerrainGeometryStaticDrawUnit> = {},
): TerrainGeometryStaticDrawUnit {
	return {
		coordinateSpace: "landblock-render-local",
		domain: "outdoor-terrain",
		drawUnitId: "terrain:draw:1",
		indexType: "uint16",
		indices: new Uint16Array(),
		kind: "terrain-geometry",
		landblockId: 0xda55ffff,
		layerSlots: new Float32Array(),
		materialBucketKey: "terrain:fixture",
		materialFamily: "terrain-single-base-color",
		positions: new Float32Array(),
		primaryTextureBindingId: null,
		sourceTriangleIds: [],
		terrainFallbackReasons: [],
		terrainMaterialPlan: null,
		texCoords: new Float32Array(),
		textureBindingIds: [],
		triangleCount: 0,
		vertexCount: 0,
		...options,
	};
}

function createTerrainFallbackDrawUnit(): TerrainGeometryStaticDrawUnit {
	return createTerrainDrawUnit({
		drawUnitId: "terrain:draw:fallback",
		materialBucketKey: "terrain:fixture:fallback",
		materialFamily: "terrain-debug-flat",
		terrainFallbackReasons: [
			{
				code: "unsupported-material-binding",
				message: "fixture terrain role unsupported",
				pcode: 12,
				texture: {
					kind: "surface-texture",
					surfaceTextureId: 0x05000010,
				},
			},
		],
	});
}

function createSkippedStaticObjectBakeDiagnostic(): StaticObjectBakeDiagnostics {
	return {
		buildingObjectCount: 0,
		domain: "outdoor-generated-scenery",
		drawUnitCount: 0,
		estimatedAvoidedFlattenedTriangleCount: 0,
		estimatedAvoidedFlattenedTypedArrayBytes: 0,
		estimatedInstancedSourceTypedArrayBytes: 0,
		explicitObjectCount: 0,
		generatedInstanceCount: 1,
		instancedRenderInstanceCount: 0,
		instancedSourceTriangleCount: 0,
		instancedVisualResourceCount: 0,
		kind: "static-object-bake-diagnostics",
		landblockId: 0xda55ffff,
		objectCount: 1,
		partitionCount: 1,
		renderablePartitionCount: 0,
		retainedTransparentOutdoorGeneratedSceneryPartitionReasons: {
			explicitObject: 0,
			missingGeneratedFacts: 0,
			missingInstanceBounds: 0,
			repeatedGeneratedSourceRetainedByPartitionPolicy: 0,
			unsupportedMaterialBucket: 1,
			oneOffGeneratedSource: 0,
		},
		skippedPartitionCount: 1,
		skippedPartitions: [
			{
				alphaMode: "opaque",
				family: "indexed-paletted",
				materialCount: 1,
				pass: "opaque",
				reason: "fixture deferred material",
				renderCoverage: "deferred",
				sliceId: "fixture:partition",
				triangleCount: 12,
			},
		],
		taskId: "fixture:task",
		uniqueSourceCount: 1,
		uniqueSourcePartGeometryCount: 1,
		uniqueSourceTriangleCount: 12,
		visualRecipePublication: {
			kind: "published",
			partInstanceCount: 1,
		},
	};
}

function createNoPartInstancesStaticObjectBakeDiagnostic(): StaticObjectBakeDiagnostics {
	return {
		...createSkippedStaticObjectBakeDiagnostic(),
		drawUnitCount: 1,
		renderablePartitionCount: 1,
		skippedPartitionCount: 0,
		skippedPartitions: [],
		visualRecipePublication: {
			kind: "skipped",
			missingDependencySourceIds: [],
			partInstanceCount: 0,
			reason: "no-part-instances",
		},
	};
}

function sourceLodForFixtureLayer(
	kind: StaticLandblockSceneLodSourceRequest["requestedLayers"][number]["kind"],
): StaticLandblockSceneLodSourceRequest["sourceLod"] {
	switch (kind) {
		case "terrain":
			return 0;
		case "outdoor-buildings":
			return 1;
		case "outdoor-explicit-objects":
			return 2;
		case "outdoor-generated-scenery":
			return 3;
		case "env-cell-system":
			return 4;
	}
}

function createOutdoorObjectsScopePayload(
	domain: "outdoor-buildings" | "outdoor-generated-scenery",
): StaticScopePayload {
	return {
		job: {
			domain,
			scope: {
				kind: "landblock",
				landblockId: 0xda55ffff,
			},
		},
		scope: {
			authoredDynamicPlacements: [],
			buildingTransitionApertures: [],
			domain,
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
