/** Complete serialized vocabulary for producer-resolved overhead-map marker styling. */
export const DYNAMIC_ENTITY_MAP_BLIP_CATEGORIES = [
	"player",
	"npc",
	"mob",
	"portal",
	"lifestone",
	"door",
	"door-no-direct-use",
	"switch",
	"other",
] as const;

/** Semantic marker category independent from authored radar color and general presentation class. */
export type DynamicEntityMapBlipCategory =
	(typeof DYNAMIC_ENTITY_MAP_BLIP_CATEGORIES)[number];

/** App-owned landmarks admitted independently of authored radar visibility. */
export type MapLandmarkCategory = "useable" | "own-corpse";

/** Frontend palette vocabulary includes local landmarks and the controlled directional marker. */
export type MapBlipCategory =
	DynamicEntityMapBlipCategory | MapLandmarkCategory | "controlled";

/** Interactable symbols override retail radar visibility but still respect hidden physics. */
export function isInteractableMapCategory(
	category: DynamicEntityMapBlipCategory,
): boolean {
	return (
		category === "door" ||
		category === "door-no-direct-use" ||
		category === "switch"
	);
}
