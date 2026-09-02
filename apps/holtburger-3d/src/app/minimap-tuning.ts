import { SHARED_FRONTEND_TUNING } from "../lib/frontend-tuning";
import { normalizedRgbColor } from "../lib/frontend-color";
import type { MapEnvironment } from "../lib/game/map/map-view";

const MINIMAP_TUNING = SHARED_FRONTEND_TUNING.minimap;

/** Player travel after which a detached minimap resumes following automatically. */
export const MINIMAP_AUTOMATIC_REANCHOR_DISTANCE_METERS = positiveFinite(
	"minimap.navigation.automaticReanchorDistanceMeters",
	MINIMAP_TUNING.navigation.automaticReanchorDistanceMeters,
);

/** Distance-sampling and retention policy injected into the stateless trail transition. */
export interface MinimapBreadcrumbPolicy {
	/** Maximum number of positions retained, including the current trail's initial sample. */
	readonly maximumSamples: number;
	/** Consecutive 3D displacement that starts a new trail. */
	readonly maximumContinuousStepMeters: number;
	/** Horizontal recording deadband and 3D coverage radius selected by current environment. */
	readonly spacingMeters: Readonly<Record<MapEnvironment, number>>;
}

/** Validated runtime policy for breadcrumb sampling and retention. */
export const MINIMAP_BREADCRUMB_POLICY: MinimapBreadcrumbPolicy = {
	maximumContinuousStepMeters: positiveFinite(
		"minimap.breadcrumbs.maximumContinuousStepMeters",
		MINIMAP_TUNING.breadcrumbs.maximumContinuousStepMeters,
	),
	maximumSamples: positiveInteger(
		"minimap.breadcrumbs.maximumSamples",
		MINIMAP_TUNING.breadcrumbs.maximumSamples,
	),
	spacingMeters: {
		indoor: positiveFinite(
			"minimap.breadcrumbs.spacingMeters.indoor",
			MINIMAP_TUNING.breadcrumbs.spacingMeters.indoor,
		),
		outdoor: positiveFinite(
			"minimap.breadcrumbs.spacingMeters.outdoor",
			MINIMAP_TUNING.breadcrumbs.spacingMeters.outdoor,
		),
	},
};

/** Base RGB channels used by every age/elevation breadcrumb style bucket. */
export const MINIMAP_BREADCRUMB_COLOR = normalizedRgbColor(
	MINIMAP_TUNING.breadcrumbs.color,
);
/** Dark RGB channels used by every age-faded breadcrumb halo. */
export const MINIMAP_BREADCRUMB_HALO_COLOR = normalizedRgbColor(
	MINIMAP_TUNING.breadcrumbs.haloColor,
);
/** Screen-space width by which the dark halo extends beyond the core. */
export const MINIMAP_BREADCRUMB_HALO_WIDTH_PIXELS = positiveFinite(
	"minimap.breadcrumbs.haloWidthPixels",
	MINIMAP_TUNING.breadcrumbs.haloWidthPixels,
);
export const MINIMAP_BREADCRUMB_RADIUS_PIXELS = positiveFinite(
	"minimap.breadcrumbs.radiusPixels",
	MINIMAP_TUNING.breadcrumbs.radiusPixels,
);
export const MINIMAP_BREADCRUMB_OLDEST_OPACITY = unitInterval(
	"minimap.breadcrumbs.oldestOpacity",
	MINIMAP_TUNING.breadcrumbs.oldestOpacity,
);
export const MINIMAP_BREADCRUMB_NEWEST_OPACITY = unitInterval(
	"minimap.breadcrumbs.newestOpacity",
	MINIMAP_TUNING.breadcrumbs.newestOpacity,
);

if (MINIMAP_BREADCRUMB_OLDEST_OPACITY > MINIMAP_BREADCRUMB_NEWEST_OPACITY) {
	throw new Error(
		"minimap.breadcrumbs.oldestOpacity must not exceed newestOpacity.",
	);
}

/** Validate a hand-authored positive minimap tuning value once at module initialization. */
function positiveFinite(name: string, value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${name} must be finite and positive; received ${value}.`);
	}
	return value;
}

/** Validate a hand-authored positive integer once at module initialization. */
function positiveInteger(name: string, value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(
			`${name} must be a positive safe integer; received ${value}.`,
		);
	}
	return value;
}

/** Validate a hand-authored opacity once at module initialization. */
function unitInterval(name: string, value: number): number {
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new Error(
			`${name} must be finite and within [0, 1]; received ${value}.`,
		);
	}
	return value;
}
