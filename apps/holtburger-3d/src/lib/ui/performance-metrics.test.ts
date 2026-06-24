import { describe, expect, it } from "vitest";
import type { RendererFrameTelemetry } from "../renderer/types";
import { PerformanceMetricsTracker } from "./performance-metrics";

describe("browser performance metrics tracker", () => {
	it("samples frame deltas and smooths displayed metrics", () => {
		let nowMs = 0;
		const tracker = new PerformanceMetricsTracker({
			emaAlpha: 0.5,
			nowMs: () => nowMs,
			sampleMs: 100,
		});

		expect(tracker.update(createFrameTelemetry({ frameCount: 0 }))).toEqual({
			fps: 0,
			frameMs: 0,
			handlerMs: 1,
			extrapolatedFps: 1000,
		});

		nowMs = 50;
		expect(
			tracker.update(
				createFrameTelemetry({ frameCount: 3, frameHandlerMs: 3 }),
			),
		).toEqual({
			fps: 0,
			frameMs: 0,
			handlerMs: 1,
			extrapolatedFps: 1000,
		});

		nowMs = 100;
		expect(
			tracker.update(
				createFrameTelemetry({ frameCount: 6, frameHandlerMs: 4 }),
			),
		).toEqual({
			fps: 60,
			frameMs: 100 / 6,
			handlerMs: 3,
			extrapolatedFps: 1000 / 3,
		});

		nowMs = 200;
		expect(
			tracker.update(
				createFrameTelemetry({ frameCount: 9, frameHandlerMs: 7 }),
			),
		).toEqual({
			fps: 45,
			frameMs: 25,
			handlerMs: 5,
			extrapolatedFps: 200,
		});
	});

	it("caps extrapolated theoretical FPS at 9999 when handler execution time is near zero", () => {
		let nowMs = 0;
		const tracker = new PerformanceMetricsTracker({
			emaAlpha: 0.5,
			nowMs: () => nowMs,
			sampleMs: 100,
		});

		// Very fast handler time on initial update
		const res1 = tracker.update(
			createFrameTelemetry({ frameCount: 0, frameHandlerMs: 0.05 }),
		);
		expect(res1.fps).toBe(0);
		expect(res1.frameMs).toBe(0);
		expect(res1.handlerMs).toBeCloseTo(0.05);
		expect(res1.extrapolatedFps).toBe(9999);

		// Extremely fast handler time that would produce massive FPS
		nowMs = 100;
		const res2 = tracker.update(
			createFrameTelemetry({ frameCount: 10, frameHandlerMs: 0.01 }),
		);
		expect(res2.fps).toBe(100);
		expect(res2.frameMs).toBe(10);
		expect(res2.handlerMs).toBeCloseTo(0.03);
		expect(res2.extrapolatedFps).toBe(9999);

		// Check when nextHandlerMs is exactly 0
		nowMs = 200;
		const res3 = tracker.update(
			createFrameTelemetry({ frameCount: 20, frameHandlerMs: 0 }),
		);
		expect(res3.fps).toBe(100);
		expect(res3.frameMs).toBe(10);
		expect(res3.handlerMs).toBeCloseTo(0.015);
		expect(res3.extrapolatedFps).toBe(9999);
	});
});

function createFrameTelemetry(
	overrides: Partial<RendererFrameTelemetry>,
): RendererFrameTelemetry {
	return {
		directEnvCellDrawCalls: 0,
		frameCount: 0,
		frameHandlerMs: 1,
		...overrides,
	};
}
