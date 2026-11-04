import type { ItemStructure } from "../app/item-structure";
import type { ItemCooldownDefinition } from "../app/item-cooldowns.svelte";
import type { ItemCapacity } from "../app/item-capacity";
import type { UiIconDisplay } from "../app/ui-icon-repository";
import type { ClientEntityFacts } from "./client-entity-mirror";

import type {
	ItemActionContent,
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
): ItemActionContent | null {
	if (item?.ownedByPlayer !== true || item.description.kind !== "known")
		return null;
	if (
		item.description.equipLocations !== null &&
		item.description.equipLocations !== 0
	) {
		return { kind: "equipment", item: item.guid, replacement: null };
	}
	const kind =
		item.description.useCapability === "salvage-tool"
			? "direct"
			: item.description.useCapability;
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

/** Ordinary interaction can equip carried equipment or remove any owned worn item. */
export function canInteractEquipment(item: ClientEntityFacts): boolean {
	return (
		item.ownedByPlayer &&
		item.description.kind === "known" &&
		(item.location.kind === "equipped" ||
			(item.location.kind === "contained" &&
				bindingAction(item)?.kind === "equipment"))
	);
}

/** Frontend admission shared by selected actions and viewport activation. */
export function canInteractItem(
	item: ClientEntityFacts,
	unrestricted: boolean,
): boolean {
	return (
		item.description.kind === "known" &&
		(item.canTrade ||
			item.canPickUp ||
			(!unrestricted && canInteractEquipment(item)) ||
			item.description.useCapability === "salvage-tool" ||
			item.description.useCapability === "direct" ||
			item.description.useCapability === "targeted" ||
			(unrestricted && item.description.useCapability === "unsupported"))
	);
}

/** Sampled bound-item presentation, independent of retained binding identity. */
export interface ActionItemDisplay {
	/** Bound item's shared reuse definition, resolved independently of remaining uses. */
	readonly cooldown: ItemCooldownDefinition | null;
	/** Known item name or explicit unavailable identity. */
	readonly label: string;
	/** Current bound stack quantity, independent of artwork and replacement identity. */
	readonly stackCount: number | null;
	/** Current bound-item structure, independent of artwork. */
	readonly structure: ItemStructure | null;
	/** Known container occupancy from the inventory baseline. */
	readonly capacity: ItemCapacity | null;
	/** Current binding kind; each cell compares this against its retained action. */
	readonly actionKind: ItemActionContent["kind"] | null;
	/** Available alternate behavior, consumed by focused action-cell modifier hints. */
	readonly alternateLabel: string | null;
	/** A depleted instance must not turn a waiting supply binding into a drain action. */
	readonly readyReplacement: ConsumableIdentity | null;
	/** Confirmed player equipment state; never inferred from a submitted command. */
	readonly equipped: boolean;
	/** Repository-owned artwork protected by the collection's display lease. */
	readonly display: UiIconDisplay | undefined;
}
