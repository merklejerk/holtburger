import type {
	StaticAuthoredDynamicSeedRecord,
	StaticScopeOwnerKey,
	StaticWorkPeerRecordOwner,
} from "../static/contracts";
import {
	createStaticScopeOwnerKey,
	isEnvCellDynamicSeedRecord,
	isOutdoorDynamicSeedRecord,
	type DynamicEntityId,
	type DynamicEntityRecord,
	type StaticAuthoredDynamicSeedFacts,
	type DynamicRuntimeSnapshot,
} from "./contracts";
import { DynamicEntityStore } from "./dynamic-entity-store";

const FIRST_SLICE_REQUIRED_RESOURCES = ["setup-model", "animation"] as const;

export class DynamicEntityController {
	readonly #store: DynamicEntityStore;

	constructor(options: { readonly store?: DynamicEntityStore } = {}) {
		this.#store = options.store ?? new DynamicEntityStore();
	}

	ingestStaticSeeds(records: readonly StaticAuthoredDynamicSeedRecord[]): void {
		for (const record of records) {
			if (
				!isOutdoorDynamicSeedRecord(record) &&
				!isEnvCellDynamicSeedRecord(record)
			) {
				continue;
			}
			this.#store.upsert(createDynamicEntityRecord(record));
		}
	}

	retainStaticScopes(scopes: readonly StaticScopeOwnerKey[]): void {
		this.#store.retainSourceScopeKeys(
			new Set(scopes.map(createStaticScopeOwnerKey)),
		);
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
			required: FIRST_SLICE_REQUIRED_RESOURCES,
			status: "pending",
		},
		sourceResidence,
		sourceSeed: record.seed,
	};
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
