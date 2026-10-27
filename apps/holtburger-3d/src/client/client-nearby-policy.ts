import { matchesSearchTerms, textSearchWords } from "../app/text-search";
import {
	formatWorldMapCoordinates,
	sceneMapPoint,
} from "../lib/game/map/map-coordinates";
import { dynamicEntityWorldOrigin } from "../lib/game/runtime/dynamic-entity-presentation";
import type { DynamicEntityWorldPlacement } from "../lib/game/runtime/dynamic-entity-feed";
import {
	waypointFromMapPoint,
	type MapWaypointTarget,
} from "../lib/game/map/map-waypoint";
import {
	NEARBY_ENTITY_CATEGORIES,
	type ClientEntityFacts,
	type NearbyEntityCategory,
} from "./client-entity-mirror";

/** Category captions are app-local presentation over world-owned semantics. */
export const NEARBY_CATEGORY_DETAILS = {
	monster: { label: "Monsters" },
	npc: { label: "NPCs" },
	player: { label: "Players" },
	container: { label: "Containers" },
	item: { label: "Items" },
	portal: { label: "Portals" },
	lifestone: { label: "Lifestones" },
	"door-or-switch": { label: "Doors & Switches" },
} as const satisfies Record<NearbyEntityCategory, { readonly label: string }>;

/** Shared category order also provides stable pill and sort order. */
export const NEARBY_FILTER_OPTIONS = NEARBY_ENTITY_CATEGORIES.map(
	(category) => [category, NEARBY_CATEGORY_DETAILS[category].label] as const,
);

/** Prepared location with surface coordinates when resolved, otherwise cell-local text. */
export interface NearbyLocation {
	/** Captured text, reused by details and chat without reformatting a moving target. */
	readonly text: string;
	/** Surface navigation is available only for a resolved surface location. */
	readonly waypoint: MapWaypointTarget | null;
}

/** One bounded display row; it never retains a renderer-owned placement. */
export interface NearbyRow {
	/** Selection and retained disclosure identity. */
	readonly guid: number;
	/** World-projected public-only summary; merged inspection fields never enter rows. */
	readonly facts: NonNullable<ClientEntityFacts["nearby"]>;
	/** Existing confirmed-open state supplies the corpse subtype label. */
	readonly corpse: ClientEntityFacts["corpse"];
	/** Current accepted position, distinct from a queued detection's frozen location. */
	readonly location: NearbyLocation;
	/** Player-relative meters; absent until a player pose is available. */
	readonly distance: number | null;
	/** Enabled rule identities for badges, counts, and expanded rule labels. */
	readonly matchingRules: readonly string[];
}

/** Cold panel controls; no state here belongs to the authoritative world. */
export interface NearbyQuery {
	/** Raw name query; the spell catalog's tokenizer owns normalization. */
	readonly text: string;
	/** Union of selected category pills; empty admits every category. */
	readonly categories: readonly NearbyEntityCategory[];
	/** Intersect the category/name result with enabled alert membership. */
	readonly tracked: boolean;
	/** Every ordering uses GUID as its final stable tie-breaker. */
	readonly sort: "distance" | "name" | "category";
}

export function filterNearbyRows(
	rows: readonly NearbyRow[],
	query: NearbyQuery,
): NearbyRow[] {
	const terms = textSearchWords(query.text);
	const order = NEARBY_FILTER_OPTIONS.map(([category]) => category);
	return rows
		.filter(
			(row) =>
				(!query.tracked || row.matchingRules.length > 0) &&
				(query.categories.length === 0 ||
					query.categories.includes(row.facts.category)) &&
				matchesSearchTerms(textSearchWords(row.facts.name), terms),
		)
		.sort((a, b) => {
			let comparison: number;
			switch (query.sort) {
				case "distance":
					comparison =
						a.distance === null
							? b.distance === null
								? 0
								: 1
							: b.distance === null
								? -1
								: a.distance - b.distance;
					break;
				case "name":
					comparison = a.facts.name.localeCompare(b.facts.name, undefined, {
						sensitivity: "base",
					});
					break;
				case "category":
					comparison =
						order.indexOf(a.facts.category) - order.indexOf(b.facts.category);
					break;
			}
			return comparison || a.guid - b.guid;
		});
}

/** Format accepted AC coordinates using owner-resolved surface eligibility. */
export function nearbyLocation(
	placement: DynamicEntityWorldPlacement,
	surfaceMapEligible: boolean,
): NearbyLocation {
	const pose = placement.pose;
	if (!surfaceMapEligible) {
		const { x, y, z } = pose.coords;
		return {
			text: `Cell 0x${pose.landblockId.toString(16).padStart(8, "0")} (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`,
			waypoint: null,
		};
	}
	const origin = dynamicEntityWorldOrigin(placement);
	const position = sceneMapPoint(origin.x, origin.z);
	const text = formatWorldMapCoordinates(position);
	return { text, waypoint: waypointFromMapPoint(position) };
}
