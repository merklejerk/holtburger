import {
	rgbaColorsEqual,
	type NormalizedRgbaColor,
} from "../../lib/frontend-color";
import { Vec3 } from "../../lib/game/math/types";
import { sceneVec3, sceneVector3 } from "../../lib/assets/ac-frame";
import type {
	WorldMarkerInput,
	WorldPolylineTrajectoryInput,
} from "../../lib/game/renderer/renderer";
import type { ClientApiWorldMarker } from "../session/host-contract";

/** Hard upper bound on concurrently retained Live API markers; oldest revision is evicted first. */
export const MAX_API_MARKERS = 128;

/** Resolved per-entity Live API callout fed into `ClientEntityOverlays` and nameplate decoration. */
export interface ApiEntityCallout {
	readonly guid: number;
	readonly label: string | null;
	readonly beacon: boolean;
	readonly throughWall: boolean;
	readonly color: NormalizedRgbaColor;
}

export const EMPTY_API_ENTITY_CALLOUTS: ReadonlyMap<number, ApiEntityCallout> =
	new Map();

interface StoredMarker {
	readonly key: string;
	readonly namespace: string | null;
	readonly marker: ClientApiWorldMarker;
	readonly expiresAtMs: number;
	readonly revision: number;
}

export interface ApiWorldOverlaySnapshot {
	readonly markers: readonly WorldMarkerInput[];
	readonly polylines: readonly WorldPolylineTrajectoryInput[];
	readonly entityCallouts: ReadonlyMap<number, ApiEntityCallout>;
}

const EMPTY_OVERLAY: ApiWorldOverlaySnapshot = {
	markers: [],
	polylines: [],
	entityCallouts: EMPTY_API_ENTITY_CALLOUTS,
};

const UP_NORMAL = sceneVector3([0, 1, 0]);

function apiEntityCalloutEqual(
	left: ApiEntityCallout | undefined,
	right: ApiEntityCallout,
): boolean {
	if (left === undefined) return false;
	return (
		left.guid === right.guid &&
		left.label === right.label &&
		left.beacon === right.beacon &&
		left.throughWall === right.throughWall &&
		rgbaColorsEqual(left.color, right.color)
	);
}

function entityCalloutMapsEqual(
	left: ReadonlyMap<number, ApiEntityCallout>,
	right: ReadonlyMap<number, ApiEntityCallout>,
): boolean {
	if (left.size !== right.size) return false;
	for (const [guid, callout] of right) {
		if (!apiEntityCalloutEqual(left.get(guid), callout)) return false;
	}
	return true;
}

/**
 * Manages TTL-backed 3D world markers and entity callouts submitted through the Live API `h3d.hud`
 * hook. Expired entries are pruned against the monotonic frame clock with zero per-frame
 * allocations when the active set has not changed.
 */
export class ApiWorldMarkersStore {
	readonly #entries = new Map<string, StoredMarker>();
	#revision = 0;
	#cached: ApiWorldOverlaySnapshot = EMPTY_OVERLAY;
	#dirty = false;

	upsert(markers: readonly ClientApiWorldMarker[], nowMs: number): boolean {
		if (markers.length === 0) return false;
		for (const marker of markers) {
			const key = `${marker.namespace ?? ""}\0${marker.id}`;
			this.#revision += 1;
			// Re-insert so Map iteration order stays ascending by revision for O(1) oldest eviction.
			this.#entries.delete(key);
			this.#entries.set(key, {
				key,
				namespace: marker.namespace,
				marker,
				expiresAtMs: nowMs + marker.ttlMs,
				revision: this.#revision,
			});
			if (this.#entries.size > MAX_API_MARKERS) {
				const oldestKey = this.#entries.keys().next().value;
				if (oldestKey !== undefined) this.#entries.delete(oldestKey);
			}
		}
		this.#dirty = true;
		return true;
	}

	clear(namespace: string | null): boolean {
		if (this.#entries.size === 0) return false;
		if (namespace === null) {
			this.#entries.clear();
			this.#dirty = true;
			return true;
		}
		let removed = false;
		for (const [key, entry] of this.#entries) {
			if (entry.namespace === namespace) {
				this.#entries.delete(key);
				removed = true;
			}
		}
		if (removed) this.#dirty = true;
		return removed;
	}

	/** Removes expired entries; returns true if the active overlay snapshot changed. */
	prune(nowMs: number): boolean {
		if (this.#entries.size === 0) return false;
		let removed = false;
		for (const [key, entry] of this.#entries) {
			if (entry.expiresAtMs <= nowMs) {
				this.#entries.delete(key);
				removed = true;
			}
		}
		if (removed) this.#dirty = true;
		return removed;
	}

	snapshot(nowMs: number): ApiWorldOverlaySnapshot {
		this.prune(nowMs);
		if (!this.#dirty) return this.#cached;
		this.#dirty = false;
		if (this.#entries.size === 0) {
			this.#cached = EMPTY_OVERLAY;
			return this.#cached;
		}

		const markers: WorldMarkerInput[] = [];
		const polylines: WorldPolylineTrajectoryInput[] = [];
		const nextEntityCallouts = new Map<number, ApiEntityCallout>();
		// Map entries are maintained in ascending revision order, so later writes win per GUID.
		for (const entry of this.#entries.values()) {
			const spec = entry.marker;
			if (spec.kind === "ring") {
				markers.push({
					shape: "target",
					pending: spec.spin,
					color: spec.color,
					normal: UP_NORMAL,
					position: sceneVec3(
						new Vec3(spec.position[0], spec.position[1], spec.position[2]),
					),
					radius: spec.radius,
					renderScopeKey: spec.renderScopeKey,
				});
			} else if (spec.kind === "polyline") {
				const segments: Array<{
					readonly start: ReturnType<typeof sceneVec3>;
					readonly end: ReturnType<typeof sceneVec3>;
					readonly renderScopeKey: string;
				}> = [];
				for (let index = 0; index + 1 < spec.points.length; index += 1) {
					const a = spec.points[index];
					const b = spec.points[index + 1];
					const scope = spec.renderScopeKeys[index] ?? "outdoor";
					segments.push({
						start: sceneVec3(new Vec3(a[0], a[1], a[2])),
						end: sceneVec3(new Vec3(b[0], b[1], b[2])),
						renderScopeKey: scope,
					});
				}
				if (segments.length > 0) {
					polylines.push({
						kind: "polyline",
						revision: entry.revision,
						color: spec.color,
						style: "solid",
						segments,
					});
				}
			} else {
				nextEntityCallouts.set(spec.guid, {
					guid: spec.guid,
					label: spec.label,
					beacon: spec.beacon,
					throughWall: spec.throughWall,
					color: {
						red: spec.color[0],
						green: spec.color[1],
						blue: spec.color[2],
						alpha: spec.color[3],
					},
				});
			}
		}

		// Preserve referential identity of entityCallouts when only rings or polylines changed.
		const entityCallouts =
			nextEntityCallouts.size === 0
				? EMPTY_API_ENTITY_CALLOUTS
				: entityCalloutMapsEqual(
							this.#cached.entityCallouts,
							nextEntityCallouts,
					  )
					? this.#cached.entityCallouts
					: nextEntityCallouts;
		this.#cached = { markers, polylines, entityCallouts };
		return this.#cached;
	}
}
