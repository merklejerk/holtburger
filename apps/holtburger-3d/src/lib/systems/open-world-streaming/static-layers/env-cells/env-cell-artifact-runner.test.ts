import { describe, expect, it } from "vitest";

import type { PreparedAssetReader } from "../../../../assets/contracts";
import type {
	EnvCellSystemStaticScopePayload,
	StaticBakeJobInput,
	StaticBakeJobResult,
	StaticBaker,
	StaticLandblockSceneLodResolution,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticLayerTaskRequest,
	StaticScopePayload,
} from "../../../../static/contracts";
import { createEmptyObjectVisualInstallSet } from "../../../../visual/object-visual-install-set";
import type { MaterializationOwnerId } from "../../owners/owner-id";
import { OpenWorldTextureClaimRegistry } from "../../texture-residency/claims/texture-claim-registry";
import type { OpenWorldObjectVisualAtlasBuilder } from "../../texture-residency/placement/object-visual-atlas-builder";
import { OpenWorldEnvCellArtifactRunner } from "./env-cell-artifact-runner";

describe("OpenWorldEnvCellArtifactRunner", () => {
	it("resolves LoD 4 env-cell sources and emits direct env-cell commits", async () => {
		const task = createEnvCellTask();
		const resolver = new FixtureEnvCellResolver(createEnvCellScopePayload());
		const baker = new FixtureEnvCellBaker();
		const runner = new OpenWorldEnvCellArtifactRunner({
			assetReader: createUnusedAssetReader(),
			baker,
			objectVisualAtlasBuilder: createUnusedObjectVisualAtlasBuilder(),
			resolver,
			textureClaims: new OpenWorldTextureClaimRegistry(),
		});

		const commit = await runner.run({
			ownerId:
				"static-layer:env-cell-system:0xda55ffff" as MaterializationOwnerId,
			task,
		});

		expect(resolver.sourceRequests).toEqual([
			{
				context: "outdoor",
				landblockId: 0xda55ffff,
				requestedLayers: [
					{
						kind: "env-cell-system",
						targetOwnerKey: task.ownerKey,
					},
				],
				sourceLod: 4,
			},
		]);
		expect(baker.inputs[0]).toMatchObject({
			domain: "env-cell-system",
			revision: 1,
			task,
		});
		expect(commit).toMatchObject({
			kind: "env-cell-system-layer-commit",
			payload: {
				kind: "env-cell-system",
				landblockId: 0xda55ffff,
			},
			textureCommits: [],
		});
	});
});

class FixtureEnvCellResolver implements StaticLandblockSceneLodSourceResolver {
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

class FixtureEnvCellBaker implements StaticBaker {
	readonly inputs: StaticBakeJobInput[] = [];

	async bake(input: StaticBakeJobInput): Promise<StaticBakeJobResult> {
		this.inputs.push(input);
		return {
			atlasRegistryUpdates: [],
			buildRevision: input.payload.sourceRevision,
			domain: "env-cell-system",
			drawUnits: [],
			envCellStaticObjectPlacementRecords: [],
			materialCoverage: [],
			objectVisualInstallSet: createEmptyObjectVisualInstallSet(),
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
		};
	}
}

function createEnvCellTask(): StaticLayerTaskRequest {
	return {
		domain: "env-cell-system",
		ownerId: "static-layer:env-cell-system:0xda55ffff",
		ownerKey: {
			kind: "env-cell-system",
			landblockId: 0xda55ffff,
		},
		priority: 10,
		revision: 1,
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
		scopeKey: "landblock:da55ffff",
		taskId: "1:landblock:da55ffff:env-cell-system",
	};
}

function createEnvCellScopePayload(): StaticScopePayload {
	return {
		job: {
			domain: "env-cell-system",
			scope: {
				kind: "landblock",
				landblockId: 0xda55ffff,
			},
		},
		scope: {
			acceptedEnvCellIds: [],
			envCells: [],
			kind: "env-cell-system",
			landblock: {
				kind: "landblock-source",
				landblockId: 0xda55ffff,
				source: "outdoor",
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
		} as EnvCellSystemStaticScopePayload,
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

function createUnusedObjectVisualAtlasBuilder(): OpenWorldObjectVisualAtlasBuilder {
	return {
		buildAtlas() {
			throw new Error(
				"Object visual atlas builder should not be used by empty env-cell test payload.",
			);
		},
	};
}
