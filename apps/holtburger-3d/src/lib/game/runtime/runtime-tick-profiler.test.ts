import { describe, expect, it } from "vitest";
import {
	RuntimeTickProfiler,
	type RuntimeTickTimings,
} from "./runtime-tick-profiler";

function timings(scale: number): RuntimeTickTimings {
	return {
		animationAdvanceMs: scale * 3,
		frameCompletionMs: scale * 7,
		particleAdvanceMs: scale * 2,
		particleCohortMs: scale * 5,
		presentationPublishMs: scale * 4,
		renderMs: scale * 6,
		scriptAdvanceMs: scale,
		totalMs: scale * 28,
	};
}

describe("RuntimeTickProfiler", () => {
	it("reports nothing before the first tick rather than zeros", () => {
		// Zeros would read as "measured, and everything is free" instead of "not measured yet".
		expect(new RuntimeTickProfiler().getProfile()).toBeNull();
	});

	it("means every phase across the retained window", () => {
		const profiler = new RuntimeTickProfiler();
		profiler.record(timings(1));
		profiler.record(timings(3));

		const profile = profiler.getProfile();

		expect(profile?.sampleCount).toBe(2);
		expect(profile?.latest).toEqual(timings(3));
		expect(profile?.mean).toEqual(timings(2));
	});

	it("drops the oldest sample once the window is full", () => {
		const profiler = new RuntimeTickProfiler();
		// One outlier followed by a full window of a steady value: if the outlier were retained the
		// mean would still carry it.
		profiler.record(timings(1000));
		for (let index = 0; index < 60; index += 1) profiler.record(timings(2));

		const profile = profiler.getProfile();

		expect(profile?.sampleCount).toBe(60);
		expect(profile?.mean).toEqual(timings(2));
	});
});
