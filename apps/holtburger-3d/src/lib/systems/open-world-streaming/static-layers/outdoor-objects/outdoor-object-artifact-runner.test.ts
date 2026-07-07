import { describe, expect, it } from "vitest";

import type { PreparedAssetReader } from "../../../../assets/contracts";
import type {
	OutdoorStaticObjectsScopePayload,
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
import { OpenWorldOutdoorObjectArtifactRunner } from "./outdoor-object-artifact-runner";

describe("OpenWorldOutdoorObjectArtifactRunner", () => {
	it("requests the landblock scene LoD required by generated scenery", async () => {
		const task = createGeneratedSceneryTask();
		const resolver = new FixtureOutdoorObjectResolver(
			createOutdoorObjectScopePayload(),
		);
		const baker = new FixtureOutdoorObjectBaker();
		const runner = new OpenWorldOutdoorObjectArtifactRunner({
			assetReader: createUnusedAssetReader(),
			baker,
			resolver,
			textureClaims: new OpenWorldTextureClaimRegistry(),
		});

		const commit = await runner.run({
			ownerId:
				"static-layer:outdoor-generated-scenery:0xda55ffff" as MaterializationOwnerId,
			task,
		});

		expect(resolver.sourceRequests).toEqual([
			{
				context: "outdoor",
				landblockId: 0xda55ffff,
				requestedLayers: [
					{
						kind: "outdoor-generated-scenery",
						targetOwnerKey: task.ownerKey,
					},
				],
				sourceLod: 3,
			},
		]);
		expect(baker.inputs[0]).toMatchObject({
			domain: "outdoor-generated-scenery",
			revision: 1,
			task,
		});
		expect(commit).toMatchObject({
			kind: "outdoor-object-layer-commit",
			payload: {
				kind: "outdoor-generated-scenery",
				landblockId: 0xda55ffff,
			},
			textureCommits: [],
		});
	});
});

class FixtureOutdoorObjectResolver implements StaticLandblockSceneLodSourceResolver {
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

class FixtureOutdoorObjectBaker implements StaticBaker {
	readonly inputs: StaticBakeJobInput[] = [];

	async bake(input: StaticBakeJobInput): Promise<StaticBakeJobResult> {
		this.inputs.push(input);
		return {
			atlasRegistryUpdates: [],
			buildRevision: input.payload.sourceRevision,
			domain: "outdoor-generated-scenery",
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

function createGeneratedSceneryTask(): StaticLayerTaskRequest {
	return {
		domain: "outdoor-generated-scenery",
		ownerId: "static-layer:outdoor-generated-scenery:0xda55ffff",
		ownerKey: {
			kind: "outdoor-generated-scenery",
			landblockId: 0xda55ffff,
		},
		priority: 20,
		revision: 1,
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
		scopeKey: "landblock:da55ffff",
		taskId: "1:landblock:da55ffff:outdoor-generated-scenery",
	};
}

function createOutdoorObjectScopePayload(): StaticScopePayload {
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
			kind: "outdoor-static-objects",
			landblock: {
				kind: "landblock-source",
				landblockId: 0xda55ffff,
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
				objectBvh: {
					items: [],
					nodes: [],
				},
			},
			textureRefs: [],
		} as OutdoorStaticObjectsScopePayload,
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
