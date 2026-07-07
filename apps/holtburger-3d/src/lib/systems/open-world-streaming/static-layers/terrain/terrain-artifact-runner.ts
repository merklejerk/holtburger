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
import type { MaterializationOwnerId } from "../../owners/owner-id";
import type { OpenWorldStreamingStaticTaskStageTiming } from "../../diagnostics/contracts";
import { createOpenWorldTextureBucketKey } from "../../texture-residency/claims/bucket-key";
import type { OpenWorldTextureBucketKey } from "../../texture-residency/claims/bucket-key";
import {
	OpenWorldTextureClaimRegistry,
	type OpenWorldTextureBindingRequirement,
} from "../../texture-residency/claims/texture-claim-registry";
import type { OpenWorldStreamingTextureCommit } from "../../texture-residency/commits/contracts";
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
	readonly textureClaims: OpenWorldTextureClaimRegistry;
}

export interface OpenWorldTerrainArtifactRequest {
	readonly ownerId: MaterializationOwnerId;
	readonly task: StaticLayerTaskRequest;
}

export interface OpenWorldTerrainLayerCommit {
	readonly kind: "terrain-layer-commit";
	readonly ownerId: MaterializationOwnerId;
	readonly payload: TerrainLayerPayload;
	readonly sourcePayload: TerrainStaticScopePayload;
	readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
	readonly textureCommit: OpenWorldStreamingTextureCommit | null;
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
	readonly #textureClaims: OpenWorldTextureClaimRegistry;

	constructor(options: OpenWorldTerrainArtifactRunnerOptions) {
		this.#assetReader = options.assetReader;
		this.#baker = options.baker;
		this.#frameBudget = options.frameBudget;
		this.#resolver = options.resolver;
		this.#textureClaims = options.textureClaims;
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
		const texturePlan = timing.measureSync("texture-placement", () =>
			this.#createBakeTexturePlan(request, textureIntents),
		);
		await yieldToStaticMaterializationFrameBudget(this.#frameBudget);
		const bakeInput = timing.measureSync("create-bake-resources", () =>
			createTerrainBakeJobInput(
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
			stageTimings: [...timing.createSnapshot(), ...baked.stageTimings],
			textureCommit: texturePlan.textureCommit,
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

	#createBakeTexturePlan(
		request: OpenWorldTerrainArtifactRequest,
		intents: readonly TexturePlacementIntent[],
	): {
		readonly placementSnapshot: TexturePlacementSnapshot;
		readonly textureCommit: OpenWorldStreamingTextureCommit | null;
	} {
		const claimsByBucket = new Map<
			OpenWorldTextureBucketKey,
			OpenWorldTextureBindingRequirement[]
		>();
		const placementsByItemId = new Map<string, TexturePlacement>();
		const bindingUpdates: Array<
			OpenWorldStreamingTextureCommit["bindingUpdates"][number]
		> = [];
		const pageUpdates: Array<
			OpenWorldStreamingTextureCommit["pageUpdates"][number]
		> = [];
		const committedPagePurposes = new Set<TexturePlacement["purpose"]>();

		for (const intent of intents) {
			const bucketKey = createOpenWorldTextureBucketKey({
				domain: intent.domain,
				purpose: intent.purpose,
				scope: { kind: "static-domain" },
			});
			const claims = claimsByBucket.get(bucketKey) ?? [];
			claims.push({
				affinityKey: intent.affinityKey,
				bindingId: intent.bindingId,
				bucketKey,
				pageClass: intent.pageClass,
				purpose: intent.purpose,
				sourceKey: createTextureClaimSourceKey(intent),
				textureKey: intent.textureKey,
			});
			claimsByBucket.set(bucketKey, claims);
			const textureRefId = createSyntheticTerrainBakeTextureRefId(
				intent.purpose,
			);
			const pageId = createSyntheticTerrainBakePageId(intent.purpose);
			placementsByItemId.set(intent.itemId, {
				height: 1,
				itemId: intent.itemId,
				ownerIds: [],
				pageClass: intent.pageClass,
				pageId,
				purpose: intent.purpose,
				rect: [0, 0, 1, 1],
				textureKey: intent.textureKey,
				textureRefId,
				width: 1,
			});
			bindingUpdates.push({
				bindingId: intent.bindingId,
				readiness: {
					kind: "resident",
					pageVersion: {
						placementRevision: 0,
						textureRefId,
					},
					rect: [0, 0, 1, 1],
					textureHeight: 1,
					textureRefId,
					textureWidth: 1,
				},
			});
			if (!committedPagePurposes.has(intent.purpose)) {
				pageUpdates.push({
					anisotropy: 1,
					filteringMode: "nearest",
					format: "rgba8",
					height: 1,
					mipmapsGenerated: false,
					pageId,
					pixels: createSyntheticTerrainTexturePixels(intent.purpose),
					reservationToken:
						`${textureRefId}:synthetic-reservation` as OpenWorldStreamingTextureCommit["pageUpdates"][number]["reservationToken"],
					sampleClass: createSyntheticTerrainSampleClass(intent.purpose),
					samplerPolicyKey: `open-world-terrain-synthetic:${intent.purpose}`,
					textureRefId,
					uploadBindingId: intent.bindingId,
					width: 1,
					wrapS: "clamp-to-edge",
					wrapT: "clamp-to-edge",
				});
				committedPagePurposes.add(intent.purpose);
			}
		}

		for (const [bucketKey, claims] of claimsByBucket) {
			this.#textureClaims.retainTextureBindings(
				request.ownerId,
				bucketKey,
				claims,
			);
		}

		return {
			placementSnapshot: { placementsByItemId },
			textureCommit:
				bindingUpdates.length === 0
					? null
					: {
							bindingRemovals: [],
							bindingUpdates,
							bucketKey: "open-world-terrain-synthetic",
							kind: "texture-commit",
							pageRemovals: [],
							pageUpdates,
						},
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

function createTextureClaimSourceKey(intent: TexturePlacementIntent): string {
	return String(intent.itemId);
}

function createSyntheticTerrainBakePageId(
	purpose: TexturePlacement["purpose"],
): string {
	return `open-world-terrain-bake-page:${purpose}`;
}

function createSyntheticTerrainBakeTextureRefId(
	purpose: TexturePlacement["purpose"],
): string {
	return `open-world-terrain-texture:${purpose}`;
}

function createSyntheticTerrainSampleClass(
	purpose: TexturePlacement["purpose"],
): OpenWorldStreamingTextureCommit["pageUpdates"][number]["sampleClass"] {
	switch (purpose) {
		case "terrain-detail":
			return "rgba-detail";
		case "terrain-mask":
			return "rgba-mask";
		case "terrain-color":
			return "rgba-color";
		case "object-base-color":
		case "object-detail":
		case "object-index":
		case "object-palette":
			throw new Error(`Cannot synthesize terrain texture for ${purpose}.`);
	}
}

function createSyntheticTerrainTexturePixels(
	purpose: TexturePlacement["purpose"],
): Uint8Array {
	switch (purpose) {
		case "terrain-detail":
			return new Uint8Array([128, 128, 128, 255]);
		case "terrain-mask":
			return new Uint8Array([255, 255, 255, 255]);
		case "terrain-color":
			return new Uint8Array([96, 160, 96, 255]);
		case "object-base-color":
		case "object-detail":
		case "object-index":
		case "object-palette":
			throw new Error(`Cannot synthesize terrain texture for ${purpose}.`);
	}
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
