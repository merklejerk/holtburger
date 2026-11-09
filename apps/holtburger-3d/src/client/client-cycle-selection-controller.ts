import { selectionBoxDistanceSquared } from "../lib/game/selection/entity-selection-volume";
import type {
	EntitySelectionBounds,
	RealizedEntitySelectionSource,
} from "../lib/game/selection/entity-selection-bounds";
import type { FrustumPlane } from "../lib/game/math/frustum";
import { createLandblockWorldOrigin } from "../lib/game/landblocks";
import { scaleVec3, dotVec3 } from "../lib/game/math/vector-utils";
import type { SceneVec3 } from "../lib/assets/ac-frame";
import {
	createEntityFacingCameraYaw,
	rotateRenderVector,
} from "../lib/game/math/camera-orientation";
import { Vec3 } from "../lib/game/math/types";
import type {
	DynamicEntityMirror,
	DynamicEntityWorldPlacement,
} from "../lib/game/runtime/dynamic-entity-feed";
import { dynamicEntityWorldOrigin } from "../lib/game/runtime/dynamic-entity-presentation";
import type { PrimaryCameraView } from "../lib/game/runtime/types";
import type { ClientInputConfiguration } from "../lib/input/input-contract";
import type { ClientCombatMode } from "./client-host-contract";
import type {
	ClientEntityFacts,
	ClientEntityMirror,
} from "./client-entity-mirror";
import type { ClientEntitySelection } from "./client-entity-selection";

/** One synchronous acquisition view; no geometry is retained after candidate sampling. */
export interface CycleSelectionPresentationFrame extends RealizedEntitySelectionSource {
	/** Primary camera is optional when a binding does not require view admission. */
	readonly view: PrimaryCameraView | null;
}

/** Binding-specific eligibility over one shared traversal cursor; memberships may overlap. */
export type CycleFilter = "smart-combat" | "non-creature" | "unopened-corpse";
/** Whether a filter admits ordinary traversal or only its best-ranked candidate. */
type CycleMembership = "cycle" | "immediate-only";
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
	if (facts.targeting === "creature") {
		const hostile =
			facts.playerThreat ||
			(facts.description.kind === "known" &&
				facts.description.mapCategory === "mob");
		return !preferences.smartTabHostileOnly || hostile
			? { "smart-combat": smartCombatMembership(facts, context) }
			: {};
	}
	const filters: Partial<Record<CycleFilter, CycleMembership>> = {
		"non-creature": "cycle",
	};
	if (facts.corpse === "unopened") filters["unopened-corpse"] = "cycle";
	if (
		!preferences.smartTabHostileOnly &&
		facts.targeting !== "projectile" &&
		facts.corpse === null
	) {
		const traversable =
			facts.description.kind === "known" &&
			facts.description.mapCategory !== "door" &&
			facts.description.mapCategory !== "door-no-direct-use" &&
			["direct", "targeted", "salvage-tool"].includes(
				facts.description.useCapability,
			);
		filters["smart-combat"] = traversable ? "cycle" : "immediate-only";
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
		facts.playerThreat ||
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

/** Input-owned traversal; the entire ordering is rebuilt only when acquiring a target. */
export class ClientCycleSelectionController {
	readonly #selection: ClientEntitySelection;
	readonly #sample: () => readonly CycleCandidate[] | null;
	readonly #unsubscribe: () => void;
	/** Last acquisition winner, shared by all binding filters. */
	#cursor: number | null = null;
	/** Last sampled Smart Tab immediate; a changed winner takes priority over traversal. */
	#smartImmediate: number | null = null;
	#destroyed = false;

	constructor(options: {
		readonly selection: ClientEntitySelection;
		readonly sample: () => readonly CycleCandidate[] | null;
	}) {
		this.#selection = options.selection;
		this.#sample = options.sample;
		this.#unsubscribe = options.selection.subscribeExternalIntent(() =>
			this.#reset(),
		);
	}

	cycle(filter: CycleFilter, direction: 1 | -1): void {
		if (this.#destroyed) return;
		const intent = this.#selection.beginAcquisition("cycle");
		const sampled = this.#candidates(filter);
		if (sampled === null) return;
		const { immediate, matching } = sampled;
		const changedImmediate =
			filter === "smart-combat" &&
			immediate !== undefined &&
			immediate.guid !== this.#smartImmediate;
		if (filter === "smart-combat")
			this.#smartImmediate = immediate?.guid ?? null;
		if (matching.length === 0) return;
		const selected = this.#selection.selectedGuid();
		const cursorIndex = matching.findIndex(
			(candidate) => candidate.guid === this.#cursor,
		);
		let start = direction === 1 ? -1 : 0;
		if (cursorIndex >= 0) start = cursorIndex;
		if (immediate !== undefined && (cursorIndex < 0 || changedImmediate)) {
			// The immediate leads the ring; traversal skips it if already selected.
			start = -direction;
		}
		for (let step = 1; step <= matching.length; step++) {
			const index =
				(((start + direction * step) % matching.length) + matching.length) %
				matching.length;
			const candidate = matching[index];
			if (candidate === undefined)
				throw new Error("Cycle index must name an eligible target.");
			if (candidate.guid !== selected || matching.length === 1) {
				this.#cursor = candidate.guid;
				this.#selection.commitAcquisition(intent, candidate.guid);
				return;
			}
		}
	}

	/** Hold reacquires the nearest target allowed by the filter and seeds subsequent traversal. */
	selectImmediate(filter: CycleFilter): void {
		if (this.#destroyed) return;
		const intent = this.#selection.beginAcquisition("external");
		const sampled = this.#candidates(filter);
		if (sampled === null) return;
		const { immediate } = sampled;
		if (filter === "smart-combat")
			this.#smartImmediate = immediate?.guid ?? null;
		if (immediate === undefined) return;
		this.#cursor = immediate.guid;
		this.#selection.commitAcquisition(intent, immediate.guid);
	}

	destroy(): void {
		this.#destroyed = true;
		this.#reset();
		this.#unsubscribe();
	}

	#candidates(filter: CycleFilter): {
		/** Nearest candidate; Smart Tab requires the cone and innermost distance band. */
		readonly immediate: CycleCandidate | undefined;
		/** Immediate winner first, followed by the remaining traversable candidates in ranked order. */
		readonly matching: CycleCandidate[];
	} | null {
		const candidates = this.#sample();
		if (candidates === null) {
			this.#reset();
			return null;
		}
		const ranked = candidates
			.filter((candidate) => candidate.filters[filter] !== undefined)
			.sort(preferredFirst);
		// Resolve immediate from the broad pool before restricting traversal. The winning
		// immediate-only entity stays in the ring; all other immediate-only entities are skipped.
		// Acquisition uses the sampler-owned volume distance so a farther, better-aligned object cannot beat
		// a nearby door. Object/corpse searches admit every direction, including coincident
		// volumes. Smart Tab gives a changed immediate priority over its traversal cursor.
		let winner:
			| { readonly candidate: CycleCandidate; readonly distanceSquared: number }
			| undefined;
		for (const candidate of ranked) {
			const acquisition =
				filter === "smart-combat"
					? candidate.smartImmediate
					: { distanceSquared: candidate.distanceSquared };
			if (acquisition === null) continue;
			if (
				winner === undefined ||
				(acquisition.distanceSquared - winner.distanceSquared ||
					preferredFirst(candidate, winner.candidate)) < 0
			)
				winner = { candidate, distanceSquared: acquisition.distanceSquared };
		}
		const immediate = winner?.candidate;
		const matching = ranked.filter(
			(candidate) =>
				candidate !== immediate && candidate.filters[filter] === "cycle",
		);
		// Promote the winner rather than rotating the ring: otherwise higher-ranked
		// targets preceding it would be deferred until traversal wraps around.
		if (immediate !== undefined) matching.unshift(immediate);
		return {
			immediate,
			matching,
		};
	}

	#reset(): void {
		this.#cursor = null;
		this.#smartImmediate = null;
	}
}
