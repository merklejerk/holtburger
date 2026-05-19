import { describe, expect, it } from "vitest";

import {
	WORLD_RENDER_LAYER,
	TRANSITION_PORTAL_STENCIL_REFS,
	deriveFreeCameraWorldRenderGraph,
	deriveWorldRenderPasses,
	staticRenderableLayerForDomain,
} from "./render-passes";
import { WORLD_RENDER_DOMAIN } from "./render-domains";

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

	it("inserts portal mask, depth reset, and composited interior passes before diagnostic interiors", () => {
		expect(
			deriveWorldRenderPasses({
				hasPortalViewGroups: true,
				showDiagnosticInterior: true,
				showDebugOverlays: false,
			}).map((pass) => pass.kind),
		).toEqual([
			"exterior-opaque",
			"portal-stencil-mask",
			"portal-depth-reset",
			"portal-composited-interior",
			"diagnostic-interior",
		]);
	});

	it("classifies indoor static renderables separately from exterior opaque renderables", () => {
		expect(
			staticRenderableLayerForDomain(WORLD_RENDER_DOMAIN.interiorStatic),
		).toBe(WORLD_RENDER_LAYER.diagnosticInterior);
		expect(
			staticRenderableLayerForDomain(WORLD_RENDER_DOMAIN.exteriorStatic),
		).toBe(WORLD_RENDER_LAYER.exterior);
	});

	it("defines the explicit render domains consumed by the unified pipeline plan", () => {
		expect(Object.values(WORLD_RENDER_DOMAIN)).toEqual([
			"terrain",
			"exterior-static",
			"interior-cell-shell",
			"interior-static",
			"portal-aperture",
			"debug-overlay",
		]);
		expect(
			staticRenderableLayerForDomain(WORLD_RENDER_DOMAIN.interiorStatic),
		).toBe(WORLD_RENDER_LAYER.diagnosticInterior);
	});

	it("derives a batched free-camera transition graph by direction and broad scene", () => {
		const graph = deriveFreeCameraWorldRenderGraph({
			hasOutdoorToIndoorTransitions: true,
			hasIndoorToOutdoorTransitions: true,
			showDiagnosticInterior: true,
			showDebugOverlays: true,
		});

		expect(graph.map((node) => node.kind)).toEqual([
			"exterior-base",
			"transition-aperture-mask",
			"aperture-depth-reset",
			"opposite-scene-portal-composite",
			"diagnostic-interior",
			"transition-aperture-mask",
			"aperture-depth-reset",
			"opposite-scene-portal-composite",
			"debug-overlay",
		]);
		expect(graph[1]?.transition).toEqual({
			direction: "outdoor-to-indoor",
			recursionDepth: 1,
			stencilRef: TRANSITION_PORTAL_STENCIL_REFS.outdoorToIndoorDepth1,
			parentStencilRef: null,
			compositeScene: "interior",
		});
		expect(graph[5]?.transition).toEqual({
			direction: "indoor-to-outdoor",
			recursionDepth: 1,
			stencilRef: TRANSITION_PORTAL_STENCIL_REFS.indoorToOutdoorDepth1,
			parentStencilRef: null,
			compositeScene: "exterior",
		});
	});
});
