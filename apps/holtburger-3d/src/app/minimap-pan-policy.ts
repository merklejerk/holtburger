import type { MapCenter } from "../lib/game/map/map-view";
import type { MinimapSubject } from "./minimap-frame";

/** Transient navigation state; detached centres are deliberately not shell-persisted layout. */
export type MinimapPanState =
	| {
			/** Follows the subject's live horizontal position. */
			readonly kind: "anchored";
	  }
	| {
			/** Holds a user-selected world-space centre. */
			readonly kind: "detached";
			/** Fixed world-space point currently shown at the centre of the map. */
			readonly center: MapCenter;
			/** Subject identity and position that begin a fresh automatic-reset measurement. */
			readonly origin: MinimapPanOrigin;
	  };

/** Stable identity plus horizontal position captured when the latest pan begins. */
interface MinimapPanOrigin extends MapCenter {
	/** Subject whose displacement is measured from this position. */
	readonly subject: MinimapPanSubjectIdentity;
}

/** Identity shape prevents a free camera from carrying a meaningless controlled GUID. */
type MinimapPanSubjectIdentity =
	| {
			/** Identifies Explorer navigation without a possessed entity. */
			readonly kind: "free-camera";
	  }
	| {
			/** Identifies a player or possessed Explorer entity. */
			readonly kind: "controlled-entity";
			/** Controlled identity that prevents pan state crossing possession changes. */
			readonly guid: number;
	  };

/** Shared zero-payload state used whenever the map follows its subject. */
export const ANCHORED_MINIMAP_PAN_STATE: MinimapPanState = { kind: "anchored" };

/** Begin or revise one detached view, rearming travel measurement from the current subject. */
export function detachMinimapPan(
	center: MapCenter,
	subject: MinimapSubject,
): MinimapPanState {
	return {
		center,
		kind: "detached",
		origin: {
			subject:
				subject.kind === "controlled-entity"
					? { guid: subject.guid, kind: subject.kind }
					: { kind: subject.kind },
			worldX: subject.anchor.worldX,
			worldZ: subject.anchor.worldZ,
		},
	};
}

/** Resolve the viewed centre without mutating the live subject anchor. */
export function minimapPanCenter(
	state: MinimapPanState,
	subject: MinimapSubject,
): MapCenter {
	return state.kind === "detached"
		? state.center
		: { worldX: subject.anchor.worldX, worldZ: subject.anchor.worldZ };
}

/**
 * Resume following after the subject changes or travels the configured horizontal distance.
 *
 * Squared distance avoids a square root on the display-rate check. The origin is a displacement
 * measurement rather than accumulated samples, so presentation cadence cannot change the policy.
 */
export function reanchorMinimapPanAfterSubjectTravel(
	state: MinimapPanState,
	subject: MinimapSubject | null,
	distanceMeters: number,
): MinimapPanState {
	if (state.kind === "anchored") return state;
	if (subject === null || !sameSubject(state.origin, subject)) {
		return ANCHORED_MINIMAP_PAN_STATE;
	}
	const deltaX = subject.anchor.worldX - state.origin.worldX;
	const deltaZ = subject.anchor.worldZ - state.origin.worldZ;
	return deltaX * deltaX + deltaZ * deltaZ >= distanceMeters * distanceMeters
		? ANCHORED_MINIMAP_PAN_STATE
		: state;
}

function sameSubject(
	origin: MinimapPanOrigin,
	subject: MinimapSubject,
): boolean {
	if (origin.subject.kind !== subject.kind) return false;
	if (origin.subject.kind === "free-camera") return true;
	if (subject.kind !== "controlled-entity") return false;
	return origin.subject.guid === subject.guid;
}
