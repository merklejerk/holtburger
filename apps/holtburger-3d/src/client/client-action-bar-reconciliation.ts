import type {
	ClientEntityRead,
	ClientEntityFacts,
} from "./client-entity-mirror";
import { bindingAction, sameConsumableIdentity } from "./client-action-item";
import { ACTION_SLOT_INDICES } from "./client-action-bar-contract";
import {
	bindActionCell,
	type ClientActionBar,
} from "./client-action-bar-state";

/** A pending pack or description can still reveal a replacement; absence is not exhaustion. */
function unresolved(item: ClientEntityFacts): boolean {
	return (
		item.description.kind === "pending" ||
		(item.description.kind === "known" &&
			item.description.consumable?.availability === "pending") ||
		(item.storage.kind === "container" && item.storage.roster === "awaiting")
	);
}

/** Frontend supply policy over one accepted semantic level. Never mutates submitted interactions. */
export function reconcileActionBars(
	bars: readonly ClientActionBar[],
	read: ClientEntityRead,
): readonly ClientActionBar[] {
	if (read.kind !== "current") return bars;
	const { entities, playerGuid } = read.level;
	if (playerGuid === null) return bars;
	// Prepare inventory only when a binding actually needs replacement, not on ordinary fact updates.
	let inventory: {
		candidates: ClientEntityFacts[];
		incomplete: boolean;
	} | null = null;
	let next = bars;
	for (const bar of bars)
		for (const slot of ACTION_SLOT_INDICES) {
			const content = bar.slots[slot];
			if (content === null || content.replacement === null) continue;
			const identity = content.replacement;
			const current = entities.get(content.item);
			if (current?.ownedByPlayer) {
				if (current.description.kind === "pending") continue;
				const supply = current.description.consumable;
				if (supply?.availability === "pending") continue;
				if (
					supply?.availability === "ready" &&
					sameConsumableIdentity(identity, supply.identity) &&
					bindingAction(current)?.kind === content.kind
				)
					continue;
			}
			if (inventory === null) {
				const owned = [...entities.values()].filter(
					(item) => item.ownedByPlayer,
				);
				const player = entities.get(playerGuid);
				const incomplete =
					player === undefined || unresolved(player) || owned.some(unresolved);
				// Stable order ignores inventory sorting; cells may share the same replacement.
				const candidates = owned
					.filter((item) => item.location.kind === "contained")
					.sort((a, b) => a.guid - b.guid);
				inventory = { candidates, incomplete };
			}
			const replacement = inventory.candidates.find((item) => {
				if (item.description.kind !== "known") return false;
				const supply = item.description.consumable;
				return (
					supply?.availability === "ready" &&
					sameConsumableIdentity(identity, supply.identity) &&
					bindingAction(item)?.kind === content.kind
				);
			});
			if (replacement === undefined && inventory.incomplete) continue;
			next = bindActionCell(
				next,
				{ bar: bar.id, slot },
				replacement === undefined
					? null
					: { ...content, item: replacement.guid },
			);
		}
	return next;
}
