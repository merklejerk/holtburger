import type { ItemCapacity } from "../app/item-capacity";
import type { UiIconOwner, UiIconRepository } from "../app/ui-icon-repository";
import type { UiIconSpec } from "../app/ui-icon-source";
import type { ClientEntityFacts } from "./client-entity-mirror";
import type { ClientContentsMembership } from "./client-container-contents";

/** Shared icon leases and capacity badges; the caller owns releasing retired keys. */
export function retainContentsVisuals(
	entities: Iterable<ClientEntityFacts>,
	membership: ClientContentsMembership | null,
	playerGuid: number | null,
	icons: UiIconRepository,
	owner: UiIconOwner,
) {
	const iconKeys = new Map<number, string>();
	const retainedKeys = new Set<string>();
	const capacities = new Map<number, ItemCapacity>();
	for (const entity of entities) {
		const storage = entity.storage;
		const children = membership?.children.get(entity.guid) ?? [];
		// Unresolved placement cannot tell us whether a child consumes an item or pack slot.
		if (
			storage.kind === "container" &&
			storage.roster === "announced" &&
			storage.itemCapacity !== null &&
			!children.some((child) => child.location.slot.kind === "pending")
		) {
			capacities.set(entity.guid, {
				used: children.filter((child) => child.location.slot.kind === "item")
					.length,
				max: storage.itemCapacity,
			});
		}

		const description = entity.description;
		if (description.kind !== "known") continue;
		const { overlay, underlay, uiEffects, base } = description.icon;
		const spec: UiIconSpec =
			entity.guid === playerGuid
				? { kind: "main-pack", overlay, underlay, uiEffects }
				: {
						kind: "item",
						base,
						itemType: description.itemType,
						overlay,
						underlay,
						uiEffects,
					};
		const key = icons.retain(owner, spec);
		iconKeys.set(entity.guid, key);
		retainedKeys.add(key);
	}
	return { capacities, iconKeys, retainedKeys };
}
