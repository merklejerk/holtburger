import type { PreparedAssetReader } from "../../../assets/contracts";
import type { DynamicEntityId } from "../../../dynamic/contracts";
import {
	DynamicEntityController,
	type RuntimeDynamicSpawnRequest,
} from "../../../dynamic/dynamic-entity-controller";
import type { DynamicAnimationCatchUpTruncation } from "../../../dynamic/dynamic-animation-player";
import { createDynamicVisualTexturePlanning } from "../../../dynamic/visual-baker";
import type { DynamicVisualPrepper } from "../../../dynamic/visual-prepper";
import type { DynamicVisualRecipeResolver } from "../../../dynamic/visual-recipe-resolver";
import type { StaticAuthoredDynamicPlacementRecord } from "../../../static/contracts";
import type { TextureBindingId } from "../../../textures/identity";
import type { TextureFilteringMode } from "../../../textures/sampling-policy";
import type {
	DynamicRendererResourceCommit,
	DynamicRendererInstanceCommit,
} from "../../../renderer/types";
import type { DynamicEntityRenderResidence } from "../../../dynamic/contracts";
import {
	MaterializationOwnerRegistry,
	type MaterializationOwnerToken,
} from "../owners/owner-registry";
import {
	createRuntimeEntityMaterializationOwner,
	createStaticAuthoredDynamicMaterializationOwner,
	type MaterializationOwnerId,
} from "../owners/owner-id";
import type { OpenWorldTexturePageBuildInput } from "../texture-residency/page-build/protocol";
import type { OpenWorldTexturePageBuildTaskSettlement } from "../texture-residency/page-build/texture-page-build-task-stream";
import type { OpenWorldTextureResidencyService } from "../texture-residency/texture-residency-service";
import type { WorkerPoolDiagnosticsSnapshot } from "../../../workers/pool";
import {
	createDynamicRendererInstances,
	createDynamicRendererVisualResources,
} from "./renderer-commits";

export interface OpenWorldRuntimeEntitySystemOptions {
	readonly assetReader: PreparedAssetReader;
	readonly createDynamicVisualPrepper: () => DynamicVisualPrepper;
	readonly createDynamicVisualRecipeResolver: () => DynamicVisualRecipeResolver;
	readonly getTextureFilteringMode: () => TextureFilteringMode;
	readonly owners: MaterializationOwnerRegistry;
	readonly renderer: OpenWorldRuntimeEntityRendererPort;
	readonly scheduleTexturePageBuilds: (
		request: OpenWorldRuntimeEntityTexturePageBuildRequest,
	) => Promise<readonly OpenWorldTexturePageBuildTaskSettlement[]>;
	readonly textureResidency: OpenWorldTextureResidencyService;
}

export interface OpenWorldRuntimeEntityRendererPort {
	commitDynamicResources(commit: DynamicRendererResourceCommit): void;
	commitDynamicInstances(commit: DynamicRendererInstanceCommit): void;
}

export interface OpenWorldRuntimeEntityTexturePageBuildRequest {
	readonly isCurrent: () => boolean;
	readonly ownerId: MaterializationOwnerId;
	readonly pageBuildRequests: readonly OpenWorldTexturePageBuildInput[];
	readonly sourceTaskId: string;
}

interface DynamicPrepRequest {
	readonly authoring: "runtime-authored" | "static-authored";
	readonly entityId: DynamicEntityId;
	readonly ownerId: MaterializationOwnerId;
	readonly token: MaterializationOwnerToken;
}

type DynamicPrepState =
	| "baking"
	| "failed"
	| "missingRecipe"
	| "queued"
	| "ready"
	| "reservingTextures"
	| "resolvingRecipe"
	| "skipped"
	| "stale"
	| "waitingForTexturePages";

interface DynamicPrepRecord {
	readonly authoring: DynamicPrepRequest["authoring"];
	readonly entityId: DynamicEntityId;
	readonly ownerId: MaterializationOwnerId;
	readonly state: DynamicPrepState;
	readonly startedAtMs: number;
	readonly terminalAtMs: number | null;
	readonly token: MaterializationOwnerToken;
}

type DynamicPrepResult =
	| "failed"
	| "missingRecipe"
	| "ready"
	| "skipped"
	| "stale";

type DynamicPrepStage =
	| "dynamic-visual-prep-worker"
	| "recipe-resolution"
	| "texture-page-build-wait"
	| "texture-placement-reservation";

export interface OpenWorldRuntimeEntityDiagnosticsSnapshot {
	readonly animation: {
		readonly catchUpTruncationCount: number;
		readonly droppedHookFrameCount: number;
		readonly recentCatchUpTruncations: readonly DynamicAnimationCatchUpTruncation[];
	};
	readonly commits: {
		readonly dynamicInstanceCommitCount: number;
		readonly dynamicResourceCommitCount: number;
		readonly maxInstancesPerCommit: number;
		readonly maxResourcesPerCommit: number;
	};
	readonly prep: {
		readonly bakeFailureCount: number;
		readonly bakeSuccessCount: number;
		readonly failed: number;
		readonly missingRecipeCount: number;
		readonly recipeResolvedCount: number;
		readonly staleCount: number;
		readonly recentStageTimings: readonly OpenWorldRuntimeEntityPrepStageTiming[];
		readonly states: Record<DynamicPrepState, number>;
		readonly skippedVisualCount: number;
		readonly started: number;
		readonly recentFailures: readonly OpenWorldRuntimeEntityPrepFailure[];
	};
	readonly prepWorkers: {
		readonly recipeResolution: WorkerPoolDiagnosticsSnapshot | null;
		readonly visualPrep: WorkerPoolDiagnosticsSnapshot | null;
	};
}

interface OpenWorldRuntimeEntityPrepFailure {
	readonly entityId: string;
	readonly message: string;
	readonly ownerId: string;
	readonly phase: "bake" | "prep";
}

interface OpenWorldRuntimeEntityPrepStageTiming {
	readonly durationMs: number;
	readonly entityId: string;
	readonly ownerId: string;
	readonly stage: DynamicPrepStage;
}

const RECENT_RUNTIME_ENTITY_DIAGNOSTICS_LIMIT = 20;

export class OpenWorldRuntimeEntitySystem {
	readonly #assetReader: PreparedAssetReader;
	readonly #controller: DynamicEntityController;
	readonly #createDynamicVisualPrepper: () => DynamicVisualPrepper;
	readonly #createDynamicVisualRecipeResolver: () => DynamicVisualRecipeResolver;
	readonly #getTextureFilteringMode: () => TextureFilteringMode;
	readonly #owners: MaterializationOwnerRegistry;
	readonly #renderer: OpenWorldRuntimeEntityRendererPort;
	readonly #scheduleTexturePageBuilds: (
		request: OpenWorldRuntimeEntityTexturePageBuildRequest,
	) => Promise<readonly OpenWorldTexturePageBuildTaskSettlement[]>;
	readonly #staticChildOwnerIdsByParentId = new Map<
		MaterializationOwnerId,
		Set<MaterializationOwnerId>
	>();
	readonly #textureResidency: OpenWorldTextureResidencyService;
	#dynamicVisualPrepper: DynamicVisualPrepper | null = null;
	#dynamicVisualRecipeResolver: DynamicVisualRecipeResolver | null = null;
	#lastFrameTimeSeconds = 0;
	#rendererRevision = 0;
	readonly #committedResourceIds = new Set<string>();
	#animationCatchUpTruncationCount = 0;
	#bakeFailureCount = 0;
	#bakeSuccessCount = 0;
	#dynamicInstanceCommitCount = 0;
	#dynamicResourceCommitCount = 0;
	#droppedHookFrameCount = 0;
	#maxInstancesPerCommit = 0;
	#maxResourcesPerCommit = 0;
	#missingRecipeCount = 0;
	#prepFailureCount = 0;
	#prepStartedCount = 0;
	#recipeResolvedCount = 0;
	#skippedVisualCount = 0;
	#stalePrepCount = 0;
	readonly #prepRecordsByOwnerId = new Map<
		MaterializationOwnerId,
		DynamicPrepRecord
	>();
	readonly #recentCatchUpTruncations: DynamicAnimationCatchUpTruncation[] = [];
	readonly #recentPrepFailures: OpenWorldRuntimeEntityPrepFailure[] = [];
	readonly #recentPrepStageTimings: OpenWorldRuntimeEntityPrepStageTiming[] =
		[];

	constructor(options: OpenWorldRuntimeEntitySystemOptions) {
		this.#assetReader = options.assetReader;
		this.#controller = new DynamicEntityController({
			onAnimationCatchUpTruncated: (truncation) => {
				this.#recordAnimationCatchUpTruncation(truncation);
			},
		});
		this.#createDynamicVisualPrepper = options.createDynamicVisualPrepper;
		this.#createDynamicVisualRecipeResolver =
			options.createDynamicVisualRecipeResolver;
		this.#getTextureFilteringMode = options.getTextureFilteringMode;
		this.#owners = options.owners;
		this.#renderer = options.renderer;
		this.#scheduleTexturePageBuilds = options.scheduleTexturePageBuilds;
		this.#textureResidency = options.textureResidency;
	}

	createRuntimeEntity(request: RuntimeDynamicSpawnRequest): DynamicEntityId {
		const entityId = this.#controller.createRuntimeSpawn(request);
		const owner = createRuntimeEntityMaterializationOwner(entityId);
		const token = this.#owners.replace(owner);
		this.#prepareEntity({
			authoring: "runtime-authored",
			entityId,
			ownerId: owner.id,
			token,
		}).then((result) => {
			if (result !== "stale") {
				this.#commitRendererState(0);
			}
		});
		this.#commitRendererState(0);
		return entityId;
	}

	destroyRuntimeEntity(entityId: DynamicEntityId): boolean {
		const removed = this.#controller.removeRuntimeSpawn(entityId);
		if (!removed) {
			return false;
		}
		const owner = createRuntimeEntityMaterializationOwner(entityId);
		this.#owners.evict(owner.id);
		this.#textureResidency.releaseOwner(owner.id);
		this.#prepRecordsByOwnerId.delete(owner.id);
		this.#commitRendererState(0);
		return true;
	}

	updateRuntimeEntityRenderResidence(
		entityId: DynamicEntityId,
		renderResidence: DynamicEntityRenderResidence,
		frameTimeSeconds: number,
	): boolean {
		const updated = this.#controller.updateRuntimeSpawnRenderResidence(
			entityId,
			renderResidence,
		);
		if (updated) {
			this.#commitRendererInstances(frameTimeSeconds);
		}
		return updated;
	}

	ingestStaticAuthoredPlacements(input: {
		readonly parentOwnerId: MaterializationOwnerId;
		readonly placements: readonly StaticAuthoredDynamicPlacementRecord[];
	}): void {
		this.removeStaticAuthoredChildrenForParent(input.parentOwnerId);
		const entityIds = this.#controller.ingestStaticPlacements(input.placements);
		const requests: DynamicPrepRequest[] = [];
		for (const entityId of entityIds) {
			const owner = createStaticAuthoredDynamicMaterializationOwner({
				childId: entityId,
				parentStaticLayerOwnerId: input.parentOwnerId,
			});
			const token = this.#owners.replace(owner);
			this.#addStaticChildOwner(input.parentOwnerId, owner.id);
			requests.push({
				authoring: "static-authored",
				entityId,
				ownerId: owner.id,
				token,
			});
		}
		if (requests.length > 0) {
			this.#prepareStaticAuthoredBatch(requests);
		}
	}

	removeStaticAuthoredChildrenForParent(
		parentOwnerId: MaterializationOwnerId,
	): void {
		const removedEntityIds =
			this.#controller.removeStaticAuthoredLayerOwner(parentOwnerId);
		for (const entityId of removedEntityIds) {
			const owner = createStaticAuthoredDynamicMaterializationOwner({
				childId: entityId,
				parentStaticLayerOwnerId: parentOwnerId,
			});
			this.#owners.evict(owner.id);
			this.#textureResidency.releaseOwner(owner.id);
			this.#prepRecordsByOwnerId.delete(owner.id);
		}
		this.#staticChildOwnerIdsByParentId.delete(parentOwnerId);
		if (removedEntityIds.length > 0) {
			this.#commitRendererState(0);
		}
	}

	tick(frameTimeSeconds: number): void {
		this.#lastFrameTimeSeconds = frameTimeSeconds;
		if (this.#controller.tick(frameTimeSeconds)) {
			// Static-authored prep publishes the final batch snapshot; per-frame snapshots during prep recreate the old commit storm.
			if (this.#hasInFlightStaticAuthoredPrep()) {
				return;
			}
			this.#commitRendererInstances(frameTimeSeconds);
		}
	}

	createSnapshot() {
		return this.#controller.createSnapshot();
	}

	createDiagnosticsSnapshot(): OpenWorldRuntimeEntityDiagnosticsSnapshot {
		return {
			animation: {
				catchUpTruncationCount: this.#animationCatchUpTruncationCount,
				droppedHookFrameCount: this.#droppedHookFrameCount,
				recentCatchUpTruncations: [...this.#recentCatchUpTruncations],
			},
			commits: {
				dynamicInstanceCommitCount: this.#dynamicInstanceCommitCount,
				dynamicResourceCommitCount: this.#dynamicResourceCommitCount,
				maxInstancesPerCommit: this.#maxInstancesPerCommit,
				maxResourcesPerCommit: this.#maxResourcesPerCommit,
			},
			prep: {
				bakeFailureCount: this.#bakeFailureCount,
				bakeSuccessCount: this.#bakeSuccessCount,
				failed: this.#prepFailureCount,
				missingRecipeCount: this.#missingRecipeCount,
				recipeResolvedCount: this.#recipeResolvedCount,
				recentFailures: [...this.#recentPrepFailures],
				recentStageTimings: [...this.#recentPrepStageTimings],
				staleCount: this.#stalePrepCount,
				states: this.#createPrepStateCounts(),
				skippedVisualCount: this.#skippedVisualCount,
				started: this.#prepStartedCount,
			},
			prepWorkers: {
				recipeResolution: createWorkerDiagnosticsSnapshot(
					this.#dynamicVisualRecipeResolver,
				),
				visualPrep: createWorkerDiagnosticsSnapshot(this.#dynamicVisualPrepper),
			},
		};
	}

	async #prepareEntity(
		request: DynamicPrepRequest,
	): Promise<DynamicPrepResult> {
		this.#prepStartedCount += 1;
		this.#setPrepState(request, "queued");
		try {
			this.#setPrepState(request, "resolvingRecipe");
			const recipeRequest =
				this.#controller.createRuntimeVisualRecipeRequest(request.entityId) ??
				this.#controller
					.createStaticAuthoredVisualRecipeRequests(
						this.#staticParentOwnerIdForChild(request.ownerId) ??
							request.ownerId,
					)
					.find((candidate) => candidate.entityId === request.entityId);
			if (!recipeRequest) {
				this.#missingRecipeCount += 1;
				this.#setPrepState(request, "missingRecipe");
				return "missingRecipe";
			}
			const recipe = await this.#measurePrepStage(
				request,
				"recipe-resolution",
				() =>
					this.#requireRecipeResolver().resolveRecipe({
						...recipeRequest,
						assetReader: this.#assetReader,
					}),
			);
			if (!this.#isCurrent(request)) {
				this.#recordStalePrep(request);
				return "stale";
			}
			this.#recipeResolvedCount += 1;
			if (!this.#controller.applyResolvedDynamicRecipe(recipe)) {
				this.#recordPrepFailure({
					entityId: request.entityId,
					message: "Resolved recipe no longer applies to the dynamic entity.",
					ownerId: request.ownerId,
					phase: "prep",
				});
				this.#prepFailureCount += 1;
				this.#setPrepState(request, "failed");
				return "failed";
			}
			this.#setPrepState(request, "reservingTextures");
			const texturePlanning = createDynamicVisualTexturePlanning(recipe);
			const textureReservation = await this.#measurePrepStage(
				request,
				"texture-placement-reservation",
				() =>
					this.#textureResidency.reserveObjectVisualPlacements({
						filteringMode: this.#getTextureFilteringMode(),
						intents: texturePlanning.placementIntents,
						isCurrent: () => this.#isCurrent(request),
						ownerId: request.ownerId,
						revision: this.#nextRendererRevision(),
					}),
			);
			if (!this.#isCurrent(request)) {
				this.#recordStalePrep(request);
				return "stale";
			}
			this.#setPrepState(request, "baking");
			const result = await this.#measurePrepStage(
				request,
				"dynamic-visual-prep-worker",
				() =>
					this.#requireDynamicPrepper().prepare({
						recipe,
						revision: this.#nextRendererRevision(),
						texturePlacementSnapshot: textureReservation.placementSnapshot,
						texturePlanning,
					}),
			);
			if (!this.#isCurrent(request)) {
				this.#recordStalePrep(request);
				return "stale";
			}
			this.#setPrepState(request, "waitingForTexturePages");
			const pageBuildSettlements = await this.#measurePrepStage(
				request,
				"texture-page-build-wait",
				() =>
					this.#scheduleTexturePageBuilds({
						isCurrent: () => this.#isCurrent(request),
						ownerId: request.ownerId,
						pageBuildRequests: textureReservation.pageBuildRequests,
						sourceTaskId: String(request.entityId),
					}),
			);
			if (!this.#isCurrent(request)) {
				this.#recordStalePrep(request);
				return "stale";
			}
			const pageBuildFailure =
				createDynamicPrepTexturePageFailure(pageBuildSettlements);
			if (pageBuildFailure !== null) {
				this.#prepFailureCount += 1;
				this.#recordPrepFailure({
					entityId: request.entityId,
					message: pageBuildFailure,
					ownerId: request.ownerId,
					phase: "prep",
				});
				this.#controller.skipDynamicVisual(request.entityId, {
					kind: "invalid-recipe",
					message: pageBuildFailure,
				});
				this.#setPrepState(request, "failed");
				return "failed";
			}
			const product = result.product;
			if (product?.kind === "baked") {
				const residencyFailure = await this.#waitForDynamicTextureResidency(
					request,
					collectBakedDynamicVisualTextureBindingIds(product.resource),
				);
				if (!this.#isCurrent(request)) {
					this.#recordStalePrep(request);
					return "stale";
				}
				if (residencyFailure !== null) {
					this.#prepFailureCount += 1;
					this.#recordPrepFailure({
						entityId: request.entityId,
						message: residencyFailure,
						ownerId: request.ownerId,
						phase: "prep",
					});
					this.#controller.skipDynamicVisual(request.entityId, {
						kind: "invalid-recipe",
						message: residencyFailure,
					});
					this.#setPrepState(request, "failed");
					return "failed";
				}
				this.#bakeSuccessCount += 1;
				this.#controller.applyBakedDynamicVisual(product.resource);
				this.#setPrepState(request, "ready");
				return "ready";
			} else if (product?.kind === "skipped") {
				this.#skippedVisualCount += 1;
				this.#controller.skipDynamicVisual(product.entityId, product.reason);
				this.#setPrepState(request, "skipped");
				return "skipped";
			} else {
				this.#bakeFailureCount += 1;
				this.#prepFailureCount += 1;
				for (const failure of result.failures) {
					this.#recordPrepFailure({
						entityId: request.entityId,
						message: failure.message,
						ownerId: request.ownerId,
						phase: "bake",
					});
				}
				this.#controller.skipDynamicVisual(request.entityId, {
					kind: "invalid-recipe",
					message: result.failures.map((failure) => failure.message).join("; "),
				});
				this.#setPrepState(request, "failed");
				return "failed";
			}
		} catch (error) {
			if (!this.#isCurrent(request)) {
				this.#recordStalePrep(request);
				return "stale";
			}
			this.#prepFailureCount += 1;
			this.#recordPrepFailure({
				entityId: request.entityId,
				message: error instanceof Error ? error.message : String(error),
				ownerId: request.ownerId,
				phase: "prep",
			});
			this.#controller.skipDynamicVisual(request.entityId, {
				kind: "invalid-recipe",
				message: error instanceof Error ? error.message : String(error),
			});
			this.#setPrepState(request, "failed");
			return "failed";
		}
	}

	async #prepareStaticAuthoredBatch(
		requests: readonly DynamicPrepRequest[],
	): Promise<void> {
		const results = await Promise.all(
			requests.map((request) => this.#prepareEntity(request)),
		);
		if (results.some((result) => result !== "stale")) {
			this.#commitRendererState(this.#lastFrameTimeSeconds);
		}
	}

	#commitRendererState(frameTimeSeconds: number): void {
		const snapshot = this.#controller.createSnapshot();
		const resources = snapshot.records.flatMap(
			createDynamicRendererVisualResources,
		);
		const nextResourceIds = new Set(
			resources.map((resource) => resource.resourceId),
		);
		const addedVisualResources = resources.filter(
			(resource) => !this.#committedResourceIds.has(resource.resourceId),
		);
		const removedVisualResourceIds = [...this.#committedResourceIds].filter(
			(resourceId) => !nextResourceIds.has(resourceId),
		);
		if (
			addedVisualResources.length > 0 ||
			removedVisualResourceIds.length > 0
		) {
			this.#renderer.commitDynamicResources({
				addedVisualResources,
				removedVisualResourceIds,
				revision: this.#nextRendererRevision(),
			});
			this.#dynamicResourceCommitCount += 1;
			this.#maxResourcesPerCommit = Math.max(
				this.#maxResourcesPerCommit,
				addedVisualResources.length,
			);
		}
		this.#committedResourceIds.clear();
		for (const resourceId of nextResourceIds) {
			this.#committedResourceIds.add(resourceId);
		}
		this.#commitRendererInstances(frameTimeSeconds);
	}

	#commitRendererInstances(frameTimeSeconds: number): void {
		const instances = this.#controller
			.createSnapshot()
			.records.flatMap(createDynamicRendererInstances);
		this.#renderer.commitDynamicInstances({
			frameTimeSeconds,
			instances,
			revision: this.#nextRendererRevision(),
		});
		this.#dynamicInstanceCommitCount += 1;
		this.#maxInstancesPerCommit = Math.max(
			this.#maxInstancesPerCommit,
			instances.length,
		);
	}

	#recordAnimationCatchUpTruncation(
		truncation: DynamicAnimationCatchUpTruncation,
	): void {
		this.#animationCatchUpTruncationCount += 1;
		this.#droppedHookFrameCount += truncation.droppedFrameCount;
		pushRecent(
			this.#recentCatchUpTruncations,
			truncation,
			RECENT_RUNTIME_ENTITY_DIAGNOSTICS_LIMIT,
		);
	}

	#recordPrepFailure(failure: OpenWorldRuntimeEntityPrepFailure): void {
		pushRecent(
			this.#recentPrepFailures,
			failure,
			RECENT_RUNTIME_ENTITY_DIAGNOSTICS_LIMIT,
		);
	}

	async #measurePrepStage<T>(
		request: DynamicPrepRequest,
		stage: DynamicPrepStage,
		run: () => Promise<T>,
	): Promise<T> {
		const startedAtMs = nowMs();
		try {
			return await run();
		} finally {
			pushRecent(
				this.#recentPrepStageTimings,
				{
					durationMs: nowMs() - startedAtMs,
					entityId: request.entityId,
					ownerId: request.ownerId,
					stage,
				},
				RECENT_RUNTIME_ENTITY_DIAGNOSTICS_LIMIT,
			);
		}
	}

	#addStaticChildOwner(
		parentOwnerId: MaterializationOwnerId,
		childOwnerId: MaterializationOwnerId,
	): void {
		const childOwnerIds =
			this.#staticChildOwnerIdsByParentId.get(parentOwnerId) ?? new Set();
		childOwnerIds.add(childOwnerId);
		this.#staticChildOwnerIdsByParentId.set(parentOwnerId, childOwnerIds);
	}

	#staticParentOwnerIdForChild(
		childOwnerId: MaterializationOwnerId,
	): MaterializationOwnerId | null {
		for (const [parentOwnerId, childOwnerIds] of this
			.#staticChildOwnerIdsByParentId) {
			if (childOwnerIds.has(childOwnerId)) {
				return parentOwnerId;
			}
		}
		return null;
	}

	#setPrepState(request: DynamicPrepRequest, state: DynamicPrepState): void {
		const existing = this.#prepRecordsByOwnerId.get(request.ownerId);
		if (
			existing !== undefined &&
			existing.token !== request.token &&
			state !== "queued"
		) {
			return;
		}
		this.#prepRecordsByOwnerId.set(request.ownerId, {
			authoring: request.authoring,
			entityId: request.entityId,
			ownerId: request.ownerId,
			startedAtMs: existing?.startedAtMs ?? performance.now(),
			state,
			terminalAtMs: isTerminalPrepState(state) ? performance.now() : null,
			token: request.token,
		});
	}

	#recordStalePrep(request: DynamicPrepRequest): void {
		this.#stalePrepCount += 1;
		this.#setPrepState(request, "stale");
	}

	#createPrepStateCounts(): Record<DynamicPrepState, number> {
		const counts = createEmptyPrepStateCounts();
		for (const record of this.#prepRecordsByOwnerId.values()) {
			counts[record.state] += 1;
		}
		return counts;
	}

	#hasInFlightStaticAuthoredPrep(): boolean {
		for (const record of this.#prepRecordsByOwnerId.values()) {
			if (
				record.authoring === "static-authored" &&
				!isTerminalPrepState(record.state)
			) {
				return true;
			}
		}
		return false;
	}

	#isCurrent(request: DynamicPrepRequest): boolean {
		return this.#owners.isCurrent({
			ownerId: request.ownerId,
			token: request.token,
		});
	}

	#requireRecipeResolver(): DynamicVisualRecipeResolver {
		this.#dynamicVisualRecipeResolver ??=
			this.#createDynamicVisualRecipeResolver();
		return this.#dynamicVisualRecipeResolver;
	}

	#requireDynamicPrepper(): DynamicVisualPrepper {
		this.#dynamicVisualPrepper ??= this.#createDynamicVisualPrepper();
		return this.#dynamicVisualPrepper;
	}

	#nextRendererRevision(): number {
		this.#rendererRevision += 1;
		return this.#rendererRevision;
	}

	async #waitForDynamicTextureResidency(
		request: DynamicPrepRequest,
		bindingIds: readonly TextureBindingId[],
	): Promise<string | null> {
		while (this.#isCurrent(request)) {
			const issues =
				this.#textureResidency.createBindingResidencyIssues(bindingIds);
			if (issues.length === 0) {
				return null;
			}
			const nonWaitableIssues = issues.filter(
				(issue) => issue.state !== "page-building",
			);
			if (nonWaitableIssues.length > 0) {
				return createDynamicPrepTextureResidencyFailure(nonWaitableIssues);
			}
			await yieldToTextureResidencyWait();
		}
		return null;
	}
}

function createEmptyPrepStateCounts(): Record<DynamicPrepState, number> {
	return {
		baking: 0,
		failed: 0,
		missingRecipe: 0,
		queued: 0,
		ready: 0,
		reservingTextures: 0,
		resolvingRecipe: 0,
		skipped: 0,
		stale: 0,
		waitingForTexturePages: 0,
	};
}

function isTerminalPrepState(state: DynamicPrepState): boolean {
	return (
		state === "failed" ||
		state === "missingRecipe" ||
		state === "ready" ||
		state === "skipped" ||
		state === "stale"
	);
}

function createDynamicPrepTexturePageFailure(
	settlements: readonly OpenWorldTexturePageBuildTaskSettlement[],
): string | null {
	const failed = settlements.find(
		(settlement) => settlement.status === "failed",
	);
	if (failed) {
		return `Texture page build ${failed.jobId} failed: ${failed.error ?? "unknown error"}.`;
	}
	const stale = settlements.find(
		(settlement) => settlement.status === "stale-rejected",
	);
	if (stale) {
		return `Texture page build ${stale.jobId} was rejected as stale.`;
	}
	return null;
}

function createDynamicPrepTextureResidencyFailure(
	issues: readonly ReturnType<
		OpenWorldTextureResidencyService["createBindingResidencyIssues"]
	>[number][],
): string | null {
	if (issues.length === 0) {
		return null;
	}
	const sample = issues
		.slice(0, 3)
		.map(
			(issue) =>
				`${issue.bindingId}:${issue.state}${issue.pageId ? `:${issue.pageId}` : ""}`,
		)
		.join(", ");
	return `Dynamic visual texture dependencies were not resident after texture page wait (${issues.length} unresolved; ${sample}).`;
}

function collectBakedDynamicVisualTextureBindingIds(input: {
	readonly renderParts: readonly {
		readonly textureBindingIds: readonly TextureBindingId[];
	}[];
}): readonly TextureBindingId[] {
	return [
		...new Set(
			input.renderParts.flatMap((part) => [...part.textureBindingIds]),
		),
	].sort();
}

async function yieldToTextureResidencyWait(): Promise<void> {
	await new Promise<void>((resolve) => {
		globalThis.setTimeout(resolve, 0);
	});
}

function pushRecent<T>(items: T[], item: T, limit: number): void {
	items.push(item);
	if (items.length > limit) {
		items.splice(0, items.length - limit);
	}
}

function nowMs(): number {
	return globalThis.performance?.now?.() ?? Date.now();
}

function createWorkerDiagnosticsSnapshot(
	worker: unknown,
): WorkerPoolDiagnosticsSnapshot | null {
	if (!hasWorkerDiagnostics(worker)) {
		return null;
	}
	return worker.createDiagnosticsSnapshot();
}

function hasWorkerDiagnostics(
	worker: unknown,
): worker is { createDiagnosticsSnapshot(): WorkerPoolDiagnosticsSnapshot } {
	return (
		typeof worker === "object" &&
		worker !== null &&
		"createDiagnosticsSnapshot" in worker &&
		typeof worker.createDiagnosticsSnapshot === "function"
	);
}
