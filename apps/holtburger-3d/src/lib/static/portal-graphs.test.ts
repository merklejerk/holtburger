import { describe, expect, it } from "vitest";
import type {
	LandblockPortalLinkFacts,
	StaticPortalApertureResource,
	StaticPortalGraphEdge,
	StaticPortalGraphNode,
	StaticPortalGraphRecord,
	StaticPortalGraphScene,
	StaticPortalInteriorRecord,
	StaticLayerPeerRecordOwner,
} from "./contracts";
import {
	createEnvCellPortalProjectionRoot,
	createOutdoorPortalProjectionRoot,
	createStaticPortalProjection,
} from "./portal-graphs";

describe("static portal graphs", () => {
	it("projects outdoor portals by env-cell identity and longest acyclic layer", () => {
		const owner = createLayerOwner("env-cell-system");
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
			portalApertureResources: [
				createBuildingTransitionPortalApertureResource({
					ranges: [
						createBuildingTransitionApertureRange({
							portalId: "portal-root",
							targetCellLowId: 0x0101,
						}),
					],
				}),
			],
			portalGraphs: [createEnvCellPortalGraphFixture(owner, record)],
			portalInteriorRecords: [record],
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
		const owner = createLayerOwner("env-cell-system");
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
			portalApertureResources: [
				createBuildingTransitionPortalApertureResource({
					ranges: [
						createBuildingTransitionApertureRange({
							portalId: "portal-root",
							targetCellLowId: 0x0101,
						}),
					],
				}),
			],
			portalGraphs: [createEnvCellPortalGraphFixture(owner, record)],
			portalInteriorRecords: [record],
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
		const owner = createLayerOwner("env-cell-system");
		const record = createPortalInteriorRecord({
			envCellIds: [0xda550100],
			links: [],
			owner,
		});

		const projection = createStaticPortalProjection({
			landblockId: 0xda55ffff,
			root: createOutdoorPortalProjectionRoot(0xda55ffff),
			portalApertureResources: [
				createBuildingTransitionPortalApertureResource({
					ranges: [
						createBuildingTransitionApertureRange({
							firstIndex: 0,
							portalId: "portal-a",
							targetCellLowId: 0x0100,
						}),
						createBuildingTransitionApertureRange({
							firstIndex: 3,
							portalId: "portal-b",
							targetCellLowId: 0x0100,
						}),
					],
				}),
			],
			portalGraphs: [createEnvCellPortalGraphFixture(owner, record)],
			portalInteriorRecords: [record],
		});

		expect(projection?.nodes).toEqual([
			{ envCellId: 0xda550100, nodeId: "env-cell:3663003904" },
		]);
		expect(projection?.incomingEdges).toEqual([
			{
				edgeIds: [
					"building-transition:portal-aperture-resource:building-transition:0xda55ffff:portal-a:0:3:3663003904",
					"building-transition:portal-aperture-resource:building-transition:0xda55ffff:portal-b:3:3:3663003904",
				],
				targetEnvCellId: 0xda550100,
			},
		]);
		expect(projection?.diagnostics.acceptedTransitionRootCount).toBe(2);
	});

	it("projects outdoor-root outbound outdoor crossings for outside-visible env cells", () => {
		const owner = createLayerOwner("env-cell-system");
		const record = createPortalInteriorRecord({
			envCellIds: [0xda550100, 0xda550101],
			links: [
				createEnvCellLink({
					linkId: "a-to-b",
					sourceEnvCellId: 0xda550100,
					sourcePortalId: "portal-ab",
					targetEnvCellId: 0xda550101,
					targetPortalId: "portal-ba",
				}),
			],
			owner,
		});

		const projection = createStaticPortalProjection({
			landblockId: 0xda55ffff,
			root: createOutdoorPortalProjectionRoot(0xda55ffff),
			portalApertureResources: [
				createBuildingTransitionPortalApertureResource({
					ranges: [
						createBuildingTransitionApertureRange({
							portalId: "window-a",
							targetCellLowId: 0x0100,
						}),
						createBuildingTransitionApertureRange({
							firstIndex: 3,
							portalId: "window-b",
							targetCellLowId: 0x0101,
						}),
						createBuildingTransitionApertureRange({
							firstIndex: 6,
							portalId: "not-outside-visible",
							targetCellLowId: 0x0102,
						}),
					],
				}),
			],
			portalGraphs: [createEnvCellPortalGraphFixture(owner, record)],
			portalInteriorRecords: [record],
		});

		expect(projection?.outdoorSceneCrossings).toEqual([
			expect.objectContaining({
				linkId:
					"transition:portal-aperture-resource:building-transition:0xda55ffff:window-a:3663003904",
				outdoorLandblockId: 0xda55ffff,
				targetEnvCellId: 0xda550100,
			}),
			expect.objectContaining({
				linkId:
					"transition:portal-aperture-resource:building-transition:0xda55ffff:window-b:3663003905",
				outdoorLandblockId: 0xda55ffff,
				targetEnvCellId: 0xda550101,
			}),
		]);
		expect(projection?.diagnostics).toMatchObject({
			outboundOutdoorCrossingCandidateCount: 3,
			outboundOutdoorCrossingRetainedCount: 2,
			outboundOutdoorCrossingSkippedUnreachableTarget: 1,
		});
	});

	it("projects env-cell roots by reachable portal links and longest acyclic layer", () => {
		const owner = createLayerOwner("env-cell-system");
		const record = createPortalInteriorRecord({
			envCellIds: [0xda550100, 0xda550101, 0xda550102, 0xda550103],
			links: [
				createEnvCellLink({
					linkId: "a-to-b",
					sourceEnvCellId: 0xda550100,
					sourcePortalId: "portal-ab",
					targetEnvCellId: 0xda550101,
					targetPortalId: "portal-ba",
				}),
				createEnvCellLink({
					linkId: "a-to-c",
					sourceEnvCellId: 0xda550100,
					sourcePortalId: "portal-ac",
					targetEnvCellId: 0xda550102,
					targetPortalId: "portal-ca",
				}),
				createEnvCellLink({
					linkId: "c-to-b",
					sourceEnvCellId: 0xda550102,
					sourcePortalId: "portal-cb",
					targetEnvCellId: 0xda550101,
					targetPortalId: "portal-bc",
				}),
			],
			owner,
		});

		const projection = createStaticPortalProjection({
			landblockId: 0xda55ffff,
			root: createEnvCellPortalProjectionRoot({
				envCellId: 0xda550100,
				landblockId: 0xda55ffff,
			}),
			portalApertureResources: [
				createBuildingTransitionPortalApertureResource({
					ranges: [
						createBuildingTransitionApertureRange({
							portalId: "ignored-transition",
							targetCellLowId: 0x0103,
						}),
					],
				}),
			],
			portalGraphs: [createEnvCellPortalGraphFixture(owner, record)],
			portalInteriorRecords: [record],
		});

		expect(projection).toMatchObject({
			kind: "portal-projection",
			root: {
				envCellId: 0xda550100,
				kind: "env-cell-root",
				landblockId: 0xda55ffff,
				rootNodeId: "env-cell:3663003904",
			},
			rootNodeId: "env-cell:3663003904",
		});
		expect(projection?.sourceRevisionKey).toContain(
			"root:env-cell-root:3663069183:env-cell:3663003904:3663003904",
		);
		expect(projection?.sourceRevisionKey).toContain("ignored-transition");
		expect(projection?.nodes.map((node) => node.envCellId)).toEqual([
			0xda550100, 0xda550101, 0xda550102,
		]);
		expect(projection?.renderLayerByEnvCellId).toEqual([
			{ envCellId: 0xda550100, renderLayer: 0 },
			{ envCellId: 0xda550101, renderLayer: 2 },
			{ envCellId: 0xda550102, renderLayer: 1 },
		]);
		expect(
			projection?.incomingEdges.find(
				(incoming) => incoming.targetEnvCellId === 0xda550101,
			)?.edgeIds,
		).toEqual([
			"env-cell-portal:env-cell-portal:a-to-b:0",
			"env-cell-portal:env-cell-portal:c-to-b:0",
		]);
	});

	it("projects env-cell root outbound outdoor crossings from building transition apertures", () => {
		const owner = createLayerOwner("env-cell-system");
		const record = createPortalInteriorRecord({
			envCellIds: [0xda550100, 0xda550101],
			links: [
				createEnvCellLink({
					linkId: "a-to-b",
					sourceEnvCellId: 0xda550100,
					sourcePortalId: "portal-ab",
					targetEnvCellId: 0xda550101,
					targetPortalId: "portal-ba",
				}),
			],
			owner,
		});

		const projection = createStaticPortalProjection({
			landblockId: 0xda55ffff,
			root: createEnvCellPortalProjectionRoot({
				envCellId: 0xda550100,
				landblockId: 0xda55ffff,
			}),
			portalApertureResources: [
				createBuildingTransitionPortalApertureResource({
					ranges: [
						createBuildingTransitionApertureRange({
							portalId: "window-b",
							targetCellLowId: 0x0101,
						}),
						createBuildingTransitionApertureRange({
							firstIndex: 3,
							portalId: "unreachable-window",
							targetCellLowId: 0x0102,
						}),
					],
				}),
			],
			portalGraphs: [createEnvCellPortalGraphFixture(owner, record)],
			portalInteriorRecords: [record],
		});

		expect(projection?.outdoorSceneCrossings).toEqual([
			expect.objectContaining({
				crossingId:
					"outdoor-scene-crossing:portal-aperture-resource:building-transition:0xda55ffff:window-b:0:3:3663003905",
				linkId:
					"transition:portal-aperture-resource:building-transition:0xda55ffff:window-b:3663003905",
				outdoorLandblockId: 0xda55ffff,
				targetEnvCellId: 0xda550101,
			}),
		]);
		expect(projection?.diagnostics).toMatchObject({
			outboundOutdoorCrossingCandidateCount: 2,
			outboundOutdoorCrossingRetainedCount: 1,
			outboundOutdoorCrossingSkippedUnreachableTarget: 1,
		});
	});

	it("keeps env-cell root cycles finite without assigning layer zero to non-root cells", () => {
		const owner = createLayerOwner("env-cell-system");
		const record = createPortalInteriorRecord({
			envCellIds: [0xda550100, 0xda550101, 0xda550102],
			links: [
				createEnvCellLink({
					linkId: "a-to-c",
					sourceEnvCellId: 0xda550100,
					sourcePortalId: "portal-ac",
					targetEnvCellId: 0xda550102,
					targetPortalId: "portal-ca",
				}),
				createEnvCellLink({
					linkId: "c-to-a",
					sourceEnvCellId: 0xda550102,
					sourcePortalId: "portal-ca",
					targetEnvCellId: 0xda550100,
					targetPortalId: "portal-ac",
				}),
				createEnvCellLink({
					linkId: "c-to-b",
					sourceEnvCellId: 0xda550102,
					sourcePortalId: "portal-cb",
					targetEnvCellId: 0xda550101,
					targetPortalId: "portal-bc",
				}),
			],
			owner,
		});

		const projection = createStaticPortalProjection({
			landblockId: 0xda55ffff,
			root: createEnvCellPortalProjectionRoot({
				envCellId: 0xda550100,
				landblockId: 0xda55ffff,
			}),
			portalApertureResources: [],
			portalGraphs: [createEnvCellPortalGraphFixture(owner, record)],
			portalInteriorRecords: [record],
		});

		expect(
			projection?.components.find((component) =>
				component.envCellIds.includes(0xda550100),
			),
		).toMatchObject({
			cyclic: true,
			envCellIds: [0xda550100, 0xda550102],
			renderLayer: null,
		});
		expect(projection?.renderLayerByEnvCellId).toEqual([
			{ envCellId: 0xda550100, renderLayer: 0 },
			{ envCellId: 0xda550101, renderLayer: 2 },
			{ envCellId: 0xda550102, renderLayer: 1 },
		]);
		expect(projection?.diagnostics.componentInternalEdgeCount).toBe(2);
	});

	it("preserves per-cell layers inside a cyclic env-cell root component", () => {
		const owner = createLayerOwner("env-cell-system");
		const record = createPortalInteriorRecord({
			envCellIds: [0xda550100, 0xda550101, 0xda550102],
			links: [
				createEnvCellLink({
					linkId: "a-to-b",
					sourceEnvCellId: 0xda550100,
					sourcePortalId: "portal-ab",
					targetEnvCellId: 0xda550101,
					targetPortalId: "portal-ba",
				}),
				createEnvCellLink({
					linkId: "b-to-c",
					sourceEnvCellId: 0xda550101,
					sourcePortalId: "portal-bc",
					targetEnvCellId: 0xda550102,
					targetPortalId: "portal-cb",
				}),
				createEnvCellLink({
					linkId: "c-to-a",
					sourceEnvCellId: 0xda550102,
					sourcePortalId: "portal-ca",
					targetEnvCellId: 0xda550100,
					targetPortalId: "portal-ac",
				}),
			],
			owner,
		});

		const projection = createStaticPortalProjection({
			landblockId: 0xda55ffff,
			root: createEnvCellPortalProjectionRoot({
				envCellId: 0xda550100,
				landblockId: 0xda55ffff,
			}),
			portalApertureResources: [],
			portalGraphs: [createEnvCellPortalGraphFixture(owner, record)],
			portalInteriorRecords: [record],
		});

		expect(
			projection?.components.find((component) =>
				component.envCellIds.includes(0xda550100),
			),
		).toMatchObject({
			cyclic: true,
			envCellIds: [0xda550100, 0xda550101, 0xda550102],
			renderLayer: null,
		});
		expect(projection?.renderLayerByEnvCellId).toEqual([
			{ envCellId: 0xda550100, renderLayer: 0 },
			{ envCellId: 0xda550101, renderLayer: 1 },
			{ envCellId: 0xda550102, renderLayer: 2 },
		]);
	});
});

function createLayerOwner(domain: StaticLayerPeerRecordOwner["domain"]): StaticLayerPeerRecordOwner {
	const keyKind =
		domain === "env-cell-system" ? "env-cell-system" : domain;
	return {
		domain,
		key: {
			kind: keyKind,
			landblockId: 0xda55ffff,
		},
		kind: "layer-owner",
		ownerId: `${keyKind}:0xda55ffff`,
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
	readonly owner: StaticLayerPeerRecordOwner;
}): StaticPortalInteriorRecord {
	return {
		envCells: options.envCellIds.map((envCellId) => {
			const portalIds = new Set([
				"portal-bd",
				"portal-bc",
				"portal-cd",
				"portal-cb",
			]);
			for (const link of options.links) {
				if (
					link.source.kind === "env-cell" &&
					link.source.envCellId === envCellId
				) {
					portalIds.add(link.source.portalId);
				}
			}
			return createPortalSummary(envCellId, {
				portalApertures: [...portalIds].map((portalId) =>
					createPortalAperture({
						portalId,
						sourceIndex: 0,
					}),
				),
				seenOutside: true,
			});
		}),
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

function createBuildingTransitionPortalApertureResource(
	options: {
		readonly ranges?: readonly StaticPortalApertureResource["ranges"][number][];
	} = {},
): StaticPortalApertureResource {
	return {
		apertureResourceId:
			"portal-aperture-resource:building-transition:0xda55ffff",
		coordinateSpace: "landblock-render-local",
		indices: [0, 1, 2],
		kind: "portal-aperture-resource",
		landblockId: 0xda55ffff,
		ranges: options.ranges ?? [createBuildingTransitionApertureRange()],
		sourceDomain: "outdoor-buildings",
		vertices: [
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
			{ x: 0, y: 1, z: 0 },
		],
	};
}

function createBuildingTransitionApertureRange(
	options: {
		readonly firstIndex?: number;
		readonly portalId?: string;
		readonly targetCellLowId?: number;
	} = {},
): StaticPortalApertureResource["ranges"][number] {
	const firstIndex = options.firstIndex ?? 0;
	const indexCount = 3;
	const portalId = options.portalId ?? "portal-0";
	const apertureResourceId =
		"portal-aperture-resource:building-transition:0xda55ffff";
	return {
		firstIndex,
		indexCount,
		rangeId: [
			"portal-aperture",
			"building-transition",
			apertureResourceId,
			portalId,
			firstIndex,
			indexCount,
		].join(":"),
		source: {
			buildingInstanceId: "building-a",
			buildingPortalId: "building-portal-a",
			buildingPortalSourceIndex: 3,
			kind: "building-transition",
			landblockId: 0xda55ffff,
			linkedEnvCellIds: [0xda550100, 0xda550101],
			otherCellId: options.targetCellLowId ?? 0x0100,
			otherPortalId: 8,
			polyId: 99,
			portalId,
			portalIndex: 0,
			sourceAssetId: "setup-model/02000010",
			sourceDid: 0x02000010,
			targetEnvCellId:
				(0xda55_0000 | (options.targetCellLowId ?? 0x0100)) >>> 0,
		},
		sourceId: [
			"building-transition",
			apertureResourceId,
			portalId,
			firstIndex,
			indexCount,
		].join(":"),
		sourceKind: "building-transition",
	};
}

function createEnvCellPortalGraphFixture(
	owner: StaticLayerPeerRecordOwner,
	record: StaticPortalInteriorRecord,
): StaticPortalGraphRecord {
	const nodesById = new Map<string, StaticPortalGraphNode>();
	for (const envCell of record.envCells) {
		const node = createPortalGraphFixtureNode({
			envCellId: envCell.envCellId,
			kind: "env-cell",
		});
		nodesById.set(node.nodeId, node);
	}

	const edges = record.portalLinks
		.map((link) => createEnvCellPortalGraphFixtureEdge(link, nodesById))
		.filter((edge): edge is StaticPortalGraphEdge => edge !== null)
		.sort(comparePortalGraphEdges);

	return {
		edges,
		kind: "static-portal-graph",
		landblockId: record.landblockId,
		nodes: [...nodesById.values()].sort(comparePortalGraphNodes),
		owner,
	};
}

function createEnvCellPortalGraphFixtureEdge(
	link: LandblockPortalLinkFacts,
	nodesById: Map<string, StaticPortalGraphNode>,
): StaticPortalGraphEdge | null {
	if (link.source.kind !== "env-cell") {
		return null;
	}

	const sourceNode = createPortalGraphFixtureNode({
		envCellId: link.source.envCellId,
		kind: "env-cell",
	});
	const targetNode = createPortalGraphFixtureNodeFromEndpoint(link.target);
	nodesById.set(sourceNode.nodeId, sourceNode);
	nodesById.set(targetNode.nodeId, targetNode);

	return {
		direction: "directed",
		edgeId: ["env-cell-portal", link.linkId, link.sourceIndex].join(":"),
		flags: link.flags,
		linkId: link.linkId,
		polygonId: link.polygonId,
		provenance: {
			kind: "env-cell-portal",
			sourceEnvCellId: link.source.envCellId,
			sourcePortalId: link.source.portalId,
			target: link.target,
		},
		sceneCrossing: createEnvCellPortalFixtureSceneCrossing(link),
		sourceIndex: link.sourceIndex,
		sourceNodeId: sourceNode.nodeId,
		targetNodeId: targetNode.nodeId,
	};
}

function createPortalGraphFixtureNodeFromEndpoint(
	endpoint: LandblockPortalLinkFacts["target"],
): StaticPortalGraphNode {
	switch (endpoint.kind) {
		case "env-cell":
			return createPortalGraphFixtureNode({
				envCellId: endpoint.envCellId,
				kind: "env-cell",
			});
		case "landblock-building":
			return createPortalGraphFixtureNode({
				buildingInstanceId: endpoint.instanceId,
				kind: "landblock-building",
			});
		case "outside":
			return createPortalGraphFixtureNode({
				kind: "outdoor",
				landblockId: endpoint.landblockId,
			});
	}
}

function createEnvCellPortalFixtureSceneCrossing(
	link: LandblockPortalLinkFacts,
): StaticPortalGraphEdge["sceneCrossing"] {
	if (link.source.kind !== "env-cell") {
		return null;
	}
	switch (link.target.kind) {
		case "env-cell":
			return {
				kind: "env-cell-to-env-cell",
				sourceEnvCellId: link.source.envCellId,
				targetEnvCellId: link.target.envCellId,
			};
		case "landblock-building":
			return {
				buildingInstanceId: link.target.instanceId,
				kind: "env-cell-to-landblock-building",
				sourceEnvCellId: link.source.envCellId,
			};
		case "outside":
			return {
				kind: "env-cell-to-outdoor",
				outdoorLandblockId: link.target.landblockId,
				sourceEnvCellId: link.source.envCellId,
			};
	}
}

function createPortalGraphFixtureNode(
	scene: StaticPortalGraphScene,
): StaticPortalGraphNode {
	switch (scene.kind) {
		case "env-cell":
			return {
				nodeId: `env-cell:${scene.envCellId >>> 0}`,
				scene,
			};
		case "landblock-building":
			return {
				nodeId: `building:${scene.buildingInstanceId}`,
				scene,
			};
		case "outdoor":
			return {
				nodeId: `outdoor:${scene.landblockId >>> 0}`,
				scene,
			};
	}
}

function comparePortalGraphNodes(
	left: StaticPortalGraphNode,
	right: StaticPortalGraphNode,
): number {
	return left.nodeId.localeCompare(right.nodeId);
}

function comparePortalGraphEdges(
	left: StaticPortalGraphEdge,
	right: StaticPortalGraphEdge,
): number {
	return left.edgeId.localeCompare(right.edgeId);
}

function createPlacement() {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin: { x: 0, y: 0, z: 0 },
	};
}
