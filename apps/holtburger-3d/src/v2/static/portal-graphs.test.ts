import { describe, expect, it } from "vitest";
import type {
	LandblockPortalLinkFacts,
	StaticPortalInteriorRecord,
	StaticWorkPeerRecordOwner,
	TransitionApertureBatch,
} from "./contracts";
import {
	createEnvCellStaticPortalGraph,
	createTransitionStaticPortalGraph,
} from "./portal-graphs";

describe("V2 static portal graphs", () => {
	it("normalizes env-cell portal links into directed graph edges", () => {
		const owner = createWorkOwner("work-env", "landblock-env-cells");
		const graph = createEnvCellStaticPortalGraph(owner, {
			envCells: [createPortalSummary(0xda550100), createPortalSummary(0xda550101)],
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
				edgeId: "building-transition:transition-apertures:da55ffff:building-a:portal-0:3663003904",
				linkId: "transition:transition-apertures:da55ffff:building-a:portal-0:3663003904",
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
): StaticPortalInteriorRecord["envCells"][number] {
	return {
		envCellId,
		localPlacement: createPlacement(),
		portalApertures: [],
		portals: [],
		seenOutside: null,
	};
}

function createEnvCellLink(options: {
	readonly linkId: string;
	readonly sourceIndex: number;
	readonly sourcePortalId: string;
	readonly targetPortalId: string;
}): LandblockPortalLinkFacts {
	return {
		flags: 4,
		linkId: options.linkId,
		polygonId: 12,
		source: {
			envCellId: 0xda550100,
			kind: "env-cell",
			portalId: options.sourcePortalId,
		},
		sourceIndex: options.sourceIndex,
		target: {
			envCellId: 0xda550101,
			kind: "env-cell",
			portalId: options.targetPortalId,
		},
	};
}

function createTransitionApertureBatch(): TransitionApertureBatch {
	return {
		apertureBatchId: "transition-apertures:da55ffff:building-a",
		coordinateSpace: "landblock-render-local",
		frontFace: "indoor-visible",
		indices: [0, 1, 2],
		kind: "transition-aperture-batch",
		landblockId: 0xda55ffff,
		planes: [null],
		ranges: [
			{
				exterior: {
					kind: "outside",
					landblockId: 0xda55ffff,
				},
				firstIndex: 0,
				indexCount: 3,
				portalId: "portal-0",
				source: {
					buildingInstanceId: "building-a",
					buildingPortalId: "building-portal-a",
					buildingPortalSourceIndex: 3,
					kind: "building-portal",
					linkedEnvCellIds: [0xda550100, 0xda550101],
					otherCellId: 0x0100,
					otherPortalId: 8,
					polyId: 99,
					portalIndex: 0,
					sourceAssetId: "setup-model/02000010",
					sourceDid: 0x02000010,
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

function createPlacement() {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin: { x: 0, y: 0, z: 0 },
	};
}
