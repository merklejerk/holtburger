import { describe, expect, it } from "vitest";
import {
	PRESENTATION_FRAME_PHASES,
	PresentationProfiler,
	type PresentationFramePhase,
} from "./presentation-profiler";

/** Drive one render frame where every phase costs `perPhase`, using an exact injected clock. */
function frame(
	profiler: PresentationProfiler,
	clock: { now: number },
	perPhase: number,
): void {
	profiler.beginFrame();
	for (const phase of PRESENTATION_FRAME_PHASES) {
		clock.now += perPhase;
		profiler.mark(phase);
	}
	profiler.finishFrame();
}

function build(): {
	readonly clock: { now: number };
	readonly profiler: PresentationProfiler;
} {
	const clock = { now: 0 };
	return { clock, profiler: new PresentationProfiler(() => clock.now) };
}

describe("PresentationProfiler", () => {
	it("reports nothing before the first frame rather than zeros", () => {
		// Zeros would read as "measured, and everything is free" instead of "not measured yet".
		expect(build().profiler.getProfile().frame).toBeNull();
	});

	it("attributes each span to the phase that closed it", () => {
		const { clock, profiler } = build();
		profiler.beginFrame();
		clock.now += 5;
		profiler.mark("effects");
		clock.now += 2;
		profiler.mark("render");
		clock.now += 1;
		profiler.finishFrame();

		const latest = profiler.getProfile().frame?.latest;

		expect(latest?.effects).toBe(5);
		expect(latest?.render).toBe(2);
		// Unmarked phases stay zero, and the trailing span shows as the total's shortfall.
		expect(latest?.audio).toBe(0);
		expect(latest?.totalMs).toBe(8);
	});

	it("means every phase across the capture", () => {
		const { clock, profiler } = build();
		frame(profiler, clock, 1);
		frame(profiler, clock, 3);

		const profile = profiler.getProfile().frame;

		expect(profile?.sampleCount).toBe(2);
		for (const phase of PRESENTATION_FRAME_PHASES) {
			expect(profile?.mean[phase]).toBe(2);
		}
		expect(profile?.mean.totalMs).toBe(2 * PRESENTATION_FRAME_PHASES.length);
	});

	it("reset discards completed and unfinished frames", () => {
		const { clock, profiler } = build();
		frame(profiler, clock, 1000);
		profiler.beginFrame();
		profiler.reset();
		profiler.finishFrame();
		expect(profiler.getProfile().frame).toBeNull();
		frame(profiler, clock, 2);
		expect(profiler.getProfile().frame?.sampleCount).toBe(1);
		expect(profiler.getProfile().frame?.mean.render).toBe(2);
	});

	it("ignores marks outside a frame rather than inventing a span", () => {
		const { clock, profiler } = build();
		clock.now += 100;
		profiler.mark("render" satisfies PresentationFramePhase);
		profiler.finishFrame();

		expect(profiler.getProfile().frame).toBeNull();
	});
});

it("keeps content/placement sample coverage separate from rendering and clears in-flight work on reset", () => {
	const { clock, profiler } = build();
	const finishCommit = profiler.beginWork("contentCommit");
	clock.now += 3;
	finishCommit();
	expect(profiler.getProfile().frame).toBeNull();
	expect(profiler.getProfile().work.contentCommit).toEqual({
		latestMs: 3,
		meanMs: 3,
		sampleCount: 1,
	});
	const finishPlacement = profiler.beginWork("placementAdvance");
	profiler.reset();
	clock.now += 2;
	finishPlacement();
	expect(profiler.getProfile().work.placementAdvance).toBeNull();
	expect(profiler.getProfile().work.contentCommit).toBeNull();
});
