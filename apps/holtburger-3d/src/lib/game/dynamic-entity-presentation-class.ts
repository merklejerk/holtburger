/** Complete serialized vocabulary for producer-resolved dynamic presentation policy. */
export const DYNAMIC_ENTITY_PRESENTATION_CLASSES = [
	"player",
	"npc",
	"mob",
	"portal",
	"other",
] as const;

/** Producer-resolved entity class consumed only by frontend presentation policy. */
export type DynamicEntityPresentationClass =
	(typeof DYNAMIC_ENTITY_PRESENTATION_CLASSES)[number];
