import type { NormalizedRgbaColor } from "../../frontend-color";

/** Runtime-adjustable appearance of the depth-independent selected-entity outline. */
export interface EntitySelectionOutlineSettings {
	/** Straight-alpha outline color mixed over the finished scene. */
	readonly color: NormalizedRgbaColor;
	/** Outline radius in CSS pixels, independent of render scale. */
	readonly widthCssPixels: number;
	/** Contrasting separator outside the core. */
	readonly borderColor: NormalizedRgbaColor;
	/** Separator thickness in CSS pixels. */
	readonly borderWidthCssPixels: number;
	/** Feathered exterior halo color; alpha is its peak opacity. */
	readonly haloColor: NormalizedRgbaColor;
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
	for (const field of ["color", "borderColor", "haloColor"] as const) {
		const color = settings[field];
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

/** Resolve halo animation once per presentation; the core and border stay steady. */
export function selectionHaloOpacity(
	settings: EntitySelectionOutlineSettings,
	timeSeconds: number,
): number {
	const phase = (timeSeconds / settings.breathingPeriodSeconds) * 2 * Math.PI;
	const pulse = 0.5 - 0.5 * Math.cos(phase);
	const strength =
		settings.breathingMinimum + (1 - settings.breathingMinimum) * pulse;
	return settings.haloColor.alpha * strength;
}
