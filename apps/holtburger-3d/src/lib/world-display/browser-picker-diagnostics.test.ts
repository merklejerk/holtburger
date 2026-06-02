import { describe, expect, it } from "vitest";

import { summarizeUvBuffer } from "./browser-picker-diagnostics";

describe("browser picker diagnostics", () => {
	it("summarizes uv range and flags coordinates outside the unit square", () => {
		expect(summarizeUvBuffer(new Float32Array([0.25, -1, 2, 3]))).toEqual({
			coordinateCount: 2,
			minU: 0.25,
			maxU: 2,
			minV: -1,
			maxV: 3,
			spanU: 1.75,
			spanV: 4,
			outsideUnitSquare: true,
		});
	});

	it("reports empty uv buffers without sentinel infinities", () => {
		expect(summarizeUvBuffer([])).toEqual({
			coordinateCount: 0,
			minU: null,
			maxU: null,
			minV: null,
			maxV: null,
			spanU: null,
			spanV: null,
			outsideUnitSquare: false,
		});
	});
});
