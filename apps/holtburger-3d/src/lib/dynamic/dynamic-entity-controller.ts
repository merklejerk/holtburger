import type {
	OutdoorStaticObjectDynamicSeedFacts,
	StaticAuthoredDynamicSeedRecord,
	StaticScopeOwnerKey,
	StaticWorkPeerRecordOwner,
} from "../static/contracts";
import {
	createStaticScopeOwnerKey,
	isOutdoorDynamicSeedRecord,
	type DynamicEntityId,
	type DynamicEntityRecord,
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
			if (!isOutdoorDynamicSeedRecord(record)) {
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
		{ readonly kind: "outdoor-static-object-dynamic-seed" }
	>,
): DynamicEntityRecord {
	const sourceScopeKey = createSourceScopeKey(record.owner);
	const sourceResidence = {
		kind: "outdoor-landblock" as const,
		landblockId: record.seed.sourceResidence.landblockId,
	};

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
		],
		effectiveResidence: sourceResidence,
		id: createDynamicEntityId(record.seed, sourceScopeKey),
		provenance: {
			kind: "static-authored-outdoor",
			owner: record.owner,
			sourceScopeKey,
		},
		renderability: {
			reasons: ["resources-pending"],
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
	seed: OutdoorStaticObjectDynamicSeedFacts,
	sourceScopeKey: string,
): DynamicEntityId {
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
