import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import { relativeLuminance } from "../environment/scene-lighting";

/**
 * One authored control point on a grading curve.
 *
 * Both axes are normalized display values in [0, 1]: `x` is the incoming channel level and `y` is
 * what it becomes. This is display-referred throughout — the scene reaching presentation is already
 * clamped LDR, so there is no headroom above 1 for a curve to recover.
 */
export interface ColorGradeControlPoint {
	readonly x: number;
	readonly y: number;
}

/** Authored transfer curve, evaluated with monotone cubic interpolation between its points. */
export type ColorGradeCurve = readonly ColorGradeControlPoint[];

/**
 * The four curves one grade authors.
 *
 * `master` applies first and the per-channel curves apply to its result, so the baked strip holds
 * `channel(master(x))`. That ordering is what makes the master curve read as a tone curve and the
 * channel curves as color adjustments on top of it.
 */
export interface ColorGradeCurves {
	readonly master: ColorGradeCurve;
	readonly red: ColorGradeCurve;
	readonly green: ColorGradeCurve;
	readonly blue: ColorGradeCurve;
}

/**
 * One complete authored look.
 *
 * Split between curves, which the shader samples from a baked strip, and non-separable ops, which
 * mix channels and therefore cannot be expressed as per-channel curves at all.
 */
export interface ColorGradeParameters {
	/** Warm/cool white balance in [-1, 1]. Positive warms (red up, blue down). */
	readonly temperature: number;
	/** Green/magenta white balance in [-1, 1]. Positive shifts toward magenta. */
	readonly tint: number;
	/** Saturation multiplier about Rec. 601 luma; 1 preserves the source, 0 is monochrome. */
	readonly saturation: number;
	readonly curves: ColorGradeCurves;
}

/**
 * Complete optional grade choice snapshotted with every frame, mirroring ambient occlusion.
 *
 * `parameters` is compared by reference to decide when the shader's baked strip is stale, so
 * producers must publish a new object when a value changes rather than mutating in place.
 */
export interface ColorGradeSettings {
	readonly enabled: boolean;
	readonly parameters: ColorGradeParameters;
}

/** White-balance multipliers applied per channel before the curves. */
export interface ColorGradeChannelGains {
	readonly red: number;
	readonly green: number;
	readonly blue: number;
}

/** Entries in the baked curve strip; one per distinct 8-bit source level. */
export const COLOR_GRADE_STRIP_ENTRY_COUNT = 256;

/** Components per baked entry. RGBA so the buffer uploads as texels without a repack. */
export const COLOR_GRADE_STRIP_COMPONENT_COUNT = 4;

/** Total floats in one baked strip buffer. */
export const COLOR_GRADE_STRIP_LENGTH =
	COLOR_GRADE_STRIP_ENTRY_COUNT * COLOR_GRADE_STRIP_COMPONENT_COUNT;

/**
 * Smallest x-gap allowed between neighboring control points.
 *
 * Shared with the Explorer curve editor so a drag physically cannot land on a neighbor's x and
 * produce a curve this module would then reject.
 */
export const MINIMUM_CONTROL_POINT_SEPARATION = 1 / 512;

/** Largest accepted saturation multiplier; beyond this the result is chroma noise, not a look. */
export const MAXIMUM_SATURATION = 4;

/**
 * Channel swing at full temperature or tint deflection, before luma normalization.
 *
 * Sized so both axes at full deflection still leave every channel gain comfortably positive
 * (1 - 2 × swing = 0.4). A degenerate zero-gain channel would discard color the curves could
 * otherwise still shape.
 */
const WHITE_BALANCE_CHANNEL_SWING = 0.3;

/**
 * A curve's control points with its monotone tangents precomputed.
 *
 * Retained as a unit because deriving tangents is O(points) and both consumers evaluate the same
 * curve many times: the bake takes 256 samples, and the Explorer editor samples it again to draw
 * the curve's path.
 */
export interface MonotoneSpline {
	readonly points: ColorGradeCurve;
	readonly tangents: readonly number[];
}

/** Validate and retain one complete authored look. */
export function createColorGradeParameters(
	parameters: ColorGradeParameters,
): ColorGradeParameters {
	if (
		!Number.isFinite(parameters.temperature) ||
		Math.abs(parameters.temperature) > 1
	) {
		throw new Error(
			"Color grade temperature must be finite and within [-1, 1].",
		);
	}
	if (!Number.isFinite(parameters.tint) || Math.abs(parameters.tint) > 1) {
		throw new Error("Color grade tint must be finite and within [-1, 1].");
	}
	if (
		!Number.isFinite(parameters.saturation) ||
		parameters.saturation < 0 ||
		parameters.saturation > MAXIMUM_SATURATION
	) {
		throw new Error(
			`Color grade saturation must be finite and within [0, ${MAXIMUM_SATURATION}].`,
		);
	}
	validateColorGradeCurve(parameters.curves.master, "master");
	validateColorGradeCurve(parameters.curves.red, "red");
	validateColorGradeCurve(parameters.curves.green, "green");
	validateColorGradeCurve(parameters.curves.blue, "blue");
	return parameters;
}

function validateColorGradeCurve(curve: ColorGradeCurve, name: string): void {
	if (curve.length < 2) {
		throw new Error(
			`Color grade ${name} curve requires at least two control points.`,
		);
	}
	for (const point of curve) {
		if (
			!Number.isFinite(point.x) ||
			!Number.isFinite(point.y) ||
			point.x < 0 ||
			point.x > 1 ||
			point.y < 0 ||
			point.y > 1
		) {
			throw new Error(
				`Color grade ${name} curve control points must be finite and within [0, 1].`,
			);
		}
	}
	for (let index = 1; index < curve.length; index += 1) {
		if (
			curve[index].x - curve[index - 1].x <
			MINIMUM_CONTROL_POINT_SEPARATION
		) {
			throw new Error(
				`Color grade ${name} curve control points must increase in x by at least ${MINIMUM_CONTROL_POINT_SEPARATION}.`,
			);
		}
	}
	if (curve[0].x !== 0 || curve[curve.length - 1].x !== 1) {
		throw new Error(
			`Color grade ${name} curve must span x from 0 to 1, so every source level is defined.`,
		);
	}
}

/**
 * Derive Fritsch-Carlson tangents so the curve never overshoots or inverts between its points.
 *
 * The guarantee matters more than the smoothness: a natural cubic through the same points can
 * ring past them, which reads as an inverted tone band the author never asked for.
 */
export function createMonotoneSpline(curve: ColorGradeCurve): MonotoneSpline {
	const count = curve.length;
	const secants = new Array<number>(count - 1);
	for (let index = 0; index < count - 1; index += 1) {
		secants[index] =
			(curve[index + 1].y - curve[index].y) /
			(curve[index + 1].x - curve[index].x);
	}
	const tangents = new Array<number>(count);
	tangents[0] = secants[0];
	tangents[count - 1] = secants[count - 2];
	for (let index = 1; index < count - 1; index += 1) {
		// A sign change means this point is a local extremum; a zero tangent pins the curve to it
		// instead of letting an averaged slope carry the curve past its own control point.
		tangents[index] =
			secants[index - 1] * secants[index] <= 0
				? 0
				: (secants[index - 1] + secants[index]) / 2;
	}
	for (let index = 0; index < count - 1; index += 1) {
		const secant = secants[index];
		if (secant === 0) {
			tangents[index] = 0;
			tangents[index + 1] = 0;
			continue;
		}
		const alpha = tangents[index] / secant;
		const beta = tangents[index + 1] / secant;
		const magnitude = alpha * alpha + beta * beta;
		// Outside the radius-3 circle the Hermite segment overshoots; projecting back onto it is
		// Fritsch-Carlson's monotonicity condition.
		if (magnitude > 9) {
			const scale = 3 / Math.sqrt(magnitude);
			tangents[index] = scale * alpha * secant;
			tangents[index + 1] = scale * beta * secant;
		}
	}
	return { points: curve, tangents };
}

/** Evaluate one prepared curve at a source level, clamped to the curve's [0, 1] domain. */
export function evaluateMonotoneSpline(
	spline: MonotoneSpline,
	source: number,
): number {
	const points = spline.points;
	const clamped = Math.min(1, Math.max(0, source));
	let index = 0;
	while (index < points.length - 2 && points[index + 1].x < clamped) {
		index += 1;
	}
	const left = points[index];
	const right = points[index + 1];
	const width = right.x - left.x;
	const t = (clamped - left.x) / width;
	const tSquared = t * t;
	const tCubed = tSquared * t;
	return (
		(2 * tCubed - 3 * tSquared + 1) * left.y +
		(tCubed - 2 * tSquared + t) * width * spline.tangents[index] +
		(-2 * tCubed + 3 * tSquared) * right.y +
		(tCubed - tSquared) * width * spline.tangents[index + 1]
	);
}

/**
 * Bake `channel(master(x))` for every source level into a caller-owned RGBA buffer.
 *
 * Sampling the composition rather than evaluating two splines per fragment is what keeps the
 * shader cost one texture fetch regardless of how many control points the author drags around.
 */
export function bakeColorGradeStrip(
	parameters: ColorGradeParameters,
	out: Float32Array,
): void {
	if (out.length !== COLOR_GRADE_STRIP_LENGTH) {
		throw new Error(
			`Color grade strip buffer must hold exactly ${COLOR_GRADE_STRIP_LENGTH} floats.`,
		);
	}
	const master = createMonotoneSpline(parameters.curves.master);
	const red = createMonotoneSpline(parameters.curves.red);
	const green = createMonotoneSpline(parameters.curves.green);
	const blue = createMonotoneSpline(parameters.curves.blue);
	for (let entry = 0; entry < COLOR_GRADE_STRIP_ENTRY_COUNT; entry += 1) {
		const source = entry / (COLOR_GRADE_STRIP_ENTRY_COUNT - 1);
		const tone = evaluateMonotoneSpline(master, source);
		const offset = entry * COLOR_GRADE_STRIP_COMPONENT_COUNT;
		out[offset] = evaluateMonotoneSpline(red, tone);
		out[offset + 1] = evaluateMonotoneSpline(green, tone);
		out[offset + 2] = evaluateMonotoneSpline(blue, tone);
		out[offset + 3] = 1;
	}
}

/**
 * Resolve white-balance axes into per-channel gains that preserve luma.
 *
 * Normalizing by the gains' own luma keeps this a color decision: without it, warming an image
 * also brightens it, and the author ends up fighting the tone curve to undo an exposure change
 * they never asked for.
 */
export function temperatureTintToGains(
	temperature: number,
	tint: number,
): ColorGradeChannelGains {
	const red = 1 + (temperature + tint) * WHITE_BALANCE_CHANNEL_SWING;
	const green = 1 - tint * WHITE_BALANCE_CHANNEL_SWING;
	const blue = 1 + (tint - temperature) * WHITE_BALANCE_CHANNEL_SWING;
	const luma = relativeLuminance(red, green, blue);
	return { red: red / luma, green: green / luma, blue: blue / luma };
}

/** Validated shared look used by the frame-settings baseline until a mode overrides it. */
export const DEFAULT_COLOR_GRADE_PARAMETERS = createColorGradeParameters(
	SHARED_FRONTEND_TUNING.rendering.colorGrade.parameters,
);
