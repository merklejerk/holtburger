import { selectionBoxDistanceSquared } from "../../lib/game/selection/entity-selection-volume";
import type {
	EntitySelectionBounds,
	RealizedEntitySelectionSource,
} from "../../lib/game/selection/entity-selection-bounds";
import type { FrustumPlane } from "../../lib/game/math/frustum";
import { createLandblockWorldOrigin } from "../../lib/game/landblocks";
import { scaleVec3, dotVec3 } from "../../lib/game/math/vector-utils";
import type { SceneVec3 } from "../../lib/assets/ac-frame";
import {
	createEntityFacingCameraYaw,
	rotateRenderVector,
} from "../../lib/game/math/camera-orientation";
import { Vec3 } from "../../lib/game/math/types";
import type {
	DynamicEntityMirror,
	DynamicEntityWorldPlacement,
} from "../../lib/game/runtime/dynamic-entity-feed";
import { dynamicEntityWorldOrigin } from "../../lib/game/runtime/dynamic-entity-presentation";
import type { PrimaryCameraView } from "../../lib/game/runtime/types";
import type { ClientInputConfiguration } from "../../lib/input/input-contract";
import type { ClientCombatMode } from "../session/host-contract";
import type {
	ClientEntityFacts,
	ClientEntityMirror,
} from "../world/entity-mirror";

/** One synchronous acquisition view; no geometry is retained after candidate sampling. */
export interface CycleSelectionPresentationFrame extends RealizedEntitySelectionSource {
	/** Primary camera is optional when a binding does not require view admission. */
	readonly view: PrimaryCameraView | null;
}

/** Binding-specific eligibility over one shared traversal cursor; memberships may overlap. */
export type CycleFilter = "smart-combat" | "non-creature" | "corpse";
/**
 * Filter admission tier:
 * - `"cycle"`: ordinary traversal and immediate acquisition
 * - `"immediate-only"`: eligible only as the immediate acquisition winner
 * - `"immediate-fallback"`: eligible only as the immediate acquisition winner, ranked below primary immediate candidates
 * - `"fallback"`: admitted into traversal and immediate acquisition when no primary candidates exist
 */
type CycleMembership =
	"cycle" | "immediate-only" | "immediate-fallback" | "fallback";
/** Cold gameplay facts sampled with each acquisition, independent of panel visibility. */
export interface CycleSelectionContext {
	/** Confirmed stance; unknown uses unrestricted player admission until confirmation. */
	readonly combatMode: ClientCombatMode;
	/** Accepted fellowship roster, including members without rendered bodies. */
	readonly partyMembers: ReadonlySet<number>;
}
/** App-local acquisition knobs, sampled only on input. */
export interface CycleSelectionPolicy {
	/** Player-to-volume acquisition radius in meters for every filter. */
	readonly radiusMeters: number;
	/** Width of the innermost radial band; each subsequent band doubles in width. */
	readonly initialDistanceBandMeters: number;
	/** Maximum horizontal angle from player facing for Smart Tab acquisition, in degrees. */
	readonly immediateMaxAngleDegrees: number;
	/** Extra horizontal/vertical half-width in meters; no behind-camera admission. */
	readonly viewMarginMeters: number;
	/** Distance behind the player origin allowed by the forward half-space view restriction. */
	readonly forwardHalfSpaceRearOffsetMeters: number;
}
/** Eligible identity and distance computed once by the candidate sampler. */
export interface CycleCandidate {
	/** Stable identity used for membership and final selection. */
	readonly guid: number;
	/** Squared player-to-volume distance; ordinary acquisition and traversal distance tie. */
	readonly distanceSquared: number;
	/** Player-relative radial band, computed by the candidate sampler. */
	readonly distanceBand: number;
	/** Cosine of the 3D root-origin angle to horizontal player forward; larger ranks first. */
	readonly forwardAlignment: number;
	/** Nearest distance inside the facing cone, applicable view region, and strict innermost band. */
	readonly smartImmediate: { readonly distanceSquared: number } | null;
	/** Sampler-owned admission per filter; absence means ineligible for that filter. */
	readonly filters: Readonly<Partial<Record<CycleFilter, CycleMembership>>>;
}

/** Acquire only installed selectable geometry; semantic eligibility remains session-owned. */
export function sampleCycleCandidates(
	entities: ClientEntityMirror,
	motion: DynamicEntityMirror,
	presentation: CycleSelectionPresentationFrame,
	policy: CycleSelectionPolicy,
	preferences: Pick<
		ClientInputConfiguration,
		"targetOnlyInView" | "smartTabHostileOnly"
	>,
	context: CycleSelectionContext,
): readonly CycleCandidate[] | null {
	const read = entities.read();
	if (
		read.kind === "pending" ||
		motion.isAwaitingSnapshot() ||
		read.level.playerGuid === null
	)
		return null;
	let playerPlacement: DynamicEntityWorldPlacement | null = null;
	for (const entity of motion.currentEntities()) {
		if (
			entity.identity.guid === read.level.playerGuid &&
			entity.placement.kind === "world"
		) {
			playerPlacement = entity.placement;
			break;
		}
	}
	if (playerPlacement === null) return null;
	const player = dynamicEntityWorldOrigin(playerPlacement);
	const yaw = createEntityFacingCameraYaw(playerPlacement.pose.rotation);
	const forward = new Vec3(Math.sin(yaw), 0, -Math.cos(yaw));
	const cone = immediateConePlanes(
		player,
		forward,
		policy.immediateMaxAngleDegrees,
	);
	const view = targetViewPlanes(presentation.view, player, forward, policy);
	const immediatePlanes = preferences.targetOnlyInView
		? [...cone, ...view]
		: cone;
	const candidates: CycleCandidate[] = [];
	presentation.visitRealizedEntitySelectionBounds((entity, bounds) => {
		const guid = entity.identity.guid;
		if (guid === read.level.playerGuid) return;
		const facts = read.level.entities.get(guid);
		if (facts === undefined || facts.targeting === "ineligible") return;
		const memberships = cycleMemberships(facts, context, preferences);
		if (Object.keys(memberships).length === 0) return;
		const geometry = sampleVolumeGeometry(
			bounds,
			player,
			forward,
			preferences.targetOnlyInView &&
				presentation.view !== null &&
				memberships["smart-combat"] !== undefined
				? view
				: null,
			memberships["smart-combat"] !== undefined &&
				(!preferences.targetOnlyInView || presentation.view !== null)
				? immediatePlanes
				: null,
			policy,
		);
		if (geometry === null) return;
		// View restriction applies only to Smart Tab; object/corpse bindings retain admission.
		const { "smart-combat": smart, ...unrestricted } = memberships;
		const filters =
			smart !== undefined && preferences.targetOnlyInView && !geometry.inView
				? unrestricted
				: memberships;
		if (Object.keys(filters).length === 0) return;
		candidates.push({ guid, ...geometry.candidate, filters });
	});
	return candidates;
}

/** One volume decision set, computed while the runtime's posed matrices are borrowed. */
function sampleVolumeGeometry(
	bounds: EntitySelectionBounds,
	player: SceneVec3,
	forward: Vec3,
	view: readonly FrustumPlane[] | null,
	immediatePlanes: readonly FrustumPlane[] | null,
	policy: CycleSelectionPolicy,
): {
	readonly candidate: Omit<CycleCandidate, "guid" | "filters">;
	readonly inView: boolean;
} | null {
	const origin = createLandblockWorldOrigin(bounds.landblockId);
	const localPlayer = new Vec3(
		player.x - origin.x,
		player.y,
		player.z - origin.z,
	);
	const localPlanes = (planes: readonly FrustumPlane[]) =>
		planes.map((plane) => ({
			...plane,
			constant: plane.constant + plane.x * origin.x + plane.z * origin.z,
		}));
	const localView = view === null ? null : localPlanes(view);
	const localImmediate =
		immediatePlanes === null ? null : localPlanes(immediatePlanes);
	let distanceSquared = Infinity;
	let immediateDistanceSquared = Infinity;
	let inView = false;
	for (const part of bounds.parts) {
		const ordinary = selectionBoxDistanceSquared(
			part.localBounds,
			part.sourceToLandblock,
			localPlayer,
			[],
		);
		if (ordinary === null) continue;
		distanceSquared = Math.min(distanceSquared, ordinary);
		if (localView !== null && !inView)
			inView =
				selectionBoxDistanceSquared(
					part.localBounds,
					part.sourceToLandblock,
					localPlayer,
					localView,
				) !== null;
		if (
			localImmediate !== null &&
			ordinary < policy.initialDistanceBandMeters ** 2
		) {
			const immediate = selectionBoxDistanceSquared(
				part.localBounds,
				part.sourceToLandblock,
				localPlayer,
				localImmediate,
			);
			if (immediate !== null)
				immediateDistanceSquared = Math.min(
					immediateDistanceSquared,
					immediate,
				);
		}
	}
	if (distanceSquared > policy.radiusMeters ** 2) return null;
	const root = new Vec3(
		bounds.sourceToLandblock.m41 - localPlayer.x,
		bounds.sourceToLandblock.m42 - localPlayer.y,
		bounds.sourceToLandblock.m43 - localPlayer.z,
	);
	const rootDistance = Math.hypot(root.x, root.y, root.z);
	return {
		inView,
		candidate: {
			distanceSquared,
			// Boundaries are w, 3w, 7w, ...; a boundary belongs to the outer band.
			distanceBand: Math.floor(
				Math.log2(
					1 + Math.sqrt(distanceSquared) / policy.initialDistanceBandMeters,
				),
			),
			forwardAlignment:
				rootDistance === 0 ? 0 : dotVec3(root, forward) / rootDistance,
			smartImmediate:
				immediateDistanceSquared < policy.initialDistanceBandMeters ** 2
					? { distanceSquared: immediateDistanceSquared }
					: null,
		},
	};
}

/** Inward plane through one anchor, with the margin expressed in the normal's axis units. */
function planeAt(normal: Vec3, anchor: Vec3, margin: number): FrustumPlane {
	return {
		x: normal.x,
		y: normal.y,
		z: normal.z,
		constant: margin - dotVec3(normal, anchor),
	};
}

/** Convex horizontal wedge; exact endpoints avoid near-zero trigonometric residuals. */
function immediateConePlanes(
	player: SceneVec3,
	forward: Vec3,
	degrees: number,
): readonly FrustumPlane[] {
	if (!Number.isFinite(degrees) || degrees < 0 || degrees > 90)
		throw new Error(
			"Immediate targeting half-angle must be between zero and 90 degrees.",
		);
	const sine = degrees === 0 ? 0 : Math.sin((degrees * Math.PI) / 180);
	const cosine = degrees === 90 ? 0 : Math.cos((degrees * Math.PI) / 180);
	const right = new Vec3(-forward.z, 0, forward.x);
	return [
		planeAt(forward, player, 0),
		...[1, -1].map((sign) =>
			planeAt(
				scaleVec3(forward, sine).add(scaleVec3(right, sign * cosine)),
				player,
				0,
			),
		),
	];
}

/** Padded primary camera region, deliberately independent of renderer near/far/portal clipping. */
function targetViewPlanes(
	view: PrimaryCameraView | null,
	player: SceneVec3,
	forward: Vec3,
	policy: CycleSelectionPolicy,
): readonly FrustumPlane[] {
	if (view === null) return [];
	const camera = view.camera;
	const axes = {
		forward: rotateRenderVector(new Vec3(0, 0, -1), camera.placement.rotation),
		right: rotateRenderVector(new Vec3(1, 0, 0), camera.placement.rotation),
		up: rotateRenderVector(new Vec3(0, 1, 0), camera.placement.rotation),
	};
	const verticalTangent = Math.tan((camera.fov * Math.PI) / 360);
	const horizontalTangent =
		(verticalTangent * view.extent.width) / view.extent.height;
	return [
		planeAt(axes.forward, camera.placement.position, 0),
		planeAt(forward, player, policy.forwardHalfSpaceRearOffsetMeters),
		...[
			{ axis: axes.right, tangent: horizontalTangent },
			{ axis: axes.up, tangent: verticalTangent },
		].flatMap(({ axis, tangent }) =>
			[1, -1].map((sign) =>
				planeAt(
					scaleVec3(axes.forward, tangent).add(scaleVec3(axis, sign)),
					camera.placement.position,
					policy.viewMarginMeters,
				),
			),
		),
	];
}

/** Session semantics choose memberships before any expensive geometry queries. */
function cycleMemberships(
	facts: ClientEntityFacts,
	context: CycleSelectionContext,
	preferences: Pick<ClientInputConfiguration, "smartTabHostileOnly">,
): CycleCandidate["filters"] {
	if (facts.summon !== null) return { "smart-combat": "immediate-only" };
	if (facts.targeting === "creature") {
		return !preferences.smartTabHostileOnly || facts.isHostile
			? { "smart-combat": smartCombatMembership(facts, context) }
			: {};
	}
	const filters: Partial<Record<CycleFilter, CycleMembership>> = {
		"non-creature": "cycle",
	};
	if (facts.corpse === "unopened") filters.corpse = "cycle";
	else if (facts.corpse === "opened") filters.corpse = "fallback";
	if (!preferences.smartTabHostileOnly && facts.targeting !== "projectile") {
		if (facts.corpse !== null) {
			filters["smart-combat"] = "immediate-fallback";
		} else {
			const traversable =
				facts.description.kind === "known" &&
				facts.description.mapCategory !== "door" &&
				facts.description.mapCategory !== "door-no-direct-use" &&
				["direct", "targeted", "salvage-tool"].includes(
					facts.description.useCapability,
				);
			filters["smart-combat"] = traversable ? "cycle" : "immediate-only";
		}
	}
	return filters;
}

/** Only player identities are stance-restricted; NPCs and monsters remain ordinary targets. */
function smartCombatMembership(
	facts: ClientEntityFacts,
	context: CycleSelectionContext,
): CycleMembership {
	if (
		facts.description.kind !== "known" ||
		facts.description.mapCategory !== "player" ||
		facts.isHostile ||
		context.combatMode === "peace" ||
		context.combatMode === "unknown" ||
		(context.combatMode === "magic" && context.partyMembers.has(facts.guid))
	)
		return "cycle";
	return "immediate-only";
}

/** Broad traversal favors nearby bands, then facing alignment within each band. */
function preferredFirst(left: CycleCandidate, right: CycleCandidate): number {
	return (
		left.distanceBand - right.distanceBand ||
		right.forwardAlignment - left.forwardAlignment ||
		left.distanceSquared - right.distanceSquared ||
		left.guid - right.guid
	);
}

/** Whether one filter admits a candidate's membership tier given the pool's primary presence. */
function admits(
	membership: CycleMembership | undefined,
	hasPrimary: boolean,
): membership is CycleMembership {
	return membership !== undefined && !(hasPrimary && membership === "fallback");
}

/** Fallback members join a filter's pool only when no primary member exists. */
function hasPrimaryMember(
	candidates: readonly CycleCandidate[],
	filter: CycleFilter,
): boolean {
	return candidates.some((candidate) => {
		const membership = candidate.filters[filter];
		return membership === "cycle" || membership === "immediate-only";
	});
}

/**
 * Resolve one filter's immediate acquisition winner without ordering the traversal ring.
 *
 * Acquisition uses the sampler-owned volume distance so a farther, better-aligned object cannot
 * beat a nearby door. Object/corpse searches admit every direction, including coincident volumes;
 * Smart Tab admits only its cone-and-innermost-band distance. Shared by input acquisition and the
 * passive Smart Nameplates preview, which must never disagree about the winner.
 */
export function resolveImmediateCandidate(
	candidates: readonly CycleCandidate[],
	filter: CycleFilter,
): CycleCandidate | undefined {
	const hasPrimary = hasPrimaryMember(candidates, filter);
	let winner: CycleCandidate | undefined;
	let winnerPriority = Infinity;
	let winnerDistanceSquared = Infinity;
	for (const candidate of candidates) {
		const membership = candidate.filters[filter];
		if (!admits(membership, hasPrimary)) continue;
		const distanceSquared =
			filter === "smart-combat"
				? candidate.smartImmediate?.distanceSquared
				: candidate.distanceSquared;
		if (distanceSquared === undefined) continue;
		const priority = membership === "immediate-fallback" ? 1 : 0;
		if (
			winner === undefined ||
			(priority - winnerPriority ||
				distanceSquared - winnerDistanceSquared ||
				preferredFirst(candidate, winner)) < 0
		) {
			winner = candidate;
			winnerPriority = priority;
			winnerDistanceSquared = distanceSquared;
		}
	}
	return winner;
}

/** One filter's immediate winner and complete ranked traversal ring. */
export interface RankedCycleCandidates {
	/** Nearest candidate; Smart Tab requires the cone and innermost distance band. */
	readonly immediate: CycleCandidate | undefined;
	/** Immediate winner first, followed by the remaining traversable candidates in ranked order. */
	readonly matching: readonly CycleCandidate[];
}

/** Rank one filter's admitted pool for traversal, promoting the immediate winner to the front. */
export function rankCycleCandidates(
	candidates: readonly CycleCandidate[],
	filter: CycleFilter,
): RankedCycleCandidates {
	const hasPrimary = hasPrimaryMember(candidates, filter);
	const immediate = resolveImmediateCandidate(candidates, filter);
	// Only the winning immediate-only/immediate-fallback entity stays in the ring; all others are
	// skipped. Promote the winner rather than rotating the ring: otherwise higher-ranked targets
	// preceding it would be deferred until traversal wraps around.
	const matching = candidates
		.filter((candidate) => {
			const membership = candidate.filters[filter];
			return (
				candidate !== immediate &&
				admits(membership, hasPrimary) &&
				(membership === "cycle" || membership === "fallback")
			);
		})
		.sort(preferredFirst);
	if (immediate !== undefined) matching.unshift(immediate);
	return { immediate, matching };
}
