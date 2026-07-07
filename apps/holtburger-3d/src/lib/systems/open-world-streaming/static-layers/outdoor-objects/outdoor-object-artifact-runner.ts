import type { PreparedAssetReader } from "../../../../assets/contracts";
import type {
	OutdoorBuildingsLayerPayload,
	OutdoorExplicitObjectsLayerPayload,
	OutdoorGeneratedSceneryLayerPayload,
} from "../../../../renderer/types";
import type { OpenWorldStreamingStaticTaskStageTiming } from "../../diagnostics/contracts";
import type {
	OutdoorStaticObjectDomain,
	OutdoorStaticObjectsScopePayload,
	StaticAuthoredDynamicPlacementRecord,
	StaticBakeJobInput,
	StaticBakeJobResult,
	StaticBaker,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticLayerTaskRequest,
	StaticObjectGeometryStaticDrawUnit,
	StaticScopePayload,
} from "../../../../static/contracts";
import { StaticObjectBakeResourceProvider } from "../../../../static/objects/bake/static-object-bake-resources";
import { createStaticObjectTexturePlacementIntents } from "../../../../static/objects/bake/static-object-placement-planner";
import type { MaterializationOwnerId } from "../../owners/owner-id";
import { OpenWorldTextureClaimRegistry } from "../../texture-residency/claims/texture-claim-registry";
import {
	reserveObjectVisualTexturePlacements,
} from "../../texture-residency/placement/object-visual-texture-placement-plan";
import type { OpenWorldTexturePageBuildInput } from "../../texture-residency/page-build/protocol";
import type { OpenWorldObjectVisualAtlasBuilder } from "../../texture-residency/placement/object-visual-atlas-builder";
import {
	yieldToStaticMaterializationFrameBudget,
	type OpenWorldStaticMaterializationFrameBudget,
} from "../frame-budget";
import { bakeStaticJobWithBoundaryDiagnostics } from "../static-bake-boundary-diagnostics";

type OutdoorObjectLayerPayload =
	| OutdoorBuildingsLayerPayload
	| OutdoorExplicitObjectsLayerPayload
	| OutdoorGeneratedSceneryLayerPayload;

export interface OpenWorldOutdoorObjectArtifactRunnerOptions {
	readonly assetReader: PreparedAssetReader;
	readonly baker: StaticBaker;
	readonly frameBudget: OpenWorldStaticMaterializationFrameBudget;
	readonly resolver: StaticLandblockSceneLodSourceResolver;
	readonly objectVisualAtlasBuilder: OpenWorldObjectVisualAtlasBuilder;
	readonly textureClaims: OpenWorldTextureClaimRegistry;
}

export interface OpenWorldOutdoorObjectArtifactRequest {
	readonly ownerId: MaterializationOwnerId;
	readonly task: StaticLayerTaskRequest;
}

export interface OpenWorldOutdoorObjectLayerCommit {
	readonly kind: "outdoor-object-layer-commit";
	readonly ownerId: MaterializationOwnerId;
	readonly payload: OutdoorObjectLayerPayload;
	readonly sourcePayload: OutdoorStaticObjectsScopePayload;
	readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
	readonly staticAuthoredDynamicPlacements: readonly StaticAuthoredDynamicPlacementRecord[];
	readonly texturePageBuildRequests: readonly OpenWorldTexturePageBuildInput[];
}

export class OpenWorldOutdoorObjectArtifactRunner {
	readonly #assetReader: PreparedAssetReader;
	readonly #baker: StaticBaker;
	readonly #frameBudget: OpenWorldStaticMaterializationFrameBudget;
	readonly #resourceProvider: StaticObjectBakeResourceProvider;
	readonly #resolver: StaticLandblockSceneLodSourceResolver;
	readonly #objectVisualAtlasBuilder: OpenWorldObjectVisualAtlasBuilder;
	readonly #textureClaims: OpenWorldTextureClaimRegistry;

	constructor(options: OpenWorldOutdoorObjectArtifactRunnerOptions) {
		this.#assetReader = options.assetReader;
		this.#baker = options.baker;
		this.#frameBudget = options.frameBudget;
		this.#resourceProvider = new StaticObjectBakeResourceProvider({
			assetReader: options.assetReader,
		});
		this.#resolver = options.resolver;
		this.#objectVisualAtlasBuilder = options.objectVisualAtlasBuilder;
		this.#textureClaims = options.textureClaims;
	}

	async run(
		request: OpenWorldOutdoorObjectArtifactRequest,
	): Promise<OpenWorldOutdoorObjectLayerCommit> {
		const timing = new StaticArtifactStageTimer();
		const resolved = await timing.measure("resolve-source", () =>
			this.#resolveObjectRecipe(request.task),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const sourcePayload = requireOutdoorObjectSourcePayload(resolved);
		const textureIntents = await timing.measure("create-texture-intents", () =>
			createStaticObjectTexturePlacementIntents({
				assetReader: this.#assetReader,
				items: [{ payload: resolved, task: request.task }],
				planningBudget: {
					yieldToFrameBudget: () =>
						yieldToStaticMaterializationFrameBudget(this.#frameBudget),
				},
			}),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const textureReservation = await timing.measure(
			"texture-placement-reservation",
			() =>
				reserveObjectVisualTexturePlacements({
					atlasBuilder: this.#objectVisualAtlasBuilder,
					filteringMode: "nearest",
					intents: textureIntents,
					ownerId: request.ownerId,
					textureClaims: this.#textureClaims,
				}),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const bakeInput = await timing.measure("create-bake-resources", () =>
			this.#createOutdoorObjectBakeJobInput(
				request.task,
				resolved,
				textureReservation.placementSnapshot,
			),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const baked = await timing.measure("bake", () =>
			bakeStaticJobWithBoundaryDiagnostics(this.#baker, bakeInput),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const payload = timing.measureSync("assemble-commit", () =>
			createOutdoorObjectLayerPayload({
				baked: baked.result,
				domain: sourcePayload.domain,
				task: request.task,
			}),
		);
		return {
			kind: "outdoor-object-layer-commit",
			ownerId: request.ownerId,
			payload,
			sourcePayload,
			stageTimings: [
				...timing.createSnapshot(),
				...baked.stageTimings,
				...textureReservation.stageTimings,
			],
			staticAuthoredDynamicPlacements:
				sourcePayload.authoredDynamicPlacements.map((placement) => ({
					kind: "outdoor-static-object-dynamic-placement",
					owner: {
						domain: sourcePayload.domain,
						key: request.task.ownerKey,
						kind: "layer-owner",
						ownerId: request.ownerId,
					},
					placement,
				})),
			texturePageBuildRequests: textureReservation.pageBuildRequests,
		};
	}

	async #resolveObjectRecipe(
		task: StaticLayerTaskRequest,
	): Promise<StaticScopePayload> {
		const resolution = await this.#resolver.resolveSource(
			createOutdoorObjectSourceRequest(task),
		);
		const recipe = resolution.recipes.find(
			(candidate) =>
				candidate.payload.job.domain === task.domain &&
				candidate.targetOwnerKey.kind === task.ownerKey.kind &&
				candidate.targetOwnerKey.landblockId === task.ownerKey.landblockId,
		);
		if (!recipe) {
			throw new Error(
				`Outdoor object source fanout did not return ${task.domain} recipe for ${task.ownerId}.`,
			);
		}
		return recipe.payload;
	}
	async #createOutdoorObjectBakeJobInput(
		task: StaticLayerTaskRequest,
		payload: StaticScopePayload,
		texturePlacementSnapshot: StaticBakeJobInput["texturePlacementSnapshot"],
	): Promise<StaticBakeJobInput> {
		return {
			domain: task.domain,
			payload,
			resources: await this.#resourceProvider.createResources({
				domain: task.domain,
				payload,
				revision: task.revision,
				task,
			}),
			revision: task.revision,
			task,
			texturePlacementSnapshot,
		};
	}
}

class StaticArtifactStageTimer {
	readonly #timings: OpenWorldStreamingStaticTaskStageTiming[] = [];

	async measure<T>(
		stage: OpenWorldStreamingStaticTaskStageTiming["stage"],
		createValue: () => Promise<T>,
	): Promise<T> {
		const startedAtMs = nowMs();
		try {
			return await createValue();
		} finally {
			this.#timings.push({
				durationMs: nowMs() - startedAtMs,
				stage,
			});
		}
	}

	measureSync<T>(
		stage: OpenWorldStreamingStaticTaskStageTiming["stage"],
		createValue: () => T,
	): T {
		const startedAtMs = nowMs();
		try {
			return createValue();
		} finally {
			this.#timings.push({
				durationMs: nowMs() - startedAtMs,
				stage,
			});
		}
	}

	createSnapshot(): readonly OpenWorldStreamingStaticTaskStageTiming[] {
		return this.#timings;
	}
}

function nowMs(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function createOutdoorObjectSourceRequest(
	task: StaticLayerTaskRequest,
): StaticLandblockSceneLodSourceRequest {
	const layerKind = toOutdoorObjectLayerKind(task.domain);
	return {
		context: "outdoor",
		landblockId: task.scope.landblockId,
		requestedLayers: [
			{
				kind: layerKind,
				targetOwnerKey: task.ownerKey,
			},
		],
		sourceLod: sourceLodForOutdoorObjectLayer(layerKind),
	};
}

function requireOutdoorObjectSourcePayload(
	payload: StaticScopePayload,
): OutdoorStaticObjectsScopePayload {
	if (payload.scope.kind !== "outdoor-static-objects") {
		throw new Error(
			`Outdoor object artifact runner expected outdoor-static-objects source payload, received ${payload.scope.kind}.`,
		);
	}
	return payload.scope;
}

function createOutdoorObjectLayerPayload(input: {
	readonly baked: StaticBakeJobResult;
	readonly domain: OutdoorStaticObjectDomain;
	readonly task: StaticLayerTaskRequest;
}): OutdoorObjectLayerPayload {
	const objectDrawUnits =
		input.baked.objectVisualInstallSet.directDrawUnits.filter(
			(drawUnit): drawUnit is StaticObjectGeometryStaticDrawUnit =>
				drawUnit.kind === "static-object-geometry" &&
				drawUnit.domain === input.domain,
		);
	const base = {
		generationId: `${input.task.taskId}:${input.domain}`,
		landblockId: input.task.scope.landblockId,
		materialCoverage: input.baked.materialCoverage,
		sourceMappingRecords: input.baked.staticSourceMappings,
		spatialRecords: input.baked.staticSpatialRecords,
		textureUses: input.baked.textureUses,
	};
	switch (input.domain) {
		case "outdoor-buildings":
			return {
				...base,
				drawUnits: objectDrawUnits.filter(
					(
						drawUnit,
					): drawUnit is OutdoorBuildingsLayerPayload["drawUnits"][number] =>
						drawUnit.domain === "outdoor-buildings",
				),
				kind: "outdoor-buildings",
			};
		case "outdoor-explicit-objects":
			return {
				...base,
				drawUnits: objectDrawUnits.filter(
					(
						drawUnit,
					): drawUnit is OutdoorExplicitObjectsLayerPayload["drawUnits"][number] =>
						drawUnit.domain === "outdoor-explicit-objects",
				),
				kind: "outdoor-explicit-objects",
			};
		case "outdoor-generated-scenery":
			return {
				...base,
				drawUnits: objectDrawUnits.filter(
					(
						drawUnit,
					): drawUnit is OutdoorGeneratedSceneryLayerPayload["drawUnits"][number] =>
						drawUnit.domain === "outdoor-generated-scenery",
				),
				instancedObjectInstances:
					input.baked.objectVisualInstallSet.renderInstances.filter(
						(instance) => instance.domain === input.domain,
					),
				instancedObjectResources:
					input.baked.objectVisualInstallSet.visualResources.filter(
						(resource) =>
							input.baked.objectVisualInstallSet.renderInstances.some(
								(instance) =>
									instance.domain === input.domain &&
									instance.resourceId === resource.resourceId,
							),
					),
				kind: "outdoor-generated-scenery",
			};
	}
}

function toOutdoorObjectLayerKind(
	domain: StaticLayerTaskRequest["domain"],
): Extract<
	StaticLandblockSceneLodSourceRequest["requestedLayers"][number]["kind"],
	"outdoor-buildings" | "outdoor-explicit-objects" | "outdoor-generated-scenery"
> {
	switch (domain) {
		case "outdoor-buildings":
		case "outdoor-explicit-objects":
		case "outdoor-generated-scenery":
			return domain;
		case "outdoor-terrain":
		case "env-cell-system":
			throw new Error(`Unsupported outdoor object domain: ${domain}.`);
	}
}

function sourceLodForOutdoorObjectLayer(
	kind: ReturnType<typeof toOutdoorObjectLayerKind>,
): StaticLandblockSceneLodSourceRequest["sourceLod"] {
	switch (kind) {
		case "outdoor-buildings":
			return 1;
		case "outdoor-explicit-objects":
			return 2;
		case "outdoor-generated-scenery":
			return 3;
	}
}
