import { TRAVELERS_KIT_THEME_ID } from "../app/ui-theme-contract.js";

/** Theme used by fresh/reset settings and sections without an explicit theme choice. */
export const CLIENT_DEFAULT_THEME_ID = TRAVELERS_KIT_THEME_ID;

/** Editable client graphics ranges, shared by durable validation and controls. */
export const CLIENT_GRAPHICS_RANGES = {
	viewDistance: { minimum: 0, maximum: 8, step: 1 },
	verticalFovDegrees: { minimum: 50, maximum: 100, step: 1 },
	renderScale: { minimum: 0.5, maximum: 2 },
} as const;

/** Client text multiplier; artwork and independently sized world labels keep their own policy. */
export const CLIENT_TEXT_SCALE = {
	initial: 1,
	minimum: 0.75,
	maximum: 2,
	step: 0.05,
} as const;

/** Client artwork multiplier; cell geometry and attached badges scale with their artwork. */
export const CLIENT_ICON_SCALE = {
	initial: 1,
	minimum: 0.75,
	maximum: 2,
	step: 0.05,
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
	sans: "Arimo, sans-serif",
	serif: "Gelasio, serif",
	mono: "Cousine, monospace",
};

/** Fixed recovery buffer prevents warning flicker near the user's threshold. */
export const CLIENT_VITAL_WARNING_RECOVERY_MARGIN_PERCENT = 5;
/** Remaining-vital percentage limits apply to each vital's glow and veins. */
export const CLIENT_VITAL_WARNING_PERCENT = {
	initial: 20,
	minimum: 1,
	maximum: 100 - CLIENT_VITAL_WARNING_RECOVERY_MARGIN_PERCENT,
	step: 1,
} as const;

/** Canonical vital order and labels for the warning controls and policy. */
export const CLIENT_VITAL_WARNING_KINDS = [
	{ kind: "health", label: "Health" },
	{ kind: "stamina", label: "Stamina" },
	{ kind: "mana", label: "Mana" },
] as const;
/** Absence defaults for independently saved vital percentages. */
export const CLIENT_VITAL_WARNING_THRESHOLDS = {
	health: CLIENT_VITAL_WARNING_PERCENT.initial,
	stamina: CLIENT_VITAL_WARNING_PERCENT.initial,
	mana: CLIENT_VITAL_WARNING_PERCENT.initial,
} as const;
