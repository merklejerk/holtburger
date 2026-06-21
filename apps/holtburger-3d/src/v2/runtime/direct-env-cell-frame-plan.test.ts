import { describe, expect, it } from "vitest";
import type {
	StaticOutdoorPortalProjectionRecord,
	StaticPortalInteriorRecord,
} from "../static/contracts";
import type { PortalTraversalPlan } from "./static-scene-query";
import {
	createDirectEnvCellFramePlan,
	createOutdoorProjectionPortalFramePlan,
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
			envCellResourceMembership: [
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
			envCellResourceMembership: [
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
			envCellResourceMembership: [],
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
			},
		]);
		expect(plan?.graph.edges).toEqual([
			{
				apertureResourceId: plan?.graph.apertureResources[0]?.resourceId,
				apertureSourceId: "env-cell-portal:0xda55ffff:0xda550100:portal-a:0:7",
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
			envCellResourceMembership: [
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

	it("dedupes duplicate env-cell portal candidates through shared graph assembly", () => {
		const duplicateEdge = {
			flags: 0,
			linkId: "a-to-b",
			polygonId: null,
			sourceEnvCellId: 0xda550100,
			sourceIndex: 0,
			sourcePortalId: "portal-a",
			targetEnvCellId: 0xda550101,
			targetPortalId: "portal-b",
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
								createPortalAperture("portal-a", 7, [
									{ x: 0, y: 0, z: 0 },
									{ x: 1, y: 0, z: 0 },
									{ x: 0, y: 1, z: 0 },
								]),
							],
						],
					]),
				}),
			],
			renderAnchorLandblockId: 0xda55ffff,
			envCellResourceMembership: [],
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
						apertureEdges: [duplicateEdge, duplicateEdge],
						envCellId: 0xda550101,
						landblockId: 0xda55ffff,
						parentPortalStackId: "root:0xda550100",
						portalStack: [duplicateEdge],
						portalStackId: "root:0xda550100/a-to-b",
						traversalDepth: 1,
					},
				],
				sceneCrossings: [],
				startEnvCellId: 0xda550100,
				visibleCells: [],
			},
		});

		expect(plan?.graph.edges).toHaveLength(1);
		expect(plan?.graph.diagnostics).toMatchObject({
			duplicateMaskEdges: 1,
			envCellPortalEdges: 1,
			selectedMaskEdges: 1,
		});
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
				envCellResourceMembership: [],
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

	it("creates one outdoor projection render entry for a shared diamond target with multiple mask edges", () => {
		const plan = createOutdoorProjectionPortalFramePlan({
			landblockId: 0xda55ffff,
			envCellResourceMembership: [
				createEnvCellMembership(0xda550100, "structured-a"),
				createEnvCellMembership(0xda550101, "structured-b"),
				createEnvCellMembership(0xda550102, "structured-c"),
				createEnvCellMembership(0xda550103, "structured-d"),
			],
			maxCells: 16,
			maxDepth: 4,
			maxPortalViews: 16,
			projection: createOutdoorProjectionRecord({
				edges: [
					createProjectionEdge({
						edgeId: "outdoor-a",
						sourceEnvCellId: null,
						targetEnvCellId: 0xda550100,
					}),
					createProjectionEdge({
						edgeId: "a-b",
						sourceEnvCellId: 0xda550100,
						targetEnvCellId: 0xda550101,
					}),
					createProjectionEdge({
						edgeId: "b-c",
						sourceEnvCellId: 0xda550101,
						targetEnvCellId: 0xda550102,
					}),
					createProjectionEdge({
						edgeId: "b-d",
						sourceEnvCellId: 0xda550101,
						targetEnvCellId: 0xda550103,
					}),
					createProjectionEdge({
						edgeId: "c-d",
						sourceEnvCellId: 0xda550102,
						targetEnvCellId: 0xda550103,
					}),
				],
				layers: [
					{ envCellIds: [0xda550100], renderLayer: 1 },
					{ envCellIds: [0xda550101], renderLayer: 2 },
					{ envCellIds: [0xda550102], renderLayer: 3 },
					{ envCellIds: [0xda550103], renderLayer: 4 },
				],
			}),
		});

		expect(plan?.mode).toBe("outdoor-projection");
		if (plan?.mode !== "outdoor-projection") {
			throw new Error("Expected outdoor projection plan.");
		}
		expect(plan.layeredGraph.renderEntries).toHaveLength(4);
		expect(
			plan.layeredGraph.renderEntries.map((entry) => [
				entry.envCellId,
				entry.renderLayer,
				entry.incomingMaskEdgeIds.length,
			]),
		).toEqual([
			[0xda550100, 1, 1],
			[0xda550101, 2, 1],
			[0xda550102, 3, 1],
			[0xda550103, 4, 2],
		]);
		expect(plan.layeredGraph.renderLayers).toEqual([
			{ renderEntryIds: [0], renderLayer: 1 },
			{ renderEntryIds: [1], renderLayer: 2 },
			{ renderEntryIds: [2], renderLayer: 3 },
			{ renderEntryIds: [3], renderLayer: 4 },
		]);
		expect(plan.layeredGraph.maskEdges).toHaveLength(5);
		expect(plan.layeredGraph.diagnostics).toMatchObject({
			buildingTransitionEdges: 1,
			envCellPortalEdges: 4,
			selectedMaskEdges: 5,
		});
	});

	it("caps outdoor projection render entries by render layer without duplicating alternate paths", () => {
		const plan = createOutdoorProjectionPortalFramePlan({
			landblockId: 0xda55ffff,
			envCellResourceMembership: [
				createEnvCellMembership(0xda550100, "structured-a"),
				createEnvCellMembership(0xda550101, "structured-b"),
				createEnvCellMembership(0xda550102, "structured-c"),
			],
			maxCells: 16,
			maxDepth: 2,
			maxPortalViews: 16,
			projection: createOutdoorProjectionRecord({
				edges: [
					createProjectionEdge({
						edgeId: "outdoor-a",
						sourceEnvCellId: null,
						targetEnvCellId: 0xda550100,
					}),
					createProjectionEdge({
						edgeId: "a-b",
						sourceEnvCellId: 0xda550100,
						targetEnvCellId: 0xda550101,
					}),
					createProjectionEdge({
						edgeId: "a-c",
						sourceEnvCellId: 0xda550100,
						targetEnvCellId: 0xda550102,
					}),
					createProjectionEdge({
						edgeId: "b-c",
						sourceEnvCellId: 0xda550101,
						targetEnvCellId: 0xda550102,
					}),
				],
				layers: [
					{ envCellIds: [0xda550100], renderLayer: 1 },
					{ envCellIds: [0xda550101], renderLayer: 2 },
					{ envCellIds: [0xda550102], renderLayer: 3 },
				],
			}),
		});

		expect(plan?.mode).toBe("outdoor-projection");
		if (plan?.mode !== "outdoor-projection") {
			throw new Error("Expected outdoor projection plan.");
		}
		expect(
			plan.layeredGraph.renderEntries.map((entry) => entry.envCellId),
		).toEqual([0xda550100, 0xda550101]);
		expect(plan.layeredGraph.projectionDiagnostics).toMatchObject({
			projectedEnvCellCount: 3,
			renderEntriesSkippedByLayerCap: 1,
			renderEntryCount: 2,
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
			seenOutside: true,
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

function createEnvCellMembership(
	envCellId: number,
	structuredDrawUnitId: string,
) {
	return {
		envCellId,
		envCellStaticObjectDrawUnitIds: [],
		landblockId: 0xda55ffff,
		sharedEnvCellStaticObjectDrawUnits: 0,
		structuredInteriorDrawUnitIds: [structuredDrawUnitId],
	};
}

function createOutdoorProjectionRecord(options: {
	readonly edges: readonly StaticOutdoorPortalProjectionRecord["edges"][number][];
	readonly layers: readonly {
		readonly envCellIds: readonly number[];
		readonly renderLayer: number;
	}[];
}): StaticOutdoorPortalProjectionRecord {
	const envCellIds = [
		...new Set(options.layers.flatMap((layer) => layer.envCellIds)),
	];
	return {
		adjacency: envCellIds.map((envCellId) => ({
			edgeIds: options.edges
				.filter((edge) => edge.sourceEnvCellId === envCellId)
				.map((edge) => edge.edgeId),
			sourceNodeId: createProjectionNodeId(envCellId),
		})),
		componentEdges: [],
		components: envCellIds.map((envCellId) => {
			const renderLayer =
				options.layers.find((layer) => layer.envCellIds.includes(envCellId))
					?.renderLayer ?? null;
			return {
				componentId: `component:${formatHex32(envCellId)}`,
				cyclic: false,
				envCellIds: [envCellId],
				renderLayer,
			};
		}),
		diagnostics: {
			acceptedTransitionRootCount: options.edges.filter(
				(edge) => edge.sourceKind === "building-transition",
			).length,
			componentCount: envCellIds.length,
			componentInternalEdgeCount: 0,
			cyclicComponentCount: 0,
			envCellPortalEdgesRejectedMissingAperture: 0,
			envCellPortalEdgesRejectedSourceNotOutsideVisible: 0,
			envCellPortalEdgesRejectedTargetNotOutsideVisible: 0,
			envCellPortalEdgesRetained: options.edges.filter(
				(edge) => edge.sourceKind === "env-cell-portal",
			).length,
			maxRenderLayer: Math.max(
				0,
				...options.layers.map((layer) => layer.renderLayer),
			),
			outsideVisibleEnvCellCount: envCellIds.length,
			transitionRootCandidateCount: options.edges.filter(
				(edge) => edge.sourceKind === "building-transition",
			).length,
		},
		edges: options.edges,
		incomingEdges: envCellIds.map((envCellId) => ({
			edgeIds: options.edges
				.filter((edge) => edge.targetEnvCellId === envCellId)
				.map((edge) => edge.edgeId),
			targetEnvCellId: envCellId,
		})),
		kind: "outdoor-portal-projection",
		landblockId: 0xda55ffff,
		nodes: envCellIds.map((envCellId) => ({
			envCellId,
			nodeId: createProjectionNodeId(envCellId),
		})),
		renderLayerByEnvCellId: options.layers.flatMap((layer) =>
			layer.envCellIds.map((envCellId) => ({
				envCellId,
				renderLayer: layer.renderLayer,
			})),
		),
		renderLayers: options.layers.map((layer) => ({
			componentIds: layer.envCellIds.map(
				(envCellId) => `component:${formatHex32(envCellId)}`,
			),
			envCellIds: layer.envCellIds,
			renderLayer: layer.renderLayer,
		})),
		rootNodeId: "outdoor-root",
		sourceRevisionKey: "projection-test-key",
	};
}

function createProjectionEdge(options: {
	readonly edgeId: string;
	readonly sourceEnvCellId: number | null;
	readonly targetEnvCellId: number;
}): StaticOutdoorPortalProjectionRecord["edges"][number] {
	const sourceKind =
		options.sourceEnvCellId === null
			? "building-transition"
			: "env-cell-portal";
	return {
		apertureResourceId: `${sourceKind}:${options.edgeId}:range`,
		apertureSourceId: `${sourceKind}:${options.edgeId}:source`,
		edgeId: options.edgeId,
		linkId: options.edgeId,
		provenance:
			sourceKind === "building-transition"
				? {
						apertureBatchId: "transition-aperture-batch:da55ffff",
						buildingInstanceId: "building-0",
						buildingPortalId: "building-portal-0",
						kind: "building-transition",
						portalId: options.edgeId,
						targetEnvCellId: options.targetEnvCellId,
					}
				: {
						kind: "env-cell-portal",
						polygonId: null,
						sourceEnvCellId: options.sourceEnvCellId,
						sourceIndex: 0,
						sourcePortalId: `${options.edgeId}:source-portal`,
						targetEnvCellId: options.targetEnvCellId,
						targetPortalId: `${options.edgeId}:target-portal`,
					},
		sourceEnvCellId: options.sourceEnvCellId,
		sourceKind,
		sourceNodeId:
			options.sourceEnvCellId === null
				? "outdoor-root"
				: createProjectionNodeId(options.sourceEnvCellId),
		targetEnvCellId: options.targetEnvCellId,
		targetNodeId: createProjectionNodeId(options.targetEnvCellId),
	};
}

function createProjectionNodeId(envCellId: number): string {
	return `env-cell:${formatHex32(envCellId)}`;
}

function formatHex32(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}
