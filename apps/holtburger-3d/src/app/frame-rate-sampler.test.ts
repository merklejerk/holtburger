import { describe, expect, it } from "vitest";

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

	it("rejects invalid configuration, duration, and timestamps", () => {
		expect(() => createFrameRateSampler(Number.NaN)).toThrow(/must be finite/);
		expect(() => createFrameRateSampler(0)).toThrow(/must be positive/);
		const sampler = createFrameRateSampler(1_000);
		expect(() =>
			sampler.recordFrame({
				animationFrameTimeMs: Number.NaN,
				startedAtMs: 10,
				workMs: 1,
			}),
		).toThrow(/Animation-frame timestamp must be finite/);
		expect(() =>
			sampler.recordFrame({
				animationFrameTimeMs: 10,
				startedAtMs: Number.NaN,
				workMs: 1,
			}),
		).toThrow(/Frame start timestamp must be finite/);
		expect(() => sampler.recordFrame(frame(10, Number.NaN))).toThrow(
			/Frame work duration must be finite/,
		);
		expect(() => sampler.recordFrame(frame(10, -1))).toThrow(
			/Frame work duration must be non-negative/,
		);
		sampler.recordFrame(frame(10, 5));
		expect(() =>
			sampler.recordFrame({
				animationFrameTimeMs: 10,
				startedAtMs: 11,
				workMs: 5,
			}),
		).toThrow(/Animation-frame timestamps must increase/);
		expect(() =>
			sampler.recordFrame({
				animationFrameTimeMs: 11,
				startedAtMs: 10,
				workMs: 5,
			}),
		).toThrow(/Frame start timestamps must increase/);
	});
});
