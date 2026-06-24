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
		});

		nowMs = 50;
		expect(
			tracker.update(
				createFrameTelemetry({ frameCount: 3, frameHandlerMs: 3 }),
			),
		).toEqual({
			fps: 0,
			frameMs: 0,
			handlerMs: 2,
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
		});
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
