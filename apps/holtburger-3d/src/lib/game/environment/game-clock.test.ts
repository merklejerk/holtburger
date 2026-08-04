import { describe, expect, it } from "vitest";
import { resolveClockDayFraction } from "./game-clock";

const DAY_LENGTH = 1_000;
const LIGHT_TICK = 100;

describe("resolveClockDayFraction", () => {
	it("advances through the day as time elapses", () => {
		expect(resolveClockDayFraction(0, DAY_LENGTH, LIGHT_TICK)).toBe(0);
		expect(resolveClockDayFraction(500, DAY_LENGTH, LIGHT_TICK)).toBeCloseTo(
			0.5,
		);
	});

	/** Retail resolves lighting only on the light tick, so the fraction steps rather than drifts. */
	it("holds steady between light ticks and steps at each boundary", () => {
		const atTick = resolveClockDayFraction(200, DAY_LENGTH, LIGHT_TICK);
		expect(resolveClockDayFraction(299, DAY_LENGTH, LIGHT_TICK)).toBe(atTick);
		expect(resolveClockDayFraction(300, DAY_LENGTH, LIGHT_TICK)).not.toBe(
			atTick,
		);
	});

	it("wraps across day boundaries without ever reaching one", () => {
		expect(resolveClockDayFraction(DAY_LENGTH, DAY_LENGTH, LIGHT_TICK)).toBe(0);
		const late = resolveClockDayFraction(
			DAY_LENGTH * 3 - LIGHT_TICK,
			DAY_LENGTH,
			LIGHT_TICK,
		);
		expect(late).toBeGreaterThan(0);
		expect(late).toBeLessThan(1);
	});

	it("rejects region data that cannot describe a clock", () => {
		expect(() => resolveClockDayFraction(0, 0, LIGHT_TICK)).toThrow(
			"day length",
		);
		expect(() => resolveClockDayFraction(0, DAY_LENGTH, 0)).toThrow(
			"light tick",
		);
		expect(() => resolveClockDayFraction(-1, DAY_LENGTH, LIGHT_TICK)).toThrow(
			"non-negative",
		);
	});
});
