import { housingSearchAreaPosition } from "./client-housing-map";
import { projectWorldMapPoint } from "../lib/game/world-map/view";
import type { WorldMapView } from "../lib/game/world-map/types";

/** One deduplicated search area, prepared when the server dataset changes. */
export interface HousingSearchArea {
	readonly cell: number;
	readonly position: { readonly x: number; readonly z: number };
}
/** Area membership supplies stable overlay identity, never a count of houses. */
export interface HousingSearchPlacement {
	readonly areas: readonly number[];
	readonly x: number;
	readonly y: number;
}
export function prepareHousingSearchAreas(
	cells: readonly number[],
): readonly HousingSearchArea[] {
	return [...new Set(cells)]
		.sort((a, b) => a - b)
		.map((cell) => ({ cell, position: housingSearchAreaPosition(cell) }));
}
/** World-anchored buckets change with zoom/width, while panning only projects their centroids. */
export function projectHousingSearchAreas(
	areas: readonly HousingSearchArea[],
	view: WorldMapView,
	width: number,
	height: number,
	spacing: number,
): readonly HousingSearchPlacement[] {
	if (width <= 0 || height <= 0) return [];
	const bucketMeters = (spacing * view.spanMeters) / width;
	const buckets = new Map<
		string,
		{ areas: number[]; sumX: number; sumZ: number }
	>();
	// Group the entire dataset before culling: viewport edges must not change membership.
	for (const area of areas) {
		const key = `${Math.floor(area.position.x / bucketMeters)}:${Math.floor(area.position.z / bucketMeters)}`;
		const bucket = buckets.get(key);
		if (bucket) {
			bucket.areas.push(area.cell);
			bucket.sumX += area.position.x;
			bucket.sumZ += area.position.z;
		} else
			buckets.set(key, {
				areas: [area.cell],
				sumX: area.position.x,
				sumZ: area.position.z,
			});
	}
	const placements: HousingSearchPlacement[] = [];
	const gutter = spacing / 2;
	for (const bucket of buckets.values()) {
		const [x, y] = projectWorldMapPoint(
			{
				x: bucket.sumX / bucket.areas.length,
				z: bucket.sumZ / bucket.areas.length,
			},
			view,
			width,
			height,
		);
		if (x < -gutter || x > width + gutter || y < -gutter || y > height + gutter)
			continue;
		placements.push({ areas: bucket.areas, x, y });
	}
	return placements;
}
