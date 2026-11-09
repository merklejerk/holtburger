import { hudAttention } from "../app/hud-attention";
import type { ContentsArrivalSource } from "./client-contents-arrivals";
import type { ClientLifecycleSession } from "./client-lifecycle-session";
import type { ClientSystemPanel } from "./ClientShortcutDock.svelte";

/** Mounted shortcut subscriptions observe live activity without replaying session history. */
interface ShortcutAttention {
	/** Panel whose live activity this button presents. */
	readonly panel: ClientSystemPanel | null;
	/** Inventory retains its own confirmed arrival detection. */
	readonly inventory: ContentsArrivalSource | null | undefined;
	/** Session owns accepted journal activity and spellbook membership. */
	readonly session: Pick<ClientLifecycleSession, "state" | "subscribe"> | null;
}

/** Reuse the HUD pulse while keeping notification policy local to the shortcut dock. */
export function shortcutAttention(
	node: HTMLElement,
	initial: ShortcutAttention,
) {
	let current = initial;
	let sequence = 0;
	const attention = hudAttention(node, null);
	const pulse = () => attention.update(++sequence);
	const subscribe = () => {
		if (current.panel === "inventory")
			return current.inventory?.subscribeArrivals(pulse);
		const { panel, session } = current;
		if (session === null || (panel !== "journal" && panel !== "characterSheet"))
			return;
		let knownSpells = session.state().knownSpells;
		return session.subscribe((event) => {
			if (panel === "journal") {
				if (
					event.type === "contract-membership-change" &&
					event.change.kind === "added"
				)
					pulse();
				return;
			}
			if (event.type === "spells") {
				// Membership, rather than count, catches additions paired with removals.
				const previous = knownSpells === null ? null : new Set(knownSpells);
				knownSpells = event.spellIds;
				if (previous !== null && event.spellIds.some((id) => !previous.has(id)))
					pulse();
			} else if (event.type === "current-state" || event.type === "lifecycle") {
				knownSpells = session.state().knownSpells;
			} else if (event.type === "resyncing") {
				knownSpells = null;
			}
		});
	};
	let unsubscribe = subscribe();
	return {
		update(next: ShortcutAttention) {
			if (
				next.panel === current.panel &&
				next.inventory === current.inventory &&
				next.session === current.session
			)
				return;
			unsubscribe?.();
			attention.update(null);
			current = next;
			unsubscribe = subscribe();
		},
		destroy() {
			unsubscribe?.();
		},
	};
}
