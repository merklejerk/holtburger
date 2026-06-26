import type {
	EnvCellStaticObjectDynamicSeedFacts,
	OutdoorStaticObjectDynamicSeedFacts,
	StaticAuthoredDynamicSeedRecord,
	StaticScopeOwnerKey,
	StaticWorkPeerRecordOwner,
} from "../static/contracts";

export type DynamicEntityId = string;

/** Static-authored seed fact shapes that can become dynamic runtime records. */
export type StaticAuthoredDynamicSeedFacts =
	| EnvCellStaticObjectDynamicSeedFacts
	| OutdoorStaticObjectDynamicSeedFacts;

export interface DynamicEntityRecord {
	readonly animation: DynamicEntityAnimationState;
	readonly baseTransform: DynamicEntityTransformState;
	readonly bounds: DynamicEntityBoundsState;
	readonly diagnostics: readonly DynamicEntityIssue[];
	readonly effectiveResidence: DynamicEntityResidence;
	readonly id: DynamicEntityId;
	readonly provenance: DynamicEntityProvenance;
	readonly renderability: DynamicEntityRenderability;
	readonly resources: DynamicEntityResourceState;
	readonly sourceResidence: DynamicEntityResidence;
	readonly sourceSeed: StaticAuthoredDynamicSeedFacts;
}

interface DynamicEntityProvenance {
	readonly kind: "static-authored-env-cell" | "static-authored-outdoor";
	readonly owner: StaticWorkPeerRecordOwner;
	readonly sourceScopeKey: string;
}

type DynamicEntityResidence =
	| {
			readonly kind: "env-cell";
			readonly envCellId: number;
			readonly landblockId: number;
	  }
	| {
			readonly kind: "outdoor-landblock";
			readonly landblockId: number;
	  };

interface DynamicEntityAnimationState {
	readonly defaultAnimationId: number;
	readonly status: "pending-resource";
}

interface DynamicEntityTransformState {
	readonly baseLocalPlacement: StaticAuthoredDynamicSeedFacts["localPlacement"];
	readonly sourceScale: StaticAuthoredDynamicSeedFacts["sourceScale"];
}

interface DynamicEntityBoundsState {
	readonly currentBounds: null;
	readonly indexed: false;
}

interface DynamicEntityResourceState {
	readonly required: readonly DynamicEntityRequiredResource[];
	readonly status: "pending";
}

type DynamicEntityRequiredResource = "animation" | "setup-model";

interface DynamicEntityRenderability {
	readonly reasons: readonly DynamicEntityRenderabilityReason[];
	readonly status: "non-renderable";
}

type DynamicEntityRenderabilityReason =
	| "residence-render-path-pending"
	| "resources-pending";

type DynamicEntityIssue =
	| {
			readonly kind: "residence-render-path-pending";
			readonly residence: DynamicEntityResidence;
	  }
	| {
			readonly kind: "resources-pending";
			readonly required: readonly DynamicEntityRequiredResource[];
	  };

export interface DynamicRuntimeSnapshot {
	readonly activeEntityCount: number;
	readonly issueCount: number;
	readonly nonRenderableEntityCount: number;
	readonly records: readonly DynamicEntityRecord[];
	readonly staticSeedCount: number;
}

export function isOutdoorDynamicSeedRecord(
	record: StaticAuthoredDynamicSeedRecord,
): record is Extract<
	StaticAuthoredDynamicSeedRecord,
	{ readonly kind: "outdoor-static-object-dynamic-seed" }
> {
	return record.kind === "outdoor-static-object-dynamic-seed";
}

export function isEnvCellDynamicSeedRecord(
	record: StaticAuthoredDynamicSeedRecord,
): record is Extract<
	StaticAuthoredDynamicSeedRecord,
	{ readonly kind: "env-cell-static-object-dynamic-seed" }
> {
	return record.kind === "env-cell-static-object-dynamic-seed";
}

export function createStaticScopeOwnerKey(
	owner: Pick<StaticScopeOwnerKey, "domain" | "scopeKey">,
): string {
	return `${owner.domain}:${owner.scopeKey}`;
}
