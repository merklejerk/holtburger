import { describe, expect, it, vi } from "vitest";
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
	StaticLayerTaskStatus,
	TerrainGeometryStaticDrawUnit,
	StaticVisibilityRecord,
	StaticObjectBakeDiagnostics,
} from "../contracts";
import { StaticCoordinator } from "./static-coordinator";
import { createLayerPeerRecordOwnerForStaticWork } from "../layer-owners";

describe("static coordinator", () => {
	it("rejects stale resolver results after a newer demand revision supersedes them", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});
		const [firstWork] = scheduledWorkForDemand(
			coordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
		const [secondWork] = scheduledWorkForDemand(
			coordinator,
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
		baker.complete(secondWork.staticWorkId, {
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

		const [firstWork] = scheduledWorkForDemand(
			coordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(1);

		scheduledWorkForDemand(coordinator, createSingleTerrainDemand(0xda56ffff));
		baker.complete(firstWork.staticWorkId);
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 0,
			staleBakeResults: 1,
		});
	});

	it("marks work failed when bake attachment creation fails", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			attachmentProvider: new RejectingAttachmentProvider("geometry offline"),
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		scheduledWorkForDemand(coordinator, createSingleTerrainDemand(0xda55ffff));
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(0);
		expect(coordinator.createSnapshot()).toMatchObject({
			failed: 1,
		});
		expect(coordinator.createSnapshot().layerTasks[0]).toMatchObject({
			phase: "failed",
		});
		expect(JSON.stringify(coordinator.createSnapshot())).not.toContain(
			"geometry offline",
		);
		consoleError.mockRestore();
	});

	it("diffs desired outdoor work across neighboring anchors", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		scheduledWorkForDemand(coordinator, {
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
		expect(resolver.pendingRequests).toHaveLength(9);

		scheduledWorkForDemand(coordinator, {
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

		expect(resolver.pendingRequests).toHaveLength(12);
		expect(coordinator.createSnapshot().layerTasks).toHaveLength(9);
		expect(
			new Set(
				coordinator.createSnapshot().layerTasks.map((work) => work.scopeKey),
			),
		).toEqual(
			new Set([
				"landblock:da54ffff",
				"landblock:da55ffff",
				"landblock:da56ffff",
				"landblock:db54ffff",
				"landblock:db55ffff",
				"landblock:db56ffff",
				"landblock:dc54ffff",
				"landblock:dc55ffff",
				"landblock:dc56ffff",
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

		scheduledWorkForDemand(coordinator, createSingleTerrainDemand(0xda55ffff));

		expect(coordinator.createSnapshot().layerTasks).toEqual([
			{
				domain: "outdoor-terrain",
				ownerId: "terrain:0xda55ffff",
				ownerKey: {
					kind: "terrain",
					landblockId: 0xda55ffff,
				},
				phase: "resolving",
				revision: 1,
				scopeKey: "landblock:da55ffff",
				taskId: "1:landblock:da55ffff:outdoor-terrain",
			},
		]);
		expect(JSON.stringify(coordinator.createSnapshot())).not.toContain("lease");
	});

	it("reports layer owner states for split static domains", () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		scheduledWorkForDemand(coordinator, createSingleOutdoorObjectDemand(0xda55ffff));

		expect(coordinator.createSnapshot().ownerStates).toEqual([
			{
				key: {
					kind: "outdoor-explicit-objects",
					landblockId: 0xda55ffff,
				},
				lifecycle: "resolving",
				revision: 1,
			},
			{
				key: {
					kind: "outdoor-generated-scenery",
					landblockId: 0xda55ffff,
				},
				lifecycle: "resolving",
				revision: 1,
			},
			{
				key: {
					kind: "terrain",
					landblockId: 0xda55ffff,
				},
				lifecycle: "resolving",
				revision: 1,
			},
		]);
		expect(
			coordinator
				.createSnapshot()
				.ownerStates.map((state) => JSON.stringify(state.key)),
		).not.toContain("staticWorkId");
	});

	it("dispatches grouped source requests into owner-keyed bake inputs", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		scheduledWorkForDemand(
			coordinator,
			createSingleOutdoorObjectDemand(0xda55ffff),
		);

		expect(resolver.pendingSourceRequests).toHaveLength(1);
		expect(resolver.pendingSourceRequests[0]?.request).toMatchObject({
			context: "outdoor",
			landblockId: 0xda55ffff,
			sourceLod: 3,
			requestedLayers: [
				{
					kind: "terrain",
					targetOwnerKey: { kind: "terrain", landblockId: 0xda55ffff },
				},
				{
					kind: "outdoor-explicit-objects",
					targetOwnerKey: {
						kind: "outdoor-explicit-objects",
						landblockId: 0xda55ffff,
					},
				},
				{
					kind: "outdoor-generated-scenery",
					targetOwnerKey: {
						kind: "outdoor-generated-scenery",
						landblockId: 0xda55ffff,
					},
				},
			],
		});

		resolver.completeSource(resolver.pendingSourceRequests[0]?.requestId ?? "");
		await flushPromises();

		expect(baker.pendingInputs.map((input) => input.domain).sort()).toEqual([
			"outdoor-explicit-objects",
			"outdoor-generated-scenery",
			"outdoor-terrain",
		]);
		expect(
			baker.pendingInputs.flatMap((input) =>
				input.items.map((item) => item.targetOwnerKey),
			),
		).toEqual([
			{ kind: "terrain", landblockId: 0xda55ffff },
			{ kind: "outdoor-explicit-objects", landblockId: 0xda55ffff },
			{ kind: "outdoor-generated-scenery", landblockId: 0xda55ffff },
		]);
	});

	it("drops late source recipes when their layer owners are no longer demanded", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		scheduledWorkForDemand(
			coordinator,
			createSingleOutdoorObjectDemand(0xda55ffff),
		);
		const sourceRequestId = resolver.pendingSourceRequests[0]?.requestId ?? "";

		scheduledWorkForDemand(coordinator, {
			location: null,
			lod: { buildings: -1, detail: -1, envCells: -1, terrain: -1 },
		});
		resolver.completeSource(sourceRequestId);
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(0);
		expect(coordinator.createSnapshot()).toMatchObject({
			staleResolverResults: 3,
		});
	});

	it("reports layer owner lifecycle transitions without changing work identity", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		const [work] = scheduledWorkForDemand(
			coordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
		expect(coordinator.createSnapshot().ownerStates).toMatchObject([
			{
				key: { kind: "terrain", landblockId: 0xda55ffff },
				lifecycle: "resolving",
			},
		]);

		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		expect(coordinator.createSnapshot().ownerStates).toMatchObject([
			{
				key: { kind: "terrain", landblockId: 0xda55ffff },
				lifecycle: "baking",
			},
		]);

		baker.complete(work.staticWorkId, {
			drawUnits: [createTerrainDrawUnit("terrain-a", 0xda55ffff)],
		});
		await flushPromises();
		expect(coordinator.createSnapshot().ownerStates).toMatchObject([
			{
				key: { kind: "terrain", landblockId: 0xda55ffff },
				lifecycle: "materialized",
			},
		]);

		scheduledWorkForDemand(coordinator, {
			location: null,
			lod: { buildings: -1, detail: -1, envCells: -1, terrain: -1 },
		});
		expect(coordinator.createSnapshot().ownerStates).toEqual([]);
	});

	it("reports empty and failed layer owner states", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const emptyResolver = new DeferredStaticResolver();
		const emptyBaker = new DeferredStaticBaker();
		const emptyCoordinator = new StaticCoordinator({
			baker: emptyBaker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver: emptyResolver,
		});
		const [emptyWork] = scheduledWorkForDemand(
			emptyCoordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
		emptyResolver.complete(emptyResolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		emptyBaker.complete(emptyWork.staticWorkId, { drawUnits: [] });
		await flushPromises();

		expect(emptyCoordinator.createSnapshot().ownerStates).toMatchObject([
			{
				key: { kind: "terrain", landblockId: 0xda55ffff },
				lifecycle: "empty",
			},
		]);

		const failedResolver = new DeferredStaticResolver();
		const failedCoordinator = new StaticCoordinator({
			attachmentProvider: new RejectingAttachmentProvider("geometry offline"),
			baker: new DeferredStaticBaker(),
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver: failedResolver,
		});
		scheduledWorkForDemand(failedCoordinator, createSingleTerrainDemand(0xda55ffff));
		failedResolver.complete(failedResolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();

		expect(failedCoordinator.createSnapshot().ownerStates).toMatchObject([
			{
				key: { kind: "terrain", landblockId: 0xda55ffff },
				lifecycle: "failed",
			},
		]);
		consoleError.mockRestore();
	});

	it("returns retained layer owners with run task status", () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		const reconciliation = coordinator.reconcileStaticDemand(
			createSingleTerrainDemand(0xda55ffff),
		);

		expect(reconciliation.retainedLayerOwners).toEqual([
			{
				kind: "terrain",
				landblockId: 0xda55ffff,
			},
		]);
		expect(reconciliation.runId).toBe("static-run:1");
		expect(reconciliation.layerTasks).toMatchObject([
			{
				ownerKey: {
					kind: "terrain",
					landblockId: 0xda55ffff,
				},
				phase: "resolving",
				taskId: "1:landblock:da55ffff:outdoor-terrain",
			},
		]);
		expect(reconciliation.removedResources).toEqual([]);
	});

	it("adopts same-owner tasks instead of replacing in-flight work", () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		const first = coordinator.reconcileStaticDemand(
			createSingleTerrainDemand(0xda55ffff),
		);
		const second = coordinator.reconcileStaticDemand(
			createSingleTerrainDemand(0xda55ffff),
		);

		expect(first.runId).toBe("static-run:1");
		expect(second.runId).toBe("static-run:2");
		expect(second.layerTasks).toEqual(first.layerTasks);
		expect(resolver.pendingSourceRequests).toHaveLength(1);
	});

	it("keeps failed same-owner tasks terminal without retrying", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const resolver = new DeferredStaticResolver();
		const coordinator = new StaticCoordinator({
			baker: new DeferredStaticBaker(),
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		coordinator.reconcileStaticDemand(createSingleTerrainDemand(0xda55ffff));
		resolver.failSource(
			resolver.pendingSourceRequests[0]?.requestId ?? "",
			new Error("source missing"),
		);
		await flushPromises();

		const retry = coordinator.reconcileStaticDemand(
			createSingleTerrainDemand(0xda55ffff),
		);

		expect(retry.layerTasks).toMatchObject([
			{
				phase: "failed",
				taskId: "1:landblock:da55ffff:outdoor-terrain",
			},
		]);
		expect(resolver.pendingSourceRequests).toHaveLength(1);
		consoleError.mockRestore();
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

		const [work] = scheduledWorkForDemand(
			coordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete(work.staticWorkId, {
			drawUnits: [createTerrainDrawUnit("terrain-a", 0xda55ffff)],
		});
		await flushPromises();

		expect(deltas).toEqual([
			{
				addedDrawUnits: [createTerrainDrawUnit("terrain-a", 0xda55ffff)],
				addedPortalApertureResources: [],
				materialCoverage: [],
				removedResources: [],
				revision: 1,
				staticAuthoredDynamicSeeds: [],
				staticBatchId: "static-batch:1:outdoor-terrain:landblock:da55ffff:1",
				staticObjectRenderInstances: [],
				staticObjectVisualResources: [],
				staticPortalGraphs: [],
				staticPortalInteriorRecords: [],
				staticSourceMappings: [],
				staticSpatialRecords: [],
				staticVisibilityRecords: [],
				textureUses: [],
			},
		]);
		expect(coordinator.createSnapshot().committedDrawUnits).toBe(1);

		scheduledWorkForDemand(coordinator, {
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
			addedPortalApertureResources: [],
			materialCoverage: [],
			removedResources: [{ drawUnitId: "terrain-a", kind: "draw-unit" }],
			revision: 2,
			staticAuthoredDynamicSeeds: [],
			staticBatchId: "static-batch:2:evict",
			staticObjectRenderInstances: [],
			staticObjectVisualResources: [],
			staticPortalGraphs: [],
			staticPortalInteriorRecords: [],
			staticSourceMappings: [],
			staticSpatialRecords: [],
			staticVisibilityRecords: [],
			textureUses: [],
		});
		expect(coordinator.createSnapshot().committedDrawUnits).toBe(0);
	});

	it("retains static object bake diagnostics and recent timing samples", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});
		const work = scheduledWorkForDemand(
			coordinator,
			createSingleOutdoorObjectDemand(0xda55ffff),
		).find((candidate) => candidate.job.domain === "outdoor-generated-scenery");
		const diagnostics = createStaticObjectBakeDiagnostics();

		expect(work).toBeDefined();
		resolver.complete(
			resolver.pendingRequests.find(
				(request) => request.job.domain === "outdoor-generated-scenery",
			)?.requestId ?? "",
		);
		await flushPromises();
		baker.complete(work?.staticWorkId ?? "", {
			staticObjectBakeDiagnostics: [diagnostics],
		});
		await flushPromises();

		const snapshot = coordinator.createSnapshot();
		expect(snapshot.staticObjectBakeDiagnostics).toEqual([diagnostics]);
		expect(snapshot.recentTiming).toHaveLength(1);
		expect(snapshot.recentTiming[0]).toMatchObject({
			domain: "outdoor-generated-scenery",
			itemCount: 1,
			kind: "static-coordinator-timing",
			revision: 1,
			staticBatchId:
				"static-batch:1:outdoor-generated-scenery:landblock:da55ffff:1",
		});
		expect(snapshot.recentTiming[0]?.resolverMs).toEqual(expect.any(Number));
		expect(snapshot.recentTiming[0]?.attachmentMs).toEqual(expect.any(Number));
		expect(snapshot.recentTiming[0]?.bakeMs).toEqual(expect.any(Number));
		expect(snapshot.recentTiming[0]?.commitMs).toEqual(expect.any(Number));
	});

	it("does not emit eviction commit deltas without concrete resources", () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});
		const deltas: StaticCoordinatorCommitDelta[] = [];
		coordinator.subscribeCommits((delta) => deltas.push(delta));

		scheduledWorkForDemand(coordinator, createSingleTerrainDemand(0xda55ffff));
		const reconciliation = coordinator.reconcileStaticDemand({
			location: null,
			lod: {
				buildings: -1,
				detail: -1,
				envCells: -1,
				terrain: -1,
			},
		});

		expect(reconciliation.retainedLayerOwners).toEqual([]);
		expect(reconciliation.removedResources).toEqual([]);
		expect(deltas).toEqual([]);
	});

	it("rejects ownerless committed draw units instead of inferring batch ownership", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});
		const deltas: StaticCoordinatorCommitDelta[] = [];
		coordinator.subscribeCommits((delta) => deltas.push(delta));

		const [work] = scheduledWorkForDemand(
			coordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete(work.staticWorkId, {
			drawUnits: [createInvalidOwnerlessDrawUnit("bad-draw-unit")],
		});
		await flushPromises();

		expect(deltas).toEqual([]);
		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 0,
			committedDrawUnits: 0,
			failed: 1,
		});
		expect(JSON.stringify(coordinator.createSnapshot())).not.toContain(
			"bad-draw-unit",
		);
		consoleError.mockRestore();
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

		const work = scheduledWorkForDemand(coordinator, {
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
		const completedTerrainRequests = resolver.pendingRequests.slice(0, 2);
		const completedTerrainWork = completedTerrainRequests.map((request) => {
			const match = terrainWork.find(
				(item) => item.job.scope.landblockId === request.job.scope.landblockId,
			);
			if (!match) {
				throw new Error("Expected completed terrain request to match work.");
			}
			return match;
		});

		resolver.complete(completedTerrainRequests[0]?.requestId ?? "");
		resolver.complete(completedTerrainRequests[1]?.requestId ?? "");
		await flushPromises();

		const firstTerrainScopeKey = `landblock:${completedTerrainWork[0]?.job.scope.landblockId
			.toString(16)
			.padStart(8, "0")}`;
		expect(baker.pendingInputs).toHaveLength(1);
		expect(baker.pendingInputs[0]).toMatchObject({
			domain: "outdoor-terrain",
			revision: 1,
			staticBatchId: `static-batch:1:outdoor-terrain:${firstTerrainScopeKey}:2`,
		});
		expect(
			baker.pendingInputs[0]?.items.map((item) => item.work.staticWorkId),
		).toEqual(completedTerrainWork.map((item) => item.staticWorkId));
		expect(
			baker.pendingInputs[0]?.items.map((item) => item.targetOwnerKey),
		).toEqual(
			completedTerrainWork.map((item) => ({
				kind: "terrain",
				landblockId: item.job.scope.landblockId,
			})),
		);

		baker.complete(baker.pendingInputs[0]?.staticBatchId ?? "");
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 2,
			committedDrawUnits: 0,
		});
	});

	it("drops pending bake items whose layer owner is no longer demanded", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: {
				maxPayloadsPerBatch: 2,
				maxWaitMs: 10_000,
			},
			resolver,
		});

		const work = scheduledWorkForDemand(coordinator, {
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
		const terrainWork = work.filter(
			(item) => item.job.domain === "outdoor-terrain",
		);
		const evictedWork = terrainWork[0];
		const retainedWork = terrainWork[1];
		if (!evictedWork || !retainedWork) {
			throw new Error("terrain radius 1 should create at least two work items");
		}

		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		expect(baker.pendingInputs).toHaveLength(0);

		scheduledWorkForDemand(coordinator, {
			location: {
				kind: "outdoor-landblock",
				landblockId: retainedWork.job.scope.landblockId,
			},
			lod: {
				buildings: -1,
				detail: -1,
				envCells: -1,
				terrain: 0,
			},
		});

		resolver.complete(resolver.pendingRequests[1]?.requestId ?? "");
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(1);
		expect(baker.pendingInputs[0]?.items.map((item) => item.work.staticWorkId)).toEqual([
			retainedWork.staticWorkId,
		]);
		expect(
			baker.pendingInputs[0]?.items.map((item) => item.targetOwnerKey),
		).toEqual([
			{
				kind: "terrain",
				landblockId: retainedWork.job.scope.landblockId,
			},
		]);
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

		const work = scheduledWorkForDemand(coordinator, {
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
		baker.complete(buildingWork?.staticWorkId ?? "");
		await flushPromises();

		expect(
			sourcePayloads.filter(
				(item) => item.work.job.domain === "outdoor-buildings",
			),
		).toMatchObject([
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
					staticWorkId: "1:landblock:da55ffff:outdoor-buildings",
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

	it("publishes latest material coverage by coverage key", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		const [work] = scheduledWorkForDemand(
			coordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete(work?.staticWorkId ?? "", {
			materialCoverage: [
				createMaterialCoverage("outdoor-terrain", {
					coverageKey: "outdoor-terrain:terrain",
					coverageKind: "terrain",
				}),
			],
		});
		await flushPromises();

		expect(coordinator.createSnapshot().materialCoverage).toEqual([
			createMaterialCoverage("outdoor-terrain", {
				coverageKey: "outdoor-terrain:terrain",
				coverageKind: "terrain",
			}),
		]);

		scheduledWorkForDemand(coordinator, {
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

	it("prunes material coverage by retained layer owner", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 1, maxWaitMs: 0 },
			resolver,
		});

		const work = scheduledWorkForDemand(coordinator, {
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
		}).filter((item) => item.job.domain === "outdoor-terrain");
		const completedRequests = resolver.pendingRequests.slice(0, 2);
		const completedWork = completedRequests.map((request) => {
			const match = work.find(
				(item) => item.job.scope.landblockId === request.job.scope.landblockId,
			);
			if (!match) {
				throw new Error("Expected completed terrain request to match work.");
			}
			return match;
		});
		const firstWork = completedWork[0];
		const secondWork = completedWork[1];
		if (!firstWork || !secondWork) {
			throw new Error("terrain radius 1 should create multiple owners");
		}

		for (const request of completedRequests) {
			resolver.complete(request.requestId);
		}
		await flushPromises();

		for (const input of baker.pendingInputs.slice(0, 2)) {
			const workItem = input.items[0]?.work;
			if (!workItem) {
				throw new Error("Expected one terrain work item per bake input.");
			}
			baker.complete(input.staticBatchId, {
				materialCoverage: [
					createMaterialCoverage("outdoor-terrain", {
						coverageKey: `outdoor-terrain:${workItem.job.scope.landblockId.toString(16)}`,
						coverageKind: "terrain",
						landblockId: workItem.job.scope.landblockId,
					}),
				],
			});
		}
		await flushPromises();

		expect(coordinator.createSnapshot().materialCoverage).toHaveLength(2);

		scheduledWorkForDemand(coordinator, {
			location: {
				kind: "outdoor-landblock",
				landblockId: secondWork.job.scope.landblockId,
			},
			lod: {
				buildings: -1,
				detail: -1,
				envCells: -1,
				terrain: 0,
			},
		});

		expect(coordinator.createSnapshot().materialCoverage).toEqual([
			createMaterialCoverage("outdoor-terrain", {
				coverageKey: `outdoor-terrain:${secondWork.job.scope.landblockId.toString(16)}`,
				coverageKind: "terrain",
				landblockId: secondWork.job.scope.landblockId,
			}),
		]);
		expect(firstWork.staticWorkId).not.toBe(secondWork.staticWorkId);
	});

	it("retains multiple latest material coverage reports for one static domain", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			batching: { maxPayloadsPerBatch: 8, maxWaitMs: 0 },
			resolver,
		});

		const envCellWork = scheduledWorkForDemand(coordinator, {
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
		}).find((item) => item.job.domain === "env-cell-system");
		const envCellRequest = resolver.pendingRequests.find(
			(request) => request.job.domain === "env-cell-system",
		);
		resolver.complete(
			envCellRequest?.requestId ?? "",
			createEnvCellSystemResolverPayload(),
		);
		await flushPromises();
		baker.complete(envCellWork?.staticWorkId ?? "", {
			materialCoverage: [
				createMaterialCoverage("env-cell-system", {
					coverageKey: "env-cell-system:structured-interior",
					coverageKind: "structured-interior",
				}),
				createMaterialCoverage("env-cell-system", {
					coverageKey: "env-cell-system:static-objects",
					coverageKind: "env-cell-static-object-seeds",
				}),
			],
		});
		await flushPromises();

		expect(
			coordinator
				.createSnapshot()
				.materialCoverage.map((coverage) => coverage.coverageKey),
		).toEqual([
			"env-cell-system:static-objects",
			"env-cell-system:structured-interior",
		]);
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

		const work = scheduledWorkForDemand(coordinator, {
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
		}).find((item) => item.job.domain === "env-cell-system");
		const envCellRequest = resolver.pendingRequests.find(
			(request) => request.job.domain === "env-cell-system",
		);

		resolver.complete(
			envCellRequest?.requestId ?? "",
			createEnvCellSystemResolverPayload(),
		);
		await flushPromises();

		expect(work?.job.domain).toBe("env-cell-system");
		const envCellBakeInput = baker.pendingInputs.find(
			(input) => input.domain === "env-cell-system",
		);
		expect(envCellBakeInput).toMatchObject({
			domain: "env-cell-system",
			staticBatchId: "static-batch:1:env-cell-system:landblock:da55ffff:1",
		});
		expect(
			sourcePayloads.filter(
				(item) => item.work.job.domain === "env-cell-system",
			),
		).toMatchObject([
			{
				payload: {
					scope: {
						kind: "env-cell-system",
						landblock: {
							landblockId: 0xda55ffff,
						},
					},
				},
				revision: 1,
				work: {
					staticWorkId: "1:landblock:da55ffff:env-cell-system",
				},
			},
		]);
		expect(coordinator.createSnapshot()).toMatchObject({
			baking: 2,
			committed: 0,
			committedDrawUnits: 0,
			latestEnvCellSystemPayload: {
				acceptedEnvCellCount: 1,
				envCellCount: 1,
				landblockId: 0xda55ffff,
				staticObjectSeedCount: 0,
			},
		});

		baker.complete(work?.staticWorkId ?? "");
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			baking: 1,
			committed: 1,
			committedDrawUnits: 0,
		});
		expect(
			coordinator
				.createSnapshot()
				.layerTasks.find((item) => item.domain === "env-cell-system")
				?.phase,
		).toBe("committed");
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

		scheduledWorkForDemand(coordinator, {
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
			(request) => request.job.domain === "env-cell-system",
		);
		for (const request of envCellRequests) {
			resolver.complete(
				request.requestId,
				createEnvCellSystemResolverPayload(request.job.scope.landblockId),
			);
		}
		await flushPromises();

		const envCellBatch = baker.pendingInputs.find(
			(input) => input.domain === "env-cell-system",
		);
		expect(envCellBatch?.items.length).toBeGreaterThan(1);

		scheduledWorkForDemand(coordinator, {
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
						ownerId: "env-cell-system:0xda55ffff",
					},
				},
			],
			staticVisibilityRecords: [
				{
					landblockId: 0xda55ffff,
					owner: {
						ownerId: "env-cell-system:0xda55ffff",
					},
				},
			],
		});
		expect(
			deltas
				.at(-1)
				?.staticSpatialRecords.some(
					(record) => record.owner.ownerId === "env-cell-system:0xdb55ffff",
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

function createSingleOutdoorObjectDemand(landblockId: number): StaticDemand {
	return {
		location: {
			kind: "outdoor-landblock",
			landblockId,
		},
		lod: {
			buildings: -1,
			detail: 0,
			terrain: 0,
			envCells: -1,
		},
	};
}

function createStaticObjectBakeDiagnostics(): StaticObjectBakeDiagnostics {
	return {
		buildingObjectCount: 0,
		domain: "outdoor-generated-scenery",
		drawUnitCount: 1,
		estimatedAvoidedFlattenedTriangleCount: 0,
		estimatedAvoidedFlattenedTypedArrayBytes: 0,
		estimatedFlattenedTypedArrayBytes: 78,
		estimatedInstancedSourceTypedArrayBytes: 0,
		explicitObjectCount: 0,
		flattenedTriangleCount: 1,
		flattenedVertexCount: 3,
		generatedInstanceCount: 1,
		instancedRenderInstanceCount: 0,
		instancedSourceTriangleCount: 0,
		instancedVisualResourceCount: 0,
		kind: "static-object-bake-diagnostics",
		landblockId: 0xda55ffff,
		objectCount: 1,
		partitionCount: 1,
		renderablePartitionCount: 1,
		retainedTransparentOutdoorGeneratedSceneryPartitionReasons: {
			explicitObject: 0,
			missingInstanceBounds: 0,
			nonRenderableOrDeferredMaterialBucket: 0,
			oneOffGeneratedSource: 0,
			repeatedGeneratedSourceRetainedByPartitionPolicy: 0,
			unsupportedMaterialBucket: 0,
		},
		skippedPartitionCount: 0,
		staticBatchId:
			"static-batch:1:outdoor-generated-scenery:landblock:da55ffff:1",
		uniqueSourceCount: 1,
		uniqueSourcePartGeometryCount: 1,
		uniqueSourceTriangleCount: 1,
	};
}

function scheduledWorkForDemand(
	coordinator: StaticCoordinator,
	demand: StaticDemand,
): readonly ScheduledStaticWork[] {
	return coordinator
		.reconcileStaticDemand(demand)
		.layerTasks.map(createScheduledWorkHandleForTask);
}

function createScheduledWorkHandleForTask(
	task: StaticLayerTaskStatus,
): ScheduledStaticWork {
	return {
		job: {
			domain: task.domain,
			scope: createLandblockScopeForTask(task),
		},
		priority: 0,
		revision: task.revision,
		staticWorkId: task.taskId,
	};
}

function createLandblockScopeForTask(
	task: StaticLayerTaskStatus,
): ScheduledStaticWork["job"]["scope"] {
	const match = /^landblock:([0-9a-f]{8})$/u.exec(task.scopeKey);
	if (!match) {
		throw new Error(`Expected landblock task scope key, got ${task.scopeKey}.`);
	}
	return {
		kind: "landblock",
		landblockId: Number.parseInt(match[1], 16),
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
	options: {
		readonly coverageKey?: string;
		readonly coverageKind?: StaticMaterialCoverageReport["coverageKind"];
		readonly landblockId?: number;
	} = {},
): StaticMaterialCoverageReport {
	return {
		buckets: [],
		coverageKey: options.coverageKey ?? `${domain}:test-coverage`,
		coverageKind: options.coverageKind ?? "outdoor-static-objects",
		deferredTriangleCount: 0,
		detailRoleCount: 0,
		domain,
		fallbackReasonCount: 0,
		fallbackReasonCounts: [],
		landblockId: options.landblockId ?? 0xda55ffff,
		materialCount: 0,
		partitionCount: 0,
		renderedTriangleCount: 0,
		triangleCount: 0,
		unrenderedBuckets: [],
		unsupportedTriangleCount: 0,
	};
}

function createEnvCellSpatialRecord(
	work: ScheduledStaticWork,
): StaticSpatialRecord {
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
		memberId: `cell-${work.job.scope.landblockId.toString(16)}`,
		owner: createLayerPeerRecordOwnerForStaticWork(work),
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
		owner: createLayerPeerRecordOwnerForStaticWork(work),
		visibleLinks: [],
	};
}

function createEnvCellSystemResolverPayload(landblockId = 0xda55ffff): {
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
			kind: "env-cell-system",
			landblock: {
				kind: "landblock-source",
				landblockId,
				source: "env-cells",
			},
			missingRefs: [],
			portalLinks: [],
			regionRenderProfile: {
				detailRoles: [],
				identity: {
					kind: "region-render-profile",
					regionNumber: 1,
				},
			},
			residencySpatial: {
				envCellSystemBvhItemCount: 0,
				envCellSystemBvhNodeCount: 0,
				envCellSystemBvh: {
					items: [],
					nodes: [],
				},
			},
			visibilityDiagnostics: [],
		},
	};
}
