import type { HexRgbaColor } from "../lib/frontend-color";

/** Five user-facing attack presets, ordered to match number keys 1–5. */
export const COMBAT_BREAKPOINTS = [0, 0.25, 0.5, 0.75, 1] as const;

/** Fixed gauge dimensions shared by new layouts and saved-layout migration. */
export const COMBAT_GAUGE_SIZE = { width: 340, height: 190 } as const;

/** Known engaged-entity presentation; name and color are resolved together. */
export interface ClientCombatTarget {
	/** Entity display name, independent of current selection. */
	readonly name: string;
	/** Shared entity-name palette resolved from the same description. */
	readonly color: HexRgbaColor;
}

/** Snap validated saved slider values to a preset; exact ties select the higher value. */
export function nearestCombatBreakpoint(value: number): number {
	return COMBAT_BREAKPOINTS.reduce<number>(
		(nearest, candidate) =>
			Math.abs(candidate - value) <= Math.abs(nearest - value)
				? candidate
				: nearest,
		COMBAT_BREAKPOINTS[0],
	);
}
