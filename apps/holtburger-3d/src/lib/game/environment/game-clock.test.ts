import { describe, expect, it } from "vitest";
import { quantizeDayFraction, resolveDayFraction } from "./game-clock";

const DAY_LENGTH = 1_000;
/** A tick that divides the day into exact binary fractions, so boundaries land where intended. */
const TICK = 125;

describe("resolveDayFraction", () => {
	it("advances continuously through the day as time elapses", () => {
		expect(resolveDayFraction(0, DAY_LENGTH)).toBe(0);
		expect(resolveDayFraction(500, DAY_LENGTH)).toBeCloseTo(0.5);
		expect(resolveDayFraction(499, DAY_LENGTH)).not.toBe(
			resolveDayFraction(500, DAY_LENGTH),
		);
	});

	it("wraps across day boundaries without ever reaching one", () => {
		expect(resolveDayFraction(DAY_LENGTH, DAY_LENGTH)).toBe(0);
		const late = resolveDayFraction(DAY_LENGTH * 3 - TICK, DAY_LENGTH);
		expect(late).toBeGreaterThan(0);
		expect(late).toBeLessThan(1);
	});

	it("rejects inputs that cannot describe a clock", () => {
		expect(() => resolveDayFraction(0, 0)).toThrow("day length");
		expect(() => resolveDayFraction(-1, DAY_LENGTH)).toThrow("non-negative");
	});
});

describe("quantizeDayFraction", () => {
	/** Retail samples each domain on its authored tick, so the fraction steps rather than drifts. */
	it("holds steady between ticks and steps at each boundary", () => {
		const atTick = quantizeDayFraction(0.3, TICK, DAY_LENGTH);
		expect(atTick).toBe(0.25);
		expect(quantizeDayFraction(0.374, TICK, DAY_LENGTH)).toBe(atTick);
		expect(quantizeDayFraction(0.375, TICK, DAY_LENGTH)).toBe(0.375);
	});

	it("resolves a finer tick to a finer step", () => {
		expect(quantizeDayFraction(0.3, TICK, DAY_LENGTH)).toBe(0.25);
		expect(quantizeDayFraction(0.3, TICK / 4, DAY_LENGTH)).toBe(0.28125);
	});

	it("collapses a tick at least as long as the day to a single sample", () => {
		expect(quantizeDayFraction(0.7, DAY_LENGTH, DAY_LENGTH)).toBe(0);
		expect(quantizeDayFraction(0.7, DAY_LENGTH * 2, DAY_LENGTH)).toBe(0);
	});

	it("rejects inputs that cannot describe a tick", () => {
		expect(() => quantizeDayFraction(0.5, TICK, 0)).toThrow("day length");
		expect(() => quantizeDayFraction(0.5, 0, DAY_LENGTH)).toThrow("tick size");
		expect(() => quantizeDayFraction(1, TICK, DAY_LENGTH)).toThrow(
			"normalized",
		);
	});
});
