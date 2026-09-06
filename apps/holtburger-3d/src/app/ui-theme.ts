import type { UiTheme, UiThemePreferences } from "./ui-theme-contract";

/** Project the finite theme contract into CSS without reading or mutating the DOM. */
export function uiThemeProperties(
	theme: UiTheme,
	preferences: UiThemePreferences,
): Readonly<Record<string, string>> {
	const properties: Record<string, string> = {};
	for (const [role, color] of Object.entries(theme.color))
		properties[`--ui-color-${role}`] = color;
	for (const [role, font] of Object.entries(theme.font))
		properties[`--ui-font-${role}`] = font;
	for (const [role, radius] of Object.entries(theme.radius))
		properties[`--ui-radius-${role}`] =
			`${nonnegative(`radius.${role}`, radius)}px`;
	const { blur, ...strengths } = theme.material;
	nonnegative("material.blur", blur);
	for (const [role, value] of Object.entries(strengths)) {
		const validated = nonnegative(`material.${role}`, value);
		if (validated > 1) throw new Error(`material.${role} must not exceed 1.`);
		properties[`--ui-material-${role}`] = String(validated);
	}
	if (preferences.reducedTransparency) {
		properties["--ui-material-opacity"] = "1";
	}
	// Recipes can choose the opaque path without relying on blur(0px), which still creates a filter.
	properties["--ui-backdrop"] =
		preferences.reducedTransparency || blur === 0
			? "none"
			: `blur(${theme.material.blur}px)`;
	return properties;
}

/** Apply a complete theme to its owner's root, preserving unrelated inline styles and DOM identity. */
export function applyUiTheme(
	root: HTMLElement,
	theme: UiTheme,
	preferences: UiThemePreferences,
): void {
	// Validate the complete projection before publishing any change.
	const properties = uiThemeProperties(theme, preferences);
	for (const [name, value] of Object.entries(properties))
		root.style.setProperty(name, value);
	root.dataset.uiTheme = theme.id;
}

/** Reject authored dimensions/strengths that CSS could silently discard or clamp. */
function nonnegative(name: string, value: number): number {
	if (!Number.isFinite(value) || value < 0)
		throw new Error(`${name} must be finite and nonnegative.`);
	return value;
}
