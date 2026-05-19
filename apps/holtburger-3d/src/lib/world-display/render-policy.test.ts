import { describe, expect, it } from "vitest";

import {
	deriveBrowserFreeCameraRenderPolicy,
	deriveResidencyFocusedRenderPolicy,
	deriveWorldRenderGraphForPolicy,
	summarizeWorldRenderGraph,
} from "./render-policy";

describe("world render policy", () => {
	it("keeps browser free-camera broad diagnostics and both transition directions", () => {
		const policy = deriveBrowserFreeCameraRenderPolicy();
		const graph = deriveWorldRenderGraphForPolicy({
			policy,
			visibleTransitions: {
				hasOutdoorToIndoorTransitions: true,
				hasIndoorToOutdoorTransitions: true,
			},
			showDebugOverlays: true,
		});

		expect(policy).toMatchObject({
			mode: "browser-free-camera",
			baseScene: "exterior",
			showDiagnosticInterior: true,
			allowedTransitionDirections: ["outdoor-to-indoor", "indoor-to-outdoor"],
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
	});

	it("selects interior base and exterior transition composites for env-cell residency", () => {
		const policy = deriveResidencyFocusedRenderPolicy({
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
			mode: "residency-focused",
			baseScene: "interior",
			showDiagnosticInterior: false,
			allowedTransitionDirections: ["indoor-to-outdoor"],
		});
		expect(graph.map((node) => node.kind)).toEqual([
			"interior-base",
			"transition-aperture-mask",
			"aperture-depth-reset",
			"opposite-scene-portal-composite",
		]);
		expect(graph[3]?.transition?.compositeScene).toBe("exterior");
	});

	it("selects exterior base and interior transition composites for outdoor residency", () => {
		const policy = deriveResidencyFocusedRenderPolicy({
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
			mode: "residency-focused",
			baseScene: "exterior",
			showDiagnosticInterior: false,
			allowedTransitionDirections: ["outdoor-to-indoor"],
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
		const policy = deriveResidencyFocusedRenderPolicy({
			kind: "unknown",
			landblockId: null,
		});
		const graph = deriveWorldRenderGraphForPolicy({
			policy,
			visibleTransitions: {
				hasOutdoorToIndoorTransitions: false,
				hasIndoorToOutdoorTransitions: false,
			},
			showDebugOverlays: false,
		});

		expect(policy).toMatchObject({
			mode: "residency-focused",
			baseScene: "exterior",
			showDiagnosticInterior: true,
		});
		expect(graph.map((node) => node.kind)).toEqual([
			"exterior-base",
			"diagnostic-interior",
		]);
	});

	it("summarizes active render graph work for diagnostics", () => {
		const policy = deriveBrowserFreeCameraRenderPolicy();
		const graph = deriveWorldRenderGraphForPolicy({
			policy,
			visibleTransitions: {
				hasOutdoorToIndoorTransitions: true,
				hasIndoorToOutdoorTransitions: true,
			},
			showDebugOverlays: true,
		});

		expect(summarizeWorldRenderGraph({ policy, graph })).toEqual({
			policyMode: "browser-free-camera",
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
