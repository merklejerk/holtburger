import {
	type SceneMapPoint,
	type ParsedMapCoordinates,
	isOutdoorMapPoint,
	scenePointFromPrintedCoordinates,
	PRINTED_MAP_COORDINATE_PAIR,
	parsePrintedMapCoordinates,
} from "./map-coordinates";
import type { MapAnchor } from "./map-view";

/** One local surface destination; elevation and pathfinding are deliberately absent. */
export interface MapWaypointTarget {
	/** Canonical horizontal point used by both map projections. */
	readonly position: SceneMapPoint;
	/** Printed destination label; prose preserves entered precision, authored positions use map formatting. */
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

/** Descriptive state and distance for waypoint command reports. */
export function formatWaypointReadout(display: MapWaypointDisplay): string {
	if (display.kind === "paused") return display.reason;
	return `${display.kind === "near" ? "Near waypoint" : "Waypoint"} · ${formatWaypointDistance(display.distanceMeters)}`;
}

/** Prepare printed intent once; invalid prose stays plain and commands report their own errors. */
export function waypointFromPrintedCoordinates(
	parsed: ParsedMapCoordinates,
): MapWaypointTarget | null {
	const position = scenePointFromPrintedCoordinates(parsed.coordinates);
	return isOutdoorMapPoint(position) ? { position, label: parsed.label } : null;
}

/** Original source spans with destinations for complete, valid pairs; the renderer owns escaping. */
export type WaypointTextSpan = {
	/** Exact source substring, including entered whitespace and punctuation. */
	readonly text: string;
	/** Null for prose or an invalid candidate. */
	readonly target: MapWaypointTarget | null;
};

/** Link complete pairs without recognizing a suffix of an identifier, signed number, or decimal. */
export function waypointTextSpans(text: string): readonly WaypointTextSpan[] {
	const pattern = new RegExp(
		String.raw`(?<![\p{L}\p{N}_.+\-])${PRINTED_MAP_COORDINATE_PAIR}(?![\p{L}\p{N}_]|\.\d)`,
		"giu",
	);
	const spans: WaypointTextSpan[] = [];
	let end = 0;
	for (const match of text.matchAll(pattern)) {
		const parsed = parsePrintedMapCoordinates(match[0]);
		const target =
			parsed === null ? null : waypointFromPrintedCoordinates(parsed);
		if (target === null) continue;
		if (match.index > end)
			spans.push({ text: text.slice(end, match.index), target: null });
		spans.push({ text: match[0], target });
		end = match.index + match[0].length;
	}
	if (end < text.length) spans.push({ text: text.slice(end), target: null });
	return spans;
}
