import type { ClientEntityLevel } from "../world/entity-mirror";
import {
	contentsMembership,
	type ClientContentsMembership,
} from "./container-contents";

/** Owned membership only; shared grouping does not infer player ownership. */
export function clientInventoryMembership(
	level: ClientEntityLevel,
): ClientContentsMembership | null {
	if (level.playerGuid === null) return null;
	const root = level.entities.get(level.playerGuid);
	if (root === undefined)
		throw new Error("Inventory level is missing its player root.");
	return contentsMembership(
		root,
		[...level.entities.values()].filter((entity) => entity.ownedByPlayer),
	);
}
