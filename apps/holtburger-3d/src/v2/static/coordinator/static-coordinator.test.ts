import { describe, expect, it } from "vitest";
import {
	DeferredStaticBaker,
	DeferredStaticResolver,
} from "../fake-workers";
import type {
	StaticCoordinatorCommitDelta,
	StaticDemand,
	StaticDrawUnit,
	StaticMaterialCoverageReport,
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
		baker.complete(secondWork.workId);
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
			drawUnits: [createPlaceholderDrawUnit("terrain-a")],
		});
		await flushPromises();

		expect(deltas).toEqual([
			{
				addedDrawUnits: [createPlaceholderDrawUnit("terrain-a")],
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
				topology: -1,
			},
		});

		expect(deltas.at(-1)).toEqual({
			addedDrawUnits: [],
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
				topology: -1,
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
			committedDrawUnits: 2,
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

		const work = coordinator.requestStaticDemand({
			location: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
			lod: {
				buildings: 0,
				detail: -1,
				terrain: 0,
				topology: -1,
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

		expect(coordinator.createSnapshot()).toMatchObject({
			latestOutdoorStaticObjectsPayload: {
				domain: "outdoor-buildings",
				landblockId: 0xda55ffff,
				materialSlotCount: 1,
				materialSourceCount: 1,
				missingRefCount: 0,
				objectCount: 1,
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
				topology: -1,
			},
		});

		expect(coordinator.createSnapshot().materialCoverage).toEqual([]);
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
			topology: -1,
		},
	};
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function createPlaceholderDrawUnit(drawUnitId: string): StaticDrawUnit {
	return {
		drawUnitId,
		kind: "placeholder",
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
