import { describe, expect, it } from "vitest";
import type {
	LandblockPortalLinkFacts,
	StaticPortalInteriorRecord,
	StaticWorkPeerRecordOwner,
	TransitionApertureBatch,
} from "./contracts";
import {
	createEnvCellStaticPortalGraph,
	createOutdoorPortalProjectionRoot,
	createStaticPortalProjection,
	createTransitionStaticPortalGraph,
} from "./portal-graphs";

describe("V2 static portal graphs", () => {
	it("normalizes env-cell portal links into directed graph edges", () => {
		const owner = createWorkOwner("work-env", "landblock-env-cells");
		const graph = createEnvCellStaticPortalGraph(owner, {
			envCells: [
				createPortalSummary(0xda550100),
				createPortalSummary(0xda550101),
			],
			kind: "env-cell-portal-interior",
			landblockId: 0xda55ffff,
			owner,
			portalLinks: [
				createEnvCellLink({
					linkId: "link-a",
					sourceIndex: 1,
					sourcePortalId: "portal-a",
					targetPortalId: "portal-b",
				}),
				createEnvCellLink({
					linkId: "link-a",
					sourceIndex: 0,
					sourcePortalId: "portal-a-duplicate",
					targetPortalId: "portal-b-duplicate",
				}),
			],
		});

		expect(graph).toMatchObject({
			kind: "static-portal-graph",
			landblockId: 0xda55ffff,
			nodes: [
				{ nodeId: "env-cell:3663003904" },
				{ nodeId: "env-cell:3663003905" },
			],
		});
		expect(graph.edges.map((edge) => edge.edgeId)).toEqual([
			"env-cell-portal:link-a:0",
			"env-cell-portal:link-a:1",
		]);
		expect(graph.edges).toEqual([
			expect.objectContaining({
				direction: "directed",
				provenance: expect.objectContaining({
					kind: "env-cell-portal",
					sourcePortalId: "portal-a-duplicate",
					target: {
						envCellId: 0xda550101,
						kind: "env-cell",
						portalId: "portal-b-duplicate",
					},
				}),
				sceneCrossing: {
					kind: "env-cell-to-env-cell",
					sourceEnvCellId: 0xda550100,
					targetEnvCellId: 0xda550101,
				},
			}),
			expect.objectContaining({
				direction: "directed",
				provenance: expect.objectContaining({
					kind: "env-cell-portal",
					sourcePortalId: "portal-a",
					target: {
						envCellId: 0xda550101,
						kind: "env-cell",
						portalId: "portal-b",
					},
				}),
			}),
		]);
	});

	it("normalizes env-cell scene-crossing links into graph edges", () => {
		const owner = createWorkOwner("work-env", "landblock-env-cells");
		const graph = createEnvCellStaticPortalGraph(owner, {
			envCells: [createPortalSummary(0xda550100)],
			kind: "env-cell-portal-interior",
			landblockId: 0xda55ffff,
			owner,
			portalLinks: [
				{
					flags: 0,
					linkId: "a-to-outside",
					polygonId: null,
					source: {
						envCellId: 0xda550100,
						kind: "env-cell",
						portalId: "portal-a",
					},
					sourceIndex: 1,
					target: {
						kind: "outside",
						landblockId: 0xda55ffff,
					},
				},
				{
					flags: 0,
					linkId: "a-to-building",
					polygonId: null,
					source: {
						envCellId: 0xda550100,
						kind: "env-cell",
						portalId: "portal-b",
					},
					sourceIndex: 0,
					target: {
						instanceId: "building-a",
						kind: "landblock-building",
						portalId: "building-portal-a",
					},
				},
			],
		});

		expect(graph.nodes.map((node) => node.nodeId)).toEqual([
			"building:building-a",
			"env-cell:3663003904",
			"outdoor:3663069183",
		]);
		expect(graph.edges.map((edge) => edge.sceneCrossing)).toEqual([
			{
				buildingInstanceId: "building-a",
				kind: "env-cell-to-landblock-building",
				sourceEnvCellId: 0xda550100,
			},
			{
				kind: "env-cell-to-outdoor",
				outdoorLandblockId: 0xda55ffff,
				sourceEnvCellId: 0xda550100,
			},
		]);
	});

	it("normalizes building transitions into the same graph edge shape", () => {
		const owner = createWorkOwner("work-building", "outdoor-buildings");
		const graph = createTransitionStaticPortalGraph(
			owner,
			createTransitionApertureBatch(),
		);

		expect(graph.nodes.map((node) => node.nodeId)).toEqual([
			"env-cell:3663003904",
			"outdoor:3663069183",
		]);
		expect(graph.edges).toEqual([
			expect.objectContaining({
				direction: "directed",
				edgeId:
					"building-transition:transition-apertures:da55ffff:building-a:portal-0:3663003904",
				linkId:
					"transition:transition-apertures:da55ffff:building-a:portal-0:3663003904",
				provenance: {
					apertureBatchId: "transition-apertures:da55ffff:building-a",
					buildingInstanceId: "building-a",
					buildingPortalId: "building-portal-a",
					kind: "building-transition",
					portalId: "portal-0",
					targetEnvCellId: 0xda550100,
				},
				sceneCrossing: {
					envCellId: 0xda550100,
					kind: "outdoor-to-env-cell",
					outdoorLandblockId: 0xda55ffff,
				},
				sourceNodeId: "outdoor:3663069183",
				targetNodeId: "env-cell:3663003904",
			}),
		]);
	});

	it("projects outdoor portals by env-cell identity and longest acyclic layer", () => {
		const owner = createWorkOwner("work-env", "landblock-env-cells");
		const record = createPortalInteriorRecord({
			envCellIds: [0xda550100, 0xda550101, 0xda550102, 0xda550103],
			links: [
				createEnvCellLink({
					linkId: "b-to-d",
					sourceEnvCellId: 0xda550101,
					sourcePortalId: "portal-bd",
					targetEnvCellId: 0xda550103,
					targetPortalId: "portal-db",
				}),
				createEnvCellLink({
					linkId: "b-to-c",
					sourceEnvCellId: 0xda550101,
					sourcePortalId: "portal-bc",
					targetEnvCellId: 0xda550102,
					targetPortalId: "portal-cb",
				}),
				createEnvCellLink({
					linkId: "c-to-d",
					sourceEnvCellId: 0xda550102,
					sourcePortalId: "portal-cd",
					targetEnvCellId: 0xda550103,
					targetPortalId: "portal-dc",
				}),
			],
			owner,
		});

		const projection = createStaticPortalProjection({
			landblockId: 0xda55ffff,
			root: createOutdoorPortalProjectionRoot(0xda55ffff),
			portalGraphs: [createEnvCellStaticPortalGraph(owner, record)],
			portalInteriorRecords: [record],
			transitionApertureBatches: [
				createTransitionApertureBatch({
					ranges: [
						createTransitionApertureRange({
							portalId: "portal-root",
							targetCellLowId: 0x0101,
						}),
					],
				}),
			],
		});

		expect(projection).toMatchObject({
			kind: "portal-projection",
			root: {
				kind: "outdoor-root",
				landblockId: 0xda55ffff,
				rootNodeId: "outdoor:3663069183",
			},
			rootNodeId: "outdoor:3663069183",
		});
		expect(projection?.sourceRevisionKey).toContain(
			"root:outdoor-root:3663069183:outdoor:3663069183:none",
		);
		expect(projection?.nodes.map((node) => node.envCellId)).toEqual([
			0xda550100, 0xda550101, 0xda550102, 0xda550103,
		]);
		expect(projection?.renderLayerByEnvCellId).toEqual([
			{ envCellId: 0xda550101, renderLayer: 1 },
			{ envCellId: 0xda550102, renderLayer: 2 },
			{ envCellId: 0xda550103, renderLayer: 3 },
		]);
		expect(
			projection?.incomingEdges.find(
				(incoming) => incoming.targetEnvCellId === 0xda550103,
			)?.edgeIds,
		).toEqual([
			"env-cell-portal:env-cell-portal:b-to-d:0",
			"env-cell-portal:env-cell-portal:c-to-d:0",
		]);
	});

	it("projects cycles as finite strongly connected components", () => {
		const owner = createWorkOwner("work-env", "landblock-env-cells");
		const record = createPortalInteriorRecord({
			envCellIds: [0xda550100, 0xda550101, 0xda550102, 0xda550103],
			links: [
				createEnvCellLink({
					linkId: "b-to-c",
					sourceEnvCellId: 0xda550101,
					sourcePortalId: "portal-bc",
					targetEnvCellId: 0xda550102,
					targetPortalId: "portal-cb",
				}),
				createEnvCellLink({
					linkId: "c-to-b",
					sourceEnvCellId: 0xda550102,
					sourcePortalId: "portal-cb",
					targetEnvCellId: 0xda550101,
					targetPortalId: "portal-bc",
				}),
				createEnvCellLink({
					linkId: "c-to-d",
					sourceEnvCellId: 0xda550102,
					sourcePortalId: "portal-cd",
					targetEnvCellId: 0xda550103,
					targetPortalId: "portal-dc",
				}),
			],
			owner,
		});

		const projection = createStaticPortalProjection({
			landblockId: 0xda55ffff,
			root: createOutdoorPortalProjectionRoot(0xda55ffff),
			portalGraphs: [createEnvCellStaticPortalGraph(owner, record)],
			portalInteriorRecords: [record],
			transitionApertureBatches: [
				createTransitionApertureBatch({
					ranges: [
						createTransitionApertureRange({
							portalId: "portal-root",
							targetCellLowId: 0x0101,
						}),
					],
				}),
			],
		});

		expect(
			projection?.components.find(
				(component) =>
					component.envCellIds.includes(0xda550101) &&
					component.envCellIds.includes(0xda550102),
			),
		).toMatchObject({
			cyclic: true,
			envCellIds: [0xda550101, 0xda550102],
			renderLayer: 1,
		});
		expect(projection?.renderLayerByEnvCellId).toContainEqual({
			envCellId: 0xda550103,
			renderLayer: 2,
		});
		expect(projection?.diagnostics.componentInternalEdgeCount).toBe(2);
	});

	it("keeps multiple transition apertures into one projected env-cell node", () => {
		const owner = createWorkOwner("work-env", "landblock-env-cells");
		const record = createPortalInteriorRecord({
			envCellIds: [0xda550100],
			links: [],
			owner,
		});

		const projection = createStaticPortalProjection({
			landblockId: 0xda55ffff,
			root: createOutdoorPortalProjectionRoot(0xda55ffff),
			portalGraphs: [createEnvCellStaticPortalGraph(owner, record)],
			portalInteriorRecords: [record],
			transitionApertureBatches: [
				createTransitionApertureBatch({
					ranges: [
						createTransitionApertureRange({
							firstIndex: 0,
							portalId: "portal-a",
							targetCellLowId: 0x0100,
						}),
						createTransitionApertureRange({
							firstIndex: 3,
							portalId: "portal-b",
							targetCellLowId: 0x0100,
						}),
					],
				}),
			],
		});

		expect(projection?.nodes).toEqual([
			{ envCellId: 0xda550100, nodeId: "env-cell:3663003904" },
		]);
		expect(projection?.incomingEdges).toEqual([
			{
				edgeIds: [
					"building-transition:transition-apertures:da55ffff:building-a:portal-a:0:3:3663003904",
					"building-transition:transition-apertures:da55ffff:building-a:portal-b:3:3:3663003904",
				],
				targetEnvCellId: 0xda550100,
			},
		]);
		expect(projection?.diagnostics.acceptedTransitionRootCount).toBe(2);
	});
});

function createWorkOwner(
	workId: string,
	domain: StaticWorkPeerRecordOwner["domain"],
): StaticWorkPeerRecordOwner {
	return {
		domain,
		kind: "work",
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
		scopeKey: "landblock:da55ffff",
		workId,
	};
}

function createPortalSummary(
	envCellId: number,
	options: {
		readonly portalApertures?: StaticPortalInteriorRecord["envCells"][number]["portalApertures"];
		readonly seenOutside?: boolean | null;
	} = {},
): StaticPortalInteriorRecord["envCells"][number] {
	return {
		envCellId,
		localPlacement: createPlacement(),
		portalApertures: options.portalApertures ?? [],
		portals: [],
		seenOutside: options.seenOutside ?? null,
	};
}

function createEnvCellLink(options: {
	readonly linkId: string;
	readonly sourceEnvCellId?: number;
	readonly sourceIndex?: number;
	readonly sourcePortalId: string;
	readonly targetEnvCellId?: number;
	readonly targetPortalId: string;
}): LandblockPortalLinkFacts {
	return {
		flags: 4,
		linkId: options.linkId,
		polygonId: 12,
		source: {
			envCellId: options.sourceEnvCellId ?? 0xda550100,
			kind: "env-cell",
			portalId: options.sourcePortalId,
		},
		sourceIndex: options.sourceIndex ?? 0,
		target: {
			envCellId: options.targetEnvCellId ?? 0xda550101,
			kind: "env-cell",
			portalId: options.targetPortalId,
		},
	};
}

function createPortalInteriorRecord(options: {
	readonly envCellIds: readonly number[];
	readonly links: readonly LandblockPortalLinkFacts[];
	readonly owner: StaticWorkPeerRecordOwner;
}): StaticPortalInteriorRecord {
	return {
		envCells: options.envCellIds.map((envCellId) =>
			createPortalSummary(envCellId, {
				portalApertures: [
					createPortalAperture({
						portalId: "portal-bd",
						sourceIndex: 0,
					}),
					createPortalAperture({
						portalId: "portal-bc",
						sourceIndex: 0,
					}),
					createPortalAperture({
						portalId: "portal-cd",
						sourceIndex: 0,
					}),
					createPortalAperture({
						portalId: "portal-cb",
						sourceIndex: 0,
					}),
				],
				seenOutside: true,
			}),
		),
		kind: "env-cell-portal-interior",
		landblockId: 0xda55ffff,
		owner: options.owner,
		portalLinks: options.links,
	};
}

function createPortalAperture(options: {
	readonly portalId: string;
	readonly sourceIndex: number;
}): StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number] {
	return {
		plane: null,
		points: [
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
			{ x: 0, y: 1, z: 0 },
		],
		polygonId: 12,
		portalId: options.portalId,
		sourceIndex: options.sourceIndex,
	};
}

function createTransitionApertureBatch(
	options: {
		readonly ranges?: readonly TransitionApertureBatch["ranges"][number][];
	} = {},
): TransitionApertureBatch {
	return {
		apertureBatchId: "transition-apertures:da55ffff:building-a",
		coordinateSpace: "landblock-render-local",
		frontFace: "indoor-visible",
		indices: [0, 1, 2],
		kind: "transition-aperture-batch",
		landblockId: 0xda55ffff,
		planes: [null],
		ranges: options.ranges ?? [createTransitionApertureRange()],
		sourceDomain: "outdoor-buildings",
		vertices: [
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
			{ x: 0, y: 1, z: 0 },
		],
	};
}

function createTransitionApertureRange(
	options: {
		readonly firstIndex?: number;
		readonly portalId?: string;
		readonly targetCellLowId?: number;
	} = {},
): TransitionApertureBatch["ranges"][number] {
	return {
		exterior: {
			kind: "outside",
			landblockId: 0xda55ffff,
		},
		firstIndex: options.firstIndex ?? 0,
		indexCount: 3,
		portalId: options.portalId ?? "portal-0",
		source: {
			buildingInstanceId: "building-a",
			buildingPortalId: "building-portal-a",
			buildingPortalSourceIndex: 3,
			kind: "building-portal",
			linkedEnvCellIds: [0xda550100, 0xda550101],
			otherCellId: options.targetCellLowId ?? 0x0100,
			otherPortalId: 8,
			polyId: 99,
			portalIndex: 0,
			sourceAssetId: "setup-model/02000010",
			sourceDid: 0x02000010,
		},
	};
}

function createPlacement() {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin: { x: 0, y: 0, z: 0 },
	};
}
