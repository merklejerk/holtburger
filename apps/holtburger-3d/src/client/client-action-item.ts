import type { ItemIconDisplay } from "../app/item-icon-repository";
import type { ClientEntityFacts } from "./client-entity-mirror";

import type { ActionContent } from "./client-action-bar-state";

/** One frontend binding decision over world-produced capabilities; equipment retains precedence. */
export function bindingAction(
	item: ClientEntityFacts | undefined,
): ActionContent | null {
	if (item?.ownedByPlayer !== true || item.description.kind !== "known")
		return null;
	if (
		item.description.equipLocations !== null &&
		item.description.equipLocations !== 0
	) {
		return { kind: "equipment", item: item.guid };
	}
	const kind = item.description.useCapability;
	return kind === "direct" || kind === "targeted"
		? { kind, item: item.guid }
		: null;
}

/** Sampled bound-item presentation, independent of retained binding identity. */
export interface ActionItemDisplay {
	/** Known item name or explicit unavailable identity. */
	readonly label: string;
	/** Current binding kind; each cell compares this against its retained action. */
	readonly actionKind: ActionContent["kind"] | null;
	/** Confirmed player equipment state; never inferred from a submitted command. */
	readonly equipped: boolean;
	/** Repository-owned artwork protected by the collection's display lease. */
	readonly display: ItemIconDisplay | undefined;
}
