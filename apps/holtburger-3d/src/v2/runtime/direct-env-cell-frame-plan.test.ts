import { describe, expect, it } from "vitest";
import type { StaticPortalInteriorRecord } from "../static/contracts";
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
				portalInteriorRecords: [],
				renderAnchorLandblockId: null,
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
			portalApertureGeometryResources: [],
			portalApertureMaskPasses: [],
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
			portalInteriorRecords: [],
			renderAnchorLandblockId: null,
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

	it("creates selected aperture mask passes for traversed env-cell edges", () => {
		const plan = createDirectEnvCellFramePlan({
			currentCameraResidency: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
			portalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100, 0xda550101],
					portalAperturesByEnvCellId: new Map([
						[
							0xda550100,
							[
								{
									plane: {
										constant: 0,
										normal: { x: 0, y: 0, z: 1 },
										source: "derived-from-render-points",
									},
									points: [
										{ x: 0, y: 0, z: 0 },
										{ x: 1, y: 0, z: 0 },
										{ x: 0, y: 1, z: 0 },
									],
									polygonId: 7,
									portalId: "portal-a",
									sourceIndex: 0,
								},
							],
						],
					]),
				}),
			],
			renderAnchorLandblockId: 0xda55ffff,
			rendererEnvCellResourceMembership: [],
			traversalPlan: createTraversalPlan({
				visibleCells: [
					{
						envCellId: 0xda550100,
						portalStackId: "root:0xda550100",
						traversalDepth: 0,
					},
					{
						envCellId: 0xda550101,
						parentEdge: {
							flags: 0,
							linkId: "a-to-b",
							polygonId: null,
							sourceEnvCellId: 0xda550100,
							sourceIndex: 0,
							sourcePortalId: "portal-a",
							targetEnvCellId: 0xda550101,
							targetPortalId: "portal-b",
						},
						portalStackId: "root:0xda550100/a-to-b",
						traversalDepth: 1,
					},
				],
			}),
		});

		expect(plan?.portalApertureGeometryResources).toEqual([
			{
				resourceId: expect.stringMatching(/^portal-aperture:/),
				vertices: [
					[0, 0, 0],
					[1, 0, 0],
					[0, 1, 0],
				],
			},
		]);
		expect(plan?.portalApertureMaskPasses).toEqual([
			{
				apertureResourceId:
					plan?.portalApertureGeometryResources[0]?.resourceId,
				linkId: "a-to-b",
				parentStencilRef: null,
				portalStackId: "root:0xda550100/a-to-b",
				source: {
					envCellId: 0xda550100,
					kind: "env-cell-direct",
					landblockId: 0xda55ffff,
				},
				stencilRef: 1,
				target: {
					envCellId: 0xda550101,
					kind: "env-cell-direct",
					landblockId: 0xda55ffff,
				},
				traversalDepth: 1,
			},
		]);
	});

	it("does not produce a direct env-cell frame plan outside env-cell residency", () => {
		expect(
			createDirectEnvCellFramePlan({
				currentCameraResidency: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
				portalInteriorRecords: [],
				renderAnchorLandblockId: null,
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
		readonly parentEdge?: PortalTraversalPlan["visibleCells"][number]["parentEdge"];
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
			parentEdge: cell.parentEdge ?? null,
			portalStack: cell.parentEdge ? [cell.parentEdge] : [],
			portalStackId: cell.portalStackId,
			traversalDepth: cell.traversalDepth,
		})),
	};
}

function createPortalInteriorRecord(options: {
	readonly envCellIds: readonly number[];
	readonly portalAperturesByEnvCellId?: ReadonlyMap<
		number,
		StaticPortalInteriorRecord["envCells"][number]["portalApertures"]
	>;
}): StaticPortalInteriorRecord {
	return {
		envCells: options.envCellIds.map((envCellId) => ({
			envCellId,
			localPlacement: {
				orientation: { w: 1, x: 0, y: 0, z: 0 },
				origin: { x: 0, y: 0, z: 0 },
			},
			portalApertures: options.portalAperturesByEnvCellId?.get(envCellId) ?? [],
			portals: [],
		})),
		kind: "env-cell-portal-interior",
		landblockId: 0xda55ffff,
		owner: {
			domain: "landblock-env-cells",
			kind: "work",
			scope: {
				kind: "landblock",
				landblockId: 0xda55ffff,
			},
			scopeKey: "landblock:da55ffff",
			workId: "work",
		},
		portalLinks: [],
	};
}
