/** Editable client graphics ranges, shared by durable validation and controls. */
export const CLIENT_GRAPHICS_RANGES = {
	viewDistance: { minimum: 0, maximum: 8, step: 1 },
	verticalFovDegrees: { minimum: 50, maximum: 100, step: 1 },
	renderScale: { minimum: 0.5, maximum: 2 },
} as const;

/** Closed font choices for each client UI role; Theme default inherits the active theme. */
export const CLIENT_FONT_FAMILY_OPTIONS = [
	"theme",
	"sans",
	"serif",
	"mono",
] as const;
export type ClientFontFamily = (typeof CLIENT_FONT_FAMILY_OPTIONS)[number];

/** CSS family lists applied at the client root, separate from theme-owned defaults. */
export const CLIENT_FONT_FAMILY_CSS: Readonly<
	Record<Exclude<ClientFontFamily, "theme">, string>
> = {
	sans: "Arial, Helvetica, sans-serif",
	serif: 'Georgia, "Times New Roman", serif',
	mono: '"Courier New", monospace',
};
