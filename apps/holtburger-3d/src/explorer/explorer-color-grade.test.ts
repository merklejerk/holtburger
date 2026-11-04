import { describe, expect, it } from "vitest";
import {
	DEFAULT_COLOR_GRADE_PARAMETERS,
	MINIMUM_CONTROL_POINT_SEPARATION,
	createColorGradeParameters,
	type ColorGradeCurve,
} from "../lib/game/renderer/color-grade-policy";
import {
	COLOR_GRADE_CURVE_CHANNELS,
	addControlPoint,
	findControlPointAt,
	moveControlPoint,
	removeControlPoint,
	serializeColorGradeTuningFragment,
	withCurve,
} from "./explorer-color-grade";

const IDENTITY_CURVE: ColorGradeCurve = [
	{ x: 0, y: 0 },
	{ x: 1, y: 1 },
];

/** Every editor result must survive the same validator the renderer applies. */
function expectValid(curve: ColorGradeCurve): void {
	expect(() =>
		createColorGradeParameters({
			...DEFAULT_COLOR_GRADE_PARAMETERS,
			curves: withCurve(DEFAULT_COLOR_GRADE_PARAMETERS.curves, "master", curve),
		}),
	).not.toThrow();
}

describe("control point insertion", () => {
	it("inserts in x-order", () => {
		const curve = addControlPoint(IDENTITY_CURVE, 0.4, 0.7);
		expect(curve.map((point) => point.x)).toEqual([0, 0.4, 1]);
		expect(curve[1].y).toBe(0.7);
		expectValid(curve);
	});

	it("declines a point with no room beside its neighbor", () => {
		const seeded = addControlPoint(IDENTITY_CURVE, 0.5, 0.5);
		const crowded = addControlPoint(
			seeded,
			0.5 + MINIMUM_CONTROL_POINT_SEPARATION / 2,
			0.9,
		);
		expect(crowded).toBe(seeded);
	});

	it("declines a point on top of an endpoint", () => {
		expect(addControlPoint(IDENTITY_CURVE, 0, 0.5)).toBe(IDENTITY_CURVE);
		expect(addControlPoint(IDENTITY_CURVE, 1, 0.5)).toBe(IDENTITY_CURVE);
	});
});

describe("control point removal", () => {
	it("removes an interior point", () => {
		const seeded = addControlPoint(IDENTITY_CURVE, 0.5, 0.2);
		expect(removeControlPoint(seeded, 1).map((point) => point.x)).toEqual([
			0, 1,
		]);
	});

	it("protects both endpoints, which keeps the curve spanning every source level", () => {
		const seeded = addControlPoint(IDENTITY_CURVE, 0.5, 0.2);
		expect(removeControlPoint(seeded, 0)).toBe(seeded);
		expect(removeControlPoint(seeded, seeded.length - 1)).toBe(seeded);
		expectValid(removeControlPoint(seeded, 0));
	});
});

describe("control point dragging", () => {
	it("clamps an interior drag to its neighbors' separation on both sides", () => {
		const curve: ColorGradeCurve = [
			{ x: 0, y: 0 },
			{ x: 0.4, y: 0.4 },
			{ x: 0.6, y: 0.6 },
			{ x: 1, y: 1 },
		];
		const draggedRight = moveControlPoint(curve, 1, 0.95, 0.5);
		expect(draggedRight[1].x).toBeCloseTo(
			0.6 - MINIMUM_CONTROL_POINT_SEPARATION,
			10,
		);
		expectValid(draggedRight);
		const draggedLeft = moveControlPoint(curve, 2, -5, 0.5);
		expect(draggedLeft[2].x).toBeCloseTo(
			0.4 + MINIMUM_CONTROL_POINT_SEPARATION,
			10,
		);
		expectValid(draggedLeft);
	});

	it("pins endpoint x while letting endpoint y lift blacks and clip whites", () => {
		const lifted = moveControlPoint(IDENTITY_CURVE, 0, 0.8, 0.25);
		expect(lifted[0]).toEqual({ x: 0, y: 0.25 });
		const clipped = moveControlPoint(IDENTITY_CURVE, 1, 0.2, 0.75);
		expect(clipped[1]).toEqual({ x: 1, y: 0.75 });
		expectValid(lifted);
		expectValid(clipped);
	});

	it("clamps y into the authored range", () => {
		const curve = moveControlPoint(IDENTITY_CURVE, 0, 0, 5);
		expect(curve[0].y).toBe(1);
		expectValid(curve);
	});

	it("rejects an index the curve does not have", () => {
		expect(() => moveControlPoint(IDENTITY_CURVE, 7, 0.5, 0.5)).toThrow(
			"no control point at index 7",
		);
	});
});

describe("control point hit testing", () => {
	it("finds the nearest point inside the radius", () => {
		const curve = addControlPoint(IDENTITY_CURVE, 0.5, 0.5);
		expect(findControlPointAt(curve, 0.52, 0.52, 0.1)).toBe(1);
	});

	it("returns null when nothing is close enough", () => {
		expect(findControlPointAt(IDENTITY_CURVE, 0.5, 0.5, 0.1)).toBeNull();
	});
});

describe("tuning fragment serialization", () => {
	it("emits every channel and round-trips through the validator", () => {
		const parameters = {
			...DEFAULT_COLOR_GRADE_PARAMETERS,
			temperature: 0.30000000000000004,
			saturation: 1.25,
			curves: withCurve(
				DEFAULT_COLOR_GRADE_PARAMETERS.curves,
				"master",
				addControlPoint(IDENTITY_CURVE, 0.5, 0.42),
			),
		};
		const fragment = serializeColorGradeTuningFragment(parameters, true);
		expect(fragment).toContain("colorGrade: {");
		expect(fragment).toContain("enabledByDefault: true,");
		for (const channel of COLOR_GRADE_CURVE_CHANNELS) {
			expect(fragment).toContain(`${channel}: [`);
		}
		// Slider drags leave float noise; source should not inherit it.
		expect(fragment).toContain("temperature: 0.3,");
		expect(fragment).toContain("{ x: 0.5, y: 0.42 },");
	});

	it("emits the disabled default without claiming it is on", () => {
		const fragment = serializeColorGradeTuningFragment(
			DEFAULT_COLOR_GRADE_PARAMETERS,
			false,
		);
		expect(fragment).toContain("enabledByDefault: false,");
	});
});
