import type {
	OutdoorStaticObjectDynamicSeedFacts,
	StaticAuthoredDynamicSeedRecord,
	StaticScopeOwnerKey,
	StaticWorkPeerRecordOwner,
} from "../static/contracts";

export type DynamicEntityId = string;

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
	readonly sourceSeed: OutdoorStaticObjectDynamicSeedFacts;
}

interface DynamicEntityProvenance {
	readonly kind: "static-authored-outdoor";
	readonly owner: StaticWorkPeerRecordOwner;
	readonly sourceScopeKey: string;
}

interface DynamicEntityResidence {
	readonly kind: "outdoor-landblock";
	readonly landblockId: number;
}

interface DynamicEntityAnimationState {
	readonly defaultAnimationId: number;
	readonly status: "pending-resource";
}

interface DynamicEntityTransformState {
	readonly baseLocalPlacement: OutdoorStaticObjectDynamicSeedFacts["localPlacement"];
	readonly sourceScale: OutdoorStaticObjectDynamicSeedFacts["sourceScale"];
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

type DynamicEntityRenderabilityReason = "resources-pending";

interface DynamicEntityIssue {
	readonly kind: "resources-pending";
	readonly required: readonly DynamicEntityRequiredResource[];
}

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

export function createStaticScopeOwnerKey(
	owner: Pick<StaticScopeOwnerKey, "domain" | "scopeKey">,
): string {
	return `${owner.domain}:${owner.scopeKey}`;
}
