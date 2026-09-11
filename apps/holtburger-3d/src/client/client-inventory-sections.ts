import type {
	ClientEntityFacts,
	ClientEntityLevel,
} from "./client-entity-mirror";

/** One storage header and its occupied cells; grouping is frontend presentation only. */
export interface ClientInventorySection {
	/** The actual storage identity; the player root is displayed as Main Pack. */
	readonly container: ClientEntityFacts;
	/** Display the player storage root as Main Pack; selecting it selects the player. */
	readonly mainPack: boolean;
	/** Ordinary inventory slots, in received order. */
	readonly items: readonly ClientEntityFacts[];
	/** Pack-slot entries without their own visible storage section. */
	readonly packs: readonly ClientEntityFacts[];
	/** Accepted children whose ordered placement has not arrived yet. */
	readonly unslotted: readonly ClientEntityFacts[];
}

/** Frontend-only ordering; never changes server slot positions or the pack strip. */
export type InventorySortMode = "native" | "alphabetical" | "item-type";

/** Shared cycle for the persistent preference and the button's next-mode tooltip. */
export function nextInventorySortMode(
	mode: InventorySortMode,
): InventorySortMode {
	const next = {
		native: "alphabetical",
		alphabetical: "item-type",
		"item-type": "native",
	} as const;
	return next[mode];
}

const itemNames = new Intl.Collator(undefined, {
	sensitivity: "base",
	numeric: true,
});

/** Sort a section's existing subgroup, preserving unknown descriptions and stable slot ties. */
export function sortInventoryItems(
	items: readonly ClientEntityFacts[],
	mode: InventorySortMode,
): readonly ClientEntityFacts[] {
	if (mode === "native") return items;
	return [...items].sort((a, b) => {
		if (a.description.kind === "pending")
			return b.description.kind === "pending" ? compareSlot(a, b) : 1;
		if (b.description.kind === "pending") return -1;
		if (
			mode === "item-type" &&
			a.description.itemType !== b.description.itemType
		)
			return a.description.itemType - b.description.itemType;
		return (
			itemNames.compare(a.description.name, b.description.name) ||
			compareSlot(a, b)
		);
	});
}

/** Compare received slot order without guessing placement for incomplete declarations. */
function compareSlot(a: ClientEntityFacts, b: ClientEntityFacts): number {
	const aSlot = a.location.kind === "contained" ? a.location.slot : null;
	const bSlot = b.location.kind === "contained" ? b.location.slot : null;
	if (aSlot === null || bSlot === null) return a.guid - b.guid;
	const rank = { item: 0, pack: 1, pending: 2 };
	if (aSlot.kind !== bSlot.kind) return rank[aSlot.kind] - rank[bSlot.kind];
	if (aSlot.kind !== "pending" && bSlot.kind !== "pending")
		return aSlot.index - bSlot.index || a.guid - b.guid;
	return a.guid - b.guid;
}

/** Membership preserves the placement proof used by both inventory projections. */
type InventoryChild = ClientEntityFacts & {
	readonly ownedByPlayer: true;
	readonly location: Extract<
		ClientEntityFacts["location"],
		{ kind: "contained" }
	>;
};
function isInventoryChild(entity: ClientEntityFacts): entity is InventoryChild {
	return entity.ownedByPlayer && entity.location.kind === "contained";
}

/** Shared, unsorted membership for resource references and lazy display projections. */
export interface ClientInventoryMembership {
	readonly root: ClientEntityFacts;
	readonly carriedStorage: readonly ClientEntityFacts[];
	readonly children: ReadonlyMap<number, readonly InventoryChild[]>;
	/** Every identity represented by either contents or strip, once each. */
	readonly members: readonly ClientEntityFacts[];
}

/** No sorting or resource work; equipped items and deeper contents are not displayed. */
export function clientInventoryMembership(
	level: ClientEntityLevel,
): ClientInventoryMembership | null {
	if (level.playerGuid === null) return null;
	const root = level.entities.get(level.playerGuid);
	if (root === undefined)
		throw new Error("Inventory level is missing its player root.");
	const children = new Map<number, InventoryChild[]>();
	for (const entity of level.entities.values()) {
		if (!isInventoryChild(entity)) continue;
		const parent = entity.location.parentGuid;
		const siblings = children.get(parent);
		if (siblings === undefined) children.set(parent, [entity]);
		else siblings.push(entity);
	}
	const carriedStorage = (children.get(root.guid) ?? []).filter(
		(entity) => entity.storage.kind === "container",
	);
	const members = new Map<number, ClientEntityFacts>();
	for (const container of [root, ...carriedStorage]) {
		members.set(container.guid, container);
		for (const child of children.get(container.guid) ?? [])
			members.set(child.guid, child);
	}
	return { root, carriedStorage, children, members: [...members.values()] };
}

/** Direct carried storage gets sections; deeper storage remains an item in its parent. */
export function clientInventorySections(
	membership: ClientInventoryMembership | null,
): readonly ClientInventorySection[] {
	if (membership === null) return [];
	const { root, children } = membership;
	const carriedStorage = [...membership.carriedStorage].sort(compareSlot);
	const sectionGuids = new Set(carriedStorage.map((entity) => entity.guid));
	return [root, ...carriedStorage].map((container) => {
		const items: ClientEntityFacts[] = [];
		const packs: ClientEntityFacts[] = [];
		const unslotted: ClientEntityFacts[] = [];
		for (const child of [...(children.get(container.guid) ?? [])].sort(
			compareSlot,
		)) {
			switch (child.location.slot.kind) {
				case "item":
					items.push(child);
					break;
				case "pack":
					if (!sectionGuids.has(child.guid)) packs.push(child);
					break;
				case "pending":
					unslotted.push(child);
					break;
			}
		}
		return {
			container,
			mainPack: container.guid === root.guid,
			items,
			packs,
			unslotted,
		};
	});
}

/** Main Pack followed by server-indexed pack slots, including foci and empty capacity. */
export function clientInventoryPackSlots(
	membership: ClientInventoryMembership | null,
): readonly (ClientEntityFacts | null)[] {
	if (membership === null) return [];
	const { root, children } = membership;
	const packs = new Map<number, ClientEntityFacts>();
	let length =
		root.storage.kind === "container" ? (root.storage.packCapacity ?? 0) : 0;
	for (const entity of children.get(root.guid) ?? []) {
		if (entity.location.slot.kind !== "pack") continue;
		const index = entity.location.slot.index;
		packs.set(index, entity);
		// Retain announced occupants even while capacity hydration is outstanding.
		length = Math.max(length, index + 1);
	}
	return [
		root,
		...Array.from({ length }, (_, index) => packs.get(index) ?? null),
	];
}
