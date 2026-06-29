import type {
	LayerOwnerKey,
	LayerOwnerState,
	ScheduledStaticWork,
	StaticDomain,
	StaticLayerPeerRecordOwner,
	StaticScopeOwnerKey,
} from "./contracts";

export interface LayerOwnerReconciliation {
	readonly added: readonly LayerOwnerKey[];
	readonly evicted: readonly LayerOwnerKey[];
	readonly retained: readonly LayerOwnerKey[];
	readonly unchanged: readonly LayerOwnerKey[];
}

export function createLayerOwnerKeyForStaticScope(
	scope: StaticScopeOwnerKey,
): LayerOwnerKey {
	if (scope.scope.kind !== "landblock") {
		throw new Error(
			`Layer owner keys require landblock static scopes. Received ${scope.scope.kind}.`,
		);
	}
	return {
		kind: layerOwnerKindForStaticDomain(scope.domain),
		landblockId: scope.scope.landblockId,
	};
}

export function layerOwnerKindForStaticDomain(
	domain: StaticDomain,
): LayerOwnerKey["kind"] {
	switch (domain) {
		case "outdoor-terrain":
			return "terrain";
		case "outdoor-buildings":
			return "outdoor-buildings";
		case "outdoor-explicit-objects":
			return "outdoor-explicit-objects";
		case "outdoor-generated-scenery":
			return "outdoor-generated-scenery";
		case "landblock-env-cells":
			return "env-cell-system";
		case "outdoor-detail":
			return "outdoor-generated-scenery";
	}
}

export function createLayerOwnerKeyId(key: LayerOwnerKey): string {
	return `${key.kind}:${formatLayerOwnerLandblockId(key.landblockId)}`;
}

export function createLayerPeerRecordOwnerForStaticWork(
	work: ScheduledStaticWork,
): StaticLayerPeerRecordOwner {
	const key = createLayerOwnerKeyForStaticScope({
		domain: work.job.domain,
		scope: work.job.scope,
		scopeKey: describeStaticScopeKey(work.job.scope),
	});
	return {
		domain: work.job.domain,
		key,
		kind: "layer-owner",
		ownerId: createLayerOwnerKeyId(key),
	};
}

export function reconcileLayerOwners(
	previous: readonly LayerOwnerState[],
	desired: readonly LayerOwnerKey[],
): LayerOwnerReconciliation {
	const previousById = new Map(
		previous.map((state) => [createLayerOwnerKeyId(state.key), state] as const),
	);
	const desiredById = new Map(
		desired.map((key) => [createLayerOwnerKeyId(key), key] as const),
	);

	const added: LayerOwnerKey[] = [];
	const retained: LayerOwnerKey[] = [];
	const unchanged: LayerOwnerKey[] = [];
	for (const [id, key] of desiredById) {
		const existing = previousById.get(id);
		if (existing) {
			retained.push(key);
			unchanged.push(existing.key);
		} else {
			added.push(key);
		}
	}

	const evicted = previous
		.filter((state) => !desiredById.has(createLayerOwnerKeyId(state.key)))
		.map((state) => state.key);

	return {
		added: sortLayerOwnerKeys(added),
		evicted: sortLayerOwnerKeys(evicted),
		retained: sortLayerOwnerKeys(retained),
		unchanged: sortLayerOwnerKeys(unchanged),
	};
}

function sortLayerOwnerKeys(keys: readonly LayerOwnerKey[]): readonly LayerOwnerKey[] {
	return [...keys].sort((left, right) =>
		createLayerOwnerKeyId(left).localeCompare(createLayerOwnerKeyId(right)),
	);
}

function formatLayerOwnerLandblockId(landblockId: number): string {
	return `0x${(landblockId >>> 0).toString(16).padStart(8, "0")}`;
}

function describeStaticScopeKey(scope: ScheduledStaticWork["job"]["scope"]): string {
	return `landblock:${(scope.landblockId >>> 0).toString(16).padStart(8, "0")}`;
}
