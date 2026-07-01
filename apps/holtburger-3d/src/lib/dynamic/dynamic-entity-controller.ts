import type {
	StaticBounds,
	StaticAuthoredDynamicPlacementRecord,
	StaticResourceIdentity,
	OutdoorStaticObjectDomain,
	StaticLayerPeerRecordOwner,
	LayerOwnerKey,
	VisualTextureDomain,
} from "../static/contracts";
import {
	createDynamicVisualResourceId,
	type BakedDynamicVisualResource,
	type DynamicEntityCurrentBounds,
	type DynamicEntityAnimationSelection,
	type DynamicEntityAnimationState,
	type DynamicEntityAppearanceOverride,
	RUNTIME_AUTHORED_DYNAMIC_DETAIL_ROLE_POLICY,
	RUNTIME_AUTHORED_DYNAMIC_DIAGNOSTICS_BUCKET,
	RUNTIME_AUTHORED_DYNAMIC_RESOURCE_FAMILY,
	type DynamicEntityId,
	type DynamicEntityRecord,
	type DynamicEntityRenderability,
	type DynamicEntityRenderabilityReason,
	type DynamicEntityResourceState,
	type DynamicEntityResourceFailure,
	type DynamicEntityResourceKey,
	type DynamicEntityRequiredResource,
	type DynamicEntityServerInstanceMetadata,
	type DynamicEntitySetupAnimationResourceState,
	type DynamicEntitySummaryDto,
	type DynamicEntitySourceFacts,
	type DynamicEntityResidence,
	type DynamicEntityRenderResidence,
	type DynamicEntityPresentation,
	type DynamicEntityTransformState,
	type DynamicVisualObjectIdentity,
	type DynamicVisualSkipReason,
	type DynamicVisualSource,
	type StaticAuthoredDynamicPlacementFacts,
	type DynamicRuntimeSnapshot,
	type DynamicEntityRecipe,
	isEnvCellDynamicPlacementRecord,
	isOutdoorDynamicPlacementRecord,
} from "./contracts";
import type { DynamicVisualRecipeResolutionPayload } from "./visual-recipe-resolver";
import { createLayerOwnerKeyId } from "../static/layer-owners";
import { DynamicAnimationPlayer } from "./dynamic-animation-player";
import { DynamicEntityStore } from "./dynamic-entity-store";
import {
	shouldUpdateDynamicAnimationForCadence,
	type DynamicAnimationUpdateCadenceContext,
} from "./dynamic-animation-update-cadence";
import {
	DynamicPlacementTracker,
	type EnvCellDynamicSpatialIndexRecord,
} from "./dynamic-placement-tracker";
import type { OutdoorDynamicSpatialIndexRecord } from "./outdoor-dynamic-spatial-index";

const FIRST_SLICE_REQUIRED_RESOURCES = ["setup-model", "animation"] as const;
const VISUAL_REQUIRED_RESOURCES = [
	"setup-appearance",
	"gfx",
	"material",
	"palette",
	"render-surface",
	"prepared-texture",
] as const;
const RUNTIME_SPAWN_ID_PREFIX = "runtime-spawn";
type DynamicEntityTextureDomain = VisualTextureDomain;

export interface DynamicEntityControllerOptions {
	readonly onResourcesChanged?: () => void;
	readonly placementTracker?: DynamicPlacementTracker;
	readonly store?: DynamicEntityStore;
}

export interface DynamicEntityTickOptions {
	/** Browser/app-local camera cadence context; null keeps dynamic evaluation full-rate. */
	readonly animationCadenceContext?: DynamicAnimationUpdateCadenceContext | null;
}

export interface StaticAuthoredDynamicPreparationStatus {
	readonly entityIds: readonly DynamicEntityId[];
	readonly ownerId: string;
	readonly phase: "failed" | "pending" | "ready";
}

export interface RuntimeDynamicSpawnRequest {
	readonly animationSelection?: DynamicEntityAnimationSelection;
	readonly baseLocalPlacement: DynamicEntityTransformState["baseLocalPlacement"];
	readonly modelData?: DynamicEntityAppearanceOverride | null;
	/** Current render residence; omitted means the entity renders from its source residence. */
	readonly renderResidence?: DynamicEntityRenderResidence;
	readonly serverInstanceIdMetadata?: DynamicEntityServerInstanceMetadata | null;
	readonly setupModelId: number;
	readonly sourceResidence: DynamicEntityResidence;
	readonly sourceScale?: DynamicEntityTransformState["sourceScale"];
}

export class DynamicEntityController {
	readonly #animationPlayer = new DynamicAnimationPlayer();
	readonly #lastAnimationUpdateAtSecondsByEntityId = new Map<
		DynamicEntityId,
		number
	>();
	readonly #placementTracker: DynamicPlacementTracker;
	readonly #store: DynamicEntityStore;
	readonly #onResourcesChanged: () => void;
	#nextRuntimeSpawnOrdinal = 1;

	constructor(options: DynamicEntityControllerOptions = {}) {
		this.#placementTracker =
			options.placementTracker ?? new DynamicPlacementTracker();
		this.#store = options.store ?? new DynamicEntityStore();
		this.#onResourcesChanged = options.onResourcesChanged ?? (() => {});
	}

	ingestStaticPlacements(
		records: readonly StaticAuthoredDynamicPlacementRecord[],
	): void {
		for (const record of records) {
			if (
				!isOutdoorDynamicPlacementRecord(record) &&
				!isEnvCellDynamicPlacementRecord(record)
			) {
				continue;
			}
			const entityRecord = createDynamicEntityRecord(record);
			this.#store.upsert(entityRecord);
		}
	}

	retainLayerOwners(layerOwners: readonly LayerOwnerKey[]): void {
		const removed = this.#store.retainStaticLayerOwnerIds(
			new Set(layerOwners.map(createLayerOwnerKeyId)),
		);
		for (const record of removed) {
			this.#releaseRecordState(record);
		}
	}

	createRuntimeSpawn(request: RuntimeDynamicSpawnRequest): DynamicEntityId {
		const id = this.#allocateRuntimeSpawnId();
		const record = createRuntimeDynamicEntityRecord(id, request);
		this.#store.upsert(record);
		return id;
	}

	removeRuntimeSpawn(entityId: DynamicEntityId): boolean {
		const record = this.#store.get(entityId);
		if (record === null || record.source.kind !== "runtime-spawn") {
			return false;
		}
		this.#store.remove(entityId);
		this.#releaseRecordState(record);
		return true;
	}

	updateRuntimeSpawn(
		entityId: DynamicEntityId,
		request: RuntimeDynamicSpawnRequest,
	): boolean {
		const record = this.#store.get(entityId);
		if (record === null || record.source.kind !== "runtime-spawn") {
			return false;
		}
		this.#releaseRecordState(record);
		const updatedRecord = createRuntimeDynamicEntityRecord(entityId, request);
		this.#store.upsert(updatedRecord);
		return true;
	}

	updateRuntimeSpawnRenderResidence(
		entityId: DynamicEntityId,
		renderResidence: DynamicEntityRenderResidence,
	): boolean {
		const updated = this.#store.update(entityId, (record) => {
			if (record.source.kind !== "runtime-spawn") {
				return record;
			}
			return withRuntimeRenderResidence(record, renderResidence);
		});
		if (updated === null || updated.source.kind !== "runtime-spawn") {
			return false;
		}
		this.#upsertPlacementUpdate(updated);
		return true;
	}

	clearEvictedRuntimeRenderResidences(
		retainedLayerOwners: readonly LayerOwnerKey[],
	): number {
		let changed = 0;
		for (const record of this.#store.records()) {
			if (
				record.source.kind !== "runtime-spawn" ||
				record.effectiveResidence.kind === "no-residence" ||
				isRenderResidenceRetained(
					record.effectiveResidence,
					retainedLayerOwners,
				)
			) {
				continue;
			}
			if (
				this.updateRuntimeSpawnRenderResidence(record.id, {
					kind: "no-residence",
					reason: "render-residence-evicted",
				})
			) {
				changed += 1;
			}
		}
		return changed;
	}

	createRuntimeVisualRecipeRequest(
		entityId: DynamicEntityId,
	): DynamicVisualRecipeResolutionPayload | null {
		const record = this.#store.get(entityId);
		if (record === null || record.source.kind !== "runtime-spawn") {
			return null;
		}
		const materialPlanningIdentity =
			record.presentation.policy.materialPlanningIdentity;
		if (materialPlanningIdentity.kind !== "setup-backed-visual") {
			throw new Error(
				`Runtime dynamic ${entityId} cannot resolve visual recipe with material planning identity ${materialPlanningIdentity.kind}.`,
			);
		}
		return {
			animationSelection: record.source.animationSelection,
			baseTransform: record.baseTransform,
			entityId,
			materialPolicy: {
				detailRolePolicy: record.presentation.policy.materialDetailRolePolicy,
				materialPlanningDomain:
					record.presentation.policy.materialPlanningDomain,
				visualObject: materialPlanningIdentity.visualObject,
			},
			modelData: record.source.modelData,
			setupModelId: record.source.setupModelId,
			source: {
				kind: "runtime-authored",
				runtimeEntityId: entityId,
				sourceResidence: record.sourceResidence,
			},
		};
	}

	applyResolvedDynamicRecipe(recipe: DynamicEntityRecipe): boolean {
		const current = this.#store.get(recipe.entityId);
		if (current === null || !canApplyRecipeToRecord(current, recipe)) {
			return false;
		}
		const updated = this.#store.update(recipe.entityId, (record) => {
			if (!canApplyRecipeToRecord(record, recipe)) {
				return record;
			}
			const resources = createResourcesWithResolvedRecipe(
				record.resources,
				recipe,
			);
			return {
				...record,
				animation: createAnimationStateFromSetupAnimationResource(
					record.animation,
					resources.setupAnimation,
				),
				renderability: createRenderability(
					resources,
					record.effectiveResidence,
				),
				resources,
			};
		});
		if (updated === null) {
			return false;
		}
		this.#upsertPlacementUpdate(updated);
		this.#onResourcesChanged();
		return true;
	}

	applyBakedDynamicVisual(resource: BakedDynamicVisualResource): boolean {
		if (this.#store.get(resource.entityId) === null) {
			return false;
		}
		const updated = this.#store.update(resource.entityId, (record) => {
			const resources = createResourcesWithBakedVisual(
				record.resources,
				resource,
			);
			return {
				...record,
				renderability: createRenderability(
					resources,
					record.effectiveResidence,
				),
				resources,
			};
		});
		if (updated === null) {
			return false;
		}
		this.#upsertPlacementUpdate(updated);
		this.#onResourcesChanged();
		return true;
	}

	skipDynamicVisual(
		entityId: DynamicEntityId,
		reason: DynamicVisualSkipReason,
	): boolean {
		if (this.#store.get(entityId) === null) {
			return false;
		}
		const updated = this.#store.update(entityId, (record) => {
			const resources = createResourcesWithSkippedVisual(
				record.resources,
				reason,
			);
			return {
				...record,
				renderability: createRenderability(
					resources,
					record.effectiveResidence,
				),
				resources,
			};
		});
		if (updated === null) {
			return false;
		}
		this.#upsertPlacementUpdate(updated);
		this.#onResourcesChanged();
		return true;
	}

	tick(timeSeconds: number, options: DynamicEntityTickOptions = {}): boolean {
		let changed = false;
		for (const record of this.#store.records()) {
			if (!this.#shouldTickRecordAnimation(record, timeSeconds, options)) {
				continue;
			}
			const update = this.#animationPlayer.update(record, timeSeconds);
			const placementUpdate = this.#placementTracker.update(update.record);
			this.#lastAnimationUpdateAtSecondsByEntityId.set(record.id, timeSeconds);
			if (update.changed || placementUpdate.changed) {
				this.#store.upsert(placementUpdate.record);
				changed = true;
			}
		}
		return changed;
	}

	dispose(): void {
		this.#lastAnimationUpdateAtSecondsByEntityId.clear();
		this.#placementTracker.releaseAll();
	}

	createSnapshot(): DynamicRuntimeSnapshot {
		return this.#store.createSnapshot();
	}

	queryDynamicEntitySummary(
		entityId: DynamicEntityId,
	): DynamicEntitySummaryDto | null {
		return this.#store.getSummary(entityId);
	}

	queryStaticAuthoredPreparationStatus(
		ownerIds: ReadonlySet<string>,
	): readonly StaticAuthoredDynamicPreparationStatus[] {
		return Array.from(ownerIds)
			.sort()
			.map((ownerId) =>
				createStaticAuthoredDynamicPreparationStatus(
					ownerId,
					this.#store
						.records()
						.filter(
							(record) =>
								record.source.kind === "static-authored" &&
								record.provenance.kind !== "runtime-spawn" &&
								record.provenance.layerOwnerId === ownerId,
						),
				),
			);
	}

	queryOutdoorDynamicBounds(options: {
		readonly landblockId: number;
		readonly bounds: StaticBounds;
	}): readonly OutdoorDynamicSpatialIndexRecord[] {
		return this.#placementTracker.queryOutdoorBounds(options);
	}

	queryOutdoorDynamicLandblockIds(): readonly number[] {
		return this.#placementTracker.outdoorLandblockIds();
	}

	queryEnvCellDynamicBounds(options: {
		readonly envCellIds: readonly number[];
		readonly landblockId: number;
	}): readonly EnvCellDynamicSpatialIndexRecord[] {
		return this.#placementTracker.queryEnvCellBounds(options);
	}

	/** Returns current render-query bounds for identity-driven browser selection overlays. */
	queryDynamicCurrentBounds(
		entityId: DynamicEntityId,
	): DynamicEntityCurrentBounds | null {
		return this.#store.get(entityId)?.bounds.currentBounds ?? null;
	}

	#allocateRuntimeSpawnId(): DynamicEntityId {
		const id = `${RUNTIME_SPAWN_ID_PREFIX}:${this.#nextRuntimeSpawnOrdinal}`;
		this.#nextRuntimeSpawnOrdinal += 1;
		return id;
	}

	#releaseRecordState(record: DynamicEntityRecord): void {
		this.#lastAnimationUpdateAtSecondsByEntityId.delete(record.id);
		this.#placementTracker.release(record.id);
	}

	#upsertPlacementUpdate(record: DynamicEntityRecord): void {
		const placementUpdate = this.#placementTracker.update(record);
		if (placementUpdate.changed) {
			this.#store.upsert(placementUpdate.record);
		}
	}

	#shouldTickRecordAnimation(
		record: DynamicEntityRecord,
		timeSeconds: number,
		options: DynamicEntityTickOptions,
	): boolean {
		return shouldUpdateDynamicAnimationForCadence({
			context: options.animationCadenceContext ?? null,
			lastUpdatedAtSeconds:
				this.#lastAnimationUpdateAtSecondsByEntityId.get(record.id) ?? null,
			record,
			timeSeconds,
		}).shouldUpdate;
	}
}

function createDynamicEntityRecord(
	record: Extract<
		StaticAuthoredDynamicPlacementRecord,
		{
			readonly kind:
				| "env-cell-static-object-dynamic-placement"
				| "outdoor-static-object-dynamic-placement";
		}
	>,
): DynamicEntityRecord {
	const layerOwnerId = createStaticLayerOwnerId(record.owner);
	const sourceResidence =
		record.kind === "env-cell-static-object-dynamic-placement"
			? {
					kind: "env-cell" as const,
					envCellId: record.placement.envCellId,
					landblockId: record.placement.landblockId,
				}
			: {
					kind: "outdoor-landblock" as const,
					landblockId: record.placement.sourceResidence.landblockId,
				};
	const id = createDynamicEntityId(record, layerOwnerId);
	const presentation = createStaticAuthoredPresentation({
		id,
		layerOwnerId,
		record,
		sourceResidence,
	});
	const resourceState = createInitialPendingResourceState(presentation);

	return {
		animation: createInitialAnimationState({
			animationSelection: presentation.visualSource.animationSelection,
			defaultAnimationId: record.placement.defaultAnimationId,
		}),
		baseTransform: {
			baseLocalPlacement: record.placement.localPlacement,
			sourceScale: record.placement.sourceScale,
		},
		bounds: {
			currentBounds: null,
			indexMembership: { kind: "none" },
			indexed: false,
			precision: "none",
		},
		effectiveResidence: sourceResidence,
		id,
		presentation,
		provenance: {
			kind:
				record.kind === "env-cell-static-object-dynamic-placement"
					? "static-authored-env-cell"
					: "static-authored-outdoor",
			layerOwnerId,
			owner: record.owner,
		},
		renderability: {
			reasons: ["resources-pending"],
			status: "non-renderable",
		},
		resources: {
			...resourceState,
		},
		source: {
			kind: "static-authored",
			placement: record.placement,
		},
		sourceResidence,
	};
}

function createRuntimeDynamicEntityRecord(
	id: DynamicEntityId,
	request: RuntimeDynamicSpawnRequest,
): DynamicEntityRecord {
	const animationSelection = request.animationSelection ?? {
		kind: "setup-default" as const,
	};
	const defaultAnimationId =
		animationSelection.kind === "explicit"
			? animationSelection.animationId
			: null;
	const source = {
		animationSelection,
		kind: "runtime-spawn" as const,
		modelData: request.modelData ?? null,
		runtimeEntityId: id,
		serverInstanceIdMetadata: request.serverInstanceIdMetadata ?? null,
		setupModelId: request.setupModelId,
		sourceKind: "browser-authored-server-shaped" as const,
	};
	const presentation = createRuntimeSpawnPresentation({
		id,
		source,
		sourceResidence: request.sourceResidence,
	});
	const resourceState = createInitialPendingResourceState(presentation);
	const renderResidence = request.renderResidence ?? request.sourceResidence;

	return {
		animation: createInitialAnimationState({
			animationSelection,
			defaultAnimationId,
		}),
		baseTransform: {
			baseLocalPlacement: request.baseLocalPlacement,
			sourceScale: request.sourceScale ?? { x: 1, y: 1, z: 1 },
		},
		bounds: {
			currentBounds: null,
			indexMembership: { kind: "none" },
			indexed: false,
			precision: "none",
		},
		effectiveResidence: renderResidence,
		id,
		presentation,
		provenance: {
			kind: "runtime-spawn",
			sourceKind: "browser-authored-server-shaped",
		},
		renderability: {
			reasons: createRenderabilityReasons(resourceState, renderResidence),
			status: "non-renderable",
		},
		resources: resourceState,
		source,
		sourceResidence: request.sourceResidence,
	};
}

function canApplyRecipeToRecord(
	record: DynamicEntityRecord,
	recipe: DynamicEntityRecipe,
): boolean {
	if (record.source.kind === "runtime-spawn") {
		return (
			recipe.source.kind === "runtime-authored" &&
			recipe.source.runtimeEntityId === record.id
		);
	}
	return (
		recipe.source.kind === "static-authored" &&
		record.provenance.kind !== "runtime-spawn" &&
		recipe.source.owner.ownerId === record.provenance.layerOwnerId
	);
}

function createInitialAnimationState(options: {
	readonly animationSelection: DynamicEntityAnimationSelection;
	readonly defaultAnimationId: number | null;
}): DynamicEntityAnimationState {
	if (options.animationSelection.kind === "none") {
		return {
			defaultAnimationId: options.defaultAnimationId,
			playback: {
				reason: "animation-not-selected",
				status: "not-required",
			},
			status: "not-required",
		};
	}
	return {
		defaultAnimationId: options.defaultAnimationId,
		playback: {
			status: "pending-resource",
		},
		status: "pending-resource",
	};
}

function createStaticAuthoredPresentation(options: {
	readonly id: DynamicEntityId;
	readonly layerOwnerId: string;
	readonly record: Extract<
		StaticAuthoredDynamicPlacementRecord,
		{
			readonly kind:
				| "env-cell-static-object-dynamic-placement"
				| "outdoor-static-object-dynamic-placement";
		}
	>;
	readonly sourceResidence: DynamicEntityResidence;
}): DynamicEntityPresentation {
	const { id, layerOwnerId, record, sourceResidence } = options;
	const animationSelection = {
		animationId: record.placement.defaultAnimationId,
		kind: "explicit" as const,
	};
	const visualObject = createDynamicVisualObjectIdentity(id);
	return {
		diagnostics: {
			kind: "static-authored",
			layerOwnerId,
			owner: record.owner,
		},
		policy: {
			diagnosticsBucket: "static-authored-dynamic",
			materialPlanningIdentity: {
				kind: "setup-backed-visual",
				visualObject,
			},
			materialPlanningDomain: createStaticAuthoredMaterialPlanningDomain(
				record.owner,
			),
			materialDetailRolePolicy: {
				domain: createStaticAuthoredMaterialPlanningDomain(record.owner),
				kind: "static-domain",
			},
			ownershipPolicy: {
				kind: "dynamic-visual-resource",
				resourceId: visualObject.resourceId,
			},
			resourceFamily: "static-authored-dynamic-object-material",
			retentionPolicy: {
				kind: "static-layer-owner",
				layerOwnerId,
			},
			textureDomain: createStaticAuthoredTextureDomain(record.owner),
		},
		visualSource: {
			animationSelection,
			modelData: null,
			setupModelId: record.placement.setupModelId,
			sourceAssetIds: [record.placement.sourceAssetId],
			sourceResidence,
		},
	};
}

function createRuntimeSpawnPresentation(options: {
	readonly id: DynamicEntityId;
	readonly source: Extract<
		DynamicEntitySourceFacts,
		{ readonly kind: "runtime-spawn" }
	>;
	readonly sourceResidence: DynamicEntityResidence;
}): DynamicEntityPresentation {
	const { id, source, sourceResidence } = options;
	const visualObject = createDynamicVisualObjectIdentity(id);
	return {
		diagnostics: {
			kind: "runtime-spawn",
			serverInstanceIdMetadata: source.serverInstanceIdMetadata,
			sourceKind: source.sourceKind,
		},
		policy: {
			diagnosticsBucket: RUNTIME_AUTHORED_DYNAMIC_DIAGNOSTICS_BUCKET,
			materialPlanningIdentity: {
				kind: "setup-backed-visual",
				visualObject,
			},
			materialPlanningDomain: RUNTIME_AUTHORED_DYNAMIC_RESOURCE_FAMILY,
			materialDetailRolePolicy: {
				kind: RUNTIME_AUTHORED_DYNAMIC_DETAIL_ROLE_POLICY,
			},
			ownershipPolicy: {
				kind: "dynamic-visual-resource",
				resourceId: visualObject.resourceId,
			},
			resourceFamily: RUNTIME_AUTHORED_DYNAMIC_RESOURCE_FAMILY,
			retentionPolicy: {
				kind: "explicit-runtime-lifetime",
			},
			textureDomain: createRuntimeSpawnTextureDomain(),
		},
		visualSource: {
			animationSelection: source.animationSelection,
			modelData: source.modelData,
			setupModelId: source.setupModelId,
			sourceAssetIds: [
				`setup-model/${source.setupModelId.toString(16).padStart(8, "0")}`,
			],
			sourceResidence,
		},
	};
}

function createDynamicVisualObjectIdentity(
	entityId: DynamicEntityId,
): DynamicVisualObjectIdentity {
	return {
		entityId,
		kind: "dynamic-visual-object",
		resourceId: createDynamicVisualResourceId(entityId),
	};
}

function createStaticAuthoredTextureDomain(
	owner: StaticLayerPeerRecordOwner,
): DynamicEntityTextureDomain {
	return createStaticAuthoredObjectMaterialDomain(owner);
}

function createStaticAuthoredMaterialPlanningDomain(
	owner: StaticLayerPeerRecordOwner,
): "env-cell-system" | OutdoorStaticObjectDomain {
	return createStaticAuthoredObjectMaterialDomain(owner);
}

function createStaticAuthoredObjectMaterialDomain(
	owner: StaticLayerPeerRecordOwner,
): "env-cell-system" | OutdoorStaticObjectDomain {
	if (owner.domain === "env-cell-system") {
		return "env-cell-system";
	}
	if (
		owner.domain === "outdoor-buildings" ||
		owner.domain === "outdoor-explicit-objects" ||
		owner.domain === "outdoor-generated-scenery"
	) {
		return owner.domain;
	}
	throw new Error(
		`Static-authored dynamic object owner cannot use ${owner.domain} material domain.`,
	);
}

function createRuntimeSpawnTextureDomain(): DynamicEntityTextureDomain {
	return "runtime-object-material";
}

function createResourcesWithResolvedRecipe(
	current: DynamicEntityResourceState,
	recipe: DynamicEntityRecipe,
): DynamicEntityResourceState {
	const setupAnimation = createSetupAnimationStateFromRecipe(recipe);
	return {
		...current,
		required: createRequiredResourcesForSetupAnimation(setupAnimation),
		setupAnimation,
		status:
			current.visual.status === "ready"
				? "ready"
				: current.visual.status === "failed"
					? "failed"
					: "setup-animation-ready",
	};
}

function createSetupAnimationStateFromRecipe(
	recipe: DynamicEntityRecipe,
): Extract<
	DynamicEntitySetupAnimationResourceState,
	{ readonly status: "not-required" | "ready" }
> {
	const setupModelKey: DynamicEntityResourceKey = {
		id: recipe.visual.setupModel.identity.sourceDid,
		kind: "setup-model",
	};
	if (recipe.visual.animation === null) {
		return {
			reason:
				recipe.animationSelection.kind === "none"
					? "animation-not-selected"
					: "setup-default-animation-missing",
			setupModelKey,
			status: "not-required",
		};
	}
	return {
		animation: recipe.visual.animation,
		animationKey: {
			id: recipe.visual.animation.payload.animationId,
			kind: "animation",
		},
		setupModelKey,
		status: "ready",
	};
}

function createResourcesWithBakedVisual(
	current: DynamicEntityResourceState,
	resource: BakedDynamicVisualResource,
): DynamicEntityResourceState {
	return {
		required: [
			...createRequiredResourcesForSetupAnimation(current.setupAnimation),
			...VISUAL_REQUIRED_RESOURCES,
		],
		setupAnimation: current.setupAnimation,
		status: "ready",
		visual: {
			materialSlots: resource.materialSlots,
			materialSources: resource.materialSources,
			paletteSources: resource.paletteSources,
			renderParts: resource.renderParts,
			sourceAssets: resource.sourceAssets,
			status: "ready",
			textureDependencies: resource.textureDependencies,
			textureRefs: resource.textureRefs,
			textureRequirements: resource.textureRequirements,
		},
	};
}

function createResourcesWithSkippedVisual(
	current: DynamicEntityResourceState,
	reason: DynamicVisualSkipReason,
): DynamicEntityResourceState {
	return {
		required: [
			...createRequiredResourcesForSetupAnimation(current.setupAnimation),
			...VISUAL_REQUIRED_RESOURCES,
		],
		setupAnimation: current.setupAnimation,
		status: "failed",
		visual: {
			failures: createFailuresFromVisualSkipReason(reason),
			missingRefs:
				reason.kind === "missing-dependencies" ? reason.missingRefs : [],
			status: "failed",
			unsupportedReasons:
				reason.kind === "unsupported-materials"
					? reason.unsupportedReasons
					: [],
		},
	};
}

function createRequiredResourcesForSetupAnimation(
	setupAnimation: DynamicEntitySetupAnimationResourceState,
): readonly DynamicEntityRequiredResource[] {
	return setupAnimation.status === "not-required"
		? ["setup-model"]
		: FIRST_SLICE_REQUIRED_RESOURCES;
}

function createFailuresFromVisualSkipReason(
	reason: DynamicVisualSkipReason,
): readonly DynamicEntityResourceFailure[] {
	if (reason.kind === "missing-dependencies") {
		return reason.missingRefs.map(createMissingRefFailure);
	}
	if (reason.kind === "invalid-recipe") {
		return [
			{
				message: reason.message,
				resource: "gfx",
				resourceKey: {
					id: "dynamic-visual-recipe",
					kind: "gfx",
				},
			},
		];
	}
	return [];
}

function createMissingRefFailure(
	ref: StaticResourceIdentity,
): DynamicEntityResourceFailure {
	const resourceKey = createResourceKeyFromMissingRef(ref);
	return {
		message: `Missing dynamic visual resource ${formatMissingRef(ref)}.`,
		resource: resourceKey.kind,
		resourceKey,
	};
}

function createResourceKeyFromMissingRef(
	ref: StaticResourceIdentity,
): DynamicEntityResourceKey {
	switch (ref.kind) {
		case "static-object-source":
			return {
				id: ref.sourceDid,
				kind: ref.sourceAssetKind === "gfx-obj" ? "gfx" : ref.sourceAssetKind,
			};
		case "static-material-source":
			return {
				id: ref.materialId,
				kind: "material",
			};
		case "surface-texture":
			return {
				id: ref.surfaceTextureId,
				kind: "prepared-texture",
			};
		case "render-surface":
			return {
				id: ref.renderSurfaceId,
				kind: "render-surface",
			};
		case "palette":
			return {
				id: ref.paletteId,
				kind: "palette",
			};
		default:
			return {
				id: formatMissingRef(ref),
				kind: "prepared-texture",
			};
	}
}

function formatMissingRef(ref: StaticResourceIdentity): string {
	if (ref.kind === "static-object-source") {
		return `${ref.sourceAssetKind}:${formatHex32(ref.sourceDid)}`;
	}
	if (ref.kind === "static-material-source") {
		return `material:${formatHex32(ref.materialId)}`;
	}
	if (ref.kind === "surface-texture") {
		return `surface-texture:${formatHex32(ref.surfaceTextureId)}`;
	}
	if (ref.kind === "render-surface") {
		return `render-surface:${formatHex32(ref.renderSurfaceId)}`;
	}
	if (ref.kind === "palette") {
		return `palette:${formatHex32(ref.paletteId)}`;
	}
	return ref.kind;
}

function createStaticAuthoredDynamicPreparationStatus(
	ownerId: string,
	records: readonly DynamicEntityRecord[],
): StaticAuthoredDynamicPreparationStatus {
	const entityIds = records.map((record) => record.id);
	if (records.some((record) => record.resources.status === "failed")) {
		return { entityIds, ownerId, phase: "failed" };
	}
	if (records.some((record) => record.resources.status !== "ready")) {
		return { entityIds, ownerId, phase: "pending" };
	}
	return { entityIds, ownerId, phase: "ready" };
}

function withRuntimeRenderResidence(
	record: DynamicEntityRecord,
	renderResidence: DynamicEntityRenderResidence,
): DynamicEntityRecord {
	if (record.source.kind !== "runtime-spawn") {
		return record;
	}
	return {
		...record,
		effectiveResidence: renderResidence,
		renderability: createRenderability(record.resources, renderResidence),
	};
}

function isRenderResidenceRetained(
	renderResidence: DynamicEntityResidence,
	retainedLayerOwners: readonly LayerOwnerKey[],
): boolean {
	if (renderResidence.kind === "env-cell") {
		return retainedLayerOwners.some(
			(owner) =>
				owner.kind === "env-cell-system" &&
				owner.landblockId === renderResidence.landblockId,
		);
	}

	return retainedLayerOwners.some(
		(owner) =>
			owner.kind !== "env-cell-system" &&
			owner.landblockId === renderResidence.landblockId,
	);
}

function createAnimationStateFromSetupAnimationResource(
	current: DynamicEntityAnimationState,
	setupAnimation: DynamicEntitySetupAnimationResourceState,
): DynamicEntityAnimationState {
	if (setupAnimation.status === "ready") {
		return {
			...current,
			defaultAnimationId: setupAnimation.animation.payload.animationId,
			status: "ready",
		};
	}
	if (setupAnimation.status === "not-required") {
		return {
			defaultAnimationId: null,
			playback: {
				reason: setupAnimation.reason,
				status: "not-required",
			},
			status: "not-required",
		};
	}
	return current;
}

function createInitialPendingResourceState(
	presentation: DynamicEntityPresentation,
): DynamicEntityResourceState {
	return {
		required: FIRST_SLICE_REQUIRED_RESOURCES,
		setupAnimation: createPendingSetupAnimationState(presentation.visualSource),
		status: "pending",
		visual: {
			status: "pending",
		},
	};
}

function createPendingSetupAnimationState(
	visualSource: DynamicVisualSource,
): DynamicEntitySetupAnimationResourceState {
	const setupModelKey = {
		id: visualSource.setupModelId,
		kind: "setup-model" as const,
	};
	if (visualSource.animationSelection.kind === "none") {
		return {
			reason: "animation-not-selected",
			setupModelKey,
			status: "not-required",
		};
	}
	if (visualSource.animationSelection.kind === "setup-default") {
		return {
			pendingReason: "setup-default-animation-resolving",
			setupModelKey,
			status: "pending",
		};
	}

	return {
		animationKey: {
			id: visualSource.animationSelection.animationId,
			kind: "animation",
		},
		setupModelKey,
		status: "pending",
	};
}

function createRenderability(
	resources: DynamicEntityResourceState,
	renderResidence: DynamicEntityRenderResidence,
): DynamicEntityRenderability {
	const reasons = createRenderabilityReasons(resources, renderResidence);
	return {
		reasons,
		status: reasons.length === 0 ? "renderable" : "non-renderable",
	};
}

function createRenderabilityReasons(
	resources: DynamicEntityResourceState,
	renderResidence: DynamicEntityRenderResidence,
): readonly DynamicEntityRenderabilityReason[] {
	const reasons = new Set<DynamicEntityRenderabilityReason>();
	if (renderResidence.kind === "no-residence") {
		reasons.add("no-render-residence");
	}
	if (resources.status === "pending") {
		reasons.add("resources-pending");
	}
	if (resources.status === "setup-animation-ready") {
		reasons.add("visual-resources-pending");
	}
	if (
		resources.setupAnimation.status === "failed" &&
		resources.setupAnimation.failures.length > 0
	) {
		reasons.add("resource-load-failed");
	}
	if (resources.visual.status === "failed") {
		if (resources.visual.failures.length > 0) {
			reasons.add("resource-load-failed");
		}
		if (
			resources.visual.missingRefs.length > 0 ||
			resources.visual.unsupportedReasons.length > 0
		) {
			reasons.add("visual-resources-failed");
		}
	}
	return [...reasons];
}

function createDynamicEntityId(
	record: Extract<
		StaticAuthoredDynamicPlacementRecord,
		{
			readonly kind:
				| "env-cell-static-object-dynamic-placement"
				| "outdoor-static-object-dynamic-placement";
		}
	>,
	layerOwnerId: string,
): DynamicEntityId {
	if (record.kind === "env-cell-static-object-dynamic-placement") {
		const placement = record.placement;
		return [
			"static-authored-env-cell",
			layerOwnerId,
			`env-cell:${formatHex32(placement.envCellId)}`,
			`object:${placement.object.objectKind}:${placement.object.instanceId}`,
			`setup:${formatHex32(placement.setupModelId)}`,
		].join(":");
	}

	const placement: StaticAuthoredDynamicPlacementFacts = record.placement;
	return [
		"static-authored-outdoor",
		layerOwnerId,
		`object:${placement.object.objectKind}:${placement.object.instanceId}`,
		`setup:${formatHex32(placement.setupModelId)}`,
	].join(":");
}

function createStaticLayerOwnerId(owner: StaticLayerPeerRecordOwner): string {
	return owner.ownerId;
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
