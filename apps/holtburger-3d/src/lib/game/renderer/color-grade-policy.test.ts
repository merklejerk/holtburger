import { describe, expect, it } from "vitest";
import { REC_601_LUMA_WEIGHTS } from "../environment/scene-lighting";
import {
	COLOR_GRADE_STRIP_COMPONENT_COUNT,
	COLOR_GRADE_STRIP_ENTRY_COUNT,
	COLOR_GRADE_STRIP_LENGTH,
	DEFAULT_COLOR_GRADE_PARAMETERS,
	MINIMUM_CONTROL_POINT_SEPARATION,
	bakeColorGradeStrip,
	createColorGradeParameters,
	createMonotoneSpline,
	evaluateMonotoneSpline,
	temperatureTintToGains,
	type ColorGradeCurve,
	type ColorGradeParameters,
} from "./color-grade-policy";

const IDENTITY_CURVE: ColorGradeCurve = [
	{ x: 0, y: 0 },
	{ x: 1, y: 1 },
];

/**
 * An explicitly neutral look.
 *
 * Deliberately not `DEFAULT_COLOR_GRADE_PARAMETERS`: the shipped default is meant to be replaced
 * by a tuned look pasted out of the Explorer, so a test that assumes it is neutral fails the
 * first time the feature is used as intended.
 */
const IDENTITY_PARAMETERS: ColorGradeParameters = {
	temperature: 0,
	tint: 0,
	saturation: 1,
	curves: {
		master: IDENTITY_CURVE,
		red: IDENTITY_CURVE,
		green: IDENTITY_CURVE,
		blue: IDENTITY_CURVE,
	},
};

function parametersWith(
	overrides: Partial<ColorGradeParameters>,
): ColorGradeParameters {
	return { ...DEFAULT_COLOR_GRADE_PARAMETERS, ...overrides };
}

function curvesWith(master: ColorGradeCurve): ColorGradeParameters["curves"] {
	return {
		master,
		red: IDENTITY_CURVE,
		green: IDENTITY_CURVE,
		blue: IDENTITY_CURVE,
	};
}

describe("color grade parameter validation", () => {
	it("rejects white balance outside its authored range", () => {
		expect(() =>
			createColorGradeParameters(parametersWith({ temperature: 1.5 })),
		).toThrow("temperature must be finite");
		expect(() =>
			createColorGradeParameters(parametersWith({ tint: Number.NaN })),
		).toThrow("tint must be finite");
	});

	it("rejects saturation outside its authored range", () => {
		expect(() =>
			createColorGradeParameters(parametersWith({ saturation: -1 })),
		).toThrow("saturation must be finite");
	});

	it("rejects a curve with too few control points", () => {
		expect(() =>
			createColorGradeParameters(
				parametersWith({ curves: curvesWith([{ x: 0, y: 0 }]) }),
			),
		).toThrow("master curve requires at least two control points");
	});

	it("rejects control points outside the normalized domain", () => {
		expect(() =>
			createColorGradeParameters(
				parametersWith({
					curves: curvesWith([
						{ x: 0, y: 0 },
						{ x: 1, y: 1.5 },
					]),
				}),
			),
		).toThrow("master curve control points must be finite");
	});

	it("rejects control points closer than the shared minimum separation", () => {
		expect(() =>
			createColorGradeParameters(
				parametersWith({
					curves: curvesWith([
						{ x: 0, y: 0 },
						{ x: 0.5, y: 0.5 },
						{ x: 0.5 + MINIMUM_CONTROL_POINT_SEPARATION / 2, y: 0.6 },
						{ x: 1, y: 1 },
					]),
				}),
			),
		).toThrow("must increase in x by at least");
	});

	it("rejects a curve that does not span every source level", () => {
		expect(() =>
			createColorGradeParameters(
				parametersWith({
					curves: curvesWith([
						{ x: 0.25, y: 0 },
						{ x: 1, y: 1 },
					]),
				}),
			),
		).toThrow("must span x from 0 to 1");
	});

	it("accepts the shipped defaults", () => {
		expect(() =>
			createColorGradeParameters(DEFAULT_COLOR_GRADE_PARAMETERS),
		).not.toThrow();
	});
});

describe("monotone curve evaluation", () => {
	it("passes exactly through every control point", () => {
		const curve: ColorGradeCurve = [
			{ x: 0, y: 0.1 },
			{ x: 0.3, y: 0.8 },
			{ x: 0.7, y: 0.2 },
			{ x: 1, y: 0.9 },
		];
		const spline = createMonotoneSpline(curve);
		for (const point of curve) {
			expect(evaluateMonotoneSpline(spline, point.x)).toBeCloseTo(point.y, 10);
		}
	});

	it("never overshoots the control points bounding each segment", () => {
		// A steep step followed by a plateau is the classic case where a natural cubic rings
		// past its own control points.
		const spline = createMonotoneSpline([
			{ x: 0, y: 0 },
			{ x: 0.45, y: 0.05 },
			{ x: 0.55, y: 0.95 },
			{ x: 1, y: 1 },
		]);
		for (let step = 0; step <= 1_000; step += 1) {
			const value = evaluateMonotoneSpline(spline, step / 1_000);
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(1);
		}
	});

	it("stays flat between equal control points instead of dipping between them", () => {
		const spline = createMonotoneSpline([
			{ x: 0, y: 0.5 },
			{ x: 0.5, y: 0.5 },
			{ x: 1, y: 1 },
		]);
		expect(evaluateMonotoneSpline(spline, 0.25)).toBeCloseTo(0.5, 10);
	});

	it("clamps evaluation to the curve domain", () => {
		const spline = createMonotoneSpline(IDENTITY_CURVE);
		expect(evaluateMonotoneSpline(spline, -1)).toBeCloseTo(0, 10);
		expect(evaluateMonotoneSpline(spline, 2)).toBeCloseTo(1, 10);
	});
});

describe("color grade strip baking", () => {
	it("bakes identity parameters to an identity ramp", () => {
		const strip = new Float32Array(COLOR_GRADE_STRIP_LENGTH);
		bakeColorGradeStrip(IDENTITY_PARAMETERS, strip);
		for (let entry = 0; entry < COLOR_GRADE_STRIP_ENTRY_COUNT; entry += 1) {
			const expected = entry / (COLOR_GRADE_STRIP_ENTRY_COUNT - 1);
			const offset = entry * COLOR_GRADE_STRIP_COMPONENT_COUNT;
			expect(strip[offset]).toBeCloseTo(expected, 6);
			expect(strip[offset + 1]).toBeCloseTo(expected, 6);
			expect(strip[offset + 2]).toBeCloseTo(expected, 6);
			expect(strip[offset + 3]).toBe(1);
		}
	});

	it("composes the master curve before each channel curve", () => {
		// Two-point curves are exactly linear, so the composed value is unambiguous arithmetic
		// rather than a spline shape: master halves, red lifts by a half and halves.
		// red(master(x)) = 0.5 + x/4, while the reverse order would give 0.25 + x/4.
		const strip = new Float32Array(COLOR_GRADE_STRIP_LENGTH);
		bakeColorGradeStrip(
			{
				...IDENTITY_PARAMETERS,
				curves: {
					master: [
						{ x: 0, y: 0 },
						{ x: 1, y: 0.5 },
					],
					red: [
						{ x: 0, y: 0.5 },
						{ x: 1, y: 1 },
					],
					green: IDENTITY_CURVE,
					blue: IDENTITY_CURVE,
				},
			},
			strip,
		);
		const midEntry = Math.floor((COLOR_GRADE_STRIP_ENTRY_COUNT - 1) / 2);
		const offset = midEntry * COLOR_GRADE_STRIP_COMPONENT_COUNT;
		const source = midEntry / (COLOR_GRADE_STRIP_ENTRY_COUNT - 1);
		expect(strip[offset]).toBeCloseTo(0.5 + source / 4, 6);
		expect(strip[offset + 1]).toBeCloseTo(source / 2, 6);
	});

	it("refuses a buffer that is not exactly one strip", () => {
		expect(() =>
			bakeColorGradeStrip(
				DEFAULT_COLOR_GRADE_PARAMETERS,
				new Float32Array(COLOR_GRADE_STRIP_LENGTH - 1),
			),
		).toThrow("exactly");
	});
});

describe("white balance gains", () => {
	it("leaves neutral white balance at unit gain", () => {
		const gains = temperatureTintToGains(0, 0);
		expect(gains.red).toBeCloseTo(1, 10);
		expect(gains.green).toBeCloseTo(1, 10);
		expect(gains.blue).toBeCloseTo(1, 10);
	});

	it("preserves luma so white balance is not a second exposure control", () => {
		for (const [temperature, tint] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0.6, -0.4],
		]) {
			const gains = temperatureTintToGains(temperature, tint);
			const luma =
				REC_601_LUMA_WEIGHTS.red * gains.red +
				REC_601_LUMA_WEIGHTS.green * gains.green +
				REC_601_LUMA_WEIGHTS.blue * gains.blue;
			expect(luma).toBeCloseTo(1, 10);
		}
	});

	it("warms toward red and cools toward blue", () => {
		const warm = temperatureTintToGains(1, 0);
		expect(warm.red).toBeGreaterThan(warm.blue);
		const cool = temperatureTintToGains(-1, 0);
		expect(cool.blue).toBeGreaterThan(cool.red);
	});

	it("keeps every channel gain positive at full deflection", () => {
		for (const [temperature, tint] of [
			[1, 1],
			[-1, -1],
			[1, -1],
			[-1, 1],
		]) {
			const gains = temperatureTintToGains(temperature, tint);
			expect(gains.red).toBeGreaterThan(0);
			expect(gains.green).toBeGreaterThan(0);
			expect(gains.blue).toBeGreaterThan(0);
		}
	});
});
