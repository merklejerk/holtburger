/** Exhaustive entity-shadow quality choices shared by renderer policy and client preferences. */
export const ENTITY_SHADOW_MODES = ["none", "simple", "shadow-maps"] as const;
export type EntityShadowMode = (typeof ENTITY_SHADOW_MODES)[number];
