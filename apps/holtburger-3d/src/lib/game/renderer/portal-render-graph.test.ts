import { describe, expect, it } from "vitest";
import { getLandblockCoordinates } from "../landblocks";
import { createPerspectiveMat4 } from "../math/matrices";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import type {
	PortalCrossingId,
	ScenePortalCrossingInput,
	SceneScope,
	SceneTopologyScope,
	SceneTopologyView,
} from "../scene";
import {
	PORTAL_QUERY_EPSILON,
	signedPlaneDistance,
	type PlanarAperture,
} from "../scene/planar-aperture";
import {
	clipPortalWindowThroughAperture,
	createFullPortalViewWindow,
	portalViewWindowBounds,
	type PortalApertureProjectionInput,
	type PortalViewWindow,
} from "./portal-view-window";
import {
	PortalRenderGraphPlanner,
	type PortalRenderGraphPlanInput,
	type PortalRenderWorkPlan,
} from "./portal-render-graph";
import { createCameraNearClipVolume } from "./portal-near-plane";

const LANDBLOCK_ID = "0x0001ffff";
const OUTDOOR_SCOPE = { kind: "outdoor" } as const satisfies SceneScope;
const DEFAULT_MAXIMUM_STENCIL_VALUE = 0xff;
const DEFAULT_SAFETY_WORK_ITEM_LIMIT = 10_000;

describe("portal render graph planning", () => {
	it("does not allocate ceremonial labels for an unmasked outdoor root", () => {
		const plan = requirePlan(
			topology([topologyScope(OUTDOOR_SCOPE, null)], []),
			planInput(OUTDOOR_SCOPE),
		);

		expect(plan.exteriorComponent).toEqual({
			componentNodeIds: ["portal-render-node:outdoor"],
			entryMaskEdgeIds: [],
			indoorNodeIds: [],
			internalIndoorMaskEdgeIds: [],
			outdoorNodeId: "portal-render-node:outdoor",
			renderLayer: 0,
			returnMaskEdgeIds: [],
			rootContained: true,
			stencilLabels: null,
		});
		expect(plan.capacity.requiredMaximumStencilValue).toBe(0);
	});

	it("returns one unmasked base layer for an isolated root", () => {
		const root = envCellScope("root");
		const plan = requirePlan(
			topology([topologyScope(root, "root")], []),
			planInput(root),
		);

		expect(plan.nodes).toEqual([
			{
				id: "portal-render-node:env-cell-island:root",
				incomingMaskEdgeIds: [],
				kind: "indoor-visibility-island",
				renderLayer: 0,
				scopes: [root],
			},
		]);
		expect(plan.renderLayers).toEqual([
			{
				incomingMaskEdgeIds: [],
				renderLayer: 0,
				renderNodeIds: ["portal-render-node:env-cell-island:root"],
			},
		]);
		expect(plan.maskEdges).toEqual([]);
		expect(plan.selectedScopes).toEqual([root]);
		expect(plan.capacity.requiredMaximumStencilValue).toBe(0);
	});

	it("builds deterministic layers and unique nodes for a linear graph", () => {
		const root = envCellScope("root");
		const middle = envCellScope("middle");
		const leaf = envCellScope("leaf");
		const plan = requirePlan(
			topology(
				[
					topologyScope(root, "root"),
					topologyScope(middle, "middle"),
					topologyScope(leaf, "leaf"),
				],
				[
					crossing("root-middle", root, middle),
					crossing("middle-leaf", middle, leaf),
				],
			),
			planInput(root),
		);

		expect(
			plan.nodes.map(({ id, renderLayer }) => ({ id, renderLayer })),
		).toEqual([
			{
				id: "portal-render-node:env-cell-island:leaf",
				renderLayer: 2,
			},
			{
				id: "portal-render-node:env-cell-island:middle",
				renderLayer: 1,
			},
			{
				id: "portal-render-node:env-cell-island:root",
				renderLayer: 0,
			},
		]);
		expect(plan.renderLayers.map((layer) => layer.renderLayer)).toEqual([
			0, 1, 2,
		]);
		expect(plan.maskEdges.map((edge) => edge.crossingId)).toEqual([
			"portal-crossing:middle-leaf",
			"portal-crossing:root-middle",
		]);
		expect(plan.capacity).toMatchObject({
			maximumRenderLayer: 2,
			requiredMaximumStencilValue: 2,
		});
	});

	it("retains alternate mask edges while drawing a diamond target once", () => {
		const root = envCellScope("root");
		const left = envCellScope("left");
		const right = envCellScope("right");
		const target = envCellScope("target");
		const leftWindow = rectangle(-0.9, -0.9, -0.1, 0.9);
		const rightWindow = rectangle(0.1, -0.9, 0.9, 0.9);
		const plan = requirePlan(
			topology(
				[
					topologyScope(root, "root"),
					topologyScope(left, "left"),
					topologyScope(right, "right"),
					topologyScope(target, "target"),
				],
				[
					crossing("root-left", root, left, { aperture: leftWindow }),
					crossing("root-right", root, right, { aperture: rightWindow }),
					crossing("left-target", left, target, {
						aperture: leftWindow,
					}),
					crossing("right-target", right, target, {
						aperture: rightWindow,
					}),
				],
			),
			planInput(root),
		);

		const targetNode = plan.nodes.find((node) =>
			node.scopes.some(
				(scope) => scope.kind === "env-cell" && scope.envCellId === "target",
			),
		);
		expect(targetNode).toMatchObject({
			incomingMaskEdgeIds: [
				"portal-crossing:left-target",
				"portal-crossing:right-target",
			],
			renderLayer: 2,
		});
		expect(
			plan.nodes.filter((node) =>
				node.scopes.some(
					(scope) => scope.kind === "env-cell" && scope.envCellId === "target",
				),
			),
		).toHaveLength(1);
		// Each rectangular aperture deliberately retains its two authored triangle fragments.
		expect(plan.diagnostics.maximumRetainedFragmentsPerNode).toBe(4);
		expect(plan.diagnostics.retainedMaskEdgeCount).toBe(4);
		expect(plan.diagnostics.retainedRenderNodeCount).toBe(4);
	});

	it("agrees with a slow exact simple-path oracle on siblings and cycles", () => {
		const root = envCellScope("root");
		const left = envCellScope("left");
		const right = envCellScope("right");
		const target = envCellScope("target");
		const leftWindow = rectangle(-0.9, -0.9, -0.1, 0.9);
		const rightWindow = rectangle(0.1, -0.9, 0.9, 0.9);
		const graph = topology(
			[
				topologyScope(root, "root"),
				topologyScope(left, "left"),
				topologyScope(right, "right"),
				topologyScope(target, "target"),
			],
			[
				crossing("root-left", root, left, { aperture: leftWindow }),
				crossing("root-right", root, right, { aperture: rightWindow }),
				crossing("left-target", left, target, { aperture: leftWindow }),
				crossing("right-target", right, target, {
					aperture: rightWindow,
				}),
				crossing("target-root", target, root),
			],
		);
		const input = planInput(root);
		const plan = requirePlan(graph, input);
		const oracle = enumerateExactSimplePaths(graph, input);

		expect(plan.nodes.map((node) => node.id).sort()).toEqual(
			[...oracle.nodeIds].sort(),
		);
		expect(plan.maskEdges.map((edge) => edge.crossingId).sort()).toEqual(
			[...oracle.crossingIds].sort(),
		);
	});

	it("retains a visible cycle but never masks the base layer", () => {
		const root = envCellScope("root");
		const child = envCellScope("child");
		const plan = requirePlan(
			topology(
				[topologyScope(root, "root"), topologyScope(child, "child")],
				[
					crossing("root-child", root, child),
					crossing("child-root", child, root),
				],
			),
			planInput(root),
		);

		expect(plan.diagnostics).toMatchObject({
			componentCount: 1,
			cyclicComponentCount: 1,
			duplicateOrSubsumedWindowStateCount: 1,
			retainedMaskEdgeCount: 2,
		});
		expect(plan.renderLayers).toEqual([
			{
				incomingMaskEdgeIds: [],
				renderLayer: 0,
				renderNodeIds: ["portal-render-node:env-cell-island:root"],
			},
			{
				incomingMaskEdgeIds: ["portal-crossing:root-child"],
				renderLayer: 1,
				renderNodeIds: ["portal-render-node:env-cell-island:child"],
			},
		]);
		expect(plan.maskEdges.map((edge) => edge.crossingId)).toContain(
			"portal-crossing:child-root",
		);
	});

	it("collapses only proven depth-continuous scopes into one render node", () => {
		const first = envCellScope("first");
		const second = envCellScope("second");
		const plan = requirePlan(
			topology(
				[topologyScope(first, "shared"), topologyScope(second, "shared")],
				[
					crossing("continuous", first, second, {
						spatialRelationship: {
							kind: "indoor-depth-continuous",
							reciprocalApertureId: "portal-aperture:continuous-reciprocal",
						},
					}),
				],
			),
			planInput(first),
		);

		expect(plan.nodes).toHaveLength(1);
		expect(plan.nodes[0]?.scopes).toEqual([first, second]);
		expect(plan.maskEdges).toEqual([]);
		expect(plan.selectedScopes).toEqual([first, second]);
	});

	it("retains same-domain boundaries as topology without emitting redundant masks", () => {
		const first = envCellScope("first");
		const middle = envCellScope("middle");
		const last = envCellScope("last");
		const sharedIsland = [
			topologyScope(first, "shared"),
			topologyScope(middle, "shared"),
			topologyScope(last, "shared"),
		];
		const depthContinuous = {
			kind: "indoor-depth-continuous",
			reciprocalApertureId: "portal-aperture:reciprocal",
		} as const;
		const plan = requirePlan(
			topology(sharedIsland, [
				crossing("first-middle", first, middle, {
					spatialRelationship: depthContinuous,
				}),
				crossing("middle-last", middle, last, {
					spatialRelationship: depthContinuous,
				}),
				crossing("last-first-boundary", last, first),
			]),
			planInput(first),
		);

		expect(plan.nodes).toHaveLength(1);
		expect(plan.nodes[0]?.scopes).toEqual([first, last, middle]);
		expect(plan.maskEdges).toEqual([]);
		expect(plan.diagnostics.sameDomainBoundaryCrossingCount).toBe(1);
		expect(plan.diagnostics.attemptedCrossingCount).toBe(3);
	});

	it("rejects wrong-facing crossings without scheduling their targets", () => {
		const root = envCellScope("root");
		const hidden = envCellScope("hidden");
		const plan = requirePlan(
			topology(
				[topologyScope(root, "root"), topologyScope(hidden, "hidden")],
				[
					crossing("wrong-facing", root, hidden, {
						acceptedSide: "negative",
					}),
				],
			),
			planInput(root),
		);

		expect(plan.nodes).toHaveLength(1);
		expect(plan.maskEdges).toEqual([]);
		expect(plan.diagnostics.rejectedFacingCrossingCount).toBe(1);
	});

	it("seeds both sides when the finite near plane straddles a wrong-facing aperture", () => {
		const root = envCellScope("root");
		const adjacent = envCellScope("adjacent");
		const straddled = rectangle(-0.5, -0.5, 0.5, 0.5);
		const plan = requirePlan(
			topology(
				[topologyScope(root, "root"), topologyScope(adjacent, "adjacent")],
				[
					crossing("straddled", root, adjacent, {
						acceptedSide: "negative",
						aperture: straddled,
					}),
				],
			),
			planInput(root, { nearClipVolume: testNearClipVolume(1) }),
		);

		expect(plan.nodes).toHaveLength(2);
		expect(plan.maskEdges[0]?.maskSource).toEqual({
			kind: "near-clip-window",
			window: expect.any(Object),
		});
		expect(plan.renderLayers).toEqual([
			{
				incomingMaskEdgeIds: [],
				renderLayer: 0,
				renderNodeIds: ["portal-render-node:env-cell-island:root"],
			},
			{
				incomingMaskEdgeIds: ["portal-crossing:straddled"],
				renderLayer: 1,
				renderNodeIds: ["portal-render-node:env-cell-island:adjacent"],
			},
		]);
	});

	it("seeds an aperture contained between the eye and near cap", () => {
		const root = envCellScope("root");
		const adjacent = envCellScope("adjacent");
		const plan = requirePlan(
			topology(
				[topologyScope(root, "root"), topologyScope(adjacent, "adjacent")],
				[
					crossing("inside-near-clip-volume", root, adjacent, {
						aperture: rectangle(-0.2, -0.2, 0.2, 0.2, -0.5),
					}),
				],
			),
			planInput(root, {
				clipFromAnchor: createPerspectiveMat4(90, 1, 1, 10),
				nearClipVolume: testNearClipVolume(1, Vec3.zero()),
			}),
		);

		const maskSource = plan.maskEdges[0]!.maskSource;
		expect(maskSource.kind).toBe("near-clip-window");
		if (maskSource.kind !== "near-clip-window") {
			throw new Error("Expected a near-clip window mask.");
		}
		const maskBounds = portalViewWindowBounds(maskSource.window);
		expect(maskBounds.min.x).toBeCloseTo(-0.4);
		expect(maskBounds.min.y).toBeCloseTo(-0.4);
		expect(maskBounds.max.x).toBeCloseTo(0.4);
		expect(maskBounds.max.y).toBeCloseTo(0.4);
		expect(plan.renderLayers[0]?.renderNodeIds).toEqual([
			"portal-render-node:env-cell-island:root",
		]);
		expect(plan.renderLayers[1]).toEqual({
			incomingMaskEdgeIds: ["portal-crossing:inside-near-clip-volume"],
			renderLayer: 1,
			renderNodeIds: ["portal-render-node:env-cell-island:adjacent"],
		});
	});

	it("propagates the straddle footprint before planning outdoor branches", () => {
		const root = envCellScope("root");
		const otherBuilding = envCellScope("other-building");
		const straddled = rectangle(-0.9, -0.5, -0.2, 0.5);
		const exteriorTransition = {
			exteriorLandblockId: LANDBLOCK_ID,
			kind: "exterior-transition",
		} as const;
		const plan = requirePlan(
			topology(
				[
					topologyScope(root, "root"),
					topologyScope(OUTDOOR_SCOPE, null),
					topologyScope(otherBuilding, "other-building"),
				],
				[
					crossing("root-outside", root, OUTDOOR_SCOPE, {
						acceptedSide: "negative",
						aperture: straddled,
						spatialRelationship: exteriorTransition,
					}),
					crossing("outside-other-building", OUTDOOR_SCOPE, otherBuilding, {
						aperture: rectangle(-0.8, -0.3, -0.4, 0.3, -0.5),
						spatialRelationship: exteriorTransition,
					}),
				],
			),
			planInput(root, { nearClipVolume: testNearClipVolume(1) }),
		);

		expect(plan.renderLayers).toEqual([
			{
				incomingMaskEdgeIds: [],
				renderLayer: 0,
				renderNodeIds: ["portal-render-node:env-cell-island:root"],
			},
			{
				incomingMaskEdgeIds: ["portal-crossing:root-outside"],
				renderLayer: 1,
				renderNodeIds: ["portal-render-node:outdoor"],
			},
			{
				incomingMaskEdgeIds: ["portal-crossing:outside-other-building"],
				renderLayer: 2,
				renderNodeIds: ["portal-render-node:env-cell-island:other-building"],
			},
		]);
	});

	it("keeps a nested straddle inside its inherited parent mask", () => {
		const root = envCellScope("root");
		const parent = envCellScope("parent");
		const adjacent = envCellScope("adjacent");
		const outsideParentWindow = envCellScope("outside-parent-window");
		const parentAperture = rectangle(-0.8, -0.8, 0.8, 0.8);
		const straddled = rectangle(-0.5, -0.5, 0.5, 0.5, 0.5);
		const plan = requirePlan(
			topology(
				[
					topologyScope(root, "root"),
					topologyScope(parent, "parent"),
					topologyScope(adjacent, "adjacent"),
					topologyScope(outsideParentWindow, "outside-parent-window"),
				],
				[
					crossing("root-parent", root, parent, {
						aperture: parentAperture,
					}),
					crossing("parent-adjacent", parent, adjacent, {
						aperture: straddled,
					}),
					crossing(
						"adjacent-outside-parent-window",
						adjacent,
						outsideParentWindow,
						{
							aperture: rectangle(0.85, -0.2, 0.95, 0.2, -0.5),
						},
					),
				],
			),
			planInput(root),
		);

		expect(
			plan.nodes.map(({ id, renderLayer }) => ({ id, renderLayer })),
		).toEqual([
			{
				id: "portal-render-node:env-cell-island:adjacent",
				renderLayer: 2,
			},
			{
				id: "portal-render-node:env-cell-island:parent",
				renderLayer: 1,
			},
			{
				id: "portal-render-node:env-cell-island:root",
				renderLayer: 0,
			},
		]);
		expect(plan.renderLayers.slice(1)).toEqual([
			{
				incomingMaskEdgeIds: ["portal-crossing:root-parent"],
				renderLayer: 1,
				renderNodeIds: ["portal-render-node:env-cell-island:parent"],
			},
			{
				incomingMaskEdgeIds: ["portal-crossing:parent-adjacent"],
				renderLayer: 2,
				renderNodeIds: ["portal-render-node:env-cell-island:adjacent"],
			},
		]);
		expect(
			plan.maskEdges.find(
				(edge) => edge.crossingId === "portal-crossing:parent-adjacent",
			)?.maskSource,
		).toEqual({
			kind: "near-clip-window",
			window: expect.any(Object),
		});
		expect(
			plan.nodes.some(
				(node) =>
					node.id ===
					"portal-render-node:env-cell-island:outside-parent-window",
			),
		).toBe(false);
	});

	it("uses one preprocessed visibility aperture without scratch capacity", () => {
		const root = envCellScope("root");
		const target = envCellScope("target");
		const forwardId = "portal-crossing:forward" as const;
		const reverseId = "portal-crossing:reverse" as const;
		const effective = rectangle(-0.25, -0.25, 0.25, 0.25);
		const plan = requirePlan(
			topology(
				[topologyScope(root, "root"), topologyScope(target, "target")],
				[
					crossing("forward", root, target, {
						exactMatch: false,
						reciprocalCrossingId: reverseId,
						visibilityAperture: effective,
					}),
					crossing("reverse", target, root, {
						exactMatch: false,
						reciprocalCrossingId: forwardId,
						visibilityAperture: effective,
					}),
				],
			),
			planInput(root),
		);

		expect(plan.maskEdges).toHaveLength(2);
		expect(plan.maskEdges[0]?.maskSource).toEqual({
			kind: "world-aperture",
			visibilityApertureId: "portal-aperture:forward/visibility",
		});
		expect(plan.capacity).toMatchObject({
			maximumRenderLayer: 1,
			requiredMaximumStencilValue: 1,
		});
	});

	it("returns typed failures for mask capacity and the corruption work guard", () => {
		const root = envCellScope("root");
		const target = envCellScope("target");
		const leaf = envCellScope("leaf");
		const forwardId = "portal-crossing:forward" as const;
		const reverseId = "portal-crossing:reverse" as const;
		const graph = topology(
			[
				topologyScope(root, "root"),
				topologyScope(target, "target"),
				topologyScope(leaf, "leaf"),
			],
			[
				crossing("forward", root, target, {
					exactMatch: false,
					reciprocalCrossingId: reverseId,
				}),
				crossing("reverse", target, root, {
					exactMatch: false,
					reciprocalCrossingId: forwardId,
				}),
				crossing("target-leaf", target, leaf),
			],
		);

		expect(
			new PortalRenderGraphPlanner().plan(
				graph,
				planInput(root, { maximumStencilValue: 1 }),
			),
		).toEqual({
			kind: "failed",
			reason: "mask-capacity",
			requiredMaximumStencilValue: 2,
			workItemCount: 6,
		});
		expect(
			new PortalRenderGraphPlanner().plan(
				graph,
				planInput(root, { safetyWorkItemLimit: 1 }),
			),
		).toEqual({
			kind: "failed",
			reason: "work-limit",
			requiredMaximumStencilValue: 0,
			workItemCount: 2,
		});
	});

	it("emits mandatory exterior-transition operations without duplicating outdoor work", () => {
		const root = envCellScope("root");
		const plan = requirePlan(
			topology(
				[topologyScope(root, "root"), topologyScope(OUTDOOR_SCOPE, null)],
				[
					crossing("outside", root, OUTDOOR_SCOPE, {
						spatialRelationship: {
							exteriorLandblockId: LANDBLOCK_ID,
							kind: "exterior-transition",
						},
					}),
				],
			),
			planInput(root),
		);

		expect(plan.nodes.filter((node) => node.kind === "outdoor")).toHaveLength(
			1,
		);
		expect(plan.exteriorTransitions).toEqual([
			{
				crossingId: "portal-crossing:outside",
				exteriorLandblockId: LANDBLOCK_ID,
				sourceNodeId: "portal-render-node:env-cell-island:root",
				targetNodeId: "portal-render-node:outdoor",
			},
		]);
		expect(plan.exteriorComponent).toEqual({
			componentNodeIds: ["portal-render-node:outdoor"],
			entryMaskEdgeIds: ["portal-crossing:outside"],
			indoorNodeIds: [],
			internalIndoorMaskEdgeIds: [],
			outdoorNodeId: "portal-render-node:outdoor",
			renderLayer: 1,
			returnMaskEdgeIds: [],
			rootContained: false,
			stencilLabels: { entry: 1, suffix: null },
		});
	});

	it("retains the complete exterior cycle as one explicit suffix operation", () => {
		const root = envCellScope("root");
		const suffix = envCellScope("suffix");
		const exteriorTransition = {
			exteriorLandblockId: LANDBLOCK_ID,
			kind: "exterior-transition",
		} as const;
		const plan = requirePlan(
			topology(
				[
					topologyScope(root, "root"),
					topologyScope(OUTDOOR_SCOPE, null),
					topologyScope(suffix, "suffix"),
				],
				[
					crossing("enter-outside", root, OUTDOOR_SCOPE, {
						spatialRelationship: exteriorTransition,
					}),
					crossing("outside-suffix", OUTDOOR_SCOPE, suffix, {
						spatialRelationship: exteriorTransition,
					}),
					crossing("suffix-outside", suffix, OUTDOOR_SCOPE, {
						spatialRelationship: exteriorTransition,
					}),
				],
			),
			planInput(root),
		);

		expect(plan.exteriorComponent).toEqual({
			componentNodeIds: [
				"portal-render-node:env-cell-island:suffix",
				"portal-render-node:outdoor",
			],
			entryMaskEdgeIds: ["portal-crossing:enter-outside"],
			indoorNodeIds: ["portal-render-node:env-cell-island:suffix"],
			internalIndoorMaskEdgeIds: ["portal-crossing:outside-suffix"],
			outdoorNodeId: "portal-render-node:outdoor",
			renderLayer: 1,
			returnMaskEdgeIds: ["portal-crossing:suffix-outside"],
			rootContained: false,
			stencilLabels: { entry: 2, suffix: 3 },
		});
		expect(plan.capacity.requiredMaximumStencilValue).toBe(3);
		expect(plan.diagnostics.cyclicComponentCount).toBe(1);
	});

	it("does not conflate an exterior suffix with an unrelated same-layer branch", () => {
		const root = envCellScope("root");
		const suffix = envCellScope("suffix");
		const sibling = envCellScope("sibling");
		const exteriorTransition = {
			exteriorLandblockId: LANDBLOCK_ID,
			kind: "exterior-transition",
		} as const;
		const plan = requirePlan(
			topology(
				[
					topologyScope(root, "root"),
					topologyScope(OUTDOOR_SCOPE, null),
					topologyScope(suffix, "suffix"),
					topologyScope(sibling, "sibling"),
				],
				[
					crossing("enter-outside", root, OUTDOOR_SCOPE, {
						spatialRelationship: exteriorTransition,
					}),
					crossing("outside-suffix", OUTDOOR_SCOPE, suffix, {
						spatialRelationship: exteriorTransition,
					}),
					crossing("suffix-outside", suffix, OUTDOOR_SCOPE, {
						spatialRelationship: exteriorTransition,
					}),
					crossing("root-sibling", root, sibling),
				],
			),
			planInput(root),
		);

		expect(plan.exteriorComponent?.componentNodeIds).toEqual([
			"portal-render-node:env-cell-island:suffix",
			"portal-render-node:outdoor",
		]);
		expect(plan.exteriorComponent?.stencilLabels).toEqual({
			entry: 2,
			suffix: 3,
		});
		expect(plan.capacity).toMatchObject({
			maximumRenderLayer: 1,
			requiredMaximumStencilValue: 3,
		});
		expect(plan.renderLayers[1]).toEqual({
			incomingMaskEdgeIds: [
				"portal-crossing:enter-outside",
				"portal-crossing:outside-suffix",
				"portal-crossing:root-sibling",
				"portal-crossing:suffix-outside",
			],
			renderLayer: 1,
			renderNodeIds: [
				"portal-render-node:env-cell-island:sibling",
				"portal-render-node:env-cell-island:suffix",
				"portal-render-node:outdoor",
			],
		});
	});
});

function requirePlan(
	topologyView: SceneTopologyView,
	input: PortalRenderGraphPlanInput,
): PortalRenderWorkPlan {
	const result = new PortalRenderGraphPlanner().plan(topologyView, input);
	if (result.kind !== "planned") {
		throw new Error(`Expected portal plan, received ${result.reason}.`);
	}
	return result.plan;
}

function planInput(
	rootScope: SceneScope,
	overrides: Partial<PortalRenderGraphPlanInput> = {},
): PortalRenderGraphPlanInput {
	return {
		anchorCoordinates: getLandblockCoordinates(LANDBLOCK_ID),
		clipFromAnchor: Mat4.identity(),
		maximumStencilValue: DEFAULT_MAXIMUM_STENCIL_VALUE,
		nearClipVolume: testNearClipVolume(0.5),
		rootScope,
		safetyWorkItemLimit: DEFAULT_SAFETY_WORK_ITEM_LIMIT,
		...overrides,
	};
}

function testNearClipVolume(near: number, position = new Vec3(0, 0, 1)) {
	return createCameraNearClipVolume(
		{
			far: 100,
			fov: 90,
			near,
			placement: {
				envCellId: null,
				landblockId: LANDBLOCK_ID,
				position,
				rotation: Quat.identity(),
			},
		},
		1,
	);
}

function topology(
	scopes: readonly SceneTopologyScope[],
	crossings: readonly ScenePortalCrossingInput[],
): SceneTopologyView {
	const outgoingByScope = new Map<string, ScenePortalCrossingInput[]>();
	for (const edge of crossings) {
		const key = scopeIdentity(edge.source);
		const outgoing = outgoingByScope.get(key) ?? [];
		outgoing.push(edge);
		outgoingByScope.set(key, outgoing);
	}
	for (const outgoing of outgoingByScope.values()) {
		outgoing.sort((left, right) => left.id.localeCompare(right.id));
	}
	return {
		crossings: [...crossings].sort((left, right) =>
			left.id.localeCompare(right.id),
		),
		outgoing: (scope) => outgoingByScope.get(scopeIdentity(scope)) ?? [],
		revision: 1,
		scopes,
	};
}

function topologyScope(
	scope: SceneScope,
	island: string | null,
): SceneTopologyScope {
	return {
		potentiallyVisibleEnvCellIds: new Set(),
		scope,
		visibilityIslandId:
			island === null
				? null
				: (`env-cell-island:${island}` as SceneTopologyScope["visibilityIslandId"]),
	};
}

function envCellScope(id: string): Extract<SceneScope, { kind: "env-cell" }> {
	return { envCellId: id, kind: "env-cell", landblockId: LANDBLOCK_ID };
}

function crossing(
	id: string,
	source: SceneScope,
	target: SceneScope,
	options: {
		readonly acceptedSide?: ScenePortalCrossingInput["acceptedSide"];
		readonly aperture?: PlanarAperture;
		readonly exactMatch?: boolean;
		readonly reciprocalCrossingId?: PortalCrossingId | null;
		readonly spatialRelationship?: ScenePortalCrossingInput["spatialRelationship"];
		readonly visibilityAperture?: PlanarAperture;
	} = {},
): ScenePortalCrossingInput {
	const aperture = options.aperture ?? rectangle(-0.9, -0.9, 0.9, 0.9);
	const sceneAperture = {
		id: `portal-aperture:${id}` as const,
		indices: aperture.indices,
		landblockBounds: boundsForAperture(aperture),
		landblockId: LANDBLOCK_ID,
		plane: aperture.plane,
		vertices: aperture.vertices,
	};
	const visibility = options.visibilityAperture;
	const visibilityAperture = visibility
		? {
				id: `portal-aperture:${id}/visibility` as const,
				indices: visibility.indices,
				landblockBounds: boundsForAperture(visibility),
				landblockId: LANDBLOCK_ID,
				plane: visibility.plane,
				vertices: visibility.vertices,
			}
		: sceneAperture;
	return {
		acceptedSide: options.acceptedSide ?? "positive",
		exactMatch: options.exactMatch ?? true,
		id: `portal-crossing:${id}`,
		reciprocalCrossingId: options.reciprocalCrossingId ?? null,
		source,
		sourceAperture: sceneAperture,
		spatialRelationship: options.spatialRelationship ?? {
			kind: "indoor-topology-boundary",
			reason: "synthetic-boundary",
		},
		target,
		visibilityAperture,
	};
}

function rectangle(
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
	z = 0,
): PlanarAperture {
	return {
		indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
		plane: { d: -z, normal: new Vec3(0, 0, 1) },
		vertices: new Float32Array([
			minX,
			minY,
			z,
			maxX,
			minY,
			z,
			maxX,
			maxY,
			z,
			minX,
			maxY,
			z,
		]),
	};
}

function boundsForAperture(aperture: PlanarAperture): AABB3 {
	const first = new Vec3(
		aperture.vertices[0]!,
		aperture.vertices[1]!,
		aperture.vertices[2]!,
	);
	const bounds = new AABB3(first.clone(), first.clone());
	for (let index = 3; index < aperture.vertices.length; index += 3) {
		const x = aperture.vertices[index]!;
		const y = aperture.vertices[index + 1]!;
		const z = aperture.vertices[index + 2]!;
		bounds.min.x = Math.min(bounds.min.x, x);
		bounds.min.y = Math.min(bounds.min.y, y);
		bounds.min.z = Math.min(bounds.min.z, z);
		bounds.max.x = Math.max(bounds.max.x, x);
		bounds.max.y = Math.max(bounds.max.y, y);
		bounds.max.z = Math.max(bounds.max.z, z);
	}
	return bounds;
}

function scopeIdentity(scope: SceneScope): string {
	return scope.kind === "outdoor"
		? "outdoor"
		: `${scope.landblockId}/${scope.envCellId}`;
}

/**
 * Test-only exact oracle that deliberately enumerates simple domain paths.
 *
 * This is acceptable for tiny fixtures and intentionally unsuitable for production dense graphs;
 * its different control shape checks the fixed-point planner without reviving path identity.
 */
function enumerateExactSimplePaths(
	graph: SceneTopologyView,
	input: PortalRenderGraphPlanInput,
): {
	readonly crossingIds: ReadonlySet<PortalCrossingId>;
	readonly nodeIds: ReadonlySet<string>;
} {
	const topologyScopeByKey = new Map(
		graph.scopes.map((entry) => [scopeIdentity(entry.scope), entry]),
	);
	const scopesByNodeId = new Map<string, SceneScope[]>();
	for (const entry of graph.scopes) {
		const nodeId = oracleNodeId(entry);
		const scopes = scopesByNodeId.get(nodeId) ?? [];
		scopes.push(entry.scope);
		scopesByNodeId.set(nodeId, scopes);
	}
	const crossingIds = new Set<PortalCrossingId>();
	const rootEntry = topologyScopeByKey.get(scopeIdentity(input.rootScope));
	if (!rootEntry) throw new Error("Oracle root scope is unavailable.");
	const rootNodeId = oracleNodeId(rootEntry);
	const nodeIds = new Set<string>([rootNodeId]);

	const visit = (
		nodeId: string,
		window: PortalViewWindow,
		activeNodeIds: ReadonlySet<string>,
	): void => {
		for (const scope of scopesByNodeId.get(nodeId) ?? []) {
			for (const edge of graph.outgoing(scope)) {
				if (edge.spatialRelationship.kind === "indoor-depth-continuous") {
					continue;
				}
				const targetEntry = topologyScopeByKey.get(scopeIdentity(edge.target));
				if (!targetEntry)
					throw new Error("Oracle target scope is unavailable.");
				const targetNodeId = oracleNodeId(targetEntry);
				if (!oracleFacesCamera(edge, input.nearClipVolume.eye)) continue;
				const projection = clipPortalWindowThroughAperture(
					input,
					window,
					oracleApertureInput(edge),
				);
				if (projection.kind === "empty") continue;
				crossingIds.add(edge.id);
				nodeIds.add(targetNodeId);
				if (activeNodeIds.has(targetNodeId)) continue;
				visit(
					targetNodeId,
					projection.window,
					new Set([...activeNodeIds, targetNodeId]),
				);
			}
		}
	};
	visit(rootNodeId, createFullPortalViewWindow(), new Set([rootNodeId]));
	return { crossingIds, nodeIds };
}

function oracleNodeId(entry: SceneTopologyScope): string {
	return entry.scope.kind === "outdoor"
		? "portal-render-node:outdoor"
		: `portal-render-node:${entry.visibilityIslandId}`;
}

function oracleApertureInput(
	edge: ScenePortalCrossingInput,
): PortalApertureProjectionInput {
	return {
		aperture: {
			indices: edge.visibilityAperture.indices,
			plane: edge.visibilityAperture.plane,
			vertices: edge.visibilityAperture.vertices,
		},
		landblockCoordinates: getLandblockCoordinates(
			edge.visibilityAperture.landblockId,
		),
	};
}

function oracleFacesCamera(
	edge: ScenePortalCrossingInput,
	cameraPosition: Vec3,
): boolean {
	const distance = signedPlaneDistance(
		edge.sourceAperture.plane,
		cameraPosition,
	);
	return edge.acceptedSide === "positive"
		? distance > PORTAL_QUERY_EPSILON
		: distance < -PORTAL_QUERY_EPSILON;
}
