import { describe, expect, it } from "vitest";
import {
	createLegacyPortalFrameWorkPlan,
	portalFrameWorkPlanEquals,
} from "./portal-frame-work-plan";
import type { PortalFrameWorkPlan } from "./types";

describe("portal frame work plan", () => {
	it("classifies legacy render pass modes explicitly", () => {
		expect(
			createLegacyPortalFrameWorkPlan({
				flatVisionModeEnabled: false,
				renderPassPlan: { kind: "single-surface-resident" },
			}),
		).toEqual({
			kind: "legacy-render-pass",
			mode: "single-surface-resident",
			renderPassPlan: { kind: "single-surface-resident" },
		});

		expect(
			createLegacyPortalFrameWorkPlan({
				flatVisionModeEnabled: true,
				renderPassPlan: { kind: "single-surface-resident" },
			}),
		).toEqual({
			kind: "legacy-render-pass",
			mode: "flat-resident-diagnostic",
			renderPassPlan: { kind: "single-surface-resident" },
		});

		expect(
			createLegacyPortalFrameWorkPlan({
				flatVisionModeEnabled: false,
				renderPassPlan: {
					baseScene: { kind: "exterior", landblockId: 0xf418ffff },
					kind: "portal-scene-domains",
					transitionDepthPolicy: { maxDepth: 2 },
				},
			}),
		).toEqual({
			kind: "legacy-render-pass",
			mode: "legacy-scene-domain-composite",
			renderPassPlan: {
				baseScene: { kind: "exterior", landblockId: 0xf418ffff },
				kind: "portal-scene-domains",
				transitionDepthPolicy: { maxDepth: 2 },
			},
		});
	});

	it("compares direct env-cell projection plans", () => {
		const plan = createDirectEnvCellPlan();

		expect(portalFrameWorkPlanEquals(plan, createDirectEnvCellPlan())).toBe(
			true,
		);
		expect(
			portalFrameWorkPlanEquals(plan, {
				...createDirectEnvCellPlan(),
				layeredGraph: {
					...createDirectEnvCellPlan().layeredGraph,
					renderEntries: [
						{
							...createDirectEnvCellPlan().layeredGraph.renderEntries[0]!,
							resources: {
								...createDirectEnvCellPlan().layeredGraph.renderEntries[0]!
									.resources,
								resourceState: "ready",
							},
						},
					],
				},
			}),
		).toBe(false);
		expect(
			portalFrameWorkPlanEquals(plan, {
				...createDirectEnvCellPlan(),
				layeredGraph: {
					...createDirectEnvCellPlan().layeredGraph,
					maskEdges: [
						{
							...createDirectEnvCellPlan().layeredGraph.maskEdges[0]!,
							linkId: "different-link",
						},
					],
				},
			}),
		).toBe(false);
	});
});

function createDirectEnvCellPlan(): PortalFrameWorkPlan {
	return {
		kind: "direct-env-cell",
		mode: "portal-projection",
		layeredGraph: {
			apertureResources: [
				{
					resourceId: "portal-aperture:f4180103",
					sourceKinds: ["building-transition"],
					vertices: [
						[0, 0, 0],
						[1, 0, 0],
						[0, 1, 0],
					],
				},
			],
			baseEntry: {
				debugStackLabel: "outdoor-root:0xf418ffff",
				scene: {
					kind: "outdoor-target",
					landblockId: 0xf418ffff,
				},
			},
			diagnostics: {
				buildingTransitionEdges: 1,
				dedupedGeometryResources: 0,
				duplicateMaskEdges: 0,
				envCellPortalEdges: 0,
				selectedMaskEdges: 1,
				transitionRootCandidateCount: 1,
				transitionRootCount: 1,
				transitionRootsRejectedNotSeenOutside: 0,
				transitionRootsRejectedUnknownSeenOutside: 0,
			},
			maskEdges: [
				{
					apertureResourceId: "portal-aperture:f4180103",
					apertureSourceId: "transition-portal:f4180103/01",
					edgeId: 0,
					linkId: "transition:f4180103/01",
					renderEntryId: 0,
					renderLayer: 1,
					sourceEnvCellId: null,
					sourceKind: "building-transition",
					targetEnvCellId: 0xf4180103,
				},
			],
			projectionDiagnostics: {
				componentCount: 1,
				componentInternalEdgeCount: 0,
				cyclicComponentCount: 0,
				maskEdgesSkippedByLayerCap: 0,
				maskEdgesSkippedByMaxMaskEdges: 0,
				maxProjectionRenderLayer: 1,
				maxSelectedRenderLayer: 1,
				missingResourceMembershipCount: 1,
				projectedEnvCellCount: 1,
				renderEntriesSkippedByLayerCap: 0,
				renderEntriesSkippedByMaxRenderEntries: 0,
				renderEntryCount: 1,
			},
			renderEntries: [
				{
					debugStackLabel: "outdoor-root:0xf418ffff/layer:1/cell:0xf4180103",
					envCellId: 0xf4180103,
					incomingMaskEdgeIds: [0],
					landblockId: 0xf418ffff,
					renderEntryId: 0,
					renderLayer: 1,
					resources: {
						envCellStaticObjectDrawUnitIds: [],
						resourceState: "missing-resources",
						structuredInteriorDrawUnitIds: [],
					},
				},
			],
			renderLayers: [{ renderEntryIds: [0], renderLayer: 1 }],
		},
	};
}
