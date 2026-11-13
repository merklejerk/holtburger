import type { ClientEntityFacts } from "./client-entity-mirror";

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
	0x00000001, // Melee weapon
	0x00000100, // Missile weapon
	0x00008000, // Caster
	0x00000002, // Armor
	0x00000004, // Clothing
	0x00000008, // Jewelry
	0x00200000, // Magic wieldable
	0x00000020, // Food
	0x00000800, // Gem
	0x00080000, // Mana stone
	0x00001000, // Spell components
	0x00000040, // Money
	0x00040000, // Promissory note
	0x00004000, // Key
	0x00002000, // Writable
	0x00000200, // Container
	0x20000000, // Tinkering tool
	0x40000000, // Tinkering material
	0x00400000, // Craft cooking base
	0x00800000, // Craft alchemy base
	0x04000000, // Craft alchemy intermediate
	0x02000000, // Craft fletching base
	0x08000000, // Craft fletching intermediate
	0x00000080, // Miscellaneous
	0x80000000, // Gameboard
	0x00000400, // Useless
	0x00100000, // Service
	0x00000010, // Creature
	0x00010000, // Portal
	0x00020000, // Lockable
	0x10000000, // Life stone
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
