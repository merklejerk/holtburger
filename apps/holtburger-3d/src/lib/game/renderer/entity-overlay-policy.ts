import type { SceneNodeId } from "../scene";
import {
	validateNormalizedColor,
	type NameplateCategory,
	type NameplateColor,
	type NameplateSettings,
} from "./nameplate-policy";

/**
 * Admission rank shared by every overlay component.
 *
 * Focus components (selected, hovered, active engagement, Smart immediate) survive ordinary count
 * budgets and text legibility cutoffs; alert components precede ambient components within the
 * finite ordinary budget. Priority never selects a depth route.
 */
export type EntityOverlayPriority = "focus" | "alert" | "ambient";

/**
 * Physical depth route resolved once per entity: overlay components ignore scene depth and draw
 * once unscoped; scene components test depth within their admitted portal domains.
 */
export type EntityOverlayOcclusion = "overlay" | "scene";

/** One entity's independently admitted label and health bar; both null is an explicit empty result. */
export interface EntityOverlayPresentation {
	/** Resolved once from entity attention; both components share the same route. */
	readonly occlusion: EntityOverlayOcclusion;
	/** Null means no label; otherwise this is its independently resolved priority. */
	readonly nameplate: EntityOverlayPriority | null;
	/** Null means no bar; a present bar carries the fraction to draw and its own priority. */
	readonly healthBar: {
		/** Authoritative fraction in [0, 1]. */
		readonly fraction: number;
		readonly priority: EntityOverlayPriority;
	} | null;
}

/** Final per-node overlay decisions borrowed for one synchronous renderer frame. */
export interface EntityOverlayLookup {
	/** Null means the node has no overlay this frame; it never implies a fallback policy. */
	presentation(nodeId: SceneNodeId): EntityOverlayPresentation | null;
}

/** Placement and perspective scale shared by every overlay component. */
export interface EntityOverlaySettings {
	/** World-space clearance above the current rigid-pose top. */
	readonly anchorPaddingWorldUnits: number;
	/** Forward camera distance where overlay rasters keep their authored pixel dimensions. */
	readonly referenceDistance: number;
}

/** World-independent health bar styling and admission, authored at baseline density. */
export interface HealthBarSettings {
	readonly widthCssPixels: number;
	readonly heightCssPixels: number;
	/** Separation from a label drawn above the bar; absent when the label is not drawn. */
	readonly gapCssPixels: number;
	readonly borderWidthCssPixels: number;
	readonly fillColor: NameplateColor;
	readonly backgroundColor: NameplateColor;
	readonly borderColor: NameplateColor;
	/** Ordinary bars retained per view; focus bars bypass this budget. */
	readonly maximumVisible: number;
	/** Smallest projected bar height worth submitting, in CSS pixels; applies to focus bars too. */
	readonly minimumLegibleBarPixels: number;
}

/** Ordinal used by budget admission: lower ranks are admitted first. */
export const ENTITY_OVERLAY_PRIORITY_RANK: Readonly<
	Record<EntityOverlayPriority, number>
> = { focus: 0, alert: 1, ambient: 2 };

export function validateEntityOverlaySettings(
	settings: EntityOverlaySettings,
): void {
	if (
		!Number.isFinite(settings.anchorPaddingWorldUnits) ||
		settings.anchorPaddingWorldUnits < 0
	)
		throw new Error(
			"Entity overlay anchorPaddingWorldUnits must be finite and nonnegative.",
		);
	if (
		!Number.isFinite(settings.referenceDistance) ||
		settings.referenceDistance <= 0
	)
		throw new Error(
			"Entity overlay referenceDistance must be finite and positive.",
		);
}

export function validateHealthBarSettings(settings: HealthBarSettings): void {
	if (!Number.isFinite(settings.widthCssPixels) || settings.widthCssPixels <= 0)
		throw new Error("Health bar width must be finite and positive.");
	if (
		!Number.isFinite(settings.heightCssPixels) ||
		settings.heightCssPixels <= 0
	)
		throw new Error("Health bar height must be finite and positive.");
	if (!Number.isFinite(settings.gapCssPixels) || settings.gapCssPixels < 0)
		throw new Error("Health bar gap must be finite and nonnegative.");
	if (
		!Number.isFinite(settings.borderWidthCssPixels) ||
		settings.borderWidthCssPixels < 0
	)
		throw new Error("Health bar border width must be finite and nonnegative.");
	if (
		!Number.isSafeInteger(settings.maximumVisible) ||
		settings.maximumVisible < 0
	)
		throw new Error(
			"Health bar maximumVisible must be a nonnegative safe integer.",
		);
	if (
		!Number.isFinite(settings.minimumLegibleBarPixels) ||
		settings.minimumLegibleBarPixels <= 0
	)
		throw new Error(
			"Health bar minimumLegibleBarPixels must be finite and positive.",
		);
	validateNormalizedColor(settings.fillColor, "Health bar fill");
	validateNormalizedColor(settings.backgroundColor, "Health bar background");
	validateNormalizedColor(settings.borderColor, "Health bar border");
}

/** GUID-keyed input checked against installed dynamic entity generation before resolving nodes. */
export interface EntityOverlayEntry {
	readonly generation: number;
	readonly presentation: EntityOverlayPresentation;
}

/** Explicit scene-driver overlay source; absent entries in `resolved` never fall back to `ambient`. */
export type EntityOverlayFrame =
	| { readonly kind: "ambient" }
	| {
			readonly kind: "resolved";
			readonly entities: ReadonlyMap<number, EntityOverlayEntry>;
	  };

/** Reusable empty resolved frame installed whenever gameplay clears or withholds overlays. */
export const EMPTY_ENTITY_OVERLAY_FRAME: EntityOverlayFrame = {
	kind: "resolved",
	entities: new Map(),
};

/**
 * Shared ambient admission helper used by Explorer and Pregame: category visibility governs ordinary
 * labels while selected/hovered attention promotes labels to focus overlay, with no health bars.
 */
export function resolveAmbientEntityOverlay(input: {
	readonly hasNameplate: boolean;
	readonly category: NameplateCategory;
	readonly isSelected: boolean;
	readonly isHovered: boolean;
	readonly nameplates: NameplateSettings;
}): EntityOverlayPresentation | null {
	if (!input.hasNameplate) return null;
	if (input.isSelected || input.isHovered) {
		return {
			occlusion: "overlay",
			nameplate: "focus",
			healthBar: null,
		};
	}
	if (!input.nameplates.categoryVisibility[input.category]) return null;
	return {
		occlusion: "scene",
		nameplate: "ambient",
		healthBar: null,
	};
}
