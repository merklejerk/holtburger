import type { SceneMapPoint } from "./map-coordinates";
import type { MapAnchor } from "./map-view";

/** One local surface destination; elevation and pathfinding are deliberately absent. */
export interface MapWaypointTarget {
	/** Canonical horizontal point used by both map projections. */
	readonly position: SceneMapPoint;
	/** Normalized printed notation, preserving the precision entered by the player. */
	readonly label: string;
}

/** Owner-produced guidance; unavailable geometry never escapes as a distance or bearing. */
export type MapWaypointDisplay = {
	/** Destination retained across guidance pauses and proximity changes. */
	readonly target: MapWaypointTarget;
} & (
	| {
			readonly kind: "paused";
			/** User-facing reason guidance is unavailable. */
			readonly reason: string;
	  }
	| {
			readonly kind: "near";
			/** Unrounded horizontal distance for display. */
			readonly distanceMeters: number;
	  }
	| {
			readonly kind: "guiding";
			/** Unrounded horizontal distance for display. */
			readonly distanceMeters: number;
			/** Clockwise compass rotation relative to the player's facing, independent of camera/pan. */
			readonly relativeBearingRadians: number;
	  }
);

/** Pure geometry for an eligible outdoor player; proximity uses unrounded horizontal meters. */
export function mapWaypointGuidance(
	target: MapWaypointTarget,
	anchor: MapAnchor,
	nearRadiusMeters: number,
): MapWaypointDisplay {
	const east = target.position.x - anchor.worldX;
	const south = target.position.z - anchor.worldZ;
	const distanceMeters = Math.hypot(east, south);
	if (distanceMeters <= nearRadiusMeters)
		return { kind: "near", target, distanceMeters };
	return {
		kind: "guiding",
		target,
		distanceMeters,
		relativeBearingRadians: Math.atan2(east, -south) - anchor.headingRadians,
	};
}

/** Compact distance shared by command reports and the minimap footer. */
export function formatWaypointDistance(meters: number): string {
	return meters < 1000
		? `${Math.round(meters)} m`
		: `${(meters / 1000).toFixed(1)} km`;
}

/** One wording policy for command reports and the imperative HUD row. */
export function formatWaypointReadout(display: MapWaypointDisplay): string {
	if (display.kind === "paused") return display.reason;
	return `${display.kind === "near" ? "Near waypoint" : "Waypoint"} · ${formatWaypointDistance(display.distanceMeters)}`;
}
