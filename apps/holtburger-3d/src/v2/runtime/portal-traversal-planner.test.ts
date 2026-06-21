import { describe, expect, it } from "vitest";
import type {
	LandblockPortalLinkFacts,
	PortalEndpointIdentity,
	StaticPortalInteriorRecord,
	StaticWorkPeerRecordOwner,
} from "../static/contracts";
import {
	createPortalTraversalGraph,
	createPortalTraversalPlan,
	createPortalTraversalPlanFromGraph,
} from "./portal-traversal-planner";

describe("portal traversal planner", () => {
	it("derives multiple traversal plans from one prebuilt portal graph", () => {
		const graph = createPortalTraversalGraph({
			landblockId: 0xda55ffff,
			portalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100, 0xda550101],
					portalLinks: [
						createEnvCellPortalLink({
							linkId: "a-to-b",
							sourceEnvCellId: 0xda550100,
							targetEnvCellId: 0xda550101,
						}),
						createEnvCellPortalLink({
							linkId: "b-to-a",
							sourceEnvCellId: 0xda550101,
							targetEnvCellId: 0xda550100,
						}),
					],
				}),
			],
		});

		const fromA = createPortalTraversalPlanFromGraph({
			graph,
			landblockId: 0xda55ffff,
			maxCells: 8,
			maxDepth: 4,
			maxPortalViews: 16,
			startEnvCellId: 0xda550100,
		});
		const fromB = createPortalTraversalPlanFromGraph({
			graph,
			landblockId: 0xda55ffff,
			maxCells: 8,
			maxDepth: 4,
			maxPortalViews: 16,
			startEnvCellId: 0xda550101,
		});

		expect(fromA.visibleCells.map((cell) => cell.envCellId)).toEqual([
			0xda550100, 0xda550101,
		]);
		expect(fromB.visibleCells.map((cell) => cell.envCellId)).toEqual([
			0xda550101, 0xda550100,
		]);
	});

	it("traverses reciprocal env-cell portal links while rejecting already-visible cells", () => {
		const plan = createPortalTraversalPlan({
			landblockId: 0xda55ffff,
			maxCells: 8,
			maxDepth: 4,
			maxPortalViews: 16,
			portalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100, 0xda550101],
					portalLinks: [
						createEnvCellPortalLink({
							linkId: "a-to-b",
							sourceEnvCellId: 0xda550100,
							targetEnvCellId: 0xda550101,
						}),
						createEnvCellPortalLink({
							linkId: "b-to-a",
							sourceEnvCellId: 0xda550101,
							targetEnvCellId: 0xda550100,
						}),
					],
				}),
			],
			startEnvCellId: 0xda550100,
		});

		expect(
			plan.visibleCells.map((cell) => ({
				envCellId: cell.envCellId,
				parent: cell.parentEdge?.linkId ?? null,
				portalStackId: cell.portalStackId,
				traversalDepth: cell.traversalDepth,
			})),
		).toEqual([
			{
				envCellId: 0xda550100,
				parent: null,
				portalStackId: "root:0xda550100",
				traversalDepth: 0,
			},
			{
				envCellId: 0xda550101,
				parent: "a-to-b",
				portalStackId: "root:0xda550100/a-to-b",
				traversalDepth: 1,
			},
		]);
		expect(plan.diagnostics).toContainEqual({
			edge: expect.objectContaining({
				linkId: "b-to-a",
				sourceEnvCellId: 0xda550101,
				targetEnvCellId: 0xda550100,
			}),
			existingTraversalDepth: 0,
			kind: "already-visible",
		});
	});

	it("does not promote visible-cell links into portal traversal edges", () => {
		const plan = createPortalTraversalPlan({
			landblockId: 0xda55ffff,
			maxCells: 8,
			maxDepth: 4,
			maxPortalViews: 16,
			portalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100, 0xda550101, 0xda550102],
					portalLinks: [
						createEnvCellPortalLink({
							linkId: "a-to-b",
							sourceEnvCellId: 0xda550100,
							targetEnvCellId: 0xda550101,
						}),
					],
				}),
			],
			startEnvCellId: 0xda550100,
		});

		expect(plan.visibleCells.map((cell) => cell.envCellId)).toEqual([
			0xda550100, 0xda550101,
		]);
		expect(plan.visibleCells.map((cell) => cell.envCellId)).not.toContain(
			0xda550102,
		);
	});

	it("keeps traversal unrestricted when no allowed env-cell set is provided", () => {
		const plan = createPortalTraversalPlan({
			landblockId: 0xda55ffff,
			maxCells: 8,
			maxDepth: 4,
			maxPortalViews: 16,
			portalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100, 0xda550101, 0xda550102],
					portalLinks: [
						createEnvCellPortalLink({
							linkId: "a-to-b",
							sourceEnvCellId: 0xda550100,
							targetEnvCellId: 0xda550101,
						}),
						createEnvCellPortalLink({
							linkId: "b-to-c",
							sourceEnvCellId: 0xda550101,
							targetEnvCellId: 0xda550102,
						}),
					],
				}),
			],
			startEnvCellId: 0xda550100,
		});

		expect(plan.visibleCells.map((cell) => cell.envCellId)).toEqual([
			0xda550100, 0xda550101, 0xda550102,
		]);
		expect(plan.portalViewGroups.map((group) => group.envCellId)).toEqual([
			0xda550100, 0xda550101, 0xda550102,
		]);
	});

	it("prunes disallowed env-cell targets before creating portal-stack views", () => {
		const plan = createPortalTraversalPlan({
			allowedEnvCellIds: new Set([0xda550100, 0xda550102]),
			landblockId: 0xda55ffff,
			maxCells: 8,
			maxDepth: 4,
			maxPortalViews: 16,
			portalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100, 0xda550101, 0xda550102],
					portalLinks: [
						createEnvCellPortalLink({
							linkId: "a-to-b",
							sourceEnvCellId: 0xda550100,
							targetEnvCellId: 0xda550101,
						}),
						createEnvCellPortalLink({
							linkId: "b-to-c",
							sourceEnvCellId: 0xda550101,
							targetEnvCellId: 0xda550102,
						}),
					],
				}),
			],
			startEnvCellId: 0xda550100,
		});

		expect(plan.visibleCells.map((cell) => cell.envCellId)).toEqual([
			0xda550100,
		]);
		expect(plan.portalViewGroups.map((group) => group.envCellId)).toEqual([
			0xda550100,
		]);
		expect(plan.diagnostics).toContainEqual({
			edge: expect.objectContaining({
				linkId: "a-to-b",
				targetEnvCellId: 0xda550101,
			}),
			kind: "disallowed-target-cell",
		});
		expect(plan.diagnostics).not.toContainEqual(
			expect.objectContaining({
				edge: expect.objectContaining({ linkId: "b-to-c" }),
			}),
		);
	});

	it("records depth-limit rejection diagnostics", () => {
		const plan = createPortalTraversalPlan({
			landblockId: 0xda55ffff,
			maxCells: 8,
			maxDepth: 1,
			maxPortalViews: 16,
			portalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100, 0xda550101, 0xda550102],
					portalLinks: [
						createEnvCellPortalLink({
							linkId: "a-to-b",
							sourceEnvCellId: 0xda550100,
							targetEnvCellId: 0xda550101,
						}),
						createEnvCellPortalLink({
							linkId: "b-to-c",
							sourceEnvCellId: 0xda550101,
							targetEnvCellId: 0xda550102,
						}),
					],
				}),
			],
			startEnvCellId: 0xda550100,
		});

		expect(plan.visibleCells.map((cell) => cell.envCellId)).toEqual([
			0xda550100, 0xda550101,
		]);
		expect(plan.diagnostics).toContainEqual({
			edge: expect.objectContaining({ linkId: "b-to-c" }),
			kind: "depth-limit",
			maxDepth: 1,
			requestedDepth: 2,
		});
	});

	it("records cell-cap rejection diagnostics deterministically", () => {
		const plan = createPortalTraversalPlan({
			landblockId: 0xda55ffff,
			maxCells: 2,
			maxDepth: 4,
			maxPortalViews: 16,
			portalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100, 0xda550101, 0xda550102],
					portalLinks: [
						createEnvCellPortalLink({
							linkId: "a-to-b",
							sourceEnvCellId: 0xda550100,
							targetEnvCellId: 0xda550101,
						}),
						createEnvCellPortalLink({
							linkId: "a-to-c",
							sourceEnvCellId: 0xda550100,
							targetEnvCellId: 0xda550102,
						}),
					],
				}),
			],
			startEnvCellId: 0xda550100,
		});

		expect(plan.visibleCells.map((cell) => cell.envCellId)).toEqual([
			0xda550100, 0xda550101,
		]);
		expect(plan.diagnostics).toContainEqual({
			edge: expect.objectContaining({ linkId: "a-to-c" }),
			kind: "cell-cap",
			maxCells: 2,
		});
	});

	it("merges same-context portals to the same target into one portal view group", () => {
		const plan = createPortalTraversalPlan({
			landblockId: 0xda55ffff,
			maxCells: 8,
			maxDepth: 4,
			maxPortalViews: 16,
			portalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100, 0xda550101],
					portalLinks: [
						createEnvCellPortalLink({
							linkId: "a-to-b-0",
							sourceEnvCellId: 0xda550100,
							sourceIndex: 0,
							targetEnvCellId: 0xda550101,
						}),
						createEnvCellPortalLink({
							linkId: "a-to-b-1",
							sourceEnvCellId: 0xda550100,
							sourceIndex: 1,
							targetEnvCellId: 0xda550101,
						}),
					],
				}),
			],
			startEnvCellId: 0xda550100,
		});

		expect(plan.visibleCells.map((cell) => cell.envCellId)).toEqual([
			0xda550100, 0xda550101,
		]);
		expect(
			plan.portalViewGroups.map((group) => ({
				apertureEdges: group.apertureEdges.map((edge) => edge.linkId),
				envCellId: group.envCellId,
				parentPortalStackId: group.parentPortalStackId,
				portalStackId: group.portalStackId,
			})),
		).toEqual([
			{
				apertureEdges: [],
				envCellId: 0xda550100,
				parentPortalStackId: null,
				portalStackId: "root:0xda550100",
			},
			{
				apertureEdges: ["a-to-b-0", "a-to-b-1"],
				envCellId: 0xda550101,
				parentPortalStackId: "root:0xda550100",
				portalStackId: "root:0xda550100/a-to-b-0",
			},
		]);
	});

	it("keeps distinct parent portal-stack contexts as separate portal view groups", () => {
		const plan = createPortalTraversalPlan({
			landblockId: 0xda55ffff,
			maxCells: 8,
			maxDepth: 2,
			maxPortalViews: 16,
			portalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100, 0xda550101, 0xda550102, 0xda550103],
					portalLinks: [
						createEnvCellPortalLink({
							linkId: "a-to-b",
							sourceEnvCellId: 0xda550100,
							sourceIndex: 0,
							targetEnvCellId: 0xda550101,
						}),
						createEnvCellPortalLink({
							linkId: "a-to-c",
							sourceEnvCellId: 0xda550100,
							sourceIndex: 1,
							targetEnvCellId: 0xda550102,
						}),
						createEnvCellPortalLink({
							linkId: "b-to-d",
							sourceEnvCellId: 0xda550101,
							targetEnvCellId: 0xda550103,
						}),
						createEnvCellPortalLink({
							linkId: "c-to-d",
							sourceEnvCellId: 0xda550102,
							targetEnvCellId: 0xda550103,
						}),
					],
				}),
			],
			startEnvCellId: 0xda550100,
		});

		expect(plan.visibleCells.map((cell) => cell.envCellId)).toEqual([
			0xda550100, 0xda550101, 0xda550102, 0xda550103,
		]);
		expect(
			plan.portalViewGroups
				.filter((group) => group.envCellId === 0xda550103)
				.map((group) => ({
					apertureEdges: group.apertureEdges.map((edge) => edge.linkId),
					parentPortalStackId: group.parentPortalStackId,
					portalStackId: group.portalStackId,
				})),
		).toEqual([
			{
				apertureEdges: ["b-to-d"],
				parentPortalStackId: "root:0xda550100/a-to-b",
				portalStackId: "root:0xda550100/a-to-b/b-to-d",
			},
			{
				apertureEdges: ["c-to-d"],
				parentPortalStackId: "root:0xda550100/a-to-c",
				portalStackId: "root:0xda550100/a-to-c/c-to-d",
			},
		]);
	});

	it("caps portal view groups separately from unique visible cells", () => {
		const plan = createPortalTraversalPlan({
			landblockId: 0xda55ffff,
			maxCells: 8,
			maxDepth: 4,
			maxPortalViews: 2,
			portalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100, 0xda550101, 0xda550102],
					portalLinks: [
						createEnvCellPortalLink({
							linkId: "a-to-b",
							sourceEnvCellId: 0xda550100,
							sourceIndex: 0,
							targetEnvCellId: 0xda550101,
						}),
						createEnvCellPortalLink({
							linkId: "a-to-c",
							sourceEnvCellId: 0xda550100,
							sourceIndex: 1,
							targetEnvCellId: 0xda550102,
						}),
					],
				}),
			],
			startEnvCellId: 0xda550100,
		});

		expect(plan.visibleCells.map((cell) => cell.envCellId)).toEqual([
			0xda550100, 0xda550101,
		]);
		expect(plan.portalViewGroups.map((group) => group.envCellId)).toEqual([
			0xda550100, 0xda550101,
		]);
		expect(plan.diagnostics).toContainEqual({
			edge: expect.objectContaining({ linkId: "a-to-c" }),
			kind: "portal-view-cap",
			maxPortalViews: 2,
		});
	});

	it("keeps transition scene crossings as metadata until a bridge is explicit", () => {
		const plan = createPortalTraversalPlan({
			landblockId: 0xda55ffff,
			maxCells: 8,
			maxDepth: 4,
			maxPortalViews: 16,
			portalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100],
					portalLinks: [
						createPortalLink({
							linkId: "a-to-outside",
							source: {
								envCellId: 0xda550100,
								kind: "env-cell",
								portalId: "portal-a",
							},
							target: {
								kind: "outside",
								landblockId: 0xda55ffff,
							},
						}),
						createPortalLink({
							linkId: "a-to-building",
							source: {
								envCellId: 0xda550100,
								kind: "env-cell",
								portalId: "portal-b",
							},
							target: {
								instanceId: "building-0",
								kind: "landblock-building",
								portalId: "building-portal-0",
							},
						}),
					],
				}),
			],
			startEnvCellId: 0xda550100,
		});

		expect(plan.visibleCells.map((cell) => cell.envCellId)).toEqual([
			0xda550100,
		]);
		expect(plan.sceneCrossings.map((crossing) => crossing.linkId)).toEqual([
			"a-to-building",
			"a-to-outside",
		]);
		expect(
			plan.diagnostics.filter(
				(diagnostic) => diagnostic.kind === "scene-crossing-not-bridged",
			),
		).toHaveLength(2);
	});

	it("reports missing start and target cells explicitly", () => {
		expect(
			createPortalTraversalPlan({
					landblockId: 0xda55ffff,
					maxCells: 8,
					maxDepth: 4,
					maxPortalViews: 16,
				portalInteriorRecords: [
					createPortalInteriorRecord({
						envCellIds: [0xda550100],
						portalLinks: [],
					}),
				],
				startEnvCellId: 0xda550999,
			}).diagnostics,
		).toEqual([
			{
				envCellId: 0xda550999,
				kind: "missing-start-cell",
				landblockId: 0xda55ffff,
			},
		]);

		const plan = createPortalTraversalPlan({
			landblockId: 0xda55ffff,
			maxCells: 8,
			maxDepth: 4,
			maxPortalViews: 16,
			portalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100],
					portalLinks: [
						createEnvCellPortalLink({
							linkId: "a-to-missing",
							sourceEnvCellId: 0xda550100,
							targetEnvCellId: 0xda550101,
						}),
					],
				}),
			],
			startEnvCellId: 0xda550100,
		});

		expect(plan.visibleCells.map((cell) => cell.envCellId)).toEqual([
			0xda550100,
		]);
		expect(plan.diagnostics).toContainEqual({
			edge: expect.objectContaining({ linkId: "a-to-missing" }),
			kind: "missing-target-cell",
		});
	});
});

function createPortalInteriorRecord(options: {
	readonly envCellIds: readonly number[];
	readonly landblockId?: number;
	readonly portalLinks: readonly LandblockPortalLinkFacts[];
}): StaticPortalInteriorRecord {
	const landblockId = options.landblockId ?? 0xda55ffff;
	return {
		envCells: options.envCellIds.map((envCellId) => ({
			envCellId,
			localPlacement: createPlacement(),
			portalApertures: [],
			portals: [],
			seenOutside: true,
		})),
		kind: "env-cell-portal-interior",
		landblockId,
		owner: createEnvCellWorkOwner("work-env-portals", landblockId),
		portalLinks: options.portalLinks,
	};
}

function createEnvCellPortalLink(options: {
	readonly linkId: string;
	readonly sourceEnvCellId: number;
	readonly sourceIndex?: number;
	readonly targetEnvCellId: number;
}): LandblockPortalLinkFacts {
	return createPortalLink({
		linkId: options.linkId,
		source: {
			envCellId: options.sourceEnvCellId,
			kind: "env-cell",
			portalId: `${options.linkId}:source`,
		},
		sourceIndex: options.sourceIndex,
		target: {
			envCellId: options.targetEnvCellId,
			kind: "env-cell",
			portalId: `${options.linkId}:target`,
		},
	});
}

function createPortalLink(options: {
	readonly linkId: string;
	readonly source: PortalEndpointIdentity;
	readonly sourceIndex?: number;
	readonly target: PortalEndpointIdentity;
}): LandblockPortalLinkFacts {
	return {
		flags: 0,
		linkId: options.linkId,
		polygonId: null,
		source: options.source,
		sourceIndex: options.sourceIndex ?? 0,
		target: options.target,
	};
}

function createPlacement() {
	return {
		frame: {
			origin: { x: 0, y: 0, z: 0 },
			rotation: { w: 1, x: 0, y: 0, z: 0 },
		},
		sourceScale: { x: 1, y: 1, z: 1 },
	};
}

function createEnvCellWorkOwner(
	workId: string,
	landblockId: number,
): StaticWorkPeerRecordOwner {
	return {
		domain: "landblock-env-cells",
		kind: "work",
		scope: {
			kind: "landblock",
			landblockId,
		},
		scopeKey: `landblock:${landblockId.toString(16).padStart(8, "0")}`,
		workId,
	};
}
