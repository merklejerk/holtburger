import type { SceneVec3 } from "../lib/assets/ac-frame";
import { rotateRenderVector } from "../lib/game/math/camera-orientation";
import { Vec3 } from "../lib/game/math/types";
import type { DynamicEntityMirror } from "../lib/game/runtime/dynamic-entity-feed";
import { dynamicEntityWorldOrigin } from "../lib/game/runtime/dynamic-entity-presentation";
import type { PrimaryCameraView } from "../lib/game/runtime/types";
import type { ClientEntityMirror } from "./client-entity-mirror";
import type { ClientEntitySelection } from "./client-entity-selection";

/** World-produced eligible categories; disposition does not participate in cycling. */
export type CycleCategory = "creature" | "non-creature";
/** App-local acquisition knobs, sampled only on input. */
export interface CycleSelectionPolicy {
	/** Player-to-origin acquisition radius in meters for both categories. */
	readonly radiusMeters: number;
	/** Idle gap after which distance ordering is rebuilt on the next press. */
	readonly idleResetMs: number;
	/** Extra horizontal/vertical half-width in meters; no behind-camera admission. */
	readonly viewMarginMeters: number;
}
/** Eligible identity and distance computed once by the candidate sampler. */
export interface CycleCandidate {
	/** Stable identity used for membership and final selection. */
	readonly guid: number;
	/** Squared player-to-origin distance; consumed only when sorting new membership. */
	readonly distanceSquared: number;
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
	category: CycleCategory,
	policy: CycleSelectionPolicy,
): readonly CycleCandidate[] | null {
	const read = entities.read();
	if (
		read.kind === "pending" ||
		motion.isAwaitingSnapshot() ||
		read.level.playerGuid === null
	)
		return null;
	if (category === "creature" && view === null) return null;
	const origins = new Map<number, SceneVec3>();
	// A borrowed, unsorted iteration avoids making mirror/UI ordering part of this hot input path.
	for (const entity of motion.currentEntities()) {
		if (
			entity.placement.kind === "world" &&
			(entity.identity.guid === read.level.playerGuid ||
				read.level.entities.get(entity.identity.guid)?.targeting === category)
		)
			origins.set(
				entity.identity.guid,
				dynamicEntityWorldOrigin(entity.placement),
			);
	}
	const player = origins.get(read.level.playerGuid);
	if (player === undefined) return null;
	const inView =
		category === "creature" && view !== null
			? approximateTargetView(view, policy.viewMarginMeters)
			: null;
	const candidates: CycleCandidate[] = [];
	const radiusSquared = policy.radiusMeters * policy.radiusMeters;
	for (const [guid, position] of origins) {
		if (guid === read.level.playerGuid) continue;
		const distanceSquared =
			(position.x - player.x) ** 2 +
			(position.y - player.y) ** 2 +
			(position.z - player.z) ** 2;
		if (
			distanceSquared <= radiusSquared &&
			(inView === null || inView(position))
		)
			candidates.push({ guid, distanceSquared });
	}
	return candidates;
}

function nearestFirst(left: CycleCandidate, right: CycleCandidate): number {
	return left.distanceSquared - right.distanceSquared || left.guid - right.guid;
}

/** Input-owned traversal state; entity movement never schedules work or changes survivor order. */
export class ClientCycleSelectionController {
	readonly #selection: ClientEntitySelection;
	readonly #sample: (
		category: CycleCategory,
	) => readonly CycleCandidate[] | null;
	readonly #policy: CycleSelectionPolicy;
	readonly #unsubscribe: () => void;
	#cycle: {
		/** Switching categories starts a fresh traversal. */
		category: CycleCategory;
		/** Stable survivor order followed by newly admitted identities. */
		guids: readonly number[];
		/** Last cycle winner, retained independently of selection maintenance. */
		cursor: number | null;
		/** Monotonic input timestamp; no expiry timer is scheduled. */
		lastPressMs: number;
	} | null = null;
	#destroyed = false;

	constructor(options: {
		readonly selection: ClientEntitySelection;
		readonly sample: (
			category: CycleCategory,
		) => readonly CycleCandidate[] | null;
		readonly policy: CycleSelectionPolicy;
	}) {
		this.#selection = options.selection;
		this.#sample = options.sample;
		this.#policy = options.policy;
		this.#unsubscribe = options.selection.subscribeExternalIntent(() => {
			this.#cycle = null;
		});
	}

	cycle(category: CycleCategory, direction: 1 | -1, nowMs: number): void {
		if (this.#destroyed) return;
		const intent = this.#selection.beginAcquisition("cycle");
		const candidates = this.#sample(category);
		if (candidates === null) {
			this.#cycle = null;
			return;
		}
		const previous = this.#cycle;
		const continuing =
			previous !== null &&
			previous.category === category &&
			nowMs - previous.lastPressMs < this.#policy.idleResetMs;
		const eligible = new Set(candidates.map((candidate) => candidate.guid));
		const survivors = continuing
			? previous.guids.filter((guid) => eligible.has(guid))
			: [];
		const oldMembership = new Set(survivors);
		const newcomers = candidates
			.filter((candidate) => !oldMembership.has(candidate.guid))
			.sort(nearestFirst)
			.map((candidate) => candidate.guid);
		const guids = [...survivors, ...newcomers];
		let next: number | null = null;
		if (guids.length > 0) {
			const cursor =
				continuing && survivors.length > 0
					? previous.cursor
					: this.#selection.selectedGuid();
			const index = cursor === null ? -1 : guids.indexOf(cursor);
			if (index >= 0) {
				next = this.#at(guids, index + direction);
			} else if (continuing && survivors.length > 0 && cursor !== null) {
				// Preserve the removed cursor's logical gap in the old ring, in either direction.
				const oldIndex = previous.guids.indexOf(cursor);
				for (let step = 1; step <= previous.guids.length; step++) {
					const successor = this.#at(
						previous.guids,
						oldIndex + direction * step,
					);
					if (eligible.has(successor)) {
						next = successor;
						break;
					}
				}
			} else {
				next = this.#at(guids, direction === 1 ? 0 : -1);
			}
		}
		this.#cycle = { category, guids, cursor: next, lastPressMs: nowMs };
		if (next !== null) this.#selection.commitAcquisition(intent, next);
	}

	/** Fresh nearest acquisition resets stable traversal and never advances past an existing target. */
	selectNearest(category: CycleCategory): void {
		if (this.#destroyed) return;
		const intent = this.#selection.beginAcquisition("external");
		const candidates = this.#sample(category);
		if (candidates === null) return;
		let nearest: CycleCandidate | null = null;
		for (const candidate of candidates) {
			if (nearest === null || nearestFirst(candidate, nearest) < 0)
				nearest = candidate;
		}
		if (nearest !== null)
			this.#selection.commitAcquisition(intent, nearest.guid);
	}

	destroy(): void {
		this.#destroyed = true;
		this.#cycle = null;
		this.#unsubscribe();
	}

	#at(guids: readonly number[], index: number): number {
		const guid = guids[((index % guids.length) + guids.length) % guids.length];
		if (guid === undefined)
			throw new Error("Cycle cursor requires a nonempty candidate list.");
		return guid;
	}
}
