import { describe, expect, it } from "vitest";

import { buildRenderDebugReport } from "./render-debug-report";

describe("render debug report presenter", () => {
	it("formats renderer diagnostics rows and sections", () => {
		const report = buildRenderDebugReport({
			generatedAtIso: "2026-06-02T12:00:00.000Z",
			destinationFocusLabel: "0x1234ffff",
			sceneSummaryRows: [{ label: "Draw units", value: "42" }],
			sceneDetailSections: [
				{
					title: "Renderer",
					rows: [{ label: "Compacted batches", value: "7" }],
				},
			],
			debugSummaryRows: [{ label: "Assets", value: "ready" }],
			debugDetailSections: [],
			pickerSections: [
				{
					title: "Current pick",
					rows: [{ label: "Kind", value: "static" }],
				},
			],
		});

		expect(report).toContain("Holtburger 3D Debug Report");
		expect(report).toContain("Generated: 2026-06-02T12:00:00.000Z");
		expect(report).toContain("Destination: 0x1234ffff");
		expect(report).toContain("[Renderer]");
		expect(report).toContain("Compacted batches: 7");
		expect(report).toContain("[Current pick]");
		expect(report).not.toContain("Runtime Appearance");
	});
});
