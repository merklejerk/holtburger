import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createFrameRateSampler,
	type FrameRateSample,
} from "./frame-rate-sampler";

function frame(timeMs: number, workMs: number): FrameRateSample {
	return {
		animationFrameTimeMs: timeMs,
		startedAtMs: timeMs,
		workMs,
	};
}

afterEach(() => vi.restoreAllMocks());

describe("frame-rate sampler", () => {
	it("reports observed and uncapped frame rates without reactive frame writes", () => {
		const sampler = createFrameRateSampler(1_000);

		expect(sampler.readFrameRates()).toBeNull();
		sampler.recordFrame(frame(1_000, 5));
		sampler.recordFrame(frame(1_016, 5));

		const rates = sampler.readFrameRates();
		expect(rates?.capped).toBeCloseTo(62.5);
		expect(rates?.uncapped).toBeCloseTo(200);
	});

	it("charges callback delay beyond the learned refresh interval to uncapped capacity", () => {
		const sampler = createFrameRateSampler(0.001);

		sampler.recordFrame(frame(0, 5));
		sampler.recordFrame(frame(16, 5));
		sampler.recordFrame(frame(48, 5));

		const rates = sampler.readFrameRates();
		expect(rates?.capped).toBeCloseTo(31.25);
		expect(rates?.uncapped).toBeCloseTo(1_000 / 21);
	});

	it("does not mistake a bunched callback start for a faster display", () => {
		const sampler = createFrameRateSampler(0.001);

		sampler.recordFrame(frame(0, 5));
		sampler.recordFrame({
			animationFrameTimeMs: 16,
			startedAtMs: 26,
			workMs: 5,
		});
		sampler.recordFrame({
			animationFrameTimeMs: 32,
			startedAtMs: 32,
			workMs: 5,
		});
		sampler.recordFrame(frame(48, 5));

		const rates = sampler.readFrameRates();
		expect(rates?.capped).toBeCloseTo(62.5);
		expect(rates?.uncapped).toBeCloseTo(200);
	});

	it("never estimates less capacity than the observed cadence", () => {
		const sampler = createFrameRateSampler(0.001);

		sampler.recordFrame(frame(0, 20));
		sampler.recordFrame(frame(16, 20));
		sampler.recordFrame(frame(48, 20));

		const rates = sampler.readFrameRates();
		expect(rates?.uncapped).toBe(rates?.capped);
	});

	it.each([
		["every refresh", 1],
		["every second refresh", 2],
	])("reports jittery delivered cadence at %s", (_label, refreshStride) => {
		const displayIntervalMs = 10;
		const callbackDelayMs = displayIntervalMs / 2;
		const sampler = createFrameRateSampler(1_000);
		for (let index = 0; index <= 2_000; index += 1) {
			const animationFrameTimeMs = index * displayIntervalMs * refreshStride;
			sampler.recordFrame({
				animationFrameTimeMs,
				startedAtMs:
					animationFrameTimeMs + (index % 2 === 0 ? 0 : callbackDelayMs),
				workMs: 1,
			});
		}

		expect(sampler.readFrameRates()?.capped).toBeCloseTo(
			1_000 / (displayIntervalMs * refreshStride),
			0,
		);
	});

	it.each([
		{ animationFrameTimeMs: 16, startedAtMs: 20, workMs: 0 },
		{ animationFrameTimeMs: 20, startedAtMs: 16, workMs: 0 },
		frame(16, 0),
	])(
		"waits for measurable elapsed time after equal timestamps: %j",
		(sample) => {
			const sampler = createFrameRateSampler(0.001);
			sampler.recordFrame(frame(0, 5));
			sampler.recordFrame(frame(16, 5));
			const previousRates = sampler.readFrameRates();
			sampler.recordFrame(sample);
			expect(sampler.readFrameRates()).toEqual(previousRates);
			sampler.recordFrame(frame(32, 5));
			expect(sampler.readFrameRates()?.capped).toBeCloseTo(62.5);
			expect(sampler.readFrameRates()?.uncapped).toBeCloseTo(200);
		},
	);

	it.each([
		{ animationFrameTimeMs: 15, startedAtMs: 20, workMs: 5 },
		{ animationFrameTimeMs: 20, startedAtMs: 15, workMs: 5 },
		frame(0, 5),
	])("relearns cadence after a clock regression: %j", (sample) => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const sampler = createFrameRateSampler(0.001);
		sampler.recordFrame(frame(0, 5));
		sampler.recordFrame(frame(16, 5));
		sampler.recordFrame(sample);
		expect(sampler.readFrameRates()).toBeNull();
		sampler.recordFrame({
			animationFrameTimeMs: sample.animationFrameTimeMs + 32,
			startedAtMs: sample.startedAtMs + 32,
			workMs: 5,
		});
		expect(sampler.readFrameRates()?.capped).toBeCloseTo(31.25);
		expect(sampler.readFrameRates()?.uncapped).toBeCloseTo(200);
	});

	it.each([
		{ animationFrameTimeMs: Number.NaN, startedAtMs: 32, workMs: 5 },
		{
			animationFrameTimeMs: 32,
			startedAtMs: Number.POSITIVE_INFINITY,
			workMs: 5,
		},
		frame(32, Number.NaN),
		frame(32, -1),
	])("recovers from an invalid runtime sample: %j", (sample) => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const sampler = createFrameRateSampler(0.001);
		sampler.recordFrame(frame(0, 5));
		sampler.recordFrame(frame(16, 5));
		sampler.recordFrame(sample);
		expect(sampler.readFrameRates()).toBeNull();
		sampler.recordFrame(frame(64, 5));
		expect(sampler.readFrameRates()).toBeNull();
		sampler.recordFrame(frame(96, 5));
		expect(sampler.readFrameRates()?.capped).toBeCloseTo(31.25);
		expect(sampler.readFrameRates()?.uncapped).toBeCloseTo(200);
	});

	it("rejects invalid configuration", () => {
		expect(() => createFrameRateSampler(Number.NaN)).toThrow(/must be finite/);
		expect(() => createFrameRateSampler(0)).toThrow(/must be positive/);
	});
});
