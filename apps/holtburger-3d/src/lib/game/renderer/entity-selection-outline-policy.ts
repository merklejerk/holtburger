import type { NormalizedRgbaColor } from "../../frontend-color";

/** Runtime-adjustable appearance of the depth-independent selected-entity outline. */
export interface EntitySelectionOutlineSettings {
	/** Straight-alpha outline color mixed over the finished scene. */
	readonly color: NormalizedRgbaColor;
	/** Outline radius in CSS pixels, independent of render scale. */
	readonly widthCssPixels: number;
}

/** Shared baseline used by modes that do not provide an appearance override. */
export const DEFAULT_ENTITY_SELECTION_OUTLINE_SETTINGS = {
	color: { red: 1, green: 0.82, blue: 0.16, alpha: 1 },
	widthCssPixels: 2,
} as const satisfies EntitySelectionOutlineSettings;

/** Reject malformed frame settings before they reach shader uniforms. */
export function validateEntitySelectionOutlineSettings(
	settings: EntitySelectionOutlineSettings,
): void {
	const { color } = settings;
	if (
		![color.red, color.green, color.blue, color.alpha].every(
			(channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1,
		)
	) {
		throw new Error(
			"Entity-selection outline color channels must be finite and in [0, 1].",
		);
	}
	if (!Number.isFinite(settings.widthCssPixels) || settings.widthCssPixels <= 0)
		throw new Error(
			"Entity-selection outline width must be finite and positive.",
		);
}
