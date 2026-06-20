import { describe, expect, it } from "vitest";
import type { PortalTraversalPlan } from "./static-scene-query";
import { createDirectEnvCellFramePlan } from "./direct-env-cell-frame-plan";

describe("direct env-cell frame plan", () => {
	it("joins current-cell traversal to renderer env-cell resource membership", () => {
		expect(
			createDirectEnvCellFramePlan({
				currentCameraResidency: {
					envCellId: 0xda550100,
					kind: "env-cell",
					landblockId: 0xda55ffff,
				},
				rendererEnvCellResourceMembership: [
					{
						envCellId: 0xda550100,
						envCellStaticObjectDrawUnitIds: [],
						landblockId: 0xda55ffff,
						sharedEnvCellStaticObjectDrawUnits: 0,
						structuredInteriorDrawUnitIds: ["structured:da550100"],
					},
				],
				traversalPlan: createTraversalPlan({
					visibleCells: [
						{
							envCellId: 0xda550100,
							portalStackId: "root:0xda550100",
							traversalDepth: 0,
						},
					],
				}),
			}),
		).toEqual({
			baseScene: {
				envCellId: 0xda550100,
				kind: "env-cell-direct",
				landblockId: 0xda55ffff,
			},
			directEnvCellDraws: [
				{
					envCellId: 0xda550100,
					envCellStaticObjectDrawUnitIds: [],
					landblockId: 0xda55ffff,
					portalStackId: "root:0xda550100",
					resourceState: "ready",
					structuredInteriorDrawUnitIds: ["structured:da550100"],
					traversalDepth: 0,
				},
			],
			kind: "direct-env-cell",
			mode: "portal-traversal",
			transitionSceneCrossings: [],
		});
	});

	it("marks single-hop cells without renderer membership as missing resources", () => {
		const plan = createDirectEnvCellFramePlan({
			currentCameraResidency: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
			rendererEnvCellResourceMembership: [
				{
					envCellId: 0xda550100,
					envCellStaticObjectDrawUnitIds: ["static:da550100"],
					landblockId: 0xda55ffff,
					sharedEnvCellStaticObjectDrawUnits: 0,
					structuredInteriorDrawUnitIds: [],
				},
			],
			traversalPlan: createTraversalPlan({
				visibleCells: [
					{
						envCellId: 0xda550100,
						portalStackId: "root:0xda550100",
						traversalDepth: 0,
					},
					{
						envCellId: 0xda550101,
						portalStackId: "root:0xda550100/a-to-b",
						traversalDepth: 1,
					},
				],
			}),
		});

		expect(plan?.directEnvCellDraws).toEqual([
			expect.objectContaining({
				envCellId: 0xda550100,
				envCellStaticObjectDrawUnitIds: ["static:da550100"],
				resourceState: "ready",
				traversalDepth: 0,
			}),
			expect.objectContaining({
				envCellId: 0xda550101,
				envCellStaticObjectDrawUnitIds: [],
				resourceState: "missing-resources",
				structuredInteriorDrawUnitIds: [],
				traversalDepth: 1,
			}),
		]);
	});

	it("does not produce a direct env-cell frame plan outside env-cell residency", () => {
		expect(
			createDirectEnvCellFramePlan({
				currentCameraResidency: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
				rendererEnvCellResourceMembership: [],
				traversalPlan: createTraversalPlan({
					visibleCells: [
						{
							envCellId: 0xda550100,
							portalStackId: "root:0xda550100",
							traversalDepth: 0,
						},
					],
				}),
			}),
		).toBeNull();
	});
});

function createTraversalPlan(options: {
	readonly visibleCells: readonly {
		readonly envCellId: number;
		readonly portalStackId: string;
		readonly traversalDepth: number;
	}[];
}): PortalTraversalPlan {
	return {
		diagnostics: [],
		landblockId: 0xda55ffff,
		maxCells: 8,
		maxDepth: 1,
		sceneCrossings: [],
		startEnvCellId: 0xda550100,
		visibleCells: options.visibleCells.map((cell) => ({
			envCellId: cell.envCellId,
			landblockId: 0xda55ffff,
			parentEdge: null,
			portalStack: [],
			portalStackId: cell.portalStackId,
			traversalDepth: cell.traversalDepth,
		})),
	};
}
