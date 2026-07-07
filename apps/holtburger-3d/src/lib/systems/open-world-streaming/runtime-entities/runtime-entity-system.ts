import type { PreparedAssetReader } from "../../../assets/contracts";
import type { DynamicEntityId } from "../../../dynamic/contracts";
import { DynamicEntityController, type RuntimeDynamicSpawnRequest } from "../../../dynamic/dynamic-entity-controller";
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
	TexturePlacementUpdate,
} from "../../../renderer/types";
import type { DynamicEntityRenderResidence } from "../../../dynamic/contracts";
import { MaterializationOwnerRegistry, type MaterializationOwnerToken } from "../owners/owner-registry";
import {
	createRuntimeEntityMaterializationOwner,
	createStaticAuthoredDynamicMaterializationOwner,
	type MaterializationOwnerId,
} from "../owners/owner-id";
import { OpenWorldTextureClaimRegistry } from "../texture-residency/claims/texture-claim-registry";
import { buildObjectVisualTexturePlacementPlan } from "../texture-residency/placement/object-visual-texture-placement-plan";
import type { OpenWorldObjectVisualAtlasBuilder } from "../texture-residency/placement/object-visual-atlas-builder";
import { applyOpenWorldStreamingTextureCommit } from "../texture-residency/commits/texture-commit-applier";
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
	readonly textureClaims: OpenWorldTextureClaimRegistry;
}

export interface OpenWorldRuntimeEntityRendererPort {
	applyTexturePlacementUpdate(update: TexturePlacementUpdate): void;
	commitDynamicResources(commit: DynamicRendererResourceCommit): void;
	commitDynamicInstances(commit: DynamicRendererInstanceCommit): void;
}

interface DynamicPrepRequest {
	readonly entityId: DynamicEntityId;
	readonly ownerId: MaterializationOwnerId;
	readonly token: MaterializationOwnerToken;
}

export class OpenWorldRuntimeEntitySystem {
	readonly #assetReader: PreparedAssetReader;
	readonly #controller = new DynamicEntityController();
	readonly #createDynamicVisualBaker: () => DynamicVisualBaker;
	readonly #createDynamicVisualRecipeResolver: () => DynamicVisualRecipeResolver;
	readonly #objectVisualAtlasBuilder: OpenWorldObjectVisualAtlasBuilder;
	readonly #owners: MaterializationOwnerRegistry;
	readonly #renderer: OpenWorldRuntimeEntityRendererPort;
	readonly #staticChildOwnerIdsByParentId = new Map<
		MaterializationOwnerId,
		Set<MaterializationOwnerId>
	>();
	readonly #textureClaims: OpenWorldTextureClaimRegistry;
	#dynamicVisualBaker: DynamicVisualBaker | null = null;
	#dynamicVisualRecipeResolver: DynamicVisualRecipeResolver | null = null;
	#rendererRevision = 0;
	readonly #committedResourceIds = new Set<string>();

	constructor(options: OpenWorldRuntimeEntitySystemOptions) {
		this.#assetReader = options.assetReader;
		this.#createDynamicVisualBaker = options.createDynamicVisualBaker;
		this.#createDynamicVisualRecipeResolver =
			options.createDynamicVisualRecipeResolver;
		this.#objectVisualAtlasBuilder = options.objectVisualAtlasBuilder;
		this.#owners = options.owners;
		this.#renderer = options.renderer;
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
		if (this.#controller.tick(frameTimeSeconds)) {
			this.#commitRendererInstances(frameTimeSeconds);
		}
	}

	createSnapshot() {
		return this.#controller.createSnapshot();
	}

	async #prepareEntity(request: DynamicPrepRequest): Promise<void> {
		try {
			const recipeRequest =
				this.#controller.createRuntimeVisualRecipeRequest(request.entityId) ??
				this.#controller
					.createStaticAuthoredVisualRecipeRequests(
						this.#staticParentOwnerIdForChild(request.ownerId) ?? request.ownerId,
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
			if (!this.#controller.applyResolvedDynamicRecipe(recipe)) {
				return;
			}
			const texturePlanning = createDynamicVisualTexturePlanning(recipe);
			const texturePlan = await buildObjectVisualTexturePlacementPlan({
				atlasBuilder: this.#objectVisualAtlasBuilder,
				filteringMode: "nearest",
				intents: texturePlanning.placementIntents,
				ownerId: request.ownerId,
				textureClaims: this.#textureClaims,
			});
			if (!this.#isCurrent(request)) {
				return;
			}
			for (const commit of texturePlan.textureCommits) {
				applyOpenWorldStreamingTextureCommit(this.#renderer, commit, {
					revision: this.#nextRendererRevision(),
				});
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
				texturePlacementSnapshot: texturePlan.placementSnapshot,
				texturePlanning,
			});
			if (!this.#isCurrent(request)) {
				return;
			}
			const product = result.product;
			if (product?.kind === "baked") {
				this.#controller.applyBakedDynamicVisual(product.resource);
			} else if (product?.kind === "skipped") {
				this.#controller.skipDynamicVisual(product.entityId, product.reason);
			} else {
				for (const failure of result.failures) {
					console.warn("[holtburger-3d][open-world-dynamic-bake]", failure);
				}
				this.#controller.skipDynamicVisual(request.entityId, {
					kind: "invalid-recipe",
					message: result.failures.map((failure) => failure.message).join("; "),
				});
			}
			this.#commitRendererState(0);
		} catch (error) {
			if (!this.#isCurrent(request)) {
				return;
			}
			console.warn("[holtburger-3d][open-world-dynamic-prep]", error);
			this.#controller.skipDynamicVisual(request.entityId, {
				kind: "invalid-recipe",
				message: error instanceof Error ? error.message : String(error),
			});
			this.#commitRendererState(0);
		}
	}

	#commitRendererState(frameTimeSeconds: number): void {
		const snapshot = this.#controller.createSnapshot();
		const resources = snapshot.records.flatMap(createDynamicRendererVisualResources);
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
		this.#committedResourceIds.clear();
		for (const resourceId of nextResourceIds) {
			this.#committedResourceIds.add(resourceId);
		}
		this.#commitRendererInstances(frameTimeSeconds);
	}

	#commitRendererInstances(frameTimeSeconds: number): void {
		this.#renderer.commitDynamicInstances({
			frameTimeSeconds,
			instances: this.#controller
				.createSnapshot()
				.records.flatMap(createDynamicRendererInstances),
			revision: this.#nextRendererRevision(),
		});
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
		for (const [parentOwnerId, childOwnerIds] of this.#staticChildOwnerIdsByParentId) {
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
		this.#dynamicVisualRecipeResolver ??= this.#createDynamicVisualRecipeResolver();
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
