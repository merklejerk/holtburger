import { describe, expect, it } from "vitest";

import type { PreparedAssetReader } from "../../../assets/contracts";
import {
	createDynamicVisualResourceId,
	type BakedDynamicVisualResource,
	type DynamicEntityRecipe,
	type DynamicVisualBakeInput,
	type DynamicVisualBakeResult,
} from "../../../dynamic/contracts";
import type { RuntimeDynamicSpawnRequest } from "../../../dynamic/dynamic-entity-controller";
import type { DynamicVisualBaker } from "../../../dynamic/visual-baker";
import type {
	DynamicVisualRecipeResolutionRequest,
	DynamicVisualRecipeResolver,
} from "../../../dynamic/visual-recipe-resolver";
import type {
	DynamicRendererInstanceCommit,
	DynamicRendererResourceCommit,
} from "../../../renderer/types";
import type {
	StaticAuthoredDynamicPlacementRecord,
	StaticObjectSourceIdentity,
} from "../../../static/contracts";
import { MaterializationOwnerRegistry } from "../owners/owner-registry";
import type { MaterializationOwnerId } from "../owners/owner-id";
import { OpenWorldTextureClaimRegistry } from "../texture-residency/claims/texture-claim-registry";
import type { OpenWorldObjectVisualAtlasBuilder } from "../texture-residency/placement/object-visual-atlas-builder";
import {
	OpenWorldRuntimeEntitySystem,
	type OpenWorldRuntimeEntityTexturePageBuildRequest,
} from "./runtime-entity-system";

describe("OpenWorldRuntimeEntitySystem", () => {
	it("materializes and destroys runtime-authored dynamic entities through direct renderer commits", async () => {
		const renderer = new FixtureDynamicRenderer();
		const owners = new MaterializationOwnerRegistry();
		const system = createSystem({ owners, renderer });

		const entityId = system.createRuntimeEntity(createRuntimeSpawnRequest());
		await waitFor(() =>
			renderer.resourceCommits.some(
				(commit) => commit.addedVisualResources.length === 1,
			),
		);

		expect(owners.createSnapshot().current).toEqual([
			expect.objectContaining({
				id: `runtime-entity:${entityId}`,
				kind: "runtime-entity",
			}),
		]);
		expect(renderer.resourceCommits.at(-1)?.addedVisualResources).toEqual([
			expect.objectContaining({
				entityId,
				resourceId: createDynamicVisualResourceId(entityId),
			}),
		]);
		expect(renderer.instanceCommits.at(-1)?.instances).toHaveLength(1);
		expect(system.createDiagnosticsSnapshot()).toMatchObject({
			commits: {
				dynamicInstanceCommitCount: expect.any(Number),
				dynamicResourceCommitCount: expect.any(Number),
				maxInstancesPerCommit: 1,
				maxResourcesPerCommit: 1,
			},
			prep: {
				bakeSuccessCount: 1,
				failed: 0,
				recipeResolvedCount: 1,
				started: 1,
			},
		});

		expect(system.destroyRuntimeEntity(entityId)).toBe(true);

		expect(renderer.resourceCommits.at(-1)?.removedVisualResourceIds).toEqual([
			createDynamicVisualResourceId(entityId),
		]);
		expect(renderer.instanceCommits.at(-1)?.instances).toEqual([]);
		expect(owners.createSnapshot().current).toEqual([]);
	});

	it("keeps render residence separate from runtime entity lifetime", async () => {
		const renderer = new FixtureDynamicRenderer();
		const owners = new MaterializationOwnerRegistry();
		const system = createSystem({ owners, renderer });
		const entityId = system.createRuntimeEntity(createRuntimeSpawnRequest());
		await waitFor(
			() => renderer.instanceCommits.at(-1)?.instances.length === 1,
		);

		expect(
			system.updateRuntimeEntityRenderResidence(
				entityId,
				{ kind: "no-residence", reason: "render-residence-evicted" },
				12,
			),
		).toBe(true);

		expect(renderer.resourceCommits.at(-1)?.addedVisualResources).toHaveLength(
			1,
		);
		expect(renderer.instanceCommits.at(-1)).toMatchObject({
			frameTimeSeconds: 12,
			instances: [],
		});

		expect(
			system.updateRuntimeEntityRenderResidence(
				entityId,
				{ kind: "outdoor-landblock", landblockId: 0xda55ffff },
				13,
			),
		).toBe(true);

		expect(renderer.instanceCommits.at(-1)).toMatchObject({
			frameTimeSeconds: 13,
			instances: [expect.objectContaining({ entityId })],
		});
	});

	it("parents static-authored dynamic children to replacement static owners", async () => {
		const renderer = new FixtureDynamicRenderer();
		const owners = new MaterializationOwnerRegistry();
		const system = createSystem({ owners, renderer });
		const parentOwnerId =
			"static-layer:outdoor-buildings:0xda55ffff" as MaterializationOwnerId;

		system.ingestStaticAuthoredPlacements({
			parentOwnerId,
			placements: [createStaticAuthoredPlacement(parentOwnerId)],
		});
		await waitFor(() =>
			renderer.resourceCommits.some(
				(commit) => commit.addedVisualResources.length === 1,
			),
		);

		expect(owners.createSnapshot().current).toEqual([
			expect.objectContaining({
				id: expect.stringContaining(
					"static-authored-dynamic:static-layer:outdoor-buildings:0xda55ffff",
				),
				kind: "static-authored-dynamic",
			}),
		]);

		system.removeStaticAuthoredChildrenForParent(parentOwnerId);

		expect(renderer.resourceCommits.at(-1)?.removedVisualResourceIds).toEqual([
			expect.stringContaining(
				"dynamic-visual-resource:static-authored-outdoor",
			),
		]);
		expect(owners.createSnapshot().current).toEqual([]);
	});
});

function createSystem(options: {
	readonly owners: MaterializationOwnerRegistry;
	readonly renderer: FixtureDynamicRenderer;
}): OpenWorldRuntimeEntitySystem {
	return new OpenWorldRuntimeEntitySystem({
		assetReader: createUnusedAssetReader(),
		createDynamicVisualBaker: () => new FixtureDynamicBaker(),
		createDynamicVisualRecipeResolver: () => new FixtureDynamicRecipeResolver(),
		objectVisualAtlasBuilder: createUnusedObjectVisualAtlasBuilder(),
		owners: options.owners,
		renderer: options.renderer,
		scheduleTexturePageBuilds: (request) => {
			options.renderer.scheduledTexturePageBuilds.push(request);
		},
		textureClaims: new OpenWorldTextureClaimRegistry(),
	});
}

class FixtureDynamicRecipeResolver implements DynamicVisualRecipeResolver {
	async resolveRecipe(
		request: DynamicVisualRecipeResolutionRequest,
	): Promise<DynamicEntityRecipe> {
		return {
			animationSelection: request.animationSelection,
			baseTransform: request.baseTransform,
			entityId: request.entityId,
			source: request.source,
			visual: {
				animation: null,
				materialPolicy: request.materialPolicy,
				materialSources: [],
				missingRefs: [],
				paletteSources: [],
				setupModel: createBakedSourceAsset(),
				sourceAssets: [],
				textureRefs: [],
			},
		};
	}
}

class FixtureDynamicBaker implements DynamicVisualBaker {
	async bake(input: DynamicVisualBakeInput): Promise<DynamicVisualBakeResult> {
		return {
			failures: [],
			product: {
				kind: "baked",
				resource: createBakedResource(input.recipe.entityId),
			},
			revision: input.revision,
		};
	}
}

class FixtureDynamicRenderer {
	readonly instanceCommits: DynamicRendererInstanceCommit[] = [];
	readonly resourceCommits: DynamicRendererResourceCommit[] = [];
	readonly scheduledTexturePageBuilds: OpenWorldRuntimeEntityTexturePageBuildRequest[] =
		[];

	commitDynamicResources(commit: DynamicRendererResourceCommit): void {
		this.resourceCommits.push(commit);
	}

	commitDynamicInstances(commit: DynamicRendererInstanceCommit): void {
		this.instanceCommits.push(commit);
	}
}

function createBakedResource(entityId: string): BakedDynamicVisualResource {
	return {
		entityId,
		materialSlots: [],
		materialSources: [],
		paletteSources: [],
		renderParts: [
			{
				bounds: {
					max: { x: 1, y: 1, z: 1 },
					min: { x: 0, y: 0, z: 0 },
				},
				indices: new Uint16Array([0, 1, 2]),
				indexType: "uint16",
				materialEntries: [],
				materialFamily: "solid-color",
				materialPass: "opaque",
				materialSlotIndices: [],
				partIndex: 0,
				positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
				renderPartId: `${entityId}:part:0`,
				renderState: {
					blend: false,
					cull: true,
					depthTest: true,
					depthWrite: true,
				},
				sourceAssetId: "setup-model/020003e5",
				texCoords: new Float32Array(),
				textureBindingIds: [],
				triangleCount: 1,
				vertexCount: 3,
			},
		],
		resourceId: createDynamicVisualResourceId(entityId),
		sourceAssets: [createBakedSourceAsset()],
		textureDependencies: [],
		textureRefs: [],
		textureRequirements: [],
	};
}

function createBakedSourceAsset(): BakedDynamicVisualResource["sourceAssets"][number] {
	const source = createSetupSourceIdentity();
	const gfxObj = createGfxObjSourceIdentity();
	return {
		bounds: null,
		debug: { sourceAssetId: "setup-model/020003e5" },
		defaultAnimation: null,
		identity: {
			kind: "static-object-source",
			sourceAssetKind: "setup-model",
			sourceDid: 0x020003e5,
		},
		invalidPolygonCount: 0,
		materialSlotCount: 0,
		partCount: 1,
		parts: [
			{
				defaultPlacements: [
					{
						orientation: { w: 1, x: 0, y: 0, z: 0 },
						origin: { x: 0, y: 0, z: 0 },
					},
				],
				bounds: null,
				geometry: {
					canonical: {
						gfxObj,
						kind: "static-object-canonical-geometry",
						partIndex: 0,
					},
					kind: "static-object-source-geometry",
					source,
				},
				gfxObj,
				invalidPolygonCount: 0,
				materialSlotCount: 0,
				materialSlots: [],
				partIndex: 0,
				physicsPolygonCount: 0,
				renderTriangleCount: 1,
				scale: { x: 1, y: 1, z: 1 },
				skippedPolygonCount: 0,
				source,
				triangles: [],
			},
		],
		physicsPolygonCount: 0,
		renderTriangleCount: 1,
		skippedPolygonCount: 0,
		sourceAssetKind: "setup-model",
	};
}

function createSetupSourceIdentity(): StaticObjectSourceIdentity {
	return {
		kind: "static-object-source",
		sourceAssetKind: "setup-model",
		sourceDid: 0x020003e5,
	};
}

function createGfxObjSourceIdentity(): StaticObjectSourceIdentity {
	return {
		kind: "static-object-source",
		sourceAssetKind: "gfx-obj",
		sourceDid: 0x01000001,
	};
}

function createRuntimeSpawnRequest(): RuntimeDynamicSpawnRequest {
	return {
		animationSelection: { kind: "none" },
		baseLocalPlacement: {
			orientation: { w: 1, x: 0, y: 0, z: 0 },
			origin: { x: 0, y: 0, z: 0 },
		},
		setupModelId: 0x020003e5,
		sourceResidence: {
			kind: "outdoor-landblock",
			landblockId: 0xda55ffff,
		},
	};
}

function createStaticAuthoredPlacement(
	parentOwnerId: MaterializationOwnerId,
): StaticAuthoredDynamicPlacementRecord {
	return {
		kind: "outdoor-static-object-dynamic-placement",
		owner: {
			domain: "outdoor-buildings",
			key: {
				kind: "outdoor-buildings",
				landblockId: 0xda55ffff,
			},
			kind: "layer-owner",
			ownerId: parentOwnerId,
		},
		placement: {
			classificationReason: "setup-default-animation",
			defaultAnimationId: 0x0300061b,
			domain: "outdoor-buildings",
			landblockId: 0xda55ffff,
			localPlacement: {
				orientation: { w: 1, x: 0, y: 0, z: 0 },
				origin: { x: 0, y: 0, z: 0 },
			},
			object: {
				instanceId: "building-0",
				objectKind: "building",
			},
			setupModelId: 0x020003e5,
			source: {
				sourceAssetKind: "setup-model",
				sourceDid: 0x020003e5,
			},
			sourceAssetId: "setup-model/020003e5",
			sourceResidence: {
				landblockId: 0xda55ffff,
			},
			sourceScale: { x: 1, y: 1, z: 1 },
		},
	};
}

function createUnusedAssetReader(): PreparedAssetReader {
	return {
		async requestPreparedAsset() {
			throw new Error(
				"Asset reader should not be used by runtime entity test.",
			);
		},
	};
}

function createUnusedObjectVisualAtlasBuilder(): OpenWorldObjectVisualAtlasBuilder {
	return {
		async planAtlasPlacement() {
			throw new Error(
				"Atlas builder should not be used without texture intents.",
			);
		},
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const startedAt = Date.now();
	while (!predicate()) {
		if (Date.now() - startedAt > 1000) {
			throw new Error("Timed out waiting for runtime entity condition.");
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}
