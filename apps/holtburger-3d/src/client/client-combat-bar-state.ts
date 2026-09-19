/** Five user-facing attack presets, ordered to match number keys 1–5. */
export const COMBAT_BREAKPOINTS = [0, 0.25, 0.5, 0.75, 1] as const;

/** User-facing attack heights ordered from the top HUD band to the bottom. */
export const COMBAT_HEIGHTS = ["high", "medium", "low"] as const;

/** Fixed gauge dimensions shared by new layouts and saved-layout migration. */
export const COMBAT_GAUGE_SIZE = { width: 320, height: 140 } as const;
