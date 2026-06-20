import { describe, expect, it } from "vitest";
import type {
	StaticPortalInteriorRecord,
	TransitionApertureBatch,
} from "../static/contracts";
import type { PortalTraversalPlan } from "./static-scene-query";
import {
	createDirectEnvCellFramePlan,
	createOutdoorTransitionPortalFramePlan,
} from "./direct-env-cell-frame-plan";

describe("direct env-cell frame plan", () => {
	it("joins current-cell traversal to renderer env-cell resource membership", () => {
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
		});

		expect(plan).toEqual({
			kind: "direct-env-cell",
			mode: "portal-traversal",
			graph: {
				apertureResources: [],
				baseNodeId: 0,
				diagnostics: emptyPortalApertureDiagnostics(),
				edges: [],
				nodes: [
					{
						debugStackLabel: "root:0xda550100",
						incomingEdgeIds: [],
						nodeId: 0,
						parentNodeId: null,
						resources: {
							envCellStaticObjectDrawUnitIds: [],
							resourceState: "ready",
							structuredInteriorDrawUnitIds: ["structured:da550100"],
						},
						scene: {
							envCellId: 0xda550100,
							kind: "env-cell-direct",
							landblockId: 0xda55ffff,
						},
						traversalDepth: 0,
					},
				],
			},
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

		expect(plan?.graph.nodes).toEqual([
			expect.objectContaining({
				resources: expect.objectContaining({
					envCellStaticObjectDrawUnitIds: ["static:da550100"],
					resourceState: "ready",
				}),
				scene: expect.objectContaining({ envCellId: 0xda550100 }),
				traversalDepth: 0,
			}),
			expect.objectContaining({
				resources: {
					envCellStaticObjectDrawUnitIds: [],
					resourceState: "missing-resources",
					structuredInteriorDrawUnitIds: [],
				},
				scene: expect.objectContaining({ envCellId: 0xda550101 }),
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

		expect(plan?.graph.apertureResources).toEqual([
			{
				resourceId: expect.stringMatching(/^portal-aperture:/),
				sourceKinds: ["env-cell-portal"],
				vertices: [
					[0, 0, 0],
					[1, 0, 0],
					[0, 1, 0],
				],
			},
		]);
		expect(plan?.graph.edges).toEqual([
			{
				apertureResourceId: plan?.graph.apertureResources[0]?.resourceId,
				apertureSourceId:
					"env-cell-portal:0xda55ffff:0xda550100:portal-a:0:7",
				childNodeId: 1,
				edgeId: 0,
				linkId: "a-to-b",
				parentNodeId: 0,
				sourceKind: "env-cell-portal",
			},
		]);
	});

	it("creates multiple aperture masks for one merged target view group", () => {
		const firstEdge = {
			flags: 0,
			linkId: "a-to-b-0",
			polygonId: null,
			sourceEnvCellId: 0xda550100,
			sourceIndex: 0,
			sourcePortalId: "portal-a-0",
			targetEnvCellId: 0xda550101,
			targetPortalId: "portal-b-0",
		};
		const secondEdge = {
			...firstEdge,
			linkId: "a-to-b-1",
			sourceIndex: 1,
			sourcePortalId: "portal-a-1",
			targetPortalId: "portal-b-1",
		};
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
								createPortalAperture("portal-a-0", 7, [
									{ x: 0, y: 0, z: 0 },
									{ x: 1, y: 0, z: 0 },
									{ x: 0, y: 1, z: 0 },
								]),
								createPortalAperture("portal-a-1", 8, [
									{ x: 2, y: 0, z: 0 },
									{ x: 3, y: 0, z: 0 },
									{ x: 2, y: 1, z: 0 },
								]),
							],
						],
					]),
				}),
			],
			renderAnchorLandblockId: 0xda55ffff,
			rendererEnvCellResourceMembership: [
				{
					envCellId: 0xda550101,
					envCellStaticObjectDrawUnitIds: [],
					landblockId: 0xda55ffff,
					sharedEnvCellStaticObjectDrawUnits: 0,
					structuredInteriorDrawUnitIds: ["structured-child"],
				},
			],
			traversalPlan: {
				diagnostics: [],
				landblockId: 0xda55ffff,
				maxCells: 8,
				maxDepth: 1,
				maxPortalViews: 16,
				portalViewGroups: [
					{
						apertureEdges: [],
						envCellId: 0xda550100,
						landblockId: 0xda55ffff,
						parentPortalStackId: null,
						portalStack: [],
						portalStackId: "root:0xda550100",
						traversalDepth: 0,
					},
					{
						apertureEdges: [firstEdge, secondEdge],
						envCellId: 0xda550101,
						landblockId: 0xda55ffff,
						parentPortalStackId: "root:0xda550100",
						portalStack: [firstEdge],
						portalStackId: "root:0xda550100/a-to-b-0",
						traversalDepth: 1,
					},
				],
				sceneCrossings: [],
				startEnvCellId: 0xda550100,
				visibleCells: [],
			},
		});

		expect(plan?.graph.nodes).toEqual([
			expect.objectContaining({
				debugStackLabel: "root:0xda550100",
				scene: expect.objectContaining({ envCellId: 0xda550100 }),
			}),
			expect.objectContaining({
				debugStackLabel: "root:0xda550100/a-to-b-0",
				resources: expect.objectContaining({
					structuredInteriorDrawUnitIds: ["structured-child"],
				}),
				scene: expect.objectContaining({ envCellId: 0xda550101 }),
			}),
		]);
		expect(plan?.graph.edges).toEqual([
			expect.objectContaining({
				childNodeId: 1,
				linkId: "a-to-b-0",
				parentNodeId: 0,
			}),
			expect.objectContaining({
				childNodeId: 1,
				linkId: "a-to-b-1",
				parentNodeId: 0,
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

	it("creates an outdoor-base transition frame plan with direct env-cell traversal", () => {
		const childEdge = {
			flags: 0,
			linkId: "root-to-child",
			polygonId: null,
			sourceEnvCellId: 0xda550100,
			sourceIndex: 0,
			sourcePortalId: "portal-root",
			targetEnvCellId: 0xda550101,
			targetPortalId: "portal-child",
		};
		const plan = createOutdoorTransitionPortalFramePlan({
			landblockId: 0xda55ffff,
			portalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100, 0xda550101],
					portalAperturesByEnvCellId: new Map([
						[
							0xda550100,
							[
								createPortalAperture("portal-root", 7, [
									{ x: 10, y: 0, z: 0 },
									{ x: 11, y: 0, z: 0 },
									{ x: 10, y: 1, z: 0 },
								]),
							],
						],
					]),
				}),
			],
			renderAnchorLandblockId: 0xda55ffff,
			rendererEnvCellResourceMembership: [
				{
					envCellId: 0xda550100,
					envCellStaticObjectDrawUnitIds: [],
					landblockId: 0xda55ffff,
					sharedEnvCellStaticObjectDrawUnits: 0,
					structuredInteriorDrawUnitIds: ["structured-root"],
				},
				{
					envCellId: 0xda550101,
					envCellStaticObjectDrawUnitIds: ["static-child"],
					landblockId: 0xda55ffff,
					sharedEnvCellStaticObjectDrawUnits: 0,
					structuredInteriorDrawUnitIds: [],
				},
			],
			transitionApertureBatches: [createTransitionApertureBatch()],
			traversalPlansByStartEnvCellId: new Map([
				[
					0xda550100,
					{
						diagnostics: [],
						landblockId: 0xda55ffff,
						maxCells: 8,
						maxDepth: 1,
						maxPortalViews: 16,
						portalViewGroups: [
							{
								apertureEdges: [],
								envCellId: 0xda550100,
								landblockId: 0xda55ffff,
								parentPortalStackId: null,
								portalStack: [],
								portalStackId: "root:0xda550100",
								traversalDepth: 0,
							},
							{
								apertureEdges: [childEdge],
								envCellId: 0xda550101,
								landblockId: 0xda55ffff,
								parentPortalStackId: "root:0xda550100",
								portalStack: [childEdge],
								portalStackId: "root:0xda550100/root-to-child",
								traversalDepth: 1,
							},
						],
						sceneCrossings: [],
						startEnvCellId: 0xda550100,
						visibleCells: [],
					},
				],
			]),
		});

		expect(plan?.graph.nodes[0]).toEqual(
			expect.objectContaining({
				scene: {
					kind: "outdoor-target",
					landblockId: 0xda55ffff,
				},
			}),
		);
		expect(plan?.graph.nodes).toEqual([
			expect.objectContaining({
				nodeId: 0,
				scene: { kind: "outdoor-target", landblockId: 0xda55ffff },
				traversalDepth: 0,
			}),
			expect.objectContaining({
				resources: expect.objectContaining({
					structuredInteriorDrawUnitIds: ["structured-root"],
				}),
				scene: expect.objectContaining({ envCellId: 0xda550100 }),
				traversalDepth: 1,
			}),
			expect.objectContaining({
				resources: expect.objectContaining({
					envCellStaticObjectDrawUnitIds: ["static-child"],
				}),
				scene: expect.objectContaining({ envCellId: 0xda550101 }),
				traversalDepth: 2,
			}),
		]);
		expect(plan?.graph.diagnostics).toEqual({
			buildingTransitionEdges: 1,
			dedupedGeometryResources: 0,
			duplicateMaskEdges: 0,
			envCellPortalEdges: 1,
			selectedMaskEdges: 2,
			transitionRootCandidateCount: 1,
			transitionRootCount: 1,
			transitionRootsRejectedNotSeenOutside: 0,
			transitionRootsRejectedUnknownSeenOutside: 0,
		});
		expect(plan?.graph.edges).toEqual([
			expect.objectContaining({
				childNodeId: 1,
				linkId:
					"transition:transition-aperture-batch:da55ffff:transition-portal:0:0xda550100",
				parentNodeId: 0,
				sourceKind: "building-transition",
			}),
			expect.objectContaining({
				childNodeId: 2,
				linkId: "root-to-child",
				parentNodeId: 1,
				sourceKind: "env-cell-portal",
			}),
		]);
	});

	it("filters outdoor-origin transition roots and descendants by seenOutside", () => {
		const plan = createOutdoorTransitionPortalFramePlan({
			landblockId: 0xda55ffff,
			portalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100, 0xda550101, 0xda550102],
					seenOutsideByEnvCellId: new Map([
						[0xda550100, true],
						[0xda550101, false],
						[0xda550102, null],
					]),
				}),
			],
			renderAnchorLandblockId: 0xda55ffff,
			rendererEnvCellResourceMembership: [
				{
					envCellId: 0xda550100,
					envCellStaticObjectDrawUnitIds: [],
					landblockId: 0xda55ffff,
					sharedEnvCellStaticObjectDrawUnits: 0,
					structuredInteriorDrawUnitIds: ["structured-visible"],
				},
				{
					envCellId: 0xda550101,
					envCellStaticObjectDrawUnitIds: [],
					landblockId: 0xda55ffff,
					sharedEnvCellStaticObjectDrawUnits: 0,
					structuredInteriorDrawUnitIds: ["structured-hidden"],
				},
				{
					envCellId: 0xda550102,
					envCellStaticObjectDrawUnitIds: [],
					landblockId: 0xda55ffff,
					sharedEnvCellStaticObjectDrawUnits: 0,
					structuredInteriorDrawUnitIds: ["structured-unknown"],
				},
			],
			transitionApertureBatches: [
				createTransitionApertureBatch({
					linkedEnvCellIds: [0xda550100, 0xda550101, 0xda550102],
				}),
			],
			traversalPlansByStartEnvCellId: new Map([
				[
					0xda550100,
					createTraversalPlan({
						visibleCells: [
							{
								envCellId: 0xda550100,
								portalStackId: "root:0xda550100",
								traversalDepth: 0,
							},
							{
								envCellId: 0xda550101,
								portalStackId: "root:0xda550100/visible-to-hidden",
								traversalDepth: 1,
							},
						],
					}),
				],
				[
					0xda550101,
					createTraversalPlan({
						visibleCells: [
							{
								envCellId: 0xda550101,
								portalStackId: "root:0xda550101",
								traversalDepth: 0,
							},
						],
					}),
				],
				[
					0xda550102,
					createTraversalPlan({
						visibleCells: [
							{
								envCellId: 0xda550102,
								portalStackId: "root:0xda550102",
								traversalDepth: 0,
							},
						],
					}),
				],
			]),
		});

		expect(
			plan?.graph.nodes
				.filter((node) => node.scene.kind === "env-cell-direct")
				.map((node) =>
					node.scene.kind === "env-cell-direct" ? node.scene.envCellId : 0,
				),
		).toEqual([0xda550100]);
		expect(plan?.graph.edges).toHaveLength(1);
		expect(plan?.graph.edges[0]).toEqual(
			expect.objectContaining({
				childNodeId: 1,
				parentNodeId: 0,
				sourceKind: "building-transition",
			}),
		);
		expect(plan?.graph.diagnostics).toEqual({
			buildingTransitionEdges: 1,
			dedupedGeometryResources: 0,
			duplicateMaskEdges: 0,
			envCellPortalEdges: 0,
			selectedMaskEdges: 1,
			transitionRootCandidateCount: 3,
			transitionRootCount: 1,
			transitionRootsRejectedNotSeenOutside: 1,
			transitionRootsRejectedUnknownSeenOutside: 1,
		});
	});
});

function emptyPortalApertureDiagnostics() {
	return {
		buildingTransitionEdges: 0,
		dedupedGeometryResources: 0,
		duplicateMaskEdges: 0,
		envCellPortalEdges: 0,
		selectedMaskEdges: 0,
		transitionRootCandidateCount: 0,
		transitionRootCount: 0,
		transitionRootsRejectedNotSeenOutside: 0,
		transitionRootsRejectedUnknownSeenOutside: 0,
	};
}

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
		maxPortalViews: 16,
		portalViewGroups: options.visibleCells.map((cell) => ({
			apertureEdges: cell.parentEdge ? [cell.parentEdge] : [],
			envCellId: cell.envCellId,
			landblockId: 0xda55ffff,
			parentPortalStackId:
				cell.parentEdge && cell.portalStackId.includes("/")
					? cell.portalStackId.slice(0, cell.portalStackId.lastIndexOf("/"))
					: null,
			portalStack: cell.parentEdge ? [cell.parentEdge] : [],
			portalStackId: cell.portalStackId,
			traversalDepth: cell.traversalDepth,
		})),
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

function createPortalAperture(
	portalId: string,
	polygonId: number,
	points: StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number]["points"],
): StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number] {
	return {
		plane: {
			constant: 0,
			normal: { x: 0, y: 0, z: 1 },
			source: "derived-from-render-points",
		},
		points,
		polygonId,
		portalId,
		sourceIndex: polygonId,
	};
}

function createPortalInteriorRecord(options: {
	readonly envCellIds: readonly number[];
	readonly portalAperturesByEnvCellId?: ReadonlyMap<
		number,
		StaticPortalInteriorRecord["envCells"][number]["portalApertures"]
	>;
	readonly seenOutsideByEnvCellId?: ReadonlyMap<number, boolean | null>;
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
			seenOutside: options.seenOutsideByEnvCellId?.has(envCellId)
				? (options.seenOutsideByEnvCellId.get(envCellId) ?? null)
				: true,
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

function createTransitionApertureBatch(options?: {
	readonly linkedEnvCellIds?: readonly number[];
}): TransitionApertureBatch {
	return {
		apertureBatchId: "transition-aperture-batch:da55ffff",
		coordinateSpace: "landblock-render-local",
		frontFace: "indoor-visible",
		indices: [0, 1, 2],
		kind: "transition-aperture-batch",
		landblockId: 0xda55ffff,
		planes: [null],
		ranges: [
			{
				exterior: {
					buildingInstanceId: "building-0",
					buildingPortalId: "building-portal-0",
					kind: "landblock-building",
				},
				firstIndex: 0,
				indexCount: 3,
				portalId: "transition-portal:0",
				source: {
					buildingInstanceId: "building-0",
					buildingPortalId: "building-portal-0",
					buildingPortalSourceIndex: 0,
					kind: "building-portal",
					linkedEnvCellIds: options?.linkedEnvCellIds ?? [0xda550100],
					otherCellId: 0x0100,
					otherPortalId: 0xffff,
					polyId: 7,
					portalIndex: 0,
					sourceAssetId: "gfx-obj/01001234",
					sourceDid: 0x01001234,
				},
			},
		],
		sourceDomain: "outdoor-buildings",
		vertices: [
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
			{ x: 0, y: 1, z: 0 },
		],
	};
}
