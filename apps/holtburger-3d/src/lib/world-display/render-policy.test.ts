import { describe, expect, it } from "vitest";

import {
	deriveWorldRenderGraphForPolicy,
	deriveWorldRenderPolicy,
	deriveTransitionPortalRenderLevels,
	directionForTransitionDepth,
	summarizeWorldRenderGraph,
	type TransitionPortalRenderLevel,
} from "./render-policy";

function visibleDirections(
	directions: readonly string[],
): { hasVisibleTransitionLevel(level: TransitionPortalRenderLevel): boolean } {
	return {
		hasVisibleTransitionLevel: (level) =>
			directions.includes(level.direction),
	};
}

describe("world render policy", () => {
	it("selects interior base and indoor-to-outdoor initial transitions for env-cell residency", () => {
		const policy = deriveWorldRenderPolicy({
			kind: "env-cell",
			landblockId: 0x0102ffff,
			envCellId: 0x01020001,
		});
		const graph = deriveWorldRenderGraphForPolicy({
			policy,
			visibleTransitions: visibleDirections([
				"outdoor-to-indoor",
				"indoor-to-outdoor",
			]),
			showDebugOverlays: false,
		});

		expect(policy).toMatchObject({
			label: "residency-aware",
			baseScene: "interior",
			showDiagnosticInterior: false,
			transitionLevels: [
				expect.objectContaining({
					direction: "indoor-to-outdoor",
					recursionDepth: 1,
					parentStencilRef: null,
				}),
			],
		});
		expect(graph.map((node) => node.kind)).toEqual([
			"interior-base",
			"transition-aperture-mask",
			"aperture-depth-reset",
			"opposite-scene-portal-composite",
		]);
		expect(graph[3]?.transition?.compositeScene).toBe("exterior");
	});

	it("selects exterior base and outdoor-to-indoor initial transitions for outdoor residency", () => {
		const policy = deriveWorldRenderPolicy({
			kind: "outdoor-landblock",
			landblockId: 0x0102ffff,
		});
		const graph = deriveWorldRenderGraphForPolicy({
			policy,
			visibleTransitions: visibleDirections([
				"outdoor-to-indoor",
				"indoor-to-outdoor",
			]),
			showDebugOverlays: false,
		});

		expect(policy).toMatchObject({
			label: "residency-aware",
			baseScene: "exterior",
			showDiagnosticInterior: false,
			transitionLevels: [
				expect.objectContaining({
					direction: "outdoor-to-indoor",
					recursionDepth: 1,
					parentStencilRef: null,
				}),
			],
		});
		expect(graph.map((node) => node.kind)).toEqual([
			"exterior-base",
			"transition-aperture-mask",
			"aperture-depth-reset",
			"opposite-scene-portal-composite",
		]);
		expect(graph[3]?.transition?.compositeScene).toBe("interior");
	});

	it("falls back to broad diagnostic rendering for unknown residency", () => {
		const policy = deriveWorldRenderPolicy({
			kind: "unknown",
			landblockId: null,
		});
		const graph = deriveWorldRenderGraphForPolicy({
			policy,
			visibleTransitions: visibleDirections([
				"outdoor-to-indoor",
				"indoor-to-outdoor",
			]),
			showDebugOverlays: false,
		});

		expect(policy).toMatchObject({
			label: "residency-aware",
			baseScene: "exterior",
			showDiagnosticInterior: true,
			transitionLevels: [
				expect.objectContaining({
					direction: "outdoor-to-indoor",
					recursionDepth: 1,
				}),
			],
		});
		expect(graph.map((node) => node.kind)).toEqual([
			"exterior-base",
			"transition-aperture-mask",
			"aperture-depth-reset",
			"opposite-scene-portal-composite",
			"diagnostic-interior",
		]);
	});

	it("supports disabling unknown-residency broad diagnostic fallback", () => {
		const policy = deriveWorldRenderPolicy(
			{
				kind: "unknown",
				landblockId: 0x0102ffff,
			},
			{
				minPortalScreenAreaPx: 64,
				enableUnknownResidencyDiagnosticFallback: false,
			},
		);

		expect(policy).toMatchObject({
			baseScene: "exterior",
			showDiagnosticInterior: false,
			transitionLevels: [
				expect.objectContaining({
					direction: "outdoor-to-indoor",
					recursionDepth: 1,
				}),
			],
			portalCandidates: {
				minScreenAreaPx: 64,
			},
		});
	});

	it("derives transition direction by alternating scene context per recursion depth", () => {
		expect(directionForTransitionDepth("exterior", 1)).toBe(
			"outdoor-to-indoor",
		);
		expect(directionForTransitionDepth("exterior", 2)).toBe(
			"indoor-to-outdoor",
		);
		expect(directionForTransitionDepth("interior", 1)).toBe(
			"indoor-to-outdoor",
		);
		expect(directionForTransitionDepth("interior", 2)).toBe(
			"outdoor-to-indoor",
		);
	});

	it("derives bounded transition levels with sequential stencil refs", () => {
		expect(
			deriveTransitionPortalRenderLevels({
				baseScene: "exterior",
				maxDepth: 3,
			}),
		).toEqual([
			{
				direction: "outdoor-to-indoor",
				recursionDepth: 1,
				stencilRef: 1,
				parentStencilRef: null,
				compositeScene: "interior",
			},
			{
				direction: "indoor-to-outdoor",
				recursionDepth: 2,
				stencilRef: 2,
				parentStencilRef: 1,
				compositeScene: "exterior",
			},
			{
				direction: "outdoor-to-indoor",
				recursionDepth: 3,
				stencilRef: 3,
				parentStencilRef: 2,
				compositeScene: "interior",
			},
		]);
	});

	it("stops transition graph expansion at the first invisible nested level", () => {
		const policy = deriveWorldRenderPolicy(
			{
				kind: "outdoor-landblock",
				landblockId: 0x0102ffff,
			},
			{ transitionPortalMaxDepth: 3 },
		);
		const graph = deriveWorldRenderGraphForPolicy({
			policy,
			visibleTransitions: visibleDirections(["outdoor-to-indoor"]),
			showDebugOverlays: false,
		});

		expect(graph.map((node) => node.kind)).toEqual([
			"exterior-base",
			"transition-aperture-mask",
			"aperture-depth-reset",
			"opposite-scene-portal-composite",
		]);
		expect(graph[1]?.transition).toMatchObject({
			recursionDepth: 1,
			stencilRef: 1,
			parentStencilRef: null,
		});
	});

	it("summarizes active render graph work for diagnostics", () => {
		const policy = deriveWorldRenderPolicy({
			kind: "unknown",
			landblockId: null,
		});
		const graph = deriveWorldRenderGraphForPolicy({
			policy,
			visibleTransitions: visibleDirections([
				"outdoor-to-indoor",
				"indoor-to-outdoor",
			]),
			showDebugOverlays: true,
		});

		expect(summarizeWorldRenderGraph({ policy, graph })).toEqual({
			policyLabel: "residency-aware",
			baseScene: "exterior",
			transitionApertureMaskPassCount: 1,
			apertureDepthResetPassCount: 1,
			interiorCompositePassCount: 1,
			exteriorCompositePassCount: 0,
			diagnosticInteriorPassCount: 1,
			debugOverlayPassCount: 1,
		});
	});
});
