import type { SceneVec3 } from "../lib/assets/ac-frame";
import { rotateRenderVector } from "../lib/game/math/camera-orientation";
import { Vec3 } from "../lib/game/math/types";
import type { DynamicEntityMirror } from "../lib/game/runtime/dynamic-entity-feed";
import { dynamicEntityWorldOrigin } from "../lib/game/runtime/dynamic-entity-presentation";
import type { PrimaryCameraView } from "../lib/game/runtime/types";
import type { ClientEntityMirror } from "./client-entity-mirror";
import type { ClientEntitySelection } from "./client-entity-selection";

/** Binding-specific views over one shared target ring; memberships may overlap. */
export type CycleFilter =
	"interactable" | "hostile" | "non-creature" | "unopened-corpse";
/** App-local acquisition knobs, sampled only on input. */
export interface CycleSelectionPolicy {
	/** Player-to-origin acquisition radius in meters for both categories. */
	readonly radiusMeters: number;
	/** Radial region width; traversal preserves prior order within each band. */
	readonly distanceBandMeters: number;
	/** Number of equal azimuth sectors around the camera's horizontal heading. */
	readonly angularSectorCount: number;
	/** Fraction of spatial change needed to start a fresh acquisition, in (0, 1]. */
	readonly resetDivergence: number;
	/** Contribution of a one-region shift relative to admission/removal, in [0, 1]. */
	readonly adjacentRegionWeight: number;
	/** Extra horizontal/vertical half-width in meters; no behind-camera admission. */
	readonly viewMarginMeters: number;
}
/** Eligible identity and distance computed once by the candidate sampler. */
export interface CycleCandidate {
	/** Stable identity used for membership and final selection. */
	readonly guid: number;
	/** Squared player-to-origin distance; used for fresh nearest acquisition. */
	readonly distanceSquared: number;
	/** Player-relative radial band, computed by the candidate sampler. */
	readonly distanceBand: number;
	/** Wrapped view-relative horizontal sector, computed by the candidate sampler. */
	readonly angularSector: number;
	/** Nonempty sampler-owned memberships, including view eligibility and world use capability. */
	readonly filters: readonly [CycleFilter, ...CycleFilter[]];
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
): readonly CycleCandidate[] | null {
	const read = entities.read();
	if (
		read.kind === "pending" ||
		motion.isAwaitingSnapshot() ||
		read.level.playerGuid === null
	)
		return null;
	const origins = new Map<number, SceneVec3>();
	// A borrowed, unsorted iteration avoids making mirror/UI ordering part of this hot input path.
	for (const entity of motion.currentEntities()) {
		if (entity.placement.kind === "world")
			origins.set(
				entity.identity.guid,
				dynamicEntityWorldOrigin(entity.placement),
			);
	}
	const player = origins.get(read.level.playerGuid);
	if (player === undefined) return null;
	const inView =
		view === null ? null : approximateTargetView(view, policy.viewMarginMeters);
	// Canonical scene Y is up. Camera right gives a stable yaw even when looking vertically.
	const right =
		view === null
			? new Vec3(1, 0, 0)
			: rotateRenderVector(new Vec3(1, 0, 0), view.camera.placement.rotation);
	const candidates: CycleCandidate[] = [];
	const radiusSquared = policy.radiusMeters * policy.radiusMeters;
	for (const [guid, position] of origins) {
		if (guid === read.level.playerGuid) continue;
		const facts = read.level.entities.get(guid);
		if (facts === undefined || facts.targeting === "ineligible") continue;
		const distanceSquared =
			(position.x - player.x) ** 2 +
			(position.y - player.y) ** 2 +
			(position.z - player.z) ** 2;
		if (distanceSquared <= radiusSquared) {
			const visible = inView !== null && inView(position);
			const inTargetView = !targetOnlyInView || visible;
			let filters: [CycleFilter, ...CycleFilter[]];
			if (facts.targeting === "creature") {
				if (!inTargetView) continue;
				filters = ["interactable"];
				// World classification excludes players/vendors before applying ACE's Attackable flag.
				if (
					visible &&
					facts.description.kind === "known" &&
					facts.description.mapCategory === "mob"
				)
					filters.push("hostile");
			} else {
				filters = ["non-creature"];
				if (facts.corpse === "unopened") filters.push("unopened-corpse");
				// Corpses retain dedicated acquisition even when their authored use is supported.
				if (
					facts.corpse === null &&
					inTargetView &&
					facts.description.kind === "known" &&
					(facts.description.useCapability === "direct" ||
						facts.description.useCapability === "targeted" ||
						facts.description.useCapability === "salvage-tool")
				)
					filters.push("interactable");
			}
			const bearing = Math.atan2(
				(position.x - player.x) * right.x + (position.z - player.z) * right.z,
				(position.x - player.x) * right.z - (position.z - player.z) * right.x,
			);
			const sector = Math.round(
				(bearing * policy.angularSectorCount) / (2 * Math.PI),
			);
			candidates.push({
				guid,
				distanceSquared,
				distanceBand: Math.floor(
					Math.sqrt(distanceSquared) / policy.distanceBandMeters,
				),
				// Center sector zero on the view heading and wrap the rear seam.
				angularSector:
					((sector % policy.angularSectorCount) + policy.angularSectorCount) %
					policy.angularSectorCount,
				filters,
			});
		}
	}
	return candidates;
}

function nearestFirst(left: CycleCandidate, right: CycleCandidate): number {
	return left.distanceSquared - right.distanceSquared || left.guid - right.guid;
}

/** Mean change over the union of identities; the acquisition snapshot never drifts with taps. */
function spatialDivergence(
	baseline: readonly CycleCandidate[],
	current: readonly CycleCandidate[],
	policy: CycleSelectionPolicy,
): number {
	const remaining = new Map(
		current.map((candidate) => [candidate.guid, candidate]),
	);
	let change = 0;
	for (const before of baseline) {
		const after = remaining.get(before.guid);
		if (after === undefined) {
			change += 1;
			continue;
		}
		remaining.delete(before.guid);
		const sectorDifference = Math.abs(
			after.angularSector - before.angularSector,
		);
		// Diagonal neighbors count as one region; angular distance wraps across the rear seam.
		const steps = Math.max(
			Math.abs(after.distanceBand - before.distanceBand),
			Math.min(sectorDifference, policy.angularSectorCount - sectorDifference),
		);
		change += steps === 0 ? 0 : steps === 1 ? policy.adjacentRegionWeight : 1;
	}
	const unionSize = baseline.length + remaining.size;
	return unionSize === 0 ? 0 : (change + remaining.size) / unionSize;
}

/** Input-owned spatial traversal; movement is sampled only when acquiring a target. */
export class ClientCycleSelectionController {
	readonly #selection: ClientEntitySelection;
	readonly #sample: () => readonly CycleCandidate[] | null;
	readonly #policy: CycleSelectionPolicy;
	readonly #unsubscribe: () => void;
	#cycle: {
		/** Current distance-band order with stable ordering inside each band. */
		guids: readonly number[];
		/** Last cycle winner, retained independently of selection maintenance. */
		cursor: number | null;
		/** Each binding compares only its own eligible targets, captured on first use or reset. */
		baselines: Map<CycleFilter, readonly CycleCandidate[]>;
	} | null = null;
	#destroyed = false;

	constructor(options: {
		readonly selection: ClientEntitySelection;
		readonly sample: () => readonly CycleCandidate[] | null;
		readonly policy: CycleSelectionPolicy;
	}) {
		this.#selection = options.selection;
		this.#sample = options.sample;
		this.#policy = options.policy;
		this.#unsubscribe = options.selection.subscribeExternalIntent(() => {
			this.#cycle = null;
		});
	}

	cycle(filter: CycleFilter, direction: 1 | -1): void {
		if (this.#destroyed) return;
		const intent = this.#selection.beginAcquisition("cycle");
		const candidates = this.#sample();
		if (candidates === null) {
			this.#cycle = null;
			return;
		}
		const previous = this.#cycle;
		const matching = candidates.filter((candidate) =>
			candidate.filters.includes(filter),
		);
		const baselines =
			previous === null
				? new Map<CycleFilter, readonly CycleCandidate[]>()
				: previous.baselines;
		const baseline = baselines.get(filter);
		const reset =
			baseline !== undefined &&
			spatialDivergence(baseline, matching, this.#policy) >=
				this.#policy.resetDivergence;
		if (baseline === undefined || reset) baselines.set(filter, matching);
		const continuing = previous !== null && !reset;
		const byGuid = new Map(
			candidates.map((candidate) => [candidate.guid, candidate]),
		);
		const eligible = new Set(byGuid.keys());
		const survivors = continuing
			? previous.guids.flatMap((guid) => {
					const candidate = byGuid.get(guid);
					return candidate === undefined ? [] : [candidate];
				})
			: [];
		const oldMembership = new Set(survivors.map((candidate) => candidate.guid));
		const newcomers = candidates
			.filter((candidate) => !oldMembership.has(candidate.guid))
			.sort(nearestFirst);
		// Stable sort preserves survivor order inside bands; newcomers follow their band peers.
		const guids = [...survivors, ...newcomers]
			.sort((left, right) => left.distanceBand - right.distanceBand)
			.map((candidate) => candidate.guid);
		const selectable = new Set(matching.map((candidate) => candidate.guid));
		// Keep the full traversal ring, but a tap must change selection when its filter allows it.
		const selected = this.#selection.selectedGuid();
		if (selectable.size > 1 && selected !== null) selectable.delete(selected);
		let next: number | null = null;
		if (guids.length > 0) {
			const cursor =
				continuing && survivors.length > 0
					? previous.cursor
					: previous === null
						? selected
						: null;
			const index = cursor === null ? -1 : guids.indexOf(cursor);
			let startIndex: number | null = null;
			if (index >= 0) {
				startIndex = index + direction;
			} else if (continuing && survivors.length > 0 && cursor !== null) {
				// Preserve the removed cursor's logical gap in the old ring, in either direction.
				const oldIndex = previous.guids.indexOf(cursor);
				for (let step = 1; step <= previous.guids.length; step++) {
					const successor = this.#at(
						previous.guids,
						oldIndex + direction * step,
					);
					if (eligible.has(successor)) {
						startIndex = guids.indexOf(successor);
						break;
					}
				}
			} else {
				startIndex = direction === 1 ? 0 : -1;
			}
			if (startIndex !== null) {
				for (let step = 0; step < guids.length; step += 1) {
					const candidate = this.#at(guids, startIndex + direction * step);
					if (selectable.has(candidate)) {
						next = candidate;
						break;
					}
				}
			}
		}
		this.#cycle = {
			guids,
			cursor:
				next === null ? (previous === null ? selected : previous.cursor) : next,
			baselines,
		};
		if (next !== null) this.#selection.commitAcquisition(intent, next);
	}

	/** Fresh nearest acquisition resets stable traversal and never advances past an existing target. */
	selectNearest(filter: CycleFilter): void {
		if (this.#destroyed) return;
		const intent = this.#selection.beginAcquisition("external");
		const candidates = this.#sample();
		if (candidates === null) return;
		let nearest: CycleCandidate | null = null;
		for (const candidate of candidates) {
			if (!candidate.filters.includes(filter)) continue;
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
