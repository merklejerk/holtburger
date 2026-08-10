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
import {
	PORTAL_ARRIVAL_METADATA_FLAGS_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE,
	PORTAL_ARRIVAL_METADATA_PLANE_FLOAT_COUNT,
	PORTAL_ARRIVAL_METADATA_RECORD_BYTES,
	PORTAL_ARRIVAL_METADATA_RECIPROCAL_OFFSET_BYTES,
	PORTAL_ARRIVAL_METADATA_SCOPE_OFFSET_BYTES,
} from "./portal-arrival-metadata";
import {
	PORTAL_CROSSING_DEPTH_POLICY_ALLOW_EQUAL,
	PORTAL_CROSSING_DEPTH_POLICY_REJECT_EQUAL,
	PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
	PortalPropagationStreamArena,
} from "./portal-crossing-triangle-stream";
import {
	PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES,
	PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
	PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES,
} from "./portal-propagation-metadata";
import { PortalScopeWindowCuller } from "./portal-scope-window-culler";
import { createCameraNearClipVolume } from "./portal-near-plane";
import { PORTAL_RENDER_CAPACITY_POLICY } from "./portal-render-capacity-policy";
import { PortalScopeAtlasPlanner } from "./portal-scope-atlas-planner";
import { PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES } from "./portal-scope-tile-metadata";

const LANDBLOCK_ID = "0x0001ffff";
const OUTDOOR_SCOPE = { kind: "outdoor" } as const satisfies SceneScope;
const DEFAULT_MAXIMUM_STENCIL_VALUE = 0xff;
const DEFAULT_SAFETY_WORK_ITEM_LIMIT = 10_000;
const TEST_ATLAS_MAXIMUM_PATH_DEPTH = 4;
const TEST_ATLAS_PACKING_CHILD_COUNT = 24;
const TEST_ATLAS_PACKING_EXTENT = 400;
const TEST_ATLAS_UNSAFE_PIXEL_EXTENT = 100_000_000;
const TEST_ATLAS_UNSAFE_TILE_EXTENT = 20_000_000;
const TEST_UINT32_OVERFLOW = 0x1_0000_0000;
const TEST_RECTANGLE_VERTEX_COUNT = 4;

describe("portal render graph planning", () => {
	it("rejects invalid portal-footprint policies at the planner boundary", () => {
		const topologyView = topology([topologyScope(OUTDOOR_SCOPE, null)], []);
		const planner = new PortalRenderGraphPlanner();

		expect(() =>
			planner.plan(
				topologyView,
				planInput(OUTDOOR_SCOPE, {
					portalFootprint: {
						drawingBuffer: { height: 1, width: 1 },
						minimumPixelArea: Number.NaN,
					},
				}),
			),
		).toThrow("minimum must be a non-negative finite number");
		expect(() =>
			planner.plan(
				topologyView,
				planInput(OUTDOOR_SCOPE, {
					portalFootprint: {
						drawingBuffer: { height: 0, width: 1 },
						minimumPixelArea: 0,
					},
				}),
			),
		).toThrow("drawing buffer must have positive integer dimensions");
	});

	it("does not allocate ceremonial labels for an unmasked outdoor root", () => {
		const plan = requirePlan(
			topology([topologyScope(OUTDOOR_SCOPE, null)], []),
			planInput(OUTDOOR_SCOPE),
		);

		expect(requireExteriorContribution(plan)).toEqual({
			componentNodeIds: ["portal-render-node:outdoor"],
			entryMaskEdgeIds: [],
			kind: "exterior",
			maskEdgeIds: [],
			outdoorNodeId: "portal-render-node:outdoor",
			renderLayer: 0,
			returnMaskEdgeIds: [],
			rootContained: true,
			stencilValue: 0,
			suffix: null,
		});
		expect(plan.capacity.requiredMaximumStencilValue).toBe(0);
	});

	it("keeps an outdoor root unmasked when its component contains an indoor cycle", () => {
		const inside = envCellScope("inside");
		const exteriorTransition = {
			exteriorLandblockId: LANDBLOCK_ID,
			kind: "exterior-transition",
		} as const;
		const plan = requirePlan(
			topology(
				[topologyScope(OUTDOOR_SCOPE, null), topologyScope(inside, "inside")],
				[
					crossing("outside-inside", OUTDOOR_SCOPE, inside, {
						spatialRelationship: exteriorTransition,
					}),
					crossing("inside-outside", inside, OUTDOOR_SCOPE, {
						spatialRelationship: exteriorTransition,
					}),
				],
			),
			planInput(OUTDOOR_SCOPE),
		);

		expect(requireExteriorContribution(plan)).toEqual({
			componentNodeIds: [
				"portal-render-node:env-cell-island:inside",
				"portal-render-node:outdoor",
			],
			entryMaskEdgeIds: [],
			kind: "exterior",
			maskEdgeIds: [],
			outdoorNodeId: "portal-render-node:outdoor",
			renderLayer: 0,
			returnMaskEdgeIds: ["portal-crossing:inside-outside"],
			rootContained: true,
			stencilValue: 0,
			suffix: null,
		});
		expect(plan.renderLayers).toEqual([
			{
				contributions: [requireExteriorContribution(plan)],
				renderLayer: 0,
			},
			indoorLayer(
				1,
				["portal-render-node:env-cell-island:inside"],
				["portal-crossing:outside-inside"],
			),
		]);
		expect(plan.capacity.requiredMaximumStencilValue).toBe(1);
		expect(plan.diagnostics.cyclicComponentCount).toBe(1);
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
			indoorLayer(0, ["portal-render-node:env-cell-island:root"]),
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
		// Each rectangular aperture collapses its authored triangulation to one exact fragment.
		expect(plan.diagnostics.maximumRetainedFragmentsPerScope).toBe(2);
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
			indoorLayer(0, ["portal-render-node:env-cell-island:root"]),
			indoorLayer(
				1,
				["portal-render-node:env-cell-island:child"],
				["portal-crossing:root-child"],
			),
		]);
		expect(plan.maskEdges.map((edge) => edge.crossingId)).toContain(
			"portal-crossing:child-root",
		);
	});

	it("terminates an alternating-domain cycle without discarding subsumed transitions", () => {
		const root = envCellScope("root");
		const other = envCellScope("other");
		const exteriorTransition = {
			exteriorLandblockId: LANDBLOCK_ID,
			kind: "exterior-transition",
		} as const;
		const leftWindow = rectangle(-0.8, -0.8, 0.2, 0.8);
		const plan = requirePlan(
			topology(
				[
					topologyScope(root, "root"),
					topologyScope(other, "other"),
					topologyScope(OUTDOOR_SCOPE, null),
				],
				[
					crossing("root-outside", root, OUTDOOR_SCOPE, {
						aperture: leftWindow,
						spatialRelationship: exteriorTransition,
					}),
					crossing("outside-other", OUTDOOR_SCOPE, other, {
						aperture: leftWindow,
						spatialRelationship: exteriorTransition,
					}),
					crossing("other-outside", other, OUTDOOR_SCOPE, {
						aperture: leftWindow,
						spatialRelationship: exteriorTransition,
					}),
					crossing("outside-root", OUTDOOR_SCOPE, root, {
						aperture: leftWindow,
						spatialRelationship: exteriorTransition,
					}),
				],
			),
			planInput(root),
		);

		expect(plan.maskEdges.map((edge) => edge.crossingId)).toEqual([
			"portal-crossing:other-outside",
			"portal-crossing:outside-other",
			"portal-crossing:outside-root",
			"portal-crossing:root-outside",
		]);
		expect(plan.diagnostics).toMatchObject({
			cyclicComponentCount: 1,
			duplicateOrSubsumedWindowStateCount: 2,
		});
		expect(plan.diagnostics.workItemCount).toBeLessThan(20);
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

	it("traverses an L-shaped island by reached scope and retains its root return", () => {
		const root = envCellScope("root");
		const nearDoor = envCellScope("near-door");
		const farDoor = envCellScope("far-door");
		const unrelatedDoor = envCellScope("unrelated-door");
		const sharedIsland = "l-building";
		const exteriorTransition = {
			exteriorLandblockId: LANDBLOCK_ID,
			kind: "exterior-transition",
		} as const;
		const depthContinuous = {
			kind: "indoor-depth-continuous",
			reciprocalApertureId: "portal-aperture:root-near-reciprocal",
		} as const;
		const nearWindow = rectangle(-0.8, -0.8, 0.5, 0.8);
		const farWindow = rectangle(-0.2, -0.5, 0.3, 0.5);
		const unrelatedWindow = rectangle(0.65, -0.5, 0.9, 0.5);
		const plan = requirePlan(
			topology(
				[
					topologyScope(root, sharedIsland),
					topologyScope(nearDoor, sharedIsland),
					topologyScope(farDoor, sharedIsland),
					topologyScope(unrelatedDoor, sharedIsland),
					topologyScope(OUTDOOR_SCOPE, null),
				],
				[
					crossing("root-near", root, nearDoor, {
						aperture: nearWindow,
						spatialRelationship: depthContinuous,
					}),
					crossing("near-outside", nearDoor, OUTDOOR_SCOPE, {
						aperture: nearWindow,
						spatialRelationship: exteriorTransition,
					}),
					crossing("outside-far", OUTDOOR_SCOPE, farDoor, {
						aperture: farWindow,
						spatialRelationship: exteriorTransition,
					}),
					crossing("unrelated-outside", unrelatedDoor, OUTDOOR_SCOPE, {
						aperture: unrelatedWindow,
						spatialRelationship: exteriorTransition,
					}),
				],
			),
			planInput(root),
		);

		expect(plan.maskEdges.map((edge) => edge.crossingId)).toEqual([
			"portal-crossing:near-outside",
			"portal-crossing:outside-far",
		]);
		expect(
			plan.nodes.find((node) => node.id.endsWith(sharedIsland))?.scopes,
		).toEqual([farDoor, nearDoor, root]);
		expect(plan.selectedScopes).toEqual([
			farDoor,
			nearDoor,
			OUTDOOR_SCOPE,
			root,
		]);
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

	it("rejects portal windows strictly below the pixel-area cutoff", () => {
		const interior = envCellScope("tiny-interior");
		const tinyTransition = crossing(
			"tiny-transition",
			OUTDOOR_SCOPE,
			interior,
			{
				aperture: rectangle(-0.125, -0.125, 0.125, 0.125),
				spatialRelationship: {
					exteriorLandblockId: LANDBLOCK_ID,
					kind: "exterior-transition",
				},
			},
		);
		const topologyView = topology(
			[topologyScope(OUTDOOR_SCOPE, null), topologyScope(interior, "tiny")],
			[tinyTransition],
		);
		const drawingBuffer = { height: 8, width: 8 };

		const retainedAtEquality = requirePlan(
			topologyView,
			planInput(OUTDOOR_SCOPE, {
				portalFootprint: {
					drawingBuffer,
					minimumPixelArea: 1,
				},
			}),
		);
		const rejected = requirePlan(
			topologyView,
			planInput(OUTDOOR_SCOPE, {
				portalFootprint: {
					drawingBuffer,
					minimumPixelArea: 2,
				},
			}),
		);

		expect(retainedAtEquality.nodes).toHaveLength(2);
		expect(retainedAtEquality.diagnostics.rejectedPortalFootprintCount).toBe(0);
		expect(rejected.nodes).toHaveLength(1);
		expect(rejected.maskEdges).toEqual([]);
		expect(rejected.selectedScopes).toEqual([OUTDOOR_SCOPE]);
		expect(rejected.diagnostics.rejectedPortalFootprintCount).toBe(1);
	});

	it("exempts near-plane crossings from footprint rejection", () => {
		const interior = envCellScope("interior");
		const relationship = {
			exteriorLandblockId: LANDBLOCK_ID,
			kind: "exterior-transition",
		} as const;
		const tinyAperture = rectangle(-0.125, -0.125, 0.125, 0.125);
		const footprint = {
			drawingBuffer: { height: 8, width: 8 },
			minimumPixelArea: 2,
		};
		const nearPlanePlan = requirePlan(
			topology(
				[topologyScope(OUTDOOR_SCOPE, null), topologyScope(interior, "inside")],
				[
					crossing("near-transition", OUTDOOR_SCOPE, interior, {
						aperture: tinyAperture,
						spatialRelationship: relationship,
					}),
				],
			),
			planInput(OUTDOOR_SCOPE, {
				nearClipVolume: testNearClipVolume(1),
				portalFootprint: footprint,
			}),
		);

		expect(nearPlanePlan.nodes).toHaveLength(2);
		expect(nearPlanePlan.maskEdges[0]?.maskSource.kind).toBe(
			"near-clip-window",
		);
		expect(nearPlanePlan.diagnostics.rejectedPortalFootprintCount).toBe(0);
	});

	it("rejects a negligible indoor exit before scheduling exterior work", () => {
		const interior = envCellScope("interior");
		const exitPlan = requirePlan(
			topology(
				[topologyScope(interior, "inside"), topologyScope(OUTDOOR_SCOPE, null)],
				[
					crossing("tiny-exit", interior, OUTDOOR_SCOPE, {
						aperture: rectangle(-0.125, -0.125, 0.125, 0.125),
						spatialRelationship: {
							exteriorLandblockId: LANDBLOCK_ID,
							kind: "exterior-transition",
						},
					}),
				],
			),
			planInput(interior, {
				portalFootprint: {
					drawingBuffer: { height: 8, width: 8 },
					minimumPixelArea: 2,
				},
			}),
		);

		expect(exitPlan.nodes).toHaveLength(1);
		expect(exitPlan.maskEdges).toEqual([]);
		expect(exitPlan.exteriorTransitions).toEqual([]);
		expect(exitPlan.selectedScopes).toEqual([interior]);
		expect(exitPlan.diagnostics.rejectedPortalFootprintCount).toBe(1);
	});

	it("rejects a negligible same-domain boundary and all work behind it", () => {
		const root = envCellScope("same-domain-root");
		const target = envCellScope("same-domain-target");
		const descendant = envCellScope("same-domain-descendant");
		const plan = requirePlan(
			topology(
				[
					topologyScope(root, "shared"),
					topologyScope(target, "shared"),
					topologyScope(descendant, "shared"),
				],
				[
					crossing("tiny-boundary", root, target, {
						aperture: rectangle(-0.125, -0.125, 0.125, 0.125),
					}),
					crossing("hidden-descendant", target, descendant),
				],
			),
			planInput(root, {
				portalFootprint: {
					drawingBuffer: { height: 8, width: 8 },
					minimumPixelArea: 2,
				},
			}),
		);

		expect(plan.nodes).toEqual([expect.objectContaining({ scopes: [root] })]);
		expect(plan.maskEdges).toEqual([]);
		expect(plan.selectedScopes).toEqual([root]);
		expect(plan.diagnostics.attemptedCrossingCount).toBe(1);
		expect(plan.diagnostics.admittedScopeWindowStateCount).toBe(1);
		expect(plan.diagnostics.rejectedPortalFootprintCount).toBe(1);
	});

	it("admits exterior through a larger exit after rejecting its smaller route", () => {
		const interior = envCellScope("alternate-exit-interior");
		const relationship = {
			exteriorLandblockId: LANDBLOCK_ID,
			kind: "exterior-transition",
		} as const;
		const plan = requirePlan(
			topology(
				[topologyScope(OUTDOOR_SCOPE, null), topologyScope(interior, "inside")],
				[
					crossing("small-route", interior, OUTDOOR_SCOPE, {
						aperture: rectangle(-0.125, -0.125, 0.125, 0.125),
						spatialRelationship: relationship,
					}),
					crossing("large-route", interior, OUTDOOR_SCOPE, {
						aperture: rectangle(-0.5, -0.5, 0.5, 0.5),
						spatialRelationship: relationship,
					}),
				],
			),
			planInput(interior, {
				portalFootprint: {
					drawingBuffer: { height: 8, width: 8 },
					minimumPixelArea: 2,
				},
			}),
		);

		expect(plan.nodes).toHaveLength(2);
		expect(plan.maskEdges.map((edge) => edge.crossingId)).toEqual([
			"portal-crossing:large-route",
		]);
		expect(plan.diagnostics.rejectedPortalFootprintCount).toBe(1);
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
			indoorLayer(0, ["portal-render-node:env-cell-island:root"]),
			indoorLayer(
				1,
				["portal-render-node:env-cell-island:adjacent"],
				["portal-crossing:straddled"],
			),
		]);
	});

	it("does not immediately backtrack through a straddled reciprocal portal", () => {
		const root = envCellScope("root");
		const exteriorTransition = {
			exteriorLandblockId: LANDBLOCK_ID,
			kind: "exterior-transition",
		} as const;
		const plan = requirePlan(
			topology(
				[topologyScope(root, "root"), topologyScope(OUTDOOR_SCOPE, null)],
				[
					crossing("exit", root, OUTDOOR_SCOPE, {
						reciprocalCrossingId: "portal-crossing:return",
						spatialRelationship: exteriorTransition,
					}),
					crossing("return", OUTDOOR_SCOPE, root, {
						reciprocalCrossingId: "portal-crossing:exit",
						spatialRelationship: exteriorTransition,
					}),
				],
			),
			planInput(root, { nearClipVolume: testNearClipVolume(1) }),
		);

		expect(plan.maskEdges.map((edge) => edge.crossingId)).toEqual([
			"portal-crossing:exit",
		]);
		expect(plan.diagnostics).toMatchObject({
			attemptedCrossingCount: 1,
			cyclicComponentCount: 0,
			nearPlaneSeedCount: 1,
		});
		expect(requireExteriorContribution(plan)).toMatchObject({
			componentNodeIds: ["portal-render-node:outdoor"],
			maskEdgeIds: ["portal-crossing:exit"],
			rootContained: false,
			suffix: null,
		});
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
		expect(plan.renderLayers[0]).toEqual(
			indoorLayer(0, ["portal-render-node:env-cell-island:root"]),
		);
		expect(plan.renderLayers[1]).toEqual(
			indoorLayer(
				1,
				["portal-render-node:env-cell-island:adjacent"],
				["portal-crossing:inside-near-clip-volume"],
			),
		);
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
			indoorLayer(0, ["portal-render-node:env-cell-island:root"]),
			{
				contributions: [expect.objectContaining({ kind: "exterior" })],
				renderLayer: 1,
			},
			indoorLayer(
				2,
				["portal-render-node:env-cell-island:other-building"],
				["portal-crossing:outside-other-building"],
			),
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
			indoorLayer(
				1,
				["portal-render-node:env-cell-island:parent"],
				["portal-crossing:root-parent"],
			),
			indoorLayer(
				2,
				["portal-render-node:env-cell-island:adjacent"],
				["portal-crossing:parent-adjacent"],
			),
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

		expect(plan.maskEdges).toEqual([
			expect.objectContaining({
				crossingId: forwardId,
				maskSource: {
					depthPolicy: "allow-equal-depth",
					kind: "world-aperture",
					visibilityApertureId: "portal-aperture:forward/visibility",
				},
			}),
		]);
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
			workItemCount: 5,
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
		expect(requireExteriorContribution(plan)).toEqual({
			componentNodeIds: ["portal-render-node:outdoor"],
			entryMaskEdgeIds: ["portal-crossing:outside"],
			kind: "exterior",
			maskEdgeIds: ["portal-crossing:outside"],
			outdoorNodeId: "portal-render-node:outdoor",
			renderLayer: 1,
			returnMaskEdgeIds: [],
			rootContained: false,
			stencilValue: 1,
			suffix: null,
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

		expect(requireExteriorContribution(plan)).toEqual({
			componentNodeIds: [
				"portal-render-node:env-cell-island:suffix",
				"portal-render-node:outdoor",
			],
			entryMaskEdgeIds: ["portal-crossing:enter-outside"],
			kind: "exterior",
			maskEdgeIds: ["portal-crossing:enter-outside"],
			outdoorNodeId: "portal-render-node:outdoor",
			renderLayer: 1,
			returnMaskEdgeIds: ["portal-crossing:suffix-outside"],
			rootContained: false,
			stencilValue: 2,
			suffix: {
				maskEdgeIds: ["portal-crossing:outside-suffix"],
				submissions: [
					{
						kind: "deferred",
						renderNodeIds: ["portal-render-node:env-cell-island:suffix"],
					},
				],
				stencilTransition: { from: 2, kind: "promote-if-equal", to: 3 },
			},
		});
		expect(plan.capacity.requiredMaximumStencilValue).toBe(3);
		expect(plan.diagnostics.cyclicComponentCount).toBe(1);
	});

	it("retains a root-contained exterior return as an additional suffix", () => {
		const root = envCellScope("root");
		const exteriorTransition = {
			exteriorLandblockId: LANDBLOCK_ID,
			kind: "exterior-transition",
		} as const;
		const plan = requirePlan(
			topology(
				[topologyScope(root, "root"), topologyScope(OUTDOOR_SCOPE, null)],
				[
					crossing("root-outside", root, OUTDOOR_SCOPE, {
						spatialRelationship: exteriorTransition,
					}),
					crossing("outside-root", OUTDOOR_SCOPE, root, {
						spatialRelationship: exteriorTransition,
					}),
				],
			),
			planInput(root),
		);

		expect(requireExteriorContribution(plan)).toMatchObject({
			componentNodeIds: [
				"portal-render-node:env-cell-island:root",
				"portal-render-node:outdoor",
			],
			kind: "exterior",
			rootContained: true,
			suffix: {
				maskEdgeIds: ["portal-crossing:outside-root"],
				submissions: [
					{
						kind: "additional",
						renderNodeIds: ["portal-render-node:env-cell-island:root"],
					},
				],
			},
		});
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

		const exterior = requireExteriorContribution(plan);
		expect(exterior.componentNodeIds).toEqual([
			"portal-render-node:env-cell-island:suffix",
			"portal-render-node:outdoor",
		]);
		expect(exterior.suffix).toEqual({
			maskEdgeIds: ["portal-crossing:outside-suffix"],
			submissions: [
				{
					kind: "deferred",
					renderNodeIds: ["portal-render-node:env-cell-island:suffix"],
				},
			],
			stencilTransition: { from: 2, kind: "promote-if-equal", to: 3 },
		});
		expect(plan.capacity).toMatchObject({
			maximumRenderLayer: 1,
			requiredMaximumStencilValue: 3,
		});
		expect(plan.renderLayers[1]).toEqual({
			contributions: [
				exterior,
				{
					kind: "indoor",
					maskEdgeIds: ["portal-crossing:root-sibling"],
					renderNodeIds: ["portal-render-node:env-cell-island:sibling"],
					stencilValue: 1,
				},
			],
			renderLayer: 1,
		});
	});
});

describe("portal scope-window culler bridge", () => {
	it("matches the immutable planner coverage through a cyclic topology", () => {
		const middle = envCellScope("middle");
		const leaf = envCellScope("leaf");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(middle, "middle"),
				topologyScope(leaf, "leaf"),
			],
			[
				crossing("out-middle", OUTDOOR_SCOPE, middle, {
					aperture: rectangle(-0.9, -0.9, -0.1, 0.9),
				}),
				crossing("middle-leaf", middle, leaf, {
					aperture: rectangle(-0.8, -0.8, -0.2, 0.8),
				}),
				crossing("leaf-out", leaf, OUTDOOR_SCOPE, {
					aperture: rectangle(-0.7, -0.7, -0.3, 0.7),
				}),
			],
		);
		const input = planInput(OUTDOOR_SCOPE);
		const expected = requirePlan(graph, input).scopeWindows;
		const culler = new PortalScopeWindowCuller({
			maximumDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
			maximumProjectionPrimitiveCount: 100_000,
			maximumWorkItemCount: 64,
			windowArena: scopeWindowArenaCapacity(),
		});

		const actual = culler.cull(graph, input);

		expect(actual.status).toBe("complete");
		expect(scopeWindowSnapshot(actual)).toEqual(
			expected
				.map(({ scope, window }) => ({
					scope: scopeIdentity(scope),
					window: windowSnapshot(window),
				}))
				.sort((left, right) => left.scope.localeCompare(right.scope)),
		);
		expect(actual.trace.queueHighWaterCount).toBeGreaterThan(0);
		expect(actual.trace.arenaCapacityBytes).toBeGreaterThan(0);
	});

	it("matches near-plane and multipart immutable projection results", () => {
		const nearChild = envCellScope("near-child");
		const splitChild = envCellScope("split-child");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(nearChild, "near-child"),
				topologyScope(splitChild, "split-child"),
			],
			[
				crossing("near", OUTDOOR_SCOPE, nearChild, {
					aperture: rectangle(-0.8, -0.8, 0.8, 0.8, 0.75),
				}),
				crossing("split", OUTDOOR_SCOPE, splitChild, {
					aperture: splitAperture(),
				}),
			],
		);
		const input = planInput(OUTDOOR_SCOPE);
		const expected = requirePlan(graph, input).scopeWindows;
		const culler = new PortalScopeWindowCuller({
			maximumDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
			maximumProjectionPrimitiveCount: 100_000,
			maximumWorkItemCount: 64,
			windowArena: scopeWindowArenaCapacity(),
		});

		const actual = culler.cull(graph, input);

		expect(scopeWindowSnapshot(actual)).toEqual(
			expected
				.map(({ scope, window }) => ({
					scope: scopeIdentity(scope),
					window: windowSnapshot(window),
				}))
				.sort((left, right) => left.scope.localeCompare(right.scope)),
		);
		let splitOrdinal = -1;
		for (let ordinal = 0; ordinal < actual.selectedScopeCount; ordinal += 1) {
			if (
				scopeIdentity(actual.selectedScope(ordinal)).endsWith("/split-child")
			) {
				splitOrdinal = ordinal;
				break;
			}
		}
		expect(splitOrdinal).toBeGreaterThanOrEqual(0);
		expect(actual.selectedFragmentCount(splitOrdinal)).toBe(2);
	});

	it("declines a whole fan-out frontier when fixed queue capacity is exhausted", () => {
		const left = envCellScope("left");
		const right = envCellScope("right");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(left, "left"),
				topologyScope(right, "right"),
			],
			[
				crossing("left", OUTDOOR_SCOPE, left),
				crossing("right", OUTDOOR_SCOPE, right),
			],
		);
		const culler = new PortalScopeWindowCuller({
			maximumDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
			maximumProjectionPrimitiveCount: 100_000,
			maximumWorkItemCount: 2,
			windowArena: scopeWindowArenaCapacity(),
		});

		const frame = culler.cull(graph, planInput(OUTDOOR_SCOPE));

		expect(frame.status).toBe("truncated");
		expect(frame.completedDepth).toBe(0);
		expect(frame.declinedDepth).toBe(1);
		expect(frame.trace.exceptionalDiagnosticHeapRecordCreationCount).toBe(1);
		expect(scopeWindowSnapshot(frame)).toEqual([
			{
				scope: "outdoor",
				window: windowSnapshot(createFullPortalViewWindow()),
			},
		]);
	});

	it("reports the first unexpanded frontier when fixed traversal depth is reached", () => {
		const middle = envCellScope("middle");
		const leaf = envCellScope("leaf");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(middle, "middle"),
				topologyScope(leaf, "leaf"),
			],
			[
				crossing("middle", OUTDOOR_SCOPE, middle),
				crossing("leaf", middle, leaf),
			],
		);
		const culler = new PortalScopeWindowCuller({
			maximumDepth: 1,
			maximumProjectionPrimitiveCount: 100_000,
			maximumWorkItemCount: 8,
			windowArena: scopeWindowArenaCapacity(),
		});

		const frame = culler.cull(graph, planInput(OUTDOOR_SCOPE));

		expect(frame.status).toBe("truncated");
		expect(frame.completedDepth).toBe(1);
		expect(frame.declinedDepth).toBe(2);
		expect(frame.trace.exceptionalDiagnosticHeapRecordCreationCount).toBe(0);
		expect(scopeWindowSnapshot(frame).map(({ scope }) => scope)).toEqual([
			scopeIdentity(middle),
			"outdoor",
		]);
	});

	it("declines a whole frontier when committed polygon capacity is exhausted", () => {
		const child = envCellScope("child");
		const graph = topology(
			[topologyScope(OUTDOOR_SCOPE, null), topologyScope(child, "child")],
			[crossing("child", OUTDOOR_SCOPE, child)],
		);
		const culler = new PortalScopeWindowCuller({
			maximumDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
			maximumProjectionPrimitiveCount: 100_000,
			maximumWorkItemCount: 8,
			windowArena: {
				...scopeWindowArenaCapacity(),
				maximumFragmentCount: 1,
			},
		});

		const frame = culler.cull(graph, planInput(OUTDOOR_SCOPE));

		expect(frame.status).toBe("truncated");
		expect(frame.completedDepth).toBe(0);
		expect(frame.declinedDepth).toBe(1);
		expect(frame.trace.exceptionalDiagnosticHeapRecordCreationCount).toBe(1);
		expect(scopeWindowSnapshot(frame)).toEqual([
			{
				scope: "outdoor",
				window: windowSnapshot(createFullPortalViewWindow()),
			},
		]);
		expect(frame.trace.portalOwnedFrameHeapRecordCreationCount).toBe(0);
	});

	it("declines the frontier before a projection exceeds its atomic primitive budget", () => {
		const child = envCellScope("child");
		const maximumProjectionPrimitiveCount = 1;
		const graph = topology(
			[topologyScope(OUTDOOR_SCOPE, null), topologyScope(child, "child")],
			[crossing("child", OUTDOOR_SCOPE, child)],
		);
		const culler = new PortalScopeWindowCuller({
			maximumDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
			maximumProjectionPrimitiveCount,
			maximumWorkItemCount: 8,
			windowArena: scopeWindowArenaCapacity(),
		});

		const frame = culler.cull(graph, planInput(OUTDOOR_SCOPE));

		expect(frame.status).toBe("truncated");
		expect(frame.completedDepth).toBe(0);
		expect(frame.declinedDepth).toBe(1);
		expect(frame.trace.exceptionalDiagnosticHeapRecordCreationCount).toBe(1);
		expect(frame.selectedScopeCount).toBe(1);
		expect(scopeIdentity(frame.selectedScope(0))).toBe("outdoor");
		expect(frame.trace.projectionPrimitiveCount).toBeGreaterThan(
			maximumProjectionPrimitiveCount,
		);
	});

	it("reuses its frame view and arena until topology actually changes", () => {
		const firstGraph = topology([topologyScope(OUTDOOR_SCOPE, null)], []);
		const secondGraph = {
			...topology([topologyScope(OUTDOOR_SCOPE, null)], []),
			revision: firstGraph.revision,
		};
		const capacity = {
			maximumDepth: PORTAL_RENDER_CAPACITY_POLICY.maximumPathDepth,
			maximumProjectionPrimitiveCount: 100_000,
			maximumWorkItemCount: 8,
			windowArena: scopeWindowArenaCapacity(),
		};
		const culler = new PortalScopeWindowCuller(capacity);
		const firstFrame = culler.cull(firstGraph, planInput(OUTDOOR_SCOPE));
		const trace = firstFrame.trace;
		const secondFrame = culler.cull(firstGraph, planInput(OUTDOOR_SCOPE));

		expect(secondFrame).toBe(firstFrame);
		expect(secondFrame.trace).toBe(trace);
		expect(secondFrame.trace.topologyBuildCount).toBe(1);
		expect(secondFrame.trace.exceptionalDiagnosticHeapRecordCreationCount).toBe(
			0,
		);
		expect(secondFrame.trace.portalOwnedFrameHeapRecordCreationCount).toBe(0);
		expect(secondFrame.trace.arenaGrowthCount).toBe(0);

		const changedFrame = culler.cull(secondGraph, planInput(OUTDOOR_SCOPE));
		expect(changedFrame.trace.topologyBuildCount).toBe(2);
	});
});

describe("portal scope-atlas planning", () => {
	it("packs conservative tile bounds and derives clip transforms without heap records", () => {
		const child = envCellScope("child");
		const graph = topology(
			[topologyScope(OUTDOOR_SCOPE, null), topologyScope(child, "child")],
			[
				crossing("child", OUTDOOR_SCOPE, child, {
					aperture: rectangle(-0.5, -0.5, 0.5, 0.5),
				}),
			],
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);

		const frame = planner.plan(graph, input, {
			atlas: { height: 100, width: 200 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});

		expect(frame.visibility.status).toBe("complete");
		expect(frame.tileCount).toBe(2);
		expect(frame.tileX(0)).toBe(0);
		expect(frame.tileY(0)).toBe(0);
		expect(frame.tileWidth(0)).toBe(100);
		expect(frame.tileHeight(0)).toBe(100);
		expect(frame.tileX(1)).toBe(100);
		expect(frame.tileY(1)).toBe(0);
		expect(frame.tileWidth(1)).toBe(50);
		expect(frame.tileHeight(1)).toBe(50);
		expect(frame.tileClipScaleX(1)).toBe(2);
		expect(frame.tileClipScaleY(1)).toBe(2);
		expect(frame.tileClipOffsetX(1)).toBe(0);
		expect(frame.tileClipOffsetY(1)).toBe(0);
		expect(frame.tileOrdinalForRenderScopeKey("outdoor")).toBe(0);
		expect(frame.tileOrdinalForRenderScopeKey(child.envCellId)).toBe(1);
		expect(() => frame.tileOrdinalForRenderScopeKey("missing")).toThrow(
			"unavailable in this topology",
		);
		expect(frame.trace).toMatchObject({
			arenaGrowthCount: 0,
			atlasPackedExtentPixelCount: 15_000,
			atlasPixelCapacity: 20_000,
			frontierRetreatCount: 0,
			packingAttemptCount: 1,
			portalOwnedFrameHeapRecordCreationCount: 0,
			tilePixelCount: 12_500,
			tilePlacementAttemptCount: 2,
			windowVertexReadCount: 8,
		});
		expect(frame.trace.arenaCapacityBytes).toBeGreaterThan(0);
	});

	it("retreats complete frontiers until fixed atlas capacity fits without re-culling", () => {
		const middle = envCellScope("middle");
		const leaf = envCellScope("leaf");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(middle, "middle"),
				topologyScope(leaf, "leaf"),
			],
			[
				crossing("root-middle", OUTDOOR_SCOPE, middle, {
					aperture: rectangle(-1, -0.5, 1, 0.5),
				}),
				crossing("middle-leaf", middle, leaf, {
					aperture: rectangle(-1, -0.25, 1, 0.25),
				}),
			],
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);

		const frame = planner.plan(graph, input, {
			atlas: { height: 150, width: 100 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});

		expect(frame.visibility.status).toBe("truncated");
		expect(frame.visibility.completedDepth).toBe(1);
		expect(frame.visibility.declinedDepth).toBe(2);
		expect(frame.visibility.selectedScopeCount).toBe(2);
		expect(frame.visibility.selectedCrossingCount).toBe(1);
		expect(frame.visibility.selectedCrossing(0).id).toBe(
			"portal-crossing:root-middle",
		);
		expect(() => frame.tileOrdinalForRenderScopeKey(leaf.envCellId)).toThrow(
			"has no selected atlas tile",
		);
		expect(frame.trace.frontierRetreatCount).toBe(2);
		expect(frame.trace.atlasCapacityRetreatCount).toBe(2);
		expect(frame.trace.arrivalStateCapacityRetreatCount).toBe(0);
		expect(frame.trace.packingAttemptCount).toBe(3);
		expect(frame.commands).toEqual({
			crossingInstancePreparationCount: 1,
			frontierClearCommandCount: 1,
			maskPropagationCommandCount: 1,
			maskPropagationInstanceCount: 1,
			opaqueCompositeCommandCount: 1,
			opaqueCompositeInstanceCount: 2,
			scopeEnvelopeReductionCommandCount: 1,
			scopeEnvelopeReductionInstanceCount: 2,
			traversalDepth: 1,
		});
		// Projection is charged once by culling; packing retries only revisit retained window vertices.
		expect(frame.visibility.trace.projectionPrimitiveCount).toBeGreaterThan(0);
	});

	it("retreats before packing when arrival-state ids exceed their fixed format", () => {
		const middle = envCellScope("state-middle");
		const leaf = envCellScope("state-leaf");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(middle, "state-middle"),
				topologyScope(leaf, "state-leaf"),
			],
			[
				crossing("state-middle", OUTDOOR_SCOPE, middle),
				crossing("state-leaf", middle, leaf),
			],
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);

		const frame = planner.plan(graph, input, {
			atlas: { height: 300, width: 300 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount: 2,
		});

		expect(frame.visibility.status).toBe("truncated");
		expect(frame.visibility.completedDepth).toBe(1);
		expect(frame.visibility.declinedDepth).toBe(2);
		expect(frame.visibility.selectedCrossingCount).toBe(1);
		expect(frame.trace).toMatchObject({
			atlasCapacityRetreatCount: 0,
			// The terminal empty frontier is discarded before the crossing-bearing frontier.
			arrivalStateCapacityRetreatCount: 2,
			frontierRetreatCount: 2,
			packingAttemptCount: 1,
		});
	});

	it("retreats before packing when expanded crossing triangles exceed fixed storage", () => {
		const middle = envCellScope("stream-middle");
		const leaf = envCellScope("stream-leaf");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(middle, "stream-middle"),
				topologyScope(leaf, "stream-leaf"),
			],
			[
				crossing("stream-middle", OUTDOOR_SCOPE, middle),
				crossing("stream-leaf", middle, leaf),
			],
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);

		const frame = planner.plan(graph, input, {
			atlas: { height: 300, width: 300 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount: 6,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});

		expect(frame.visibility.status).toBe("truncated");
		expect(frame.visibility.completedDepth).toBe(1);
		expect(frame.visibility.selectedCrossingCount).toBe(1);
		expect(frame.trace).toMatchObject({
			atlasCapacityRetreatCount: 0,
			arrivalStateCapacityRetreatCount: 0,
			crossingTriangleVertexCapacityRetreatCount: 2,
			crossingTriangleVertexCount: 6,
			frontierRetreatCount: 2,
			packingAttemptCount: 1,
		});
	});

	it("expands retained indexed apertures once into one reused interleaved stream", () => {
		const first = envCellScope("stream-first");
		const second = envCellScope("stream-second");
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(first, "stream-first"),
				topologyScope(second, "stream-second"),
			],
			[
				crossing("a-stream-first", OUTDOOR_SCOPE, first),
				crossing("b-stream-second", OUTDOOR_SCOPE, second, {
					maskDepthPolicy: "reject-equal-depth",
				}),
			],
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);
		const frame = planner.plan(graph, input, {
			atlas: { height: 300, width: 300 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount: 12,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});
		const stream = new PortalPropagationStreamArena(12);

		const firstView = stream.prepare(
			frame,
			input.anchorCoordinates,
			input.clipFromAnchor,
		);
		const secondView = stream.prepare(
			frame,
			input.anchorCoordinates,
			input.clipFromAnchor,
		);
		const slots = new Uint32Array(stream.bytes.buffer);
		const metadataRecordSlotCount =
			PORTAL_ARRIVAL_METADATA_RECORD_BYTES / Uint32Array.BYTES_PER_ELEMENT;
		const cameraSlotCount =
			PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES /
			Float32Array.BYTES_PER_ELEMENT;
		const firstCrossingRecordOffset = cameraSlotCount + metadataRecordSlotCount;
		const secondCrossingRecordOffset =
			cameraSlotCount + metadataRecordSlotCount * 2;
		const metadataScopeSlot =
			PORTAL_ARRIVAL_METADATA_SCOPE_OFFSET_BYTES /
			Uint32Array.BYTES_PER_ELEMENT;
		const metadataReciprocalSlot =
			PORTAL_ARRIVAL_METADATA_RECIPROCAL_OFFSET_BYTES /
			Uint32Array.BYTES_PER_ELEMENT;
		const metadataFlagsSlot =
			PORTAL_ARRIVAL_METADATA_FLAGS_OFFSET_BYTES /
			Uint32Array.BYTES_PER_ELEMENT;

		expect(secondView).toBe(firstView);
		expect(secondView.vertexCount).toBe(12);
		expect(secondView.usedByteLength).toBe(
			12 * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
		);
		expect(secondView.trace).toMatchObject({
			arenaCapacityBytes:
				12 * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES +
				PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
			arenaGrowthCount: 0,
			arrivalMetadataStateWriteCount: 3,
			arrivalPlaneScalarWriteCount: 8,
			crossingInputCount: 2,
			portalOwnedFrameHeapRecordCreationCount: 0,
			positionScalarReadCount: 36,
			propagationMetadataCapacityBytes:
				PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
			reciprocalArrivalStateReadCount: 2,
			scopeMetadataStateWriteCount: 3,
			triangleIndexReadCount: 12,
			triangleCapacityBytes: 12 * PORTAL_CROSSING_TRIANGLE_VERTEX_STRIDE_BYTES,
			vertexHighWaterCount: 12,
		});
		expect(secondView.arrivalMetadataStateCount).toBe(3);
		expect(secondView.scopeMetadataStateCount).toBe(3);
		expect(secondView.usedPropagationMetadataByteLength).toBe(
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
		);
		const arrivalFloats = new Float32Array(
			stream.propagationMetadataBytes.buffer,
		);
		const arrivalUints = new Uint32Array(
			stream.propagationMetadataBytes.buffer,
		);
		expect(
			Array.from(
				arrivalFloats.slice(
					firstCrossingRecordOffset,
					firstCrossingRecordOffset + PORTAL_ARRIVAL_METADATA_PLANE_FLOAT_COUNT,
				),
			),
		).toEqual([-0, -0, -1, -0]);
		expect(
			[metadataScopeSlot, metadataReciprocalSlot, metadataFlagsSlot].map(
				(slot) => arrivalUints[firstCrossingRecordOffset + slot],
			),
		).toEqual([1, 0, PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE]);
		expect(
			[metadataScopeSlot, metadataReciprocalSlot, metadataFlagsSlot].map(
				(slot) => arrivalUints[secondCrossingRecordOffset + slot],
			),
		).toEqual([2, 0, PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE]);
		const rootScopeMetadataOffset =
			PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES /
			Uint32Array.BYTES_PER_ELEMENT;
		expect(
			Array.from(
				arrivalUints.slice(
					rootScopeMetadataOffset,
					rootScopeMetadataOffset +
						PORTAL_SCOPE_TILE_METADATA_RECORD_BYTES /
							Uint32Array.BYTES_PER_ELEMENT,
				),
			),
		).toEqual([
			frame.tileX(0),
			frame.tileY(0),
			frame.tileScreenX(0),
			frame.tileScreenY(0),
			frame.tileWidth(0),
			frame.tileHeight(0),
			0,
			0,
		]);
		// Slot 3/4/5 are output arrival, source scope, and depth policy respectively.
		expect(Array.from(slots.slice(3, 6))).toEqual([
			2,
			0,
			PORTAL_CROSSING_DEPTH_POLICY_ALLOW_EQUAL,
		]);
		expect(Array.from(slots.slice(6 * 6 + 3, 6 * 6 + 6))).toEqual([
			3,
			0,
			PORTAL_CROSSING_DEPTH_POLICY_REJECT_EQUAL,
		]);
	});

	it("resolves selected reciprocal crossings to their packed arrival ids", () => {
		const left = envCellScope("reciprocal-left");
		const right = envCellScope("reciprocal-right");
		const leftToRightId = "portal-crossing:left-right" as const;
		const rightToLeftId = "portal-crossing:right-left" as const;
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				topologyScope(left, "reciprocal-left"),
				topologyScope(right, "reciprocal-right"),
			],
			[
				crossing("root-left", OUTDOOR_SCOPE, left, {
					aperture: rectangle(-0.9, -0.8, -0.1, 0.8),
				}),
				crossing("root-right", OUTDOOR_SCOPE, right, {
					aperture: rectangle(0.1, -0.8, 0.9, 0.8),
				}),
				crossing("left-right", left, right, {
					aperture: rectangle(-0.9, -0.8, -0.1, 0.8),
					reciprocalCrossingId: rightToLeftId,
				}),
				crossing("right-left", right, left, {
					aperture: rectangle(0.1, -0.8, 0.9, 0.8),
					reciprocalCrossingId: leftToRightId,
				}),
			],
		);
		const input = atlasPlanInput(OUTDOOR_SCOPE);
		const frame = scopeAtlasPlanner().plan(graph, input, {
			atlas: { height: 300, width: 300 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount: 24,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});
		const selectedOrdinalById = new Map<PortalCrossingId, number>();
		for (
			let ordinal = 0;
			ordinal < frame.visibility.selectedCrossingCount;
			ordinal += 1
		) {
			selectedOrdinalById.set(
				frame.visibility.selectedCrossing(ordinal).id,
				ordinal,
			);
		}
		const leftToRightOrdinal = selectedOrdinalById.get(leftToRightId);
		const rightToLeftOrdinal = selectedOrdinalById.get(rightToLeftId);
		expect(leftToRightOrdinal).toBeTypeOf("number");
		expect(rightToLeftOrdinal).toBeTypeOf("number");
		if (leftToRightOrdinal === undefined || rightToLeftOrdinal === undefined) {
			throw new Error("Reciprocal cycle crossings were not selected.");
		}

		expect(
			frame.visibility.selectedCrossingReciprocalArrivalStateId(
				leftToRightOrdinal,
			),
		).toBe(rightToLeftOrdinal + 2);
		expect(
			frame.visibility.selectedCrossingReciprocalArrivalStateId(
				rightToLeftOrdinal,
			),
		).toBe(leftToRightOrdinal + 2);
	});

	it("bounds propagation by selected crossings and reuses its frame records", () => {
		const child = envCellScope("child");
		const graph = topology(
			[topologyScope(OUTDOOR_SCOPE, null), topologyScope(child, "child")],
			[crossing("child", OUTDOOR_SCOPE, child)],
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);
		const resource = {
			atlas: { height: 100, width: 200 },
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		};

		const first = planner.plan(graph, input, resource);
		const commands = first.commands;
		const trace = first.trace;
		const second = planner.plan(graph, input, resource);

		expect(second).toBe(first);
		expect(second.commands).toBe(commands);
		expect(second.trace).toBe(trace);
		expect(second.commands.traversalDepth).toBe(1);
		expect(second.commands.maskPropagationCommandCount).toBe(1);
		expect(second.commands.scopeEnvelopeReductionCommandCount).toBe(1);
	});

	it("keeps a dense deterministic tile corpus in bounds without overlap", () => {
		const children = Array.from(
			{ length: TEST_ATLAS_PACKING_CHILD_COUNT },
			(_, ordinal) => envCellScope(`packing-${ordinal}`),
		);
		const graph = topology(
			[
				topologyScope(OUTDOOR_SCOPE, null),
				...children.map((scope, ordinal) =>
					topologyScope(scope, `packing-${ordinal}`),
				),
			],
			children.map((target, ordinal) => {
				const column = ordinal % 6;
				const row = Math.floor(ordinal / 6);
				const centerX = -0.75 + column * 0.3;
				const centerY = -0.75 + row * 0.5;
				const width = 0.1 + (ordinal % 4) * 0.08;
				const height = 0.1 + (ordinal % 3) * 0.1;
				return crossing(`packing-${ordinal}`, OUTDOOR_SCOPE, target, {
					aperture: rectangle(
						centerX - width / 2,
						centerY - height / 2,
						centerX + width / 2,
						centerY + height / 2,
					),
				});
			}),
		);
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);

		const frame = planner.plan(graph, input, {
			atlas: {
				height: TEST_ATLAS_PACKING_EXTENT,
				width: TEST_ATLAS_PACKING_EXTENT,
			},
			drawingBuffer: input.portalFootprint.drawingBuffer,
			maximumCrossingTriangleVertexCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
					.maximumCrossingTriangleVertexCount,
			maximumArrivalStateCount:
				PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
		});

		expect(frame.tileCount).toBe(TEST_ATLAS_PACKING_CHILD_COUNT + 1);
		expect(frame.trace.packingAttemptCount).toBe(1);
		expect(frame.trace.tilePlacementAttemptCount).toBe(frame.tileCount);
		expect(frame.trace.windowVertexReadCount).toBe(
			frame.tileCount * TEST_RECTANGLE_VERTEX_COUNT,
		);
		expect(frame.trace.tileSortComparisonCount).toBeLessThanOrEqual(
			frame.tileCount * Math.ceil(Math.log2(frame.tileCount)),
		);
		expect(frame.trace.atlasPackedExtentPixelCount).toBeLessThanOrEqual(
			frame.trace.atlasPixelCapacity,
		);
		for (let left = 0; left < frame.tileCount; left += 1) {
			expect(frame.tileX(left) + frame.tileWidth(left)).toBeLessThanOrEqual(
				TEST_ATLAS_PACKING_EXTENT,
			);
			expect(frame.tileY(left) + frame.tileHeight(left)).toBeLessThanOrEqual(
				TEST_ATLAS_PACKING_EXTENT,
			);
			for (let right = left + 1; right < frame.tileCount; right += 1) {
				const separated =
					frame.tileX(left) + frame.tileWidth(left) <= frame.tileX(right) ||
					frame.tileX(right) + frame.tileWidth(right) <= frame.tileX(left) ||
					frame.tileY(left) + frame.tileHeight(left) <= frame.tileY(right) ||
					frame.tileY(right) + frame.tileHeight(right) <= frame.tileY(left);
				expect(separated, `tile overlap ${left}/${right}`).toBe(true);
			}
		}
		expect(frame.commands.maskPropagationInstanceCount).toBe(
			TEST_ATLAS_MAXIMUM_PATH_DEPTH * TEST_ATLAS_PACKING_CHILD_COUNT,
		);
		expect(frame.commands.scopeEnvelopeReductionInstanceCount).toBe(
			TEST_ATLAS_MAXIMUM_PATH_DEPTH * frame.tileCount,
		);
	});

	it("rejects a resource that cannot always retain the root tile", () => {
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(OUTDOOR_SCOPE);
		const graph = topology([topologyScope(OUTDOOR_SCOPE, null)], []);

		expect(() =>
			planner.plan(graph, input, {
				atlas: { height: 100, width: 99 },
				drawingBuffer: input.portalFootprint.drawingBuffer,
				maximumCrossingTriangleVertexCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
						.maximumCrossingTriangleVertexCount,
				maximumArrivalStateCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
			}),
		).toThrow("retain the full drawing-buffer root tile");
	});

	it("rejects resource dimensions and trace totals that cannot fit their storage", () => {
		const planner = scopeAtlasPlanner();
		const graph = topology([topologyScope(OUTDOOR_SCOPE, null)], []);
		const ordinaryInput = atlasPlanInput(OUTDOOR_SCOPE);

		expect(() =>
			planner.plan(graph, ordinaryInput, {
				atlas: { height: 0, width: 100 },
				drawingBuffer: ordinaryInput.portalFootprint.drawingBuffer,
				maximumCrossingTriangleVertexCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
						.maximumCrossingTriangleVertexCount,
				maximumArrivalStateCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
			}),
		).toThrow("fit a positive Uint32");
		expect(() =>
			planner.plan(graph, ordinaryInput, {
				atlas: { height: 100, width: TEST_UINT32_OVERFLOW },
				drawingBuffer: ordinaryInput.portalFootprint.drawingBuffer,
				maximumCrossingTriangleVertexCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
						.maximumCrossingTriangleVertexCount,
				maximumArrivalStateCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
			}),
		).toThrow("fit a positive Uint32");
		expect(() =>
			planner.plan(graph, ordinaryInput, {
				atlas: { height: 100, width: 100 },
				drawingBuffer: { height: 100, width: 99 },
				maximumCrossingTriangleVertexCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
						.maximumCrossingTriangleVertexCount,
				maximumArrivalStateCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
			}),
		).toThrow("culler drawing-buffer extents differ");

		const unsafePixelInput = planInput(OUTDOOR_SCOPE, {
			portalFootprint: {
				drawingBuffer: {
					height: TEST_ATLAS_UNSAFE_PIXEL_EXTENT,
					width: TEST_ATLAS_UNSAFE_PIXEL_EXTENT,
				},
				minimumPixelArea: 0,
			},
		});
		expect(() =>
			planner.plan(graph, unsafePixelInput, {
				atlas: unsafePixelInput.portalFootprint.drawingBuffer,
				drawingBuffer: unsafePixelInput.portalFootprint.drawingBuffer,
				maximumCrossingTriangleVertexCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
						.maximumCrossingTriangleVertexCount,
				maximumArrivalStateCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
			}),
		).toThrow("pixel capacity exceeds safe integer storage");

		const unsafeTraceInput = planInput(OUTDOOR_SCOPE, {
			portalFootprint: {
				drawingBuffer: {
					height: TEST_ATLAS_UNSAFE_TILE_EXTENT,
					width: TEST_ATLAS_UNSAFE_TILE_EXTENT,
				},
				minimumPixelArea: 0,
			},
		});
		expect(() =>
			planner.plan(graph, unsafeTraceInput, {
				atlas: unsafeTraceInput.portalFootprint.drawingBuffer,
				drawingBuffer: unsafeTraceInput.portalFootprint.drawingBuffer,
				maximumCrossingTriangleVertexCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
						.maximumCrossingTriangleVertexCount,
				maximumArrivalStateCount:
					PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
			}),
		).toThrow("tile-area trace exceeds safe integer storage");
	});

	it("rejects duplicate canonical renderer keys at the topology boundary", () => {
		const first = envCellScope("duplicate");
		const second = {
			envCellId: first.envCellId,
			kind: "env-cell",
			landblockId: "0x0002ffff",
		} as const satisfies SceneScope;
		const planner = scopeAtlasPlanner();
		const input = atlasPlanInput(first);

		expect(() =>
			planner.plan(
				topology(
					[topologyScope(first, "first"), topologyScope(second, "second")],
					[],
				),
				input,
				{
					atlas: { height: 100, width: 100 },
					drawingBuffer: input.portalFootprint.drawingBuffer,
					maximumCrossingTriangleVertexCount:
						PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas
							.maximumCrossingTriangleVertexCount,
					maximumArrivalStateCount:
						PORTAL_RENDER_CAPACITY_POLICY.scopeAtlas.maximumArrivalStateCount,
				},
			),
		).toThrow("duplicate render scope key duplicate");
	});
});

function scopeAtlasPlanner(): PortalScopeAtlasPlanner {
	return new PortalScopeAtlasPlanner({
		maximumDepth: TEST_ATLAS_MAXIMUM_PATH_DEPTH,
		maximumProjectionPrimitiveCount: 100_000,
		maximumWorkItemCount: 64,
		windowArena: scopeWindowArenaCapacity(),
	});
}

function atlasPlanInput(rootScope: SceneScope): PortalRenderGraphPlanInput {
	return planInput(rootScope, {
		portalFootprint: {
			drawingBuffer: { height: 100, width: 100 },
			minimumPixelArea: 0,
		},
	});
}

function scopeWindowSnapshot(
	frame: ReturnType<PortalScopeWindowCuller["cull"]>,
): readonly {
	readonly scope: string;
	readonly window: readonly number[][][];
}[] {
	return Array.from({ length: frame.selectedScopeCount }, (_, ordinal) => ({
		scope: scopeIdentity(frame.selectedScope(ordinal)),
		window: Array.from(
			{ length: frame.selectedFragmentCount(ordinal) },
			(_, fragment) =>
				Array.from(
					{
						length: frame.selectedFragmentVertexCount(ordinal, fragment),
					},
					(_, vertex) => [
						frame.selectedVertexX(ordinal, fragment, vertex),
						frame.selectedVertexY(ordinal, fragment, vertex),
					],
				),
		),
	})).sort((left, right) => left.scope.localeCompare(right.scope));
}

function scopeWindowArenaCapacity() {
	return {
		maximumApertureVertexCount: 64,
		maximumFragmentCount: 2_048,
		maximumTemporaryFragmentCount: 256,
		maximumTemporaryVertexCount: 16_384,
		maximumVertexCount: 16_384,
		maximumVerticesPerFragment: 64,
		maximumWindowCount: 512,
	};
}

function windowSnapshot(window: PortalViewWindow): readonly number[][][] {
	return window.fragments.map(({ vertices }) =>
		vertices.map(({ x, y }) => [x, y]),
	);
}

function indoorLayer(
	renderLayer: number,
	renderNodeIds: readonly PortalRenderWorkPlan["nodes"][number]["id"][],
	maskEdgeIds: readonly PortalCrossingId[] = [],
): PortalRenderWorkPlan["renderLayers"][number] {
	return {
		contributions: [
			{
				kind: "indoor",
				maskEdgeIds,
				renderNodeIds,
				stencilValue: renderLayer,
			},
		],
		renderLayer,
	};
}

function requireExteriorContribution(
	plan: PortalRenderWorkPlan,
): Extract<
	PortalRenderWorkPlan["renderLayers"][number]["contributions"][number],
	{ readonly kind: "exterior" }
> {
	const contribution = plan.renderLayers
		.flatMap((layer) => layer.contributions)
		.find((candidate) => candidate.kind === "exterior");
	if (!contribution) throw new Error("Expected an exterior contribution.");
	return contribution;
}

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
		portalFootprint: {
			drawingBuffer: { height: 1, width: 1 },
			minimumPixelArea: 0,
		},
		rootScope,
		safetyWorkItemLimit: DEFAULT_SAFETY_WORK_ITEM_LIMIT,
		...overrides,
	};
}

function testNearClipVolume(near: number, position = new Vec3(0, 0, 1)) {
	return createCameraNearClipVolume(
		{ fov: 90, near },
		{ position, rotation: Quat.identity() },
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
		readonly maskDepthPolicy?: ScenePortalCrossingInput["maskDepthPolicy"];
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
		maskDepthPolicy: options.maskDepthPolicy ?? "allow-equal-depth",
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

function splitAperture(): PlanarAperture {
	return {
		indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
		plane: { d: 0, normal: new Vec3(0, 0, 1) },
		vertices: new Float32Array([
			-0.9, -0.8, 0, -0.2, -0.8, 0, -0.55, 0.7, 0, 0.2, -0.8, 0, 0.9, -0.8, 0,
			0.55, 0.7, 0,
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
