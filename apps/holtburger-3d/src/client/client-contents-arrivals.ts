import type { ClientContentsSection } from "./client-container-contents";

/** Compare contents by container and physical identity; cell order and artwork are irrelevant. */
export class ContentsArrivals {
	/** Null quantities distinguish unknown descriptions from established single items. */
	#containers = new Map<number, ReadonlyMap<number, number | null>>();

	/** Initial, newly opened, and recovering containers establish a quiet baseline. */
	update(
		sections: readonly ClientContentsSection[],
		pending: boolean,
	): ReadonlySet<number> {
		const arrivals = new Set<number>();
		const next = new Map<number, ReadonlyMap<number, number | null>>();
		if (!pending) {
			for (const section of sections) {
				const storage = section.container.storage;
				if (storage.kind !== "container" || storage.roster === "awaiting")
					continue;
				const previous = this.#containers.get(section.container.guid);
				const items = new Map<number, number | null>();
				for (const item of [
					...section.items,
					...section.packs,
					...section.unslotted,
				]) {
					const count =
						item.description.kind === "known"
							? (item.description.stackCount ?? 1)
							: null;
					items.set(item.guid, count);
					if (previous === undefined) continue;
					const before = previous.get(item.guid);
					if (
						before === undefined ||
						(before !== null && count !== null && count > before)
					)
						arrivals.add(item.guid);
				}
				next.set(section.container.guid, items);
			}
		}
		this.#containers = next;
		return arrivals;
	}
}
