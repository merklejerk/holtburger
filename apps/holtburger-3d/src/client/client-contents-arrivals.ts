import type { ClientEntityFacts } from "./client-entity-mirror";

/** Unsorted accepted membership, independent of navigation strips or grid presentation. */
export interface ContentsArrivalContainer {
	/** Container roster establishes when its initial membership is complete enough to baseline. */
	readonly container: ClientEntityFacts;
	/** Immediate contained children, including packs and entries still awaiting slot order. */
	readonly children: readonly ClientEntityFacts[];
}

/** A confirmed arrival names its immediate destination; consumers never infer it from current layout. */
export type ContentsArrival = ReadonlyMap<number, number>;
/** Session-owned inventory can notify mounted consumers without retaining old notifications. */
export interface ContentsArrivalSource {
	readonly subscribeArrivals: (
		receive: (arrivals: ContentsArrival) => void,
	) => () => void;
}
/** Compare contents by container and physical identity; cell order and artwork are irrelevant. */
export class ContentsArrivals {
	/** Null quantities distinguish unknown descriptions from established single items. */
	#containers = new Map<number, ReadonlyMap<number, number | null>>();

	/** Initial, newly opened, and recovering containers establish a quiet baseline. */
	update(
		containers: readonly ContentsArrivalContainer[],
		pending: boolean,
	): ContentsArrival {
		const arrivals = new Map<number, number>();
		const next = new Map<number, ReadonlyMap<number, number | null>>();
		if (!pending) {
			for (const { container, children } of containers) {
				const storage = container.storage;
				if (storage.kind !== "container" || storage.roster === "awaiting")
					continue;
				const previous = this.#containers.get(container.guid);
				const items = new Map<number, number | null>();
				for (const item of children) {
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
						arrivals.set(item.guid, container.guid);
				}
				next.set(container.guid, items);
			}
		}
		this.#containers = next;
		return arrivals;
	}
}
