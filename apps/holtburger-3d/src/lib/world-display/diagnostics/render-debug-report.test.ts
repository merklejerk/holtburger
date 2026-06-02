import { describe, expect, it } from "vitest";

import { buildRenderDebugReport } from "./render-debug-report";

describe("render debug report presenter", () => {
	it("formats renderer diagnostics rows, sections, and runtime appearance payload", () => {
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
			runtimeAppearanceStatusText: "Idle",
			runtimeAppearanceRows: [{ label: "Cache", value: "1/16 entries" }],
			runtimeAppearancePayload: {
				pending: false,
				error: null,
				input: { setupModelId: "0x02000000" },
				previews: [
					{
						id: "preview/1",
						setupModelId: 0x02000000,
						appearanceKey: "appearance-a",
					},
				],
			},
		});

		expect(report).toContain("Holtburger 3D Debug Report");
		expect(report).toContain("Generated: 2026-06-02T12:00:00.000Z");
		expect(report).toContain("Destination: 0x1234ffff");
		expect(report).toContain("[Renderer]");
		expect(report).toContain("Compacted batches: 7");
		expect(report).toContain("[Current pick]");
		expect(report).toContain('"appearanceKey": "appearance-a"');
	});
});
