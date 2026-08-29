/** Complete serialized vocabulary for producer-resolved dynamic presentation policy. */
export const DYNAMIC_ENTITY_CATEGORIES = [
	"player",
	"npc",
	"mob",
	"other",
] as const;

/** Producer-resolved category used only for frontend presentation participation. */
export type DynamicEntityCategory = (typeof DYNAMIC_ENTITY_CATEGORIES)[number];
