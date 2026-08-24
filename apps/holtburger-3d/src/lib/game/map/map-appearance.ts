import { FRONTEND_TUNING } from "../../frontend-tuning";

/**
 * GPU-ready form of the overhead map's tuning policy.
 *
 * Deliberately holds no values: every colour and threshold is authored in `frontend-tuning.ts`
 * alongside the rest of the frontend's knobs, and this module only converts them into the shapes
 * WebGL and the canvas want, once at module scope rather than per frame. Change appearance there,
 * not here.
 */
const MAP_TUNING = FRONTEND_TUNING.map;

/** One authored colour as a GL uniform payload. */
function colorVector(color: {
	readonly red: number;
	readonly green: number;
	readonly blue: number;
}): Float32Array {
	return new Float32Array([color.red, color.green, color.blue]);
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
export const MAP_STEEP_COLOR = colorVector(MAP_TUNING.colors.steep);
export const MAP_STEEP_HATCH_PERIOD_PIXELS =
	MAP_TUNING.colors.steepHatchPeriodPixels;
export const MAP_STEEP_HATCH_STRENGTH = MAP_TUNING.colors.steepHatchStrength;
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
export const MAP_VOID_COLOR: readonly [number, number, number] = [
	MAP_TUNING.colors.void.red,
	MAP_TUNING.colors.void.green,
	MAP_TUNING.colors.void.blue,
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

export const MAP_BLIP_COLORS = MAP_TUNING.blips.colorsByRadarColor;
export const MAP_BLIP_RADIUS_PIXELS = MAP_TUNING.blips.radiusPixels;

export const MAP_DEFAULT_VIEW_DIAMETER =
	MAP_TUNING.zoom.defaultViewDiameterMeters;
export const MAP_MINIMUM_VIEW_DIAMETER =
	MAP_TUNING.zoom.minimumViewDiameterMeters;
export const MAP_MAXIMUM_VIEW_DIAMETER =
	MAP_TUNING.zoom.maximumViewDiameterMeters;
