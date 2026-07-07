import type { PreparedAssetReader } from "../../../../assets/contracts";
import type { TerrainLayerPayload } from "../../../../renderer/types";
import type {
	StaticBakeJobInput,
	StaticBaker,
	StaticDrawUnit,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticLayerTaskRequest,
	StaticScopePayload,
	TerrainStaticScopePayload,
} from "../../../../static/contracts";
import { createTerrainTexturePlacementIntents } from "../../../../static/terrain/bake/terrain-geometry-baker";
import type {
	TexturePlacement,
	TexturePlacementIntent,
	TexturePlacementSnapshot,
} from "../../../../textures/placement";
import type { TextureFilteringMode } from "../../../../textures/sampling-policy";
import type { MaterializationOwnerId } from "../../owners/owner-id";
import type { OpenWorldStreamingStaticTaskStageTiming } from "../../diagnostics/contracts";
import type { OpenWorldTexturePageBuildInput } from "../../texture-residency/page-build/protocol";
import type { OpenWorldTextureResidencyService } from "../../texture-residency/texture-residency-service";
import {
	yieldToStaticMaterializationFrameBudget,
	type OpenWorldStaticMaterializationFrameBudget,
} from "../frame-budget";
import { bakeStaticJobWithBoundaryDiagnostics } from "../static-bake-boundary-diagnostics";

export interface OpenWorldTerrainArtifactRunnerOptions {
	readonly assetReader: PreparedAssetReader;
	readonly baker: StaticBaker;
	readonly frameBudget: OpenWorldStaticMaterializationFrameBudget;
	readonly resolver: StaticLandblockSceneLodSourceResolver;
	readonly textureResidency: OpenWorldTextureResidencyService;
}

export interface OpenWorldTerrainArtifactRequest {
	readonly filteringMode: TextureFilteringMode;
	readonly isCurrent: () => boolean;
	readonly ownerId: MaterializationOwnerId;
	readonly task: StaticLayerTaskRequest;
}

export interface OpenWorldTerrainLayerCommit {
	readonly kind: "terrain-layer-commit";
	readonly ownerId: MaterializationOwnerId;
	readonly payload: TerrainLayerPayload;
	readonly sourcePayload: TerrainStaticScopePayload;
	readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
	readonly texturePageBuildRequests: readonly OpenWorldTexturePageBuildInput[];
	readonly textureReadiness: readonly OpenWorldTerrainTextureReadiness[];
}

interface OpenWorldTerrainTextureReadiness {
	readonly bindingId: string;
	readonly kind: "pending";
}

export class OpenWorldTerrainArtifactRunner {
	readonly #assetReader: PreparedAssetReader;
	readonly #baker: StaticBaker;
	readonly #frameBudget: OpenWorldStaticMaterializationFrameBudget;
	readonly #resolver: StaticLandblockSceneLodSourceResolver;
	readonly #textureResidency: OpenWorldTextureResidencyService;

	constructor(options: OpenWorldTerrainArtifactRunnerOptions) {
		this.#assetReader = options.assetReader;
		this.#baker = options.baker;
		this.#frameBudget = options.frameBudget;
		this.#resolver = options.resolver;
		this.#textureResidency = options.textureResidency;
	}

	async run(
		request: OpenWorldTerrainArtifactRequest,
	): Promise<OpenWorldTerrainLayerCommit> {
		const timing = new StaticArtifactStageTimer();
		const resolved = await timing.measure("resolve-source", () =>
			this.#resolveTerrainRecipe(request.task),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const sourcePayload = requireTerrainSourcePayload(resolved);
		const textureIntents = await timing.measure("create-texture-intents", () =>
			createTerrainTexturePlacementIntents({
				assetReader: this.#assetReader,
				items: [{ payload: resolved, task: request.task }],
			}),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const textureReservation = await timing.measure(
			"texture-placement-reservation",
			() =>
				this.#textureResidency.reserveMaterialPlacements<
					string,
					TexturePlacementIntent
				>({
					filteringMode: request.filteringMode,
					intents: textureIntents,
					isCurrent: request.isCurrent,
					jobPrefix: "open-world-terrain",
					ownerId: request.ownerId,
					revision: request.task.revision,
				}),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const bakeInput = timing.measureSync("create-bake-resources", () =>
			createTerrainBakeJobInput(
				request.task,
				resolved,
				createTerrainTexturePlacementSnapshot(
					textureReservation.bindingPlacements,
				),
			),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const baked = await timing.measure("bake", () =>
			bakeStaticJobWithBoundaryDiagnostics(this.#baker, bakeInput),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const payload = timing.measureSync("assemble-commit", () => ({
			drawUnits: baked.result.drawUnits.filter(
				(drawUnit) => drawUnit.kind === "terrain-geometry",
			),
			generationId: `${request.task.taskId}:terrain`,
			kind: "terrain" as const,
			landblockId: request.task.scope.landblockId,
			materialCoverage: baked.result.materialCoverage,
			sourceMappingRecords: baked.result.staticSourceMappings,
			spatialRecords: baked.result.staticSpatialRecords,
			textureUses: baked.result.textureUses,
		}));
		return {
			kind: "terrain-layer-commit",
			ownerId: request.ownerId,
			payload,
			sourcePayload,
			stageTimings: [
				...timing.createSnapshot(),
				...baked.stageTimings,
				...textureReservation.stageTimings,
			],
			texturePageBuildRequests: textureReservation.pageBuildRequests,
			textureReadiness: createPendingTerrainTextureReadiness(
				baked.result.drawUnits,
			),
		};
	}

	async #resolveTerrainRecipe(
		task: StaticLayerTaskRequest,
	): Promise<StaticScopePayload> {
		const resolution = await this.#resolver.resolveSource(
			createTerrainSourceRequest(task),
		);
		const recipe = resolution.recipes.find(
			(candidate) =>
				candidate.payload.job.domain === "outdoor-terrain" &&
				candidate.targetOwnerKey.kind === task.ownerKey.kind &&
				candidate.targetOwnerKey.landblockId === task.ownerKey.landblockId,
		);
		if (!recipe) {
			throw new Error(
				`Terrain source fanout did not return a terrain recipe for ${task.ownerId}.`,
			);
		}
		return recipe.payload;
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

function createTerrainBakeJobInput(
	task: StaticLayerTaskRequest,
	payload: StaticScopePayload,
	texturePlacementSnapshot: TexturePlacementSnapshot,
): StaticBakeJobInput {
	return {
		domain: "outdoor-terrain",
		payload,
		resources: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: [],
		},
		revision: task.revision,
		task,
		texturePlacementSnapshot,
	};
}

function createTerrainSourceRequest(
	task: StaticLayerTaskRequest,
): StaticLandblockSceneLodSourceRequest {
	return {
		context: "outdoor",
		landblockId: task.scope.landblockId,
		requestedLayers: [
			{
				kind: "terrain",
				targetOwnerKey: task.ownerKey,
			},
		],
		sourceLod: 0,
	};
}

function requireTerrainSourcePayload(
	payload: StaticScopePayload,
): TerrainStaticScopePayload {
	if (payload.scope.kind !== "terrain") {
		throw new Error(
			`Terrain artifact runner expected terrain source payload, received ${payload.scope.kind}.`,
		);
	}
	return payload.scope;
}

function createTerrainTexturePlacementSnapshot(
	bindingPlacements: readonly {
		readonly placement: TexturePlacement;
	}[],
): TexturePlacementSnapshot {
	return {
		placementsByItemId: new Map(
			bindingPlacements.map((binding) => [
				binding.placement.itemId,
				binding.placement,
			]),
		),
	};
}

function createPendingTerrainTextureReadiness(
	drawUnits: readonly StaticDrawUnit[],
): readonly OpenWorldTerrainTextureReadiness[] {
	const bindingIds = new Set<string>();
	for (const drawUnit of drawUnits) {
		for (const bindingId of drawUnit.textureBindingIds) {
			bindingIds.add(bindingId);
		}
	}
	return [...bindingIds].sort().map((bindingId) => ({
		bindingId,
		kind: "pending" as const,
	}));
}
