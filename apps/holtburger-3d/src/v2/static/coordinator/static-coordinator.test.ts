import { describe, expect, it } from "vitest";
import { DeferredStaticBaker, DeferredStaticResolver } from "../fake-workers";
import type {
	StaticCoordinatorCommitDelta,
	StaticCoordinatorSourcePayloadDelta,
	StaticDemand,
	StaticDrawUnit,
	StaticScopePayload,
	StaticMaterialCoverageReport,
	StaticBakeAttachmentProvider,
	ScheduledStaticWork,
	StaticSpatialRecord,
	TerrainGeometryStaticDrawUnit,
	StaticVisibilityRecord,
} from "../contracts";
import { StaticCoordinator } from "./static-coordinator";

describe("V2 static coordinator", () => {
	it("rejects stale resolver results after a newer demand revision supersedes them", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});
		const [firstWork] = coordinator.requestStaticDemand(
			createSingleTerrainDemand(0xda55ffff),
		);
		const [secondWork] = coordinator.requestStaticDemand(
			createSingleTerrainDemand(0xda56ffff),
		);
		const firstResolverRequest = resolver.pendingRequests[0];
		const secondResolverRequest = resolver.pendingRequests[1];

		expect(firstWork.job).toEqual(firstResolverRequest?.job);
		resolver.complete(firstResolverRequest?.requestId ?? "");
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 0,
			staleResolverResults: 1,
		});
		expect(baker.pendingInputs).toHaveLength(0);

		resolver.complete(secondResolverRequest?.requestId ?? "");
		await flushPromises();
		baker.complete(secondWork.workId, {
			drawUnits: [createTerrainDrawUnit("terrain-a", 0xda56ffff)],
		});
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 1,
			committedDrawUnits: 1,
			staleResolverResults: 1,
		});
	});

	it("rejects stale bake results after a newer demand revision supersedes them", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		const [firstWork] = coordinator.requestStaticDemand(
			createSingleTerrainDemand(0xda55ffff),
		);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(1);

		coordinator.requestStaticDemand(createSingleTerrainDemand(0xda56ffff));
		baker.complete(firstWork.workId);
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 0,
			staleBakeResults: 1,
		});
	});

	it("marks work failed when bake attachment creation fails", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			attachmentProvider: new RejectingAttachmentProvider("geometry offline"),
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		coordinator.requestStaticDemand(createSingleTerrainDemand(0xda55ffff));
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(0);
		expect(coordinator.createSnapshot()).toMatchObject({
			failed: 1,
		});
		expect(coordinator.createSnapshot().activeWork[0]).toMatchObject({
			failureMessage: "geometry offline",
			status: "failed",
		});
	});

	it("diffs desired outdoor work across neighboring anchors", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		coordinator.requestStaticDemand({
			location: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
			lod: {
				buildings: -1,
				detail: -1,
				envCells: -1,
				terrain: 1,
			},
		});
		expect(resolver.pendingRequests).toHaveLength(5);

		coordinator.requestStaticDemand({
			location: {
				kind: "outdoor-landblock",
				landblockId: 0xdb55ffff,
			},
			lod: {
				buildings: -1,
				detail: -1,
				envCells: -1,
				terrain: 1,
			},
		});

		expect(resolver.pendingRequests).toHaveLength(8);
		expect(coordinator.createSnapshot().activeWork).toHaveLength(5);
		expect(
			new Set(
				coordinator.createSnapshot().activeWork.map((work) => work.scopeKey),
			),
		).toEqual(
			new Set([
				"landblock:da55ffff",
				"landblock:db55ffff",
				"landblock:db54ffff",
				"landblock:db56ffff",
				"landblock:dc55ffff",
			]),
		);

		const evictedRequest = resolver.pendingRequests.find(
			(request) =>
				request.job.scope.landblockId === 0xd955ffff &&
				request.job.domain === "outdoor-terrain",
		);
		resolver.complete(evictedRequest?.requestId ?? "");
		await flushPromises();

		expect(coordinator.createSnapshot().staleResolverResults).toBe(1);
	});

	it("tracks revisions on pending work without asset lease concepts", () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		coordinator.requestStaticDemand(createSingleTerrainDemand(0xda55ffff));

		expect(coordinator.createSnapshot().activeWork).toEqual([
			{
				domain: "outdoor-terrain",
				failureMessage: null,
				revision: 1,
				scopeKey: "landblock:da55ffff",
				status: "resolving",
				workId: "1:landblock:da55ffff:outdoor-terrain",
			},
		]);
		expect(JSON.stringify(coordinator.createSnapshot())).not.toContain("lease");
	});

	it("emits committed draw-unit deltas and eviction deltas", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});
		const deltas: StaticCoordinatorCommitDelta[] = [];
		coordinator.subscribeCommits((delta) => deltas.push(delta));

		const [work] = coordinator.requestStaticDemand(
			createSingleTerrainDemand(0xda55ffff),
		);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete(work.workId, {
			drawUnits: [createTerrainDrawUnit("terrain-a", 0xda55ffff)],
		});
		await flushPromises();

		expect(deltas).toEqual([
			{
				addedDrawUnits: [createTerrainDrawUnit("terrain-a", 0xda55ffff)],
				materialCoverage: [],
				removedDrawUnitIds: [],
				revision: 1,
				staticAuthoredDynamicSeeds: [],
				staticBatchId: "static-batch:1:outdoor-terrain:landblock:da55ffff:1",
				staticPortalInteriorRecords: [],
				staticSourceMappings: [],
				staticSpatialRecords: [],
				staticVisibilityRecords: [],
				textureUses: [],
			},
		]);
		expect(coordinator.createSnapshot().committedDrawUnits).toBe(1);

		coordinator.requestStaticDemand({
			location: null,
			lod: {
				buildings: -1,
				detail: -1,
				terrain: -1,
				envCells: -1,
			},
		});

		expect(deltas.at(-1)).toEqual({
			addedDrawUnits: [],
			materialCoverage: [],
			removedDrawUnitIds: ["terrain-a"],
			revision: 2,
			staticAuthoredDynamicSeeds: [],
			staticBatchId: "static-batch:2:evict",
			staticPortalInteriorRecords: [],
			staticSourceMappings: [],
			staticSpatialRecords: [],
			staticVisibilityRecords: [],
			textureUses: [],
		});
		expect(coordinator.createSnapshot().committedDrawUnits).toBe(0);
	});

	it("rejects ownerless committed draw units instead of inferring batch ownership", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});
		const deltas: StaticCoordinatorCommitDelta[] = [];
		coordinator.subscribeCommits((delta) => deltas.push(delta));

		const [work] = coordinator.requestStaticDemand(
			createSingleTerrainDemand(0xda55ffff),
		);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete(work.workId, {
			drawUnits: [createInvalidOwnerlessDrawUnit("bad-draw-unit")],
		});
		await flushPromises();

		expect(deltas).toEqual([]);
		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 0,
			committedDrawUnits: 0,
			failed: 1,
			latestResolverFailure: {
				message:
					"Static coordinator cannot commit ownerless draw unit bad-draw-unit.",
			},
		});
	});

	it("groups same-domain resolved payloads into one static bake batch", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: {
				maxPayloadsPerBatch: 8,
				maxWaitMs: 0,
			},
			resolver,
		});

		const work = coordinator.requestStaticDemand({
			location: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
			lod: {
				buildings: -1,
				detail: -1,
				terrain: 1,
				envCells: -1,
			},
		});
		const terrainWork = work.filter(
			(item) => item.job.domain === "outdoor-terrain",
		);

		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		resolver.complete(resolver.pendingRequests[1]?.requestId ?? "");
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(1);
		expect(baker.pendingInputs[0]).toMatchObject({
			domain: "outdoor-terrain",
			revision: 1,
			staticBatchId: "static-batch:1:outdoor-terrain:landblock:da55ffff:2",
		});
		expect(
			baker.pendingInputs[0]?.items.map((item) => item.work.workId),
		).toEqual(terrainWork.slice(0, 2).map((item) => item.workId));

		baker.complete(baker.pendingInputs[0]?.staticBatchId ?? "");
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 2,
			committedDrawUnits: 0,
		});
	});

	it("records compact outdoor static object payload summaries", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});
		const sourcePayloads: StaticCoordinatorSourcePayloadDelta[] = [];
		coordinator.subscribeSourcePayloads((delta) => sourcePayloads.push(delta));

		const work = coordinator.requestStaticDemand({
			location: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
			lod: {
				buildings: 0,
				detail: -1,
				terrain: 0,
				envCells: -1,
			},
		});
		const buildingWork = work.find(
			(item) => item.job.domain === "outdoor-buildings",
		);
		const buildingResolverRequest = resolver.pendingRequests.find(
			(request) => request.job.domain === "outdoor-buildings",
		);

		resolver.complete(buildingResolverRequest?.requestId ?? "", {
			scope: {
				domain: "outdoor-buildings",
				kind: "outdoor-static-objects",
				landblock: {
					kind: "landblock-source",
					landblockId: 0xda55ffff,
					source: "outdoor",
				},
				materialSlots: [
					{
						gfxObj: {
							kind: "static-object-source",
							sourceAssetKind: "gfx-obj",
							sourceDid: 0x01000020,
						},
						identity: {
							kind: "static-material-slot",
							part: {
								kind: "static-object-part",
								object: {
									instanceId: "building-0",
									kind: "static-object-instance",
									landblockId: 0xda55ffff,
									objectKind: "building",
								},
								partIndex: 0,
							},
							slotIndex: 0,
							surfaceId: 0x08000010,
						},
						material: {
							kind: "static-material-source",
							materialId: 0x08000010,
						},
						materialVariantSignature: null,
						object: {
							instanceId: "building-0",
							kind: "static-object-instance",
							landblockId: 0xda55ffff,
							objectKind: "building",
						},
						source: {
							kind: "static-object-source",
							sourceAssetKind: "setup-model",
							sourceDid: 0x02000010,
						},
					},
				],
				materialSources: [
					{
						diffuse: 1,
						identity: {
							kind: "static-material-source",
							materialId: 0x08000010,
						},
						luminosity: 0,
						source: { argb: 0xffffffff, kind: "solid-color" },
						surfaceId: 0x08000010,
						surfaceType: 0,
						translucency: 0,
					},
				],
				missingRefs: [],
				objects: [
					{
						debug: { sourceAssetId: "setup-model/02000010" },
						generated: null,
						identity: {
							instanceId: "building-0",
							kind: "static-object-instance",
							landblockId: 0xda55ffff,
							objectKind: "building",
						},
						instanceBounds: null,
						localPlacement: {
							orientation: { w: 1, x: 0, y: 0, z: 0 },
							origin: { x: 0, y: 0, z: 0 },
						},
						portalCount: 0,
						source: {
							kind: "static-object-source",
							sourceAssetKind: "setup-model",
							sourceDid: 0x02000010,
						},
						sourceBounds: null,
						sourceIndex: 0,
						sourceScale: { x: 1, y: 1, z: 1 },
					},
				],
				regionRenderProfile: {
					detailRoles: [],
					identity: {
						kind: "region-render-profile",
						regionNumber: 1,
					},
				},
				sourceAssets: [
					{
						bounds: null,
						debug: { sourceAssetId: "setup-model/02000010" },
						identity: {
							kind: "static-object-source",
							sourceAssetKind: "setup-model",
							sourceDid: 0x02000010,
						},
						invalidPolygonCount: 0,
						materialSlotCount: 1,
						partCount: 0,
						parts: [],
						physicsPolygonCount: 0,
						renderTriangleCount: 0,
						skippedPolygonCount: 0,
						sourceAssetKind: "setup-model",
					},
				],
				sourceSpatial: {
					bounds: null,
					coordinateSpace: "landblock-render-local",
					outdoorBvh: null,
					outdoorBvhItemCount: 1,
					outdoorBvhNodeCount: 0,
				},
				textureRefs: [
					{
						palette: null,
						renderSurface: null,
						role: "surface-texture",
						texture: {
							kind: "surface-texture",
							surfaceTextureId: 0x05000010,
						},
					},
				],
			},
		});
		await flushPromises();
		baker.complete(buildingWork?.workId ?? "");
		await flushPromises();

		expect(sourcePayloads).toMatchObject([
			{
				payload: {
					scope: {
						kind: "outdoor-static-objects",
						landblock: {
							landblockId: 0xda55ffff,
						},
					},
				},
				work: {
					workId: "1:landblock:da55ffff:outdoor-buildings",
				},
			},
		]);
		expect(coordinator.createSnapshot()).toMatchObject({
			latestOutdoorStaticObjectsPayload: {
				domain: "outdoor-buildings",
				landblockId: 0xda55ffff,
				materialSlotCount: 1,
				materialSourceCount: 1,
				missingRefCount: 0,
				objectCount: 1,
				objectKindCounts: {
					building: 1,
					"explicit-object": 0,
					"generated-scenery": 0,
				},
				sourceAssetCount: 1,
				textureRefCount: 1,
			},
		});
	});

	it("publishes latest material coverage by current static domain", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		const [work] = coordinator.requestStaticDemand(
			createSingleTerrainDemand(0xda55ffff),
		);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete(work?.workId ?? "", {
			materialCoverage: [createMaterialCoverage("outdoor-terrain")],
		});
		await flushPromises();

		expect(coordinator.createSnapshot().materialCoverage).toEqual([
			createMaterialCoverage("outdoor-terrain"),
		]);

		coordinator.requestStaticDemand({
			location: null,
			lod: {
				buildings: -1,
				detail: -1,
				terrain: -1,
				envCells: -1,
			},
		});

		expect(coordinator.createSnapshot().materialCoverage).toEqual([]);
	});

	it("bakes landblock env-cell bundles after resolving source facts", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});
		const sourcePayloads: StaticCoordinatorSourcePayloadDelta[] = [];
		coordinator.subscribeSourcePayloads((delta) => sourcePayloads.push(delta));

		const [work] = coordinator.requestStaticDemand({
			location: {
				envCellId: 0xda550100,
				kind: "interior-cell",
				landblockId: 0xda55ffff,
			},
			lod: {
				buildings: -1,
				detail: -1,
				envCells: 0,
				terrain: -1,
			},
		});

		resolver.complete(
			resolver.pendingRequests[0]?.requestId ?? "",
			createLandblockEnvCellsResolverPayload(),
		);
		await flushPromises();

		expect(work?.job.domain).toBe("landblock-env-cells");
		expect(baker.pendingInputs).toHaveLength(1);
		expect(baker.pendingInputs[0]).toMatchObject({
			domain: "landblock-env-cells",
			staticBatchId:
				"static-batch:1:landblock-env-cells:landblock:da55ffff:1",
		});
		expect(sourcePayloads).toMatchObject([
			{
				payload: {
					scope: {
						kind: "landblock-env-cells",
						landblock: {
							landblockId: 0xda55ffff,
						},
					},
				},
				revision: 1,
				work: {
					workId: "1:landblock:da55ffff:landblock-env-cells",
				},
			},
		]);
		expect(coordinator.createSnapshot()).toMatchObject({
			baking: 1,
			committed: 0,
			committedDrawUnits: 0,
			latestLandblockEnvCellsPayload: {
				acceptedEnvCellCount: 1,
				envCellCount: 1,
				landblockId: 0xda55ffff,
				staticObjectSeedCount: 0,
			},
		});

		baker.complete(work?.workId ?? "");
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			baking: 0,
			committed: 1,
			committedDrawUnits: 0,
		});
		expect(coordinator.createSnapshot().activeWork[0]?.status).toBe("committed");
	});

	it("filters typed work-owned env-cell peer records for superseded batch members", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});
		const deltas: StaticCoordinatorCommitDelta[] = [];
		coordinator.subscribeCommits((delta) => deltas.push(delta));

		coordinator.requestStaticDemand({
			location: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
			lod: {
				buildings: -1,
				detail: -1,
				envCells: 1,
				terrain: 1,
			},
		});

		const envCellRequests = resolver.pendingRequests.filter(
			(request) => request.job.domain === "landblock-env-cells",
		);
		for (const request of envCellRequests) {
			resolver.complete(
				request.requestId,
				createLandblockEnvCellsResolverPayload(request.job.scope.landblockId),
			);
		}
		await flushPromises();

		const envCellBatch = baker.pendingInputs.find(
			(input) => input.domain === "landblock-env-cells",
		);
		expect(envCellBatch?.items.length).toBeGreaterThan(1);

		coordinator.requestStaticDemand({
			location: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
			lod: {
				buildings: -1,
				detail: -1,
				envCells: 0,
				terrain: 1,
			},
		});

		const focusItem = envCellBatch?.items.find(
			(item) => item.work.job.scope.landblockId === 0xda55ffff,
		);
		const staleItem = envCellBatch?.items.find(
			(item) => item.work.job.scope.landblockId !== 0xda55ffff,
		);
		if (!envCellBatch || !focusItem || !staleItem) {
			throw new Error("Expected focus and stale env-cell batch items.");
		}

		baker.complete(envCellBatch.staticBatchId, {
			staticSpatialRecords: [
				createEnvCellSpatialRecord(focusItem.work),
				createEnvCellSpatialRecord(staleItem.work),
			],
			staticVisibilityRecords: [
				createEnvCellVisibilityRecord(focusItem.work),
				createEnvCellVisibilityRecord(staleItem.work),
			],
		});
		await flushPromises();

		expect(coordinator.createSnapshot().staleBakeResults).toBe(
			envCellBatch.items.length - 1,
		);
		expect(deltas.at(-1)).toMatchObject({
			staticSpatialRecords: [
				{
					landblockId: 0xda55ffff,
					owner: {
						workId: focusItem.work.workId,
					},
				},
			],
			staticVisibilityRecords: [
				{
					landblockId: 0xda55ffff,
					owner: {
						workId: focusItem.work.workId,
					},
				},
			],
		});
		expect(
			deltas
				.at(-1)
				?.staticSpatialRecords.some(
					(record) => record.owner.workId === staleItem.work.workId,
				),
		).toBe(false);
	});
});

function createSingleTerrainDemand(landblockId: number): StaticDemand {
	return {
		location: {
			kind: "outdoor-landblock",
			landblockId,
		},
		lod: {
			buildings: -1,
			detail: -1,
			terrain: 0,
			envCells: -1,
		},
	};
}

class RejectingAttachmentProvider implements StaticBakeAttachmentProvider {
	constructor(private readonly message: string) {}

	createAttachments(): Promise<never> {
		return Promise.reject(new Error(this.message));
	}
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function createInvalidOwnerlessDrawUnit(drawUnitId: string): StaticDrawUnit {
	return {
		drawUnitId,
		kind: "ownerless-test-draw-unit",
	} as unknown as StaticDrawUnit;
}

function createTerrainDrawUnit(
	drawUnitId: string,
	landblockId: number,
): TerrainGeometryStaticDrawUnit {
	return {
		coordinateSpace: "landblock-render-local",
		domain: "outdoor-terrain",
		drawUnitId,
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		kind: "terrain-geometry",
		landblockId,
		layerSlots: new Float32Array([0, 0, 0]),
		materialBucketKey: "shader:terrain-debug-flat",
		materialFamily: "terrain-debug-flat",
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
		primaryTextureUseId: null,
		sourceTriangleIds: ["triangle-a"],
		terrainFallbackReasons: [],
		terrainMaterialPlan: null,
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureUseIds: [],
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createMaterialCoverage(
	domain: StaticMaterialCoverageReport["domain"],
): StaticMaterialCoverageReport {
	return {
		buckets: [],
		deferredTriangleCount: 0,
		detailRoleCount: 0,
		domain,
		fallbackReasonCount: 0,
		fallbackReasonCounts: [],
		landblockId: 0xda55ffff,
		materialCount: 0,
		partitionCount: 0,
		renderedTriangleCount: 0,
		triangleCount: 0,
		unrenderedBuckets: [],
		unsupportedTriangleCount: 0,
	};
}

function createEnvCellSpatialRecord(work: ScheduledStaticWork): StaticSpatialRecord {
	return {
		cellStructure: {
			cellStructureId: 0x0d000001,
			kind: "cell-structure",
		},
		envCellId: work.job.scope.landblockId & 0xffff_ffff,
		environment: {
			environmentId: 0x0e000001,
			kind: "environment",
		},
		kind: "env-cell-spatial",
		landblockId: work.job.scope.landblockId,
		localBvhItemCount: 0,
		localBvhNodeCount: 0,
		memberId: `cell-${work.job.scope.landblockId.toString(16)}`,
		owner: createWorkPeerRecordOwner(work),
		renderBounds: null,
		residencyBvhItemCount: 0,
		residencyBvhNodeCount: 0,
	};
}

function createEnvCellVisibilityRecord(
	work: ScheduledStaticWork,
): StaticVisibilityRecord {
	return {
		acceptedEnvCellIds: [work.job.scope.landblockId & 0xffff_ffff],
		diagnostics: [],
		kind: "env-cell-visibility",
		landblockId: work.job.scope.landblockId,
		owner: createWorkPeerRecordOwner(work),
		visibleLinks: [],
	};
}

function createWorkPeerRecordOwner(work: ScheduledStaticWork) {
	return {
		domain: work.job.domain,
		kind: "work" as const,
		scope: work.job.scope,
		scopeKey: `landblock:${work.job.scope.landblockId.toString(16).padStart(8, "0")}`,
		workId: work.workId,
	};
}

function createLandblockEnvCellsResolverPayload(landblockId = 0xda55ffff): {
	readonly scope: StaticScopePayload["scope"];
} {
	const envCellId = landblockId & 0xffff_ff00;

	return {
		scope: {
			acceptedEnvCellIds: [envCellId],
			envCells: [
				{
					cellBsp: {
						kind: "leaf",
						polyIds: [],
						solid: 0,
						sphere: null,
					},
					cellStructure: {
						cellStructureId: 0x0d000001,
						kind: "cell-structure",
					},
					environment: {
						environmentId: 0x0e000001,
						kind: "environment",
					},
					identity: {
						envCellId,
						kind: "env-cell-source",
					},
					landblockId,
					localPlacement: {
						orientation: { w: 1, x: 0, y: 0, z: 0 },
						origin: { x: 0, y: 0, z: 0 },
					},
					localSpatial: {
						localBvh: {
							items: [],
							nodes: [],
						},
						localBvhItemCount: 0,
						localBvhNodeCount: 0,
					},
					memberId: "cell-0",
					portalApertures: [],
					portals: [],
					renderGeometry: {
						bounds: null,
						invalidPolygons: [],
						normals: [],
						positions: [],
						skippedPolygonCount: 0,
						sourceId: 0xda550100,
						surfaceIds: [],
						triangleCount: 0,
						triangles: [],
						uvs: [],
						vertexCount: 0,
					},
					restrictionObjectId: null,
					seenOutside: null,
					staticObjectSeeds: [],
					surfaces: [],
					visibleEnvCellIds: [],
				},
			],
			kind: "landblock-env-cells",
			landblock: {
				kind: "landblock-source",
				landblockId,
				source: "env-cells",
			},
			missingRefs: [],
			portalLinks: [],
			regionRenderProfile: {
				kind: "region-render-profile",
				regionNumber: 1,
			},
			residencySpatial: {
				landblockEnvCellBvhItemCount: 0,
				landblockEnvCellBvhNodeCount: 0,
				landblockEnvCellBvh: {
					items: [],
					nodes: [],
				},
			},
			visibilityDiagnostics: [],
		},
	};
}
