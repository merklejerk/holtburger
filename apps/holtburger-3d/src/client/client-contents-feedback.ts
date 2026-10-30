import { tick } from "svelte";
import { pulseItemCell } from "../app/item-cell-pulse";
import { ContentsArrivals } from "./client-contents-arrivals";
import type { ClientContentsSection } from "./client-container-contents";

/** Cold contents publication consumed by the mounted frontend view. */
interface ContentsFeedback {
	/** Accepted per-container membership, independent of display ordering. */
	readonly sections: readonly ClientContentsSection[];
	/** Recovery withdraws the previous baseline before current facts return. */
	readonly pending: boolean;
}

/** Diff accepted membership, then pulse the destination cells after Svelte commits their markup. */
export function contentsFeedback(node: HTMLElement, initial: ContentsFeedback) {
	const tracker = new ContentsArrivals();
	tracker.update(initial.sections, initial.pending);
	// Superseding publications and destruction retire feedback queued before the DOM commit.
	let revision = 0;
	const update = (value: ContentsFeedback) => {
		const current = ++revision;
		// Recovery retires history immediately, even when ready facts return in the same flush.
		if (value.pending) {
			tracker.update(value.sections, true);
			return;
		}
		void tick().then(() => {
			if (current !== revision) return;
			// Compare committed views: artwork or selection updates must not consume an arrival
			// before its destination has been mounted by Svelte.
			const arrivals = tracker.update(value.sections, false);
			if (arrivals.size === 0) return;
			for (const cell of node.querySelectorAll<HTMLElement>(
				".ui-item-cell[data-item-guid]",
			)) {
				if (arrivals.has(Number(cell.dataset.itemGuid)))
					pulseItemCell(cell, "arrival");
			}
		});
	};
	update(initial);
	return {
		update,
		destroy: () => {
			revision++;
		},
	};
}
