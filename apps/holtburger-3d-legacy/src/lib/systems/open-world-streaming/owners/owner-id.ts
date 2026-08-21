import type { DynamicEntityId } from "../../../dynamic/contracts";

export type MaterializationOwnerId = string & {
	readonly __brand: "MaterializationOwnerId";
};

export type MaterializationOwnerKind =
	"static-layer" | "runtime-entity" | "static-authored-dynamic";

export interface StaticLayerMaterializationOwner {
	readonly id: MaterializationOwnerId;
	readonly kind: "static-layer";
	readonly layerKind: StaticLayerMaterializationOwnerKind;
	readonly landblockId: number;
}

export type StaticLayerMaterializationOwnerKind =
	| "terrain"
	| "outdoor-buildings"
	| "outdoor-explicit-objects"
	| "outdoor-generated-scenery"
	| "env-cell-system";

export interface RuntimeEntityMaterializationOwner {
	readonly dynamicEntityId: DynamicEntityId;
	readonly id: MaterializationOwnerId;
	readonly kind: "runtime-entity";
}

export interface StaticAuthoredDynamicMaterializationOwner {
	readonly childId: string;
	readonly id: MaterializationOwnerId;
	readonly kind: "static-authored-dynamic";
	readonly parentStaticLayerOwnerId: MaterializationOwnerId;
}

export type MaterializationOwner =
	| StaticLayerMaterializationOwner
	| RuntimeEntityMaterializationOwner
	| StaticAuthoredDynamicMaterializationOwner;

export function createStaticLayerMaterializationOwner(input: {
	readonly landblockId: number;
	readonly layerKind: StaticLayerMaterializationOwnerKind;
}): StaticLayerMaterializationOwner {
	const id = createMaterializationOwnerId(
		`static-layer:${input.layerKind}:${formatOwnerLandblockId(input.landblockId)}`,
	);
	return {
		id,
		kind: "static-layer",
		landblockId: input.landblockId,
		layerKind: input.layerKind,
	};
}

export function createRuntimeEntityMaterializationOwner(
	dynamicEntityId: DynamicEntityId,
): RuntimeEntityMaterializationOwner {
	return {
		dynamicEntityId,
		id: createMaterializationOwnerId(`runtime-entity:${dynamicEntityId}`),
		kind: "runtime-entity",
	};
}

export function createStaticAuthoredDynamicMaterializationOwner(input: {
	readonly childId: string;
	readonly parentStaticLayerOwnerId: MaterializationOwnerId;
}): StaticAuthoredDynamicMaterializationOwner {
	return {
		childId: input.childId,
		id: createMaterializationOwnerId(
			`static-authored-dynamic:${input.parentStaticLayerOwnerId}:${input.childId}`,
		),
		kind: "static-authored-dynamic",
		parentStaticLayerOwnerId: input.parentStaticLayerOwnerId,
	};
}

function createMaterializationOwnerId(value: string): MaterializationOwnerId {
	if (value.length === 0) {
		throw new Error("Materialization owner id cannot be empty.");
	}
	return value as MaterializationOwnerId;
}

function formatOwnerLandblockId(landblockId: number): string {
	return `0x${(landblockId >>> 0).toString(16).padStart(8, "0")}`;
}
