import { describe, expect, it, vi } from "vitest";
import { DeferredStaticBaker, DeferredStaticResolver } from "../fake-workers";
import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../../assets/contracts";
import type {
	DynamicEntityRecipe,
	DynamicVisualBakeInput,
	DynamicVisualBakeResult,
} from "../../dynamic/contracts";
import type { DynamicVisualBaker } from "../../dynamic/visual-baker";
import {
	createEmptyObjectVisualInstallSet,
	createObjectVisualInstallSet,
} from "../../visual/object-visual-install-set";
import type {
	StaticCoordinatorCommitDelta,
	StaticScopePrepCommit,
	StaticCoordinatorSourcePayloadDelta,
	StaticDemand,
	StaticDrawUnit,
	StaticScopePayload,
	StaticMaterialCoverageReport,
	StaticBakeResourceProvider,
	StaticBakeTask,
	StaticLayerTaskStatus,
	TerrainGeometryStaticDrawUnit,
	StaticObjectBakeDiagnostics,
	StaticBakeJobInput,
	StaticResolverJob,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodResolution,
	StaticResolver,
	StaticLandblockSceneLodSourceResolver,
	StaticObjectGeometryStaticDrawUnit,
	StaticBakeTextureUse,
} from "../contracts";
import { StaticCoordinator } from "./static-coordinator";
import type { StaticSourceReadyWork } from "./static-coordinator";
import type {
	ObjectVisualTexturePlacementSnapshot,
	TexturePlacementSnapshot,
} from "../../textures/placement";
import type {
	ObjectVisualRenderInstance,
	ObjectVisualResource,
} from "../../visual/object-visual-install-set";

describe("static coordinator", () => {
	it("drops late resolver results after a newer demand revision supersedes them", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});
		const deltas: StaticCoordinatorCommitDelta[] = [];
		coordinator.subscribeCommits((commit) => deltas.push(commit.staticCommit));
		const [firstWork] = bakeTasksForDemand(
			coordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
		const [secondWork] = bakeTasksForDemand(
			coordinator,
			createSingleTerrainDemand(0xda56ffff),
		);
		const firstResolverRequest = resolver.pendingRequests[0];
		const secondResolverRequest = resolver.pendingRequests[1];

		expect({ domain: firstWork.domain, scope: firstWork.scope }).toEqual(
			firstResolverRequest?.job,
		);
		resolver.complete(firstResolverRequest?.requestId ?? "");
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 0,
		});
		expect(baker.pendingInputs).toHaveLength(0);

		resolver.complete(secondResolverRequest?.requestId ?? "");
		await flushPromises();
		baker.complete(pendingTaskIdForTask(baker, secondWork.taskId), {
			drawUnits: [createTerrainDrawUnit("terrain-a", 0xda56ffff)],
		});
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 1,
			committedDrawUnits: 1,
		});
	});

	it("ignores stale bake results after a newer demand revision supersedes them", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});

		const [firstWork] = bakeTasksForDemand(
			coordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(1);

		bakeTasksForDemand(coordinator, createSingleTerrainDemand(0xda56ffff));
		baker.complete(pendingTaskIdForTask(baker, firstWork.taskId));
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 0,
			committedDrawUnits: 0,
		});
	});

	it("marks layer tasks failed when bake sidecar creation fails", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			resourceProvider: new RejectingResourceProvider("geometry offline"),
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});

		bakeTasksForDemand(coordinator, createSingleTerrainDemand(0xda55ffff));
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(0);
		expect(coordinator.createSnapshot()).toMatchObject({
			failed: 1,
		});
		expect(coordinator.createSnapshot().layerTasks[0]).toMatchObject({
			phase: "failed",
		});
		consoleError.mockRestore();
	});

	it("diffs desired outdoor layer tasks across neighboring anchors", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});

		bakeTasksForDemand(coordinator, {
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

		bakeTasksForDemand(coordinator, {
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
				coordinator.createSnapshot().layerTasks.map((task) => task.scopeKey),
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

		expect(baker.pendingInputs).toHaveLength(0);
	});

	it("reports pending layer task identity and revision", () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});

		bakeTasksForDemand(coordinator, createSingleTerrainDemand(0xda55ffff));

		const layerTasks = coordinator.createSnapshot().layerTasks;
		expect(layerTasks).toHaveLength(1);
		expect(layerTasks[0]).toMatchObject({
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
		});
		expect(layerTasks[0]?.phaseAgeMs).toBeGreaterThanOrEqual(0);
		expect(layerTasks[0]?.phaseStartedAtMs).toBeGreaterThan(0);
	});

	it("reports layer owner states for split static domains", () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});

		bakeTasksForDemand(
			coordinator,
			createSingleOutdoorObjectDemand(0xda55ffff),
		);

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
	});

	it("dispatches grouped source requests into owner-keyed bake inputs", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});

		bakeTasksForDemand(
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
		expect(baker.pendingInputs.map((input) => input.task.ownerKey)).toEqual([
			{ kind: "terrain", landblockId: 0xda55ffff },
			{ kind: "outdoor-explicit-objects", landblockId: 0xda55ffff },
			{ kind: "outdoor-generated-scenery", landblockId: 0xda55ffff },
		]);
	});

	it("routes resolved source work through a guarded source-ready continuation", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});
		const sourceReady: StaticSourceReadyWork[] = [];
		coordinator.setSourceReadyHandler((work) => {
			sourceReady.push(work);
		});
		const [task] = bakeTasksForDemand(
			coordinator,
			createSingleTerrainDemand(0xda55ffff),
		);

		resolver.completeSource(resolver.pendingSourceRequests[0]?.requestId ?? "");
		await flushPromises();

		expect(sourceReady).toHaveLength(1);
		expect(sourceReady[0]).toMatchObject({
			domain: "outdoor-terrain",
			objectVisualPlacementIntents: [],
			terrainPlacementIntents: [],
			sourceReadyGroupId: expect.stringContaining(
				"static-source-ready-group:1:outdoor-terrain:landblock:da55ffff",
			),
			tasks: [expect.objectContaining({ taskId: task.taskId })],
		});
		expect(baker.pendingInputs).toHaveLength(0);

		const continuation = sourceReady[0]?.continueWithPlacement(
			createPlacementSnapshots(),
		);
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(1);
		expect(baker.pendingInputs[0]).toMatchObject({
			task: expect.objectContaining({ taskId: task.taskId }),
		});
		baker.complete(pendingTaskIdForTask(baker, task.taskId));
		await continuation;
	});

	it("includes structured-interior placement intents in env-cell source-ready work", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});
		const sourceReady: StaticSourceReadyWork[] = [];
		coordinator.setSourceReadyHandler((work) => {
			sourceReady.push(work);
		});
		bakeTasksForDemand(coordinator, {
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
		const envCellRequest = resolver.pendingRequests.find(
			(request) => request.job.domain === "env-cell-system",
		);
		if (!envCellRequest) {
			throw new Error("Expected env-cell resolver request.");
		}

		resolver.complete(envCellRequest.requestId, {
			scope: createTexturedEnvCellSystemScope(0xda55ffff),
		});
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(0);
		const envCellSourceReady = sourceReady.find(
			(work) => work.domain === "env-cell-system",
		);
		expect(
			envCellSourceReady?.objectVisualPlacementIntents.map((intent) => ({
				itemId: intent.itemId,
				purpose: intent.purpose,
			})),
		).toEqual([
			{
				itemId: 0,
				purpose: "object-base-color",
			},
		]);
	});

	it("does not let source-ready continuations bake work that left demand", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});
		let sourceReady: StaticSourceReadyWork | null = null;
		coordinator.setSourceReadyHandler((work) => {
			sourceReady = work;
		});
		bakeTasksForDemand(coordinator, createSingleTerrainDemand(0xda55ffff));
		resolver.completeSource(resolver.pendingSourceRequests[0]?.requestId ?? "");
		await flushPromises();

		bakeTasksForDemand(coordinator, {
			location: null,
			lod: { buildings: -1, detail: -1, envCells: -1, terrain: -1 },
		});
		await sourceReady?.continueWithPlacement(createPlacementSnapshots());

		expect(baker.pendingInputs).toHaveLength(0);
		expect(coordinator.createSnapshot().committed).toBe(0);
	});

	it("marks source-ready tasks failed when placement fails", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});
		coordinator.setSourceReadyHandler((work) => {
			work.failPlacement("texture placement failed");
		});
		bakeTasksForDemand(coordinator, createSingleTerrainDemand(0xda55ffff));

		resolver.completeSource(resolver.pendingSourceRequests[0]?.requestId ?? "");
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(0);
		expect(coordinator.createSnapshot().layerTasks).toMatchObject([
			{
				phase: "failed",
			},
		]);
	});

	it("drops late source recipes when their layer owners are no longer demanded", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});

		bakeTasksForDemand(
			coordinator,
			createSingleOutdoorObjectDemand(0xda55ffff),
		);
		const sourceRequestId = resolver.pendingSourceRequests[0]?.requestId ?? "";

		bakeTasksForDemand(coordinator, {
			location: null,
			lod: { buildings: -1, detail: -1, envCells: -1, terrain: -1 },
		});
		resolver.completeSource(sourceRequestId);
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(0);
	});

	it("does not let old source groups feed recreated same-owner tasks", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});

		bakeTasksForDemand(coordinator, createSingleTerrainDemand(0xda55ffff));
		const oldSourceRequestId =
			resolver.pendingSourceRequests[0]?.requestId ?? "";
		bakeTasksForDemand(coordinator, {
			location: null,
			lod: { buildings: -1, detail: -1, envCells: -1, terrain: -1 },
		});
		const [newTask] = bakeTasksForDemand(
			coordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
		if (!newTask) {
			throw new Error("Expected recreated terrain task.");
		}
		const newSourceRequestId =
			resolver.pendingSourceRequests[1]?.requestId ?? "";

		resolver.completeSource(oldSourceRequestId);
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(0);
		expect(coordinator.createSnapshot().layerTasks).toMatchObject([
			{
				phase: "resolving",
				taskId: newTask.taskId,
			},
		]);

		resolver.completeSource(newSourceRequestId);
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(1);
		expect(baker.pendingInputs[0]?.task.taskId).toBe(newTask.taskId);
	});

	it("reports layer owner lifecycle transitions without changing task identity", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});
		const deltas: StaticCoordinatorCommitDelta[] = [];
		coordinator.subscribeCommits((commit) => deltas.push(commit.staticCommit));

		const [work] = bakeTasksForDemand(
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

		baker.complete(pendingTaskIdForTask(baker, work.taskId), {
			drawUnits: [createTerrainDrawUnit("terrain-a", 0xda55ffff)],
		});
		await flushPromises();
		expect(coordinator.createSnapshot().ownerStates).toMatchObject([
			{
				key: { kind: "terrain", landblockId: 0xda55ffff },
				lifecycle: "materializing",
			},
		]);

		coordinator.markCommitMaterialized(deltas.at(-1) ?? failCommitDelta());
		expect(coordinator.createSnapshot().ownerStates).toMatchObject([
			{
				key: { kind: "terrain", landblockId: 0xda55ffff },
				lifecycle: "materialized",
			},
		]);

		bakeTasksForDemand(coordinator, {
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
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver: emptyResolver,
		});
		const emptyDeltas: StaticCoordinatorCommitDelta[] = [];
		emptyCoordinator.subscribeCommits((commit) =>
			emptyDeltas.push(commit.staticCommit),
		);
		const [emptyWork] = bakeTasksForDemand(
			emptyCoordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
		emptyResolver.complete(emptyResolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		emptyBaker.complete(pendingTaskIdForTask(emptyBaker, emptyWork.taskId), {
			drawUnits: [],
		});
		await flushPromises();
		emptyCoordinator.markCommitMaterialized(
			emptyDeltas.at(-1) ?? failCommitDelta(),
		);

		expect(emptyCoordinator.createSnapshot().ownerStates).toMatchObject([
			{
				key: { kind: "terrain", landblockId: 0xda55ffff },
				lifecycle: "empty",
			},
		]);

		const failedResolver = new DeferredStaticResolver();
		const failedCoordinator = new StaticCoordinator({
			resourceProvider: new RejectingResourceProvider("geometry offline"),
			baker: new DeferredStaticBaker(),
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver: failedResolver,
		});
		bakeTasksForDemand(
			failedCoordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
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
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
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

	it("adopts same-owner tasks instead of replacing in-flight tasks", () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
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
		const normalizePhaseAge = (task: StaticLayerTaskStatus) => ({
			...task,
			phaseAgeMs: 0,
		});
		expect(second.layerTasks.map(normalizePhaseAge)).toEqual(
			first.layerTasks.map(normalizePhaseAge),
		);
		expect(resolver.pendingSourceRequests).toHaveLength(1);
	});

	it("keeps failed same-owner tasks terminal without retrying", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const resolver = new DeferredStaticResolver();
		const coordinator = new StaticCoordinator({
			baker: new DeferredStaticBaker(),
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
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
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});
		const deltas: StaticCoordinatorCommitDelta[] = [];
		coordinator.subscribeCommits((commit) => deltas.push(commit.staticCommit));

		const [work] = bakeTasksForDemand(
			coordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete(pendingTaskIdForTask(baker, work.taskId), {
			drawUnits: [createTerrainDrawUnit("terrain-a", 0xda55ffff)],
		});
		await flushPromises();

		expect(deltas).toEqual([
			{
				addedDrawUnits: [createTerrainDrawUnit("terrain-a", 0xda55ffff)],
				addedPortalApertureResources: [],
				commitId: "static-commit:1:1:landblock:da55ffff:outdoor-terrain",
				materialCoverage: [],
				objectVisualInstallSet: createEmptyObjectVisualInstallSet(),
				removedResources: [],
				revision: 1,
				envCellStaticObjectPlacementRecords: [],
				staticPortalGraphs: [],
				staticPortalInteriorRecords: [],
				staticSourceMappings: [],
				staticSpatialRecords: [],
				staticVisibilityRecords: [],
				tasks: [expect.objectContaining({ taskId: work.taskId })],
				textureDependencies: [],
				textureUses: [],
			},
		]);
		expect(coordinator.createSnapshot().committedDrawUnits).toBe(1);

		bakeTasksForDemand(coordinator, {
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
			commitId: "static-commit:2:evict",
			materialCoverage: [],
			objectVisualInstallSet: createEmptyObjectVisualInstallSet(),
			removedResources: [{ drawUnitId: "terrain-a", kind: "draw-unit" }],
			revision: 2,
			envCellStaticObjectPlacementRecords: [],
			staticPortalGraphs: [],
			staticPortalInteriorRecords: [],
			staticSourceMappings: [],
			staticSpatialRecords: [],
			staticVisibilityRecords: [],
			tasks: [],
			textureDependencies: [],
			textureUses: [],
		});
		expect(coordinator.createSnapshot().committedDrawUnits).toBe(0);
	});

	it("emits dynamic visual bake results beside static commit deltas", async () => {
		const resolver = new DynamicRecipeSourceResolver();
		const baker = new DeferredStaticBaker();
		const dynamicVisualBaker = new RecordingDynamicVisualBaker();
		const commits: StaticScopePrepCommit[] = [];
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			dynamicVisualBaker,
			dynamicVisualGeometryAssetReader: new EmptyPreparedAssetReader(),
			resolver,
		});
		coordinator.subscribeCommits((commit) => commits.push(commit));

		const [work] = bakeTasksForDemand(
			coordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
		await flushPromises();
		baker.complete(pendingTaskIdForTask(baker, work.taskId), {
			drawUnits: [createTerrainDrawUnit("terrain-a", 0xda55ffff)],
		});
		await flushPromises();
		await flushPromises();
		await flushPromises();

		expect(dynamicVisualBaker.inputs).toEqual([
			expect.objectContaining({
				recipe: expect.objectContaining({ entityId: "static-dynamic:1" }),
				revision: 1,
				sourceGeometry: [],
			}),
		]);
		expect(commits).toEqual([
			{
				dynamicPlacements: [],
				dynamicRecipes: [
					expect.objectContaining({ entityId: "static-dynamic:1" }),
				],
				dynamicVisualBakeResults: [
					{
						failures: [],
						product: {
							entityId: "static-dynamic:1",
							kind: "skipped",
							reason: {
								kind: "invalid-recipe",
								message: "test dynamic bake",
							},
						},
						revision: 1,
					},
				],
				staticCommit: expect.objectContaining({
					addedDrawUnits: [createTerrainDrawUnit("terrain-a", 0xda55ffff)],
					commitId: "static-commit:1:1:landblock:da55ffff:outdoor-terrain",
				}),
			},
		]);
	});

	it("retains static object bake diagnostics and recent timing samples", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});
		const work = bakeTasksForDemand(
			coordinator,
			createSingleOutdoorObjectDemand(0xda55ffff),
		).find((candidate) => candidate.domain === "outdoor-generated-scenery");
		const diagnostics = createStaticObjectBakeDiagnostics();

		expect(work).toBeDefined();
		resolver.complete(
			resolver.pendingRequests.find(
				(request) => request.job.domain === "outdoor-generated-scenery",
			)?.requestId ?? "",
		);
		await flushPromises();
		baker.complete(pendingTaskIdForTask(baker, work?.taskId ?? ""), {
			staticObjectBakeDiagnostics: [diagnostics],
		});
		await flushPromises();

		const snapshot = coordinator.createSnapshot();
		expect(snapshot.staticObjectBakeDiagnostics).toEqual([diagnostics]);
		expect(snapshot.recentTiming).toHaveLength(1);
		expect(snapshot.recentTiming[0]).toMatchObject({
			domain: "outdoor-generated-scenery",
			kind: "static-coordinator-timing",
			revision: 1,
			scopeKey: "landblock:da55ffff",
			taskId: "1:landblock:da55ffff:outdoor-generated-scenery",
		});
		expect(snapshot.recentTiming[0]?.resolverMs).toEqual(expect.any(Number));
		expect(snapshot.recentTiming[0]?.resourceMs).toEqual(expect.any(Number));
		expect(snapshot.recentTiming[0]?.bakeMs).toEqual(expect.any(Number));
		expect(snapshot.recentTiming[0]?.commitMs).toEqual(expect.any(Number));
	});

	it("does not emit eviction commit deltas without concrete resources", () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});
		const deltas: StaticCoordinatorCommitDelta[] = [];
		coordinator.subscribeCommits((commit) => deltas.push(commit.staticCommit));

		bakeTasksForDemand(coordinator, createSingleTerrainDemand(0xda55ffff));
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
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});
		const deltas: StaticCoordinatorCommitDelta[] = [];
		coordinator.subscribeCommits((commit) => deltas.push(commit.staticCommit));

		const [work] = bakeTasksForDemand(
			coordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete(pendingTaskIdForTask(baker, work.taskId), {
			drawUnits: [createInvalidOwnerlessDrawUnit("bad-draw-unit")],
		});
		await flushPromises();

		expect(deltas).toEqual([]);
		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 0,
			committedDrawUnits: 0,
			failed: 1,
		});
		consoleError.mockRestore();
	});

	it("dispatches same-domain resolved payloads as separate static bake jobs", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});

		const work = bakeTasksForDemand(coordinator, {
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
			(item) => item.domain === "outdoor-terrain",
		);
		const completedTerrainRequests = resolver.pendingRequests.slice(0, 2);
		const completedTerrainWork = completedTerrainRequests.map((request) => {
			const match = terrainWork.find(
				(item) => item.scope.landblockId === request.job.scope.landblockId,
			);
			if (!match) {
				throw new Error("Expected completed terrain request to match work.");
			}
			return match;
		});

		resolver.complete(completedTerrainRequests[0]?.requestId ?? "");
		resolver.complete(completedTerrainRequests[1]?.requestId ?? "");
		await flushPromises();

		let nextInputIndex = 0;
		expect(baker.pendingInputs).toHaveLength(1);
		const observedTaskIds: string[] = [];
		for (let index = 0; index < completedTerrainWork.length; index += 1) {
			const { input, nextIndex } = nextDispatchedInput(
				baker.pendingInputs,
				nextInputIndex,
				"outdoor-terrain",
			);
			nextInputIndex = nextIndex;
			observedTaskIds.push(input.task.taskId);
			expect(input).toMatchObject({
				domain: "outdoor-terrain",
				revision: 1,
				task: expect.objectContaining({
					ownerKey: expect.objectContaining({ kind: "terrain" }),
				}),
			});
			baker.complete(input.task.taskId);
			await flushPromises();
			await flushPromises();
		}
		expect(observedTaskIds.sort()).toEqual(
			completedTerrainWork.map((item) => item.taskId).sort(),
		);

		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 2,
			committedDrawUnits: 0,
		});
	});

	it("drops pending bake jobs whose layer owner is no longer demanded", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});

		const work = bakeTasksForDemand(coordinator, {
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
			(item) => item.domain === "outdoor-terrain",
		);
		const evictedWork = terrainWork[0];
		const retainedWork = terrainWork[1];
		if (!evictedWork || !retainedWork) {
			throw new Error(
				"terrain radius 1 should create at least two layer tasks",
			);
		}

		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();

		expect(baker.pendingInputs).toHaveLength(1);
		expect(baker.pendingInputs[0]?.task.taskId).toBe(evictedWork.taskId);

		bakeTasksForDemand(coordinator, {
			location: {
				kind: "outdoor-landblock",
				landblockId: retainedWork.scope.landblockId,
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

		expect(baker.pendingInputs).toHaveLength(2);
		expect(baker.pendingInputs[1]?.task.taskId).toBe(retainedWork.taskId);
		expect(baker.pendingInputs[1]?.task.ownerKey).toEqual({
			kind: "terrain",
			landblockId: retainedWork.scope.landblockId,
		});
		baker.complete(evictedWork.taskId);
		await flushPromises();
		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 0,
		});
		baker.complete(retainedWork.taskId);
		await flushPromises();
		expect(coordinator.createSnapshot()).toMatchObject({
			committed: 1,
		});
	});

	it("commits object visual texture uses from install-set resource ownership", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});
		const deltas: StaticCoordinatorCommitDelta[] = [];
		coordinator.subscribeCommits((commit) => deltas.push(commit.staticCommit));

		const generatedWork = bakeTasksForDemand(
			coordinator,
			createSingleOutdoorObjectDemand(0xda55ffff),
		).find((item) => item.domain === "outdoor-generated-scenery");
		if (!generatedWork) {
			throw new Error("Expected outdoor object demand to request scenery.");
		}
		resolver.completeSource(resolver.pendingSourceRequests[0]?.requestId ?? "");
		await flushPromises();

		const generatedInput = pendingInputForTask(
			baker.pendingInputs,
			generatedWork.taskId,
		);
		const retainedResource = createObjectVisualResource(
			`resource:${generatedWork.ownerId}`,
		);
		baker.complete(generatedInput.task.taskId, {
			objectVisualInstallSet: createObjectVisualInstallSet({
				renderInstances: [
					createObjectVisualRenderInstance({
						instanceId: `instance:${generatedWork.ownerId}`,
						landblockId: generatedWork.scope.landblockId,
						resourceId: retainedResource.resourceId,
					}),
				],
				visualResources: [retainedResource],
			}),
			textureUses: [
				createStaticObjectVisualTextureUse({
					resourceId: retainedResource.resourceId,
					textureBindingId: "texture-use:retained",
				}),
			],
		});
		await flushPromises();

		expect(deltas).toHaveLength(1);
		expect(deltas[0]?.tasks.map((task) => task.taskId)).toEqual([
			generatedInput.task.taskId,
		]);
		expect(deltas[0]?.objectVisualInstallSet.visualResources).toEqual([
			retainedResource,
		]);
		expect(
			deltas[0]?.textureUses.map((textureUse) => textureUse.textureBindingId),
		).toEqual(["texture-use:retained"]);
	});

	it("commits object visual draw units only through the object visual install set", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});
		const deltas: StaticCoordinatorCommitDelta[] = [];
		coordinator.subscribeCommits((commit) => deltas.push(commit.staticCommit));

		const work = bakeTasksForDemand(
			coordinator,
			createSingleOutdoorObjectDemand(0xda55ffff),
		).find((item) => item.domain === "outdoor-explicit-objects");
		if (!work) {
			throw new Error("Expected outdoor explicit object demand.");
		}
		resolver.completeSource(resolver.pendingSourceRequests[0]?.requestId ?? "");
		await flushPromises();

		const input = pendingInputForTask(baker.pendingInputs, work.taskId);
		const publishedDrawUnit = createStaticObjectDrawUnit(
			"published-static-object-draw-unit",
			work.scope.landblockId,
			"outdoor-explicit-objects",
		);
		baker.complete(input.task.taskId, {
			drawUnits: [],
			objectVisualInstallSet: createObjectVisualInstallSet({
				directDrawUnits: [publishedDrawUnit],
			}),
		});
		await flushPromises();

		expect(deltas).toHaveLength(1);
		expect(deltas[0]?.addedDrawUnits).toEqual([]);
		expect(deltas[0]?.objectVisualInstallSet.directDrawUnits).toEqual([
			publishedDrawUnit,
		]);
		expect(coordinator.createSnapshot().committedDrawUnits).toBe(1);
	});

	it("records compact outdoor static object payload summaries", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});
		const sourcePayloads: StaticCoordinatorSourcePayloadDelta[] = [];
		coordinator.subscribeSourcePayloads((delta) => sourcePayloads.push(delta));

		const work = bakeTasksForDemand(coordinator, {
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
			(item) => item.domain === "outdoor-buildings",
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
		baker.complete(pendingTaskIdForTask(baker, buildingWork?.taskId ?? ""));
		await flushPromises();

		expect(
			sourcePayloads.filter((item) => item.task.domain === "outdoor-buildings"),
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
				task: {
					taskId: "1:landblock:da55ffff:outdoor-buildings",
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
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});

		const [work] = bakeTasksForDemand(
			coordinator,
			createSingleTerrainDemand(0xda55ffff),
		);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete(pendingTaskIdForTask(baker, work?.taskId ?? ""), {
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

		bakeTasksForDemand(coordinator, {
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
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});

		const work = bakeTasksForDemand(coordinator, {
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
		}).filter((item) => item.domain === "outdoor-terrain");
		const completedRequests = resolver.pendingRequests.slice(0, 2);
		const completedWork = completedRequests.map((request) => {
			const match = work.find(
				(item) => item.scope.landblockId === request.job.scope.landblockId,
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

		let nextInputIndex = 0;
		const observedTaskIds: string[] = [];
		for (let index = 0; index < 2; index += 1) {
			const { input, nextIndex } = nextDispatchedInput(
				baker.pendingInputs,
				nextInputIndex,
				"outdoor-terrain",
			);
			nextInputIndex = nextIndex;
			observedTaskIds.push(input.task.taskId);
			const task = input.task;
			baker.complete(input.task.taskId, {
				materialCoverage: [
					createMaterialCoverage("outdoor-terrain", {
						coverageKey: `outdoor-terrain:${task.scope.landblockId.toString(16)}`,
						coverageKind: "terrain",
						landblockId: task.scope.landblockId,
					}),
				],
			});
			await flushPromises();
			await flushPromises();
		}
		expect(observedTaskIds.sort()).toEqual(
			[firstWork.taskId, secondWork.taskId].sort(),
		);

		expect(coordinator.createSnapshot().materialCoverage).toHaveLength(2);

		bakeTasksForDemand(coordinator, {
			location: {
				kind: "outdoor-landblock",
				landblockId: secondWork.scope.landblockId,
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
				coverageKey: `outdoor-terrain:${secondWork.scope.landblockId.toString(16)}`,
				coverageKind: "terrain",
				landblockId: secondWork.scope.landblockId,
			}),
		]);
		expect(firstWork.taskId).not.toBe(secondWork.taskId);
	});

	it("retains multiple latest material coverage reports for one static domain", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});

		const envCellWork = bakeTasksForDemand(coordinator, {
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
		}).find((item) => item.domain === "env-cell-system");
		const envCellRequest = resolver.pendingRequests.find(
			(request) => request.job.domain === "env-cell-system",
		);
		resolver.complete(
			envCellRequest?.requestId ?? "",
			createEnvCellSystemResolverPayload(),
		);
		await flushPromises();
		baker.complete(pendingTaskIdForTask(baker, envCellWork?.taskId ?? ""), {
			materialCoverage: [
				createMaterialCoverage("env-cell-system", {
					coverageKey: "env-cell-system:structured-interior",
					coverageKind: "structured-interior",
				}),
				createMaterialCoverage("env-cell-system", {
					coverageKey: "env-cell-system:static-objects",
					coverageKind: "env-cell-static-object-placements",
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
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});
		const sourcePayloads: StaticCoordinatorSourcePayloadDelta[] = [];
		coordinator.subscribeSourcePayloads((delta) => sourcePayloads.push(delta));

		const work = bakeTasksForDemand(coordinator, {
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
		}).find((item) => item.domain === "env-cell-system");
		const envCellRequest = resolver.pendingRequests.find(
			(request) => request.job.domain === "env-cell-system",
		);

		resolver.complete(
			envCellRequest?.requestId ?? "",
			createEnvCellSystemResolverPayload(),
		);
		await flushPromises();

		expect(work?.domain).toBe("env-cell-system");
		const envCellBakeInput = baker.pendingInputs.find(
			(input) => input.domain === "env-cell-system",
		);
		expect(envCellBakeInput).toMatchObject({
			domain: "env-cell-system",
			task: expect.objectContaining({
				taskId: "1:landblock:da55ffff:env-cell-system",
			}),
		});
		expect(
			sourcePayloads.filter((item) => item.task.domain === "env-cell-system"),
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
				task: {
					taskId: "1:landblock:da55ffff:env-cell-system",
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
				staticObjectPlacementCount: 0,
			},
		});

		baker.complete(pendingTaskIdForTask(baker, work?.taskId ?? ""));
		await flushPromises();

		expect(coordinator.createSnapshot()).toMatchObject({
			baking: 1,
			committed: 1,
			committedDrawUnits: 0,
		});
		expect(
			coordinator
				.createSnapshot()
				.layerTasks.find((item) => item.domain === "env-cell-system")?.phase,
		).toBe("materializing");
	});

	it("dispatches env-cell systems as one bake job per resolved payload", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const coordinator = new StaticCoordinator({
			baker,
			textureIdentityAssetReader: new EmptyPreparedAssetReader(),
			sourceReadyCoalescing: { maxWaitMs: 0 },
			resolver,
		});
		const deltas: StaticCoordinatorCommitDelta[] = [];
		coordinator.subscribeCommits((commit) => deltas.push(commit.staticCommit));

		bakeTasksForDemand(coordinator, {
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

		const expectedTaskIds = envCellRequests.map((request) => {
			const landblockId = request.job.scope.landblockId
				.toString(16)
				.padStart(8, "0");
			return `1:landblock:${landblockId}:env-cell-system`;
		});
		const observedTaskIds: string[] = [];
		let nextInputIndex = 0;
		for (let index = 0; index < expectedTaskIds.length; index += 1) {
			const { input, nextIndex } = nextDispatchedInput(
				baker.pendingInputs,
				nextInputIndex,
				"env-cell-system",
			);
			nextInputIndex = nextIndex;
			observedTaskIds.push(input.task.taskId);
			baker.complete(input.task.taskId);
			await flushPromises();
			await flushPromises();
		}
		expect(observedTaskIds.sort()).toEqual(expectedTaskIds.sort());
		expect(deltas.map((delta) => delta.tasks[0]?.taskId).sort()).toEqual(
			expectedTaskIds.sort(),
		);
	});
});

function failCommitDelta(): never {
	throw new Error("Expected static coordinator commit delta.");
}

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
		estimatedInstancedSourceTypedArrayBytes: 0,
		explicitObjectCount: 0,
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
		taskId: "1:landblock:da55ffff:outdoor-generated-scenery",
		uniqueSourceCount: 1,
		uniqueSourcePartGeometryCount: 1,
		uniqueSourceTriangleCount: 1,
	};
}

function createObjectVisualResource(resourceId: string): ObjectVisualResource {
	return {
		bounds: null,
		coordinateSpace: "static-object-source-local",
		geometry: {
			kind: "static-object-source-geometry",
			partIndex: 0,
			source: {
				kind: "static-object-source",
				sourceAssetKind: "gfx-obj",
				sourceDid: 0x01000001,
			},
			surfaceId: 1,
		},
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		key: {
			geometry: {
				kind: "static-object-source-geometry",
				partIndex: 0,
				source: {
					kind: "static-object-source",
					sourceAssetKind: "gfx-obj",
					sourceDid: 0x01000001,
				},
				surfaceId: 1,
			},
			material: {
				materialEntryKey: "material:test",
				textureBindingIds: [],
			},
		},
		kind: "static-object-visual-resource",
		materialEntries: [],
		materialFamily: "unlit",
		materialPass: "opaque",
		materialSlotIndices: new Float32Array([0, 0, 0]),
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		renderState: {
			alphaTest: null,
			blend: "opaque",
			cull: "back",
			depthWrite: true,
		},
		resourceId,
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureBindingIds: [],
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createObjectVisualRenderInstance(options: {
	readonly instanceId: string;
	readonly landblockId: number;
	readonly resourceId: string;
}): ObjectVisualRenderInstance {
	return {
		bounds: {
			max: { x: 1, y: 1, z: 1 },
			min: { x: 0, y: 0, z: 0 },
		},
		domain: "outdoor-generated-scenery",
		generated: null,
		instanceId: options.instanceId,
		kind: "static-object-render-instance",
		landblockId: options.landblockId,
		resourceId: options.resourceId,
		sortCenter: { x: 0, y: 0, z: 0 },
		source: {
			instanceId: options.instanceId,
			kind: "static-object-instance",
			landblockId: options.landblockId,
			objectKind: "generated-scenery",
		},
		sourceToLandblockMatrix: new Float32Array([
			1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
		]),
		transform: {
			localPlacement: {
				orientation: { w: 1, x: 0, y: 0, z: 0 },
				origin: { x: 0, y: 0, z: 0 },
			},
			sourceScale: { x: 1, y: 1, z: 1 },
		},
		transparency: { kind: "depth-writing" },
	};
}

function createStaticObjectVisualTextureUse(options: {
	readonly resourceId: string;
	readonly textureBindingId: string;
}): StaticBakeTextureUse {
	return {
		domain: "outdoor-generated-scenery",
		owners: [
			{
				kind: "static-object-visual-resource",
				resourceId: options.resourceId,
			},
		],
		source: { argb: 0xffffffff, kind: "solid-color" },
		textureBindingId: options.textureBindingId,
	};
}

function pendingTaskIdForTask(
	baker: DeferredStaticBaker,
	taskId: string,
): string {
	return pendingInputForTask(baker.pendingInputs, taskId).task.taskId;
}

function pendingInputForTask(
	pendingInputs: readonly StaticBakeJobInput[],
	taskId: string,
): StaticBakeJobInput {
	const input = pendingInputs.find(
		(candidate) => candidate.task.taskId === taskId,
	);
	if (!input) {
		throw new Error(`No pending bake job exists for task ${taskId}.`);
	}
	return input;
}

function nextDispatchedInput(
	pendingInputs: readonly StaticBakeJobInput[],
	startIndex: number,
	domain: StaticBakeJobInput["domain"],
): { readonly input: StaticBakeJobInput; readonly nextIndex: number } {
	const index = pendingInputs.findIndex(
		(candidate, candidateIndex) =>
			candidateIndex >= startIndex && candidate.domain === domain,
	);
	if (index < 0) {
		throw new Error(
			`No dispatched ${domain} bake job exists at or after index ${startIndex}.`,
		);
	}
	return {
		input: pendingInputs[index],
		nextIndex: index + 1,
	};
}

function bakeTasksForDemand(
	coordinator: StaticCoordinator,
	demand: StaticDemand,
): readonly StaticBakeTask[] {
	return coordinator
		.reconcileStaticDemand(demand)
		.layerTasks.map(createBakeTaskForLayerTaskStatus);
}

function createBakeTaskForLayerTaskStatus(
	task: StaticLayerTaskStatus,
): StaticBakeTask {
	return {
		domain: task.domain,
		ownerId: task.ownerId,
		ownerKey: task.ownerKey,
		revision: task.revision,
		scope: createLandblockScopeForTask(task),
		scopeKey: task.scopeKey,
		taskId: task.taskId,
	};
}

function createLandblockScopeForTask(
	task: StaticLayerTaskStatus,
): StaticBakeTask["scope"] {
	const match = /^landblock:([0-9a-f]{8})$/u.exec(task.scopeKey);
	if (!match) {
		throw new Error(`Expected landblock task scope key, got ${task.scopeKey}.`);
	}
	return {
		kind: "landblock",
		landblockId: Number.parseInt(match[1], 16),
	};
}

class RejectingResourceProvider implements StaticBakeResourceProvider {
	constructor(private readonly message: string) {}

	createResources(): Promise<never> {
		return Promise.reject(new Error(this.message));
	}
}

class EmptyPreparedAssetReader implements PreparedAssetReader {
	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		return Promise.reject(
			new Error(`Unexpected prepared asset request ${key.kind}:${key.id}.`),
		);
	}
}

class RecordingDynamicVisualBaker implements DynamicVisualBaker {
	readonly inputs: DynamicVisualBakeInput[] = [];

	bake(input: DynamicVisualBakeInput): Promise<DynamicVisualBakeResult> {
		this.inputs.push(input);
		return Promise.resolve({
			failures: [],
			product: {
				entityId: input.recipe.entityId,
				kind: "skipped" as const,
				reason: {
					kind: "invalid-recipe" as const,
					message: "test dynamic bake",
				},
			},
			revision: input.revision,
		});
	}
}

class DynamicRecipeSourceResolver
	implements StaticResolver, StaticLandblockSceneLodSourceResolver
{
	resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		return Promise.resolve(createPlaceholderPayload(job));
	}

	resolveSource(
		request: StaticLandblockSceneLodSourceRequest,
	): Promise<StaticLandblockSceneLodResolution> {
		const layer = request.requestedLayers[0];
		if (!layer) {
			return Promise.resolve({
				dynamicPlacements: [],
				dynamicRecipes: [],
				recipes: [],
				request,
			});
		}
		const job: StaticResolverJob = {
			domain: "outdoor-terrain",
			scope: {
				kind: "landblock",
				landblockId: request.landblockId,
			},
		};
		return Promise.resolve({
			dynamicPlacements: [],
			dynamicRecipes: [
				{
					recipe: createDynamicRecipe(request),
					targetOwnerKey: layer.targetOwnerKey,
				},
			],
			recipes: [
				{
					payload: createPlaceholderPayload(job),
					targetOwnerKey: layer.targetOwnerKey,
				},
			],
			request,
		});
	}
}

function createPlaceholderPayload(job: StaticResolverJob): StaticScopePayload {
	return {
		job,
		scope: {
			kind: "placeholder",
			referencedTextureUses: [],
		},
		sourceRevision: 1,
	};
}

function createDynamicRecipe(
	request: StaticLandblockSceneLodSourceRequest,
): DynamicEntityRecipe {
	const targetOwnerKey = request.requestedLayers[0]?.targetOwnerKey ?? {
		kind: "terrain" as const,
		landblockId: request.landblockId,
	};
	return {
		animationSelection: { kind: "none" },
		baseTransform: {
			baseLocalPlacement: {
				orientation: { w: 1, x: 0, y: 0, z: 0 },
				origin: { x: 0, y: 0, z: 0 },
			},
			sourceScale: { x: 1, y: 1, z: 1 },
		},
		entityId: "static-dynamic:1",
		source: {
			kind: "static-authored",
			owner: {
				domain: "outdoor-terrain",
				key: targetOwnerKey,
				kind: "layer-owner",
				ownerId: "terrain:0xda55ffff",
			},
			placementId: "test-placement",
			sourceResidence: {
				kind: "outdoor-landblock",
				landblockId: request.landblockId,
			},
		},
		visual: {
			animation: null,
			materialPolicy: {
				detailRolePolicy: {
					kind: "static-domain",
					domain: "outdoor-buildings",
				},
				materialPlanningDomain: "outdoor-buildings",
				visualObject: {
					entityId: "static-dynamic:1",
					kind: "dynamic-visual-object",
					resourceId: "dynamic-visual-resource:static-dynamic:1",
				},
			},
			materialSources: [],
			missingRefs: [],
			paletteSources: [],
			setupModel: {
				bounds: null,
				debug: { sourceAssetId: "setup-model/02000010" },
				defaultAnimation: null,
				identity: {
					kind: "static-object-source",
					sourceAssetKind: "setup-model",
					sourceDid: 0x02000010,
				},
				invalidPolygonCount: 0,
				materialSlotCount: 0,
				partCount: 0,
				parts: [],
				physicsPolygonCount: 0,
				renderTriangleCount: 0,
				skippedPolygonCount: 0,
			},
			sourceAssets: [],
			textureRefs: [],
		},
	};
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

function createPlacementSnapshot(): TexturePlacementSnapshot {
	return { placementsByItemId: new Map() };
}

function createObjectVisualPlacementSnapshot(): ObjectVisualTexturePlacementSnapshot {
	return { itemIdsByBindingId: new Map(), placementsByItemId: new Map() };
}

function createPlacementSnapshots(): {
	readonly objectVisualPlacementSnapshot: ObjectVisualTexturePlacementSnapshot;
	readonly terrainPlacementSnapshot: TexturePlacementSnapshot;
} {
	return {
		objectVisualPlacementSnapshot: createObjectVisualPlacementSnapshot(),
		terrainPlacementSnapshot: createPlacementSnapshot(),
	};
}

function createInvalidOwnerlessDrawUnit(drawUnitId: string): StaticDrawUnit {
	return {
		drawUnitId,
		kind: "ownerless-test-draw-unit",
	} as unknown as StaticDrawUnit;
}

function createStaticObjectDrawUnit(
	drawUnitId: string,
	landblockId: number,
	domain: StaticObjectGeometryStaticDrawUnit["domain"],
): StaticObjectGeometryStaticDrawUnit {
	return {
		coordinateSpace: "landblock-render-local",
		domain,
		drawUnitId,
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		kind: "static-object-geometry",
		landblockId,
		materialBucketKey: "shader:flat-color",
		materialEntries: [],
		materialFamily: "flat-color",
		materialIds: [],
		materialPass: "opaque",
		materialSlotIndices: new Float32Array([0, 0, 0]),
		ownership: {
			kind: "outdoor-static-objects",
			landblockId,
			seedIdentities: [],
		},
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
		renderState: {
			blendMode: "opaque",
			cullMode: "back",
			depthWrite: true,
		},
		sort: {
			bucket: "opaque",
			key: 0,
		},
		sourceMappingCoverage: [],
		spatialRecord: null,
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureBindingIds: [],
		triangleCount: 1,
		vertexCount: 3,
	};
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
		primaryTextureBindingId: null,
		sourceTriangleIds: ["triangle-a"],
		terrainFallbackReasons: [],
		terrainMaterialPlan: null,
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureBindingIds: [],
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
					authoredDynamicPlacements: [],
					portalApertures: [],
					portals: [],
					renderGeometry: {
						bounds: null,
						invalidPolygons: [],
						normals: new Float32Array(),
						positions: new Float32Array(),
						skippedPolygonCount: 0,
						sourceId: 0xda550100,
						surfaceIds: [],
						triangleCount: 0,
						triangles: [],
						uvs: new Float32Array(),
						vertexCount: 0,
					},
					restrictionObjectId: null,
					seenOutside: null,
					staticObjectPlacements: [],
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
			materialSources: [],
			missingRefs: [],
			paletteSources: [],
			portalLinks: [],
			portalApertureResources: [],
			portalConnectivityGraph: {
				edges: [],
				nodes: [],
			},
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
			sourceAssets: [],
			textureRefs: [],
			visibilityDiagnostics: [],
		},
	};
}

function createTexturedEnvCellSystemScope(
	landblockId: number,
): StaticScopePayload["scope"] {
	const base = createEnvCellSystemResolverPayload(landblockId).scope;
	if (base.kind !== "env-cell-system") {
		throw new Error("Expected env-cell-system scope fixture.");
	}
	const envCell = base.envCells[0];
	if (!envCell) {
		throw new Error("Expected env-cell fixture.");
	}

	return {
		...base,
		envCells: [
			{
				...envCell,
				authoredDynamicPlacements: [],
				renderGeometry: {
					...envCell.renderGeometry,
					sourceId: envCell.identity.envCellId,
					surfaceIds: [0],
					triangleCount: 1,
					triangles: [
						{
							firstVertex: 0,
							materialVariantSignature: null,
							polygonId: 1,
							surfaceId: 0,
						},
					],
					vertexCount: 3,
				},
				surfaces: [
					{
						material: {
							kind: "static-material-source",
							materialId: 0x08000010,
						},
						slotId: 0,
						surfaceId: 0x08000010,
					},
				],
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
				source: {
					kind: "texture",
					palette: null,
					renderSurfaceDefaultPalettes: [],
					selectedRenderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000010,
					},
					texture: {
						kind: "surface-texture",
						surfaceTextureId: 0x05000010,
					},
				},
				surfaceId: 0x08000010,
				surfaceType: 0,
				translucency: 0,
			},
		],
		paletteSources: [],
		sourceAssets: [],
		textureRefs: [
			{
				palette: null,
				renderSurface: {
					kind: "render-surface",
					renderSurfaceId: 0x06000010,
				},
				role: "surface-texture",
				texture: {
					kind: "surface-texture",
					surfaceTextureId: 0x05000010,
				},
			},
			{
				format: "rgba",
				formatRaw: 1,
				height: 1,
				palette: null,
				renderSurface: {
					kind: "render-surface",
					renderSurfaceId: 0x06000010,
				},
				role: "render-surface",
				width: 1,
			},
		],
	};
}
