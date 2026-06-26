import type {
	StaticAuthoredDynamicSeedRecord,
	StaticScopeOwnerKey,
	StaticWorkPeerRecordOwner,
} from "../static/contracts";
import {
	createStaticScopeOwnerKey,
	type DynamicEntityIssue,
	isEnvCellDynamicSeedRecord,
	isOutdoorDynamicSeedRecord,
	type DynamicEntityId,
	type DynamicEntityRecord,
	type DynamicEntityResourceState,
	type StaticAuthoredDynamicSeedFacts,
	type DynamicRuntimeSnapshot,
} from "./contracts";
import { DynamicEntityStore } from "./dynamic-entity-store";
import {
	DynamicEntityResourceManager,
	type DynamicEntityResourceChange,
} from "./dynamic-entity-resource-manager";

const FIRST_SLICE_REQUIRED_RESOURCES = ["setup-model", "animation"] as const;
const PHASE_4B_REQUIRED_RESOURCES = [
	"setup-appearance",
	"gfx",
	"material",
	"palette",
	"render-surface",
	"prepared-texture",
] as const;

export interface DynamicEntityControllerOptions {
	readonly onResourcesChanged?: () => void;
	readonly resourceManager?: DynamicEntityResourceManager;
	readonly store?: DynamicEntityStore;
}

export class DynamicEntityController {
	readonly #resourceManager: DynamicEntityResourceManager | null;
	readonly #store: DynamicEntityStore;
	readonly #onResourcesChanged: () => void;

	constructor(options: DynamicEntityControllerOptions = {}) {
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
			const entityRecord = createDynamicEntityRecord(record, this.#resourceManager);
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
			this.#resourceManager?.releaseEntity(record.id);
		}
	}

	applyResourceChange(change: DynamicEntityResourceChange): void {
		const updated = this.#store.update(change.entityId, (record) =>
			applyResourceChange(record, change),
		);
		if (updated) {
			this.#onResourcesChanged();
		}
	}

	dispose(): void {
		this.#resourceManager?.releaseAll();
	}

	createSnapshot(): DynamicRuntimeSnapshot {
		return this.#store.createSnapshot();
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
	const residenceDiagnostics =
		record.kind === "env-cell-static-object-dynamic-seed"
			? [
					{
						kind: "residence-render-path-pending" as const,
						residence: sourceResidence,
					},
				]
			: [];
	const resourceState =
		resourceManager?.createInitialResourceState(record.seed) ??
		createFallbackInitialResourceState(record.seed);

	return {
		animation: {
			defaultAnimationId: record.seed.defaultAnimationId,
			status: "pending-resource",
		},
		baseTransform: {
			baseLocalPlacement: record.seed.localPlacement,
			sourceScale: record.seed.sourceScale,
		},
		bounds: {
			currentBounds: null,
			indexed: false,
		},
		diagnostics: [
			{
				kind: "resources-pending",
				required: FIRST_SLICE_REQUIRED_RESOURCES,
			},
			...residenceDiagnostics,
		],
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
			reasons:
				record.kind === "env-cell-static-object-dynamic-seed"
					? ["resources-pending", "residence-render-path-pending"]
					: ["resources-pending"],
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
		const diagnostics = [
			createVisualResourcesPendingIssue(),
			...createResidenceDiagnostics(record),
		];
		return {
			...record,
			animation: {
				...record.animation,
				status: "ready",
			},
			diagnostics,
			renderability: {
				reasons: createRenderabilityReasons(diagnostics),
				status: "non-renderable",
			},
			resources: change.resources,
		};
	}

	if (change.kind === "visual-resources-ready") {
		const diagnostics = createResidenceDiagnostics(record);
		return {
			...record,
			diagnostics,
			renderability: {
				reasons: createRenderabilityReasons(diagnostics),
				status: "non-renderable",
			},
			resources: change.resources,
		};
	}

	const diagnostics = [...change.issues, ...createResidenceDiagnostics(record)];
	return {
		...record,
		diagnostics,
		renderability: {
			reasons: createRenderabilityReasons(diagnostics),
			status: "non-renderable",
		},
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

function createResidenceDiagnostics(
	record: DynamicEntityRecord,
): readonly DynamicEntityIssue[] {
	return record.sourceResidence.kind === "env-cell"
		? [
				{
					kind: "residence-render-path-pending",
					residence: record.sourceResidence,
				},
			]
		: [];
}

function createVisualResourcesPendingIssue(): DynamicEntityIssue {
	return {
		kind: "visual-resources-pending",
		required: PHASE_4B_REQUIRED_RESOURCES,
	};
}

function createRenderabilityReasons(
	diagnostics: readonly DynamicEntityIssue[],
): DynamicEntityRecord["renderability"]["reasons"] {
	const reasons = new Set<DynamicEntityRecord["renderability"]["reasons"][number]>();
	for (const diagnostic of diagnostics) {
		if (diagnostic.kind === "resources-pending") {
			reasons.add("resources-pending");
		}
		if (diagnostic.kind === "visual-resources-pending") {
			reasons.add("visual-resources-pending");
		}
		if (diagnostic.kind === "dynamic-resource-load-failed") {
			reasons.add("resources-pending");
		}
		if (diagnostic.kind === "residence-render-path-pending") {
			reasons.add("residence-render-path-pending");
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
