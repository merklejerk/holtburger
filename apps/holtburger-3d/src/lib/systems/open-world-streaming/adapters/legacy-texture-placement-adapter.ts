import type {
	TexturePlacementLookupId,
	TexturePlacementSnapshot,
} from "../../../textures/placement";
import {
	createOpenWorldStreamingPageCompatibilityKey,
	type OpenWorldStreamingBakeTexturePlacementFact,
} from "../texture-residency/placement/bake-facts";

/** Converts legacy placement snapshots into replacement bake-facing facts. */
export function createBakeTexturePlacementFactsFromLegacySnapshot(
	snapshot: TexturePlacementSnapshot<TexturePlacementLookupId>,
): readonly OpenWorldStreamingBakeTexturePlacementFact[] {
	return [...snapshot.placementsByItemId.entries()].map(
		([itemId, placement]) => ({
			itemId: String(itemId),
			pageCompatibilityKey: createOpenWorldStreamingPageCompatibilityKey({
				pageId: placement.pageId,
				purpose: placement.purpose,
			}),
			purpose: placement.purpose,
		}),
	);
}
