import {
	DYNAMIC_ENTITY_PRESENTATION_CLASSES,
	type DynamicEntityPresentationClass,
} from "../dynamic-entity-presentation-class";
import type { NameplateContent } from "../systems/dynamic-presentation-source";

export const NAMEPLATE_CATEGORIES = [
	...DYNAMIC_ENTITY_PRESENTATION_CLASSES,
	"selfPlayer",
] as const;
export type NameplateCategory = (typeof NAMEPLATE_CATEGORIES)[number];

type NameplateFontStyle = "italic" | "normal" | "oblique";

/** Frontend-authored straight-alpha color with normalized channels. */
export interface NameplateColor {
	readonly alpha: number;
	readonly blue: number;
	readonly green: number;
	readonly red: number;
}

/** Canvas typography for one semantic line in a complete nameplate raster. */
export interface NameplateTextAppearance {
	readonly fontSizePixels: number;
	readonly fontStyle: NameplateFontStyle;
	readonly fontWeight: number;
	readonly outlineWidthPixels: number;
}

/** Complete frontend-authored recipe whose values can change nameplate pixels. */
export interface NameplateAppearance {
	readonly fillColors: Readonly<Record<NameplateCategory, NameplateColor>>;
	readonly fontFamily: string;
	readonly horizontalPaddingPixels: number;
	/** Horizontal separation between square slots in the optional icon row. */
	readonly indicatorGapPixels: number;
	/** Width and height of each icon slot in the optional final row. */
	readonly indicatorSizePixels: number;
	readonly level: NameplateTextAppearance;
	readonly lineGapPixels: number;
	readonly name: NameplateTextAppearance;
	readonly outlineColor: NameplateColor;
	readonly verticalPaddingPixels: number;
}

/** Producer-authored display value before frontend-local viewer classification. */
export interface NameplateSourceVisual {
	readonly entityClass: DynamicEntityPresentationClass;
	readonly content: NameplateContent;
}

/** Entity display value paired with the category that selects its frontend-authored color. */
export interface NameplateVisual {
	readonly category: NameplateCategory;
	readonly content: NameplateContent;
}

/** Cold frame policy for the text component of entity overlays. */
export interface NameplateSettings {
	readonly appearance: NameplateAppearance;
	/** Ambient-producer category participation; explicit interest admits every category. */
	readonly categoryVisibility: Readonly<Record<NameplateCategory, boolean>>;
	/** Ordinary (alert and ambient) labels retained per view; focus labels bypass this budget. */
	readonly maximumVisible: number;
	/** Smallest projected name-font height worth submitting, in CSS pixels. */
	readonly minimumLegibleNamePixels: number;
}

/** Reject malformed runtime policy at the frame boundary rather than coercing it. */
export function validateNameplateSettings(settings: NameplateSettings): void {
	if (
		!Number.isSafeInteger(settings.maximumVisible) ||
		settings.maximumVisible < 0
	)
		throw new Error(
			"Nameplate maximumVisible must be a nonnegative safe integer.",
		);
	if (
		!Number.isFinite(settings.minimumLegibleNamePixels) ||
		settings.minimumLegibleNamePixels <= 0
	)
		throw new Error(
			"Nameplate minimumLegibleNamePixels must be finite and positive.",
		);
	for (const category of NAMEPLATE_CATEGORIES) {
		if (typeof settings.categoryVisibility[category] !== "boolean")
			throw new Error(`Nameplate category ${category} must be boolean.`);
		validateNormalizedColor(
			settings.appearance.fillColors[category],
			`Nameplate ${category} fill`,
		);
	}
	if (settings.appearance.fontFamily.trim().length === 0)
		throw new Error("Nameplate font family must not be empty.");
	validateNormalizedColor(
		settings.appearance.outlineColor,
		"Nameplate outline",
	);
	validateNonnegativeFinite(
		settings.appearance.horizontalPaddingPixels,
		"horizontal padding",
	);
	validateNonnegativeFinite(
		settings.appearance.indicatorGapPixels,
		"indicator gap",
	);
	if (
		!Number.isFinite(settings.appearance.indicatorSizePixels) ||
		settings.appearance.indicatorSizePixels <= 0
	)
		throw new Error("Nameplate indicator size must be finite and positive.");
	validateNonnegativeFinite(settings.appearance.lineGapPixels, "line gap");
	validateNonnegativeFinite(
		settings.appearance.verticalPaddingPixels,
		"vertical padding",
	);
	validateTextAppearance(settings.appearance.name, "name");
	validateTextAppearance(settings.appearance.level, "level");
}

/** Refine only the locally driven player; every other producer class remains authoritative. */
export function resolveNameplateCategory(
	entityClass: DynamicEntityPresentationClass,
	isViewerEntity: boolean,
): NameplateCategory {
	return entityClass === "player" && isViewerEntity
		? "selfPlayer"
		: entityClass;
}

function validateTextAppearance(
	appearance: NameplateTextAppearance,
	role: "level" | "name",
): void {
	if (
		!Number.isFinite(appearance.fontSizePixels) ||
		appearance.fontSizePixels <= 0
	)
		throw new Error(`Nameplate ${role} font size must be finite and positive.`);
	if (
		!Number.isInteger(appearance.fontWeight) ||
		appearance.fontWeight < 1 ||
		appearance.fontWeight > 1_000
	)
		throw new Error(
			`Nameplate ${role} font weight must be an integer from 1 through 1000.`,
		);
	if (
		!(["italic", "normal", "oblique"] as const).includes(appearance.fontStyle)
	)
		throw new Error(`Nameplate ${role} font style is invalid.`);
	validateNonnegativeFinite(
		appearance.outlineWidthPixels,
		`${role} outline width`,
	);
}

function validateNonnegativeFinite(value: number, label: string): void {
	if (!Number.isFinite(value) || value < 0)
		throw new Error(`Nameplate ${label} must be finite and nonnegative.`);
}

/** Shared normalized straight-alpha color validation for every overlay component. */
export function validateNormalizedColor(
	color: NameplateColor,
	label: string,
): void {
	for (const channel of ["red", "green", "blue", "alpha"] as const) {
		const value = color[channel];
		if (!Number.isFinite(value) || value < 0 || value > 1)
			throw new Error(
				`${label} color ${channel} must be finite and within [0, 1].`,
			);
	}
}
