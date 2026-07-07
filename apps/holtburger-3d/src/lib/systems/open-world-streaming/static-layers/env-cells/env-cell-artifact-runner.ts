import type { PreparedAssetReader } from "../../../../assets/contracts";
import {
	createStaticLandblockLayerGenerationId,
	type EnvCellSystemLayerPayload,
} from "../../../../renderer/types";
import type { OpenWorldStreamingStaticTaskStageTiming } from "../../diagnostics/contracts";
import { CompositeStaticBakeResourceProvider } from "../../../../static/bake/resources";
import type {
	EnvCellSystemStaticScopePayload,
	StaticAuthoredDynamicPlacementRecord,
	StaticBakeJobInput,
	StaticBakeJobResult,
	StaticBaker,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticLayerTaskRequest,
	StaticObjectGeometryStaticDrawUnit,
	StaticScopePayload,
	StructuredInteriorGeometryStaticDrawUnit,
} from "../../../../static/contracts";
import { EnvCellSystemGeometryResourceProvider } from "../../../../static/env-cells/bake/env-cell-system-geometry-resources";
import { createStructuredInteriorTexturePlacementIntentResult } from "../../../../static/env-cells/bake/structured-interior-placement-planner";
import { StaticObjectBakeResourceProvider } from "../../../../static/objects/bake/static-object-bake-resources";
import { createStaticObjectTexturePlacementIntentResult } from "../../../../static/objects/bake/static-object-placement-planner";
import {
	createOutdoorPortalProjectionRoot,
	createStaticPortalProjection,
} from "../../../../static/portal-graphs";
import type { MaterializationOwnerId } from "../../owners/owner-id";
import { OpenWorldTextureClaimRegistry } from "../../texture-residency/claims/texture-claim-registry";
import type { OpenWorldStreamingTextureCommit } from "../../texture-residency/commits/contracts";
import { buildObjectVisualTexturePlacementPlan } from "../../texture-residency/placement/object-visual-texture-placement-plan";
import type { OpenWorldObjectVisualAtlasBuilder } from "../../texture-residency/placement/object-visual-atlas-builder";
import {
	yieldToStaticMaterializationFrameBudget,
	type OpenWorldStaticMaterializationFrameBudget,
} from "../frame-budget";
import { bakeStaticJobWithBoundaryDiagnostics } from "../static-bake-boundary-diagnostics";

export interface OpenWorldEnvCellArtifactRunnerOptions {
	readonly assetReader: PreparedAssetReader;
	readonly baker: StaticBaker;
	readonly frameBudget: OpenWorldStaticMaterializationFrameBudget;
	readonly resolver: StaticLandblockSceneLodSourceResolver;
	readonly objectVisualAtlasBuilder: OpenWorldObjectVisualAtlasBuilder;
	readonly textureClaims: OpenWorldTextureClaimRegistry;
}

export interface OpenWorldEnvCellArtifactRequest {
	readonly ownerId: MaterializationOwnerId;
	readonly task: StaticLayerTaskRequest;
}

export interface OpenWorldEnvCellSystemLayerCommit {
	readonly kind: "env-cell-system-layer-commit";
	readonly ownerId: MaterializationOwnerId;
	readonly payload: EnvCellSystemLayerPayload;
	readonly sourcePayload: EnvCellSystemStaticScopePayload;
	readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
	readonly staticAuthoredDynamicPlacements: readonly StaticAuthoredDynamicPlacementRecord[];
	readonly textureCommits: readonly OpenWorldStreamingTextureCommit[];
}

export class OpenWorldEnvCellArtifactRunner {
	readonly #assetReader: PreparedAssetReader;
	readonly #baker: StaticBaker;
	readonly #frameBudget: OpenWorldStaticMaterializationFrameBudget;
	readonly #resourceProvider: CompositeStaticBakeResourceProvider;
	readonly #resolver: StaticLandblockSceneLodSourceResolver;
	readonly #objectVisualAtlasBuilder: OpenWorldObjectVisualAtlasBuilder;
	readonly #textureClaims: OpenWorldTextureClaimRegistry;

	constructor(options: OpenWorldEnvCellArtifactRunnerOptions) {
		this.#assetReader = options.assetReader;
		this.#baker = options.baker;
		this.#frameBudget = options.frameBudget;
		this.#resourceProvider = new CompositeStaticBakeResourceProvider([
			new EnvCellSystemGeometryResourceProvider(),
			new StaticObjectBakeResourceProvider({
				assetReader: options.assetReader,
			}),
		]);
		this.#resolver = options.resolver;
		this.#objectVisualAtlasBuilder = options.objectVisualAtlasBuilder;
		this.#textureClaims = options.textureClaims;
	}

	async run(
		request: OpenWorldEnvCellArtifactRequest,
	): Promise<OpenWorldEnvCellSystemLayerCommit> {
		const timing = new StaticArtifactStageTimer();
		const resolved = await timing.measure("resolve-source", () =>
			this.#resolveEnvCellRecipe(request.task),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const sourcePayload = requireEnvCellSourcePayload(resolved);
		const textureIntents = await timing.measure("create-texture-intents", () =>
			this.#createTexturePlacementIntents({
				payload: resolved,
				task: request.task,
			}),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const texturePlan = await timing.measure("texture-placement", () =>
			buildObjectVisualTexturePlacementPlan({
				atlasBuilder: this.#objectVisualAtlasBuilder,
				filteringMode: "nearest",
				intents: textureIntents.intents,
				ownerId: request.ownerId,
				textureClaims: this.#textureClaims,
			}),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const bakeInput = await timing.measure("create-bake-resources", () =>
			this.#createEnvCellBakeJobInput(
				request.task,
				resolved,
				texturePlan.placementSnapshot,
			),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const baked = await timing.measure("bake", () =>
			bakeStaticJobWithBoundaryDiagnostics(this.#baker, bakeInput),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const payload = timing.measureSync("assemble-commit", () =>
			createEnvCellSystemLayerPayload({
				baked: baked.result,
				sourcePayload,
				task: request.task,
			}),
		);
		return {
			kind: "env-cell-system-layer-commit",
			ownerId: request.ownerId,
			payload,
			sourcePayload,
			stageTimings: [
				...timing.createSnapshot(),
				...baked.stageTimings,
				...textureIntents.stageTimings,
				...texturePlan.stageTimings,
			],
			staticAuthoredDynamicPlacements: sourcePayload.envCells.flatMap(
				(envCell) =>
					envCell.authoredDynamicPlacements.map((placement) => ({
						kind: "env-cell-static-object-dynamic-placement",
						owner: {
							domain: "env-cell-system",
							key: request.task.ownerKey,
							kind: "layer-owner",
							ownerId: request.ownerId,
						},
						placement,
					})),
			),
			textureCommits: texturePlan.textureCommits,
		};
	}

	async #resolveEnvCellRecipe(
		task: StaticLayerTaskRequest,
	): Promise<StaticScopePayload> {
		const resolution = await this.#resolver.resolveSource(
			createEnvCellSourceRequest(task),
		);
		const recipe = resolution.recipes.find(
			(candidate) =>
				candidate.payload.job.domain === "env-cell-system" &&
				candidate.targetOwnerKey.kind === task.ownerKey.kind &&
				candidate.targetOwnerKey.landblockId === task.ownerKey.landblockId,
		);
		if (!recipe) {
			throw new Error(
				`Env-cell source fanout did not return env-cell-system recipe for ${task.ownerId}.`,
			);
		}
		return recipe.payload;
	}

	async #createTexturePlacementIntents(
		item: Parameters<
			typeof createStructuredInteriorTexturePlacementIntentResult
		>[0]["items"][number],
	): Promise<{
		readonly intents: Awaited<
			ReturnType<typeof createStructuredInteriorTexturePlacementIntentResult>
		>["intents"];
		readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
	}> {
		const items = [item];
		const structuredInterior = await measureLocalStage(
			"texture-intent-structured-interior",
			() =>
				createStructuredInteriorTexturePlacementIntentResult({
					assetReader: this.#assetReader,
					items,
					planningBudget: this.#createTextureIntentPlanningBudget(),
				}),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const staticObject = await measureLocalStage(
			"texture-intent-static-object",
			() =>
				createStaticObjectTexturePlacementIntentResult({
					assetReader: this.#assetReader,
					items,
					planningBudget: this.#createTextureIntentPlanningBudget(),
				}),
		);
		return {
			intents: [
				...structuredInterior.value.intents,
				...staticObject.value.intents,
			],
			stageTimings: [
				structuredInterior.stageTiming,
				staticObject.stageTiming,
				...structuredInterior.value.stageTimings,
				...staticObject.value.stageTimings,
			],
		};
	}

	#createTextureIntentPlanningBudget() {
		return {
			maxMsBeforeYield: 4,
			yieldToFrameBudget: () =>
				yieldToStaticMaterializationFrameBudget(this.#frameBudget),
		};
	}

	async #createEnvCellBakeJobInput(
		task: StaticLayerTaskRequest,
		payload: StaticScopePayload,
		texturePlacementSnapshot: StaticBakeJobInput["texturePlacementSnapshot"],
	): Promise<StaticBakeJobInput> {
		return {
			domain: "env-cell-system",
			payload,
			resources: await this.#resourceProvider.createResources({
				domain: "env-cell-system",
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

async function measureLocalStage<T>(
	stage: OpenWorldStreamingStaticTaskStageTiming["stage"],
	createValue: () => Promise<T>,
): Promise<{
	readonly stageTiming: OpenWorldStreamingStaticTaskStageTiming;
	readonly value: T;
}> {
	const startedAtMs = nowMs();
	const value = await createValue();
	return {
		stageTiming: {
			durationMs: nowMs() - startedAtMs,
			stage,
		},
		value,
	};
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

function createEnvCellSourceRequest(
	task: StaticLayerTaskRequest,
): StaticLandblockSceneLodSourceRequest {
	return {
		context: "outdoor",
		landblockId: task.scope.landblockId,
		requestedLayers: [
			{
				kind: "env-cell-system",
				targetOwnerKey: task.ownerKey,
			},
		],
		sourceLod: 4,
	};
}

function requireEnvCellSourcePayload(
	payload: StaticScopePayload,
): EnvCellSystemStaticScopePayload {
	if (payload.scope.kind !== "env-cell-system") {
		throw new Error(
			`Env-cell artifact runner expected env-cell-system source payload, received ${payload.scope.kind}.`,
		);
	}
	return payload.scope;
}

function createEnvCellSystemLayerPayload(input: {
	readonly baked: StaticBakeJobResult;
	readonly sourcePayload: EnvCellSystemStaticScopePayload;
	readonly task: StaticLayerTaskRequest;
}): EnvCellSystemLayerPayload {
	const landblockId = input.task.scope.landblockId;
	const envCellStaticObjectDrawUnits =
		input.baked.objectVisualInstallSet.directDrawUnits.filter(
			(
				drawUnit,
			): drawUnit is EnvCellSystemLayerPayload["envCellStaticObjectDrawUnits"][number] =>
				drawUnit.kind === "static-object-geometry" &&
				drawUnit.domain === "env-cell-system",
		);
	const structuredInteriorDrawUnits =
		input.baked.objectVisualInstallSet.directDrawUnits.filter(
			(drawUnit): drawUnit is StructuredInteriorGeometryStaticDrawUnit =>
				drawUnit.kind === "structured-interior-geometry",
		);
	const portalProjectionRecords = createPortalProjectionRecords({
		landblockId,
		portalApertureResources: input.baked.portalApertureResources,
		portalGraphs: input.baked.staticPortalGraphs,
		portalInteriorRecords: input.baked.staticPortalInteriorRecords,
	});
	return {
		envCellStaticObjectDrawUnits,
		envCellStaticObjectPlacementRecords:
			input.baked.envCellStaticObjectPlacementRecords,
		generationId: createStaticLandblockLayerGenerationId({
			kind: "env-cell-system",
			landblockId,
			sourceKey: [
				`revision:${input.baked.revision}`,
				`apertures:${input.baked.portalApertureResources
					.flatMap((resource) => resource.ranges.map((range) => range.rangeId))
					.sort(compareStrings)
					.join(",")}`,
				`projections:${portalProjectionRecords
					.map((record) => record.sourceRevisionKey)
					.sort(compareStrings)
					.join(",")}`,
			].join("|"),
		}),
		kind: "env-cell-system",
		landblockId,
		materialCoverage: input.baked.materialCoverage,
		portalApertureResources: input.baked.portalApertureResources,
		portalGraphRecords: input.baked.staticPortalGraphs,
		portalInteriorRecords: input.baked.staticPortalInteriorRecords,
		portalProjectionRecords,
		resourceMembership: createResourceMembership({
			envCellStaticObjectDrawUnits,
			structuredInteriorDrawUnits,
		}),
		sourceMappingRecords: input.baked.staticSourceMappings,
		spatialRecords: input.baked.staticSpatialRecords,
		structuredInteriorDrawUnits,
		textureUses: input.baked.textureUses,
		visibilityRecords: input.baked.staticVisibilityRecords,
	};
}

function createPortalProjectionRecords(options: {
	readonly landblockId: number;
	readonly portalApertureResources: EnvCellSystemLayerPayload["portalApertureResources"];
	readonly portalGraphs: EnvCellSystemLayerPayload["portalGraphRecords"];
	readonly portalInteriorRecords: EnvCellSystemLayerPayload["portalInteriorRecords"];
}): EnvCellSystemLayerPayload["portalProjectionRecords"] {
	const projection = createStaticPortalProjection({
		landblockId: options.landblockId,
		portalApertureResources: options.portalApertureResources,
		portalGraphs: options.portalGraphs,
		portalInteriorRecords: options.portalInteriorRecords,
		root: createOutdoorPortalProjectionRoot(options.landblockId),
	});
	return projection ? [projection] : [];
}

function createResourceMembership(input: {
	readonly envCellStaticObjectDrawUnits: readonly StaticObjectGeometryStaticDrawUnit[];
	readonly structuredInteriorDrawUnits: readonly StructuredInteriorGeometryStaticDrawUnit[];
}): EnvCellSystemLayerPayload["resourceMembership"] {
	const membershipByEnvCellId = new Map<
		number,
		{
			envCellStaticObjectDrawUnitIds: string[];
			structuredInteriorDrawUnitIds: string[];
		}
	>();
	for (const drawUnit of input.structuredInteriorDrawUnits) {
		getOrCreateMembership(
			membershipByEnvCellId,
			drawUnit.envCellId,
		).structuredInteriorDrawUnitIds.push(drawUnit.drawUnitId);
	}
	for (const drawUnit of input.envCellStaticObjectDrawUnits) {
		if (drawUnit.ownership.kind !== "env-cell-static-object-placements") {
			continue;
		}
		for (const envCellId of drawUnit.ownership.envCellIds) {
			getOrCreateMembership(
				membershipByEnvCellId,
				envCellId,
			).envCellStaticObjectDrawUnitIds.push(drawUnit.drawUnitId);
		}
	}
	return [...membershipByEnvCellId.entries()]
		.map(([envCellId, membership]) => ({
			envCellId,
			envCellStaticObjectDrawUnitIds:
				membership.envCellStaticObjectDrawUnitIds.sort(compareStrings),
			structuredInteriorDrawUnitIds:
				membership.structuredInteriorDrawUnitIds.sort(compareStrings),
		}))
		.sort((left, right) => left.envCellId - right.envCellId);
}

function getOrCreateMembership(
	membershipByEnvCellId: Map<
		number,
		{
			envCellStaticObjectDrawUnitIds: string[];
			structuredInteriorDrawUnitIds: string[];
		}
	>,
	envCellId: number,
) {
	const existing = membershipByEnvCellId.get(envCellId);
	if (existing) {
		return existing;
	}
	const created = {
		envCellStaticObjectDrawUnitIds: [],
		structuredInteriorDrawUnitIds: [],
	};
	membershipByEnvCellId.set(envCellId, created);
	return created;
}

function compareStrings(left: string, right: string): number {
	return left.localeCompare(right);
}
