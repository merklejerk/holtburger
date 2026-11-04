import { describe, expect, it } from "vitest";
import {
	RUNTIME_TICK_PHASES,
	RuntimeTickProfiler,
	type RuntimeTickPhase,
} from "./runtime-tick-profiler";

/** Drive one tick where every phase costs `perPhase`, using an exact injected clock. */
function tick(
	profiler: RuntimeTickProfiler,
	clock: { now: number },
	perPhase: number,
): void {
	profiler.beginTick();
	for (const phase of RUNTIME_TICK_PHASES) {
		clock.now += perPhase;
		profiler.mark(phase);
	}
	profiler.finishTick();
}

function build(): {
	readonly clock: { now: number };
	readonly profiler: RuntimeTickProfiler;
} {
	const clock = { now: 0 };
	return { clock, profiler: new RuntimeTickProfiler(() => clock.now) };
}

describe("RuntimeTickProfiler", () => {
	it("reports nothing before the first tick rather than zeros", () => {
		// Zeros would read as "measured, and everything is free" instead of "not measured yet".
		expect(build().profiler.getProfile()).toBeNull();
	});

	it("attributes each span to the phase that closed it", () => {
		const { clock, profiler } = build();
		profiler.beginTick();
		clock.now += 5;
		profiler.mark("scriptAdvance");
		clock.now += 2;
		profiler.mark("render");
		clock.now += 1;
		profiler.finishTick();

		const latest = profiler.getProfile()?.latest;

		expect(latest?.scriptAdvance).toBe(5);
		expect(latest?.render).toBe(2);
		// Unmarked phases stay zero, and the trailing span shows as the total's shortfall.
		expect(latest?.particleAdvance).toBe(0);
		expect(latest?.totalMs).toBe(8);
	});

	it("means every phase across the retained window", () => {
		const { clock, profiler } = build();
		tick(profiler, clock, 1);
		tick(profiler, clock, 3);

		const profile = profiler.getProfile();

		expect(profile?.sampleCount).toBe(2);
		for (const phase of RUNTIME_TICK_PHASES) {
			expect(profile?.mean[phase]).toBe(2);
		}
		expect(profile?.mean.totalMs).toBe(2 * RUNTIME_TICK_PHASES.length);
	});

	it("drops the oldest sample once the window is full", () => {
		const { clock, profiler } = build();
		// One outlier, then a full window of a steady value: a retained outlier would still show.
		tick(profiler, clock, 1000);
		for (let index = 0; index < 60; index += 1) tick(profiler, clock, 2);

		const profile = profiler.getProfile();

		expect(profile?.sampleCount).toBe(60);
		for (const phase of RUNTIME_TICK_PHASES) {
			expect(profile?.mean[phase]).toBe(2);
		}
	});

	it("ignores marks outside a tick rather than inventing a span", () => {
		const { clock, profiler } = build();
		clock.now += 100;
		profiler.mark("render" satisfies RuntimeTickPhase);
		profiler.finishTick();

		expect(profiler.getProfile()).toBeNull();
	});
});
