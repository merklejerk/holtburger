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

	it("compares direct env-cell plans without naming an all-interior source target", () => {
		const plan = createDirectEnvCellPlan();

		expect(portalFrameWorkPlanEquals(plan, createDirectEnvCellPlan())).toBe(
			true,
		);
		expect(
			portalFrameWorkPlanEquals(plan, {
				...createDirectEnvCellPlan(),
				graph: {
					...createDirectEnvCellPlan().graph,
					nodes: [
					{
							...createDirectEnvCellPlan().graph.nodes[1]!,
							resources: {
								...createDirectEnvCellPlan().graph.nodes[1]!.resources,
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
				graph: {
					...createDirectEnvCellPlan().graph,
					edges: [
						{
							...createDirectEnvCellPlan().graph.edges[0]!,
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
		mode: "portal-traversal",
		graph: {
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
			baseNodeId: 0,
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
			edges: [
				{
					apertureResourceId: "portal-aperture:f4180103",
					apertureSourceId: "transition-portal:f4180103/01",
					childNodeId: 1,
					edgeId: 0,
					linkId: "transition:f4180103/01",
					parentNodeId: 0,
					sourceKind: "building-transition",
				},
			],
			nodes: [
				{
					debugStackLabel: "outdoor-root:0xf418ffff",
					incomingEdgeIds: [],
					nodeId: 0,
					parentNodeId: null,
					resources: {
						envCellStaticObjectDrawUnitIds: [],
						resourceState: "not-applicable",
						structuredInteriorDrawUnitIds: [],
					},
					scene: {
						kind: "outdoor-target",
						landblockId: 0xf418ffff,
					},
					traversalDepth: 0,
				},
				{
					debugStackLabel: "transition:f4180103/01",
					incomingEdgeIds: [0],
					nodeId: 1,
					parentNodeId: 0,
					resources: {
						envCellStaticObjectDrawUnitIds: [],
						resourceState: "missing-resources",
						structuredInteriorDrawUnitIds: [],
					},
					scene: {
						envCellId: 0xf4180103,
						kind: "env-cell-direct",
						landblockId: 0xf418ffff,
					},
					traversalDepth: 1,
				},
			],
		},
	};
}
