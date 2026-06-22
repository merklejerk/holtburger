import { describe, expect, it } from "vitest";
import type {
	OutdoorStaticObjectsScopePayload,
	ScheduledStaticWork,
	StaticCoordinatorCommitDelta,
	StaticCoordinatorSourcePayloadDelta,
	StaticPortalInteriorRecord,
	TransitionApertureBatch,
} from "../static/contracts";
import type { StaticMaterializationResult } from "./static-materializer";
import { EnvCellSystemLayerAssemblyStore } from "./env-cell-system-layer-assembly";

describe("env-cell system layer assembly", () => {
	it("does not publish an env-cell system layer before building portal facts are loaded", () => {
		const store = new EnvCellSystemLayerAssemblyStore();

		expect(
			store.ingestMaterializedCommit(
				createEnvCellCommitDelta(1),
				createEnvCellMaterialization(1),
			),
		).toEqual([]);
	});

	it("treats loaded empty building transition facts as a valid assembly input", () => {
		const store = new EnvCellSystemLayerAssemblyStore();
		expect(
			store.ingestSourcePayload(createBuildingSourcePayloadDelta(1, 0)),
		).toBeNull();

		const [publication] = store.ingestMaterializedCommit(
			createEnvCellCommitDelta(2),
			createEnvCellMaterialization(2),
		);

		expect(publication).toMatchObject({
			key: "env-cell-system:0xda55ffff",
			payload: {
				generationId: expect.stringContaining("env-cell-system:0xda55ffff"),
				kind: "env-cell-system",
				landblockId: 0xda55ffff,
				portalProjectionRecords: [],
			},
		});
	});

	it("waits for building materialization when loaded source facts contain transition apertures", () => {
		const store = new EnvCellSystemLayerAssemblyStore();
		store.ingestSourcePayload(createBuildingSourcePayloadDelta(1, 1));

		expect(
			store.ingestMaterializedCommit(
				createEnvCellCommitDelta(2),
				createEnvCellMaterialization(2),
			),
		).toEqual([]);

		const [publication] = store.ingestMaterializedCommit(
			createBuildingCommitDelta(3),
			createBuildingMaterialization(3),
		);

		expect(publication?.payload.portalApertureResources).toEqual([
			expect.objectContaining({
				apertureResourceId: "portal-aperture-resource:building-transition",
				sourceDomain: "outdoor-buildings",
			}),
		]);
		expect(publication?.payload.generationId).toContain(
			"building-materialized:3",
		);
	});
});

function createBuildingSourcePayloadDelta(
	sourceRevision: number,
	transitionApertureCount: number,
): StaticCoordinatorSourcePayloadDelta {
	return {
		payload: {
			job: createJob("outdoor-buildings"),
			scope: {
				buildingTransitionApertures: Array.from({
					length: transitionApertureCount,
				}) as OutdoorStaticObjectsScopePayload["buildingTransitionApertures"],
				domain: "outdoor-buildings",
				kind: "outdoor-static-objects",
				landblock: {
					kind: "landblock-source",
					landblockId: 0xda55ffff,
					source: "outdoor",
				},
				materialSlots: [],
				materialSources: [],
				missingRefs: [],
				objects: [],
				paletteSources: [],
				regionRenderProfile: {
					detailRoles: [],
					identity: {
						kind: "region-render-profile",
						regionNumber: 0,
					},
				},
				sourceAssets: [],
				sourceSpatial: {
					bounds: null,
					coordinateSpace: "landblock-render-local",
					outdoorBvh: null,
					outdoorBvhItemCount: 0,
					outdoorBvhNodeCount: 0,
				},
				textureRefs: [],
			},
			sourceRevision,
		},
		revision: sourceRevision,
		work: createWork("outdoor-buildings", sourceRevision),
	};
}

function createEnvCellCommitDelta(
	revision: number,
): StaticCoordinatorCommitDelta {
	return createCommitDelta({
		revision,
		staticPortalInteriorRecords: [createPortalInteriorRecord(revision)],
		staticBatchId: `static-batch:${revision}:landblock-env-cells`,
	});
}

function createBuildingCommitDelta(
	revision: number,
): StaticCoordinatorCommitDelta {
	return createCommitDelta({
		addedPortalApertureResources: [
			{
				apertureResourceId: "portal-aperture-resource:building-transition",
				coordinateSpace: "landblock-render-local",
				indices: [0, 1, 2],
				kind: "portal-aperture-resource",
				landblockId: 0xda55ffff,
				ranges: [
					{
						firstIndex: 0,
						indexCount: 3,
						rangeId: "portal-range:building-transition",
						sourceId: "transition-source:0",
						sourceKind: "building-transition",
					},
				],
				sourceDomain: "outdoor-buildings",
				vertices: [
					{ x: 0, y: 0, z: 0 },
					{ x: 1, y: 0, z: 0 },
					{ x: 0, y: 1, z: 0 },
				],
			},
		],
		addedTransitionApertureBatches: [createTransitionApertureBatch()],
		revision,
		staticBatchId: `static-batch:${revision}:outdoor-buildings`,
	});
}

function createEnvCellMaterialization(
	revision: number,
): StaticMaterializationResult {
	return createMaterializationResult({
		revision,
		staticPortalInteriorRecords: [createPortalInteriorRecord(revision)],
	});
}

function createBuildingMaterialization(
	revision: number,
): StaticMaterializationResult {
	const commit = createBuildingCommitDelta(revision);
	return createMaterializationResult({
		addedPortalApertureResources: commit.addedPortalApertureResources,
		addedTransitionApertureBatches: commit.addedTransitionApertureBatches,
		revision,
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
		addedTransitionApertureBatches: [],
		materialCoverage: [],
		removedResources: [],
		staticAuthoredDynamicSeeds: [],
		staticBatchId: options.staticBatchId,
		staticPortalGraphs: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: [],
		staticSpatialRecords: [],
		staticVisibilityRecords: [],
		textureUses: [],
		...options,
	};
}

function createMaterializationResult(
	options: Partial<StaticMaterializationResult> & {
		readonly revision: number;
	},
): StaticMaterializationResult {
	return {
		drawUnitIdMappings: [],
		removedResources: [],
		staticAuthoredDynamicSeeds: [],
		staticDelta: {
			addedDrawUnits: [],
			addedPortalApertureResources: options.addedPortalApertureResources ?? [],
			addedTransitionApertureBatches:
				options.addedTransitionApertureBatches ?? [],
			removedDrawUnitIds: [],
			removedPortalApertureResourceIds: [],
			removedTransitionApertureBatchIds: [],
			revision: options.revision,
		},
		staticPortalGraphs: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: [],
		staticSpatialRecords: [],
		staticVisibilityRecords: [],
		textureUpdate: null,
		...options,
	};
}

function createPortalInteriorRecord(
	revision: number,
): StaticPortalInteriorRecord {
	return {
		envCells: [],
		kind: "env-cell-portal-interior",
		landblockId: 0xda55ffff,
		owner: createWorkPeerRecordOwner("landblock-env-cells", revision),
		portalLinks: [],
	};
}

function createTransitionApertureBatch(): TransitionApertureBatch {
	return {
		apertureBatchId: "transition-apertures:outdoor-buildings:3663069183",
		coordinateSpace: "landblock-render-local",
		frontFace: "indoor-visible",
		indices: [0, 1, 2],
		kind: "transition-aperture-batch",
		landblockId: 0xda55ffff,
		planes: [null],
		ranges: [
			{
				exterior: {
					buildingInstanceId: "building-a",
					buildingPortalId: "building-portal-a",
					kind: "landblock-building",
				},
				firstIndex: 0,
				indexCount: 3,
				portalId: "transition-portal-a",
				source: {
					buildingInstanceId: "building-a",
					buildingPortalId: "building-portal-a",
					buildingPortalSourceIndex: 0,
					kind: "building-portal",
					linkedEnvCellIds: [0xda550100],
					otherCellId: 0x0100,
					otherPortalId: 0,
					polyId: 7,
					portalIndex: 0,
					sourceAssetId: "gfx-obj/01000001",
					sourceDid: 0x01000001,
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

function createWork(
	domain: ScheduledStaticWork["job"]["domain"],
	revision: number,
): ScheduledStaticWork {
	return {
		job: createJob(domain),
		priority: domain === "outdoor-buildings" ? 5 : 10,
		revision,
		workId: `${revision}:landblock:da55ffff:${domain}`,
	};
}

function createJob(domain: ScheduledStaticWork["job"]["domain"]) {
	return {
		domain,
		scope: {
			kind: "landblock" as const,
			landblockId: 0xda55ffff,
		},
	};
}

function createWorkPeerRecordOwner(
	domain: ScheduledStaticWork["job"]["domain"],
	revision: number,
) {
	return {
		domain,
		kind: "work" as const,
		scope: {
			kind: "landblock" as const,
			landblockId: 0xda55ffff,
		},
		scopeKey: "landblock:da55ffff",
		workId: `${revision}:landblock:da55ffff:${domain}`,
	};
}
