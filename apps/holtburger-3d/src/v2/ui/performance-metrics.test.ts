import { describe, expect, it } from "vitest";
import type { RendererSnapshot } from "../renderer/types";
import { PerformanceMetricsTracker } from "./performance-metrics";

describe("V2 performance metrics tracker", () => {
	it("samples frame deltas and smooths displayed metrics", () => {
		let nowMs = 0;
		const tracker = new PerformanceMetricsTracker({
			emaAlpha: 0.5,
			nowMs: () => nowMs,
			sampleMs: 100,
		});

		expect(tracker.update(createRendererSnapshot({ frameCount: 0 }))).toEqual({
			fps: 0,
			frameMs: 0,
			handlerMs: 1,
		});

		nowMs = 50;
		expect(
			tracker.update(
				createRendererSnapshot({ frameCount: 3, frameHandlerMs: 3 }),
			),
		).toEqual({
			fps: 0,
			frameMs: 0,
			handlerMs: 2,
		});

		nowMs = 100;
		expect(
			tracker.update(
				createRendererSnapshot({ frameCount: 6, frameHandlerMs: 4 }),
			),
		).toEqual({
			fps: 60,
			frameMs: 100 / 6,
			handlerMs: 3,
		});

		nowMs = 200;
		expect(
			tracker.update(
				createRendererSnapshot({ frameCount: 9, frameHandlerMs: 7 }),
			),
		).toEqual({
			fps: 45,
			frameMs: 25,
			handlerMs: 5,
		});
	});
});

function createRendererSnapshot(
	overrides: Partial<RendererSnapshot>,
): RendererSnapshot {
	return {
		backend: "webgl2",
		canvasHeight: 1,
		canvasWidth: 1,
		debugOverlayPrimitives: 0,
		error: null,
		frameCount: 0,
		frameHandlerMs: 1,
		isRunning: true,
		renderPassPlan: { kind: "single-surface-resident" },
		renderedTriangles: 0,
		sceneDomainTargets: {
			active: false,
			colorFormat: "rgb8",
			depthFormat: "depth-component24",
			exteriorDrawCalls: 0,
			height: 0,
			interiorDrawCalls: 0,
			width: 0,
		},
		staticDrawUnits: 0,
		terrainDrawUnits: 0,
		...overrides,
	};
}
