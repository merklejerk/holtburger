/** Fixed cell addresses shared by action-bar state, rendering, and persistence codecs. */
export const ACTION_SLOT_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** Zero-based slot identity, preserved across gaps and shape changes. */
export type ActionSlotIndex = (typeof ACTION_SLOT_INDICES)[number];

/** Maximum number of independently placed action bars in one character profile. */
export const MAX_ACTION_BARS = 10;
