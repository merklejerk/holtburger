import { describe, expect, it } from "vitest";

import { createFrameRateSampler } from "./frame-rate-sampler";

describe("frame-rate sampler", () => {
	it("reports uncapped frame throughput without requiring reactive frame writes", () => {
		const sampler = createFrameRateSampler(1_000);

		expect(sampler.readFramesPerSecond()).toBeNull();
		sampler.recordFrameWork(5, 1_000);
		sampler.recordFrameWork(5, 1_016);

		expect(sampler.readFramesPerSecond()).toBeCloseTo(200);
	});

	it("rejects invalid configuration, duration, and timestamps", () => {
		expect(() => createFrameRateSampler(0)).toThrow(/positive finite/);
		const sampler = createFrameRateSampler(1_000);
		expect(() => sampler.recordFrameWork(-1, 10)).toThrow(/non-negative/);
		sampler.recordFrameWork(5, 10);
		expect(() => sampler.recordFrameWork(5, 9)).toThrow(/move backwards/);
	});
});
