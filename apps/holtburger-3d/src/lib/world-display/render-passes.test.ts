import { describe, expect, it } from "vitest";

import {
	WORLD_RENDER_LAYER,
	deriveTransitionPortalGraphNodes,
	staticRenderableLayerForDomain,
	transitionPortalStencilRefForDepth,
} from "./render-passes";
import { WORLD_RENDER_DOMAIN } from "./render-domains";

describe("world render passes", () => {
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

	it("derives transition graph nodes from explicit direction and depth metadata", () => {
		const graph = deriveTransitionPortalGraphNodes({
			direction: "outdoor-to-indoor",
			recursionDepth: 2,
			stencilRef: transitionPortalStencilRefForDepth(2),
			parentStencilRef: transitionPortalStencilRefForDepth(1),
			compositeScene: "interior",
		});

		expect(graph.map((node) => node.kind)).toEqual([
			"transition-aperture-mask",
			"aperture-depth-reset",
			"opposite-scene-portal-composite",
		]);
		expect(graph[0]?.transition).toEqual({
			direction: "outdoor-to-indoor",
			recursionDepth: 2,
			stencilRef: 2,
			parentStencilRef: 1,
			compositeScene: "interior",
		});
		expect(graph[0]?.clearBeforePass.stencil).toBe(false);
	});
});
