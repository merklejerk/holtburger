import type {
	ClientEntityFacts,
	ClientEntityRead,
} from "./client-entity-mirror";

/** A selected source carries its proven description for vendor artwork without another lookup. */
type ClientOfferItem = ClientEntityFacts & {
	readonly description: Extract<
		ClientEntityFacts["description"],
		{ kind: "known" }
	>;
};

function isDescribed(entity: ClientEntityFacts): entity is ClientOfferItem {
	return entity.description.kind === "known";
}

/** A drop distinguishes unknown contents from a known selection with no eligible items. */
export type ClientOfferSelection =
	| { readonly kind: "unavailable"; readonly reason: string }
	| { readonly kind: "selected"; readonly items: readonly ClientOfferItem[] };

/** App-local pack gesture policy; membership and eligibility come from world facts. */
export function selectOfferItems(
	read: ClientEntityRead,
	item: number,
	eligible: (facts: ClientEntityFacts) => boolean,
): ClientOfferSelection {
	if (read.kind !== "current")
		return {
			kind: "unavailable",
			reason: "Wait for inventory to finish loading.",
		};
	const source = read.level.entities.get(item);
	const mainPack = item === read.level.playerGuid;
	if (source === undefined || (!mainPack && !source.ownedByPlayer))
		return {
			kind: "unavailable",
			reason: "Only your own inventory items can be offered.",
		};
	let candidates = [source];
	if (mainPack || source.storage.kind === "container") {
		if (
			source.storage.kind !== "container" ||
			source.storage.roster !== "announced"
		)
			return {
				kind: "unavailable",
				reason: "Wait for the pack contents to finish loading.",
			};
		const children = [...read.level.entities.values()].filter(
			(entity) =>
				entity.ownedByPlayer &&
				entity.location.kind === "contained" &&
				entity.location.parentGuid === item &&
				// Main Pack's page excludes carried packs and foci in the navigation strip.
				(!mainPack || entity.location.slot.kind !== "pack"),
		);
		// The character root is never an offer, including when its page is empty.
		// Other non-empty packs never fall back to themselves when contents are ineligible.
		if (mainPack || children.length > 0) candidates = children;
	}
	return {
		kind: "selected",
		items: candidates.filter(isDescribed).filter(eligible),
	};
}
