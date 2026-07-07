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
	readonly entityId: DynamicEntityId;
	readonly ownerId: MaterializationOwnerId;
	readonly token: MaterializationOwnerToken;
}

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
		readonly recipeResolvedCount: number;
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
	#prepFailureCount = 0;
	#prepStartedCount = 0;
	#recipeResolvedCount = 0;
	#skippedVisualCount = 0;
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
		this.#prepareEntity({ entityId, ownerId: owner.id, token });
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
		for (const entityId of entityIds) {
			const owner = createStaticAuthoredDynamicMaterializationOwner({
				childId: entityId,
				parentStaticLayerOwnerId: input.parentOwnerId,
			});
			const token = this.#owners.replace(owner);
			this.#addStaticChildOwner(input.parentOwnerId, owner.id);
			this.#prepareEntity({ entityId, ownerId: owner.id, token });
		}
		this.#commitRendererState(0);
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
		}
		this.#staticChildOwnerIdsByParentId.delete(parentOwnerId);
		this.#commitRendererState(0);
	}

	tick(frameTimeSeconds: number): void {
		this.#lastFrameTimeSeconds = frameTimeSeconds;
		if (this.#controller.tick(frameTimeSeconds)) {
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
				recipeResolvedCount: this.#recipeResolvedCount,
				recentFailures: [...this.#recentPrepFailures],
				skippedVisualCount: this.#skippedVisualCount,
				started: this.#prepStartedCount,
			},
		};
	}

	async #prepareEntity(request: DynamicPrepRequest): Promise<void> {
		this.#prepStartedCount += 1;
		try {
			const recipeRequest =
				this.#controller.createRuntimeVisualRecipeRequest(request.entityId) ??
				this.#controller
					.createStaticAuthoredVisualRecipeRequests(
						this.#staticParentOwnerIdForChild(request.ownerId) ??
							request.ownerId,
					)
					.find((candidate) => candidate.entityId === request.entityId);
			if (!recipeRequest) {
				return;
			}
			const recipe = await this.#requireRecipeResolver().resolveRecipe({
				...recipeRequest,
				assetReader: this.#assetReader,
			});
			if (!this.#isCurrent(request)) {
				return;
			}
			this.#recipeResolvedCount += 1;
			if (!this.#controller.applyResolvedDynamicRecipe(recipe)) {
				return;
			}
			const texturePlanning = createDynamicVisualTexturePlanning(recipe);
			const textureReservation = await reserveObjectVisualTexturePlacements({
				atlasBuilder: this.#objectVisualAtlasBuilder,
				filteringMode: "nearest",
				intents: texturePlanning.placementIntents,
				ownerId: request.ownerId,
				textureClaims: this.#textureClaims,
			});
			if (!this.#isCurrent(request)) {
				return;
			}
			const sourceGeometry = await createDynamicVisualBakeSourceGeometry(
				this.#assetReader,
				[recipe],
			);
			if (!this.#isCurrent(request)) {
				return;
			}
			const result = await this.#requireDynamicBaker().bake({
				recipe,
				revision: this.#nextRendererRevision(),
				sourceGeometry,
				texturePlacementSnapshot: textureReservation.placementSnapshot,
				texturePlanning,
			});
			if (!this.#isCurrent(request)) {
				return;
			}
			if (!this.#isCurrent(request)) {
				return;
			}
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
			} else if (product?.kind === "skipped") {
				this.#skippedVisualCount += 1;
				this.#controller.skipDynamicVisual(product.entityId, product.reason);
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
			}
			this.#commitRendererState(this.#lastFrameTimeSeconds);
		} catch (error) {
			if (!this.#isCurrent(request)) {
				return;
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
		const removedVisualResourceIds = [...this.#committedResourceIds].filter(
			(resourceId) => !nextResourceIds.has(resourceId),
		);
		this.#renderer.commitDynamicResources({
			addedVisualResources: resources,
			removedVisualResourceIds,
			revision: this.#nextRendererRevision(),
		});
		this.#dynamicResourceCommitCount += 1;
		this.#maxResourcesPerCommit = Math.max(
			this.#maxResourcesPerCommit,
			resources.length,
		);
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

function pushRecent<T>(items: T[], item: T, limit: number): void {
	items.push(item);
	if (items.length > limit) {
		items.splice(0, items.length - limit);
	}
}
