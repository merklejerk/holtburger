import type {
	StaticBounds,
	StaticAuthoredDynamicSeedRecord,
	StaticScopeOwnerKey,
	StaticWorkPeerRecordOwner,
} from "../static/contracts";
import {
	createStaticScopeOwnerKey,
	type DynamicEntityCurrentBounds,
	isEnvCellDynamicSeedRecord,
	isOutdoorDynamicSeedRecord,
	type DynamicEntityId,
	type DynamicEntityRecord,
	type DynamicEntityResourceState,
	type StaticAuthoredDynamicSeedFacts,
	type DynamicRuntimeSnapshot,
} from "./contracts";
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

	ingestStaticSeeds(records: readonly StaticAuthoredDynamicSeedRecord[]): void {
		for (const record of records) {
			if (
				!isOutdoorDynamicSeedRecord(record) &&
				!isEnvCellDynamicSeedRecord(record)
			) {
				continue;
			}
			const entityRecord = createDynamicEntityRecord(
				record,
				this.#resourceManager,
			);
			this.#store.upsert(entityRecord);
			this.#resourceManager?.trackSetupAnimationResources(
				entityRecord.id,
				entityRecord.sourceSeed,
			);
		}
	}

	retainStaticScopes(scopes: readonly StaticScopeOwnerKey[]): void {
		const removed = this.#store.retainSourceScopeKeys(
			new Set(scopes.map(createStaticScopeOwnerKey)),
		);
		for (const record of removed) {
			this.#lastAnimationUpdateAtSecondsByEntityId.delete(record.id);
			this.#placementTracker.release(record.id);
			this.#resourceManager?.releaseEntity(record.id);
		}
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
			if (
				!this.#shouldTickRecordAnimation(record, timeSeconds, options)
			) {
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
	): DynamicRuntimeSnapshot["records"][number] | null {
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
	resourceManager: DynamicEntityResourceManager | null,
): DynamicEntityRecord {
	const sourceScopeKey = createSourceScopeKey(record.owner);
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
	const resourceState =
		resourceManager?.createInitialResourceState(record.seed) ??
		createFallbackInitialResourceState(record.seed);

	return {
		animation: {
			defaultAnimationId: record.seed.defaultAnimationId,
			playback: {
				status: "pending-resource",
			},
			status: "pending-resource",
		},
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
		id: createDynamicEntityId(record, sourceScopeKey),
		provenance: {
			kind:
				record.kind === "env-cell-static-object-dynamic-seed"
					? "static-authored-env-cell"
					: "static-authored-outdoor",
			owner: record.owner,
			sourceScopeKey,
		},
		renderability: {
			reasons: ["resources-pending"],
			status: "non-renderable",
		},
		resources: {
			...resourceState,
		},
		sourceResidence,
		sourceSeed: record.seed,
	};
}

function applyResourceChange(
	record: DynamicEntityRecord,
	change: DynamicEntityResourceChange,
): DynamicEntityRecord {
	if (change.kind === "setup-animation-ready") {
		return {
			...record,
			animation: {
				...record.animation,
				status: "ready",
			},
			renderability: createRenderability(change.resources),
			resources: change.resources,
		};
	}

	if (change.kind === "visual-resources-ready") {
		return {
			...record,
			renderability: createRenderability(change.resources),
			resources: change.resources,
		};
	}

	return {
		...record,
		renderability: createRenderability(change.resources),
		resources: change.resources,
	};
}

function createFallbackInitialResourceState(
	seed: StaticAuthoredDynamicSeedFacts,
): DynamicEntityResourceState {
	return {
		required: FIRST_SLICE_REQUIRED_RESOURCES,
		setupAnimation: {
			animationKey: {
				id: seed.defaultAnimationId,
				kind: "animation",
			},
			setupModelKey: {
				id: seed.setupModelId,
				kind: "setup-model",
			},
			status: "pending",
		},
		status: "pending",
		visual: {
			status: "pending",
		},
	};
}

function createRenderability(
	resources: DynamicEntityResourceState,
): DynamicEntityRecord["renderability"] {
	const reasons = createRenderabilityReasons(resources);
	return {
		reasons,
		status: reasons.length === 0 ? "renderable" : "non-renderable",
	};
}

function createRenderabilityReasons(
	resources: DynamicEntityResourceState,
): DynamicEntityRecord["renderability"]["reasons"] {
	const reasons = new Set<
		DynamicEntityRecord["renderability"]["reasons"][number]
	>();
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
	sourceScopeKey: string,
): DynamicEntityId {
	if (record.kind === "env-cell-static-object-dynamic-seed") {
		const seed = record.seed;
		return [
			"static-authored-env-cell",
			sourceScopeKey,
			`env-cell:${formatHex32(seed.envCellId)}`,
			`object:${seed.object.objectKind}:${seed.object.instanceId}`,
			`setup:${formatHex32(seed.setupModelId)}`,
		].join(":");
	}

	const seed: StaticAuthoredDynamicSeedFacts = record.seed;
	return [
		"static-authored-outdoor",
		sourceScopeKey,
		`object:${seed.object.objectKind}:${seed.object.instanceId}`,
		`setup:${formatHex32(seed.setupModelId)}`,
	].join(":");
}

function createSourceScopeKey(owner: StaticWorkPeerRecordOwner): string {
	return createStaticScopeOwnerKey({
		domain: owner.domain,
		scopeKey: owner.scopeKey,
	});
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
