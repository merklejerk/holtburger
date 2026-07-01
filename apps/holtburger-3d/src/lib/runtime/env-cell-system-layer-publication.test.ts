import { describe, expect, it } from "vitest";
import type {
	StaticCoordinatorCommitDelta,
	StaticDomain,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
} from "../static/contracts";
import type { StaticCommitInstallResult } from "./static-commit-installer";
import { createEnvCellSystemLayerPublications } from "./env-cell-system-layer-publication";

describe("env-cell system layer publication", () => {
	it("publishes directly from an installed env-cell commit", () => {
		const [publication] = createEnvCellSystemLayerPublications(
			createEnvCellCommitDelta(1),
			createEnvCellInstallResult(1),
		);

		expect(publication).toMatchObject({
			payload: {
				generationId: expect.stringContaining("env-cell-system:0xda55ffff"),
				kind: "env-cell-system",
				landblockId: 0xda55ffff,
				portalProjectionRecords: [],
			},
		});
	});

	it("includes building transition portal resources from the env-cell commit", () => {
		const transitionResource = createBuildingTransitionPortalApertureResource();
		const transitionGraph = createBuildingTransitionPortalGraph();

		const [publication] = createEnvCellSystemLayerPublications(
			createEnvCellCommitDelta(2),
			createEnvCellInstallResult(2, {
				portalApertureResources: [transitionResource],
				staticPortalGraphs: [transitionGraph],
			}),
		);

		expect(publication?.payload.portalApertureResources).toEqual([
			expect.objectContaining({
				apertureResourceId: "portal-aperture-resource:building-transition",
				sourceDomain: "outdoor-buildings",
			}),
		]);
		expect(publication?.payload.portalGraphRecords).toEqual([
			expect.objectContaining({
				owner: createLayerPeerRecordOwner("env-cell-system"),
			}),
		]);
	});

	it("does not publish from outdoor-building installation alone", () => {
		expect(
			createEnvCellSystemLayerPublications(
				createBuildingCommitDelta(3),
				createBuildingInstallResult(3),
			),
		).toEqual([]);
	});
});

function createEnvCellCommitDelta(
	revision: number,
): StaticCoordinatorCommitDelta {
	return createCommitDelta({
		revision,
		staticPortalInteriorRecords: [createPortalInteriorRecord()],
		staticBatchId: `static-batch:${revision}:env-cell-system`,
	});
}

function createBuildingCommitDelta(
	revision: number,
): StaticCoordinatorCommitDelta {
	return createCommitDelta({
		addedPortalApertureResources: [
			createBuildingTransitionPortalApertureResource(),
		],
		revision,
		staticBatchId: `static-batch:${revision}:outdoor-buildings`,
		staticPortalGraphs: [
			createBuildingTransitionPortalGraph("outdoor-buildings"),
		],
	});
}

function createEnvCellInstallResult(
	revision: number,
	options: Partial<StaticCommitInstallResult> = {},
): StaticCommitInstallResult {
	return createInstallResult({
		revision,
		staticPortalInteriorRecords: [createPortalInteriorRecord()],
		...options,
	});
}

function createBuildingInstallResult(
	revision: number,
): StaticCommitInstallResult {
	const commit = createBuildingCommitDelta(revision);
	return createInstallResult({
		portalApertureResources: commit.addedPortalApertureResources,
		revision,
		staticPortalGraphs: commit.staticPortalGraphs,
	});
}

function createCommitDelta(
	options: Partial<StaticCoordinatorCommitDelta> & {
		readonly revision: number;
		readonly staticBatchId: string;
	},
): StaticCoordinatorCommitDelta {
	return {
		addedDrawUnits: [],
		addedPortalApertureResources: [],
		commitId: `static-commit:${options.staticBatchId}`,
		materialCoverage: [],
		removedResources: [],
		envCellStaticObjectPlacementRecords: [],
		staticBatchId: options.staticBatchId,
		staticObjectRenderInstances: [],
		staticObjectVisualResources: [],
		staticPortalGraphs: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: [],
		staticSpatialRecords: [],
		staticVisibilityRecords: [],
		tasks: [],
		textureUses: [],
		...options,
	};
}

function createInstallResult(
	options: Partial<StaticCommitInstallResult> & {
		readonly revision: number;
	},
): StaticCommitInstallResult {
	return {
		installedDrawUnits: [],
		portalApertureResources: [],
		removedResources: [],
		staticObjectRenderInstances: [],
		staticObjectVisualResources: [],
		staticPortalGraphs: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: [],
		staticSpatialRecords: [],
		staticVisibilityRecords: [],
		textureUpdate: null,
		...options,
	};
}

function createPortalInteriorRecord(): StaticPortalInteriorRecord {
	return {
		envCells: [],
		kind: "env-cell-portal-interior",
		landblockId: 0xda55ffff,
		owner: createLayerPeerRecordOwner("env-cell-system"),
		portalLinks: [],
	};
}

function createBuildingTransitionPortalApertureResource() {
	return {
		apertureResourceId: "portal-aperture-resource:building-transition",
		coordinateSpace: "landblock-render-local" as const,
		indices: [0, 1, 2],
		kind: "portal-aperture-resource" as const,
		landblockId: 0xda55ffff,
		ranges: [
			{
				firstIndex: 0,
				indexCount: 3,
				rangeId: "portal-range:building-transition",
				source: {
					buildingInstanceId: "building-a",
					buildingPortalId: "building-portal-a",
					buildingPortalSourceIndex: 0,
					kind: "building-transition" as const,
					landblockId: 0xda55ffff,
					linkedEnvCellIds: [0xda550100],
					otherCellId: 0x0100,
					otherPortalId: 0,
					polyId: 7,
					portalId: "transition-portal-a",
					portalIndex: 0,
					sourceAssetId: "gfx-obj/01000001",
					sourceDid: 0x01000001,
					targetEnvCellId: 0xda550100,
				},
				sourceId: "transition-source:0",
				sourceKind: "building-transition" as const,
			},
		],
		sourceDomain: "outdoor-buildings" as const,
		vertices: [
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
			{ x: 0, y: 1, z: 0 },
		],
	};
}

function createBuildingTransitionPortalGraph(
	domain: StaticDomain = "env-cell-system",
): StaticPortalGraphRecord {
	return {
		edges: [
			{
				direction: "directed",
				edgeId: "edge:transition",
				flags: 0,
				linkId: "link:transition",
				polygonId: 7,
				provenance: {
					apertureResourceId: "portal-aperture-resource:building-transition",
					buildingInstanceId: "building-a",
					buildingPortalId: "building-portal-a",
					kind: "building-transition",
					portalId: "transition-portal-a",
					targetEnvCellId: 0xda550100,
				},
				sceneCrossing: {
					envCellId: 0xda550100,
					kind: "outdoor-to-env-cell",
					outdoorLandblockId: 0xda55ffff,
				},
				sourceIndex: 0,
				sourceNodeId: "outdoor:3663069183",
				targetNodeId: "env-cell:3663003904",
			},
		],
		kind: "static-portal-graph",
		landblockId: 0xda55ffff,
		nodes: [],
		owner: createLayerPeerRecordOwner(domain),
	};
}

function createLayerPeerRecordOwner(domain: StaticDomain) {
	const keyKind = domain === "env-cell-system" ? "env-cell-system" : domain;
	return {
		domain,
		key: {
			kind: keyKind,
			landblockId: 0xda55ffff,
		},
		kind: "layer-owner" as const,
		ownerId: `${keyKind}:0xda55ffff`,
	};
}
