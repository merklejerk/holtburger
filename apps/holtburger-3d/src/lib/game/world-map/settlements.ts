import type { SceneVector3 } from "../../assets/ac-frame";
import type { WorldMapView } from "./types";
import { projectWorldMapPoint } from "./view";

/** A verified default-world anchor, independent of live entity residency. */
export interface WorldMapSettlement {
	/** Unique settlement display name and stable overlay identity. */
	readonly name: string;
	/** Canonical scene position of the selected outdoor portal arrival or vendor placement. */
	readonly position: SceneVector3;
}

/** A visible settlement anchor in map-surface CSS pixels. */
export interface WorldMapSettlementPlacement {
	/** Source anchor used by hover and node identity. */
	readonly settlement: WorldMapSettlement;
	/** Horizontal dot center in map-surface CSS pixels. */
	readonly x: number;
	/** Vertical dot center in map-surface CSS pixels. */
	readonly y: number;
}

/** Fixed CSS-pixel dot hit target; it is independent of terrain zoom. */
export const WORLD_MAP_SETTLEMENT_HIT_RADIUS = 7;
/** Project visible anchors; the map surface clips labels at its edges. */
export function projectWorldMapSettlements(
	settlements: readonly WorldMapSettlement[],
	view: WorldMapView,
	width: number,
	height: number,
): readonly WorldMapSettlementPlacement[] {
	const placements: WorldMapSettlementPlacement[] = [];
	for (const settlement of settlements) {
		const [x, y] = projectWorldMapPoint(
			{ x: settlement.position[0], z: settlement.position[2] },
			view,
			width,
			height,
		);
		if (x < 0 || y < 0 || x > width || y > height) continue;
		placements.push({ settlement, x, y });
	}
	return placements;
}

/** Nearest visible dot wins; equal distances use the settlement name as a stable tie-break. */
export function hitWorldMapSettlement(
	placements: readonly WorldMapSettlementPlacement[],
	x: number,
	y: number,
): WorldMapSettlement | null {
	let nearest: WorldMapSettlement | null = null;
	let distance = WORLD_MAP_SETTLEMENT_HIT_RADIUS ** 2;
	for (const placement of placements) {
		const candidate = (placement.x - x) ** 2 + (placement.y - y) ** 2;
		if (
			candidate < distance ||
			(candidate === distance &&
				(!nearest || placement.settlement.name < nearest.name))
		) {
			nearest = placement.settlement;
			distance = candidate;
		}
	}
	return nearest;
}
