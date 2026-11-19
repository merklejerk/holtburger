import type { ClientEntityFacts } from "../world/entity-mirror";
import { ITEM_TYPE_FLAGS } from "../world/entity-labels";

/** One storage header and its occupied cells; grouping is frontend presentation only. */
export interface ClientContentsSection {
	/** The actual storage identity; labels belong to the consuming panel. */
	readonly container: ClientEntityFacts;
	/** Identifies the root section; the consumer supplies any root-specific label. */
	readonly rootSection: boolean;
	/** Ordinary inventory slots, in received order. */
	readonly items: readonly ClientEntityFacts[];
	/** Pack-slot entries not represented by this panel's navigation strip. */
	readonly packs: readonly ClientEntityFacts[];
	/** Accepted children whose ordered placement has not arrived yet. */
	readonly unslotted: readonly ClientEntityFacts[];
}

/** Frontend-only ordering; never changes server slot positions or the pack strip. */
export type ContentsSortMode = "native" | "alphabetical" | "item-type";

/** Shared cycle for the persistent preference and the button's next-mode tooltip. */
export function nextContentsSortMode(mode: ContentsSortMode): ContentsSortMode {
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

/** Browsing order for public item-type flags; numeric flag values are not UX ranks. */
const itemTypeOrder: readonly number[] = [
	ITEM_TYPE_FLAGS.MELEE_WEAPON,
	ITEM_TYPE_FLAGS.MISSILE_WEAPON,
	ITEM_TYPE_FLAGS.CASTER,
	ITEM_TYPE_FLAGS.ARMOR,
	ITEM_TYPE_FLAGS.CLOTHING,
	ITEM_TYPE_FLAGS.JEWELRY,
	ITEM_TYPE_FLAGS.MAGIC_WIELDABLE,
	ITEM_TYPE_FLAGS.FOOD,
	ITEM_TYPE_FLAGS.GEM,
	ITEM_TYPE_FLAGS.MANA_STONE,
	ITEM_TYPE_FLAGS.SPELL_COMPONENTS,
	ITEM_TYPE_FLAGS.MONEY,
	ITEM_TYPE_FLAGS.PROMISSORY_NOTE,
	ITEM_TYPE_FLAGS.KEY,
	ITEM_TYPE_FLAGS.WRITABLE,
	ITEM_TYPE_FLAGS.CONTAINER,
	ITEM_TYPE_FLAGS.TINKERING_TOOL,
	ITEM_TYPE_FLAGS.TINKERING_MATERIAL,
	ITEM_TYPE_FLAGS.CRAFT_COOKING_BASE,
	ITEM_TYPE_FLAGS.CRAFT_ALCHEMY_BASE,
	ITEM_TYPE_FLAGS.CRAFT_ALCHEMY_INTERMEDIATE,
	ITEM_TYPE_FLAGS.CRAFT_FLETCHING_BASE,
	ITEM_TYPE_FLAGS.CRAFT_FLETCHING_INTERMEDIATE,
	ITEM_TYPE_FLAGS.MISCELLANEOUS,
	ITEM_TYPE_FLAGS.GAMEBOARD,
	ITEM_TYPE_FLAGS.USELESS,
	ITEM_TYPE_FLAGS.SERVICE,
	ITEM_TYPE_FLAGS.CREATURE,
	ITEM_TYPE_FLAGS.PORTAL,
	ITEM_TYPE_FLAGS.LOCKABLE,
	ITEM_TYPE_FLAGS.LIFE_STONE,
];

/** Combined flags use the first matching category; zero and unknown-only masks sort last. */
function itemTypeRank(itemType: number): number {
	const rank = itemTypeOrder.findIndex((flag) => (itemType & flag) !== 0);
	return rank === -1 ? itemTypeOrder.length : rank;
}

/** Sort a section's existing subgroup, preserving unknown descriptions and stable slot ties. */
export function sortContentsItems(
	items: readonly ClientEntityFacts[],
	mode: ContentsSortMode,
): readonly ClientEntityFacts[] {
	if (mode === "native") return items;
	return [...items].sort((a, b) => {
		if (a.description.kind === "pending")
			return b.description.kind === "pending" ? compareSlot(a, b) : 1;
		if (b.description.kind === "pending") return -1;
		if (mode === "item-type") {
			const left = a.description;
			const right = b.description;
			if (left.itemType !== right.itemType)
				return (
					itemTypeRank(left.itemType) - itemTypeRank(right.itemType) ||
					left.itemType - right.itemType
				);
			if (left.wcid !== right.wcid) {
				if (left.wcid === null) return 1;
				if (right.wcid === null) return -1;
				return left.wcid - right.wcid;
			}
		}
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
type ContentsChild = ClientEntityFacts & {
	readonly location: Extract<
		ClientEntityFacts["location"],
		{ kind: "contained" }
	>;
};
function isContentsChild(entity: ClientEntityFacts): entity is ContentsChild {
	return entity.location.kind === "contained";
}

/** Shared, unsorted membership for resource references and lazy display projections. */
export interface ClientContentsMembership {
	/** Explicit storage root supplied by the owning access projection. */
	readonly root: ClientEntityFacts;
	/** Direct children with established storage capability. */
	readonly containers: readonly ClientEntityFacts[];
	/** Accepted contained relationships grouped by immediate parent. */
	readonly children: ReadonlyMap<number, readonly ContentsChild[]>;
	/** Every identity represented by either contents or strip, once each. */
	readonly members: readonly ClientEntityFacts[];
}

/** Root and admitted records supplied by the owning inventory or world-access projection. */
export function contentsMembership(
	root: ClientEntityFacts,
	admitted: Iterable<ClientEntityFacts>,
): ClientContentsMembership {
	const children = new Map<number, ContentsChild[]>();
	for (const entity of admitted) {
		if (!isContentsChild(entity)) continue;
		const parent = entity.location.parentGuid;
		const siblings = children.get(parent);
		if (siblings === undefined) children.set(parent, [entity]);
		else siblings.push(entity);
	}
	const containers = (children.get(root.guid) ?? []).filter(
		(entity) => entity.storage.kind === "container",
	);
	const members = new Map<number, ClientEntityFacts>();
	for (const container of [root, ...containers]) {
		members.set(container.guid, container);
		for (const child of children.get(container.guid) ?? [])
			members.set(child.guid, child);
	}
	return { root, containers, children, members: [...members.values()] };
}

/** Direct child storage gets sections; deeper storage remains an item in its parent. */
export function contentsSections(
	membership: ClientContentsMembership | null,
	navigation: "pack-slots" | "containers",
	mode: ContentsSortMode,
): readonly ClientContentsSection[] {
	if (membership === null) return [];
	const { root, children } = membership;
	const containers = [...membership.containers].sort(compareSlot);
	return [root, ...containers].map((container) => {
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
					// Inventory navigates all root pack slots; external storage leaves foci lootable.
					if (
						container.guid !== root.guid ||
						(navigation === "containers" &&
							child.location.slot.entryKind !== "container")
					)
						packs.push(child);
					break;
				case "pending":
					unslotted.push(child);
					break;
			}
		}
		return {
			container,
			rootSection: container.guid === root.guid,
			items: sortContentsItems(items, mode),
			packs: sortContentsItems(packs, mode),
			unslotted: sortContentsItems(unslotted, mode),
		};
	});
}

/** Root, native-order containers, native-order foci, then unused capacity. */
export function contentsPackSlots(
	membership: ClientContentsMembership | null,
): readonly (ClientEntityFacts | null)[] {
	if (membership === null) return [];
	const { root, children } = membership;
	const containers: ClientEntityFacts[] = [];
	const foci: ClientEntityFacts[] = [];
	let length =
		root.storage.kind === "container" ? (root.storage.packCapacity ?? 0) : 0;
	for (const entity of children.get(root.guid) ?? []) {
		const slot = entity.location.slot;
		if (slot.kind !== "pack") continue;
		// Sparse native indices survive grouping. Unknown capacity must not hide
		// an announced occupant or turn a focus into a storage container.
		length = Math.max(length, slot.index + 1);
		if (slot.entryKind === "container") containers.push(entity);
		else foci.push(entity);
	}
	return [
		root,
		...containers.sort(compareSlot),
		...foci.sort(compareSlot),
		...Array<ClientEntityFacts | null>(
			Math.max(0, length - containers.length - foci.length),
		).fill(null),
	];
}
