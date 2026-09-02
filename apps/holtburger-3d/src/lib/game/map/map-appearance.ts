import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import {
	normalizedRgbColor,
	normalizedRgbaColor,
	type HexRgbColor,
} from "../../frontend-color";
import type { MapBlipCategory } from "./map-blip-category";
import type { MapEnvironment } from "./map-view";

/**
 * GPU-ready form of the overhead map's tuning policy.
 *
 * Deliberately holds no values: every colour and threshold is authored in the shared frontend
 * tuning module alongside the rest of the frontend's knobs, and this module only converts them
 * into the shapes WebGL and the canvas want, once at module scope rather than per frame. Change
 * appearance there, not here.
 */
const MAP_TUNING = SHARED_FRONTEND_TUNING.map;

/** One authored colour as a GL uniform payload. */
function colorVector(color: HexRgbColor): Float32Array {
	const channels = normalizedRgbColor(color);
	return new Float32Array([channels.red, channels.green, channels.blue]);
}

export const MAP_SUN_DIRECTION = new Float32Array([
	MAP_TUNING.hillshade.sunDirection.x,
	MAP_TUNING.hillshade.sunDirection.y,
	MAP_TUNING.hillshade.sunDirection.z,
]);
export const MAP_AMBIENT_LEVEL = MAP_TUNING.hillshade.ambientLevel;
export const MAP_RELIEF_EXAGGERATION = MAP_TUNING.hillshade.reliefExaggeration;

export const MAP_ROAD_COLOR = colorVector(MAP_TUNING.colors.road);
export const MAP_ROAD_TINT_STRENGTH = MAP_TUNING.colors.roadTintStrength;
export const MAP_ROAD_CASING_PIXELS = MAP_TUNING.colors.roadCasingPixels;
export const MAP_ROAD_CASING_STRENGTH = MAP_TUNING.colors.roadCasingStrength;
export const MAP_IMPASSABLE_COLOR = colorVector(MAP_TUNING.colors.impassable);
export const MAP_IMPASSABLE_HATCH_PERIOD_PIXELS =
	MAP_TUNING.colors.impassableHatchPeriodPixels;
export const MAP_IMPASSABLE_HATCH_STRENGTH =
	MAP_TUNING.colors.impassableHatchStrength;
export const MAP_CONTOUR_INTERVAL = MAP_TUNING.colors.contourIntervalMeters;
export const MAP_CONTOUR_STRENGTH = MAP_TUNING.colors.contourStrength;
export const MAP_CONTOUR_MINIMUM_CLIMB_PER_PIXEL =
	MAP_TUNING.colors.contourMinimumClimbPerPixelMeters;
export const MAP_CONTOUR_HEIGHT_SPAN =
	MAP_TUNING.colors.contourHeightSpanMeters;
export const MAP_BLOCKER_COLOR = colorVector(MAP_TUNING.colors.blocker);
export const MAP_BLOCKER_STROKE_COLOR = colorVector(
	MAP_TUNING.colors.blockerStroke,
);
export const MAP_BLOCKER_STROKE_PIXELS = MAP_TUNING.colors.blockerStrokePixels;
export const MAP_TRANSITION_ACCENT_COLOR = colorVector(
	MAP_TUNING.colors.transitionAccent,
);

/** The clear colour needs its channels spread, so it keeps a tuple beside its vector form. */
const mapVoidChannels = normalizedRgbColor(MAP_TUNING.colors.void);
export const MAP_VOID_COLOR: readonly [number, number, number] = [
	mapVoidChannels.red,
	mapVoidChannels.green,
	mapVoidChannels.blue,
];
export const MAP_VOID_COLOR_VECTOR = new Float32Array(MAP_VOID_COLOR);

/** The one height ramp, shared by interior floors and outdoor contours. */
export const MAP_HEIGHT_SAME_LEVEL_COLOR = colorVector(
	MAP_TUNING.heightRamp.sameLevelColor,
);
export const MAP_HEIGHT_ABOVE_COLOR = colorVector(
	MAP_TUNING.heightRamp.aboveColor,
);
export const MAP_HEIGHT_BELOW_COLOR = colorVector(
	MAP_TUNING.heightRamp.belowColor,
);
export const MAP_FLOOR_SAME_LEVEL_BAND =
	MAP_TUNING.interior.sameLevelBandMeters;
export const MAP_FLOOR_TINT_SPAN = MAP_TUNING.interior.tintSpanMeters;
export const MAP_FLOOR_FADE_SPAN = MAP_TUNING.interior.fadeSpanMeters;
export const MAP_FLOOR_MAXIMUM_FADE = MAP_TUNING.interior.maximumFade;
export const MAP_FLOOR_DEPTH_SPAN = MAP_TUNING.interior.depthSpanMeters;
export const MAP_TRANSITION_ACCENT_THICKNESS =
	MAP_TUNING.interior.transitionAccentThicknessMeters;

export const MAP_BLIP_FILL_COLORS = MAP_TUNING.blips.fillColors;
export const MAP_BLIP_MAXIMUM_ELEVATION_BRIGHTNESS_ADJUSTMENT = unitInterval(
	"map.blips.maximumElevationBrightnessAdjustment",
	MAP_TUNING.blips.maximumElevationBrightnessAdjustment,
);
export const MAP_BLIP_RADIUS_PIXELS = MAP_TUNING.blips.radiusPixels;

/**
 * Convert anchor-relative elevation into a clamped Canvas brightness multiplier.
 *
 * Indoor markers reach the endpoint over one floor-tint span; outdoor markers use the broader
 * contour-height span. Positive elevation brightens and negative elevation darkens.
 */
export function mapBlipBrightness(
	heightOffsetMeters: number,
	environment: MapEnvironment,
): number {
	const span =
		environment === "indoor" ? MAP_FLOOR_TINT_SPAN : MAP_CONTOUR_HEIGHT_SPAN;
	const normalizedHeight = Math.min(Math.abs(heightOffsetMeters) / span, 1);
	const adjustment =
		normalizedHeight * MAP_BLIP_MAXIMUM_ELEVATION_BRIGHTNESS_ADJUSTMENT;
	return heightOffsetMeters < 0 ? 1 - adjustment : 1 + adjustment;
}

/** Resolve one elevation-shaded category color into a Canvas-compatible straight-alpha fill. */
export function mapBlipFillStyle(
	category: MapBlipCategory,
	heightOffsetMeters: number,
	environment: MapEnvironment,
): string {
	const color = normalizedRgbaColor(MAP_BLIP_FILL_COLORS[category]);
	const brightness = mapBlipBrightness(heightOffsetMeters, environment);
	return `rgba(${mapBlipChannelByte(color.red, brightness)}, ${mapBlipChannelByte(color.green, brightness)}, ${mapBlipChannelByte(color.blue, brightness)}, ${color.alpha})`;
}

function mapBlipChannelByte(channel: number, brightness: number): number {
	return Math.round(Math.min(channel * brightness, 1) * 255);
}

/** Validate a hand-authored fractional tuning value once when the map adapter is initialized. */
function unitInterval(name: string, value: number): number {
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new Error(
			`${name} must be finite and within [0, 1]; received ${value}.`,
		);
	}
	return value;
}

export const MAP_DEFAULT_VIEW_DIAMETERS =
	MAP_TUNING.zoom.defaultViewDiameterMeters;
export const MAP_MINIMUM_VIEW_DIAMETER =
	MAP_TUNING.zoom.minimumViewDiameterMeters;
export const MAP_MAXIMUM_VIEW_DIAMETER =
	MAP_TUNING.zoom.maximumViewDiameterMeters;
