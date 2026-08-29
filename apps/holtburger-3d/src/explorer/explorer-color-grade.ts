import {
	MINIMUM_CONTROL_POINT_SEPARATION,
	type ColorGradeControlPoint,
	type ColorGradeCurve,
	type ColorGradeCurves,
	type ColorGradeParameters,
} from "../lib/game/renderer/color-grade-policy";

/**
 * Which curve the editor is currently showing.
 *
 * Ordered as the panel's tabs are, with the master tone curve first because it is the one an
 * author reaches for before any per-channel work.
 */
export const COLOR_GRADE_CURVE_CHANNELS = [
	"master",
	"red",
	"green",
	"blue",
] as const;

export type ColorGradeCurveChannel =
	(typeof COLOR_GRADE_CURVE_CHANNELS)[number];

/** Decimal places retained when a tuned look is emitted as source. */
const SERIALIZED_PRECISION = 4;

function clampUnit(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/**
 * Insert one control point, or return the curve unchanged when nothing fits.
 *
 * Declining is the honest answer to a click that lands inside an occupied gap: it is an
 * ordinary gesture that happens to have nowhere to go, not a failure to report. The endpoints
 * already pin x = 0 and x = 1, so only the interior accepts new points.
 */
export function addControlPoint(
	curve: ColorGradeCurve,
	x: number,
	y: number,
): ColorGradeCurve {
	const targetX = clampUnit(x);
	let index = 0;
	while (index < curve.length && curve[index].x < targetX) index += 1;
	const before = index > 0 ? curve[index - 1] : null;
	const after = index < curve.length ? curve[index] : null;
	if (!before || !after) return curve;
	if (
		targetX - before.x < MINIMUM_CONTROL_POINT_SEPARATION ||
		after.x - targetX < MINIMUM_CONTROL_POINT_SEPARATION
	) {
		return curve;
	}
	return [
		...curve.slice(0, index),
		{ x: targetX, y: clampUnit(y) },
		...curve.slice(index),
	];
}

/**
 * Remove one control point, or return the curve unchanged for a protected one.
 *
 * The first and last points define the curve's [0, 1] span, which the policy requires, so they
 * are not removable. Protecting them also keeps the two-point floor without a separate check.
 */
export function removeControlPoint(
	curve: ColorGradeCurve,
	index: number,
): ColorGradeCurve {
	if (index <= 0 || index >= curve.length - 1) return curve;
	return [...curve.slice(0, index), ...curve.slice(index + 1)];
}

/**
 * Move one control point within the bounds its neighbors leave it.
 *
 * The x-clamp keeps the shared minimum separation on both sides, so a drag can never author a
 * curve `createColorGradeParameters` would reject. Endpoints keep their pinned x and drag only
 * in y, which is how a curve editor lifts blacks or clips whites.
 */
export function moveControlPoint(
	curve: ColorGradeCurve,
	index: number,
	x: number,
	y: number,
): ColorGradeCurve {
	if (index < 0 || index >= curve.length) {
		throw new Error(
			`Color grade curve has no control point at index ${index}.`,
		);
	}
	const isFirst = index === 0;
	const isLast = index === curve.length - 1;
	const movedX = isFirst
		? 0
		: isLast
			? 1
			: Math.min(
					curve[index + 1].x - MINIMUM_CONTROL_POINT_SEPARATION,
					Math.max(
						curve[index - 1].x + MINIMUM_CONTROL_POINT_SEPARATION,
						clampUnit(x),
					),
				);
	const moved: ColorGradeControlPoint = { x: movedX, y: clampUnit(y) };
	return curve.map((point, at) => (at === index ? moved : point));
}

/** Index of the control point nearest a normalized point within `radius`, or null. */
export function findControlPointAt(
	curve: ColorGradeCurve,
	x: number,
	y: number,
	radius: number,
): number | null {
	let bestIndex: number | null = null;
	let bestDistanceSquared = radius * radius;
	for (let index = 0; index < curve.length; index += 1) {
		const point = curve[index];
		const distanceSquared =
			(point.x - x) * (point.x - x) + (point.y - y) * (point.y - y);
		if (distanceSquared <= bestDistanceSquared) {
			bestDistanceSquared = distanceSquared;
			bestIndex = index;
		}
	}
	return bestIndex;
}

/** Replace one channel's curve, leaving the other three as they were. */
export function withCurve(
	curves: ColorGradeCurves,
	channel: ColorGradeCurveChannel,
	curve: ColorGradeCurve,
): ColorGradeCurves {
	return { ...curves, [channel]: curve };
}

/**
 * Emit a tuned look as the `colorGrade` property of `EXPLORER_TUNING_OVERRIDES`.
 *
 * Formatted to match the surrounding file so a paste needs no reformatting, and shaped as the
 * whole property so replacing it leaves the explanatory comment above it intact.
 */
export function serializeColorGradeTuningFragment(
	parameters: ColorGradeParameters,
	enabledByDefault: boolean,
): string {
	const lines = [
		"\tcolorGrade: {",
		`\t\tenabledByDefault: ${enabledByDefault},`,
		"\t\tparameters: {",
		`\t\t\ttemperature: ${formatNumber(parameters.temperature)},`,
		`\t\t\ttint: ${formatNumber(parameters.tint)},`,
		`\t\t\tsaturation: ${formatNumber(parameters.saturation)},`,
		"\t\t\tcurves: {",
	];
	for (const channel of COLOR_GRADE_CURVE_CHANNELS) {
		lines.push(`\t\t\t\t${channel}: [`);
		for (const point of parameters.curves[channel]) {
			lines.push(
				`\t\t\t\t\t{ x: ${formatNumber(point.x)}, y: ${formatNumber(point.y)} },`,
			);
		}
		lines.push("\t\t\t\t],");
	}
	lines.push("\t\t\t},", "\t\t},", "\t},");
	return lines.join("\n");
}

/** Render a tuned value without the float noise a slider drag leaves behind. */
function formatNumber(value: number): string {
	return String(Number(value.toFixed(SERIALIZED_PRECISION)));
}
