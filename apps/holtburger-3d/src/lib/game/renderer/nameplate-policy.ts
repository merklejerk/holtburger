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

/** Cold frame policy bounding which entity nameplates may be submitted. */
export interface NameplateSettings {
	/** World-space clearance above the current rigid-pose top. */
	readonly anchorPaddingWorldUnits: number;
	readonly appearance: NameplateAppearance;
	readonly categoryVisibility: Readonly<Record<NameplateCategory, boolean>>;
	readonly maximumVisible: number;
	/** Smallest projected name-font height worth submitting, in CSS pixels. */
	readonly minimumLegibleNamePixels: number;
	/** Forward camera distance where a plate retains its Canvas pixel dimensions. */
	readonly referenceDistance: number;
}

/** Reject malformed runtime policy at the frame boundary rather than coercing it. */
export function validateNameplateSettings(settings: NameplateSettings): void {
	validateNonnegativeFinite(settings.anchorPaddingWorldUnits, "anchor padding");
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
	if (
		!Number.isFinite(settings.referenceDistance) ||
		settings.referenceDistance <= 0
	)
		throw new Error("Nameplate referenceDistance must be finite and positive.");
	for (const category of NAMEPLATE_CATEGORIES) {
		if (typeof settings.categoryVisibility[category] !== "boolean")
			throw new Error(`Nameplate category ${category} must be boolean.`);
		validateColor(settings.appearance.fillColors[category], `${category} fill`);
	}
	if (settings.appearance.fontFamily.trim().length === 0)
		throw new Error("Nameplate font family must not be empty.");
	validateColor(settings.appearance.outlineColor, "outline");
	validateNonnegativeFinite(
		settings.appearance.horizontalPaddingPixels,
		"horizontal padding",
	);
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
	identity: string,
	viewerEntityIdentity: string | null,
): NameplateCategory {
	return entityClass === "player" && identity === viewerEntityIdentity
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

function validateColor(color: NameplateColor, label: string): void {
	for (const channel of ["red", "green", "blue", "alpha"] as const) {
		const value = color[channel];
		if (!Number.isFinite(value) || value < 0 || value > 1)
			throw new Error(
				`Nameplate ${label} color ${channel} must be finite and within [0, 1].`,
			);
	}
}
