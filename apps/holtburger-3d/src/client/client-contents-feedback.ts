import { tick } from "svelte";
import { pulseItemCell } from "../app/item-cell-pulse";
import {
	ContentsArrivals,
	type ContentsArrival,
	type ContentsArrivalSource,
} from "./client-contents-arrivals";
import type { ClientContentsSection } from "./client-container-contents";

/** Cold contents publication consumed by the mounted frontend view. */
interface ContentsFeedback {
	/** Prepared container rows from the accepted display snapshot. */
	readonly sections: readonly ClientContentsSection[];
	/** Recovery withdraws the previous baseline before current facts return. */
	readonly pending: boolean;
	/** Inventory owns its history outside the mounted panel; external storage uses local history. */
	readonly source?: ContentsArrivalSource;
}

/** One action owns arrival subscriptions and retires queued work when its source or recovery changes. */
export function contentsFeedback(node: HTMLElement, initial: ContentsFeedback) {
	let current = initial;
	let disposed = false;
	let revision = 0;
	const tracker = new ContentsArrivals();
	const observe = (value: ContentsFeedback) =>
		tracker.update(
			value.sections.map((section) => ({
				container: section.container,
				children: [...section.items, ...section.packs, ...section.unslotted],
			})),
			value.pending,
		);
	const pulse = (arrivals: ContentsArrival) => {
		const destinations = new Set(arrivals.values());
		for (const cell of node.querySelectorAll<HTMLElement>(
			".ui-item-cell[data-item-guid]",
		)) {
			const guid = Number(cell.dataset.itemGuid);
			if (
				arrivals.has(guid) ||
				(cell.closest(".contents-packs") !== null && destinations.has(guid))
			)
				pulseItemCell(cell, "arrival");
		}
	};
	const receive = (arrivals: ContentsArrival) => {
		const expected = revision;
		void tick().then(() => {
			if (!disposed && expected === revision && !current.pending)
				pulse(arrivals);
		});
	};
	let unsubscribe = initial.source?.subscribeArrivals(receive);
	if (initial.source === undefined) observe(initial);
	const update = (next: ContentsFeedback) => {
		const replaced = next.source !== current.source;
		if (replaced || next.pending !== current.pending) revision++;
		current = next;
		if (replaced) {
			unsubscribe?.();
			tracker.update([], true);
			if (next.source === undefined) observe(next);
			unsubscribe = next.source?.subscribeArrivals(receive);
		}
		if (next.source !== undefined) return;
		const expected = ++revision;
		if (next.pending) {
			observe(next);
			return;
		}
		void tick().then(() => {
			if (disposed || expected !== revision) return;
			// Local storage compares only committed views, so transient sorting cannot consume arrivals.
			pulse(observe(next));
		});
	};
	return {
		update,
		destroy() {
			disposed = true;
			unsubscribe?.();
			revision++;
		},
	};
}
