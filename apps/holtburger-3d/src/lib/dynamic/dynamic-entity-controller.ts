import type {
	StaticBounds,
	StaticAuthoredDynamicSeedRecord,
	OutdoorStaticObjectDomain,
	StaticLayerPeerRecordOwner,
	LayerOwnerKey,
	VisualTextureDomain,
} from "../static/contracts";
import {
	createDynamicVisualResourceId,
	type DynamicEntityCurrentBounds,
	type DynamicEntityAnimationSelection,
	type DynamicEntityAnimationState,
	type DynamicEntityAppearanceOverride,
	isEnvCellDynamicSeedRecord,
	isOutdoorDynamicSeedRecord,
	RUNTIME_AUTHORED_DYNAMIC_DETAIL_ROLE_POLICY,
	RUNTIME_AUTHORED_DYNAMIC_DIAGNOSTICS_BUCKET,
	RUNTIME_AUTHORED_DYNAMIC_RESOURCE_FAMILY,
	type DynamicEntityId,
	type DynamicEntityRecord,
	type DynamicEntityRenderability,
	type DynamicEntityRenderabilityReason,
	type DynamicEntityResourceState,
	type DynamicEntityServerInstanceMetadata,
	type DynamicEntitySetupAnimationResourceState,
	type DynamicEntitySummaryDto,
	type DynamicEntitySourceFacts,
	type DynamicEntityResidence,
	type DynamicEntityRenderResidence,
	type DynamicEntityPresentation,
	type DynamicEntityTransformState,
	type DynamicVisualObjectIdentity,
	type DynamicVisualSource,
	type StaticAuthoredDynamicSeedFacts,
	type DynamicRuntimeSnapshot,
} from "./contracts";
import { createLayerOwnerKeyId } from "../static/layer-owners";
import { DynamicAnimationPlayer } from "./dynamic-animation-player";
import { DynamicEntityStore } from "./dynamic-entity-store";
import {
	DynamicEntityResourceManager,
	type DynamicEntityResourceChange,
} from "./dynamic-entity-resource-manager";
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
const RUNTIME_SPAWN_ID_PREFIX = "runtime-spawn";
type DynamicEntityTextureDomain = VisualTextureDomain;

export interface DynamicEntityControllerOptions {
	readonly onResourcesChanged?: () => void;
	readonly placementTracker?: DynamicPlacementTracker;
	readonly resourceManager?: DynamicEntityResourceManager;
	readonly store?: DynamicEntityStore;
}

export interface DynamicEntityTickOptions {
	/** Browser/app-local camera cadence context; null keeps dynamic evaluation full-rate. */
	readonly animationCadenceContext?: DynamicAnimationUpdateCadenceContext | null;
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
	readonly #resourceManager: DynamicEntityResourceManager | null;
	readonly #store: DynamicEntityStore;
	readonly #onResourcesChanged: () => void;
	#nextRuntimeSpawnOrdinal = 1;

	constructor(options: DynamicEntityControllerOptions = {}) {
		this.#placementTracker =
			options.placementTracker ?? new DynamicPlacementTracker();
		this.#resourceManager = options.resourceManager ?? null;
		this.#store = options.store ?? new DynamicEntityStore();
		this.#onResourcesChanged = options.onResourcesChanged ?? (() => {});
		this.#resourceManager?.setResourceChangeListener((change) => {
			this.applyResourceChange(change);
		});
	}

	ingestStaticSeeds(
		records: readonly StaticAuthoredDynamicSeedRecord[],
		textureBatchIdsByStaticLayerOwner: ReadonlyMap<string, string> = new Map(),
	): void {
		for (const record of records) {
			if (
				!isOutdoorDynamicSeedRecord(record) &&
				!isEnvCellDynamicSeedRecord(record)
			) {
				continue;
			}
			const entityRecord = createDynamicEntityRecord(
				record,
				textureBatchIdsByStaticLayerOwner,
			);
			this.#store.upsert(entityRecord);
			this.#trackRecordResources(entityRecord);
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
		this.#trackRecordResources(record);
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
		this.#trackRecordResources(updatedRecord);
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
				isRenderResidenceRetained(record.effectiveResidence, retainedLayerOwners)
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

	applyResourceChange(change: DynamicEntityResourceChange): void {
		const updated = this.#store.update(change.entityId, (record) =>
			applyResourceChange(record, change),
		);
		if (updated) {
			this.#upsertPlacementUpdate(updated);
			this.#onResourcesChanged();
		}
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
		this.#resourceManager?.releaseAll();
	}

	createSnapshot(): DynamicRuntimeSnapshot {
		return this.#store.createSnapshot();
	}

	queryDynamicEntitySummary(
		entityId: DynamicEntityId,
	): DynamicEntitySummaryDto | null {
		return this.#store.getSummary(entityId);
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
		this.#resourceManager?.releaseEntity(record.id);
	}

	#trackRecordResources(record: DynamicEntityRecord): void {
		this.#resourceManager?.trackProjectedVisualResources(
			record.id,
			record.presentation,
		);
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
		StaticAuthoredDynamicSeedRecord,
		{
			readonly kind:
				| "env-cell-static-object-dynamic-seed"
				| "outdoor-static-object-dynamic-seed";
		}
	>,
	textureBatchIdsByStaticLayerOwner: ReadonlyMap<string, string>,
): DynamicEntityRecord {
	const layerOwnerId = createStaticLayerOwnerId(record.owner);
	const sourceResidence =
		record.kind === "env-cell-static-object-dynamic-seed"
			? {
					kind: "env-cell" as const,
					envCellId: record.seed.envCellId,
					landblockId: record.seed.landblockId,
				}
			: {
					kind: "outdoor-landblock" as const,
					landblockId: record.seed.sourceResidence.landblockId,
				};
	const id = createDynamicEntityId(record, layerOwnerId);
	const presentation = createStaticAuthoredPresentation({
		id,
		layerOwnerId,
		record,
		sourceResidence,
		textureBatchId:
			textureBatchIdsByStaticLayerOwner.get(
				createStaticTextureBatchLookupKey(record.owner),
			) ?? `dynamic:${layerOwnerId}`,
	});
	const resourceState = createInitialPendingResourceState(presentation);

	return {
		animation: createInitialAnimationState({
			animationSelection: presentation.visualSource.animationSelection,
			defaultAnimationId: record.seed.defaultAnimationId,
		}),
		baseTransform: {
			baseLocalPlacement: record.seed.localPlacement,
			sourceScale: record.seed.sourceScale,
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
				record.kind === "env-cell-static-object-dynamic-seed"
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
			seed: record.seed,
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
		animationSelection.kind === "explicit" ? animationSelection.animationId : null;
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
		StaticAuthoredDynamicSeedRecord,
		{
			readonly kind:
				| "env-cell-static-object-dynamic-seed"
				| "outdoor-static-object-dynamic-seed";
		}
	>;
	readonly sourceResidence: DynamicEntityResidence;
	readonly textureBatchId: string;
}): DynamicEntityPresentation {
	const { id, layerOwnerId, record, sourceResidence, textureBatchId } = options;
	const animationSelection = {
		animationId: record.seed.defaultAnimationId,
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
			textureBatchId,
			textureDomain: createStaticAuthoredTextureDomain(record.owner),
		},
		visualSource: {
			animationSelection,
			modelData: null,
			setupModelId: record.seed.setupModelId,
			sourceAssetIds: [record.seed.sourceAssetId],
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
			textureBatchId: `runtime-dynamic:${id}`,
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
): "landblock-env-cells" | OutdoorStaticObjectDomain {
	return createStaticAuthoredObjectMaterialDomain(owner);
}

function createStaticAuthoredObjectMaterialDomain(
	owner: StaticLayerPeerRecordOwner,
): "landblock-env-cells" | OutdoorStaticObjectDomain {
	if (owner.domain === "landblock-env-cells") {
		return "landblock-env-cells";
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

function applyResourceChange(
	record: DynamicEntityRecord,
	change: DynamicEntityResourceChange,
): DynamicEntityRecord {
	if (change.kind === "setup-animation-ready") {
		return {
			...record,
			animation: createAnimationStateFromSetupAnimationResource(
				record.animation,
				change.resources.setupAnimation,
			),
			renderability: createRenderability(
				change.resources,
				record.effectiveResidence,
			),
			resources: change.resources,
		};
	}

	if (change.kind === "visual-resources-ready") {
		return {
			...record,
			renderability: createRenderability(
				change.resources,
				record.effectiveResidence,
			),
			resources: change.resources,
		};
	}

	return {
		...record,
		renderability: createRenderability(change.resources, record.effectiveResidence),
		resources: change.resources,
	};
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
		StaticAuthoredDynamicSeedRecord,
		{
			readonly kind:
				| "env-cell-static-object-dynamic-seed"
				| "outdoor-static-object-dynamic-seed";
		}
	>,
	layerOwnerId: string,
): DynamicEntityId {
	if (record.kind === "env-cell-static-object-dynamic-seed") {
		const seed = record.seed;
		return [
			"static-authored-env-cell",
			layerOwnerId,
			`env-cell:${formatHex32(seed.envCellId)}`,
			`object:${seed.object.objectKind}:${seed.object.instanceId}`,
			`setup:${formatHex32(seed.setupModelId)}`,
		].join(":");
	}

	const seed: StaticAuthoredDynamicSeedFacts = record.seed;
	return [
		"static-authored-outdoor",
		layerOwnerId,
		`object:${seed.object.objectKind}:${seed.object.instanceId}`,
		`setup:${formatHex32(seed.setupModelId)}`,
	].join(":");
}

function createStaticLayerOwnerId(owner: StaticLayerPeerRecordOwner): string {
	return owner.ownerId;
}

function createStaticTextureBatchLookupKey(
	owner: StaticLayerPeerRecordOwner,
): string {
	return `${owner.domain}:${owner.ownerId}`;
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
