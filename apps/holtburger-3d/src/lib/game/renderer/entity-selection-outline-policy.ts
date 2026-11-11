import type { NormalizedRgbaColor } from "../../frontend-color";

/** Theme-owned straight-alpha colors, resolved outside the rendering loop. */
export interface EntitySelectionOutlineColors {
	/** Inner outline color. */
	readonly color: NormalizedRgbaColor;
	/** Contrasting outer band. */
	readonly borderColor: NormalizedRgbaColor;
	/** Exterior halo color and peak opacity. */
	readonly haloColor: NormalizedRgbaColor;
}

/** Runtime-adjustable appearance of the depth-independent selected-entity outline. */
export interface EntitySelectionOutlineSettings {
	/** Null until the frontend has resolved its theme; selection requires a resolved palette. */
	readonly colors: EntitySelectionOutlineColors | null;
	/** Outline radius in CSS pixels, independent of render scale. */
	readonly widthCssPixels: number;
	/** Separator thickness in CSS pixels. */
	readonly borderWidthCssPixels: number;
	/** Distance over which the halo fades to transparent, in CSS pixels. */
	readonly haloWidthCssPixels: number;
	/** Minimum halo opacity as a fraction of its peak; one disables breathing. */
	readonly breathingMinimum: number;
	/** Duration of one smooth halo cycle in seconds. */
	readonly breathingPeriodSeconds: number;
}

/** Reject malformed frame settings before they reach shader uniforms. */
export function validateEntitySelectionOutlineSettings(
	settings: EntitySelectionOutlineSettings,
): void {
	if (settings.colors !== null) {
		for (const field of ["color", "borderColor", "haloColor"] as const) {
			const color = settings.colors[field];
			if (
				![color.red, color.green, color.blue, color.alpha].every(
					(channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1,
				)
			) {
				throw new Error(
					`Entity-selection ${field} color channels must be finite and in [0, 1].`,
				);
			}
		}
	}
	if (!Number.isFinite(settings.widthCssPixels) || settings.widthCssPixels <= 0)
		throw new Error(
			"Entity-selection outline width must be finite and positive.",
		);
	for (const field of ["borderWidthCssPixels", "haloWidthCssPixels"] as const) {
		const width = settings[field];
		if (!Number.isFinite(width) || width < 0)
			throw new Error(`Selection ${field} must be finite and non-negative.`);
	}
	if (
		!Number.isFinite(settings.breathingMinimum) ||
		settings.breathingMinimum < 0 ||
		settings.breathingMinimum > 1
	)
		throw new Error("Selection breathing minimum must be in [0, 1].");
	if (
		!Number.isFinite(settings.breathingPeriodSeconds) ||
		settings.breathingPeriodSeconds <= 0
	)
		throw new Error("Selection breathing period must be finite and positive.");
}

/** Resolve the halo opacity multiplier once per presentation; colors remain theme-owned. */
export function selectionHaloStrength(
	settings: EntitySelectionOutlineSettings,
	timeSeconds: number,
): number {
	const phase = (timeSeconds / settings.breathingPeriodSeconds) * 2 * Math.PI;
	const pulse = 0.5 - 0.5 * Math.cos(phase);
	return settings.breathingMinimum + (1 - settings.breathingMinimum) * pulse;
}
