import type { MinimapSubject } from "../../../app/minimap-frame";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import type { WorldMapBounds, WorldMapView } from "./types";

/** Fit both map-plane axes into the available CSS aspect without extra padding. */
export function fitWorldMap(
	bounds: WorldMapBounds,
	aspect: number,
): WorldMapView {
	return {
		centerX: (bounds.minX + bounds.maxX) / 2,
		centerZ: (bounds.minZ + bounds.maxZ) / 2,
		spanMeters: Math.max(
			bounds.maxX - bounds.minX,
			(bounds.maxZ - bounds.minZ) * aspect,
		),
	};
}

/** Keep the visible rectangle inside the map; oversized axes stay centered at world fit. */
export function clampWorldMap(
	view: WorldMapView,
	bounds: WorldMapBounds,
	aspect: number,
): WorldMapView {
	const spanMeters = Math.min(
		fitWorldMap(bounds, aspect).spanMeters,
		Math.max(
			SHARED_FRONTEND_TUNING.worldMap.minimumSpanMeters,
			view.spanMeters,
		),
	);
	const clampAxis = (
		center: number,
		minimum: number,
		maximum: number,
		span: number,
	): number =>
		span >= maximum - minimum
			? (minimum + maximum) / 2
			: Math.min(maximum - span / 2, Math.max(minimum + span / 2, center));
	return {
		centerX: clampAxis(view.centerX, bounds.minX, bounds.maxX, spanMeters),
		centerZ: clampAxis(
			view.centerZ,
			bounds.minZ,
			bounds.maxZ,
			spanMeters / aspect,
		),
		spanMeters,
	};
}

/** Project a canonical map-plane point into CSS pixels, with north-negative Z upward. */
export function projectWorldMapPoint(
	position: { readonly x: number; readonly z: number },
	view: WorldMapView,
	width: number,
	height: number,
): readonly [number, number] {
	const scale = width / view.spanMeters;
	return [
		width / 2 + (position.x - view.centerX) * scale,
		height / 2 + (position.z - view.centerZ) * scale,
	];
}

/** Only a coherent outdoor player supplies a current-position marker. */
export function worldMapPlayer(
	subject: MinimapSubject | null,
	view: WorldMapView,
	width: number,
	height: number,
): readonly [number, number] | null {
	if (
		subject?.kind !== "controlled-entity" ||
		subject.anchor.residency === null ||
		subject.anchor.residency.envCellId !== null
	)
		return null;
	return projectWorldMapPoint(
		{ x: subject.anchor.worldX, z: subject.anchor.worldZ },
		view,
		width,
		height,
	);
}

/** Resolve a canvas CSS-pixel point to terrain coordinates; fit margins have no location. */
export function worldMapPosition(
	x: number,
	y: number,
	view: WorldMapView,
	bounds: WorldMapBounds,
	width: number,
	height: number,
): { readonly x: number; readonly z: number } | null {
	if (width <= 0 || height <= 0 || x < 0 || y < 0 || x > width || y > height)
		return null;
	const scale = view.spanMeters / width;
	const position = {
		x: view.centerX + (x - width / 2) * scale,
		z: view.centerZ + (y - height / 2) * scale,
	};
	return position.x < bounds.minX ||
		position.x > bounds.maxX ||
		position.z < bounds.minZ ||
		position.z > bounds.maxZ
		? null
		: position;
}
