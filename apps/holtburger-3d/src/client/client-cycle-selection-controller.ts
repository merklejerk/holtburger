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
import type { ClientCombatMode } from "./client-host-contract";
import type {
	ClientEntityFacts,
	ClientEntityMirror,
} from "./client-entity-mirror";
import type { ClientEntitySelection } from "./client-entity-selection";

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
	/** Player-to-origin acquisition radius in meters for every filter. */
	readonly radiusMeters: number;
	/** Width of the innermost radial band; each subsequent band doubles in width. */
	readonly initialDistanceBandMeters: number;
	/** Extra horizontal/vertical half-width in meters; no behind-camera admission. */
	readonly viewMarginMeters: number;
}
/** Eligible identity and distance computed once by the candidate sampler. */
export interface CycleCandidate {
	/** Stable identity used for membership and final selection. */
	readonly guid: number;
	/** Squared player-to-origin distance; breaks equal-band, equal-angle ties. */
	readonly distanceSquared: number;
	/** Player-relative radial band, computed by the candidate sampler. */
	readonly distanceBand: number;
	/** Cosine of the 3D angle to horizontal player forward; larger values rank first. */
	readonly forwardAlignment: number;
	/** Sampler-owned admission per filter; absence means ineligible for that filter. */
	readonly filters: Readonly<Partial<Record<CycleFilter, CycleMembership>>>;
}

/** Cheap origin-based camera test; intentionally ignores portal scopes and occlusion. */
export function approximateTargetView(
	view: PrimaryCameraView,
	marginMeters: number,
): (position: SceneVec3) => boolean {
	const { camera, extent } = view;
	const forward = rotateRenderVector(
		new Vec3(0, 0, -1),
		camera.placement.rotation,
	);
	const right = rotateRenderVector(
		new Vec3(1, 0, 0),
		camera.placement.rotation,
	);
	const up = rotateRenderVector(new Vec3(0, 1, 0), camera.placement.rotation);
	const verticalTangent = Math.tan((camera.fov * Math.PI) / 360);
	const horizontalTangent = (verticalTangent * extent.width) / extent.height;
	return (position) => {
		const x = position.x - camera.placement.position.x;
		const y = position.y - camera.placement.position.y;
		const z = position.z - camera.placement.position.z;
		const depth = x * forward.x + y * forward.y + z * forward.z;
		return (
			depth >= 0 &&
			Math.abs(x * right.x + y * right.y + z * right.z) <=
				depth * horizontalTangent + marginMeters &&
			Math.abs(x * up.x + y * up.y + z * up.z) <=
				depth * verticalTangent + marginMeters
		);
	};
}

/** Read accepted poses consistently, including entities never realized or reached by portal views. */
export function sampleCycleCandidates(
	entities: ClientEntityMirror,
	motion: DynamicEntityMirror,
	view: PrimaryCameraView | null,
	policy: CycleSelectionPolicy,
	targetOnlyInView: boolean,
	context: CycleSelectionContext,
): readonly CycleCandidate[] | null {
	const read = entities.read();
	if (
		read.kind === "pending" ||
		motion.isAwaitingSnapshot() ||
		read.level.playerGuid === null
	)
		return null;
	const placements = new Map<number, DynamicEntityWorldPlacement>();
	// A borrowed, unsorted iteration avoids making mirror/UI ordering part of this hot input path.
	for (const entity of motion.currentEntities()) {
		if (entity.placement.kind === "world")
			placements.set(entity.identity.guid, entity.placement);
	}
	const playerPlacement = placements.get(read.level.playerGuid);
	if (playerPlacement === undefined) return null;
	const player = dynamicEntityWorldOrigin(playerPlacement);
	const yaw = createEntityFacingCameraYaw(playerPlacement.pose.rotation);
	const forward = new Vec3(Math.sin(yaw), 0, -Math.cos(yaw));
	const inView =
		view === null ? null : approximateTargetView(view, policy.viewMarginMeters);
	const candidates: CycleCandidate[] = [];
	const radiusSquared = policy.radiusMeters * policy.radiusMeters;
	for (const [guid, placement] of placements) {
		const position = dynamicEntityWorldOrigin(placement);
		if (guid === read.level.playerGuid) continue;
		const facts = read.level.entities.get(guid);
		if (facts === undefined || facts.targeting === "ineligible") continue;
		const distanceSquared =
			(position.x - player.x) ** 2 +
			(position.y - player.y) ** 2 +
			(position.z - player.z) ** 2;
		if (distanceSquared <= radiusSquared) {
			const forwardDistance =
				(position.x - player.x) * forward.x +
				(position.z - player.z) * forward.z;
			const visible =
				forwardDistance >= 0 && inView !== null && inView(position);
			const distance = Math.sqrt(distanceSquared);
			const inTargetView = !targetOnlyInView || visible;
			const filters: Partial<Record<CycleFilter, CycleMembership>> = {};
			if (facts.targeting === "creature") {
				if (!inTargetView) continue;
				filters["smart-combat"] = smartCombatMembership(facts, context);
			} else {
				filters["non-creature"] = "cycle";
				if (facts.corpse === "unopened") filters["unopened-corpse"] = "cycle";
				if (facts.corpse === null && inTargetView) {
					const usable =
						facts.description.kind === "known" &&
						(facts.description.useCapability === "direct" ||
							facts.description.useCapability === "targeted" ||
							facts.description.useCapability === "salvage-tool");
					filters["smart-combat"] = usable ? "cycle" : "immediate-only";
				}
			}
			candidates.push({
				guid,
				distanceSquared,
				// Boundaries are w, 3w, 7w, ...; a boundary belongs to the outer band.
				distanceBand: Math.floor(
					Math.log2(1 + distance / policy.initialDistanceBandMeters),
				),
				// Coincident origins have no direction: rank them like a perpendicular target.
				forwardAlignment: distance === 0 ? 0 : forwardDistance / distance,
				filters,
			});
		}
	}
	return candidates;
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

/** One total ordering shared by cycling and immediate acquisition. */
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
	/** Each filter interrupts traversal only when its own immediate target changes. */
	readonly #immediates = new Map<CycleFilter, number | null>();
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
		const matching = this.#candidates(filter);
		if (matching === null) return;
		const immediate = matching[0];
		const changed = this.#immediates.get(filter) !== (immediate?.guid ?? null);
		this.#immediates.set(filter, immediate?.guid ?? null);
		if (immediate === undefined) return;
		const selected = this.#selection.selectedGuid();
		const cursorIndex = matching.findIndex(
			(candidate) => candidate.guid === this.#cursor,
		);
		let next = immediate;
		if ((!changed && cursorIndex >= 0) || immediate.guid === selected) {
			const start = changed || cursorIndex < 0 ? 0 : cursorIndex;
			for (let step = 1; step <= matching.length; step++) {
				const index =
					(((start + direction * step) % matching.length) + matching.length) %
					matching.length;
				const candidate = matching[index];
				if (candidate === undefined)
					throw new Error("Cycle index must name an eligible target.");
				if (candidate.guid !== selected || matching.length === 1) {
					next = candidate;
					break;
				}
			}
		}
		this.#cursor = next.guid;
		this.#selection.commitAcquisition(intent, next.guid);
	}

	/** Hold acquisition uses the same preference as taps and seeds subsequent traversal. */
	selectImmediate(filter: CycleFilter): void {
		if (this.#destroyed) return;
		const intent = this.#selection.beginAcquisition("external");
		const matching = this.#candidates(filter);
		if (matching === null) return;
		const immediate = matching[0];
		this.#immediates.set(filter, immediate?.guid ?? null);
		if (immediate === undefined) return;
		this.#cursor = immediate.guid;
		this.#selection.commitAcquisition(intent, immediate.guid);
	}

	destroy(): void {
		this.#destroyed = true;
		this.#reset();
		this.#unsubscribe();
	}

	#candidates(filter: CycleFilter): CycleCandidate[] | null {
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
		const immediate = ranked[0];
		return ranked.filter(
			(candidate) =>
				candidate === immediate || candidate.filters[filter] === "cycle",
		);
	}

	#reset(): void {
		this.#cursor = null;
		this.#immediates.clear();
	}
}
