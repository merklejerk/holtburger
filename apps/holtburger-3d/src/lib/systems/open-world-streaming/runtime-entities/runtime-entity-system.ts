import type { PreparedAssetReader } from "../../../assets/contracts";
import type { DynamicEntityId } from "../../../dynamic/contracts";
import {
	DynamicEntityController,
	type RuntimeDynamicSpawnRequest,
} from "../../../dynamic/dynamic-entity-controller";
import type { DynamicAnimationCatchUpTruncation } from "../../../dynamic/dynamic-animation-player";
import { createDynamicVisualBakeSourceGeometry } from "../../../dynamic/visual-bake-sidecars";
import {
	createDynamicVisualTexturePlanning,
	type DynamicVisualBaker,
} from "../../../dynamic/visual-baker";
import type { DynamicVisualRecipeResolver } from "../../../dynamic/visual-recipe-resolver";
import type { StaticAuthoredDynamicPlacementRecord } from "../../../static/contracts";
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
import { OpenWorldTextureClaimRegistry } from "../texture-residency/claims/texture-claim-registry";
import { reserveObjectVisualTexturePlacements } from "../texture-residency/placement/object-visual-texture-placement-plan";
import type { OpenWorldTexturePageBuildInput } from "../texture-residency/page-build/protocol";
import type { OpenWorldObjectVisualAtlasBuilder } from "../texture-residency/atlas-build/object-visual-atlas-builder";
import {
	createDynamicRendererInstances,
	createDynamicRendererVisualResources,
} from "./renderer-commits";

export interface OpenWorldRuntimeEntitySystemOptions {
	readonly assetReader: PreparedAssetReader;
	readonly createDynamicVisualBaker: () => DynamicVisualBaker;
	readonly createDynamicVisualRecipeResolver: () => DynamicVisualRecipeResolver;
	readonly objectVisualAtlasBuilder: OpenWorldObjectVisualAtlasBuilder;
	readonly owners: MaterializationOwnerRegistry;
	readonly renderer: OpenWorldRuntimeEntityRendererPort;
	readonly scheduleTexturePageBuilds: (
		request: OpenWorldRuntimeEntityTexturePageBuildRequest,
	) => void;
	readonly textureClaims: OpenWorldTextureClaimRegistry;
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
		readonly states: Record<DynamicPrepState, number>;
		readonly skippedVisualCount: number;
		readonly started: number;
		readonly recentFailures: readonly OpenWorldRuntimeEntityPrepFailure[];
	};
}

interface OpenWorldRuntimeEntityPrepFailure {
	readonly entityId: string;
	readonly message: string;
	readonly ownerId: string;
	readonly phase: "bake" | "prep";
}

const RECENT_RUNTIME_ENTITY_DIAGNOSTICS_LIMIT = 20;

export class OpenWorldRuntimeEntitySystem {
	readonly #assetReader: PreparedAssetReader;
	readonly #controller: DynamicEntityController;
	readonly #createDynamicVisualBaker: () => DynamicVisualBaker;
	readonly #createDynamicVisualRecipeResolver: () => DynamicVisualRecipeResolver;
	readonly #objectVisualAtlasBuilder: OpenWorldObjectVisualAtlasBuilder;
	readonly #owners: MaterializationOwnerRegistry;
	readonly #renderer: OpenWorldRuntimeEntityRendererPort;
	readonly #scheduleTexturePageBuilds: (
		request: OpenWorldRuntimeEntityTexturePageBuildRequest,
	) => void;
	readonly #staticChildOwnerIdsByParentId = new Map<
		MaterializationOwnerId,
		Set<MaterializationOwnerId>
	>();
	readonly #textureClaims: OpenWorldTextureClaimRegistry;
	#dynamicVisualBaker: DynamicVisualBaker | null = null;
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

	constructor(options: OpenWorldRuntimeEntitySystemOptions) {
		this.#assetReader = options.assetReader;
		this.#controller = new DynamicEntityController({
			onAnimationCatchUpTruncated: (truncation) => {
				this.#recordAnimationCatchUpTruncation(truncation);
			},
		});
		this.#createDynamicVisualBaker = options.createDynamicVisualBaker;
		this.#createDynamicVisualRecipeResolver =
			options.createDynamicVisualRecipeResolver;
		this.#objectVisualAtlasBuilder = options.objectVisualAtlasBuilder;
		this.#owners = options.owners;
		this.#renderer = options.renderer;
		this.#scheduleTexturePageBuilds = options.scheduleTexturePageBuilds;
		this.#textureClaims = options.textureClaims;
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
		this.#textureClaims.releaseTextureOwner(owner.id);
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
			this.#textureClaims.releaseTextureOwner(owner.id);
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
				staleCount: this.#stalePrepCount,
				states: this.#createPrepStateCounts(),
				skippedVisualCount: this.#skippedVisualCount,
				started: this.#prepStartedCount,
			},
		};
	}

	async #prepareEntity(request: DynamicPrepRequest): Promise<DynamicPrepResult> {
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
			const recipe = await this.#requireRecipeResolver().resolveRecipe({
				...recipeRequest,
				assetReader: this.#assetReader,
			});
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
			const textureReservation = await reserveObjectVisualTexturePlacements({
				atlasBuilder: this.#objectVisualAtlasBuilder,
				filteringMode: "nearest",
				intents: texturePlanning.placementIntents,
				ownerId: request.ownerId,
				textureClaims: this.#textureClaims,
			});
			if (!this.#isCurrent(request)) {
				this.#recordStalePrep(request);
				return "stale";
			}
			this.#setPrepState(request, "baking");
			const sourceGeometry = await createDynamicVisualBakeSourceGeometry(
				this.#assetReader,
				[recipe],
			);
			if (!this.#isCurrent(request)) {
				this.#recordStalePrep(request);
				return "stale";
			}
			const result = await this.#requireDynamicBaker().bake({
				recipe,
				revision: this.#nextRendererRevision(),
				sourceGeometry,
				texturePlacementSnapshot: textureReservation.placementSnapshot,
				texturePlanning,
			});
			if (!this.#isCurrent(request)) {
				this.#recordStalePrep(request);
				return "stale";
			}
			this.#setPrepState(request, "waitingForTexturePages");
			this.#scheduleTexturePageBuilds({
				isCurrent: () => this.#isCurrent(request),
				ownerId: request.ownerId,
				pageBuildRequests: textureReservation.pageBuildRequests,
				sourceTaskId: String(request.entityId),
			});
			const product = result.product;
			if (product?.kind === "baked") {
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

	#requireDynamicBaker(): DynamicVisualBaker {
		this.#dynamicVisualBaker ??= this.#createDynamicVisualBaker();
		return this.#dynamicVisualBaker;
	}

	#nextRendererRevision(): number {
		this.#rendererRevision += 1;
		return this.#rendererRevision;
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

function pushRecent<T>(items: T[], item: T, limit: number): void {
	items.push(item);
	if (items.length > limit) {
		items.splice(0, items.length - limit);
	}
}
