import type { MapLandmarkCategory } from "../lib/game/map/map-blip-category";
import type { ClientEntityFacts } from "./client-entity-mirror";

/** Reuse the entity-list category; corpse ownership is an explicit name heuristic. */
export function clientMinimapLandmark(
	facts: Pick<ClientEntityFacts, "nearby"> | undefined,
	playerName: string | null,
): MapLandmarkCategory | null {
	const nearby = facts?.nearby;
	if (nearby?.category === "useable") return "useable";
	// ACE Creature_Death.cs:495-496 names both player and monster corpses this way.
	// Requiring the public corpse category avoids treating arbitrary named props as corpses.
	if (
		nearby?.category === "corpse" &&
		playerName !== null &&
		nearby.name === `Corpse of ${playerName}`
	)
		return "own-corpse";
	return null;
}
