import { describe, expect, it } from "vitest";

import {
	WORLD_RENDER_LAYER,
	deriveWorldRenderPasses,
	staticRenderableLayerForKind,
} from "./render-passes";

describe("world render passes", () => {
	it("preserves current exterior plus diagnostic interior ordering when no portal groups exist", () => {
		expect(
			deriveWorldRenderPasses({
				hasPortalViewGroups: false,
				showDiagnosticInterior: true,
				showDebugOverlays: true,
			}),
		).toEqual([
			{
				kind: "exterior-opaque",
				layer: WORLD_RENDER_LAYER.exterior,
				clearBeforePass: { color: true, depth: true, stencil: true },
			},
			{
				kind: "diagnostic-interior",
				layer: WORLD_RENDER_LAYER.diagnosticInterior,
				clearBeforePass: { color: false, depth: false, stencil: false },
			},
			{
				kind: "debug-overlay",
				layer: WORLD_RENDER_LAYER.debugOverlay,
				clearBeforePass: { color: false, depth: false, stencil: false },
			},
		]);
	});

	it("inserts portal mask and composited interior passes before diagnostic interiors", () => {
		expect(
			deriveWorldRenderPasses({
				hasPortalViewGroups: true,
				showDiagnosticInterior: true,
				showDebugOverlays: false,
			}).map((pass) => pass.kind),
		).toEqual([
			"exterior-opaque",
			"portal-stencil-mask",
			"portal-composited-interior",
			"diagnostic-interior",
		]);
	});

	it("classifies indoor static renderables separately from exterior opaque renderables", () => {
		expect(staticRenderableLayerForKind("indoor-static")).toBe(
			WORLD_RENDER_LAYER.diagnosticInterior,
		);
		expect(staticRenderableLayerForKind("building")).toBe(
			WORLD_RENDER_LAYER.exterior,
		);
		expect(staticRenderableLayerForKind("generated-scenery")).toBe(
			WORLD_RENDER_LAYER.exterior,
		);
	});
});
