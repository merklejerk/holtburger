import { describe, expect, it } from "vitest";

import type { PreparedAssetReader } from "../../../../assets/contracts";
import type {
	StaticBakeJobInput,
	StaticBakeJobResult,
	StaticBaker,
	StaticLandblockSceneLodResolution,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticLayerTaskRequest,
	StaticScopePayload,
	TerrainStaticScopePayload,
} from "../../../../static/contracts";
import { OpenWorldTextureClaimRegistry } from "../../texture-residency/claims/texture-claim-registry";
import { OpenWorldTextureResidencyService } from "../../texture-residency/texture-residency-service";
import { OpenWorldTerrainArtifactRunner } from "./terrain-artifact-runner";
import type { MaterializationOwnerId } from "../../owners/owner-id";
import type { OpenWorldMaterialTextureAtlasBuilder } from "../../texture-residency/atlas-build/object-visual-atlas-builder";

describe("OpenWorldTerrainArtifactRunner", () => {
	it("resolves and bakes terrain into a replacement terrain layer commit", async () => {
		const task = createTerrainTask();
		const resolver = new FixtureTerrainResolver(createTerrainScopePayload());
		const baker = new FixtureTerrainBaker();
		const runner = new OpenWorldTerrainArtifactRunner({
			assetReader: createUnusedAssetReader(),
			baker,
			frameBudget: createFixtureFrameBudget(),
			resolver,
			textureResidency: createFixtureTextureResidency(),
		});

		const commit = await runner.run({
			filteringMode: "anisotropic-4x",
			isCurrent: () => true,
			ownerId: "static-layer:terrain:0xda55ffff" as MaterializationOwnerId,
			task,
		});

		expect(resolver.sourceRequests).toEqual([
			{
				context: "outdoor",
				landblockId: 0xda55ffff,
				requestedLayers: [
					{
						kind: "terrain",
						targetOwnerKey: task.ownerKey,
					},
				],
				sourceLod: 0,
			},
		]);
		expect(baker.inputs[0]).toMatchObject({
			domain: "outdoor-terrain",
			revision: 1,
			task,
		});
		expect(commit).toMatchObject({
			kind: "terrain-layer-commit",
			payload: {
				drawUnits: [expect.objectContaining({ drawUnitId: "terrain:draw:1" })],
				kind: "terrain",
				landblockId: 0xda55ffff,
			},
			texturePageBuildRequests: [],
			textureReadiness: [{ bindingId: "terrain-binding:1", kind: "pending" }],
		});
		expect(commit.stageTimings.map((timing) => timing.stage)).toEqual([
			"resolve-source",
			"create-texture-intents",
			"texture-placement-reservation",
			"create-bake-resources",
			"bake",
			"assemble-commit",
		]);
	});
});

function createFixtureTextureResidency(): OpenWorldTextureResidencyService {
	const atlasBuilder = createUnusedTextureAtlasBuilder();
	return new OpenWorldTextureResidencyService({
		applySamplerPolicyUpdate: () => {},
		applyTextureCommits: () => {},
		objectVisualAtlasBuilder: atlasBuilder,
		textureAtlasBuilder: atlasBuilder,
		textureClaims: new OpenWorldTextureClaimRegistry(),
	});
}

class FixtureTerrainResolver implements StaticLandblockSceneLodSourceResolver {
	readonly sourceRequests: StaticLandblockSceneLodSourceRequest[] = [];

	constructor(readonly payload: StaticScopePayload) {}

	async resolveSource(
		request: StaticLandblockSceneLodSourceRequest,
	): Promise<StaticLandblockSceneLodResolution> {
		this.sourceRequests.push(request);
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
	readonly inputs: StaticBakeJobInput[] = [];

	async bake(input: StaticBakeJobInput): Promise<StaticBakeJobResult> {
		this.inputs.push(input);
		return {
			atlasRegistryUpdates: [],
			buildRevision: input.payload.sourceRevision,
			domain: "outdoor-terrain",
			drawUnits: [
				{
					drawUnitId: "terrain:draw:1",
					kind: "terrain-geometry",
					landblockId: 0xda55ffff,
					textureBindingIds: ["terrain-binding:1"],
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

function createTerrainTask(): StaticLayerTaskRequest {
	return {
		domain: "outdoor-terrain",
		ownerId: "static-layer:terrain:0xda55ffff",
		ownerKey: {
			kind: "terrain",
			landblockId: 0xda55ffff,
		},
		priority: 0,
		revision: 1,
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
		scopeKey: "landblock:da55ffff",
		taskId: "1:landblock:da55ffff:outdoor-terrain",
	};
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

function createUnusedTextureAtlasBuilder(): OpenWorldMaterialTextureAtlasBuilder {
	return {
		async planAtlasPlacement(): Promise<never> {
			throw new Error("Fixture texture atlas builder should not be used.");
		},
	};
}

function createFixtureFrameBudget() {
	return {
		async yieldToFrameBudget(): Promise<void> {},
	};
}
