import { describe, expect, it } from "vitest";

import {
	deriveWorldRenderGraphForPolicy,
	deriveWorldRenderPolicy,
	directionForTransitionDepth,
	summarizeWorldRenderGraph,
} from "./render-policy";

describe("world render policy", () => {
	it("selects interior base and indoor-to-outdoor initial transitions for env-cell residency", () => {
		const policy = deriveWorldRenderPolicy({
			kind: "env-cell",
			landblockId: 0x0102ffff,
			envCellId: 0x01020001,
		});
		const graph = deriveWorldRenderGraphForPolicy({
			policy,
			visibleTransitions: {
				hasOutdoorToIndoorTransitions: true,
				hasIndoorToOutdoorTransitions: true,
			},
			showDebugOverlays: false,
		});

		expect(policy).toMatchObject({
			label: "residency-aware",
			baseScene: "interior",
			showDiagnosticInterior: false,
			initialTransitionDirections: ["indoor-to-outdoor"],
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
			visibleTransitions: {
				hasOutdoorToIndoorTransitions: true,
				hasIndoorToOutdoorTransitions: true,
			},
			showDebugOverlays: false,
		});

		expect(policy).toMatchObject({
			label: "residency-aware",
			baseScene: "exterior",
			showDiagnosticInterior: false,
			initialTransitionDirections: ["outdoor-to-indoor"],
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
			visibleTransitions: {
				hasOutdoorToIndoorTransitions: true,
				hasIndoorToOutdoorTransitions: true,
			},
			showDebugOverlays: false,
		});

		expect(policy).toMatchObject({
			label: "residency-aware",
			baseScene: "exterior",
			showDiagnosticInterior: true,
			initialTransitionDirections: ["outdoor-to-indoor", "indoor-to-outdoor"],
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
			initialTransitionDirections: ["outdoor-to-indoor"],
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

	it("summarizes active render graph work for diagnostics", () => {
		const policy = deriveWorldRenderPolicy({
			kind: "unknown",
			landblockId: null,
		});
		const graph = deriveWorldRenderGraphForPolicy({
			policy,
			visibleTransitions: {
				hasOutdoorToIndoorTransitions: true,
				hasIndoorToOutdoorTransitions: true,
			},
			showDebugOverlays: true,
		});

		expect(summarizeWorldRenderGraph({ policy, graph })).toEqual({
			policyLabel: "residency-aware",
			baseScene: "exterior",
			transitionApertureMaskPassCount: 2,
			apertureDepthResetPassCount: 2,
			interiorCompositePassCount: 1,
			exteriorCompositePassCount: 1,
			diagnosticInteriorPassCount: 1,
			debugOverlayPassCount: 1,
		});
	});
});
