/** Bundled font stacks selectable in Appearance settings; `"theme"` inherits the active theme. */
const UI_FONT_FAMILY_CSS = {
	sans: "Arimo, sans-serif",
	serif: "Gelasio, serif",
	mono: "Cousine, monospace",
} as const;

export type UiFontFamilyChoice = "theme" | keyof typeof UI_FONT_FAMILY_CSS;

/** Resolve a font preference to a CSS custom-property value, or undefined to inherit the theme. */
export function uiFontCss(family: UiFontFamilyChoice): string | undefined {
	return family === "theme" ? undefined : UI_FONT_FAMILY_CSS[family];
}
