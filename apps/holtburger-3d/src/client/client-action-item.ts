import type { ItemStructure } from "../app/item-structure";
import type { ItemCapacity } from "../app/item-capacity";
import type { UiIconDisplay } from "../app/ui-icon-repository";
import type { ClientEntityFacts } from "./client-entity-mirror";

import type {
	ActionContent,
	ConsumableIdentity,
} from "./client-action-bar-state";

/** Compare world-produced template identities without decoding item properties. */
export function sameConsumableIdentity(
	left: ConsumableIdentity,
	right: ConsumableIdentity,
): boolean {
	return left.wcid === right.wcid && left.category === right.category;
}

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
		return { kind: "equipment", item: item.guid, replacement: null };
	}
	const kind = item.description.useCapability;
	return kind === "direct" || kind === "targeted"
		? {
				kind,
				item: item.guid,
				replacement:
					item.description.consumable !== null &&
					item.description.consumable.availability !== "exhausted"
						? item.description.consumable.identity
						: null,
			}
		: null;
}

/** Sampled bound-item presentation, independent of retained binding identity. */
export interface ActionItemDisplay {
	/** Known item name or explicit unavailable identity. */
	readonly label: string;
	/** Current bound stack quantity, independent of artwork and replacement identity. */
	readonly stackCount: number | null;
	/** Current bound-item structure, independent of artwork. */
	readonly structure: ItemStructure | null;
	/** Known container occupancy from the inventory baseline. */
	readonly capacity: ItemCapacity | null;
	/** Current binding kind; each cell compares this against its retained action. */
	readonly actionKind: ActionContent["kind"] | null;
	/** Available alternate behavior, consumed by focused action-cell modifier hints. */
	readonly alternateLabel: string | null;
	/** A depleted instance must not turn a waiting supply binding into a drain action. */
	readonly readyReplacement: ConsumableIdentity | null;
	/** Confirmed player equipment state; never inferred from a submitted command. */
	readonly equipped: boolean;
	/** Repository-owned artwork protected by the collection's display lease. */
	readonly display: UiIconDisplay | undefined;
}
