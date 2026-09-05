import type { LandblockOwnerId } from "../game-types";
import {
	createLandblockOffset,
	createLandblockWorldOrigin,
	getLandblockCoordinates,
} from "../landblocks";
import { frustumIntersectsAABB, type Frustum } from "../math/frustum";
import { transformAABB3 } from "../math/matrices";
import { AABB3, Vec3 } from "../math/types";
import type { SceneNodeId } from "../scene";
import type { PreparedDynamicDepth } from "./dynamic-depth-preparation";
import type { RenderWorld } from "./render-world";
import type { EntityShadowCasterShape } from "./entity-grounding";
import {
	isEntityShadowCasterClass,
	type OutdoorShadowCasterBudget,
} from "./entity-shadow-policy";

const OUTDOOR_SCOPE = [{ kind: "outdoor" }] as const;
const DYNAMIC_CULLING_GROUP = "dynamic";
/** RenderWorld operations needed by one independent outdoor caster query. */
export type OutdoorPssmCasterWorld = Pick<
	RenderWorld,
	| "getEntityShadowDynamicFacts"
	| "getRenderContributionDescriptor"
	| "queryScopesScene"
> & {
	/** Frame-cached material-free geometry; querying does not upload poses or draw. */
	getDynamicDepth(
		nodeId: SceneNodeId,
		showRetailHiddenGeometry: boolean,
	): PreparedDynamicDepth | null;
};

/** Whole-root depth geometry shared across the cascades that selected it. */
export interface OutdoorPssmCasterBatch {
	/** Frame-owned references; emptying the array retires all selected appearance/pose references. */
	readonly casters: PreparedDynamicDepth[];
}

/** Geometry-free rigid shape assigned to the outdoor analytic fallback tier. */
interface OutdoorShadowCasterCandidate extends EntityShadowCasterShape {
	identity: string;
	nodeId: SceneNodeId;
	contactAnchor: Vec3;
	radius: number;
	height: number;
	readonly bounds: AABB3;
	cameraVisible: boolean;
	cascadeMask: number;
	distanceSquared: number;
}

/** Reusable frame scratch for consuming reused cascade-query storage into owned membership. */
interface OutdoorPssmCasterSelectionScratch {
	/** Bit `n` means the root was selected by cascade array index `n`. */
	readonly rootCascadeMasks: Map<SceneNodeId, number>;
	/** Reused complete-root facts ranked once before either tier consumes them. */
	readonly candidates: OutdoorShadowCasterCandidate[];
}

/** Structural work and retained output produced by one all-cascade selection. */
interface OutdoorPssmCasterCollectionMetrics {
	/** Cascade-frustum queries issued by the collector. */
	readonly cascadeQueryCount: number;
	/** Candidate memberships summed across cascades, including overlap. */
	readonly cascadeCandidateMembershipCount: number;
	/** Unique eligible complete roots before budget selection. */
	readonly candidateRootCount: number;
	/** Ordinary merged spans selected across every cascade. */
	readonly selectedDepthDrawCount: number;
	/** Selected roots assigned to mapped PSSM work. */
	readonly mappedRootCount: number;
	/** Selected roots assigned to analytic fallback. */
	readonly analyticRootCount: number;
	/** Candidate roots rejected by N. */
	readonly rejectedRootCount: number;
	/** Roots retained across both tiers. */
	readonly selectedRootCount: number;
	/** Views whose mapped tier produced no depth parts. */
	readonly emptyMappedViewCount: number;
	/** Distinct visible parts per root, summed across its intersected cascades. */
	readonly selectedPartCascadeCount: number;
}

/** Optional caller-owned profiling sink; absent frames perform no collection accounting. */
type OutdoorPssmCasterCollectionMetricsSink = {
	-readonly [Key in keyof OutdoorPssmCasterCollectionMetrics]: number;
};

/** Allocate one cascade's reusable selected-root list. */
export function createOutdoorPssmCasterBatch(): OutdoorPssmCasterBatch {
	return { casters: [] };
}

/** Allocate reusable membership scratch owned beside the cascade batches that consume it. */
export function createOutdoorPssmCasterSelectionScratch(): OutdoorPssmCasterSelectionScratch {
	return {
		candidates: [],
		rootCascadeMasks: new Map(),
	};
}

/**
 * Consume one light-frustum query before SceneGraph reuses its entry storage.
 *
 * Presentation-class and outdoor-domain checks happen before depth preparation where possible. A root enters the
 * shared animation-liveness set only after at least one draw-visible outdoor part survives.
 */
export function planOutdoorShadowCastersForView(
	world: OutdoorPssmCasterWorld,
	cascadeFrusta: readonly Frustum[],
	cameraFrustum: Frustum,
	anchorLandblockId: LandblockOwnerId,
	budget: OutdoorShadowCasterBudget,
	selectedDynamicNodeIds: Set<SceneNodeId>,
	analyticCasters: EntityShadowCasterShape[],
	showRetailHiddenGeometry: boolean,
	batches: readonly OutdoorPssmCasterBatch[],
	scratch: OutdoorPssmCasterSelectionScratch,
	metrics: OutdoorPssmCasterCollectionMetricsSink | null,
): void {
	if (cascadeFrusta.length !== batches.length) {
		throw new Error(
			`Outdoor PSSM received ${cascadeFrusta.length} frusta for ${batches.length} batches.`,
		);
	}
	if (cascadeFrusta.length > 31) {
		throw new Error(
			"Outdoor PSSM supports at most 31 cascade-membership bits.",
		);
	}
	for (const batch of batches) {
		batch.casters.length = 0;
	}
	analyticCasters.length = 0;
	const rootCascadeMasks = scratch.rootCascadeMasks;
	rootCascadeMasks.clear();
	if (metrics !== null) metrics.cascadeQueryCount += cascadeFrusta.length;
	for (
		let cascadeIndex = 0;
		cascadeIndex < cascadeFrusta.length;
		cascadeIndex += 1
	) {
		const frustum = cascadeFrusta[cascadeIndex];
		if (frustum === undefined) {
			throw new Error(`Outdoor PSSM cascade ${cascadeIndex} has no frustum.`);
		}
		const visible = world.queryScopesScene(
			frustum,
			anchorLandblockId,
			OUTDOOR_SCOPE,
			isDynamicCullingGroup,
		);
		const cascadeBit = 1 << cascadeIndex;
		// SceneGraph reuses `entries`, so consume every root before issuing the next query.
		for (const nodeId of visible.entries) {
			rootCascadeMasks.set(
				nodeId,
				(rootCascadeMasks.get(nodeId) ?? 0) | cascadeBit,
			);
		}
	}
	const candidates = scratch.candidates;
	const anchorOrigin = createLandblockWorldOrigin(anchorLandblockId);
	let candidateCount = 0;
	for (const [nodeId, cascadeMask] of rootCascadeMasks) {
		const descriptor = world.getRenderContributionDescriptor(nodeId);
		if (
			descriptor?.kind !== "dynamic" ||
			!isEntityShadowCasterClass(descriptor.entityClass)
		) {
			continue;
		}
		const facts = world.getEntityShadowDynamicFacts(nodeId);
		if (!facts.spatialMembership.scopes.some(isOutdoorScope)) continue;
		const placement = descriptor.footprint.placement;
		let candidate = candidates[candidateCount];
		if (candidate === undefined) {
			candidate = {
				bounds: AABB3.zero(),
				cameraVisible: false,
				cascadeMask: 0,
				contactAnchor: Vec3.zero(),
				distanceSquared: 0,
				height: 0,
				identity: facts.identity,
				nodeId,
				radius: 0,
			};
			candidates.push(candidate);
		}
		transformAABB3(
			placement.localToLandblock,
			facts.rigidBounds,
			candidate.bounds,
		);
		const landblockOffset = createLandblockOffset(
			getLandblockCoordinates(placement.landblockId),
			getLandblockCoordinates(anchorLandblockId),
		);
		candidate.bounds.min.x += landblockOffset.x;
		candidate.bounds.max.x += landblockOffset.x;
		candidate.bounds.min.z += landblockOffset.z;
		candidate.bounds.max.z += landblockOffset.z;
		const radius =
			Math.max(
				candidate.bounds.max.x - candidate.bounds.min.x,
				candidate.bounds.max.z - candidate.bounds.min.z,
			) * 0.5;
		const height = candidate.bounds.max.y - candidate.bounds.min.y;
		if (
			!Number.isFinite(radius) ||
			radius <= 0 ||
			!Number.isFinite(height) ||
			height <= 0
		)
			continue;
		candidate.identity = facts.identity;
		candidate.nodeId = nodeId;
		candidate.cascadeMask = cascadeMask;
		candidate.radius = radius;
		candidate.height = height;
		candidate.contactAnchor.x =
			(candidate.bounds.min.x + candidate.bounds.max.x) * 0.5 + anchorOrigin.x;
		candidate.contactAnchor.y = placement.localToLandblock.m42 + anchorOrigin.y;
		candidate.contactAnchor.z =
			(candidate.bounds.min.z + candidate.bounds.max.z) * 0.5 + anchorOrigin.z;
		candidate.cameraVisible = frustumIntersectsAABB(
			cameraFrustum,
			candidate.bounds,
			0,
			0,
			0,
		);
		candidate.distanceSquared = distanceSquaredToBounds(
			cameraFrustum.cameraPosition,
			candidate.bounds,
		);
		candidateCount += 1;
		if (metrics !== null) {
			metrics.candidateRootCount += 1;
			metrics.cascadeCandidateMembershipCount += countSetBits(cascadeMask);
		}
	}
	candidates.length = candidateCount;
	if (candidateCount > budget.maximumMappedRoots) {
		candidates.sort(compareOutdoorShadowCandidates);
	}
	const selectedCount = Math.min(candidateCount, budget.maximumSelectedRoots);
	const mappedCount = Math.min(selectedCount, budget.maximumMappedRoots);
	if (metrics !== null) {
		metrics.selectedRootCount += selectedCount;
		metrics.rejectedRootCount += candidateCount - selectedCount;
		metrics.mappedRootCount += mappedCount;
		metrics.analyticRootCount += selectedCount - mappedCount;
	}
	for (const [index, candidate] of candidates.entries()) {
		if (index >= selectedCount) break;
		if (index < mappedCount) continue;
		analyticCasters.push(candidate);
		selectedDynamicNodeIds.add(candidate.nodeId);
	}
	for (let mappedIndex = 0; mappedIndex < mappedCount; mappedIndex += 1) {
		const candidate = candidates[mappedIndex];
		if (candidate === undefined)
			throw new Error("Mapped shadow candidate is missing.");
		const { cascadeMask, nodeId } = candidate;
		const depth = world.getDynamicDepth(nodeId, showRetailHiddenGeometry);
		if (depth === null || !depth.renderScopes.some(isOutdoorScope)) continue;
		for (
			let cascadeIndex = 0;
			cascadeIndex < batches.length;
			cascadeIndex += 1
		) {
			if ((cascadeMask & (1 << cascadeIndex)) === 0) continue;
			const batch = batches[cascadeIndex];
			if (batch === undefined)
				throw new Error(`Outdoor PSSM cascade ${cascadeIndex} has no batch.`);
			batch.casters.push(depth);
			if (metrics !== null) {
				metrics.selectedPartCascadeCount += depth.selectedPartCount;
				metrics.selectedDepthDrawCount += depth.ranges.length;
			}
		}
		selectedDynamicNodeIds.add(nodeId);
	}
}

function compareOutdoorShadowCandidates(
	left: OutdoorShadowCasterCandidate,
	right: OutdoorShadowCasterCandidate,
): number {
	if (left.cameraVisible !== right.cameraVisible)
		return left.cameraVisible ? -1 : 1;
	return (
		left.distanceSquared - right.distanceSquared ||
		left.identity.localeCompare(right.identity)
	);
}

function distanceSquaredToBounds(point: Vec3, bounds: AABB3): number {
	const x = Math.max(bounds.min.x - point.x, 0, point.x - bounds.max.x);
	const y = Math.max(bounds.min.y - point.y, 0, point.y - bounds.max.y);
	const z = Math.max(bounds.min.z - point.z, 0, point.z - bounds.max.z);
	return x * x + y * y + z * z;
}

function isDynamicCullingGroup(cullingGroup: string): boolean {
	return cullingGroup === DYNAMIC_CULLING_GROUP;
}

function isOutdoorScope(scope: { readonly kind: string }): boolean {
	return scope.kind === "outdoor";
}

function countSetBits(value: number): number {
	let remaining = value >>> 0;
	let count = 0;
	while (remaining !== 0) {
		remaining &= remaining - 1;
		count += 1;
	}
	return count;
}
