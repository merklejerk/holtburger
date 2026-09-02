/** Complete serialized vocabulary for producer-resolved overhead-map marker styling. */
export const DYNAMIC_ENTITY_MAP_BLIP_CATEGORIES = [
	"player",
	"npc",
	"mob",
	"portal",
	"lifestone",
	"other",
] as const;

/** Semantic marker category independent from authored radar color and general presentation class. */
export type DynamicEntityMapBlipCategory =
	(typeof DYNAMIC_ENTITY_MAP_BLIP_CATEGORIES)[number];

/** Complete frontend marker vocabulary, including the locally controlled directional marker. */
export type MapBlipCategory = DynamicEntityMapBlipCategory | "controlled";
