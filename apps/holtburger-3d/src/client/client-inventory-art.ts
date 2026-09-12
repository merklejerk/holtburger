import type { ItemIconSpec } from "../app/item-icon-source";

/** ACE World WCID 273 (coinstack / Pyreal), PropertyDataId.Icon (8).
 * Static currency artwork remains available without a carried coin stack.
 */
export const PYREAL_ICON_SPEC = {
	kind: "base",
	base: 0x0600229f,
} as const satisfies ItemIconSpec;
