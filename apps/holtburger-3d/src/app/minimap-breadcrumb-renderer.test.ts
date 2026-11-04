import { describe, expect, it } from "vitest";

import type { ProjectedMapView } from "../lib/game/map/map-view";
import {
	EMPTY_MINIMAP_BREADCRUMB_TRAIL,
	type MinimapBreadcrumb,
	type MinimapBreadcrumbHistory,
	type MinimapBreadcrumbTrail,
} from "./minimap-breadcrumb-trail";
import {
	drawMinimapBreadcrumbTrail,
	MINIMAP_BREADCRUMB_MAXIMUM_FILL_CALLS,
	MINIMAP_BREADCRUMB_MAXIMUM_PAINT_CALLS,
	MINIMAP_BREADCRUMB_MAXIMUM_STROKE_CALLS,
	type MinimapBreadcrumbCanvas,
} from "./minimap-breadcrumb-renderer";
import { MINIMAP_BREADCRUMB_HALO_WIDTH_PIXELS } from "./minimap-tuning";

describe("minimap breadcrumb renderer", () => {
	it("does no Canvas work for an empty trail", () => {
		const recorder = canvasRecorder();

		drawMinimapBreadcrumbTrail(
			recorder.context,
			EMPTY_MINIMAP_BREADCRUMB_TRAIL,
			projection(),
			200,
		);

		expect(recorder.arcCalls()).toBe(0);
		expect(recorder.fillStyles()).toEqual([]);
		expect(recorder.strokeStyles()).toEqual([]);
	});

	it("projects every sample once into the fixed core-and-halo paint budget", () => {
		const recorder = canvasRecorder();
		const samples: MinimapBreadcrumbHistory = [
			sample(0),
			...Array.from({ length: 119 }, (_, index) => sample(index + 1)),
		];
		const trail: MinimapBreadcrumbTrail = {
			kind: "tracking",
			lastObserved: samples[0],
			samples,
			subjectGuid: 1,
		};

		drawMinimapBreadcrumbTrail(recorder.context, trail, projection(), 200);

		expect(recorder.arcCalls()).toBe(samples.length * 2);
		expect(recorder.moveCalls()).toBe(samples.length * 2);
		expect(recorder.fillStyles()).toHaveLength(
			MINIMAP_BREADCRUMB_MAXIMUM_FILL_CALLS,
		);
		expect(new Set(recorder.fillStyles())).toHaveLength(
			MINIMAP_BREADCRUMB_MAXIMUM_FILL_CALLS,
		);
		expect(recorder.strokeStyles()).toHaveLength(
			MINIMAP_BREADCRUMB_MAXIMUM_STROKE_CALLS,
		);
		expect(new Set(recorder.strokeStyles())).toHaveLength(
			MINIMAP_BREADCRUMB_MAXIMUM_STROKE_CALLS,
		);
		expect(recorder.paintOperations()).toHaveLength(
			MINIMAP_BREADCRUMB_MAXIMUM_PAINT_CALLS,
		);
		expect(recorder.paintOperations()).toEqual(
			Array.from(
				{ length: MINIMAP_BREADCRUMB_MAXIMUM_STROKE_CALLS },
				() => ["stroke", "fill", "fill", "fill"] as const,
			).flat(),
		);
		expect(new Set(recorder.strokeWidths())).toEqual(
			new Set([MINIMAP_BREADCRUMB_HALO_WIDTH_PIXELS * 2]),
		);
	});

	it("omits samples outside the projected map extent", () => {
		const recorder = canvasRecorder();
		const outside = { worldX: 2, worldY: 0, worldZ: 0 };
		const trail: MinimapBreadcrumbTrail = {
			kind: "tracking",
			lastObserved: outside,
			samples: [outside],
			subjectGuid: 1,
		};

		drawMinimapBreadcrumbTrail(recorder.context, trail, projection(), 200);

		expect(recorder.arcCalls()).toBe(0);
		expect(recorder.fillStyles()).toEqual([]);
		expect(recorder.strokeStyles()).toEqual([]);
	});
});

function sample(index: number): MinimapBreadcrumb {
	const elevation = [-30, 0, 30][index % 3];
	return { worldX: 0, worldY: elevation, worldZ: 0 };
}

function projection(): ProjectedMapView {
	return {
		view: {
			anchor: {
				headingRadians: 0,
				residency: null,
				worldX: 0,
				worldY: 0,
				worldZ: 0,
			},
			center: { worldX: 0, worldZ: 0 },
			viewDiameter: 100,
		},
		worldToClip: { m00: 1, m01: 0, m10: 0, m11: 1 },
	};
}

function canvasRecorder(): {
	readonly arcCalls: () => number;
	readonly context: MinimapBreadcrumbCanvas;
	readonly fillStyles: () => readonly string[];
	readonly moveCalls: () => number;
	readonly paintOperations: () => readonly ("fill" | "stroke")[];
	readonly strokeStyles: () => readonly string[];
	readonly strokeWidths: () => readonly number[];
} {
	let arcs = 0;
	let moves = 0;
	const fillStyles: string[] = [];
	const operations: ("fill" | "stroke")[] = [];
	const strokeStyles: string[] = [];
	const strokeWidths: number[] = [];
	const context: MinimapBreadcrumbCanvas = {
		arc: () => {
			arcs += 1;
		},
		beginPath: () => {},
		fill: () => {
			fillStyles.push(String(context.fillStyle));
			operations.push("fill");
		},
		fillStyle: "",
		lineWidth: 1,
		moveTo: () => {
			moves += 1;
		},
		stroke: () => {
			operations.push("stroke");
			strokeStyles.push(String(context.strokeStyle));
			strokeWidths.push(context.lineWidth);
		},
		strokeStyle: "",
	};
	return {
		arcCalls: () => arcs,
		context,
		fillStyles: () => fillStyles,
		moveCalls: () => moves,
		paintOperations: () => operations,
		strokeStyles: () => strokeStyles,
		strokeWidths: () => strokeWidths,
	};
}
